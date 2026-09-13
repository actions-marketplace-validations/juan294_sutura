import { CASE_LAB_CASES } from './cases.js';
import { MODE_LABELS } from './labels.js';
import { escapeHtml } from './render.js';
import { validateCaseLabResult, type CaseLabResult } from './result.js';

export const ACCEPTANCE_SCHEMA_VERSION = 'sutura-case-lab-acceptance-v1' as const;
const RESULTS_BASE = 'https://raw.githubusercontent.com/juan294/sutura-demo/case-lab-results/results/';
const LINK_TIMEOUT_MS = 10_000;
const LINK_CONCURRENCY = 5;

export interface AcceptanceCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface AcceptanceRecord {
  readonly schemaVersion: typeof ACCEPTANCE_SCHEMA_VERSION;
  readonly baseUrl: string;
  readonly checkedAt: string;
  readonly checks: readonly AcceptanceCheck[];
  readonly passed: boolean;
}

export interface AcceptanceOptions {
  /** Check that every GitHub link in the results answers without authentication. Defaults to true; false keeps the run offline. */
  readonly checkLinks?: boolean;
  readonly liveResultId?: string;
  /** Expected verification tokens from site.json. Empty or absent: the check is skipped with a named reason. */
  readonly verification?: { readonly google?: string; readonly bing?: string };
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

const PRIVACY_PATH = 'privacy/';
const ABOUT_PATH = 'about/';
const ABOUT_TITLE = 'What Sutura verifies';

/** Signed-out requests only: no cookies, no authorization header, nothing cached. */
async function get(fetchImpl: typeof fetch, url: string, method: 'GET' | 'HEAD' = 'GET'): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINK_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { method, redirect: 'follow', signal: controller.signal, credentials: 'omit', cache: 'no-store' } as RequestInit);
  } finally {
    clearTimeout(timer);
  }
}

function signedOutHeaders(response: Response): string[] {
  const problems: string[] = [];
  if (response.headers.get('set-cookie')) problems.push('sets a cookie');
  if (response.headers.get('www-authenticate')) problems.push('demands authentication');
  return problems;
}

/** Local review servers are plain http; only an https base pins the canonical origin to the base. */
function expectedOrigin(base: string): string | undefined {
  const url = new URL(base);
  return url.protocol === 'https:' ? url.origin : undefined;
}

function canonicalOf(html: string): string | undefined {
  return /<link rel="canonical" href="([^"]+)">/u.exec(html)?.[1];
}

/** Why `value` is not the absolute https address of `expected`, or undefined when it is. */
function absoluteMismatch(value: string | undefined, expected: URL, origin: string | undefined): string | undefined {
  if (value === undefined) return 'missing';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${value} is not an absolute URL`;
  }
  if (url.protocol !== 'https:') return `${value} is not https`;
  if (origin !== undefined && url.origin !== origin) return `${value} is not under ${origin}`;
  if (url.pathname !== expected.pathname) return `${value} does not match the path ${expected.pathname}`;
  return undefined;
}

async function mapLimited<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index]!;
      index += 1;
      results.push(await worker(current));
    }
  }));
  return results;
}

export async function acceptance(baseUrl: string, options: AcceptanceOptions = {}): Promise<AcceptanceRecord> {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const checks: AcceptanceCheck[] = [];
  const results = new Map<string, CaseLabResult>();

  function record(name: string, passed: boolean, detail: string): void {
    checks.push({ name, passed, detail });
  }

  try {
    const index = await get(fetchImpl, base);
    const html = await index.text();
    const problems = signedOutHeaders(index);
    const missing = CASE_LAB_CASES.filter((item) => !html.includes(`replay/${item.id}/`)).map((item) => item.id);
    const hasRelease = /Release v\d+\.\d+\.\d+ · Action <code>[a-f0-9]{40}<\/code>/u.test(html);
    const hasViewport = html.includes('<meta name="viewport" content="width=device-width, initial-scale=1">');
    const passed = index.status === 200 && problems.length === 0 && missing.length === 0 && hasRelease && hasViewport;
    record('index-loads', passed, passed
      ? 'index lists five cases and the release identity'
      : `status ${index.status}; ${problems.join(', ') || 'no auth problems'}; missing ${missing.join(', ') || 'none'}; release ${hasRelease}; viewport ${hasViewport}`);
  } catch (error) {
    record('index-loads', false, error instanceof Error ? error.message : String(error));
  }

  for (const item of CASE_LAB_CASES) {
    const name = `replay-${item.id}`;
    try {
      const page = await get(fetchImpl, `${base}replay/${item.id}/`);
      const html = await page.text();
      const json = await get(fetchImpl, `${base}replay/${item.id}/result.json`);
      const problems = [...signedOutHeaders(page), ...signedOutHeaders(json)];
      const result = validateCaseLabResult(await json.json());
      results.set(item.id, result);
      const label = MODE_LABELS[result.mode];
      const titled = html.includes(`<title>${item.title} · ${label} · `);
      const badged = html.includes(`>${label}</span>`);
      const viewport = html.includes('<meta name="viewport" content="width=device-width, initial-scale=1">');
      const sameCase = result.caseId === item.id;
      const passed = page.status === 200 && json.status === 200 && problems.length === 0 && titled && badged && viewport && sameCase;
      record(name, passed, passed
        ? `${label}; outcome ${result.outcome}; hash ${result.resultHash.slice(0, 12)}`
        : `page ${page.status}; json ${json.status}; ${problems.join(', ') || 'no auth problems'}; title ${titled}; badge ${badged}; viewport ${viewport}; case ${sameCase}`);
    } catch (error) {
      record(name, false, error instanceof Error ? error.message : String(error));
    }
  }

  const trap = results.get('greenwash-trap');
  const flaky = results.get('flaky-failure');
  const refusalPassed = trap?.outcome === 'refused' && trap.caseFile?.audit?.approved === false;
  const flakyPassed = flaky?.outcome === 'flaky-no-patch' && flaky.caseFile?.race.length === 0;
  record('refusal-and-flaky', refusalPassed === true && flakyPassed === true,
    `greenwash-trap ${trap?.outcome ?? 'missing'} (audit approved: ${String(trap?.caseFile?.audit?.approved)}); flaky-failure ${flaky?.outcome ?? 'missing'}`);

  try {
    const css = await get(fetchImpl, `${base}case-lab.css`);
    const text = await css.text();
    const passed = css.status === 200 && text.includes('@media (max-width: 719px)') && text.includes('overflow-x: auto');
    record('mobile-css', passed, passed ? 'breakpoint and horizontal scroll containers present' : `status ${css.status}`);
  } catch (error) {
    record('mobile-css', false, error instanceof Error ? error.message : String(error));
  }

  const origin = expectedOrigin(base);
  const indexedPages = ['', ...CASE_LAB_CASES.map((item) => `replay/${item.id}/`), ABOUT_PATH, PRIVACY_PATH].map((path) => new URL(path, base));

  const robotsUrl = `${base}robots.txt`;
  try {
    const response = await get(fetchImpl, robotsUrl);
    const text = await response.text();
    const sitemapLine = /^Sitemap:[ \t]*(\S+)[ \t]*$/mu.exec(text)?.[1];
    const problems: string[] = [];
    if (response.status !== 200) problems.push(`status ${response.status}`);
    if (!/^Disallow:[ \t]*\S*result\/[ \t]*$/mu.test(text)) problems.push('no Disallow line for result/');
    if (!/^Disallow:[ \t]*\S*api\/[ \t]*$/mu.test(text)) problems.push('no Disallow line for api/');
    const sitemapProblem = absoluteMismatch(sitemapLine, new URL('sitemap.xml', base), origin);
    if (sitemapProblem !== undefined) problems.push(`Sitemap line ${sitemapProblem}`);
    record('robots-txt', problems.length === 0, problems.length === 0
      ? `${robotsUrl} disallows result/ and api/ and names ${sitemapLine}`
      : `${robotsUrl}: ${problems.join('; ')}`);
  } catch (error) {
    record('robots-txt', false, `${robotsUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const sitemapUrl = `${base}sitemap.xml`;
  try {
    const response = await get(fetchImpl, sitemapUrl);
    const text = await response.text();
    const locs = [...text.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]!);
    const problems: string[] = [];
    if (response.status !== 200) problems.push(`status ${response.status}`);
    if (locs.length !== indexedPages.length) problems.push(`${locs.length} <loc> entries, expected ${indexedPages.length}`);
    for (const page of indexedPages) {
      if (!locs.some((loc) => absoluteMismatch(loc, page, origin) === undefined)) problems.push(`no <loc> for ${page.pathname}`);
    }
    record('sitemap-xml', problems.length === 0, problems.length === 0
      ? `${sitemapUrl} lists ${locs.length} pages${origin === undefined ? '' : ` under ${origin}`}`
      : `${sitemapUrl}: ${problems.join('; ')}`);
  } catch (error) {
    record('sitemap-xml', false, `${sitemapUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }

  {
    const problems: string[] = [];
    for (const page of indexedPages) {
      try {
        const response = await get(fetchImpl, page.href);
        const html = await response.text();
        const problem = response.status === 200 ? absoluteMismatch(canonicalOf(html), page, origin) : `status ${response.status}`;
        if (problem !== undefined) problems.push(`${page.href}: canonical ${problem}`);
      } catch (error) {
        problems.push(`${page.href}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    record('canonical', problems.length === 0, problems.length === 0
      ? `${indexedPages.length} pages carry a canonical that matches their address`
      : problems.join('; '));
  }

  const resultUrl = `${base}result/`;
  try {
    const response = await get(fetchImpl, resultUrl);
    const html = await response.text();
    const problems: string[] = [];
    if (response.status !== 200) problems.push(`status ${response.status}`);
    if (!/\bnoindex\b/u.test(response.headers.get('x-robots-tag') ?? '')) problems.push('no X-Robots-Tag: noindex header');
    if (!html.includes('<meta name="robots" content="noindex, nofollow">')) problems.push('no robots noindex meta tag');
    record('result-noindex', problems.length === 0, problems.length === 0
      ? `${resultUrl} is excluded by header and meta tag`
      : `${resultUrl}: ${problems.join('; ')}`);
  } catch (error) {
    record('result-noindex', false, `${resultUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const cardUrl = `${base}social-card.png`;
  try {
    const response = await get(fetchImpl, cardUrl);
    const type = response.headers.get('content-type') ?? 'no content type';
    const bytes = (await response.arrayBuffer()).byteLength;
    const passed = response.status === 200 && type.startsWith('image/png') && bytes > 0;
    record('social-card', passed, passed
      ? `${cardUrl} is a ${bytes}-byte PNG`
      : `${cardUrl}: status ${response.status}; content type ${type}; ${bytes} bytes`);
  } catch (error) {
    record('social-card', false, `${cardUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const privacyUrl = `${base}${PRIVACY_PATH}`;
  try {
    const response = await get(fetchImpl, privacyUrl);
    const html = await response.text();
    const problems: string[] = [];
    if (response.status !== 200) problems.push(`status ${response.status}`);
    if (!/\bPrivacy\b/u.test(html)) problems.push('the word Privacy is missing');
    problems.push(...signedOutHeaders(response));
    record('privacy-page', problems.length === 0, problems.length === 0
      ? `${privacyUrl} answers 200 and names its subject`
      : `${privacyUrl}: ${problems.join('; ')}`);
  } catch (error) {
    record('privacy-page', false, `${privacyUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const aboutUrl = `${base}${ABOUT_PATH}`;
  try {
    const response = await get(fetchImpl, aboutUrl);
    const html = await response.text();
    const problems: string[] = [];
    if (response.status !== 200) problems.push(`status ${response.status}`);
    if (!html.includes(ABOUT_TITLE)) problems.push(`the text ${JSON.stringify(ABOUT_TITLE)} is missing`);
    const unlinked = CASE_LAB_CASES.filter((item) => !html.includes(`replay/${item.id}/`)).map((item) => item.id);
    if (unlinked.length > 0) problems.push(`no link to ${unlinked.join(', ')}`);
    problems.push(...signedOutHeaders(response));
    record('about-page', problems.length === 0, problems.length === 0
      ? `${aboutUrl} answers 200, names its subject, and links to all five cases`
      : `${aboutUrl}: ${problems.join('; ')}`);
  } catch (error) {
    record('about-page', false, `${aboutUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const expectedTags = [
    ...(options.verification?.google === undefined ? [] : [{ name: 'google-site-verification', content: options.verification.google }]),
    ...(options.verification?.bing === undefined ? [] : [{ name: 'msvalidate.01', content: options.verification.bing }]),
  ];
  if (expectedTags.length === 0) {
    record('verification-tags', true, 'skipped: site.json defines no verification token');
  } else {
    try {
      const response = await get(fetchImpl, base);
      const html = await response.text();
      const problems = expectedTags
        .filter((tag) => !html.includes(`<meta name="${tag.name}" content="${escapeHtml(tag.content)}">`))
        .map((tag) => `${tag.name} meta tag missing or not ${tag.content}`);
      if (response.status !== 200) problems.unshift(`status ${response.status}`);
      record('verification-tags', problems.length === 0, problems.length === 0
        ? `${base} carries ${expectedTags.map((tag) => tag.name).join(' and ')}`
        : `${base}: ${problems.join('; ')}`);
    } catch (error) {
      record('verification-tags', false, `${base}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (options.checkLinks !== false) {
    const links = [...new Set([...results.values()].flatMap((result) => Object.values(result.links)))];
    const outcomes = await mapLimited(links, LINK_CONCURRENCY, async (url) => {
      try {
        const response = await get(fetchImpl, url, 'HEAD');
        return { url, ok: response.status === 200, status: response.status };
      } catch (error) {
        return { url, ok: false, status: error instanceof Error ? error.message : String(error) };
      }
    });
    const failed = outcomes.filter((outcome) => !outcome.ok);
    record('links-public', failed.length === 0, failed.length === 0
      ? `${outcomes.length} links answered 200 without authentication`
      : failed.map((outcome) => `${outcome.url} -> ${outcome.status}`).join('; '));
  } else {
    record('links-public', true, 'skipped: link checks disabled for an offline run');
  }

  if (options.liveResultId !== undefined) {
    const name = `live-result-${options.liveResultId}`;
    try {
      const response = await get(fetchImpl, `${RESULTS_BASE}${options.liveResultId}.json`);
      const result = validateCaseLabResult(await response.json());
      const run = result.links.workflowRun === undefined ? undefined : await get(fetchImpl, result.links.workflowRun, 'HEAD');
      const passed = response.status === 200 && result.mode === 'live' && result.requestId === options.liveResultId && run?.status === 200;
      record(name, passed, passed ? `live ${result.caseId} ${result.outcome}` : `status ${response.status}; mode ${result.mode}; run ${run?.status ?? 'missing'}`);
    } catch (error) {
      record(name, false, error instanceof Error ? error.message : String(error));
    }
  }

  return {
    schemaVersion: ACCEPTANCE_SCHEMA_VERSION,
    baseUrl: base,
    checkedAt: now().toISOString(),
    checks,
    passed: checks.every((check) => check.passed),
  };
}
