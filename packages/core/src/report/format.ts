import type { CaseFile, RaceResult } from '../domain.js';
import { findSelectedCandidate } from '../engine/candidate-identity.js';
import { selectWinner } from '../engine/repair.js';

const STAGE_BY_ROLE = {
  nano: 'Diagnosis',
  super: 'Procedure',
  ultra: 'Pathology',
} as const;

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}

export function escapeMarkdown(value: string): string {
  return value
    .replace(/[\\`*_[\]<>]/g, '\\$&')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

export function safeWebUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

export interface StageTotals {
  elapsedTimeSec: number;
  cpuTimeSec: number;
  maxRssKb: number;
  sandboxCostUsd: number;
  operationCount: number;
}

export function aggregateStageEvidence(caseFile: CaseFile): StageTotals {
  return caseFile.stages.reduce<StageTotals>((totals, entry) => ({
    elapsedTimeSec: totals.elapsedTimeSec + (entry.metrics.elapsedTimeSec ?? 0),
    cpuTimeSec: totals.cpuTimeSec +
      (entry.metrics.systemCpuTimeSec ?? 0) +
      (entry.metrics.userCpuTimeSec ?? 0),
    maxRssKb: Math.max(totals.maxRssKb, entry.metrics.maxRssKb ?? 0),
    sandboxCostUsd: totals.sandboxCostUsd + (entry.metrics.cost ?? 0),
    operationCount: totals.operationCount + 1,
  }), {
    elapsedTimeSec: 0,
    cpuTimeSec: 0,
    maxRssKb: 0,
    sandboxCostUsd: 0,
    operationCount: 0,
  });
}

export function stageForRole(role: keyof typeof STAGE_BY_ROLE): string {
  return STAGE_BY_ROLE[role];
}

export function outcomeLabel(outcome: CaseFile['outcome']): string {
  return {
    fixed: 'PATCH CERTIFIED',
    'flaky-no-patch': 'FLAKY — NO PATCH',
    refused: 'PATCH REFUSED',
    'gave-up': 'NO PATCH HELD',
    'infra-stop': 'INFRA — STOPPED',
  }[outcome];
}

export function triageSentence(caseFile: CaseFile): string {
  if (caseFile.outcome === 'infra-stop') {
    if (caseFile.diagnosis.signals.includes('sandbox-preparation:failed')) {
      return 'Sandbox dependency preparation failed. Sutura stopped before reproduction and inference.';
    }
    return 'The failing command passed in a clean sandbox reproduction. Sutura stopped before inference.';
  }
  const {
    reproduced, of, status, maximumAttempts, reproductionProbability,
    confidenceLower, confidenceUpper, stopReason, methodVersion,
  } = caseFile.triage;
  const evidence = `Reproduced ${reproduced}/${of} (maximum ${maximumAttempts}); ` +
    `probability ${(reproductionProbability * 100).toFixed(1)}% ` +
    `(95% Wilson ${(confidenceLower * 100).toFixed(1)}–${(confidenceUpper * 100).toFixed(1)}%); ` +
    `${methodVersion}; ${stopReason}`;
  if (status === 'flaky') {
    return `${evidence} — flaky. No patch proposed.`;
  }
  if (status === 'intermittent') {
    return `${evidence} — intermittent.`;
  }
  return `${evidence} — real.`;
}

export function raceNote(result: RaceResult): string {
  if (result.note) return result.note;
  if (result.held) return 'Survived the verification race';
  if (result.exitCode === 0) return 'Rolled back after comparison';
  return `Rolled back; verification exited ${result.exitCode}`;
}

export function diffSummary(caseFile: CaseFile): string {
  const selected = caseFile.selectedCandidate;
  const winner = selected === undefined
    ? selectWinner(caseFile.race)
    : findSelectedCandidate(caseFile.race, selected);
  if (!winner) return 'No candidate patch survived.';

  const lines = winner.candidate.diff.split(/\r?\n/);
  const added = lines.filter(
    (line) => line.startsWith('+') && !line.startsWith('+++'),
  ).length;
  const removed = lines.filter(
    (line) => line.startsWith('-') && !line.startsWith('---'),
  ).length;
  return `${winner.candidate.id}: +${added} / −${removed} lines`;
}

/**
 * States, from the recorded gates alone, why a green suite is not sufficient.
 * Never asserts a claim the evidence does not carry.
 */
export function counterfactualLede(caseFile: CaseFile): string {
  const alternatives = caseFile.counterfactual?.alternatives ?? [];
  if (alternatives.length === 0) return '';
  const rejected = alternatives.filter(({ approved }) => !approved);
  if (rejected.length === 0) {
    return `Every one of the ${alternatives.length} alternatives passed the same gates as the accepted patch.`;
  }
  const gates = [...new Set(rejected.flatMap(({ rejectedBy }) => rejectedBy ? [rejectedBy.gate] : []))].sort();
  const shortcuts = rejected.filter(({ intent }) => intent === 'shortcut').length;
  const greenButRejected = rejected.filter(
    ({ testExitCode, rejectedBy }) => testExitCode === 0 && rejectedBy?.gate !== 'verification',
  ).length;
  const green = greenButRejected === 0
    ? ''
    : ` ${greenButRejected} of them made the diagnosed command exit 0 and were still refused.`;
  return `${rejected.length} of ${alternatives.length} alternatives were rejected` +
    `${shortcuts === 0 ? '' : `, including ${shortcuts} declared shortcut${shortcuts === 1 ? '' : 's'}`}` +
    `, by ${gates.join(', ')}.${green}`;
}

export function mergeGuidance(caseFile: CaseFile): string {
  switch (caseFile.outcome) {
    case 'fixed':
      return 'Confirm the surviving diff matches the diagnosed API change, then merge only if the cited checks remain green.';
    case 'refused':
      return 'Do not merge this candidate. Restore the behavior named in the failed pathology checks.';
    case 'gave-up':
      return 'No candidate is safe to merge. Inspect the diagnosis and start a new repair cycle with more evidence.';
    case 'flaky-no-patch':
      return 'No patch exists to merge. Investigate the timing boundary and rerun with the same commit.';
    case 'infra-stop':
      return 'No patch exists to merge. Inspect the CI infrastructure and the difference between the failing runner and the clean sandbox.';
  }
}

export { recoverySummary } from './recovery-summary.js';
