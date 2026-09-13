import type { CaseFile } from '../domain.js';
import {
  aggregateStageEvidence,
  counterfactualLede,
  diffSummary,
  escapeHtml,
  formatConfidence,
  formatUsd,
  mergeGuidance,
  outcomeLabel,
  raceNote,
  recoverySummary,
  safeWebUrl,
  stageForRole,
  triageSentence,
} from './format.js';

function renderRecovery(caseFile: CaseFile): string {
  const lines = recoverySummary(caseFile);
  return lines.length === 0 ? '' : `
    <section class="sheet recovery" aria-labelledby="recovery-title">
      <div class="section-label"><span>R</span><h2 id="recovery-title">Diagnosis recovery</h2></div>
      <ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
    </section>`;
}

function renderSandboxEvidence(caseFile: CaseFile): string {
  const totals = aggregateStageEvidence(caseFile);
  const hasOperationEvidence = caseFile.stages.some((entry) => entry.operationId !== undefined);
  const rows = caseFile.stages.map((entry) => `<tr>
        <th scope="row">${escapeHtml(entry.stage)}</th>
        <td>${entry.attempt}</td>
        <td><code>${escapeHtml(entry.nodeId)}</code></td>
        <td>${entry.parentNodeId ? `<code>${escapeHtml(entry.parentNodeId)}</code>` : '—'}</td>
        <td>${entry.exitCode ?? '—'}</td>
        <td>${entry.metrics.elapsedTimeSec ?? '—'}</td>
        <td>${entry.metrics.maxRssKb ?? '—'}</td>
        <td>${entry.metrics.cost ?? '—'}</td>${hasOperationEvidence ? `
        <td><code>${escapeHtml(entry.operationId ?? '—')}</code></td>
        <td>${escapeHtml(entry.operationTerminal ?? '—')}</td>
        <td>${entry.cancellationRequested === undefined ? '—' : entry.cancellationRequested ? 'YES' : 'NO'}</td>` : ''}
        <td>${escapeHtml(entry.network)}</td>
        <td>${escapeHtml(entry.note ?? '—')}</td>
      </tr>`).join('');
  return `<div class="sandbox-evidence">
      <p class="micro-label">Repository policy binding</p>
      <dl class="facts">
        <div><dt>Runtime</dt><dd><code>${escapeHtml(caseFile.runtime)}</code></dd></div>
        <div><dt>Base ref</dt><dd><code>${escapeHtml(caseFile.policy.baseRef)}</code></dd></div>
        <div><dt>Base SHA</dt><dd><code>${escapeHtml(caseFile.policy.baseSha)}</code></dd></div>
        <div><dt>Policy SHA</dt><dd><code>${escapeHtml(caseFile.policy.policySha)}</code></dd></div>
      </dl>
      <p class="micro-label">Sandbox totals</p>
      <p>${totals.operationCount} operations · ${totals.elapsedTimeSec.toFixed(3)} s elapsed · ${totals.cpuTimeSec.toFixed(3)} s CPU · ${totals.maxRssKb.toLocaleString('en-US')} KB peak RSS · ${formatUsd(totals.sandboxCostUsd)} sandbox cost</p>
      <div class="table-wrap"><table class="ledger">
        <thead><tr><th>Stage</th><th>Attempt</th><th>Node</th><th>Parent</th><th>Exit</th><th>Elapsed s</th><th>Max RSS KB</th><th>Cost USD</th>${hasOperationEvidence ? '<th>Operation</th><th>Terminal</th><th>Cancel requested</th>' : ''}<th>Network</th><th>Note</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${hasOperationEvidence ? 13 : 10}">No sandbox operations recorded</td></tr>`}</tbody>
      </table></div>
    </div>`;
}

function renderCitations(caseFile: CaseFile): string {
  const grounding = caseFile.diagnosis.grounding;
  if (!grounding || grounding.skipped || grounding.citations.length === 0) {
    return '';
  }

  return `<div class="citations">
    <p class="micro-label">Grounding</p>
    <ul>${grounding.citations
      .map((citation) => {
        const title = escapeHtml(citation.title);
        const snippet = escapeHtml(citation.snippet);
        const url = safeWebUrl(citation.url);
        return `<li>${url ? `<a href="${escapeHtml(url)}" rel="noreferrer">${title}</a>` : title}<span>${snippet}</span></li>`;
      })
      .join('')}</ul>
  </div>`;
}

function renderDiagnosis(caseFile: CaseFile): string {
  const { diagnosis } = caseFile;
  const citations = renderCitations(caseFile);
  return `<section class="sheet diagnosis" aria-labelledby="diagnosis-title">
    <div class="section-label"><span>D</span><h2 id="diagnosis-title">Diagnosis</h2></div>
    <div class="section-body">
      <div class="diagnostic-lockup">
        <strong>${escapeHtml(diagnosis.class)}</strong>
        <span>${formatConfidence(diagnosis.confidence)} confidence</span>
      </div>
      <dl class="facts">
        <div><dt>Failing command</dt><dd><code>${escapeHtml(diagnosis.failingCmd)}</code></dd></div>
        <div><dt>Error specimen</dt><dd>${escapeHtml(diagnosis.errorExcerpt)}</dd></div>
      </dl>
      <ul class="signals">${diagnosis.signals.map((signal) => `<li>${escapeHtml(signal)}</li>`).join('')}</ul>${citations ? `
      ${citations}` : ''}
    </div>
  </section>`;
}

function renderTriage(caseFile: CaseFile): string {
  return `<section class="sheet triage" aria-labelledby="triage-title">
    <div class="section-label"><span>T</span><h2 id="triage-title">Triage</h2></div>
    <div class="section-body"><p class="triage-reading">${escapeHtml(triageSentence(caseFile))}</p></div>
  </section>`;
}

function renderProcedure(caseFile: CaseFile): string {
  const rows = caseFile.race
    .map(
      (result) => `<tr>
        <th scope="row">${escapeHtml(result.candidate.id)}</th>
        <td>${escapeHtml(result.candidate.rationale)}</td>
        <td><span class="mini-verdict ${result.held ? 'pass' : 'fail'}">${result.held ? 'HELD' : 'ROLLED BACK'}</span></td>
        <td>${escapeHtml(raceNote(result))}</td>
      </tr>`,
    )
    .join('');
  const timeline = caseFile.race
    .map(
      (result, index) => `<li class="${result.held ? 'held' : 'rolled'}">
        <span class="knot" aria-hidden="true"></span>
        <span class="op">OP ${String(index + 1).padStart(2, '0')}</span>
        <strong>${escapeHtml(result.candidate.id)}</strong>
        <small>${escapeHtml(result.imageId)} · exit ${result.exitCode}</small>
      </li>`,
    )
    .join('');
  const diffs = caseFile.race
    .map(
      (result) => `<details ${result.held ? 'open' : ''}>
        <summary>${escapeHtml(result.candidate.id)} <span>${result.held ? 'survivor' : 'rolled back'}</span></summary>
        <pre><code>${escapeHtml(result.candidate.diff)}</code></pre>
      </details>`,
    )
    .join('');
  const searchRows = caseFile.search?.map((node) => `<tr>
        <th scope="row"><code>${escapeHtml(node.nodeId)}</code></th>
        <td><code>${escapeHtml(node.parentNodeId ?? 'baseline')}</code></td>
        <td>${node.depth}</td>
        <td>${node.testExitCode}</td>
        <td>${node.policyValid ? 'PASS' : 'FAIL'}</td>
        <td>${escapeHtml(node.terminalReason ?? 'frontier')}</td>
      </tr>`).join('') ?? '';

  return `<section class="sheet procedure" aria-labelledby="procedure-title">
    <div class="section-label"><span>P</span><h2 id="procedure-title">Procedure</h2></div>
    <div class="section-body">
      <p class="micro-label">Forked sandbox timeline</p>
      <ol class="suture-line" aria-label="Candidate sandbox operations">${timeline || '<li class="rolled"><span class="knot" aria-hidden="true"></span><strong>No candidates</strong></li>'}</ol>
      <div class="table-wrap"><table>
        <thead><tr><th>Candidate</th><th>Strategy</th><th>Held?</th><th>Operative note</th></tr></thead>
        <tbody>${rows || '<tr><th scope="row">—</th><td>No candidates were produced</td><td>NO</td><td>Repair cycle stopped</td></tr>'}</tbody>
      </table></div>${searchRows ? `
      <p class="micro-label">Adaptive checkpoint lineage</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Node</th><th>Parent</th><th>Depth</th><th>Test exit</th><th>Policy</th><th>Terminal</th></tr></thead>
        <tbody>${searchRows}</tbody>
      </table></div>` : ''}
      <div class="diff-stack"><p class="micro-label">Candidate tissue samples</p>${diffs || '<p>No diffs recorded.</p>'}</div>
    </div>
  </section>`;
}

function renderPathology(caseFile: CaseFile): string {
  const audit = caseFile.audit;
  if (!audit) {
    return `<section class="sheet pathology" aria-labelledby="pathology-title">
      <div class="section-label"><span>P</span><h2 id="pathology-title">Pathology</h2></div>
      <div class="section-body"><p class="empty-reading"><strong>NOT RUN</strong> No candidate survived for adversarial audit.</p></div>
    </section>`;
  }

  return `<section class="sheet pathology" aria-labelledby="pathology-title">
    <div class="section-label"><span>P</span><h2 id="pathology-title">Pathology</h2></div>
    <div class="section-body">
      <div class="pathology-verdict ${audit.approved ? 'pass' : 'fail'}">
        <span>Biopsy verdict</span><strong>${audit.approved ? 'CERTIFIED' : 'REFUSED'}</strong>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Adversarial check</th><th>Result</th><th>Evidence</th></tr></thead>
        <tbody>${audit.checks
          .map(
            (check) => `<tr>
              <th scope="row">${escapeHtml(check.name)}</th>
              <td><span class="mini-verdict ${check.passed ? 'pass' : 'fail'}">${check.passed ? 'PASS' : 'FAIL'}</span></td>
              <td>${escapeHtml(check.evidence ?? 'No evidence recorded')}</td>
            </tr>`,
          )
          .join('')}</tbody>
      </table></div>
      <blockquote>${escapeHtml(audit.reasoning)}</blockquote>
    </div>
  </section>`;
}

function renderCounterfactual(caseFile: CaseFile): string {
  const evidence = caseFile.counterfactual;
  if (!evidence || evidence.alternatives.length === 0) return '';
  const rows = evidence.alternatives.map((item) => `<tr>
        <th scope="row"><code>${escapeHtml(item.id)}</code></th>
        <td>${escapeHtml(item.intent)}</td>
        <td><span class="mini-verdict ${item.approved ? 'pass' : 'fail'}">${item.approved ? 'ACCEPTED' : 'REJECTED'}</span></td>
        <td>${escapeHtml(item.rejectedBy?.gate ?? '—')}</td>
        <td><code>${escapeHtml(item.rejectedBy?.rule ?? '—')}</code></td>
        <td>${escapeHtml(item.rejectedBy?.evidence ?? item.reasoning)}</td>
        <td>${item.testExitCode}</td>
        <td>${item.cost.sandboxOperations}</td>
        <td>${item.cost.elapsedTimeSec.toFixed(3)}</td>
        <td>${formatUsd(item.cost.inferenceUsd)}</td>
      </tr>`).join('');

  return `<section class="sheet counterfactual" aria-labelledby="counterfactual-title">
    <div class="section-label"><span>C</span><h2 id="counterfactual-title">Counterfactual</h2></div>
    <div class="section-body">
      <p class="triage-reading">${escapeHtml(counterfactualLede(caseFile))}</p>
      <p class="micro-label">Alternatives from the same baseline checkpoint</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Alternative</th><th>Intent</th><th>Verdict</th><th>Gate</th><th>Rule</th><th>Evidence</th><th>Test exit</th><th>Sandbox ops</th><th>Elapsed s</th><th>Inference</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="micro-label">Additional cost of this comparison</p>
      <p>${evidence.cost.sandboxOperations} sandbox operations · ${evidence.cost.elapsedTimeSec.toFixed(3)} s elapsed · ${formatUsd(evidence.cost.inferenceUsd)} inference${evidence.acceptedCandidateId ? ` · accepted patch <code>${escapeHtml(evidence.acceptedCandidateId)}</code>` : ''}</p>
    </div>
  </section>`;
}

function renderDischarge(caseFile: CaseFile): string {
  const ledgerRows = caseFile.cost.entries
    .map(
      (entry) => `<tr>
        <th scope="row">${escapeHtml(stageForRole(entry.role))}</th>
        <td><code>${escapeHtml(entry.model)}</code></td>
        <td>${entry.inTok.toLocaleString('en-US')}</td>
        <td>${(entry.outTok + entry.reasoningTok).toLocaleString('en-US')}</td>
        <td>${formatUsd(entry.usd)}</td>
      </tr>`,
    )
    .join('');

  return `<section class="sheet discharge" aria-labelledby="discharge-title">
    <div class="section-label"><span>D</span><h2 id="discharge-title">Discharge</h2></div>
    <div class="section-body">
      <div class="discharge-grid">
        <div><span>Diff summary</span><strong>${escapeHtml(diffSummary(caseFile))}</strong></div>
        <div><span>Inference cost</span><strong>${formatUsd(caseFile.cost.totalUsd())}</strong></div>
      </div>
      <div class="merge-check"><span>Human merge check</span><p>${escapeHtml(mergeGuidance(caseFile))}</p></div>
      <div class="table-wrap"><table class="ledger">
        <thead><tr><th>Stage</th><th>Model ID</th><th>Input</th><th>Output + reasoning</th><th>USD</th></tr></thead>
        <tbody>${ledgerRows || '<tr><td colspan="5">No inference recorded</td></tr>'}</tbody>
      </table></div>
      ${renderSandboxEvidence(caseFile)}
    </div>
  </section>`;
}

const STYLES = `
/*
  Paper Ink for a surgical CI case file.
  Palette: theatre paper, carbon ink, theatre teal, clot red, steel rule.
  Signature: the sandbox operation timeline is drawn as an operative suture.
*/
:root {
  color-scheme: light dark;
  --paper: #f4f8f6;
  --paper-raised: #ffffff;
  --ink: #17221e;
  --ink-soft: #53635c;
  --accent: #08766c;
  --danger: #a93645;
  --rule: #c9d7d1;
  font-family: Charter, "Bitstream Charter", "Sitka Text", Georgia, serif;
  background: var(--paper);
  color: var(--ink);
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); }
a { color: var(--accent); text-underline-offset: 0.18em; }
a:focus-visible, summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
.case-file { width: min(1180px, calc(100% - 40px)); margin: 28px auto 72px; }
.docket {
  position: relative; overflow: hidden; min-height: 320px; padding: clamp(28px, 5vw, 64px);
  border: 1px solid var(--ink); background: var(--paper-raised); box-shadow: 9px 9px 0 var(--rule);
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 36px; align-items: end;
}
.docket::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 8px; background: var(--outcome-color); }
.eyebrow, .micro-label, .section-label, dt, .op, .verdict small, .merge-check span, .discharge-grid span {
  font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; text-transform: uppercase; letter-spacing: 0.12em;
}
.eyebrow { margin: 0 0 50px; color: var(--ink-soft); font-size: 0.72rem; }
h1, h2 { font-family: "Arial Narrow", "Avenir Next Condensed", "Roboto Condensed", sans-serif; font-stretch: condensed; text-transform: uppercase; }
h1 { max-width: 760px; margin: 0; font-size: clamp(3rem, 8vw, 7.4rem); line-height: 0.82; letter-spacing: -0.055em; }
.case-meta { margin: 26px 0 0; font-size: 1rem; color: var(--ink-soft); }
.case-meta code { color: var(--ink); }
.verdict { min-width: 230px; border-top: 6px solid var(--outcome-color); padding-top: 15px; }
.verdict small { display: block; color: var(--ink-soft); font-size: 0.68rem; }
.verdict strong { display: block; margin-top: 8px; color: var(--outcome-color); font: 700 1.5rem/1.1 "Arial Narrow", sans-serif; letter-spacing: 0.03em; }
.verdict p { margin: 13px 0 0; font-size: 0.9rem; line-height: 1.45; }
.outcome-fixed { --outcome-color: var(--accent); }
.outcome-refused, .outcome-gave-up { --outcome-color: var(--danger); }
.outcome-flaky-no-patch, .outcome-infra-stop { --outcome-color: #976812; }
.sheet { display: grid; grid-template-columns: 170px minmax(0, 1fr); border-bottom: 1px solid var(--rule); }
.section-label { padding: 34px 24px 34px 8px; color: var(--ink-soft); }
.section-label span { display: block; width: 28px; height: 28px; border: 1px solid currentColor; text-align: center; line-height: 27px; font-size: 0.68rem; }
.section-label h2 { margin: 14px 0 0; color: var(--ink); font-size: 1.05rem; letter-spacing: 0.035em; }
.section-body { min-width: 0; padding: 34px 8px 42px 36px; border-left: 1px solid var(--rule); }
.diagnostic-lockup { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.diagnostic-lockup strong { font: 700 clamp(2rem, 5vw, 4.2rem)/0.95 "Arial Narrow", sans-serif; text-transform: uppercase; }
.diagnostic-lockup span { color: var(--accent); font: 700 0.8rem ui-monospace, monospace; text-transform: uppercase; }
.facts { margin: 30px 0; }
.facts div { display: grid; grid-template-columns: minmax(130px, 0.35fr) 1fr; gap: 24px; padding: 12px 0; border-top: 1px solid var(--rule); }
.facts dt { color: var(--ink-soft); font-size: 0.68rem; }
.facts dd { margin: 0; overflow-wrap: anywhere; }
code { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: 0.85em; }
.signals { margin: 0; padding-left: 1.2rem; line-height: 1.7; }
.citations { margin-top: 30px; padding: 20px; background: color-mix(in srgb, var(--accent) 7%, transparent); }
.micro-label { margin: 0 0 14px; color: var(--ink-soft); font-size: 0.67rem; }
.citations ul { margin: 0; padding: 0; list-style: none; }
.citations li + li { margin-top: 14px; }
.citations li span { display: block; margin-top: 4px; color: var(--ink-soft); }
.triage-reading { margin: 0; max-width: 820px; font-size: clamp(1.4rem, 3vw, 2.35rem); line-height: 1.16; }
.suture-line { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); margin: 18px 0 34px; padding: 0; list-style: none; }
.suture-line li { position: relative; min-width: 0; padding: 30px 16px 0 0; border-top: 2px dashed var(--rule); }
.suture-line .knot { position: absolute; top: -7px; left: 0; width: 12px; height: 12px; background: var(--paper); border: 3px solid var(--accent); transform: rotate(45deg); }
.suture-line .rolled .knot { border-color: var(--danger); }
.suture-line strong, .suture-line small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.suture-line small { margin-top: 5px; color: var(--ink-soft); font: 0.7rem ui-monospace, monospace; }
.op { display: block; margin-bottom: 6px; color: var(--ink-soft); font-size: 0.62rem; }
.table-wrap { max-width: 100%; overflow-x: auto; border: 1px solid var(--rule); }
table { width: 100%; min-width: 720px; border-collapse: collapse; text-align: left; font-size: 0.88rem; }
th, td { padding: 14px 16px; border-bottom: 1px solid var(--rule); vertical-align: top; }
thead th { color: var(--ink-soft); font: 0.65rem ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.1em; }
tbody tr:last-child > * { border-bottom: 0; }
.mini-verdict { display: inline-block; color: var(--accent); font: 700 0.64rem ui-monospace, monospace; white-space: nowrap; }
.mini-verdict.fail { color: var(--danger); }
.diff-stack { margin-top: 30px; }
details { border-top: 1px solid var(--rule); }
summary { padding: 14px 4px; cursor: pointer; font-family: ui-monospace, monospace; }
summary span { float: right; color: var(--ink-soft); font-size: 0.72rem; text-transform: uppercase; }
pre { max-height: 440px; margin: 0 0 18px; padding: 18px; overflow: auto; background: #111a17; color: #dfeae5; border-left: 5px solid var(--accent); line-height: 1.55; tab-size: 2; }
.pathology-verdict { display: flex; justify-content: space-between; align-items: baseline; gap: 24px; margin-bottom: 24px; padding: 18px 20px; border: 1px solid var(--accent); color: var(--accent); }
.pathology-verdict.fail { border-color: var(--danger); color: var(--danger); }
.pathology-verdict span { font: 0.7rem ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.1em; }
.pathology-verdict strong { font: 700 clamp(1.8rem, 4vw, 3.4rem)/1 "Arial Narrow", sans-serif; }
blockquote { margin: 26px 0 0; padding: 22px 26px; border-left: 6px solid var(--outcome-color, var(--accent)); font-size: 1.2rem; line-height: 1.45; background: var(--paper-raised); }
.empty-reading { margin: 0; font-size: 1.2rem; }
.discharge-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; margin-bottom: 28px; background: var(--rule); border: 1px solid var(--rule); }
.discharge-grid div { padding: 22px; background: var(--paper-raised); }
.discharge-grid span, .merge-check span { display: block; margin-bottom: 12px; color: var(--ink-soft); font-size: 0.65rem; }
.discharge-grid strong { font: 700 clamp(1.5rem, 3vw, 2.4rem) "Arial Narrow", sans-serif; }
.merge-check { margin-bottom: 28px; }
.merge-check p { max-width: 800px; margin: 0; font-size: 1.1rem; line-height: 1.55; }
.ledger code { overflow-wrap: anywhere; }
.case-footer { padding: 22px 8px; color: var(--ink-soft); font: 0.72rem ui-monospace, monospace; }
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #101714;
    --paper-raised: #18211d;
    --ink: #e9f1ed;
    --ink-soft: #a1b1aa;
    --accent: #55c9ba;
    --danger: #f07887;
    --rule: #34473f;
  }
}
@media (max-width: 720px) {
  .case-file { width: min(100% - 24px, 1180px); margin-top: 12px; }
  .docket { min-height: 0; grid-template-columns: 1fr; gap: 30px; padding: 32px 24px; box-shadow: 5px 5px 0 var(--rule); }
  .eyebrow { margin-bottom: 34px; }
  .verdict { min-width: 0; }
  .sheet { grid-template-columns: 1fr; }
  .section-label { display: flex; align-items: center; gap: 12px; padding: 28px 4px 0; }
  .section-label h2 { margin: 0; }
  .section-body { padding: 24px 4px 34px; border-left: 0; }
  .facts div { grid-template-columns: 1fr; gap: 7px; }
  .discharge-grid { grid-template-columns: 1fr; }
  .pathology-verdict { align-items: flex-start; flex-direction: column; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }
@media print { .case-file { width: 100%; margin: 0; } .docket { box-shadow: none; } details { break-inside: avoid; } }
`;

export function renderCaseFile(caseFile: CaseFile): string {
  const patchSections =
    caseFile.outcome === 'flaky-no-patch' || caseFile.outcome === 'infra-stop'
      ? `${renderCounterfactual(caseFile)}${renderDischarge(caseFile)}`
      : `${renderProcedure(caseFile)}${renderPathology(caseFile)}${renderCounterfactual(caseFile)}${renderDischarge(caseFile)}`;
  const risk =
    caseFile.outcome === 'fixed'
      ? 'Merge risk: pathology passed. Human review remains required.'
      : mergeGuidance(caseFile);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Sutura case ${escapeHtml(caseFile.runId)}</title>
  <style>${STYLES}</style>
</head>
<body class="outcome-${escapeHtml(caseFile.outcome)}">
  <main class="case-file">
    <header class="docket">
      <div>
        <p class="eyebrow">Sutura · Surgical CI case file</p>
        <h1>Case ${escapeHtml(caseFile.runId)}</h1>
        <p class="case-meta"><code>${escapeHtml(caseFile.repo)}</code> · ${escapeHtml(caseFile.diagnosis.class)} · ${formatConfidence(caseFile.diagnosis.confidence)} confidence</p>
      </div>
      <div class="verdict">
        <small>Operative verdict</small>
        <strong>${outcomeLabel(caseFile.outcome)}</strong>
        <p>${escapeHtml(risk)}</p>
      </div>
    </header>
    ${renderDiagnosis(caseFile)}${renderRecovery(caseFile)}
    ${renderTriage(caseFile)}${patchSections ? `
    ${patchSections}` : ''}
    <footer class="case-footer">Generated by Sutura · Inference cost ${formatUsd(caseFile.cost.totalUsd())} · Human review required</footer>
  </main>
</body>
</html>`;
}
