/// <reference lib="dom" />
/**
 * Case Lab browser behaviour: live dispatch on the index page, live result
 * lookup on the result page, and the consent banner on every page that carries
 * a consent-gated tracker. Everything it renders goes through the escaping
 * renderer; it never inserts unescaped input.
 *
 * `client.ts` is the bundle entry and runs `main` on load. This module runs
 * nothing on import, so a test can build a document first and then call one
 * function against it.
 */
import { CASE_LAB_CASES, CASE_LAB_CASE_IDS, type CaseLabCase } from './cases.js';
import {
  CONSENT_STORAGE_KEY,
  PRIVACY_PATH,
  PRIVACY_TITLE,
  isRenderableResult,
  LIVE_REQUEST_ID,
  renderPendingBody,
  renderResultBody,
  resultPageTitle,
  type ConsentTool,
} from './render.js';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    clarity?: (...args: unknown[]) => void;
  }
}

const RESULTS_BASE = 'https://raw.githubusercontent.com/juan294/sutura-demo/case-lab-results/results/';
const RUNS_API = 'https://api.github.com/repos/juan294/sutura-demo/actions/workflows/case-lab.yml/runs?per_page=30';
const POLL_MS = 15_000;
const MAX_POLLS = 200;

interface RunSummary {
  display_title?: unknown;
  status?: unknown;
  conclusion?: unknown;
  html_url?: unknown;
}

function caseById(id: string): CaseLabCase | undefined {
  return CASE_LAB_CASES.find((item) => item.id === id);
}

function setStatus(text: string): void {
  const status = document.getElementById('live-status');
  if (status) status.textContent = text;
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

export async function enableLiveButtons(apiBase: string): Promise<void> {
  try {
    const health = await fetchJson(`${apiBase}/api/health`);
    const enabled = health.status === 200 && typeof health.body === 'object' && health.body !== null
      && (health.body as { enabled?: unknown }).enabled === true;
    if (!enabled) {
      setStatus('Live runs are disabled right now. Every case has a deterministic result you can open.');
      return;
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('button.button-live')) {
      button.disabled = false;
      button.addEventListener('click', () => {
        void startLiveRun(apiBase, button.dataset.caseId ?? '', button);
      });
    }
    setStatus('Live runs are enabled. Each start dispatches one real Sutura run in the public demo repository.');
  } catch {
    setStatus('Live runs are unavailable right now. Every case has a deterministic result you can open.');
  }
}

export async function startLiveRun(apiBase: string, caseId: string, button: HTMLButtonElement): Promise<void> {
  if (!(CASE_LAB_CASE_IDS as readonly string[]).includes(caseId)) return;
  button.disabled = true;
  setStatus(`Starting ${caseById(caseId)?.title ?? caseId}…`);
  try {
    const { status, body } = await fetchJson(`${apiBase}/api/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId }),
    });
    const response = (body ?? {}) as { requestId?: unknown; resultPath?: unknown; error?: unknown; retryAfterSeconds?: unknown };
    if (status === 202 && typeof response.requestId === 'string' && LIVE_REQUEST_ID.test(response.requestId)) {
      window.location.assign(`${siteRoot()}result/?id=${encodeURIComponent(response.requestId)}`);
      return;
    }
    const reason = typeof response.error === 'string' ? response.error : `HTTP ${status}`;
    const retry = typeof response.retryAfterSeconds === 'number' ? ` Try again in about ${Math.ceil(response.retryAfterSeconds / 60)} minutes.` : '';
    setStatus(`Live run refused: ${reason}.${retry} The deterministic result stays available.`);
  } catch {
    setStatus('Live run could not be started. The deterministic result stays available.');
  } finally {
    button.disabled = false;
  }
}

function siteRoot(): string {
  return document.querySelector('main')?.dataset.siteRoot ?? '/';
}

/** Returns true once the final result has been rendered. */
async function loadLiveResult(requestId: string, main: HTMLElement): Promise<boolean> {
  let fetched: { status: number; body: unknown };
  try {
    fetched = await fetchJson(`${RESULTS_BASE}${requestId}.json`);
  } catch {
    return false;
  }
  if (fetched.status !== 200) return false;
  const { body } = fetched;
  if (!isRenderableResult(body, CASE_LAB_CASE_IDS) || body.requestId !== requestId || body.mode !== 'live') {
    setStatus('A result was published but it is not a valid live Case Lab result for this request.');
    return false;
  }
  const item = caseById(body.caseId);
  if (!item) return false;
  main.innerHTML = renderResultBody(body, item);
  document.title = resultPageTitle(body, item);
  return true;
}

async function pollRun(requestId: string, main: HTMLElement): Promise<void> {
  let runUrl: string | undefined;
  let caseTitle: string | undefined;
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    if (await loadLiveResult(requestId, main)) return;
    let statusText = 'Waiting for the workflow to publish the result…';
    try {
      const { status, body } = await fetchJson(RUNS_API);
      const runs = status === 200 && body !== null && typeof body === 'object'
        ? ((body as { workflow_runs?: unknown }).workflow_runs as RunSummary[] | undefined) ?? []
        : [];
      const run = runs.find((candidate) => typeof candidate.display_title === 'string'
        && candidate.display_title.startsWith(`Case Lab ${requestId} `));
      if (run) {
        const title = String(run.display_title);
        const caseId = title.slice(`Case Lab ${requestId} `.length);
        caseTitle = caseById(caseId)?.title;
        runUrl = typeof run.html_url === 'string' ? run.html_url : undefined;
        const conclusion = typeof run.conclusion === 'string' ? run.conclusion : null;
        statusText = run.status === 'completed'
          ? `The workflow completed (${conclusion ?? 'unknown'}). Waiting for the published result…`
          : `The workflow is ${String(run.status)}. Sutura reproduces the failure, searches repairs, and audits the survivor. This usually takes a few minutes.`;
      } else if (attempt === 0) {
        statusText = 'The run was requested. Waiting for GitHub to start the workflow…';
      }
    } catch {
      statusText = 'Waiting for GitHub…';
    }
    main.innerHTML = renderPendingBody({
      requestId, caseTitle, status: statusText,
      ...(runUrl === undefined ? {} : { runUrl }),
    });
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  setStatus('Stopped waiting. Refresh this page later; the address stays valid.');
}

type ConsentChoice = 'granted' | 'denied';

const TOOL_NAMES: Readonly<Record<ConsentTool, string>> = Object.freeze({ ga4: 'Google Analytics', clarity: 'Microsoft Clarity' });

function storedConsent(): ConsentChoice | undefined {
  try {
    const value = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    return value === 'granted' || value === 'denied' ? value : undefined;
  } catch {
    return undefined;
  }
}

function storeConsent(choice: ConsentChoice): void {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    // Storage can be unavailable; the choice then lasts for this page only.
  }
}

/** Upgrade the consent defaults declared in the head. Only analytics storage is ever granted. */
function grantConsent(tools: readonly ConsentTool[]): void {
  if (tools.includes('ga4')) window.gtag?.('consent', 'update', { analytics_storage: 'granted' });
  if (tools.includes('clarity')) window.clarity?.('consent');
}

function consentButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function renderConsentBanner(tools: readonly ConsentTool[]): void {
  const banner = document.createElement('aside');
  banner.className = 'consent';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Cookie consent');
  const text = document.createElement('p');
  text.textContent = `This site uses ${tools.map((tool) => TOOL_NAMES[tool]).join(' and ')} to count visits and see how the Case Lab is used. Nothing is stored before you accept.`;
  const actions = document.createElement('p');
  actions.className = 'actions';
  const close = (choice: ConsentChoice): void => {
    storeConsent(choice);
    if (choice === 'granted') grantConsent(tools);
    banner.remove();
  };
  const privacy = document.createElement('a');
  privacy.href = `${siteRoot()}${PRIVACY_PATH}`;
  privacy.textContent = PRIVACY_TITLE;
  actions.append(consentButton('Accept', () => close('granted')), consentButton('Decline', () => close('denied')), privacy);
  banner.append(text, actions);
  document.body.append(banner);
}

/** Runs on every page that carries a consent-gated tracker; no-op elsewhere. */
export function setupConsent(root: HTMLElement): void {
  const tools = (root.dataset.consent ?? '').split(',').filter((tool): tool is ConsentTool => tool === 'ga4' || tool === 'clarity');
  if (tools.length === 0) return;
  const stored = storedConsent();
  if (stored === 'granted') {
    grantConsent(tools);
    return;
  }
  if (stored === undefined) renderConsentBanner(tools);
}

export function main(): void {
  const root = document.querySelector('main');
  if (!root) return;
  setupConsent(root);
  const page = root.dataset.page;
  const apiBase = root.dataset.apiBase;
  if (page === 'index') {
    if (apiBase === undefined) {
      setStatus('Live runs are not configured for this build. Every case has a deterministic result you can open.');
      return;
    }
    void enableLiveButtons(apiBase);
    return;
  }
  if (page === 'result') {
    const requestId = new URLSearchParams(window.location.search).get('id') ?? '';
    if (!LIVE_REQUEST_ID.test(requestId)) {
      root.innerHTML = renderPendingBody({ requestId: 'unknown', caseTitle: undefined, status: 'Unknown result id. A live result address looks like /result/?id=cl-<digits>-<hex>.' });
      return;
    }
    void pollRun(requestId, root);
  }
}
