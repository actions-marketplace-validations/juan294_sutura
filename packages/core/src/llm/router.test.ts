import { describe, expect, it } from 'vitest';

import { DEFAULT_MODELS } from '../config.js';
import { DEFAULT_MODEL_PRICES } from './cost.js';
import {
  DEFAULT_ROUTING_PROFILE_ID,
  ModelRouter,
  type ModelSelectionProfile,
} from './router.js';

const completed: ModelSelectionProfile = {
  schemaVersion: 'sutura-model-selection-v1',
  profileId: 'evaluated-v1',
  complete: true,
  pricesVerified: true,
  models: {
    nano: 'nvidia/Nemotron-3_5-Lightning',
    super: DEFAULT_MODELS.super,
    ultra: DEFAULT_MODELS.ultra,
  },
  prices: DEFAULT_MODEL_PRICES,
};

function input(profileId: string = DEFAULT_ROUTING_PROFILE_ID) {
  return {
    requestedRole: 'nano' as const,
    failureClass: 'typecheck' as const,
    diagnosisConfidence: 0.9,
    boundedContextBytes: 1_024,
    remainingInferenceBudgetUsd: 0.2,
    profileId,
  };
}

describe('ModelRouter', () => {
  it('routes deterministically from the bounded public input contract', () => {
    const router = new ModelRouter(DEFAULT_MODELS, DEFAULT_MODEL_PRICES, [completed]);
    expect(router.select(input('evaluated-v1'))).toEqual(router.select(input('evaluated-v1')));
    expect(router.select(input('evaluated-v1'))).toMatchObject({
      role: 'nano', modelId: 'nvidia/Nemotron-3_5-Lightning', profileId: 'evaluated-v1',
    });
    expect(Object.keys(input())).not.toEqual(expect.arrayContaining(['repo', 'repository', 'maintainer']));
  });

  it.each([
    { ...completed, profileId: 'partial', complete: false },
    { ...completed, profileId: 'unpriced', pricesVerified: false },
  ])('does not let an incomplete or unpriced evaluation change defaults', (profile) => {
    const router = new ModelRouter(DEFAULT_MODELS, DEFAULT_MODEL_PRICES, [profile]);
    expect(router.select(input(profile.profileId))).toMatchObject({
      role: 'nano', modelId: DEFAULT_MODELS.nano, profileId: DEFAULT_ROUTING_PROFILE_ID,
      fallbackReason: expect.any(String),
    });
  });

  it('falls back for an unknown selected evaluation profile', () => {
    const router = new ModelRouter(DEFAULT_MODELS, DEFAULT_MODEL_PRICES);
    expect(router.select(input('missing'))).toMatchObject({
      modelId: DEFAULT_MODELS.nano, profileId: DEFAULT_ROUTING_PROFILE_ID,
    });
  });

  it.each([
    ['requestedRole', { requestedRole: 'invalid' }],
    ['diagnosisConfidence below zero', { diagnosisConfidence: -0.1 }],
    ['diagnosisConfidence above one', { diagnosisConfidence: 1.1 }],
    ['diagnosisConfidence non-finite', { diagnosisConfidence: Number.NaN }],
    ['boundedContextBytes negative', { boundedContextBytes: -1 }],
    ['boundedContextBytes unsafe', { boundedContextBytes: Number.MAX_SAFE_INTEGER + 1 }],
    ['remainingInferenceBudgetUsd negative', { remainingInferenceBudgetUsd: -0.01 }],
    ['remainingInferenceBudgetUsd non-finite', { remainingInferenceBudgetUsd: Infinity }],
    ['profileId empty', { profileId: '  ' }],
  ])('rejects invalid routing input: %s', (_label, override) => {
    const router = new ModelRouter(DEFAULT_MODELS, DEFAULT_MODEL_PRICES);
    expect(() => router.select({ ...input(), ...override } as ReturnType<typeof input>))
      .toThrow();
  });
});

describe('adaptive tier selection', () => {
  const adaptiveProfile = {
    nanoRepairEnabled: true,
    contextBytes: { nano: 8_000, super: 64_000, ultra: 128_000 },
    verifiedTiers: ['nano', 'super', 'ultra'] as const,
  };
  const adaptiveBudget = {
    availableUsd: 10,
    worstCaseUsd: { nano: 0.01, super: 0.1, ultra: 1 },
  };

  const base = {
    requestedRole: 'super' as const,
    failureClass: null,
    diagnosisConfidence: null,
    boundedContextBytes: 1_000,
    remainingInferenceBudgetUsd: 10,
    profileId: DEFAULT_ROUTING_PROFILE_ID,
  };

  it('keeps the requested role when no adaptive request is supplied', () => {
    const decision = new ModelRouter(DEFAULT_MODELS, DEFAULT_MODEL_PRICES).select(base);

    expect(decision.role).toBe('super');
    expect(decision.adaptiveReason).toBeUndefined();
    expect(decision.routingProfileHash).toBeUndefined();
  });

  it('lets the policy choose a cheaper tier for a confident single-target repair', () => {
    const decision = new ModelRouter(DEFAULT_MODELS, DEFAULT_MODEL_PRICES).select({
      ...base,
      adaptive: {
        signals: { purpose: 'repair', confidence: 0.95, targetCount: 1, requestBytes: 1_000 },
        profile: adaptiveProfile,
        budget: adaptiveBudget,
      },
    });

    expect(decision.role).toBe('nano');
    expect(decision.adaptiveReason).toBe('nano-repair-option');
    expect(decision.routingProfileHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('prices the tier the policy actually chose', () => {
    const router = new ModelRouter(DEFAULT_MODELS, DEFAULT_MODEL_PRICES);
    const adaptive = router.select({
      ...base,
      adaptive: {
        signals: { purpose: 'repair', confidence: 0.95, targetCount: 1, requestBytes: 1_000 },
        profile: adaptiveProfile,
        budget: adaptiveBudget,
      },
    });
    const fixedNano = router.select({ ...base, requestedRole: 'nano' });

    expect(adaptive.modelId).toBe(fixedNano.modelId);
    expect(adaptive.price).toEqual(fixedNano.price);
  });

  it('refuses to dispatch when the adaptive policy abstains', () => {
    expect(() => new ModelRouter(DEFAULT_MODELS, DEFAULT_MODEL_PRICES).select({
      ...base,
      requestedRole: 'ultra',
      adaptive: {
        signals: { purpose: 'adjudication', targetCount: 1, requestBytes: 1_000 },
        profile: adaptiveProfile,
        budget: { availableUsd: 0, worstCaseUsd: adaptiveBudget.worstCaseUsd },
      },
    })).toThrow(/abstained/u);
  });

  it('does not let adaptive selection change the profile identity', () => {
    const decision = new ModelRouter(DEFAULT_MODELS, DEFAULT_MODEL_PRICES).select({
      ...base,
      adaptive: {
        signals: { purpose: 'repair', confidence: 0.95, targetCount: 1, requestBytes: 1_000 },
        profile: adaptiveProfile,
        budget: adaptiveBudget,
      },
    });

    expect(decision.profileId).toBe(DEFAULT_ROUTING_PROFILE_ID);
  });
});
