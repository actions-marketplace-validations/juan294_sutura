import type { AuditVerdict } from '../domain.js';
import type { SecondOpinionResult } from './adjudicate.js';
import { typesafeAuditEvidence, type TypeSafeAuditResult } from './typesafe-audit.js';

export type VetoVoiceRow = AuditVerdict['checks'][number];

/** The optional voice that actively refused, named the way the verdict reasoning attributes it. */
export interface VetoedBy {
  label: 'second opinion' | 'calibrated audit';
  model: string;
  reasoning: string;
}

/** The evidence string for the second-opinion row, symmetric with typesafeAuditEvidence. */
export function secondOpinionEvidence(result: SecondOpinionResult): string {
  return `${result.model}: ${result.status}: ${result.reasoning}`;
}

/**
 * Composes the optional veto-only voices (GPT-6 Astra second opinion, TypeSafe
 * Jev calibrated audit) into their check rows and the first active refusal.
 * A row is always present, `skipped` or `uncertain` when the voice did not veto;
 * only `refused` fails a row. Order is the order the voices were consulted.
 */
export function vetoVoiceRows(
  second: SecondOpinionResult,
  third: TypeSafeAuditResult,
): { rows: VetoVoiceRow[]; vetoedBy: VetoedBy | undefined } {
  const voices = [
    { name: 'second-opinion' as const, label: 'second opinion' as const, result: second, evidence: secondOpinionEvidence(second) },
    { name: 'typesafe-audit' as const, label: 'calibrated audit' as const, result: third, evidence: typesafeAuditEvidence(third) },
  ];
  const rows = voices.map(({ name, result, evidence }) => ({ name, passed: result.status !== 'refused', evidence }));
  const vetoed = voices.find(({ result }) => result.status === 'refused');
  return {
    rows,
    vetoedBy: vetoed === undefined ? undefined : { label: vetoed.label, model: vetoed.result.model, reasoning: vetoed.result.reasoning },
  };
}
