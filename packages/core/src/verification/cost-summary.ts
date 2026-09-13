import type { VerificationCosts } from './types.js';

export interface VerificationCostSummary {
  inferenceUsd: number | null;
  sandboxUsd: number | null;
  status: 'observed' | 'partial' | 'unavailable';
}

/** Null propagates missing estimates or incompatible/unconfirmed billing units. */
export function summarizeVerificationCosts(costs: VerificationCosts): VerificationCostSummary {
  const inferenceUsd = costs.inference === null || costs.inference.some((item) => item.estimateUsd === null)
    ? null : costs.inference.reduce((sum, item) => sum + item.estimateUsd!, 0);
  const sandboxUsd = costs.sandbox === null || costs.sandbox.some((item) => item.billed?.currency !== 'USD')
    ? null : costs.sandbox.reduce((sum, item) => sum + item.billed!.amount, 0);
  return {
    inferenceUsd, sandboxUsd,
    status: inferenceUsd === null && sandboxUsd === null ? 'unavailable'
      : inferenceUsd === null || sandboxUsd === null ? 'partial' : 'observed',
  };
}
