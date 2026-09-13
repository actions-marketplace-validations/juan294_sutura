import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { acceptance } from './acceptance.js';
import { CASE_LAB_CASES } from './cases.js';
import { MODE_LABELS, type SiteIdentifiers } from './render.js';
import { replayCatalog } from './replay.js';
import { validateCaseLabResult, type CaseLabResult } from './result.js';
import { createStaticServer, listen } from './serve.js';
import { buildSite } from './site.js';

const RELEASE = { version: '0.2.0', actionSha: 'a943ded4c734aed75c5c63f2b2dd63a2f44556c2' };
const SITE_URL = 'https://sutura-case-lab.vercel.app';
const NOW = () => new Date('2026-09-04T12:00:00.000Z');
const FULL_IDENTIFIERS: SiteIdentifiers = {
  googleSiteVerification: 'google-token-for-tests_0123456789',
  bingSiteVerification: '0123456789ABCDEF0123456789ABCDEF',
  ga4MeasurementId: 'G-TEST1234',
  clarityProjectId: 'abc123def4',
  vercelAnalytics: true,
};
/** Markup that only an identifier can produce; none of it may appear in a build without identifiers. */
const IDENTIFIER_MARKERS = ['google-site-verification', 'msvalidate.01', 'googletagmanager.com', 'gtag(', 'clarity.ms', 'clarity(', '_vercel/insights', 'window.va', 'data-consent'];

let catalog: CaseLabResult[] = [];
let outDir = '';
let fullDir = '';

beforeAll(async () => {
  catalog = await replayCatalog({ replayDir: mkdtempSync(join(tmpdir(), 'case-lab-site-replay-')), now: NOW });
  outDir = join(mkdtempSync(join(tmpdir(), 'case-lab-site-')), 'site');
  await buildSite({ outDir, catalog, release: RELEASE, apiBase: '', siteUrl: SITE_URL });
  fullDir = join(mkdtempSync(join(tmpdir(), 'case-lab-site-full-')), 'site');
  await buildSite({
    outDir: fullDir, catalog, release: RELEASE, apiBase: '', siteUrl: SITE_URL, identifiers: FULL_IDENTIFIERS,
    clientBundle: readFileSync(join(outDir, 'case-lab.js'), 'utf8'),
  });
}, 120_000);

function walk(dir: string, root = outDir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name), root) : [relative(root, join(dir, entry.name))]);
}

function jsonLdBlocks(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gu)]
    .map((match) => JSON.parse(match[1]!) as Record<string, unknown>);
}

function head(html: string): string {
  return html.slice(0, html.indexOf('</head>'));
}

const REPLAY_PAGES = CASE_LAB_CASES.map((item) => `replay/${item.id}/index.html`);
const HTML_PAGES = ['index.html', 'result/index.html', 'about/index.html', 'privacy/index.html', ...REPLAY_PAGES];
const INDEXED_PAGES = HTML_PAGES.filter((file) => file !== 'result/index.html');

describe('buildSite', () => {
  it('writes the complete file set with validated result documents', () => {
    expect(walk(outDir).sort()).toEqual([
      'about/index.html',
      'case-lab.css',
      'case-lab.js',
      'catalog.json',
      'favicon.svg',
      'index.html',
      'privacy/index.html',
      'replay/flaky-failure/index.html',
      'replay/flaky-failure/result.json',
      'replay/greenwash-trap/index.html',
      'replay/greenwash-trap/result.json',
      'replay/javascript-repair/index.html',
      'replay/javascript-repair/result.json',
      'replay/python-repair/index.html',
      'replay/python-repair/result.json',
      'replay/upstream-incident/index.html',
      'replay/upstream-incident/result.json',
      'result/index.html',
      'robots.txt',
      'sitemap.xml',
      'social-card.png',
    ]);
    for (const result of catalog) {
      const stored = validateCaseLabResult(JSON.parse(readFileSync(join(outDir, 'replay', result.caseId, 'result.json'), 'utf8')));
      expect(stored).toEqual(result);
      const page = readFileSync(join(outDir, 'replay', result.caseId, 'index.html'), 'utf8');
      expect(page).toContain(`<title>`);
      expect(page).toContain(`· ${MODE_LABELS[result.mode]} ·`);
      expect(page).toContain('data-page="replay"');
      expect(page).toContain('<nav class="page-links" aria-label="More"><a href="/">Back to cases</a> · <a href="/about/">How Sutura verifies</a></nav>\n  </main>');
    }
    const index = readFileSync(join(outDir, 'index.html'), 'utf8');
    expect(index).toContain('data-page="index" data-site-root="/" data-api-base=""');
    expect(index.match(/class="case-card"/gu)).toHaveLength(5);
    expect(index).toContain('<a href="/about/">How Sutura verifies a repair</a>');
    const catalogJson = JSON.parse(readFileSync(join(outDir, 'catalog.json'), 'utf8')) as { cases: unknown[]; release: unknown; labels: unknown };
    expect(catalogJson.cases).toHaveLength(5);
    expect(catalogJson.release).toEqual(RELEASE);
    expect(catalogJson.labels).toEqual({
      mode: { live: 'Live run', replay: 'Deterministic replay', recorded: 'Recorded live result' },
      outcome: { fixed: 'Fixed', 'flaky-no-patch': 'Flaky, no patch', refused: 'Refused', 'gave-up': 'Gave up', 'infra-stop': 'Infrastructure stop' },
    });
  });

  it('ships a browser bundle that never assigns location-derived HTML and pulls in the case list', () => {
    const script = readFileSync(join(outDir, 'case-lab.js'), 'utf8');
    expect(script).not.toMatch(/innerHTML\s*=\s*(?:window\.)?location/u);
    expect(script).not.toContain('eval(');
    expect(script).toContain('raw.githubusercontent.com/juan294/sutura-demo/case-lab-results/results/');
    expect(script).toContain('upstream-incident');
    expect(script).toContain('function escapeHtml');
  });

  it('ships the consent banner in the bundle: stored choice, consent update, and the privacy link', () => {
    const script = readFileSync(join(outDir, 'case-lab.js'), 'utf8');
    expect(script).toContain('"sutura-consent"');
    expect(script).toContain('"Cookie consent"');
    expect(script).toContain('"consent", "update", { analytics_storage: "granted" }');
    expect(script).toContain('window.clarity?.("consent")');
    expect(script).toContain('privacy/');
    expect(script).not.toContain('ad_storage');
  });

  it('carries no verification or analytics markup and no privacy tool names without identifiers', () => {
    for (const file of HTML_PAGES) {
      const html = readFileSync(join(outDir, file), 'utf8');
      for (const marker of IDENTIFIER_MARKERS) expect(html, `${file} ${marker}`).not.toContain(marker);
      expect(html, file).toContain('· <a href="/about/">About</a> · <a href="/privacy/">Privacy</a> · <a href="https://github.com/juan294/sutura" rel="noopener">Repository</a></footer>');
    }
    for (const file of REPLAY_PAGES) expect(readFileSync(join(outDir, file), 'utf8'), file).not.toContain('case-lab.js');
    const privacy = readFileSync(join(outDir, 'privacy/index.html'), 'utf8');
    expect(privacy).toContain('<title>Privacy · Sutura Case Lab</title>');
    expect(privacy).toContain('<meta name="description" content="What the Sutura Case Lab measures and how to opt out.">');
    expect(privacy).toContain('This build of the Case Lab carries no analytics. Nothing is measured.');
    expect(privacy).not.toContain('Google Analytics');
    expect(privacy).not.toContain('Clarity');
    expect(privacy).not.toContain('Vercel');
    expect(privacy).not.toContain('name="robots"');
    expect(privacy).toContain(`<link rel="canonical" href="${SITE_URL}/privacy/">`);
  });

  it('renders every verification and analytics tag from a full config, with the consent default before the loader', () => {
    const index = readFileSync(join(fullDir, 'index.html'), 'utf8');
    const indexHead = head(index);
    expect(indexHead).toContain('<meta name="google-site-verification" content="google-token-for-tests_0123456789">');
    expect(indexHead).toContain('<meta name="msvalidate.01" content="0123456789ABCDEF0123456789ABCDEF">');
    const consentDefault = indexHead.indexOf("gtag('consent', 'default', {'ad_storage': 'denied', 'analytics_storage': 'denied', 'ad_user_data': 'denied', 'ad_personalization': 'denied', 'wait_for_update': 500})");
    const loader = indexHead.indexOf('<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST1234"></script>');
    const config = indexHead.indexOf("gtag('js', new Date());gtag('config', \"G-TEST1234\", {'anonymize_ip': true});");
    expect(consentDefault).toBeGreaterThan(-1);
    expect(loader).toBeGreaterThan(consentDefault);
    expect(config).toBeGreaterThan(loader);
    expect(indexHead).not.toContain('granted');
    expect(indexHead).toContain('t.src="https://www.clarity.ms/tag/"+i;');
    expect(indexHead).toContain("'clarity', 'script', \"abc123def4\");window.clarity('consent', false);");
    expect(indexHead).toContain('<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>');
    expect(indexHead).toContain('<script defer src="/_vercel/insights/script.js"></script>');
    expect(index).toContain('<main id="main" class="case-lab" data-page="index" data-site-root="/" data-api-base="" data-consent="ga4,clarity">');
    for (const file of INDEXED_PAGES) {
      const html = readFileSync(join(fullDir, file), 'utf8');
      expect(html, file).toContain('gtag/js?id=G-TEST1234');
      expect(html, file).toContain("window.clarity('consent', false)");
      expect(html, file).toContain('data-consent="ga4,clarity"');
      expect(html, file).toContain('<script src="/case-lab.js" defer></script>');
      expect(html, file).toContain('<meta name="google-site-verification"');
    }
  });

  it('keeps the live page free of GA4 and Clarity while carrying verification and the cookieless script', () => {
    const live = readFileSync(join(fullDir, 'result/index.html'), 'utf8');
    for (const marker of ['googletagmanager.com', 'gtag(', 'clarity.ms', 'clarity(', 'data-consent']) expect(live, marker).not.toContain(marker);
    expect(live).toContain('<meta name="google-site-verification" content="google-token-for-tests_0123456789">');
    expect(live).toContain('<meta name="msvalidate.01" content="0123456789ABCDEF0123456789ABCDEF">');
    expect(live).toContain('<script defer src="/_vercel/insights/script.js"></script>');
    expect(live).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('names each configured tool on the privacy page and lists it in the sitemap', () => {
    const privacy = readFileSync(join(fullDir, 'privacy/index.html'), 'utf8');
    expect(privacy).toContain('<dt>Google Analytics 4</dt><dd>After you choose Accept it stores <code>_ga</code> cookies and pseudonymous usage data');
    expect(privacy).toContain('<dt>Microsoft Clarity</dt><dd>After you choose Accept it records sessions and heatmaps with typed input masked.');
    expect(privacy).toContain('<dt>Vercel Web Analytics</dt><dd>Counts page views in aggregate without cookies');
    expect(privacy).toContain('Google Analytics and Microsoft Clarity do not set a cookie or record anything identifying before you choose Accept');
    expect(privacy).toContain('Choose Decline in the banner, or clear this site');
    expect(privacy).toContain('<code>sutura-consent</code>');
    expect(privacy).not.toContain('name="robots"');
    const sitemap = readFileSync(join(fullDir, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain(`<loc>${SITE_URL}/privacy/</loc>`);
    const ga4Only = join(mkdtempSync(join(tmpdir(), 'case-lab-site-ga4-')), 'site');
    return buildSite({ outDir: ga4Only, catalog, release: RELEASE, clientBundle: '', identifiers: { ga4MeasurementId: 'G-ONLY1' } }).then(() => {
      const page = readFileSync(join(ga4Only, 'privacy/index.html'), 'utf8');
      expect(page).toContain('Google Analytics does not set a cookie or record anything identifying before you choose Accept in the banner at the bottom of the page. Choose Decline to keep it off.');
      expect(page).not.toContain('Clarity');
      expect(page).not.toContain('Vercel');
      expect(readFileSync(join(ga4Only, 'index.html'), 'utf8')).toContain('data-consent="ga4"');
    });
  });

  it('writes an indexed about page from content/about.md with the runtime roles table and a link to every case', () => {
    const about = readFileSync(join(outDir, 'about/index.html'), 'utf8');
    expect(about).toContain('<title>What Sutura verifies · Sutura Case Lab</title>');
    expect(about).toContain('<meta name="description" content="How Sutura reproduces a CI failure, searches repairs in sandboxes, audits the patch, and refuses green-wash fixes.">');
    expect(about).toContain(`<link rel="canonical" href="${SITE_URL}/about/">`);
    expect(about).toContain('<meta property="og:type" content="article">');
    expect(about).not.toContain('name="robots"');
    expect(about).toContain('<main id="main" class="case-lab" data-page="about" data-site-root="/">');
    expect(about).toContain('<h1>What Sutura verifies</h1>');
    expect(about).toContain('<h2>How it works</h2>');
    expect(about).toContain('<ol>\n  <li>A GitHub Actions run fails.</li>');
    expect(about).toContain('<h2>Runtime roles</h2>');
    expect(about).toContain('<div class="scroll"><table><thead><tr><th scope="col">Service</th><th scope="col">Runtime role</th></tr></thead><tbody>\n<tr><td>NVIDIA Nemotron on Nebius Token Factory</td>');
    expect(about).toContain('<td>Tavily</td>');
    expect(about).toContain('<code>flaky-no-patch</code>');
    expect(about).toContain('<strong>inference cost</strong>');
    for (const item of CASE_LAB_CASES) expect(about, item.id).toContain(`<a href="/replay/${item.id}/">See a`);
    expect(about).toContain('<a href="https://github.com/juan294/sutura" rel="noopener">');
    expect(about).toContain('<a href="https://github.com/juan294/sutura/blob/main/README.md" rel="noopener">README</a>');
    expect(about).not.toContain('case-lab.js');
    expect(about).toContain('<nav class="page-links" aria-label="More"><a href="/">Back to cases</a></nav>');
    const blocks = jsonLdBlocks(about);
    expect(blocks).toHaveLength(1);
    const newest = catalog.map((result) => result.createdAt).sort().at(-1);
    expect(blocks[0]).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'What Sutura verifies',
      description: 'How Sutura reproduces a CI failure, searches repairs in sandboxes, audits the patch, and refuses green-wash fixes.',
      dateModified: newest,
      isPartOf: { '@type': 'WebSite', name: 'Sutura Case Lab', url: `${SITE_URL}/` },
      url: `${SITE_URL}/about/`,
    });
    const full = readFileSync(join(fullDir, 'about/index.html'), 'utf8');
    expect(full).toContain('data-consent="ga4,clarity"');
    expect(full).toContain('<script src="/case-lab.js" defer></script>');
  });

  it('reads the about source from aboutPath and refuses a missing file or a disallowed link before writing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'case-lab-about-'));
    const aboutPath = join(dir, 'about.md');
    writeFileSync(aboutPath, '## Custom\n\nSee [the trap](/replay/greenwash-trap/) and [the repo](https://github.com/juan294/sutura).\n');
    const customDir = join(dir, 'site');
    await buildSite({ outDir: customDir, catalog, release: RELEASE, clientBundle: '', siteRoot: '/lab/', aboutPath });
    const about = readFileSync(join(customDir, 'about/index.html'), 'utf8');
    expect(about).toContain('<h2>Custom</h2>\n<p>See <a href="/lab/replay/greenwash-trap/">the trap</a> and <a href="https://github.com/juan294/sutura" rel="noopener">the repo</a>.</p>');
    const missing = join(dir, 'absent.md');
    await expect(buildSite({ outDir: join(dir, 'never'), catalog, release: RELEASE, clientBundle: '', aboutPath: missing }))
      .rejects.toThrow(`about page source is missing: ${missing}`);
    expect(existsSync(join(dir, 'never', 'index.html'))).toBe(false);
    writeFileSync(aboutPath, 'See [elsewhere](https://example.com/).\n');
    await expect(buildSite({ outDir: join(dir, 'never'), catalog, release: RELEASE, clientBundle: '', aboutPath }))
      .rejects.toThrow('markdown link is not allowed: "https://example.com/"');
    expect(existsSync(join(dir, 'never', 'index.html'))).toBe(false);
  });

  it('carries canonical, social, icon, and structured data on every page and noindex only on the live page', () => {
    for (const file of HTML_PAGES) {
      const page = readFileSync(join(outDir, file), 'utf8');
      const path = `/${file.replace(/index\.html$/u, '')}`;
      expect(page, file).toContain(`<link rel="canonical" href="${SITE_URL}${path}">`);
      expect(page, file).toContain(`<meta property="og:url" content="${SITE_URL}${path}">`);
      expect(page.match(/property="og:image"/gu), file).toHaveLength(1);
      expect(page, file).toContain(`<meta property="og:image" content="${SITE_URL}/social-card.png">`);
      expect(page, file).toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(page, file).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
      expect(page.includes('<meta name="robots" content="noindex, nofollow">'), file).toBe(file === 'result/index.html');
    }
    const index = jsonLdBlocks(readFileSync(join(outDir, 'index.html'), 'utf8'));
    expect(index.map((block) => block['@type'])).toEqual(['WebSite', 'SoftwareApplication']);
    expect(index[0]).toMatchObject({ '@context': 'https://schema.org', name: 'Sutura Case Lab', url: `${SITE_URL}/` });
    expect(index[1]).toMatchObject({
      name: 'Sutura',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'GitHub Actions',
      license: 'https://opensource.org/licenses/MIT',
      codeRepository: 'https://github.com/juan294/sutura',
      softwareVersion: RELEASE.version,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      url: `${SITE_URL}/`,
    });
    for (const result of catalog) {
      const blocks = jsonLdBlocks(readFileSync(join(outDir, 'replay', result.caseId, 'index.html'), 'utf8'));
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({
        '@type': 'WebPage',
        url: `${SITE_URL}/replay/${result.caseId}/`,
        dateModified: result.createdAt,
        isPartOf: { '@type': 'WebSite', name: 'Sutura Case Lab', url: `${SITE_URL}/` },
      });
      expect(blocks[0]?.name).toContain(MODE_LABELS[result.mode]);
    }
    expect(jsonLdBlocks(readFileSync(join(outDir, 'result/index.html'), 'utf8'))).toEqual([]);
  });

  it('writes robots.txt and an eight-entry sitemap that reference each other', () => {
    const robots = readFileSync(join(outDir, 'robots.txt'), 'utf8');
    expect(robots.split('\n')).toEqual(['User-agent: *', 'Allow: /', 'Disallow: /result/', 'Disallow: /api/', `Sitemap: ${SITE_URL}/sitemap.xml`, '']);
    const sitemap = readFileSync(join(outDir, 'sitemap.xml'), 'utf8');
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]);
    expect(locs).toEqual([`${SITE_URL}/`, ...CASE_LAB_CASES.map((item) => `${SITE_URL}/replay/${item.id}/`), `${SITE_URL}/about/`, `${SITE_URL}/privacy/`]);
    expect(sitemap.match(/<lastmod>/gu)).toHaveLength(8);
    const newest = catalog.map((result) => result.createdAt).sort().at(-1);
    expect(sitemap).toContain(`<loc>${SITE_URL}/</loc><lastmod>${newest}</lastmod>`);
    expect(sitemap).toContain(`<loc>${SITE_URL}/about/</loc><lastmod>${newest}</lastmod>`);
    expect(sitemap).toContain(`<loc>${SITE_URL}/privacy/</loc><lastmod>${newest}</lastmod>`);
  });

  it('omits canonical, absolute Open Graph URLs, and the sitemap without a site URL', async () => {
    const plainDir = join(mkdtempSync(join(tmpdir(), 'case-lab-plain-')), 'site');
    await buildSite({ outDir: plainDir, catalog, release: RELEASE, clientBundle: '' });
    expect(existsSync(join(plainDir, 'sitemap.xml'))).toBe(false);
    expect(readFileSync(join(plainDir, 'robots.txt'), 'utf8')).not.toContain('Sitemap:');
    const index = readFileSync(join(plainDir, 'index.html'), 'utf8');
    expect(index).not.toContain('rel="canonical"');
    expect(index).not.toContain('og:url');
    expect(index).toContain('<meta property="og:image" content="/social-card.png">');
    expect(jsonLdBlocks(index).map((block) => block.url)).toEqual([undefined, undefined]);
  });

  it('refuses an invalid site root, an invalid site URL, and a catalog missing a case', async () => {
    await expect(buildSite({ outDir: join(outDir, 'x'), catalog, release: RELEASE, siteRoot: 'bad' })).rejects.toThrow('siteRoot must start and end with /');
    await expect(buildSite({ outDir: join(outDir, 'x'), catalog, release: RELEASE, siteUrl: `${SITE_URL}/` })).rejects.toThrow('siteUrl must not end with /');
    await expect(buildSite({ outDir: join(outDir, 'x'), catalog, release: RELEASE, siteUrl: 'sutura-case-lab.vercel.app' })).rejects.toThrow('siteUrl must be an absolute URL');
    await expect(buildSite({ outDir: join(outDir, 'x'), catalog, release: RELEASE, siteUrl: 'ftp://sutura-case-lab.vercel.app' })).rejects.toThrow('siteUrl must be a plain http(s) origin');
    await expect(buildSite({ outDir: join(outDir, 'y'), catalog: catalog.slice(1), release: RELEASE, clientBundle: '' })).rejects.toThrow('catalog is missing javascript-repair');
  });
});

describe('static server and acceptance', () => {
  let server: ReturnType<typeof createStaticServer>;
  let baseUrl = '';

  beforeAll(async () => {
    server = createStaticServer(outDir);
    baseUrl = `http://127.0.0.1:${await listen(server, 0)}/`;
  });

  afterAll(() => {
    server.close();
  });

  it('serves the site signed-out and passes the acceptance record', { timeout: 60_000 }, async () => {
    const record = await acceptance(baseUrl, { now: NOW, checkLinks: false });
    const failed = record.checks.filter((check) => !check.passed);
    expect(failed, JSON.stringify(failed)).toEqual([]);
    expect(record.passed).toBe(true);
    expect(record.checks.map((check) => check.name)).toEqual([
      'index-loads',
      'replay-javascript-repair',
      'replay-python-repair',
      'replay-flaky-failure',
      'replay-greenwash-trap',
      'replay-upstream-incident',
      'refusal-and-flaky',
      'mobile-css',
      'robots-txt',
      'sitemap-xml',
      'canonical',
      'result-noindex',
      'social-card',
      'privacy-page',
      'about-page',
      'verification-tags',
      'links-public',
    ]);
    const byName = Object.fromEntries(record.checks.map((check) => [check.name, check.detail]));
    expect(byName['verification-tags']).toBe('skipped: site.json defines no verification token');
    expect(byName['privacy-page']).toBe(`${baseUrl}privacy/ answers 200 and names its subject`);
    expect(byName['about-page']).toBe(`${baseUrl}about/ answers 200, names its subject, and links to all five cases`);
    expect(byName['sitemap-xml']).toBe(`${baseUrl}sitemap.xml lists 8 pages`);
    expect(byName.canonical).toBe('8 pages carry a canonical that matches their address');
    const traversal = await fetch(`${baseUrl}..%2F..%2Fpackage.json`);
    expect([403, 404]).toContain(traversal.status);
    const missing = await fetch(`${baseUrl}nope.html`);
    expect(missing.status).toBe(404);
    const card = await fetch(`${baseUrl}social-card.png`);
    expect(card.headers.get('content-type')).toBe('image/png');
    expect(card.headers.get('x-content-type-options')).toBe('nosniff');
    expect(card.headers.get('x-robots-tag')).toBeNull();
    const live = await fetch(`${baseUrl}result/`, { method: 'HEAD' });
    expect(live.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('fails the acceptance record when the build has no site URL', { timeout: 60_000 }, async () => {
    const plainDir = join(mkdtempSync(join(tmpdir(), 'case-lab-plain-')), 'site');
    await buildSite({ outDir: plainDir, catalog, release: RELEASE, clientBundle: '' });
    const plainServer = createStaticServer(plainDir);
    const port = await listen(plainServer, 0);
    try {
      const record = await acceptance(`http://127.0.0.1:${port}`, { now: NOW, checkLinks: false });
      expect(record.passed).toBe(false);
      const failed = Object.fromEntries(record.checks.filter((check) => !check.passed).map((check) => [check.name, check.detail]));
      expect(Object.keys(failed).sort()).toEqual(['canonical', 'robots-txt', 'sitemap-xml']);
      expect(failed['robots-txt']).toContain(`http://127.0.0.1:${port}/robots.txt: Sitemap line missing`);
      expect(failed['sitemap-xml']).toContain(`http://127.0.0.1:${port}/sitemap.xml: status 404`);
      expect(failed.canonical).toContain(`http://127.0.0.1:${port}/replay/flaky-failure/: canonical missing`);
      expect(failed.canonical).toContain(`http://127.0.0.1:${port}/about/: canonical missing`);
      expect(failed.canonical).toContain(`http://127.0.0.1:${port}/privacy/: canonical missing`);
    } finally {
      plainServer.close();
    }
  });

  it('passes the verification check only when the served index carries both expected tokens', { timeout: 60_000 }, async () => {
    const fullServer = createStaticServer(fullDir);
    const port = await listen(fullServer, 0);
    const base = `http://127.0.0.1:${port}/`;
    try {
      const matching = await acceptance(base, {
        now: NOW, checkLinks: false, verification: { google: FULL_IDENTIFIERS.googleSiteVerification!, bing: FULL_IDENTIFIERS.bingSiteVerification! },
      });
      expect(matching.passed).toBe(true);
      expect(matching.checks.find((check) => check.name === 'verification-tags')?.detail).toBe(`${base} carries google-site-verification and msvalidate.01`);
      expect(matching.checks.find((check) => check.name === 'sitemap-xml')?.detail).toBe(`${base}sitemap.xml lists 8 pages`);
      const mismatched = await acceptance(base, {
        now: NOW, checkLinks: false, verification: { google: 'another-token-for-tests', bing: FULL_IDENTIFIERS.bingSiteVerification! },
      });
      expect(mismatched.passed).toBe(false);
      expect(mismatched.checks.find((check) => check.name === 'verification-tags')?.detail)
        .toBe(`${base}: google-site-verification meta tag missing or not another-token-for-tests`);
      const plain = await acceptance(baseUrl, { now: NOW, checkLinks: false, verification: { bing: FULL_IDENTIFIERS.bingSiteVerification! } });
      expect(plain.checks.find((check) => check.name === 'verification-tags')?.passed).toBe(false);
    } finally {
      fullServer.close();
    }
  });

  it('fails the acceptance record when a result document is tampered', { timeout: 60_000 }, async () => {
    const tamperedDir = join(mkdtempSync(join(tmpdir(), 'case-lab-tampered-')), 'site');
    await buildSite({ outDir: tamperedDir, catalog, release: RELEASE, clientBundle: '', siteUrl: SITE_URL });
    const path = join(tamperedDir, 'replay/greenwash-trap/result.json');
    const stored = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...stored, outcome: 'fixed', expectedOutcome: 'fixed' }));
    const tamperedServer = createStaticServer(tamperedDir);
    const port = await listen(tamperedServer, 0);
    try {
      const record = await acceptance(`http://127.0.0.1:${port}`, { now: NOW, checkLinks: false });
      expect(record.passed).toBe(false);
      const failed = record.checks.filter((check) => !check.passed).map((check) => check.name);
      expect(failed).toContain('replay-greenwash-trap');
      expect(failed).toContain('refusal-and-flaky');
    } finally {
      tamperedServer.close();
    }
  });
});
