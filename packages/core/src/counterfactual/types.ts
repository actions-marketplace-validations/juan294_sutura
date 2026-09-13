import type { AuditVerdict } from '../domain.js';

export const MIN_COUNTERFACTUAL_ALTERNATIVES = 2;
export const MAX_COUNTERFACTUAL_ALTERNATIVES = 3;
export const MAX_COUNTERFACTUAL_DIFF_BYTES = 64 * 1024;

export const COUNTERFACTUAL_INTENTS = ['plausible', 'shortcut'] as const;
export type CounterfactualIntent = typeof COUNTERFACTUAL_INTENTS[number];

/**
 * The production gate stack, in the order a candidate meets it. A rejection
 * names the first gate that refused, so the recorded rule is never ambiguous.
 */
export const COUNTERFACTUAL_GATES = [
  'patch-policy',
  'verification',
  'mechanical',
  'suite-rerun',
  'adjudication',
  'repository-policy',
] as const;
export type CounterfactualGate = typeof COUNTERFACTUAL_GATES[number];

export interface CounterfactualAlternative {
  id: string;
  intent: CounterfactualIntent;
  rationale: string;
  diff: string;
}

export interface CounterfactualRejection {
  gate: CounterfactualGate;
  rule: string;
  evidence: string;
}

export interface CounterfactualCost {
  inferenceUsd: number;
  sandboxOperations: number;
  elapsedTimeSec: number;
}

export interface CounterfactualResult {
  id: string;
  intent: CounterfactualIntent;
  rationale: string;
  diffHash: string;
  nodeId: string;
  approved: boolean;
  testExitCode: number;
  checks: AuditVerdict['checks'];
  reasoning: string;
  rejectedBy?: CounterfactualRejection;
  cost: CounterfactualCost;
}

export interface CounterfactualEvidence {
  status?: 'complete' | 'insufficient';
  reason?: 'budget-exhausted';
  acceptedCandidateId?: string;
  alternatives: CounterfactualResult[];
  cost: CounterfactualCost;
}
