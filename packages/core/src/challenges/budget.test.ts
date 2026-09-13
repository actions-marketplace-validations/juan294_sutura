import { describe, expect, it } from 'vitest';

import { RepairBudget } from '../engine/repair-budget.js';
import { CHALLENGE_REPETITIONS, MAX_RETAINED_CHALLENGES } from './generate.js';
import { reserveChallengeCapacity, type ChallengeBudgetRequest } from './budget.js';

const AUDIT = { modelTurns: 2, sandboxOperations: 4, inferenceCostUsd: 0.05 };
const GENERATION = { modelTurns: 1, inferenceCostUsd: 0.02 };
const PER_OBSERVATION = { sandboxOperations: 1 };

/** Limits can only be lowered from the defaults, never raised. */
function budget(overrides: Record<string, number> = {}): RepairBudget {
  return new RepairBudget(overrides);
}

function request(overrides: Partial<ChallengeBudgetRequest> = {}): ChallengeBudgetRequest {
  return {
    budget: budget(),
    auditReserve: AUDIT,
    generation: GENERATION,
    perObservation: PER_OBSERVATION,
    subjects: 2,
    proposals: 3,
    ...overrides,
  };
}

describe('challenge budget reservation', () => {
  it('reserves the audit first and then affordable challenge work', () => {
    const outcome = reserveChallengeCapacity(request());

    expect(outcome.status).toBe('planned');
    if (outcome.status !== 'planned') return;
    expect(outcome.retained).toBe(3);
    expect(outcome.reduced).toBe(false);
    expect(outcome.auditReservation).toBeDefined();
    expect(outcome.challengeReservation).not.toBe(outcome.auditReservation);
  });

  it('never retains more than the frozen challenge limit', () => {
    const outcome = reserveChallengeCapacity(request({ proposals: 99 }));

    expect(outcome.status === 'planned' && outcome.retained).toBe(MAX_RETAINED_CHALLENGES);
  });

  it('reduces retention before freezing when the remainder cannot cover every proposal', () => {
    // Audit takes 4 operations; one challenge costs subjects * repetitions = 4.
    const outcome = reserveChallengeCapacity(request({
      budget: budget({ sandboxOperations: 9 }),
    }));

    expect(outcome.status).toBe('planned');
    if (outcome.status !== 'planned') return;
    expect(outcome.retained).toBe(1);
    expect(outcome.reduced).toBe(true);
  });

  it('prices every subject and both repetitions of each retained challenge', () => {
    const twoSubjects = reserveChallengeCapacity(request({
      budget: budget({ sandboxOperations: 4 + 2 * CHALLENGE_REPETITIONS * 2 }), proposals: 2,
    }));
    const threeSubjects = reserveChallengeCapacity(request({
      budget: budget({ sandboxOperations: 4 + 2 * CHALLENGE_REPETITIONS * 2 }),
      proposals: 2,
      subjects: 3,
    }));

    expect(twoSubjects.status === 'planned' && twoSubjects.retained).toBe(2);
    expect(threeSubjects.status === 'planned' && threeSubjects.retained).toBe(1);
  });

  it.each([
    ['sandbox operations', { sandboxOperations: 3 }],
    ['model turns', { modelTurns: 1 }],
    ['inference spend', { inferenceCostUsd: 0.04 }],
  ])('refuses before generation when %s cannot cover the audit reserve', (_name, limits) => {
    const outcome = reserveChallengeCapacity(request({ budget: budget(limits) }));

    expect(outcome).toEqual({ status: 'insufficient', reasonCode: 'audit-reserve-unavailable' });
    expect(outcome.status === 'insufficient' && outcome.auditReservation).toBeUndefined();
  });

  it('keeps the audit reserve when no challenge is affordable', () => {
    const outcome = reserveChallengeCapacity(request({
      budget: budget({ modelTurns: 2 }),
    }));

    expect(outcome.status).toBe('insufficient');
    if (outcome.status !== 'insufficient') return;
    expect(outcome.reasonCode).toBe('generation-unaffordable');
    expect(outcome.auditReservation).toBeDefined();
  });

  it('reports no affordable challenge when generation fits but observations do not', () => {
    const outcome = reserveChallengeCapacity(request({
      budget: budget({ sandboxOperations: 4 }),
    }));

    expect(outcome.status).toBe('insufficient');
    if (outcome.status !== 'insufficient') return;
    expect(outcome.reasonCode).toBe('no-affordable-challenge');
    expect(outcome.auditReservation).toBeDefined();
  });

  it('leaves the audit reserve spendable after refusing challenge work', () => {
    const shared = budget({ sandboxOperations: 4 });
    const outcome = reserveChallengeCapacity(request({ budget: shared }));

    expect(outcome.status).toBe('insufficient');
    if (outcome.status !== 'insufficient' || outcome.auditReservation === undefined) return;
    // The audit can still spend exactly what was held for it, and no more.
    for (let index = 0; index < 4; index += 1) {
      expect(() => { shared.reserveSandboxOperation(outcome.auditReservation!); }).not.toThrow();
    }
    expect(() => { shared.reserveSandboxOperation(outcome.auditReservation!); }).toThrow();
  });

  it('raises no limit to make a plan fit', () => {
    const shared = budget({ sandboxOperations: 9 });
    const outcome = reserveChallengeCapacity(request({ budget: shared }));

    expect(outcome.status).toBe('planned');
    expect(shared.limits.sandboxOperations).toBe(9);
    // Held reservations count against the limit; the plan fits inside it rather
    // than widening it.
    expect(shared.snapshot().sandboxOperations).toBeLessThanOrEqual(9);
    // A limit above the frozen default is refused outright, so no plan can raise one.
    expect(() => new RepairBudget({ sandboxOperations: 1_000 })).toThrow(/at most/u);
  });

  it('refuses when there is nothing to run', () => {
    expect(reserveChallengeCapacity(request({ proposals: 0 })))
      .toMatchObject({ status: 'insufficient', reasonCode: 'no-affordable-challenge' });
    expect(reserveChallengeCapacity(request({ subjects: 0 })))
      .toMatchObject({ status: 'insufficient', reasonCode: 'no-affordable-challenge' });
  });

  it('accounts for alternatives as additional subjects', () => {
    const withAlternatives = reserveChallengeCapacity(request({
      budget: budget({ sandboxOperations: 4 + 4 }), subjects: 4, proposals: 3,
    }));

    // Four subjects times two repetitions is eight observations for one challenge.
    expect(withAlternatives.status).toBe('insufficient');
  });
});
