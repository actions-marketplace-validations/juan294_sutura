import {
  BudgetExceededError,
  type RepairBudget,
  type RepairCapacity,
  type RepairCapacityReservation,
} from '../engine/repair-budget.js';
import { CHALLENGE_REPETITIONS, MAX_RETAINED_CHALLENGES } from './generate.js';

export type ChallengeBudgetReasonCode =
  | 'audit-reserve-unavailable'
  | 'generation-unaffordable'
  | 'no-affordable-challenge';

export interface ChallengeBudgetPlan {
  status: 'planned';
  /** Held for the mandatory audit; never spent on challenge work. */
  auditReservation: RepairCapacityReservation;
  challengeReservation: RepairCapacityReservation;
  /** How many proposals the run can afford to retain and execute. */
  retained: number;
  /** True when retention was cut to fit the remaining budget. */
  reduced: boolean;
}

export interface ChallengeBudgetRefusal {
  status: 'insufficient';
  reasonCode: ChallengeBudgetReasonCode;
  /** Present whenever the mandatory audit reserve was secured before refusing. */
  auditReservation?: RepairCapacityReservation;
}

export type ChallengeBudgetOutcome = ChallengeBudgetPlan | ChallengeBudgetRefusal;

function scale(capacity: RepairCapacity, factor: number): RepairCapacity {
  return Object.fromEntries(
    Object.entries(capacity).map(([key, value]) => [key, (value ?? 0) * factor]),
  ) as RepairCapacity;
}

function add(left: RepairCapacity, right: RepairCapacity): RepairCapacity {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return Object.fromEntries([...keys].map((key) => [
    key,
    (left[key as keyof RepairCapacity] ?? 0) + (right[key as keyof RepairCapacity] ?? 0),
  ])) as RepairCapacity;
}

function tryReserve(
  budget: RepairBudget,
  capacity: RepairCapacity,
): RepairCapacityReservation | undefined {
  try {
    return budget.reserveCapacity(capacity);
  } catch (error) {
    if (error instanceof BudgetExceededError) return undefined;
    throw error;
  }
}

export interface ChallengeBudgetRequest {
  budget: RepairBudget;
  /** The full audit this run must still be able to complete. */
  auditReserve: RepairCapacity;
  /** Cost of generating the proposal set once. */
  generation: RepairCapacity;
  /** Cost of one challenge observation on one subject. */
  perObservation: RepairCapacity;
  /** Baseline plus every candidate and alternative the set will be run against. */
  subjects: number;
  proposals: number;
}

/**
 * Reserves the mandatory audit first, then whatever challenge work the rest of
 * the budget can actually cover.
 *
 * The order is the point: the audit reserve is taken before generation is even
 * priced, so challenge work can never consume the capacity a run needs to
 * finish auditing. When the remainder cannot cover every proposal, retention is
 * reduced before freezing rather than by dropping challenges later, which would
 * let a run quietly skip the ones it failed. When it cannot cover even one, the
 * result is an explicit refusal with the audit reserve still held. No limit is
 * ever raised to make a plan fit.
 */
export function reserveChallengeCapacity(
  request: ChallengeBudgetRequest,
): ChallengeBudgetOutcome {
  const auditReservation = tryReserve(request.budget, request.auditReserve);
  if (auditReservation === undefined) {
    return { status: 'insufficient', reasonCode: 'audit-reserve-unavailable' };
  }
  if (request.proposals < 1 || request.subjects < 1) {
    return { status: 'insufficient', reasonCode: 'no-affordable-challenge', auditReservation };
  }

  const observationsPerChallenge = request.subjects * CHALLENGE_REPETITIONS;
  const ceiling = Math.min(request.proposals, MAX_RETAINED_CHALLENGES);
  for (let retained = ceiling; retained >= 1; retained -= 1) {
    const capacity = add(
      request.generation,
      scale(request.perObservation, retained * observationsPerChallenge),
    );
    const challengeReservation = tryReserve(request.budget, capacity);
    if (challengeReservation !== undefined) {
      return {
        status: 'planned',
        auditReservation,
        challengeReservation,
        retained,
        reduced: retained < ceiling,
      };
    }
  }
  const generationOnly = tryReserve(request.budget, request.generation);
  if (generationOnly === undefined) {
    return { status: 'insufficient', reasonCode: 'generation-unaffordable', auditReservation };
  }
  request.budget.releaseCapacity(generationOnly);
  return { status: 'insufficient', reasonCode: 'no-affordable-challenge', auditReservation };
}
