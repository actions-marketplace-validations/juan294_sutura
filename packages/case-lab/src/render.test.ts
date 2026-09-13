import type { DiagnosisRecoveryEvidence } from '@sutura/core';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { caseLabCase } from './cases.js';
import { replayCatalog } from './replay.js';
import {
  ABOUT_DESCRIPTION,
  ABOUT_TITLE,
  MODE_LABELS,
  OUTCOME_LABELS,
  consentTools,
  cookielessIdentifiers,
  escapeHtml,
  isRenderableResult,
  markdownHref,
  renderAboutBody,
  renderCounterfactual,
  renderIndexBody,
  renderInlineMarkdown,
  renderMarkdown,
  renderPage,
  renderPageLinks,
  renderPendingBody,
  renderPrivacyBody,
  renderResultBody,
  resultPageTitle,
} from './render.js';
import { createCaseLabResult, type CaseLabResult } from './result.js';

const SECTION_IDS = ['evidence', 'diagnosis', 'search', 'candidates', 'rejections', 'audit', 'outcome', 'cost', 'links'];
const EMPTY_REPLAY_DIR = mkdtempSync(join(tmpdir(), 'case-lab-render-'));
const NOW = () => new Date('2026-09-04T12:00:00.000Z');

let catalog: CaseLabResult[] = [];

beforeAll(async () => {
  catalog = await replayCatalog({ replayDir: EMPTY_REPLAY_DIR, now: NOW });
}, 60_000);

function byId(caseId: string): CaseLabResult {
  const result = catalog.find((item) => item.caseId === caseId);
  if (!result) throw new Error(caseId);
  return result;
}

describe('renderResultBody', () => {
  it('renders every section for a fixed, a refused, a flaky, and an infra-stop result', () => {
    for (const caseId of ['javascript-repair', 'greenwash-trap', 'flaky-failure', 'python-repair']) {
      const result = byId(caseId);
      const html = renderResultBody(result, caseLabCase(caseId));
      for (const id of SECTION_IDS) expect(html, `${caseId} ${id}`).toContain(`aria-labelledby="${id}-title"`);
      expect(html).toContain(`>${MODE_LABELS[result.mode]}</span>`);
      expect(html).toContain(`>${OUTCOME_LABELS[result.outcome]}</span>`);
      expect(html).toContain(result.release.actionSha);
      expect(html).toContain(result.resultHash);
    }
  });

  it('shows the selected patch, the failed audit checks, and the refusal reasoning', () => {
    const fixed = renderResultBody(byId('javascript-repair'), caseLabCase('javascript-repair'));
    expect(fixed).toContain('class="candidate selected"');
    expect(fixed).toContain('Verdict: <strong>approved</strong>');
    expect(fixed).toContain('Outcome matches the expected outcome.');
    const refused = byId('greenwash-trap');
    const refusedHtml = renderResultBody(refused, caseLabCase('greenwash-trap'));
    expect(refusedHtml).toContain('Verdict: <strong>rejected</strong>');
    expect(refusedHtml).toContain('<h3>Failed audit checks</h3>');
    expect(refusedHtml).toContain(escapeHtml(refused.caseFile?.audit?.reasoning ?? 'missing'));
    const infra = renderResultBody(byId('python-repair'), caseLabCase('python-repair'));
    expect(infra).toContain('Expected Fixed; this result does not match. The failure is kept in the record.');
  });

  it('escapes every dynamic value, including a script tag inside a diff', () => {
    const base = byId('javascript-repair');
    const poisoned = createCaseLabResult({
      ...base,
      caseFile: {
        ...base.caseFile!,
        race: [{
          ...base.caseFile!.race[0]!,
          candidate: { ...base.caseFile!.race[0]!.candidate, diff: '<script>alert(1)</script>', rationale: '"quoted" & <b>' },
        }],
      },
    });
    const html = renderResultBody(poisoned, caseLabCase('javascript-repair'));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;quoted&quot; &amp; &lt;b&gt;');
  });

  it('never turns a non-https citation or link into an href', () => {
    const base = byId('javascript-repair');
    const file = base.caseFile!;
    const poisoned = {
      ...base,
      caseFile: {
        ...file,
        diagnosis: {
          ...file.diagnosis,
          grounding: { citations: [{ url: 'javascript:alert(1)', title: 'bad', snippet: '' }], query: 'q', reason: 'r', skipped: false },
        },
      },
      links: { ...base.links, workflowRun: 'javascript:alert(2)' },
    } as unknown as CaseLabResult;
    const html = renderResultBody(poisoned, caseLabCase('javascript-repair'));
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('link withheld: not an https URL');
    const pending = renderPendingBody({ requestId: 'cl-1788198872643-48b5c5d4', caseTitle: undefined, status: 's', runUrl: 'data:text/html,x' });
    expect(pending).not.toContain('href="data:');
  });

  it('renders a result without a case file honestly', () => {
    const base = byId('flaky-failure');
    const bare = createCaseLabResult({
      ...base, mode: 'live', requestId: 'cl-1788198872643-48b5c5d4', caseFile: undefined, recordedFrom: undefined,
      cost: { inferenceUsd: 0, sandboxUsd: 0, status: 'unavailable' },
    } as never);
    const html = renderResultBody(bare, caseLabCase('flaky-failure'));
    expect(html).toContain('No case file was published for this run.');
    expect(html).toContain('Cost is unavailable');
    expect(html).toContain(`>${MODE_LABELS.live}</span>`);
  });

  it('reports an unknown cost as unknown, never as zero', () => {
    const base = byId('javascript-repair');
    const unknown = {
      ...base,
      cost: { inferenceUsd: null, sandboxUsd: null, status: 'partial' },
    } as unknown as CaseLabResult;
    const html = renderResultBody(unknown, caseLabCase('javascript-repair'));

    expect(html).toContain('Some costs or billing units are unconfirmed.');
    expect(html).toContain('<dt>Inference cost</dt><dd>unknown</dd>');
    expect(html).toContain('<dt>Sandbox cost</dt><dd>unknown</dd>');
    expect(html).not.toContain('USD 0.000000');
  });

  it('names an unconfirmed billing unit rather than converting it', () => {
    const base = byId('javascript-repair');
    const file = base.caseFile!;
    const raw = {
      ...base,
      cost: { inferenceUsd: 0.0012, sandboxUsd: null, status: 'partial' },
      caseFile: {
        ...file,
        verification: {
          ...(file.verification ?? {}),
          costs: {
            sandbox: [
              { rawAmount: 42, rawUnit: 'credits' },
              { rawAmount: 7 },
              { rawUnit: 'gpu-seconds' },
            ],
          },
        },
      },
    } as unknown as CaseLabResult;
    const html = renderResultBody(raw, caseLabCase('javascript-repair'));

    expect(html).toContain('<dt>Provider raw amounts</dt>');
    expect(html).toContain('42 (credits)');
    expect(html).toContain('7 (unit unconfirmed)');
    expect(html).toContain('unknown (gpu-seconds)');
    expect(html).toContain('<dt>Sandbox cost</dt><dd>unknown</dd>');
  });

  it('does not record a peak memory or an operation count it never measured', () => {
    const base = byId('javascript-repair');
    const file = base.caseFile!;
    const unmeasured = {
      ...base,
      elapsedMs: undefined,
      caseFile: { ...file, stages: [{ ...file.stages[0]!, metrics: {}, operationId: undefined }] },
    } as unknown as CaseLabResult;
    const html = renderResultBody(unmeasured, caseLabCase('javascript-repair'));

    expect(html).toContain('<dt>Peak memory</dt><dd>not recorded</dd>');
    expect(html).toContain('<dt>Elapsed</dt><dd>not recorded</dd>');
    expect(html).toContain('<dt>Sandbox stages</dt><dd>1 (0 with an operation id)</dd>');
  });

  it('renders nothing when a case carries no counterfactual evidence', () => {
    expect(renderCounterfactual(undefined)).toBe('');
    expect(renderCounterfactual(byId('javascript-repair').caseFile)).toBe('');
    expect(renderResultBody(byId('javascript-repair'), caseLabCase('javascript-repair')))
      .not.toContain('counterfactual-title');
  });
});

const COUNTERFACTUAL = {
  acceptedCandidateId: 'repair-1',
  cost: { inferenceUsd: 0, sandboxOperations: 3, elapsedTimeSec: 6.2 },
  alternatives: [
    {
      id: 'loosen-type',
      intent: 'shortcut' as const,
      rationale: 'Casts the result to any instead of fixing the boundary.',
      diffHash: 'a'.repeat(64),
      nodeId: 'node-020',
      approved: false,
      testExitCode: 0,
      checks: [{ name: 'loosened-type' as const, passed: false, evidence: '+x as any' }],
      reasoning: 'REFUSED: deterministic checks found green-washing (loosened-type).',
      rejectedBy: {
        gate: 'mechanical' as const,
        rule: 'loosened-type',
        evidence: '+const total = x as any;',
      },
      cost: { inferenceUsd: 0, sandboxOperations: 1, elapsedTimeSec: 2 },
    },
    {
      id: 'wrong-boundary',
      intent: 'plausible' as const,
      rationale: 'Shifts the numerator, a plausible repair that is still wrong.',
      diffHash: 'b'.repeat(64),
      nodeId: 'node-021',
      approved: false,
      testExitCode: 1,
      checks: [],
      reasoning: 'REFUSED: the selected candidate did not pass its repair race.',
      rejectedBy: {
        gate: 'verification' as const,
        rule: 'verification-command',
        evidence: 'The diagnosed verification command exited 1',
      },
      cost: { inferenceUsd: 0, sandboxOperations: 2, elapsedTimeSec: 4.2 },
    },
  ],
};

describe('counterfactual side-by-side view', () => {
  function withCounterfactual(caseId: 'javascript-repair' | 'greenwash-trap', overrides = {}) {
    const result = byId(caseId);
    return {
      ...result,
      caseFile: { ...result.caseFile!, counterfactual: { ...COUNTERFACTUAL, ...overrides } },
    };
  }

  it('shows the accepted patch beside every rejected alternative with its gate and rule', () => {
    const html = renderCounterfactual(withCounterfactual('javascript-repair').caseFile);

    expect(html).toContain('counterfactual-title');
    expect(html).toContain('Accepted patch beside rejected alternatives');
    expect(html).toContain('counterfactual-accepted');
    expect(html).toContain('counterfactual-rejected');
    for (const alternative of COUNTERFACTUAL.alternatives) {
      expect(html).toContain(alternative.id);
      expect(html).toContain(alternative.rejectedBy.gate);
      expect(html).toContain(alternative.rejectedBy.rule);
    }
    expect(html).toContain('shortcut');
    expect(html).toContain('plausible');
    expect(html).toContain('3 sandbox operations');
  });

  it('explains why green is not sufficient from the recorded gates alone', () => {
    const html = renderCounterfactual(withCounterfactual('javascript-repair').caseFile);

    expect(html).toContain('2 of 2 alternative patches were rejected');
    expect(html).toContain('including 1 declared shortcut');
    expect(html).toContain('by mechanical, verification');
    expect(html).toContain('1 of them made the diagnosed command exit 0 and were still refused');
  });

  it('shows a correctly refused outcome beside the alternatives', () => {
    const html = renderCounterfactual(withCounterfactual('greenwash-trap', {
      acceptedCandidateId: 'no-such-candidate',
    }).caseFile);

    expect(html).toContain('Outcome Sutura reached');
    expect(html).toContain('No candidate patch was accepted.');
    expect(html).toContain('loosen-type');
  });

  it('appears in the full result body', () => {
    const html = renderResultBody(
      withCounterfactual('javascript-repair'),
      caseLabCase('javascript-repair'),
    );

    expect(html).toContain('counterfactual-title');
    expect(html).toContain('loosen-type');
  });

  it('escapes untrusted alternative text', () => {
    const html = renderCounterfactual(withCounterfactual('javascript-repair', {
      alternatives: [{
        ...COUNTERFACTUAL.alternatives[0]!,
        rationale: '<script>alert("cf")</script>',
        rejectedBy: {
          gate: 'mechanical' as const,
          rule: 'loosened-type',
          evidence: '<img src=x onerror=alert(1)>',
        },
      }],
    }).caseFile);

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('pages', () => {
  it('builds a titled, viewport-aware page with main attributes and a mode-labeled title', () => {
    const result = byId('greenwash-trap');
    const page = renderPage({
      title: resultPageTitle(result, caseLabCase('greenwash-trap')),
      description: 'x',
      siteRoot: '/',
      path: '/replay/greenwash-trap/',
      body: '<p>body</p>',
      attributes: { 'data-page': 'replay', 'data-site-root': '/' },
    });
    expect(page).toContain('<title>Greenwash trap · Recorded live result · Refused</title>');
    expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(page).toContain('<main id="main" class="case-lab" data-page="replay" data-site-root="/">');
    expect(page).not.toContain('<script');
    expect(page).not.toContain('rel="canonical"');
    expect(page).not.toContain('og:url');
    expect(page).not.toContain('name="robots"');
    expect(page).not.toContain('data-consent');
    expect(page).toContain('<meta property="og:image" content="/social-card.png">');
    expect(page).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    expect(page).toContain('<footer class="site-footer">Sutura verifies the fix. It never merges a generated repair. · <a href="/about/">About</a> · <a href="/privacy/">Privacy</a> · <a href="https://github.com/juan294/sutura" rel="noopener">Repository</a></footer>');
    const scripted = renderPage({ title: 't', description: 'd', siteRoot: '/x/', path: '/x/', body: '', script: 'case-lab.js', identifiers: {} });
    expect(scripted).toContain('<script src="/x/case-lab.js" defer></script>');
    expect(scripted).toContain('<a href="/x/about/">About</a> · <a href="/x/privacy/">Privacy</a>');
    expect(scripted.match(/<script/gu)).toHaveLength(1);
  });

  it('renders verification and consent-gated analytics from identifiers and escapes each value for its context', () => {
    const page = renderPage({
      title: 't', description: 'd', siteRoot: '/x/', path: '/x/', body: '',
      attributes: { 'data-page': 'index' },
      identifiers: {
        googleSiteVerification: 'g"><script>alert(1)</script>',
        bingSiteVerification: 'b&b',
        ga4MeasurementId: 'G-1"</script><script>alert(2)</script>',
        clarityProjectId: 'c</script>',
        vercelAnalytics: true,
      },
    });
    expect(page).toContain('<meta name="google-site-verification" content="g&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">');
    expect(page).toContain('<meta name="msvalidate.01" content="b&amp;b">');
    expect(page).not.toContain('</script><script>alert(');
    expect(page).toContain('<script async src="https://www.googletagmanager.com/gtag/js?id=G-1%22%3C%2Fscript%3E%3Cscript%3Ealert(2)%3C%2Fscript%3E"></script>');
    expect(page).toContain('gtag(\'config\', "G-1\\"\\u003c/script>\\u003cscript>alert(2)\\u003c/script>", {\'anonymize_ip\': true});');
    expect(page).toContain('\'clarity\', \'script\', "c\\u003c/script>");window.clarity(\'consent\', false);');
    expect(page).toContain('<script defer src="/x/_vercel/insights/script.js"></script>');
    expect(page).toContain('<main id="main" class="case-lab" data-page="index" data-consent="ga4,clarity">');
    const consentDefault = page.indexOf("gtag('consent', 'default'");
    expect(consentDefault).toBeGreaterThan(page.indexOf('<link rel="stylesheet"'));
    expect(page.indexOf('gtag/js?id=')).toBeGreaterThan(consentDefault);
    expect(page.indexOf("gtag('config'")).toBeGreaterThan(page.indexOf('gtag/js?id='));
    expect(page.indexOf("window.clarity('consent', false)")).toBeGreaterThan(page.indexOf("gtag('config'"));
    expect(page).not.toContain('granted');
    const clarityOnly = renderPage({ title: 't', description: 'd', siteRoot: '/', path: '/', body: '', identifiers: { clarityProjectId: 'abc' } });
    expect(clarityOnly).toContain('data-consent="clarity"');
    expect(clarityOnly).not.toContain('gtag');
    expect(clarityOnly).not.toContain('_vercel');
    const vercelOnly = renderPage({ title: 't', description: 'd', siteRoot: '/', path: '/', body: '', identifiers: { vercelAnalytics: true } });
    expect(vercelOnly).not.toContain('data-consent');
    expect(vercelOnly).toContain('/_vercel/insights/script.js');
    expect(renderPage({ title: 't', description: 'd', siteRoot: '/', path: '/', body: '', identifiers: { vercelAnalytics: false } })).not.toContain('_vercel');
  });

  it('renders a privacy page that names only the configured tools', () => {
    const none = renderPrivacyBody(undefined);
    expect(none).toContain('<h1>Privacy</h1>');
    expect(none).toContain('This build of the Case Lab carries no analytics. Nothing is measured.');
    expect(none).not.toContain('consent-title');
    expect(none).toContain('How to withdraw');
    const clarity = renderPrivacyBody({ clarityProjectId: 'abc', vercelAnalytics: true });
    expect(clarity).toContain('<dt>Microsoft Clarity</dt>');
    expect(clarity).toContain('<dt>Vercel Web Analytics</dt>');
    expect(clarity).not.toContain('Google Analytics');
    expect(clarity).toContain('Microsoft Clarity does not set a cookie or record anything identifying before you choose Accept in the banner at the bottom of the page. Choose Decline to keep it off.');
    expect(consentTools({ ga4MeasurementId: 'G-1', clarityProjectId: 'c' })).toEqual(['ga4', 'clarity']);
    expect(consentTools({ vercelAnalytics: true })).toEqual([]);
    expect(cookielessIdentifiers({ ga4MeasurementId: 'G-1', clarityProjectId: 'c', vercelAnalytics: true, googleSiteVerification: 'g' }))
      .toEqual({ vercelAnalytics: true, googleSiteVerification: 'g' });
  });

  it('emits canonical, social, robots, and escaped structured data when a site URL is known', () => {
    const page = renderPage({
      title: 'A "quoted" <title>',
      description: 'd & e',
      siteRoot: '/',
      path: '/result/',
      siteUrl: 'https://example.test',
      robots: 'noindex',
      ogType: 'article',
      body: '',
      jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: '</script><script>alert(1)</script>' }],
    });
    expect(page).toContain('<link rel="canonical" href="https://example.test/result/">');
    expect(page).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(page).toContain('<meta property="og:type" content="article">');
    expect(page).toContain('<meta property="og:title" content="A &quot;quoted&quot; &lt;title&gt;">');
    expect(page).toContain('<meta property="og:url" content="https://example.test/result/">');
    expect(page).toContain('<meta property="og:image" content="https://example.test/social-card.png">');
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(page).toContain('<meta name="twitter:description" content="d &amp; e">');
    expect(page).toContain('<meta name="theme-color" media="(prefers-color-scheme: light)" content="#fbfbf9">');
    expect(page).not.toContain('</script><script>alert(1)');
    const block = /<script type="application\/ld\+json">(.*?)<\/script>/u.exec(page)?.[1];
    expect(block).toContain('\\u003c/script>');
    expect(JSON.parse(block ?? '')).toEqual({ '@context': 'https://schema.org', '@type': 'WebPage', name: '</script><script>alert(1)</script>' });
  });

  it('renders the index with five cards and the three labels', () => {
    const html = renderIndexBody({
      cards: catalog.map((result) => ({ item: caseLabCase(result.caseId), result })),
      release: { version: '0.2.0', actionSha: 'a'.repeat(40) },
      siteRoot: '/',
      limits: { maxRunsPerHour: 4, maxRunsPerDay: 8, maxConcurrentRuns: 1 },
    });
    for (const result of catalog) expect(html).toContain(`href="/replay/${result.caseId}/"`);
    expect(html.match(/button-live/gu)).toHaveLength(5);
    expect(html).toContain('disabled>Start live run');
    for (const label of Object.values(MODE_LABELS)) expect(html).toContain(`<dt>${label}</dt>`);
    expect(html).toContain('Release v0.2.0');
    expect(html).toContain('<p><a href="/about/">How Sutura verifies a repair</a>: ');
    expect(html.indexOf('href="/about/"')).toBeLessThan(html.indexOf('</header>'));
  });

  it('renders the replay page links against the site root', () => {
    expect(renderPageLinks('/x/')).toBe('<nav class="page-links" aria-label="More"><a href="/x/">Back to cases</a> · <a href="/x/about/">How Sutura verifies</a></nav>');
  });

  it('renders a pending live page', () => {
    const html = renderPendingBody({ requestId: 'cl-1788198872643-48b5c5d4', caseTitle: undefined, status: 'Waiting', runUrl: 'https://github.com/juan294/sutura-demo/actions/runs/1' });
    expect(html).toContain('Waiting');
    expect(html).toContain('Watch the workflow run on GitHub');
    expect(html).toContain(`>${MODE_LABELS.live}</span>`);
  });
});

describe('markdown subset', () => {
  it('renders headings at the three supported levels', () => {
    expect(renderMarkdown('# One\n\n## Two\n\n### Three', '/')).toBe('<h1>One</h1>\n<h2>Two</h2>\n<h3>Three</h3>');
  });

  it('joins consecutive lines into one paragraph and splits paragraphs on blank lines', () => {
    expect(renderMarkdown('first line\nsecond line\n\nnext', '/')).toBe('<p>first line second line</p>\n<p>next</p>');
  });

  it('renders ordered and unordered lists, one item per line', () => {
    expect(renderMarkdown('1. a\n2. b\n10. c', '/')).toBe('<ol>\n  <li>a</li>\n  <li>b</li>\n  <li>c</li>\n</ol>');
    expect(renderMarkdown('- a\n- b', '/')).toBe('<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>');
    expect(renderMarkdown('- a\n1. b', '/')).toBe('<ul>\n  <li>a</li>\n</ul>\n<ol>\n  <li>b</li>\n</ol>');
  });

  it('renders a table with a header row inside a scroll container', () => {
    const html = renderMarkdown('| Service | Role |\n| --- | :-: |\n| Nano | classifies `x` |\n| Ultra | audits |', '/');
    expect(html).toBe('<div class="scroll"><table><thead><tr><th scope="col">Service</th><th scope="col">Role</th></tr></thead><tbody>\n'
      + '<tr><td>Nano</td><td>classifies <code>x</code></td></tr>\n<tr><td>Ultra</td><td>audits</td></tr>\n</tbody></table></div>');
    expect(() => renderMarkdown('| a | b |\n| 1 | 2 |', '/')).toThrow('markdown line 1 starts a table without a header separator row: | a | b |');
    expect(() => renderMarkdown('| a | b |\n| --- | --- |\n| only one |', '/')).toThrow('markdown line 3 has 1 cells, expected 2: | only one |');
  });

  it('renders code spans, bold, and links, and escapes everything', () => {
    expect(renderInlineMarkdown('run `a <b> & c` now', '/')).toBe('run <code>a &lt;b&gt; &amp; c</code> now');
    expect(renderInlineMarkdown('**bold & <strong>** text', '/')).toBe('<strong>bold &amp; &lt;strong&gt;</strong> text');
    expect(renderInlineMarkdown('[Repo "x"](https://github.com/juan294/sutura)', '/')).toBe('<a href="https://github.com/juan294/sutura" rel="noopener">Repo &quot;x&quot;</a>');
    expect(renderInlineMarkdown('[raw](https://raw.githubusercontent.com/juan294/sutura/main/README.md)', '/'))
      .toBe('<a href="https://raw.githubusercontent.com/juan294/sutura/main/README.md" rel="noopener">raw</a>');
    expect(renderInlineMarkdown('[case](/replay/greenwash-trap/)', '/x/')).toBe('<a href="/x/replay/greenwash-trap/">case</a>');
    expect(renderInlineMarkdown('`[not a link](/x/)` and **`code`**', '/')).toBe('<code>[not a link](/x/)</code> and <strong>`code`</strong>');
    expect(renderInlineMarkdown('<script>alert(1)</script>', '/')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes adversarial unmatched link markup in bounded time', () => {
    const source = `[${'[\\'.repeat(50_000)}`;
    const startedAt = performance.now();
    expect(renderInlineMarkdown(source, '/')).toBe(escapeHtml(source));
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it('refuses every link outside the two GitHub hosts and site-relative paths, naming the URL', () => {
    for (const url of [
      'https://example.com/',
      'http://github.com/juan294/sutura',
      'https://github.com.evil.test/',
      'https://github.com',
      'https://github.com/juan294/sutura#readme',
      'https://user:pw@github.com/juan294/sutura',
      'javascript:alert(1)',
      '//evil.test/',
      'replay/x/',
      '/replay/"x/',
    ]) {
      expect(() => markdownHref(url, '/'), url).toThrow(`markdown link is not allowed: ${JSON.stringify(url)}`);
      expect(() => renderMarkdown(`see [here](${url})`, '/'), url).toThrow('markdown link is not allowed');
    }
    expect(() => markdownHref('', '/')).toThrow('markdown link is not allowed: ""');
    expect(markdownHref('/replay/flaky-failure/', '/')).toBe('/replay/flaky-failure/');
  });

  it('refuses constructs outside the subset with the line number', () => {
    expect(() => renderMarkdown('ok\n\n```js\nx\n```', '/')).toThrow('markdown line 3 uses a construct outside the subset: ```js');
    expect(() => renderMarkdown('> quote', '/')).toThrow('markdown line 1 uses a construct outside the subset: > quote');
    expect(() => renderMarkdown('<div>raw</div>', '/')).toThrow('markdown line 1');
    expect(() => renderMarkdown('#### four', '/')).toThrow('markdown line 1');
    expect(() => renderMarkdown('![alt](/x.png)', '/')).toThrow('markdown line 1');
    expect(() => renderMarkdown('* star item', '/')).toThrow('markdown line 1');
    expect(() => renderMarkdown('    indented code', '/')).toThrow('markdown line 1');
    expect(() => renderMarkdown('a\n---', '/')).toThrow('markdown line 2');
  });

  it('renders the about body with the docket header, the prose, and a link back to the cases', () => {
    const html = renderAboutBody('## How it works\n\n1. step\n\n[refusal](/replay/greenwash-trap/)', '/x/');
    expect(html).toContain(`<h1>${ABOUT_TITLE}</h1>`);
    expect(html).toContain(`<p>${ABOUT_DESCRIPTION}</p>`);
    expect(html).toContain('<article class="prose">\n<h2>How it works</h2>\n<ol>\n  <li>step</li>\n</ol>\n<p><a href="/x/replay/greenwash-trap/">refusal</a></p>\n</article>');
    expect(html).toContain('<nav class="page-links" aria-label="More"><a href="/x/">Back to cases</a></nav>');
    expect(html).not.toContain('/x/about/');
  });
});

describe('isRenderableResult', () => {
  it('accepts a real result and rejects malformed input', () => {
    const ids = catalog.map((item) => item.caseId);
    expect(isRenderableResult(JSON.parse(JSON.stringify(byId('flaky-failure'))), ids)).toBe(true);
    expect(isRenderableResult(null, ids)).toBe(false);
    expect(isRenderableResult({ ...byId('flaky-failure'), caseId: 'other' }, ids)).toBe(false);
    expect(isRenderableResult({ ...byId('flaky-failure'), outcome: 'green' }, ids)).toBe(false);
    expect(isRenderableResult({ ...byId('flaky-failure'), mode: 'fake' }, ids)).toBe(false);
  });
});

it('shows bounded recovery grants and separately records executed commands with escaped text', () => {
  const original = byId('javascript-repair');
  const recovery = JSON.parse(readFileSync(new URL('../../core/src/verification/__fixtures__/recovery.json', import.meta.url), 'utf8')) as DiagnosisRecoveryEvidence;
  recovery.executedCommand = 'node normalized-runner.js';
  recovery.hypotheses[1]!.reason = '<script>forged markup</script>';
  const result = { ...original, caseFile: { ...original.caseFile!, recovery } };
  const html = renderResultBody(result, caseLabCase('javascript-repair'));
  expect(html).toContain('Diagnosis recovery');
  expect(html).toContain('Initial diagnosis retained: typecheck');
  expect(html).toContain('test-bug'); expect(html).toContain('Controller grant: await-operation');
  expect(html).toContain('test/async.test.ts'); expect(html).toContain('node normalized-runner.js');
  expect(html).toContain('&lt;script&gt;forged markup&lt;/script&gt;');
  expect(html).not.toContain('<script>forged markup</script>');
  expect(html).toContain('do not measure live repair quality');
  expect(renderResultBody(original, caseLabCase('javascript-repair'))).not.toContain('Diagnosis recovery');
});
