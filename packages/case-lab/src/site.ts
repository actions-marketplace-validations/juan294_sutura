import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { build } from 'esbuild';

import { canonicalJson } from './canonical.js';
import { CASE_LAB_CASES, caseLabCase } from './cases.js';
import { CASE_LAB_LIMITS } from './limits.js';
import { PACKAGE_DIR } from './replay.js';
import { MODE_LABELS, OUTCOME_LABELS } from './labels.js';
import {
  ABOUT_DESCRIPTION,
  ABOUT_PATH,
  ABOUT_TITLE,
  FAVICON_FILE,
  PRIVACY_DESCRIPTION,
  PRIVACY_PATH,
  PRIVACY_TITLE,
  REPOSITORY_URL,
  SITE_NAME,
  SOCIAL_CARD_FILE,
  consentTools,
  cookielessIdentifiers,
  escapeHtml,
  renderAboutBody,
  renderIndexBody,
  renderPage,
  renderPageLinks,
  renderPendingBody,
  renderPrivacyBody,
  renderResultBody,
  resultPageTitle,
  type CatalogCard,
  type SiteIdentifiers,
} from './render.js';
import type { CaseLabResult } from './result.js';

export { REPOSITORY_URL };

/** Source of `/about/`, relative to the package directory. */
export const ABOUT_SOURCE_FILE = 'content/about.md';

export interface BuildSiteOptions {
  readonly outDir: string;
  readonly catalog: readonly CaseLabResult[];
  readonly release: { readonly version: string; readonly actionSha: string };
  /** Root path of the site, with a trailing slash. */
  readonly siteRoot?: string;
  /** Absolute origin of the deployed site without a trailing slash, for example `https://sutura-case-lab.vercel.app`. Absent: no canonical, no sitemap. */
  readonly siteUrl?: string;
  /** Origin of the dispatcher API; undefined builds a site with live runs off. Empty string means same origin. */
  readonly apiBase?: string;
  readonly cssPath?: string;
  readonly clientBundle?: string;
  /** Directory holding favicon.svg and social-card.png. Defaults to the package assets. */
  readonly assetsDir?: string;
  /** Verification tokens and analytics ids from site.json. Absent or empty: no such markup anywhere. */
  readonly identifiers?: SiteIdentifiers;
  /** Markdown source of `/about/`. Defaults to `content/about.md` in the package. */
  readonly aboutPath?: string;
}

export const SITE_DESCRIPTION = 'Five fixed cases that show how Sutura verifies a CI repair instead of trusting a green result.';
export const SUTURA_DESCRIPTION = 'AI agents make CI pass. Sutura verifies the fix, filters flaky failures, rejects unsafe shortcuts, and opens evidence-backed pull requests for human review.';
const SCHEMA_CONTEXT = 'https://schema.org';

/** Rejects anything but an http(s) origin, optionally with a path, and never a trailing slash. */
export function assertSiteUrl(siteUrl: string): void {
  let url: URL;
  try {
    url = new URL(siteUrl);
  } catch {
    throw new RangeError(`siteUrl must be an absolute URL, received ${JSON.stringify(siteUrl)}`);
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    throw new RangeError(`siteUrl must be a plain http(s) origin, received ${JSON.stringify(siteUrl)}`);
  }
  if (siteUrl.endsWith('/')) throw new RangeError(`siteUrl must not end with /, received ${JSON.stringify(siteUrl)}`);
}

function webSite(url: string | undefined): object {
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'WebSite',
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    ...(url === undefined ? {} : { url }),
  };
}

function softwareApplication(url: string | undefined, version: string): object {
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'SoftwareApplication',
    name: 'Sutura',
    description: SUTURA_DESCRIPTION,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'GitHub Actions',
    license: 'https://opensource.org/licenses/MIT',
    codeRepository: REPOSITORY_URL,
    softwareVersion: version,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    ...(url === undefined ? {} : { url }),
  };
}

interface WebPageFields {
  readonly name: string;
  readonly description: string;
  readonly dateModified: string;
}

function webPage(page: WebPageFields, url: string | undefined, siteUrl: string | undefined): object {
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'WebPage',
    name: page.name,
    description: page.description,
    dateModified: page.dateModified,
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, ...(siteUrl === undefined ? {} : { url: siteUrl }) },
    ...(url === undefined ? {} : { url }),
  };
}

export function renderRobotsTxt(siteUrl: string | undefined, siteRoot: string): string {
  return [
    'User-agent: *',
    `Allow: ${siteRoot}`,
    `Disallow: ${siteRoot}result/`,
    `Disallow: ${siteRoot}api/`,
    ...(siteUrl === undefined ? [] : [`Sitemap: ${siteUrl}${siteRoot}sitemap.xml`]),
    '',
  ].join('\n');
}

export function renderSitemap(entries: readonly { readonly url: string; readonly lastmod: string }[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((entry) => `  <url><loc>${escapeHtml(entry.url)}</loc><lastmod>${escapeHtml(entry.lastmod)}</lastmod></url>`),
    '</urlset>',
    '',
  ].join('\n');
}

const CLIENT_ENTRY_CANDIDATES = ['client.ts', 'client.js'];

export async function bundleClient(): Promise<string> {
  const entry = CLIENT_ENTRY_CANDIDATES
    .map((name) => resolve(import.meta.dirname, name))
    .find((path) => existsSync(path));
  if (entry === undefined) throw new Error('client entry is missing beside the site module');
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    minify: false,
    legalComments: 'none',
    logLevel: 'silent',
  });
  const output = result.outputFiles[0];
  if (output === undefined) throw new Error('client bundle produced no output');
  return output.text;
}

function write(path: string, content: string, written: string[]): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o644 });
  written.push(path);
}

function copy(source: string, path: string, written: string[]): void {
  if (!existsSync(source)) throw new Error(`site asset is missing: ${source}`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
  copyFileSync(source, path);
  written.push(path);
}

function mainAttributes(page: string, siteRoot: string, apiBase: string | undefined): Record<string, string> {
  return {
    'data-page': page,
    'data-site-root': siteRoot,
    ...(apiBase === undefined ? {} : { 'data-api-base': apiBase }),
  };
}

/** Write the complete static site. The output directory is replaced. */
export async function buildSite(options: BuildSiteOptions): Promise<string[]> {
  const siteRoot = options.siteRoot ?? '/';
  if (!siteRoot.startsWith('/') || !siteRoot.endsWith('/')) throw new RangeError('siteRoot must start and end with /');
  const siteUrl = options.siteUrl;
  if (siteUrl !== undefined) assertSiteUrl(siteUrl);
  const absolute = (path: string): string | undefined => (siteUrl === undefined ? undefined : `${siteUrl}${path}`);
  const assetsDir = options.assetsDir ?? resolve(PACKAGE_DIR, 'assets');
  const outDir = resolve(options.outDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true, mode: 0o755 });
  const written: string[] = [];
  const cards: CatalogCard[] = CASE_LAB_CASES.map((item) => {
    const result = options.catalog.find((candidate) => candidate.caseId === item.id);
    if (!result) throw new Error(`catalog is missing ${item.id}`);
    return { item, result };
  });
  const css = readFileSync(options.cssPath ?? resolve(PACKAGE_DIR, 'assets/case-lab.css'), 'utf8');
  const aboutPath = options.aboutPath ?? resolve(PACKAGE_DIR, ABOUT_SOURCE_FILE);
  if (!existsSync(aboutPath)) throw new Error(`about page source is missing: ${aboutPath}`);
  const aboutBody = renderAboutBody(readFileSync(aboutPath, 'utf8'), siteRoot);
  const newest = cards.map((card) => card.result.createdAt).sort().at(-1) ?? new Date(0).toISOString();
  const client = options.clientBundle ?? await bundleClient();
  write(resolve(outDir, 'case-lab.css'), css, written);
  write(resolve(outDir, 'case-lab.js'), client, written);
  copy(resolve(assetsDir, FAVICON_FILE), resolve(outDir, FAVICON_FILE), written);
  copy(resolve(assetsDir, SOCIAL_CARD_FILE), resolve(outDir, SOCIAL_CARD_FILE), written);
  const identifiers = options.identifiers ?? {};
  const shell = { siteRoot, identifiers, ...(siteUrl === undefined ? {} : { siteUrl }) };
  /** Pages without live-run logic still need the client for the consent banner when a tracker is present. */
  const consentScript = consentTools(identifiers).length === 0 ? {} : { script: 'case-lab.js' };
  write(resolve(outDir, 'index.html'), renderPage({
    ...shell,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    path: siteRoot,
    script: 'case-lab.js',
    attributes: mainAttributes('index', siteRoot, options.apiBase),
    jsonLd: [webSite(absolute(siteRoot)), softwareApplication(absolute(siteRoot), options.release.version)],
    body: renderIndexBody({ cards, release: options.release, siteRoot, limits: CASE_LAB_LIMITS }),
  }), written);
  for (const card of cards) {
    const item = caseLabCase(card.result.caseId);
    const path = `${siteRoot}replay/${item.id}/`;
    write(resolve(outDir, 'replay', item.id, 'index.html'), renderPage({
      ...shell,
      ...consentScript,
      title: resultPageTitle(card.result, item),
      description: item.scenario,
      path,
      ogType: 'article',
      attributes: mainAttributes('replay', siteRoot, undefined),
      jsonLd: [webPage({ name: resultPageTitle(card.result, item), description: item.scenario, dateModified: card.result.createdAt }, absolute(path), absolute(siteRoot))],
      body: `${renderResultBody(card.result, item)}\n${renderPageLinks(siteRoot)}`,
    }), written);
    write(resolve(outDir, 'replay', item.id, 'result.json'), `${canonicalJson(card.result)}\n`, written);
  }
  // The live page is per request and stays free of trackers; only cookieless identifiers remain.
  write(resolve(outDir, 'result', 'index.html'), renderPage({
    ...shell,
    identifiers: cookielessIdentifiers(identifiers),
    title: 'Sutura Case Lab · Live run',
    description: 'A live Sutura run started from the Case Lab.',
    path: `${siteRoot}result/`,
    robots: 'noindex',
    script: 'case-lab.js',
    attributes: mainAttributes('result', siteRoot, options.apiBase),
    body: renderPendingBody({ requestId: 'pending', caseTitle: undefined, status: 'Loading the live result…' }),
  }), written);
  const aboutPagePath = `${siteRoot}${ABOUT_PATH}`;
  write(resolve(outDir, 'about', 'index.html'), renderPage({
    ...shell,
    ...consentScript,
    title: `${ABOUT_TITLE} · ${SITE_NAME}`,
    description: ABOUT_DESCRIPTION,
    path: aboutPagePath,
    ogType: 'article',
    attributes: mainAttributes('about', siteRoot, undefined),
    jsonLd: [webPage({ name: ABOUT_TITLE, description: ABOUT_DESCRIPTION, dateModified: newest }, absolute(aboutPagePath), absolute(siteRoot))],
    body: aboutBody,
  }), written);
  const privacyPath = `${siteRoot}${PRIVACY_PATH}`;
  write(resolve(outDir, 'privacy', 'index.html'), renderPage({
    ...shell,
    ...consentScript,
    title: `${PRIVACY_TITLE} · ${SITE_NAME}`,
    description: PRIVACY_DESCRIPTION,
    path: privacyPath,
    attributes: mainAttributes('privacy', siteRoot, undefined),
    body: renderPrivacyBody(identifiers),
  }), written);
  write(resolve(outDir, 'robots.txt'), renderRobotsTxt(siteUrl, siteRoot), written);
  if (siteUrl !== undefined) {
    write(resolve(outDir, 'sitemap.xml'), renderSitemap([
      { url: `${siteUrl}${siteRoot}`, lastmod: newest },
      ...cards.map((card) => ({ url: `${siteUrl}${siteRoot}replay/${card.item.id}/`, lastmod: card.result.createdAt })),
      { url: `${siteUrl}${aboutPagePath}`, lastmod: newest },
      { url: `${siteUrl}${privacyPath}`, lastmod: newest },
    ]), written);
  }
  write(resolve(outDir, 'catalog.json'), `${canonicalJson({
    schemaVersion: 'sutura-case-lab-catalog-v1',
    release: options.release,
    limits: CASE_LAB_LIMITS,
    labels: { mode: MODE_LABELS, outcome: OUTCOME_LABELS },
    cases: cards.map(({ item, result }) => ({
      id: item.id,
      title: item.title,
      scenario: item.scenario,
      language: item.language,
      placeboCaseId: item.placeboCaseId,
      expectedOutcome: item.expectedOutcome,
      mode: result.mode,
      outcome: result.outcome,
      resultPath: `${siteRoot}replay/${item.id}/`,
      resultJson: `${siteRoot}replay/${item.id}/result.json`,
      resultHash: result.resultHash,
    })),
  })}\n`, written);
  return written;
}
