/**
 * Pure HTML rendering for the Case Lab. This module runs in Node (site
 * generation) and in the browser (live result page), so it imports only
 * browser-safe helpers and types, and uses no Node API.
 */
import { recoverySummary } from '@sutura/core/recovery-summary';
import { escapeHtml } from './html.js';
import { renderVerdict } from './verdict.js';
import { expectedOutcomeFor, touchesTests, type CaseLabCase, type CaseLabOutcome } from './cases.js';
import { MODES, MODE_LABELS, OUTCOME_LABELS, isPublicHttpsUrl, type CaseLabMode } from './labels.js';
import type {
  CaseLabCaseFile,
  CaseLabCounterfactual,
  CaseLabCounterfactualAlternative,
  CaseLabResult,
  CaseLabResultLinks,
} from './result.js';

export { LIVE_REQUEST_ID_PATTERN as LIVE_REQUEST_ID, MODE_LABELS, OUTCOME_LABELS } from './labels.js';

export { escapeHtml } from './html.js';

function usd(value: number | null): string {
  if (value === null) return 'unknown';
  return `USD ${value.toFixed(6)}`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function seconds(ms: number | undefined): string {
  return ms === undefined ? 'not recorded' : `${(ms / 1_000).toFixed(1)} s`;
}

function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

/** Only public https URLs become hrefs; anything else is rendered as inert text. */
export function safeHref(url: string): string | undefined {
  return isPublicHttpsUrl(url) ? escapeHtml(url) : undefined;
}

function anchor(url: string, label: string): string {
  const href = safeHref(url);
  return href === undefined
    ? `<span class="withheld">${escapeHtml(label)} (link withheld: not an https URL)</span>`
    : `<a href="${href}" rel="noopener">${escapeHtml(label)}</a>`;
}

function link(url: string | undefined, label: string, note?: string): string {
  if (url === undefined) return '';
  const suffix = note === undefined ? '' : ` <small>(${escapeHtml(note)})</small>`;
  return `<li>${anchor(url, label)}${suffix}</li>`;
}

function section(id: string, title: string, body: string): string {
  return `<section class="sheet" aria-labelledby="${id}-title">
  <h2 id="${id}-title">${escapeHtml(title)}</h2>
${body}
</section>`;
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const head = headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('\n');
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table></div>`;
}

function badge(kind: string, text: string): string {
  return `<span class="badge badge-${escapeHtml(kind)}">${escapeHtml(text)}</span>`;
}

export function modeBadge(mode: CaseLabMode): string {
  return badge(`mode-${mode}`, MODE_LABELS[mode]);
}

export function outcomeBadge(outcome: CaseLabOutcome): string {
  return badge(`outcome-${outcome}`, OUTCOME_LABELS[outcome]);
}

function intentBadge(intent: CaseLabCounterfactualAlternative['intent']): string {
  return badge(`intent-${intent}`, intent === 'shortcut' ? 'shortcut' : 'plausible');
}

/**
 * States why a green suite is not sufficient, from the recorded gates alone.
 * Never asserts a claim the evidence does not carry.
 */
export function counterfactualLede(evidence: CaseLabCounterfactual): string {
  const rejected = evidence.alternatives.filter((item) => !item.approved);
  if (rejected.length === 0) {
    return `All ${evidence.alternatives.length} alternatives passed the same gates as the accepted patch.`;
  }
  const gates = [...new Set(rejected.flatMap((item) => item.rejectedBy ? [item.rejectedBy.gate] : []))].sort();
  const shortcuts = rejected.filter((item) => item.intent === 'shortcut').length;
  const greenButRejected = rejected.filter(
    (item) => item.testExitCode === 0 && item.rejectedBy?.gate !== 'verification',
  ).length;
  return `${rejected.length} of ${evidence.alternatives.length} alternative patches were rejected`
    + `${shortcuts === 0 ? '' : `, including ${shortcuts} declared shortcut${shortcuts === 1 ? '' : 's'}`}`
    + `${gates.length === 0 ? '' : `, by ${gates.join(', ')}`}.`
    + `${greenButRejected === 0 ? '' : ` ${greenButRejected} of them made the diagnosed command exit 0 and were still refused.`}`;
}

/**
 * Shows the accepted or correctly refused outcome beside the rejected
 * alternatives, each with the exact gate and rule that rejected it. Renders
 * nothing when a case carries no counterfactual evidence.
 */
export function renderCounterfactual(caseFile: CaseLabCaseFile | undefined): string {
  const evidence = caseFile?.counterfactual;
  if (evidence === undefined || evidence.alternatives.length === 0) return '';

  const acceptedId = evidence.acceptedCandidateId ?? caseFile?.selectedCandidate?.id;
  const accepted = caseFile?.race.find((entry) => entry.candidate.id === acceptedId);
  const approvedByAudit = caseFile?.audit?.approved === true;
  const acceptedBody = accepted === undefined
    ? `<p class="empty">No candidate patch was accepted. ${
      caseFile?.audit?.approved === false
        ? escapeHtml(`The audit correctly refused this run: ${caseFile.audit.reasoning}`)
        : 'Sutura produced no patch for this run.'
    }</p>`
    : `<p>${escapeHtml(accepted.candidate.rationale)}</p>
<p>Test exit ${accepted.exitCode} · ${accepted.held ? 'held its result' : 'did not hold'}${
      caseFile?.audit === undefined
        ? ''
        : ` · audit ${caseFile.audit.approved ? 'approved' : 'refused'}`
    }</p>
<pre class="diff"><code>${escapeHtml(accepted.candidate.diff)}</code></pre>`;

  const alternatives = evidence.alternatives.map((item) => `<article class="counterfactual-alternative${item.approved ? '' : ' rejected'}">
  <h4><code>${escapeHtml(item.id)}</code> ${intentBadge(item.intent)}</h4>
  <p>${escapeHtml(item.rationale)}</p>
  <p>${item.approved ? 'Accepted by every gate' : `Rejected at <strong>${escapeHtml(item.rejectedBy?.gate ?? 'an unrecorded gate')}</strong> by rule <code>${escapeHtml(item.rejectedBy?.rule ?? 'unrecorded')}</code>`} · test exit ${item.testExitCode}</p>
  ${item.rejectedBy === undefined ? '' : `<p class="evidence">${escapeHtml(item.rejectedBy.evidence)}</p>`}
</article>`).join('\n');

  const totals = `<p class="counterfactual-cost">Comparing these alternatives added ${evidence.cost.sandboxOperations} sandbox operation${evidence.cost.sandboxOperations === 1 ? '' : 's'}, ${evidence.cost.elapsedTimeSec.toFixed(1)} s, and ${usd(evidence.cost.inferenceUsd)} of inference.</p>`;

  return section('counterfactual', 'Accepted patch beside rejected alternatives', `<p class="counterfactual-lede">${escapeHtml(counterfactualLede(evidence))}</p>
<div class="counterfactual">
  <div class="counterfactual-accepted">
    <h3>${approvedByAudit ? 'Accepted patch' : 'Outcome Sutura reached'}</h3>
${acceptedBody}
  </div>
  <div class="counterfactual-rejected">
    <h3>Rejected alternatives</h3>
${alternatives}
  </div>
</div>
${totals}`);
}

/**
 * What the evidence mode means and whether the outcome matched the case.
 *
 * Both qualify the verdict, so they read after it. The verdict names the mode
 * and the mismatch in one line each; these state them in full.
 */
function renderContext(result: CaseLabResult): string {
  const expectation = result.matchesExpectation
    ? 'Outcome matches the expected outcome.'
    : result.outcome === result.expectedOutcome && result.repairPaths !== undefined && touchesTests(result.repairPaths)
      ? `Expected ${OUTCOME_LABELS[result.expectedOutcome]} without touching a test file; the repair changed ${result.repairPaths.filter((path) => touchesTests([path])).join(', ')}. This result does not match. The failure is kept in the record.`
      : `Expected ${OUTCOME_LABELS[result.expectedOutcome]}; this result does not match. The failure is kept in the record.`;
  return `<p class="mode-note">${escapeHtml(MODES[result.mode].note)}</p>
<p class="expectation">${escapeHtml(expectation)}</p>`;
}

function renderHeader(result: CaseLabResult, item: CaseLabCase): string {
  return `<header class="docket">
  <p class="eyebrow">Sutura Case Lab</p>
  <h1>${escapeHtml(item.title)}</h1>
  <p class="badges">${modeBadge(result.mode)} ${outcomeBadge(result.outcome)}</p>
</header>`;
}

/**
 * Release, controller and request identity.
 *
 * This is execution detail, so it sits below the verdict. On a narrow screen
 * it is tall enough to push the verdict off the first screen, which would
 * defeat the point of leading with a verdict.
 */
function renderIdentity(result: CaseLabResult): string {
  return `<dl class="identity">
    <dt>Release</dt><dd>v${escapeHtml(result.release.version)} · Action <code>${escapeHtml(result.release.actionSha)}</code></dd>
    <dt>Controller</dt><dd><code>${escapeHtml(result.identity.controllerSha)}</code></dd>${result.identity.demoSha === undefined ? '' : `
    <dt>Demo repository</dt><dd><code>${escapeHtml(result.identity.demoSha)}</code></dd>`}
    <dt>Request</dt><dd><code>${escapeHtml(result.requestId)}</code> · ${escapeHtml(result.createdAt)}</dd>
  </dl>`;
}

function renderEvidence(result: CaseLabResult, item: CaseLabCase): string {
  const file = result.caseFile;
  const rows: string[] = [];
  rows.push(`<li>Placebo case <code>${escapeHtml(item.placeboCaseId)}</code>: ${escapeHtml(item.description)}</li>`);
  if (file) {
    rows.push(`<li>Failing command: <code>${escapeHtml(file.diagnosis.failingCmd || 'not recorded')}</code></li>`);
    rows.push(`<li>Error excerpt: <code>${escapeHtml(file.diagnosis.errorExcerpt || 'not recorded')}</code></li>`);
    rows.push(`<li>Repository <code>${escapeHtml(file.repo)}</code> · run <code>${escapeHtml(file.runId)}</code> · runtime ${escapeHtml(file.runtime)}</li>`);
  }
  rows.push(link(result.links.ciRun, 'Failed CI run'));
  rows.push(link(result.links.pullRequest, 'Broken pull request'));
  rows.push(link(result.links.workflowRun, result.mode === 'live' ? 'Case Lab workflow run' : 'Recorded workflow run'));
  return section('evidence', 'Failed commit and CI evidence', `<ul>${rows.join('\n')}</ul>`);
}

function renderDiagnosis(file: CaseLabCaseFile | undefined): string {
  if (!file) return section('diagnosis', 'Nano diagnosis', '<p class="empty">No case file was published for this run.</p>');
  const grounding = file.diagnosis.grounding;
  const citations = grounding && !grounding.skipped && grounding.citations.length > 0
    ? `<h3>Grounding</h3><ul>${grounding.citations.map((citation) =>
      `<li>${anchor(citation.url, citation.title)}</li>`).join('')}</ul>`
    : '';
  return section('diagnosis', 'Nano diagnosis and confidence', `<dl>
  <dt>Failure class</dt><dd>${escapeHtml(file.diagnosis.class)}</dd>
  <dt>Confidence</dt><dd>${percent(file.diagnosis.confidence)}</dd>
  <dt>Signals</dt><dd>${file.diagnosis.signals.length === 0 ? 'none' : `<ul>${file.diagnosis.signals.map((signal) => `<li><code>${escapeHtml(signal)}</code></li>`).join('')}</ul>`}</dd>
</dl>${citations}`);
}

function renderRecovery(file: CaseLabCaseFile | undefined): string {
  const lines = file === undefined ? [] : recoverySummary(file);
  return lines.length === 0 ? '' : section('recovery', 'Diagnosis recovery', `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`);
}

function renderSearch(file: CaseLabCaseFile | undefined): string {
  if (!file) return '';
  const triage = `<p>Triage: ${escapeHtml(file.triage.status)} · reproduced ${file.triage.reproduced}/${file.triage.of} · stop reason ${escapeHtml(file.triage.stopReason)} · method <code>${escapeHtml(file.triage.methodVersion)}</code></p>`;
  const search = file.search ?? [];
  if (search.length === 0) {
    return section('search', 'ConTree search tree and branch status', `${triage}<p class="empty">No repair search branches were opened.</p>`);
  }
  const rows = search.map((node) => [
    `<code>${escapeHtml(node.nodeId)}</code>`,
    node.parentNodeId === undefined ? 'root' : `<code>${escapeHtml(node.parentNodeId)}</code>`,
    String(node.depth),
    escapeHtml(node.terminalReason ?? 'open'),
    String(node.testExitCode),
    node.policyValid ? 'valid' : 'violation',
    String(node.changedFiles),
    String(node.diffBytes),
  ]);
  return section('search', 'ConTree search tree and branch status', `${triage}${table(
    ['Node', 'Parent', 'Depth', 'Terminal reason', 'Test exit', 'Policy', 'Changed files', 'Diff bytes'],
    rows,
  )}`);
}

function renderCandidates(file: CaseLabCaseFile | undefined): string {
  if (!file) return '';
  if (file.race.length === 0) {
    return section('candidates', 'Super proposals and candidate patches', '<p class="empty">No candidate patch was proposed.</p>');
  }
  const selected = file.selectedCandidate?.id;
  const items = file.race.map((entry) => `<article class="candidate${entry.candidate.id === selected ? ' selected' : ''}">
  <h3>Candidate <code>${escapeHtml(entry.candidate.id)}</code>${entry.candidate.id === selected ? ' · selected' : ''}</h3>
  <p>${escapeHtml(entry.candidate.rationale)}</p>
  <p>Test exit ${entry.exitCode} · ${entry.held ? 'held its result' : 'did not hold'} · node <code>${escapeHtml(entry.nodeId)}</code>${entry.note === undefined ? '' : ` · ${escapeHtml(entry.note)}`}</p>
  <pre class="diff"><code>${escapeHtml(entry.candidate.diff)}</code></pre>
</article>`).join('\n');
  return section('candidates', 'Super proposals and candidate patches', items);
}

function renderRejections(file: CaseLabCaseFile | undefined): string {
  if (!file) return '';
  const selected = file.selectedCandidate?.id;
  const rejectedCandidates = file.race.filter((entry) => entry.candidate.id !== selected || file.audit?.approved === false);
  const failedChecks = (file.audit?.checks ?? []).filter((check) => !check.passed);
  if (rejectedCandidates.length === 0 && failedChecks.length === 0) {
    return section('rejections', 'Rejected patches and rejection reasons', '<p class="empty">No candidate was rejected.</p>');
  }
  const candidateRows = rejectedCandidates.map((entry) => [
    `<code>${escapeHtml(entry.candidate.id)}</code>`,
    entry.held ? 'held' : 'did not hold',
    String(entry.exitCode),
    escapeHtml(entry.note ?? ''),
  ]);
  const checkRows = failedChecks.map((check) => [
    `<code>${escapeHtml(check.name)}</code>`,
    escapeHtml(check.evidence ?? 'no evidence text'),
  ]);
  return section('rejections', 'Rejected patches and rejection reasons', `${candidateRows.length === 0 ? '' : table(['Candidate', 'Result', 'Test exit', 'Note'], candidateRows)}${checkRows.length === 0 ? '' : `<h3>Failed audit checks</h3>${table(['Check', 'Evidence'], checkRows)}`}${file.audit?.approved === false ? `<p>${escapeHtml(file.audit.reasoning)}</p>` : ''}`);
}

function renderAudit(file: CaseLabCaseFile | undefined): string {
  if (!file) return '';
  if (!file.audit) {
    return section('audit', 'Clean audit branch and Ultra verdict', '<p class="empty"><strong>Not run.</strong> No candidate survived for adversarial audit.</p>');
  }
  const rows = file.audit.checks.map((check) => [
    `<code>${escapeHtml(check.name)}</code>`,
    check.passed ? 'passed' : 'failed',
    escapeHtml(check.evidence ?? ''),
  ]);
  return section('audit', 'Clean audit branch and Ultra verdict', `<p>Verdict: <strong>${file.audit.approved ? 'approved' : 'rejected'}</strong> · policy <code>${escapeHtml(file.policy.policySha)}</code> at <code>${escapeHtml(file.policy.baseRef)}</code></p>${table(['Check', 'Result', 'Evidence'], rows)}<p>${escapeHtml(file.audit.reasoning)}</p>`);
}

function renderOutcome(result: CaseLabResult): string {
  return section('outcome', 'Final outcome', `<p class="badges">${outcomeBadge(result.outcome)} ${modeBadge(result.mode)}</p><p>Sutura never merges a generated repair. A ${escapeHtml(OUTCOME_LABELS[result.outcome].toLowerCase())} result still needs human review.</p>`);
}

function renderCost(result: CaseLabResult): string {
  const file = result.caseFile;
  const byRole = new Map<string, { calls: number; usd: number; inTok: number; outTok: number }>();
  for (const entry of file?.cost.entries ?? []) {
    const current = byRole.get(entry.role) ?? { calls: 0, usd: 0, inTok: 0, outTok: 0 };
    current.calls += 1;
    current.usd += entry.usd;
    current.inTok += entry.inTok;
    current.outTok += entry.outTok;
    byRole.set(entry.role, current);
  }
  const roleRows = [...byRole.entries()].map(([role, value]) => [
    escapeHtml(role), String(value.calls), String(value.inTok), String(value.outTok), usd(value.usd),
  ]);
  const stages = file?.stages ?? [];
  const cpu = stages.reduce((sum, stage) => sum + (stage.metrics.userCpuTimeSec ?? 0) + (stage.metrics.systemCpuTimeSec ?? 0), 0);
  const rss = stages.reduce((max, stage) => Math.max(max, stage.metrics.maxRssKb ?? 0), 0);
  const operations = stages.filter((stage) => stage.operationId !== undefined).length;
  const statusNote = result.cost.status === 'unavailable'
    ? '<p class="empty">Cost is unavailable: usage or billing information is missing or unconfirmed.</p>'
    : result.cost.status === 'partial' ? '<p class="empty">Some costs or billing units are unconfirmed.</p>' : '';
  const rawCosts = file?.verification?.costs.sandbox?.map((entry) => `${entry.rawAmount ?? 'unknown'} (${escapeHtml(entry.rawUnit ?? 'unit unconfirmed')})`).join(', ');
  return section('cost', 'Token cost, provider cost, latency, and sandbox operations', `${statusNote}<dl>
  <dt>Inference cost</dt><dd>${usd(result.cost.inferenceUsd)}</dd>
  <dt>Sandbox cost</dt><dd>${usd(result.cost.sandboxUsd)}</dd>${rawCosts ? `<dt>Provider raw amounts</dt><dd>${rawCosts}</dd>` : ''}
  <dt>Elapsed</dt><dd>${seconds(result.elapsedMs)}</dd>
  <dt>CPU time</dt><dd>${cpu.toFixed(2)} s</dd>
  <dt>Peak memory</dt><dd>${rss === 0 ? 'not recorded' : `${Math.round(rss / 1_024)} MiB`}</dd>
  <dt>Sandbox stages</dt><dd>${stages.length} (${operations} with an operation id)</dd>
</dl>${roleRows.length === 0 ? '' : table(['Role', 'Calls', 'Input tokens', 'Output tokens', 'Cost'], roleRows)}`);
}

function renderLinks(links: CaseLabResultLinks, mode: CaseLabMode): string {
  const items = [
    link(links.workflowRun, mode === 'live' ? 'Case Lab workflow run' : 'Recorded workflow run'),
    link(links.ciRun, 'Failed CI run'),
    link(links.pullRequest, 'Broken pull request'),
    link(links.repairPullRequest, 'Repair pull request'),
    link(links.refusalComment, 'Refusal report'),
    link(links.check, 'GitHub check'),
    link(links.caseFileArtifact, 'HTML case file artifact', 'requires GitHub sign-in'),
    link(links.replayBundleArtifact, 'Replay bundle artifact', 'requires GitHub sign-in'),
    link(links.evidence, 'Evidence file'),
    link(links.atifTrajectory, 'ATIF trajectory'),
  ].filter((item) => item.length > 0);
  return section('links', 'Links', items.length === 0 ? '<p class="empty">No public links were recorded.</p>' : `<ul>${items.join('\n')}</ul>`);
}

function renderSource(result: CaseLabResult): string {
  if (result.recordedFrom) {
    return `<p class="source">Recorded from <code>${escapeHtml(result.recordedFrom.file)}</code> (result hash <code>${escapeHtml(shortSha(result.recordedFrom.resultHash))}…</code>) at ${escapeHtml(result.recordedFrom.recordedAt)}, subject <code>${escapeHtml(result.recordedFrom.subjectSha)}</code>.</p>`;
  }
  if (result.replayedFrom) {
    return `<p class="source">Replayed from bundle <code>${escapeHtml(shortSha(result.replayedFrom.bundleSha256))}…</code> captured at ${anchor(result.replayedFrom.capturedRunUrl, result.replayedFrom.capturedRunUrl)}.</p>`;
  }
  return '';
}

/**
 * The Action setup and verify documentation. No fragment: `isPublicHttpsUrl`
 * refuses a URL that carries one, so a fragment would render as inert text.
 */
const ACTION_SETUP_URL = 'https://github.com/juan294/sutura/blob/main/README.md';
const EXACT_SHA = /^[a-f0-9]{40}$/u;

/**
 * The route a reader takes to check a patch this page did not produce.
 *
 * The command is filled in from this result's own identities, so a reader can
 * copy it rather than assemble it. A run whose policy commit is not an exact
 * commit (a local run records `local`) gets the shape of the command and says
 * which identity is missing, rather than a command that would not run.
 */
function renderVerify(result: CaseLabResult): string {
  const sourceSha = result.identity.demoSha;
  const policyBaseSha = result.caseFile?.policy.baseSha;
  const usable = sourceSha !== undefined && EXACT_SHA.test(sourceSha)
    && policyBaseSha !== undefined && EXACT_SHA.test(policyBaseSha);
  const command = `sutura verify \\
  --case-dir <checkout> \\
  --source-sha ${usable ? sourceSha : '<failing commit>'} \\
  --policy-base-sha ${usable ? policyBaseSha : '<trusted policy commit>'} \\
  --candidate-diff <patch file> \\
  --failing-command diagnosed \\
  --format json`;
  const note = usable
    ? 'The two commits are this run\u2019s own: the commit that failed, and the trusted policy commit chosen by the operator.'
    : 'This run did not record an exact failing commit and policy commit, so both are shown as placeholders. Verification is always tied to exact commits.';
  return section('verify', 'Check a patch this page did not produce', `<p>${escapeHtml(note)} A patch cannot ask for a more permissive policy by carrying one, and no green log is accepted in place of execution.</p>
<pre class="command"><code>${escapeHtml(command)}</code></pre>
<p>${anchor(ACTION_SETUP_URL, 'The same route runs as a GitHub Action')} and needs no repository write access. Uploading a patch stays a command-line and Action route; this page never runs one.</p>`);
}

/** The disclosure that holds the execution internals. Its content is always in the HTML. */
export const EXECUTION_DETAIL_SUMMARY = 'Execution and cost detail';

/**
 * The story a reader follows: the verdict, then the failure, the behavior it
 * changed, and the checks that decided it. Model, branch, trace and cost
 * detail is real and complete but starts closed, so the first screen carries
 * no infrastructure jargon.
 */
export function renderResultBody(result: CaseLabResult, item: CaseLabCase): string {
  const file = result.caseFile;
  const execution = [
    renderIdentity(result),
    renderSearch(file),
    renderCandidates(file),
    renderRejections(file),
    renderCost(result),
    renderLinks(result.links, result.mode),
    renderSource(result),
    `<p class="hash">Result hash <code>${escapeHtml(result.resultHash)}</code></p>`,
  ].filter((part) => part.length > 0).join('\n');
  return [
    renderHeader(result, item),
    renderVerdict(result, item),
    renderContext(result),
    renderEvidence(result, item),
    renderDiagnosis(file),
    renderRecovery(file),
    renderCounterfactual(file),
    renderAudit(file),
    renderOutcome(result),
    renderVerify(result),
    `<details class="execution">
<summary>${EXECUTION_DETAIL_SUMMARY}</summary>
${execution}
</details>`,
  ].join('\n');
}

export const SITE_NAME = 'Sutura Case Lab';
export const REPOSITORY_URL = 'https://github.com/juan294/sutura';
export const FAVICON_FILE = 'favicon.svg';
export const SOCIAL_CARD_FILE = 'social-card.png';
export const PRIVACY_PATH = 'privacy/';
export const PRIVACY_TITLE = 'Privacy';
export const PRIVACY_DESCRIPTION = 'What the Sutura Case Lab measures and how to opt out.';
export const ABOUT_PATH = 'about/';
export const ABOUT_TITLE = 'What Sutura verifies';
export const ABOUT_DESCRIPTION = 'How Sutura reproduces a CI failure, searches repairs in sandboxes, audits the patch, and refuses green-wash fixes.';
/** `localStorage` key that remembers the visitor's consent choice: `granted` or `denied`. */
export const CONSENT_STORAGE_KEY = 'sutura-consent';
/** `--paper` in assets/case-lab.css, light then dark. */
const THEME_COLORS = Object.freeze({ light: '#fbfbf9', dark: '#121417' });
const GTAG_LOADER = 'https://www.googletagmanager.com/gtag/js';
const CLARITY_LOADER = 'https://www.clarity.ms/tag/';
const VERCEL_INSIGHTS_SCRIPT = '_vercel/insights/script.js';

/**
 * Public identifiers that appear in the served HTML. Every field is optional;
 * an absent field renders nothing.
 */
export interface SiteIdentifiers {
  /** Content of the `google-site-verification` meta tag. */
  readonly googleSiteVerification?: string;
  /** Content of the `msvalidate.01` meta tag. */
  readonly bingSiteVerification?: string;
  /** Google Analytics 4 measurement id (`G-…`). Loads under Consent Mode v2 with every storage type denied until the visitor accepts. */
  readonly ga4MeasurementId?: string;
  /** Microsoft Clarity project id. Loads with consent off until the visitor accepts. */
  readonly clarityProjectId?: string;
  /** Loads the cookieless Vercel Web Analytics script. */
  readonly vercelAnalytics?: boolean;
}

/** The consent-gated tools a page carries, in the order the banner names them. */
export type ConsentTool = 'ga4' | 'clarity';

export function consentTools(identifiers: SiteIdentifiers | undefined): ConsentTool[] {
  return [
    ...(identifiers?.ga4MeasurementId === undefined ? [] : ['ga4' as const]),
    ...(identifiers?.clarityProjectId === undefined ? [] : ['clarity' as const]),
  ];
}

/** Keep only the identifiers that never set a cookie, for pages that must stay free of trackers. */
export function cookielessIdentifiers(identifiers: SiteIdentifiers | undefined): SiteIdentifiers {
  return {
    ...(identifiers?.googleSiteVerification === undefined ? {} : { googleSiteVerification: identifiers.googleSiteVerification }),
    ...(identifiers?.bingSiteVerification === undefined ? {} : { bingSiteVerification: identifiers.bingSiteVerification }),
    ...(identifiers?.vercelAnalytics === undefined ? {} : { vercelAnalytics: identifiers.vercelAnalytics }),
  };
}

export interface PageShellOptions {
  readonly title: string;
  readonly siteRoot: string;
  /** Site-relative path of this page, starting with the site root, for example `/replay/flaky-failure/`. */
  readonly path: string;
  readonly body: string;
  readonly script?: string;
  readonly description: string;
  readonly attributes?: Readonly<Record<string, string>>;
  /** Absolute origin without a trailing slash. Absent: no canonical, no absolute Open Graph URL. */
  readonly siteUrl?: string;
  /** Default is index; only per-request pages opt out. */
  readonly robots?: 'index' | 'noindex';
  readonly ogType?: string;
  /** One `application/ld+json` block per entry. */
  readonly jsonLd?: readonly object[];
  /** Verification tags and analytics loaders for this page. Absent or empty: no such markup. */
  readonly identifiers?: SiteIdentifiers;
}

/** JSON that is safe inside a script element: no `<` can close the tag or open a comment. */
export function jsonLdScript(entry: object): string {
  return `<script type="application/ld+json">${JSON.stringify(entry).replace(/</gu, '\\u003c')}</script>`;
}

/** A JavaScript string literal that is safe inside a script element. */
function jsString(value: string): string {
  return JSON.stringify(value).replace(/</gu, '\\u003c');
}

function verificationTags(identifiers: SiteIdentifiers | undefined): string[] {
  return [
    ...(identifiers?.googleSiteVerification === undefined ? [] : [`<meta name="google-site-verification" content="${escapeHtml(identifiers.googleSiteVerification)}">`]),
    ...(identifiers?.bingSiteVerification === undefined ? [] : [`<meta name="msvalidate.01" content="${escapeHtml(identifiers.bingSiteVerification)}">`]),
  ];
}

/**
 * Analytics loaders. The GA4 consent default is declared before the loader so
 * no storage is granted until the visitor accepts; Clarity starts with consent
 * off; Vercel Web Analytics is cookieless and needs no consent.
 */
function analyticsTags(siteRoot: string, identifiers: SiteIdentifiers | undefined): string[] {
  const lines: string[] = [];
  if (identifiers?.ga4MeasurementId !== undefined) {
    const id = identifiers.ga4MeasurementId;
    lines.push(
      `<script>window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('consent', 'default', {'ad_storage': 'denied', 'analytics_storage': 'denied', 'ad_user_data': 'denied', 'ad_personalization': 'denied', 'wait_for_update': 500});</script>`,
      `<script async src="${escapeHtml(`${GTAG_LOADER}?id=${encodeURIComponent(id)}`)}"></script>`,
      `<script>gtag('js', new Date());gtag('config', ${jsString(id)}, {'anonymize_ip': true});</script>`,
    );
  }
  if (identifiers?.clarityProjectId !== undefined) {
    lines.push(`<script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src=${jsString(CLARITY_LOADER)}+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window, document, 'clarity', 'script', ${jsString(identifiers.clarityProjectId)});window.clarity('consent', false);</script>`);
  }
  if (identifiers?.vercelAnalytics === true) {
    lines.push(
      '<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>',
      `<script defer src="${escapeHtml(siteRoot)}${VERCEL_INSIGHTS_SCRIPT}"></script>`,
    );
  }
  return lines;
}

function metaTags(options: PageShellOptions): string {
  const absolute = options.siteUrl === undefined ? undefined : `${options.siteUrl}${options.path}`;
  const image = `${options.siteUrl ?? ''}${options.siteRoot}${SOCIAL_CARD_FILE}`;
  const lines = [
    ...(absolute === undefined ? [] : [`<link rel="canonical" href="${escapeHtml(absolute)}">`]),
    ...(options.robots === 'noindex' ? ['<meta name="robots" content="noindex, nofollow">'] : []),
    `<meta property="og:type" content="${escapeHtml(options.ogType ?? 'website')}">`,
    `<meta property="og:title" content="${escapeHtml(options.title)}">`,
    `<meta property="og:description" content="${escapeHtml(options.description)}">`,
    ...(absolute === undefined ? [] : [`<meta property="og:url" content="${escapeHtml(absolute)}">`]),
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeHtml(options.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(options.description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(image)}">`,
    `<link rel="icon" href="${escapeHtml(options.siteRoot)}${FAVICON_FILE}" type="image/svg+xml">`,
    `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME_COLORS.light}">`,
    `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${THEME_COLORS.dark}">`,
    ...(options.jsonLd ?? []).map(jsonLdScript),
  ];
  return lines.map((line) => `  ${line}`).join('\n');
}

export function renderPage(options: PageShellOptions): string {
  const tools = consentTools(options.identifiers);
  const attributes = { ...options.attributes, ...(tools.length === 0 ? {} : { 'data-consent': tools.join(',') }) };
  const head = [...verificationTags(options.identifiers), ...analyticsTags(options.siteRoot, options.identifiers)]
    .map((line) => `\n  ${line}`).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="description" content="${escapeHtml(options.description)}">
  <title>${escapeHtml(options.title)}</title>
${metaTags(options)}
  <link rel="stylesheet" href="${escapeHtml(options.siteRoot)}case-lab.css">${head}
</head>
<body>
  <nav class="site-nav" aria-label="Case Lab"><a href="${escapeHtml(options.siteRoot)}">Sutura Case Lab</a> · <a href="${REPOSITORY_URL}" rel="noopener">Repository</a></nav>
  <main id="main" class="case-lab"${Object.entries(attributes).map(([name, value]) => ` ${escapeHtml(name)}="${escapeHtml(value)}"`).join('')}>
${options.body}
  </main>
  <footer class="site-footer">Sutura verifies the fix. It never merges a generated repair. · <a href="${escapeHtml(options.siteRoot)}${ABOUT_PATH}">About</a> · <a href="${escapeHtml(options.siteRoot)}${PRIVACY_PATH}">${PRIVACY_TITLE}</a> · <a href="${REPOSITORY_URL}" rel="noopener">Repository</a></footer>${options.script === undefined ? '' : `
  <script src="${escapeHtml(options.siteRoot)}${escapeHtml(options.script)}" defer></script>`}
</body>
</html>
`;
}

/**
 * The privacy page names only the tools this build carries, what each stores,
 * and how to withdraw. It is rendered at build time from the same identifiers
 * that drive the head, so it cannot drift from the served markup.
 */
export function renderPrivacyBody(identifiers: SiteIdentifiers | undefined): string {
  const tools = consentTools(identifiers);
  const entries: string[] = [];
  if (tools.includes('ga4')) {
    entries.push('<dt>Google Analytics 4</dt><dd>After you choose Accept it stores <code>_ga</code> cookies and pseudonymous usage data: pages viewed, approximate region, browser and device type. Before that it sets no cookie and keeps no identifier.</dd>');
  }
  if (tools.includes('clarity')) {
    entries.push('<dt>Microsoft Clarity</dt><dd>After you choose Accept it records sessions and heatmaps with typed input masked. Before that it sets no cookie and records nothing identifying.</dd>');
  }
  if (identifiers?.vercelAnalytics === true) {
    entries.push('<dt>Vercel Web Analytics</dt><dd>Counts page views in aggregate without cookies and without identifying visitors. It needs no consent and loads on every page.</dd>');
  }
  const measured = entries.length === 0
    ? '<p class="empty">This build of the Case Lab carries no analytics. Nothing is measured.</p>'
    : `<dl>\n${entries.map((entry) => `    ${entry}`).join('\n')}\n  </dl>`;
  const consent = tools.length === 0
    ? ''
    : `<section class="sheet" aria-labelledby="consent-title">
  <h2 id="consent-title">Consent</h2>
  <p>${escapeHtml(tools.map((tool) => (tool === 'ga4' ? 'Google Analytics' : 'Microsoft Clarity')).join(' and '))} ${tools.length === 1 ? 'does' : 'do'} not set a cookie or record anything identifying before you choose Accept in the banner at the bottom of the page. Choose Decline to keep ${tools.length === 1 ? 'it' : 'them'} off. Your choice is remembered in this browser under the key <code>${CONSENT_STORAGE_KEY}</code> and never leaves it.</p>
</section>
`;
  return `<header class="docket">
  <p class="eyebrow">Sutura Case Lab · ${PRIVACY_TITLE}</p>
  <h1>${PRIVACY_TITLE}</h1>
  <p>${escapeHtml(PRIVACY_DESCRIPTION)}</p>
</header>
<section class="sheet" aria-labelledby="measured-title">
  <h2 id="measured-title">What is measured</h2>
  ${measured}
</section>
${consent}<section class="sheet" aria-labelledby="withdraw-title">
  <h2 id="withdraw-title">How to withdraw</h2>
  <p>Choose Decline in the banner, or clear this site's data in your browser settings. Clearing site data removes the stored choice and every cookie set here, and the banner appears again on your next visit.</p>
</section>
<section class="sheet" aria-labelledby="live-title">
  <h2 id="live-title">Live runs</h2>
  <p>Starting a live run sends only the case id to the Case Lab dispatcher. The live result page reads public result files and run status from GitHub; GitHub's privacy statement applies to those requests. No account, sign-in, or personal data is required anywhere on this site.</p>
</section>`;
}

export function resultPageTitle(result: CaseLabResult, item: CaseLabCase): string {
  return `${item.title} · ${MODE_LABELS[result.mode]} · ${OUTCOME_LABELS[result.outcome]}`;
}

/** Internal links that close a replay page: back to the case list and on to the explainer. */
export function renderPageLinks(siteRoot: string): string {
  return `<nav class="page-links" aria-label="More"><a href="${escapeHtml(siteRoot)}">Back to cases</a> · <a href="${escapeHtml(siteRoot)}${ABOUT_PATH}">How Sutura verifies</a></nav>`;
}

const MARKDOWN_HOSTS = Object.freeze(['https://github.com/', 'https://raw.githubusercontent.com/']);

/**
 * The only hrefs the Markdown subset accepts: the two public GitHub hosts, or
 * a site-relative path starting with `/`, which is resolved against the site
 * root. Anything else is a build error that names the URL.
 */
export function markdownHref(url: string, siteRoot: string): string {
  const wellFormed = !/[\s"'<>\\]/u.test(url) && url.length > 0;
  if (wellFormed && MARKDOWN_HOSTS.some((host) => url.startsWith(host)) && isPublicHttpsUrl(url)) return escapeHtml(url);
  if (wellFormed && url.startsWith('/') && !url.startsWith('//')) return escapeHtml(`${siteRoot}${url.slice(1)}`);
  throw new RangeError(`markdown link is not allowed: ${JSON.stringify(url)} (expected ${MARKDOWN_HOSTS.join(', ')}, or a site-relative path starting with /)`);
}

/** Inline Markdown: code spans, links, and bold. Everything is escaped; code and link text carry no nested markup. */
export function renderInlineMarkdown(text: string, siteRoot: string): string {
  const hasCode = text.includes('`');
  const hasLink = text.includes('[');
  const hasBold = text.includes('**');
  if (!hasCode && !hasLink && !hasBold) return escapeHtml(text);

  const nextPositions = (character: string): Int32Array => {
    const positions = new Int32Array(text.length + 1);
    let next = -1;
    positions[text.length] = next;
    for (let index = text.length - 1; index >= 0; index -= 1) {
      if (text[index] === character) next = index;
      positions[index] = next;
    }
    return positions;
  };
  const nextBacktick = hasCode ? nextPositions('`') : undefined;
  const nextBracket = hasLink ? nextPositions(']') : undefined;
  const nextParenthesis = hasLink ? nextPositions(')') : undefined;
  const nextStar = hasBold ? nextPositions('*') : undefined;
  const nextNewline = nextPositions('\n');
  const whitespace = hasLink ? new Uint32Array(text.length + 1) : undefined;
  if (whitespace !== undefined) {
    for (let index = 0; index < text.length; index += 1) {
      whitespace[index + 1] = whitespace[index]! + (/\s/u.test(text[index]!) ? 1 : 0);
    }
  }
  let html = '';
  let last = 0;
  for (let index = 0; index < text.length; index += 1) {
    let end = -1;
    let rendered: string | undefined;
    if (text[index] === '`') {
      end = nextBacktick![index + 1]!;
      const newline = nextNewline[index + 1]!;
      if (end > index + 1 && (newline === -1 || end < newline)) {
        rendered = `<code>${escapeHtml(text.slice(index + 1, end))}</code>`;
      }
    } else if (text[index] === '[') {
      const labelEnd = nextBracket![index + 1]!;
      const newline = nextNewline[index + 1]!;
      if (labelEnd > index + 1 && (newline === -1 || labelEnd < newline) && text[labelEnd + 1] === '(') {
        end = nextParenthesis![labelEnd + 2]!;
        if (end > labelEnd + 2 && whitespace![end]! === whitespace![labelEnd + 2]!) {
          const url = text.slice(labelEnd + 2, end);
          const label = text.slice(index + 1, labelEnd);
          rendered = `<a href="${markdownHref(url, siteRoot)}"${url.startsWith('/') ? '' : ' rel="noopener"'}>${escapeHtml(label)}</a>`;
        }
      }
    } else if (text.startsWith('**', index)) {
      const firstStar = nextStar![index + 2]!;
      const newline = nextNewline[index + 2]!;
      if (firstStar > index + 2 && text[firstStar + 1] === '*' && (newline === -1 || firstStar < newline)) {
        end = firstStar + 1;
        rendered = `<strong>${escapeHtml(text.slice(index + 2, firstStar))}</strong>`;
      }
    }
    if (rendered === undefined) continue;
    html += escapeHtml(text.slice(last, index)) + rendered;
    last = end + 1;
    index = end;
  }
  return html + escapeHtml(text.slice(last));
}

const HEADING = /^(#{1,3}) (.+)$/u;
const ORDERED_ITEM = /^\d+\. (.+)$/u;
const UNORDERED_ITEM = /^- (.+)$/u;
const TABLE_ROW = /^\|(.*)\|$/u;
const TABLE_SEPARATOR_CELL = /^:?-+:?$/u;
/** Constructs outside the subset fail the build instead of rendering as prose. */
const UNSUPPORTED = /^(?:```|~~~|>|<|!\[|#{4,} |#{1,3}$|\* |\+ |---$|\*\*\*$|\d+\) |\t| {4})/u;

function tableCells(line: string, lineNumber: number): string[] {
  const inner = TABLE_ROW.exec(line)?.[1];
  if (inner === undefined) throw new RangeError(`markdown line ${lineNumber} is not a table row: ${line}`);
  return inner.split('|').map((cell) => cell.trim());
}

/**
 * A minimal Markdown subset for build-time content: `#`, `##`, `###` headings,
 * paragraphs, ordered and unordered lists (one line per item), tables with a
 * header row, code spans, links, and bold. No raw HTML, no nesting, no other
 * construct; anything else throws with the line number.
 */
export function renderMarkdown(source: string, siteRoot: string): string {
  const inline = (text: string): string => renderInlineMarkdown(text, siteRoot);
  const lines = source.split('\n');
  const blocks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!.trimEnd();
    const lineNumber = index + 1;
    if (line === '') {
      index += 1;
      continue;
    }
    if (UNSUPPORTED.test(line)) throw new RangeError(`markdown line ${lineNumber} uses a construct outside the subset: ${line}`);
    const heading = HEADING.exec(line);
    if (heading !== null) {
      const level = heading[1]!.length;
      blocks.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      index += 1;
      continue;
    }
    if (TABLE_ROW.test(line)) {
      const header = tableCells(line, lineNumber);
      const separator = lines[index + 1]?.trimEnd();
      if (separator === undefined || !TABLE_ROW.test(separator) || !tableCells(separator, lineNumber + 1).every((cell) => TABLE_SEPARATOR_CELL.test(cell))) {
        throw new RangeError(`markdown line ${lineNumber} starts a table without a header separator row: ${line}`);
      }
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && TABLE_ROW.test(lines[index]!.trimEnd())) {
        const cells = tableCells(lines[index]!.trimEnd(), index + 1);
        if (cells.length !== header.length) throw new RangeError(`markdown line ${index + 1} has ${cells.length} cells, expected ${header.length}: ${lines[index]}`);
        rows.push(cells);
        index += 1;
      }
      blocks.push(`<div class="scroll"><table><thead><tr>${header.map((cell) => `<th scope="col">${inline(cell)}</th>`).join('')}</tr></thead><tbody>\n${
        rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('\n')}\n</tbody></table></div>`);
      continue;
    }
    const listPattern = ORDERED_ITEM.test(line) ? ORDERED_ITEM : UNORDERED_ITEM.test(line) ? UNORDERED_ITEM : undefined;
    if (listPattern !== undefined) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = listPattern.exec(lines[index]!.trimEnd());
        if (item === null) break;
        items.push(`  <li>${inline(item[1]!)}</li>`);
        index += 1;
      }
      const tag = listPattern === ORDERED_ITEM ? 'ol' : 'ul';
      blocks.push(`<${tag}>\n${items.join('\n')}\n</${tag}>`);
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const next = lines[index]!.trimEnd();
      if (next === '' || HEADING.test(next) || TABLE_ROW.test(next) || ORDERED_ITEM.test(next) || UNORDERED_ITEM.test(next) || UNSUPPORTED.test(next)) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return blocks.join('\n');
}

/** The explainer page: a docket header and the README-derived Markdown as prose. */
export function renderAboutBody(markdown: string, siteRoot: string): string {
  return `<header class="docket">
  <p class="eyebrow">Sutura Case Lab · About</p>
  <h1>${ABOUT_TITLE}</h1>
  <p>${escapeHtml(ABOUT_DESCRIPTION)}</p>
</header>
<article class="prose">
${renderMarkdown(markdown, siteRoot)}
</article>
<nav class="page-links" aria-label="More"><a href="${escapeHtml(siteRoot)}">Back to cases</a></nav>`;
}

export interface CatalogCard {
  readonly item: CaseLabCase;
  readonly result: CaseLabResult;
}

export function renderCaseCard(card: CatalogCard, siteRoot: string): string {
  const { item, result } = card;
  return `<article class="case-card" id="case-${escapeHtml(item.id)}">
  <h2>${escapeHtml(item.title)}</h2>
  <p>${escapeHtml(item.scenario)}</p>
  <p class="badges">${modeBadge(result.mode)} ${outcomeBadge(result.outcome)}</p>
  <p>Expected: ${escapeHtml(OUTCOME_LABELS[item.expectedOutcome])}${expectedOutcomeFor(item, 'live') === item.expectedOutcome ? '' : ` · Live: ${escapeHtml(OUTCOME_LABELS[expectedOutcomeFor(item, 'live')])} without touching a test`} · Language: ${escapeHtml(item.language)}</p>
  <p class="actions">
    <a class="button" href="${escapeHtml(siteRoot)}replay/${escapeHtml(item.id)}/">Open ${escapeHtml(MODE_LABELS[result.mode].toLowerCase())}</a>
    <button type="button" class="button button-live" data-case-id="${escapeHtml(item.id)}" disabled>Start live run</button>
  </p>
</article>`;
}

export interface IndexOptions {
  readonly cards: readonly CatalogCard[];
  readonly release: { readonly version: string; readonly actionSha: string };
  readonly siteRoot: string;
  readonly limits: { readonly maxRunsPerHour: number; readonly maxRunsPerDay: number; readonly maxConcurrentRuns: number };
}

export function renderIndexBody(options: IndexOptions): string {
  const liveNote = `A live run starts one real Sutura repair in the public demo repository when the public-demo gate is on: at most ${options.limits.maxConcurrentRuns} run at a time, ${options.limits.maxRunsPerHour} per hour, and ${options.limits.maxRunsPerDay} per day. Every case has a deterministic result you can open now.`;
  return `<header class="docket">
  <p class="eyebrow">Sutura · Verified self-healing CI</p>
  <h1>Sutura Case Lab</h1>
  <p>AI agents make CI green. Sutura proves whether they fixed the problem. Pick one of five fixed cases and read the full verified result: diagnosis, search tree, candidate patches, rejected patches, audit verdict, cost, and links to the GitHub evidence.</p>
  <p><a href="${escapeHtml(options.siteRoot)}${ABOUT_PATH}">How Sutura verifies a repair</a>: the pipeline from the failed run to the audited patch, the runtime roles, and the five outcomes a run can end in.</p>
  <p class="mode-note">${escapeHtml(liveNote)}</p>
  <p class="identity">Release v${escapeHtml(options.release.version)} · Action <code>${escapeHtml(options.release.actionSha)}</code></p>
  <p id="live-status" class="live-status" role="status" aria-live="polite"></p>
</header>
<section class="cases" aria-label="Cases">
${options.cards.map((card) => renderCaseCard(card, options.siteRoot)).join('\n')}
</section>
<section class="sheet" aria-labelledby="labels-title">
  <h2 id="labels-title">How results are labeled</h2>
  <dl>
${Object.values(MODES).map((mode) => `    <dt>${escapeHtml(mode.label)}</dt><dd>${escapeHtml(mode.note)}</dd>`).join('\n')}
  </dl>
  <p>The Case Lab accepts only these five server-defined cases. It never accepts arbitrary repositories, refs, commands, patches, or text.</p>
</section>`;
}

export interface PendingState {
  readonly requestId: string;
  readonly caseTitle: string | undefined;
  readonly status: string;
  readonly runUrl?: string;
}

export function renderPendingBody(state: PendingState): string {
  return `<header class="docket">
  <p class="eyebrow">Sutura Case Lab · Live run</p>
  <h1>${escapeHtml(state.caseTitle ?? 'Live run')}</h1>
  <p class="badges">${modeBadge('live')}</p>
  <p class="mode-note">Request <code>${escapeHtml(state.requestId)}</code>. This page keeps the same address; refresh it at any time.</p>
  <p id="live-status" class="live-status" role="status" aria-live="polite">${escapeHtml(state.status)}</p>${state.runUrl === undefined ? '' : `
  <p>${anchor(state.runUrl, 'Watch the workflow run on GitHub')}</p>`}
</header>`;
}

/** Browser-safe structural guard: enough to render safely; the full validator runs in Node. */
export function isRenderableResult(value: unknown, caseIds: readonly string[]): value is CaseLabResult {
  if (value === null || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return result.schemaVersion === 'sutura-case-lab-result-v1'
    && typeof result.caseId === 'string' && caseIds.includes(result.caseId)
    && (result.mode === 'live' || result.mode === 'replay' || result.mode === 'recorded')
    && typeof result.outcome === 'string' && Object.hasOwn(OUTCOME_LABELS, result.outcome)
    && typeof result.expectedOutcome === 'string' && Object.hasOwn(OUTCOME_LABELS, result.expectedOutcome)
    && typeof result.requestId === 'string'
    && typeof result.resultHash === 'string'
    && typeof result.createdAt === 'string'
    && result.links !== null && typeof result.links === 'object'
    && result.release !== null && typeof result.release === 'object'
    && result.identity !== null && typeof result.identity === 'object'
    && result.cost !== null && typeof result.cost === 'object';
}
