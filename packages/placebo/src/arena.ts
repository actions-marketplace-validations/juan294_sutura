import { createHash } from 'node:crypto';

import { canonicalJson } from '@sutura/evaluation';

import {
  comparisonSummary,
  validateComparison,
  type ComparisonArm,
  type ComparisonArmSummary,
  type ComparisonManifest,
  type ComparisonObservation,
} from './comparison.js';
import type { CounterfactualReport } from './counterfactual.js';
import type { ArenaSelectionManifest } from './selection.js';

export const ARENA_REPORT_SCHEMA_VERSION = 'sutura-arena-report-v1' as const;

export interface ArenaGroupedRate {
  key: string;
  arm: ComparisonArm;
  approved: number;
  of: number;
}

export interface ArenaMeasures {
  arms: ComparisonArmSummary[];
  byLanguage: ArenaGroupedRate[];
  byFailureClass: ArenaGroupedRate[];
  refusalReasons: Array<{ arm: ComparisonArm; outcome: string; count: number }>;
  completeFailures: string[];
  tokenTotals: { inferenceUsd: number; sandboxOperations: number };
}

export interface ArenaCounterfactualSummary {
  schemaVersion: string;
  resultHash: string;
  cases: number;
  alternatives: number;
  rejected: number;
  shortcutsRejected: number;
  gates: string[];
}

export interface ArenaReport {
  schemaVersion: typeof ARENA_REPORT_SCHEMA_VERSION;
  comparison: ComparisonManifest;
  selection?: ArenaSelectionManifest;
  counterfactual?: ArenaCounterfactualSummary;
  measures: ArenaMeasures;
  complete: boolean;
  /**
   * A banner rendered above every number. Set it whenever the arms did not
   * come from real Sutura runs, so a control artifact can never be read as a
   * product claim.
   */
  note?: string;
  generatedAt: string;
  resultHash: string;
}

export class ArenaReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArenaReportError';
  }
}

export interface ArenaReportOptions {
  selection?: ArenaSelectionManifest;
  counterfactual?: CounterfactualReport;
  allowIncomplete?: boolean;
  /** Banner text for a control or otherwise non-product comparison. */
  note?: string;
  generatedAt?: string;
}

function groupedRate(
  manifest: ComparisonManifest,
  key: (observation: ComparisonObservation) => string,
): ArenaGroupedRate[] {
  const keys = [...new Set(manifest.arms.flatMap(({ observations }) => observations.map(key)))].sort();
  return manifest.arms.flatMap((arm) => keys.map((group) => {
    const members = arm.observations.filter((observation) => key(observation) === group);
    return {
      key: group,
      arm: arm.arm,
      approved: members.filter(({ approved }) => approved).length,
      of: members.length,
    };
  }));
}

function normalizedForHash(report: Omit<ArenaReport, 'resultHash'>): unknown {
  return {
    ...report,
    generatedAt: '[normalized-time]',
    measures: {
      ...report.measures,
      arms: report.measures.arms.map((arm) => ({
        ...arm,
        medianElapsedTimeSec: 0,
        p95ElapsedTimeSec: 0,
      })),
    },
  };
}

export function arenaReport(
  manifest: ComparisonManifest,
  options: ArenaReportOptions = {},
): ArenaReport {
  validateComparison(manifest);
  if (!manifest.complete && options.allowIncomplete !== true) {
    throw new ArenaReportError(
      'The Arena refuses an incomplete comparison; pass allowIncomplete to publish a labelled draft',
    );
  }
  const arms = comparisonSummary(manifest);
  const completeFailures = [...new Set(
    manifest.invariants.caseIds.filter((caseId) =>
      manifest.arms.every((arm) =>
        arm.observations.find((observation) => observation.caseId === caseId)?.approved !== true)),
  )].sort();
  const refusalReasons = manifest.arms.flatMap((arm) => {
    const counts = new Map<string, number>();
    for (const observation of arm.observations) {
      if (observation.approved) continue;
      counts.set(observation.outcome, (counts.get(observation.outcome) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([outcome, count]) => ({ arm: arm.arm, outcome, count }));
  });

  const base: Omit<ArenaReport, 'resultHash'> = {
    schemaVersion: ARENA_REPORT_SCHEMA_VERSION,
    comparison: manifest,
    ...(options.selection === undefined ? {} : { selection: options.selection }),
    ...(options.counterfactual === undefined ? {} : {
      counterfactual: {
        schemaVersion: options.counterfactual.schemaVersion,
        resultHash: options.counterfactual.resultHash,
        cases: options.counterfactual.totals.cases,
        alternatives: options.counterfactual.totals.alternatives,
        rejected: options.counterfactual.totals.rejected,
        shortcutsRejected: options.counterfactual.totals.shortcutsRejected,
        gates: [...new Set(options.counterfactual.cases.flatMap(({ alternatives }) =>
          alternatives.flatMap(({ observed }) => observed ? [observed.gate] : [])))].sort(),
      },
    }),
    measures: {
      arms,
      byLanguage: groupedRate(manifest, ({ language }) => language),
      byFailureClass: groupedRate(manifest, ({ failureClass }) => failureClass),
      refusalReasons,
      completeFailures,
      tokenTotals: {
        inferenceUsd: manifest.arms.reduce((total, arm) => total + arm.totals.inferenceUsd, 0),
        sandboxOperations: manifest.arms.reduce(
          (total, arm) => total + arm.totals.sandboxOperations, 0,
        ),
      },
    },
    complete: manifest.complete,
    ...(options.note === undefined ? {} : { note: options.note }),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  };
  return {
    ...base,
    resultHash: createHash('sha256').update(canonicalJson(normalizedForHash(base))).digest('hex'),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function interval(summary: { value: number; lower: number; upper: number }): string {
  return `${percent(summary.value)} <small>(95% ${percent(summary.lower)}–${percent(summary.upper)})</small>`;
}

const STYLES = `
:root {
  color-scheme: light dark;
  --paper: #f4f8f6; --paper-raised: #ffffff; --ink: #17221e; --ink-soft: #53635c;
  --accent: #08766c; --danger: #a93645; --rule: #c9d7d1;
  font-family: Charter, "Bitstream Charter", "Sitka Text", Georgia, serif;
  background: var(--paper); color: var(--ink);
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); }
.arena { width: min(1180px, calc(100% - 40px)); margin: 28px auto 72px; }
header.docket { padding: clamp(24px, 5vw, 56px); border: 1px solid var(--ink); background: var(--paper-raised); box-shadow: 9px 9px 0 var(--rule); }
h1 { margin: 0; font-family: "Arial Narrow", "Roboto Condensed", sans-serif; text-transform: uppercase; font-size: clamp(2.4rem, 6vw, 5rem); line-height: 0.9; letter-spacing: -0.04em; }
h2 { margin: 40px 0 12px; font-family: "Arial Narrow", "Roboto Condensed", sans-serif; text-transform: uppercase; letter-spacing: 0.04em; font-size: 1.15rem; }
.eyebrow, .micro-label, dt { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.68rem; color: var(--ink-soft); }
.draft { margin: 18px 0 0; padding: 14px 18px; border: 1px solid var(--danger); color: var(--danger); }
.facts { margin: 24px 0 0; }
.facts div { display: grid; grid-template-columns: minmax(150px, 0.3fr) 1fr; gap: 20px; padding: 10px 0; border-top: 1px solid var(--rule); }
.facts dd { margin: 0; overflow-wrap: anywhere; }
.headline { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1px; margin: 24px 0 0; background: var(--rule); border: 1px solid var(--rule); }
.headline div { padding: 20px; background: var(--paper-raised); }
.headline strong { display: block; margin-top: 8px; font: 700 clamp(1.4rem, 3vw, 2.2rem) "Arial Narrow", sans-serif; }
.headline small { color: var(--ink-soft); font-size: 0.72rem; }
.table-wrap { max-width: 100%; overflow-x: auto; border: 1px solid var(--rule); }
table { width: 100%; min-width: 640px; border-collapse: collapse; text-align: left; font-size: 0.88rem; }
th, td { padding: 12px 14px; border-bottom: 1px solid var(--rule); vertical-align: top; }
thead th { font: 0.65rem ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-soft); }
tbody tr:last-child > * { border-bottom: 0; }
code { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: 0.85em; overflow-wrap: anywhere; }
.zero { color: var(--accent); font-weight: 700; }
.nonzero { color: var(--danger); font-weight: 700; }
footer { margin-top: 44px; padding-top: 20px; border-top: 1px solid var(--rule); color: var(--ink-soft); font: 0.74rem ui-monospace, monospace; }
footer code { color: var(--ink); }
@media (prefers-color-scheme: dark) {
  :root { --paper: #101714; --paper-raised: #18211d; --ink: #e9f1ed; --ink-soft: #a1b1aa; --accent: #55c9ba; --danger: #f07887; --rule: #34473f; }
}
@media (max-width: 720px) {
  .arena { width: min(100% - 24px, 1180px); }
  header.docket { padding: 26px 20px; box-shadow: 5px 5px 0 var(--rule); }
  .facts div { grid-template-columns: 1fr; gap: 6px; }
}
`;

function armTable(report: ArenaReport): string {
  const rows = report.measures.arms.map((arm) => `<tr>
        <th scope="row"><code>${escapeHtml(arm.arm)}</code>${arm.derived ? ' <small>derived</small>' : ''}</th>
        <td>${interval(arm.repairRate)}</td>
        <td>${interval(arm.catchRate)}</td>
        <td class="${arm.falseApprovals === 0 ? 'zero' : 'nonzero'}">${arm.falseApprovals}</td>
        <td>${interval(arm.flakeAccuracy)}</td>
        <td>${arm.medianElapsedTimeSec.toFixed(2)} s</td>
        <td>${arm.p95ElapsedTimeSec.toFixed(2)} s</td>
        <td>$${arm.inferenceUsd.toFixed(4)}</td>
        <td>${arm.sandboxOperations}</td>
        <td>${arm.notRun}</td>
      </tr>`).join('');
  return `<div class="table-wrap"><table>
      <thead><tr><th>Arm</th><th>Repair rate</th><th>Catch rate</th><th>False approvals</th><th>Flake accuracy</th><th>Median latency</th><th>p95 latency</th><th>Inference</th><th>Sandbox ops</th><th>Not run</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function groupedTable(title: string, rows: readonly ArenaGroupedRate[]): string {
  const body = rows.map((row) => `<tr>
        <th scope="row">${escapeHtml(row.key)}</th>
        <td><code>${escapeHtml(row.arm)}</code></td>
        <td>${row.approved} / ${row.of}</td>
      </tr>`).join('');
  return `<h2>${escapeHtml(title)}</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Group</th><th>Arm</th><th>Approved</th></tr></thead>
      <tbody>${body || '<tr><td colspan="3">No observations recorded</td></tr>'}</tbody>
    </table></div>`;
}

export function renderArena(report: ArenaReport): string {
  const { invariants } = report.comparison;
  const sutura = report.measures.arms.find(({ arm }) => arm === 'sutura');
  const baseline = report.measures.arms.find(({ arm }) => arm === 'single-branch');
  const naive = report.measures.arms.find(({ arm }) => arm === 'first-green-wins');
  const counterfactual = report.counterfactual;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Sutura Arena ${escapeHtml(report.comparison.comparisonId)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <main class="arena">
    <header class="docket">
      <p class="eyebrow">Sutura Arena · controlled search comparison</p>
      <h1>${escapeHtml(report.comparison.comparisonId)}</h1>
      ${report.note === undefined ? '' : `<p class="draft">${escapeHtml(report.note)}</p>`}
      ${report.complete ? '' : '<p class="draft">Incomplete comparison. At least one arm did not cover every case, or an observation was not run. Every number below is a draft.</p>'}
      <p>Every arm below ran the same ${invariants.caseIds.length} cases, the same models, the same routing profile, the same budget profile, and the same scoring contract. The only difference between executed arms is the search shape.</p>
      <dl class="facts">
        <div><dt>Sutura commit</dt><dd><code>${escapeHtml(invariants.suturaCommit)}</code></dd></div>
        <div><dt>Corpus</dt><dd><code>${escapeHtml(invariants.corpusName)}</code> v${escapeHtml(invariants.corpusVersion)} · <code>${escapeHtml(invariants.corpusHash)}</code></dd></div>
        <div><dt>Models</dt><dd><code>${escapeHtml(invariants.models.nano)}</code> · <code>${escapeHtml(invariants.models.super)}</code> · <code>${escapeHtml(invariants.models.ultra)}</code></dd></div>
        <div><dt>Routing profile</dt><dd><code>${escapeHtml(invariants.routingProfile)}</code></dd></div>
        <div><dt>Budget profile</dt><dd><code>${escapeHtml(invariants.budgetProfileHash)}</code></dd></div>
        <div><dt>Score contract</dt><dd><code>${escapeHtml(invariants.scoreContractVersion)}</code></dd></div>
        <div><dt>Grounding</dt><dd>${invariants.tavilyEnabled ? 'Tavily enabled' : 'Tavily disabled'}</dd></div>
      </dl>
    </header>

    <div class="headline">
      <div><span class="micro-label">Sutura repair rate</span><strong>${sutura ? interval(sutura.repairRate) : '—'}</strong></div>
      <div><span class="micro-label">Single-branch repair rate</span><strong>${baseline ? interval(baseline.repairRate) : '—'}</strong></div>
      <div><span class="micro-label">Sutura false approvals</span><strong class="${sutura && sutura.falseApprovals === 0 ? 'zero' : 'nonzero'}">${sutura?.falseApprovals ?? '—'}</strong></div>
      <div><span class="micro-label">First-green-wins false approvals</span><strong class="${naive && naive.falseApprovals === 0 ? 'zero' : 'nonzero'}">${naive?.falseApprovals ?? '—'}</strong><small>Accepts the first green patch with no mechanical check, no fresh rerun, and no adversarial audit.</small></div>
    </div>

    <h2>Why green is not sufficient</h2>
    ${counterfactual
      ? `<p>${counterfactual.rejected} of ${counterfactual.alternatives} alternative patches across ${counterfactual.cases} cases were rejected, including ${counterfactual.shortcutsRejected} declared shortcuts, by ${escapeHtml(counterfactual.gates.join(', '))}. Counterfactual evidence <code>${escapeHtml(counterfactual.resultHash)}</code>.</p>`
      : '<p>No counterfactual evidence was supplied with this comparison.</p>'}

    <h2>Measures by arm</h2>
    ${armTable(report)}

    ${groupedTable('Results by language', report.measures.byLanguage)}
    ${groupedTable('Results by failure class', report.measures.byFailureClass)}

    <h2>Complete failures and refusal reasons</h2>
    <p>${report.measures.completeFailures.length} case${report.measures.completeFailures.length === 1 ? '' : 's'} no arm repaired. No failed case is removed from any denominator.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Case</th></tr></thead>
      <tbody>${report.measures.completeFailures.map((caseId) => `<tr><th scope="row"><code>${escapeHtml(caseId)}</code></th></tr>`).join('') || '<tr><td>Every case was repaired by at least one arm</td></tr>'}</tbody>
    </table></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Arm</th><th>Outcome</th><th>Cases</th></tr></thead>
      <tbody>${report.measures.refusalReasons.map((row) => `<tr>
        <th scope="row"><code>${escapeHtml(row.arm)}</code></th>
        <td>${escapeHtml(row.outcome)}</td>
        <td>${row.count}</td>
      </tr>`).join('') || '<tr><td colspan="3">No refusals recorded</td></tr>'}</tbody>
    </table></div>

    <footer>
      <p>Reproduce: <code>placebo compare --arm sutura --arm single-branch --arm fixed-parallel --arm first-green-wins --output-json arena.json</code> then <code>placebo arena --comparison arena.json --output-json report.json --output-html report.html</code></p>
      <p>Comparison hash <code>${escapeHtml(report.comparison.resultHash)}</code> · report hash <code>${escapeHtml(report.resultHash)}</code>${report.selection ? ` · selection hash <code>${escapeHtml(report.selection.resultHash)}</code>` : ''}</p>
    </footer>
  </main>
</body>
</html>`;
}
