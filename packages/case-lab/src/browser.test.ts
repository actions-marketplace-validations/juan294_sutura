/**
 * Browser interaction tests. These run the real page markup and the real
 * browser module in jsdom: the disclosure, the tab order, the live status
 * region, the readiness and quota transitions, and the consent banner.
 *
 * Layout itself is not simulated. Where a rule only holds visually, the test
 * asserts the stylesheet carries the rule and the measured values are recorded
 * in docs/demo/case-lab/README.md.
 */
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { JSDOM } from 'jsdom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { caseLabCase } from './cases.js';
import { replayCatalog } from './replay.js';
import { EXECUTION_DETAIL_SUMMARY, renderIndexBody, renderPage, renderResultBody } from './render.js';
import type { CaseLabResult } from './result.js';

const CSS = readFileSync(new URL('../assets/case-lab.css', import.meta.url), 'utf8');
const EMPTY_REPLAY_DIR = mkdtempSync(join(tmpdir(), 'case-lab-browser-'));
const LIMITS = { maxRunsPerHour: 4, maxRunsPerDay: 12, maxConcurrentRuns: 1 };

let catalog: CaseLabResult[] = [];

beforeAll(async () => {
  catalog = await replayCatalog({ replayDir: EMPTY_REPLAY_DIR, now: () => new Date('2026-09-06T12:00:00.000Z') });
}, 60_000);

function byId(caseId: string): CaseLabResult {
  const result = catalog.find((item) => item.caseId === caseId);
  if (!result) throw new Error(caseId);
  return result;
}

interface Mounted {
  dom: JSDOM;
  document: Document;
  restore: () => void;
}

/**
 * Mounts a page in jsdom and publishes its window as the globals the browser
 * module reads. The module takes `document`, `window` and `fetch` from the
 * global scope at call time, exactly as it does in a browser.
 */
function mount(html: string): Mounted {
  const dom = new JSDOM(html, { url: 'https://example.test/', pretendToBeVisual: true });
  const saved = {
    window: Reflect.get(globalThis, 'window'),
    document: Reflect.get(globalThis, 'document'),
    fetch: globalThis.fetch,
  };
  Reflect.set(globalThis, 'window', dom.window);
  Reflect.set(globalThis, 'document', dom.window.document);
  return {
    dom,
    document: dom.window.document as unknown as Document,
    restore: () => {
      Reflect.set(globalThis, 'window', saved.window);
      Reflect.set(globalThis, 'document', saved.document);
      globalThis.fetch = saved.fetch;
      dom.window.close();
    },
  };
}

let mounted: Mounted | undefined;

function page(body: string, attributes: Record<string, string>): Mounted {
  mounted = mount(renderPage({
    title: 'Case Lab', siteRoot: '/', path: '/', body, description: 'd', attributes,
  }));
  return mounted;
}

function resultPage(caseId: string): Mounted {
  return page(renderResultBody(byId(caseId), caseLabCase(caseId)), { 'data-page': 'replay' });
}

function indexPage(attributes: Record<string, string>): Mounted {
  const cards = catalog.map((result) => ({ item: caseLabCase(result.caseId), result }));
  return page(renderIndexBody({
    cards, release: { version: '0.2.1', actionSha: 'a'.repeat(40) }, siteRoot: '/', limits: LIMITS,
  }), attributes);
}

/** Replies in the order given; an extra call throws so an unexpected request is visible. */
function stubFetch(replies: readonly ({ status: number; body: unknown } | Error)[]): () => number {
  let calls = 0;
  globalThis.fetch = vi.fn(async () => {
    const reply = replies[calls];
    calls += 1;
    if (reply === undefined) throw new Error(`unexpected fetch call ${calls}`);
    if (reply instanceof Error) throw reply;
    return {
      status: reply.status,
      json: async () => reply.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return () => calls;
}

function statusText(document: Document): string {
  return document.getElementById('live-status')?.textContent ?? '';
}

afterEach(() => {
  mounted?.restore();
  mounted = undefined;
  vi.restoreAllMocks();
});

describe('result page disclosure', () => {
  it('leads with the verdict and keeps every execution internal below it', () => {
    const { dom, document } = resultPage('greenwash-trap');
    const main = document.querySelector('main')!;
    const verdict = main.querySelector('.verdict')!;
    const details = main.querySelector('details.execution')!;

    expect(verdict.compareDocumentPosition(details) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(details.hasAttribute('open')).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe(EXECUTION_DETAIL_SUMMARY);
    for (const selector of ['.identity', '[aria-labelledby="search-title"]', '[aria-labelledby="cost-title"]', '.hash']) {
      expect(details.querySelector(selector), selector).not.toBeNull();
      expect(main.querySelector(`.verdict ${selector}`), selector).toBeNull();
    }
  });

  it('keeps the hidden detail in the document, so it is searchable and readable without scripting', () => {
    const result = byId('greenwash-trap');
    const { document } = resultPage('greenwash-trap');
    const details = document.querySelector('details.execution')!;

    expect(details.hasAttribute('open')).toBe(false);
    expect(document.body.textContent).toContain(result.resultHash);
    expect(document.body.textContent).toContain(result.identity.controllerSha);
  });

  it('opens the detail from the keyboard and reveals the same nodes', () => {
    const { dom, document } = resultPage('greenwash-trap');
    const details = document.querySelector('details.execution')!;
    const summary = details.querySelector('summary')!;

    expect((summary as HTMLElement).tabIndex).toBe(0);
    summary.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(details.hasAttribute('open')).toBe(true);
    expect(details.querySelector('.identity')).not.toBeNull();
  });

  it('takes nothing out of the tab order and gives every link a destination', () => {
    const { document } = resultPage('javascript-repair');

    expect(document.querySelectorAll('[tabindex]')).toHaveLength(0);
    for (const anchor of document.querySelectorAll('a')) {
      expect(anchor.getAttribute('href'), anchor.textContent ?? '').toBeTruthy();
    }
    expect(document.querySelector('main')?.id).toBe('main');
  });

  it('shows the verify route as placeholders when the run recorded no exact commit', () => {
    const result = byId('greenwash-trap');
    expect(result.caseFile?.policy.baseSha).toBe('local');
    const { document } = resultPage('greenwash-trap');
    const verify = document.querySelector('[aria-labelledby="verify-title"]')!;
    const command = verify.querySelector('pre.command')!.textContent ?? '';

    expect(command).toContain('sutura verify');
    expect(command).toContain('--failing-command diagnosed');
    expect(command).toContain('--source-sha <failing commit>');
    expect(command).toContain('--policy-base-sha <trusted policy commit>');
    expect(command).not.toContain('local');
    expect(verify.textContent).toContain('did not record an exact failing commit');
    expect(verify.textContent).toContain('no green log is accepted in place of execution');
  });

  it('fills the verify command from the run\u2019s own commits when it recorded them', () => {
    const base = byId('greenwash-trap');
    const sourceSha = 'b'.repeat(40);
    const policyBaseSha = 'c'.repeat(40);
    const withCommits = {
      ...base,
      identity: { ...base.identity, demoSha: sourceSha },
      caseFile: { ...base.caseFile!, policy: { ...base.caseFile!.policy, baseSha: policyBaseSha } },
    } as unknown as CaseLabResult;
    mounted = mount(renderPage({
      title: 'Case Lab', siteRoot: '/', path: '/', description: 'd', attributes: { 'data-page': 'replay' },
      body: renderResultBody(withCommits, caseLabCase('greenwash-trap')),
    }));
    const command = mounted.document.querySelector('pre.command')!.textContent ?? '';

    expect(command).toContain(`--source-sha ${sourceSha}`);
    expect(command).toContain(`--policy-base-sha ${policyBaseSha}`);
    expect(command).not.toContain('<failing commit>');
  });
});

describe('live controls', () => {
  it('starts disabled and stays disabled when the service says live runs are off', async () => {
    const { document } = indexPage({ 'data-page': 'index', 'data-api-base': 'https://api.test' });
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button.button-live')];
    expect(buttons.every((button) => button.disabled)).toBe(true);
    stubFetch([{ status: 200, body: { enabled: false } }]);

    const { enableLiveButtons } = await import('./client-app.js');
    await enableLiveButtons('https://api.test');

    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(statusText(document)).toContain('Live runs are disabled right now');
    expect(statusText(document)).toContain('deterministic result');
  });

  it('enables the buttons only after the service confirms it is ready', async () => {
    const { document } = indexPage({ 'data-page': 'index', 'data-api-base': 'https://api.test' });
    stubFetch([{ status: 200, body: { enabled: true } }]);

    const { enableLiveButtons } = await import('./client-app.js');
    await enableLiveButtons('https://api.test');

    expect([...document.querySelectorAll<HTMLButtonElement>('button.button-live')].every((button) => !button.disabled))
      .toBe(true);
    expect(statusText(document)).toContain('Live runs are enabled');
    expect(statusText(document)).toContain('one real Sutura run');
  });

  it('offers the recorded alternative when the service cannot be reached', async () => {
    const { document } = indexPage({ 'data-page': 'index', 'data-api-base': 'https://api.test' });
    stubFetch([new Error('network down')]);

    const { enableLiveButtons } = await import('./client-app.js');
    await enableLiveButtons('https://api.test');

    expect([...document.querySelectorAll<HTMLButtonElement>('button.button-live')].every((button) => button.disabled))
      .toBe(true);
    expect(statusText(document)).toContain('Live runs are unavailable right now');
  });

  it('says live runs are not configured when the build carries no dispatcher', async () => {
    const { document } = indexPage({ 'data-page': 'index' });
    const calls = stubFetch([]);

    const { main } = await import('./client-app.js');
    main();

    expect(statusText(document)).toContain('not configured for this build');
    expect(calls()).toBe(0);
  });

  it('explains a quota refusal with the wait and gives the button back', async () => {
    const { document } = indexPage({ 'data-page': 'index', 'data-api-base': 'https://api.test' });
    const button = document.querySelector<HTMLButtonElement>('button.button-live')!;
    stubFetch([{ status: 429, body: { error: 'hourly limit reached', retryAfterSeconds: 264 } }]);

    const { startLiveRun } = await import('./client-app.js');
    await startLiveRun('https://api.test', button.dataset.caseId ?? '', button);

    expect(statusText(document)).toContain('Live run refused: hourly limit reached');
    expect(statusText(document)).toContain('Try again in about 5 minutes');
    expect(statusText(document)).toContain('The deterministic result stays available');
    expect(button.disabled).toBe(false);
  });

  it('refuses a case id the catalog does not define, without any request', async () => {
    const { document } = indexPage({ 'data-page': 'index', 'data-api-base': 'https://api.test' });
    const button = document.querySelector<HTMLButtonElement>('button.button-live')!;
    const calls = stubFetch([]);

    const { startLiveRun } = await import('./client-app.js');
    await startLiveRun('https://api.test', 'not-a-case', button);

    expect(calls()).toBe(0);
    expect(statusText(document)).toBe('');
  });

  it('announces every transition through one polite status region', async () => {
    const { document } = indexPage({ 'data-page': 'index', 'data-api-base': 'https://api.test' });
    const status = document.getElementById('live-status')!;

    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
  });
});

describe('consent banner', () => {
  it('asks before any tracker stores anything, and remembers the answer', async () => {
    const { dom, document } = indexPage({ 'data-page': 'index', 'data-consent': 'ga4,clarity' });
    const granted: unknown[][] = [];
    Reflect.set(dom.window, 'gtag', (...args: unknown[]) => granted.push(args));

    const { setupConsent } = await import('./client-app.js');
    setupConsent(document.querySelector('main')!);

    const banner = document.querySelector('aside.consent')!;
    expect(banner.getAttribute('role')).toBe('region');
    expect(banner.getAttribute('aria-label')).toBe('Cookie consent');
    expect(banner.textContent).toContain('Nothing is stored before you accept');
    expect(granted).toHaveLength(0);

    const accept = [...banner.querySelectorAll('button')].find((button) => button.textContent === 'Accept')!;
    accept.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    expect(document.querySelector('aside.consent')).toBeNull();
    expect(dom.window.localStorage.getItem('sutura-consent')).toBe('granted');
    expect(granted[0]).toEqual(['consent', 'update', { analytics_storage: 'granted' }]);
  });

  it('keeps the trackers off when the visitor declines, and does not ask again', async () => {
    const { dom, document } = indexPage({ 'data-page': 'index', 'data-consent': 'ga4' });
    const calls: unknown[][] = [];
    Reflect.set(dom.window, 'gtag', (...args: unknown[]) => calls.push(args));

    const { setupConsent } = await import('./client-app.js');
    const root = document.querySelector('main')!;
    setupConsent(root);
    const decline = [...document.querySelectorAll('aside.consent button')]
      .find((button) => button.textContent === 'Decline')!;
    decline.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    expect(dom.window.localStorage.getItem('sutura-consent')).toBe('denied');
    setupConsent(root);
    expect(document.querySelector('aside.consent')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('renders no banner on a page that carries no tracker', async () => {
    const { document } = indexPage({ 'data-page': 'index' });

    const { setupConsent } = await import('./client-app.js');
    setupConsent(document.querySelector('main')!);

    expect(document.querySelector('aside.consent')).toBeNull();
  });
});

/**
 * jsdom does not lay a page out, so these assert the rules the measured narrow
 * layout depends on. The measurements themselves are in
 * docs/demo/case-lab/README.md, taken in Chrome at 375 x 812 and 1440 x 1000.
 */
describe('responsive stylesheet', () => {
  it('carries the narrow breakpoint and keeps the fixed consent banner short there', () => {
    const narrow = CSS.slice(CSS.indexOf('@media (max-width: 719px)'));
    expect(CSS).toContain('@media (max-width: 719px)');
    expect(narrow).toContain('.consent .actions .button');
    expect(narrow.slice(narrow.indexOf('.consent .actions .button'))).toContain('width: auto');
  });

  it('wraps the unbroken subject hash and scrolls a wide table inside its own container', () => {
    const evidence = CSS.slice(CSS.indexOf('.verdict-evidence {'));
    expect(evidence.slice(0, evidence.indexOf('}'))).toContain('overflow-wrap: anywhere');
    const scroll = CSS.slice(CSS.indexOf('.scroll {'));
    expect(scroll.slice(0, scroll.indexOf('}'))).toContain('overflow-x: auto');
  });
});

describe('verify route link', () => {
  it('renders the Action setup link as a real link, not as withheld text', () => {
    const { document } = resultPage('greenwash-trap');
    const verify = document.querySelector('[aria-labelledby="verify-title"]')!;
    const anchor = verify.querySelector('a')!;

    expect(anchor.getAttribute('href')).toBe('https://github.com/juan294/sutura/blob/main/README.md');
    expect(verify.textContent).not.toContain('link withheld');
  });
});
