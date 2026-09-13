import type { CaseFile } from '../domain.js';

/** Shared public wording for the HTML and Markdown views; each renderer escapes it. */
export function recoverySummary(caseFile: Pick<CaseFile, 'recovery' | 'verification'>): string[] {
  const recovery = caseFile.recovery ?? caseFile.verification?.recovery;
  if (recovery === undefined) return [];
  return [
    `Initial diagnosis retained: ${recovery.initialClass}. Recovery: ${recovery.status} — ${recovery.reason}.`,
    `Observed command: ${recovery.observedCommand}`,
    ...(recovery.executedCommand === recovery.observedCommand ? [] : [`Executed command: ${recovery.executedCommand}`]),
    ...recovery.hypotheses.slice(1).map((hypothesis) => `Alternative ${hypothesis.id}: ${hypothesis.class}; ${hypothesis.intent}; ${hypothesis.path}; ${hypothesis.status} — ${hypothesis.reason}. Signal: ${hypothesis.signal}`),
    ...recovery.authorizations.map((grant) => `Controller grant: ${grant.kind} at ${grant.path}${grant.strictKey === undefined ? '' : ` (${grant.strictKey})`}; source excerpt ${grant.excerptSha256}; probe ${grant.probeId}; baseline ${grant.baseline.kind} ${grant.baseline.baselineImageId}; policy ${grant.baseline.policySha256}.`),
    'These bounded observations do not measure live repair quality.',
  ];
}
