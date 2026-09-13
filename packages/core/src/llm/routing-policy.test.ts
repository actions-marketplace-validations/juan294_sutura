import { describe, expect, it } from 'vitest';

import {
  HIGH_CONFIDENCE,
  LOW_CONFIDENCE,
  MAX_ULTRA_ESCALATIONS,
  routeModel,
  routingProfileHash,
  type RoutingBudget,
  type RoutingProfile,
  type RoutingSignals,
} from './routing-policy.js';

const profile: RoutingProfile = {
  nanoRepairEnabled: true,
  contextBytes: { nano: 8_000, super: 64_000, ultra: 128_000 },
  verifiedTiers: ['nano', 'super', 'ultra'],
};

const budget: RoutingBudget = {
  availableUsd: 10,
  worstCaseUsd: { nano: 0.01, super: 0.1, ultra: 1 },
};

function signals(overrides: Partial<RoutingSignals> = {}): RoutingSignals {
  return { purpose: 'repair', confidence: 0.95, targetCount: 1, requestBytes: 1_000, ...overrides };
}

function route(
  overrides: Partial<RoutingSignals> = {},
  profileOverrides: Partial<RoutingProfile> = {},
  budgetOverrides: Partial<RoutingBudget> = {},
) {
  return routeModel(
    signals(overrides),
    { ...profile, ...profileOverrides },
    { ...budget, ...budgetOverrides },
  );
}

describe('routing decision table', () => {
  it.each([
    ['classification', 'nano'],
    ['diagnosis-recovery', 'super'],
    ['challenge-generation', 'super'],
    ['adjudication', 'ultra'],
  ] as const)('routes %s to %s by purpose', (purpose, tier) => {
    expect(route({ purpose }).tier).toBe(tier);
  });

  it('routes a confident single-target repair to nano only when the profile enables it', () => {
    expect(route({ confidence: HIGH_CONFIDENCE }).tier).toBe('nano');
    expect(route({ confidence: HIGH_CONFIDENCE }).reason).toBe('nano-repair-option');
    expect(route({ confidence: HIGH_CONFIDENCE }, { nanoRepairEnabled: false }).tier).toBe('super');
  });

  it.each([
    [LOW_CONFIDENCE - 0.001, 'super', 'low-confidence'],
    [LOW_CONFIDENCE, 'super', 'purpose-default'],
    [HIGH_CONFIDENCE - 0.001, 'super', 'purpose-default'],
    [HIGH_CONFIDENCE, 'nano', 'nano-repair-option'],
  ])('changes the repair route at confidence %s', (confidence, tier, reason) => {
    const decision = route({ confidence });

    expect(decision.tier).toBe(tier);
    expect(decision.reason).toBe(reason);
  });

  it('treats missing confidence as low rather than high', () => {
    const decision = routeModel(
      { purpose: 'repair', targetCount: 1, requestBytes: 1_000 }, profile, budget,
    );

    expect(decision.tier).toBe('super');
    expect(decision.reason).toBe('low-confidence');
  });

  it('routes a two-target repair to super even at high confidence', () => {
    const decision = route({ targetCount: 2, confidence: 1 });

    expect(decision.tier).toBe('super');
    expect(decision.reason).toBe('two-target-repair');
  });

  it('escalates once on new execution feedback and never again', () => {
    const first = route({ priorRepairFeedback: true, ultraEscalationsUsed: 0 });
    const second = route({ priorRepairFeedback: true, ultraEscalationsUsed: MAX_ULTRA_ESCALATIONS });

    expect(first.tier).toBe('ultra');
    expect(first.reason).toBe('ultra-escalation');
    expect(second.tier).toBe('super');
    expect(second.reason).toBe('escalation-cap');
  });

  it('falls back when the preferred tier cannot hold the request', () => {
    const decision = route({ confidence: 1, requestBytes: 20_000 });

    expect(decision.tier).toBe('super');
    expect(decision.reason).toBe('affordable-fallback');
    expect(decision.rejected).toEqual([{ tier: 'nano', reason: 'context-limit' }]);
  });

  it('falls back when the preferred tier has no verified model contract', () => {
    const decision = route({ confidence: 1 }, { verifiedTiers: ['super'] });

    expect(decision.tier).toBe('super');
    expect(decision.rejected).toEqual([{ tier: 'nano', reason: 'unverified-contract' }]);
  });

  it('falls back when the preferred tier does not fit the available budget', () => {
    const decision = route({ purpose: 'classification' }, {}, {
      availableUsd: 0.05, worstCaseUsd: { nano: 0.5, super: 0.02, ultra: 1 },
    });

    expect(decision.tier).toBe('super');
    expect(decision.rejected).toEqual([{ tier: 'nano', reason: 'affordable-fallback' }]);
  });

  it('abstains rather than routing when no permitted tier is usable', () => {
    const decision = route({ purpose: 'adjudication' }, {}, { availableUsd: 0 });

    expect(decision.tier).toBeNull();
    expect(decision.rejected).toEqual([{ tier: 'ultra', reason: 'affordable-fallback' }]);
  });

  it('never downgrades adjudication to a cheaper tier to finance repair work', () => {
    const decision = route({ purpose: 'adjudication' }, {}, {
      availableUsd: 0.5, worstCaseUsd: { nano: 0.01, super: 0.1, ultra: 1 },
    });

    expect(decision.tier).toBeNull();
    expect(decision.rejected.map(({ tier }) => tier)).toEqual(['ultra']);
  });

  it('is deterministic for the same signals, profile and budget', () => {
    expect(route({ confidence: 0.8 })).toEqual(route({ confidence: 0.8 }));
    expect(route()).toEqual(route());
  });

  it('records a profile hash that changes with any frozen profile field', () => {
    const base = routingProfileHash(profile);

    expect(route().profileHash).toBe(base);
    expect(routingProfileHash({ ...profile, nanoRepairEnabled: false })).not.toBe(base);
    expect(routingProfileHash({ ...profile, verifiedTiers: ['super'] })).not.toBe(base);
    expect(routingProfileHash({
      ...profile, contextBytes: { ...profile.contextBytes, nano: 1 },
    })).not.toBe(base);
  });

  it('keeps tier order irrelevant to the profile hash', () => {
    expect(routingProfileHash({ ...profile, verifiedTiers: ['ultra', 'nano', 'super'] }))
      .toBe(routingProfileHash(profile));
  });
});

it.each([
  { nanoRepairEnabled: false, targetCount: 1, confidence: 1 },
  { nanoRepairEnabled: true, targetCount: 2, confidence: 1 },
  { nanoRepairEnabled: true, targetCount: 1, confidence: 0.2 },
])('never uses an ineligible nano repair as an affordable fallback: %j', (input) => {
  const result = route({ targetCount: input.targetCount, confidence: input.confidence },
    { nanoRepairEnabled: input.nanoRepairEnabled }, { availableUsd: 0.05 });
  expect(result.tier).toBeNull();
});
