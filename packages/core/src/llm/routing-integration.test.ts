/**
 * Routing beside the budget it spends from, and beside the gates it cannot
 * change.
 *
 * The routing policy decides which tier answers a request. These tests hold it
 * against the two things that must stay true whatever it decides: the run can
 * still afford its mandatory audit, and no candidate or provenance can move a
 * safety gate to a cheaper tier.
 */
import { describe, expect, it } from 'vitest';

import { BudgetExceededError, RepairBudget } from '../engine/repair-budget.js';
import { evaluateVerification, type OrderedVerificationGate } from '../verification/evaluate.js';
import {
  MAX_ULTRA_ESCALATIONS,
  routeModel,
  routingProfileHash,
  type RoutingBudget,
  type RoutingProfile,
  type RoutingSignals,
} from './routing-policy.js';

const PROFILE: RoutingProfile = {
  nanoRepairEnabled: false,
  contextBytes: { nano: 32_000, super: 128_000, ultra: 256_000 },
  verifiedTiers: ['nano', 'super', 'ultra'],
};

const BUDGET: RoutingBudget = {
  availableUsd: 1,
  worstCaseUsd: { nano: 0.001, super: 0.01, ultra: 0.05 },
};

function signals(overrides: Partial<RoutingSignals> = {}): RoutingSignals {
  return { purpose: 'repair', confidence: 0.95, targetCount: 1, requestBytes: 1_000, ...overrides };
}

describe('routing beside the audit reserve', () => {
  it('spends only what is left after the audit reserve is held back', () => {
    const budget = new RepairBudget({ inferenceCostUsd: 0.2, modelTurns: 8 });
    const auditReserve = budget.reserveCapacity({ modelTurns: 1, inferenceCostUsd: 0.05 });
    const available = budget.limits.inferenceCostUsd - budget.snapshot().inferenceCostUsd;

    const decision = routeModel(signals(), PROFILE, {
      availableUsd: available, worstCaseUsd: BUDGET.worstCaseUsd,
    });

    expect(decision.tier).toBe('super');
    // The audit's own reservation is still there and still spendable.
    expect(() => budget.reserveModelTurn(0.05, auditReserve)).not.toThrow();
  });

  it('abstains rather than spending the audit reserve on repair', () => {
    const budget = new RepairBudget({ inferenceCostUsd: 0.06, modelTurns: 8 });
    const auditReserve = budget.reserveCapacity({ modelTurns: 1, inferenceCostUsd: 0.05 });
    const available = budget.limits.inferenceCostUsd - budget.snapshot().inferenceCostUsd;

    const decision = routeModel(signals(), PROFILE, {
      availableUsd: available, worstCaseUsd: { nano: 0.02, super: 0.02, ultra: 0.05 },
    });

    expect(decision.tier).toBeNull();
    expect(() => budget.reserveModelTurn(0.05, auditReserve)).not.toThrow();
  });

  it('reserves the worst case and refunds only what was not spent', () => {
    const budget = new RepairBudget({ inferenceCostUsd: 0.1, modelTurns: 8 });
    const turn = budget.reserveModelTurn(0.05);

    expect(budget.snapshot().inferenceCostUsd).toBeCloseTo(0.05, 6);
    budget.settleModelTurn(turn, 0.01);
    expect(budget.snapshot().inferenceCostUsd).toBeCloseTo(0.01, 6);
    expect(() => budget.settleModelTurn(turn, 0.01)).toThrow(/not active/u);
  });

  it('charges a retry and a provider failure like any other turn', () => {
    const budget = new RepairBudget({ inferenceCostUsd: 0.1, modelTurns: 2 });
    const failed = budget.reserveModelTurn(0.02);
    // A provider error still consumed the attempt; settling at zero cost keeps
    // the turn spent and only refunds the money.
    budget.settleModelTurn(failed, 0);
    const retry = budget.reserveModelTurn(0.02);
    budget.settleModelTurn(retry, 0.02);

    expect(budget.snapshot().modelTurns).toBe(2);
    expect(() => budget.reserveModelTurn(0.02)).toThrow(BudgetExceededError);
  });

  it('stops on a missing price or model contract rather than routing to it', () => {
    const unverified = routeModel(signals({ purpose: 'adjudication' }), {
      ...PROFILE, verifiedTiers: ['nano', 'super'],
    }, BUDGET);

    expect(unverified.tier).toBeNull();
    expect(unverified.reason).toBe('unverified-contract');
    expect(unverified.rejected.some(({ tier }) => tier === 'ultra')).toBe(true);
  });

  it('escalates to ultra at most once', () => {
    const first = routeModel(
      signals({ confidence: 0.5, priorRepairFeedback: true, ultraEscalationsUsed: 0 }),
      PROFILE, BUDGET,
    );
    const second = routeModel(
      signals({ confidence: 0.5, priorRepairFeedback: true, ultraEscalationsUsed: MAX_ULTRA_ESCALATIONS }),
      PROFILE, BUDGET,
    );

    expect(first.tier).toBe('ultra');
    expect(first.reason).toBe('ultra-escalation');
    expect(second.tier).not.toBe('ultra');
    expect(second.reason).toBe('escalation-cap');
  });
});

describe('what routing cannot change', () => {
  it('keeps adjudication on its own tier whatever a candidate claims', () => {
    const honest = routeModel(signals({ purpose: 'adjudication' }), PROFILE, BUDGET);
    const claimed = routeModel({
      ...signals({ purpose: 'adjudication' }),
      // Fields a candidate or its provenance could try to supply.
      ...({ preferredTier: 'nano', agent: 'other-agent', trusted: true } as Partial<RoutingSignals>),
    }, PROFILE, BUDGET);

    expect(honest.tier).toBe('ultra');
    expect(claimed.tier).toBe('ultra');
    expect(claimed.reason).toBe(honest.reason);
    expect(claimed.profileHash).toBe(honest.profileHash);
  });

  it('gives the same decision for the same signals, profile and budget', () => {
    const decisions = Array.from({ length: 5 }, () => routeModel(signals(), PROFILE, BUDGET));

    expect(new Set(decisions.map((decision) => JSON.stringify(decision))).size).toBe(1);
  });

  it('changes the profile hash when a frozen field changes and not when tiers are reordered', () => {
    const base = routingProfileHash(PROFILE);

    expect(routingProfileHash({ ...PROFILE, verifiedTiers: ['ultra', 'super', 'nano'] })).toBe(base);
    expect(routingProfileHash({ ...PROFILE, nanoRepairEnabled: true })).not.toBe(base);
    expect(routingProfileHash({
      ...PROFILE, contextBytes: { ...PROFILE.contextBytes, super: 1 },
    })).not.toBe(base);
  });

  it('gives a valid and an invalid patch the same gate stack under either profile', async () => {
    const order: OrderedVerificationGate[] = [];
    const gates = (visible: 'passed' | 'failed') => async (gate: OrderedVerificationGate) => {
      order.push(gate);
      if (gate === 'visible') return { status: visible } as const;
      return { status: 'passed' } as const;
    };

    const valid = await evaluateVerification({ challengeMode: 'optional', runGate: gates('passed') });
    const validOrder = [...order];
    order.length = 0;
    const invalid = await evaluateVerification({ challengeMode: 'optional', runGate: gates('failed') });

    expect(validOrder.slice(0, order.length)).toEqual(order);
    expect(valid.observations.map(({ gate }) => gate))
      .toEqual(invalid.observations.map(({ gate }) => gate));
    expect(invalid.blockingGate).toBe('visible');
    expect(valid.blockingGate).toBeNull();
  });
});
