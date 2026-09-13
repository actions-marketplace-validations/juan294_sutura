import type { FailureClass } from '../domain.js';
import type { ModelPrice, ModelPrices, ModelTier } from './cost.js';
import {
  routeModel,
  type RoutingBudget,
  type RoutingProfile,
  type RoutingReason,
  type RoutingSignals,
} from './routing-policy.js';

export const MODEL_SELECTION_SCHEMA_VERSION = 'sutura-model-selection-v1' as const;
export const DEFAULT_ROUTING_PROFILE_ID = 'production-baseline-v1' as const;
export const DEVELOPMENT_ROUTING_PROFILE_ID = 'development-adaptive-v1' as const;

/** Conservative development input ceilings, with output capacity held separately. */
export const DEVELOPMENT_ROUTING_PROFILE: RoutingProfile = Object.freeze({
  nanoRepairEnabled: true,
  contextBytes: Object.freeze({ nano: 8_000, super: 64_000, ultra: 128_000 }),
  verifiedTiers: Object.freeze(['nano', 'super', 'ultra'] as const),
});

export class RoutingAbstentionError extends Error {
  constructor(readonly reason: RoutingReason, readonly profileHash: string) {
    super(`Adaptive routing abstained: ${reason}`);
    this.name = 'RoutingAbstentionError';
  }
}

export interface ModelSelectionProfile {
  schemaVersion: typeof MODEL_SELECTION_SCHEMA_VERSION;
  profileId: string;
  complete: boolean;
  pricesVerified: boolean;
  models: Readonly<Record<ModelTier, string>>;
  prices: ModelPrices;
}

export interface AdaptiveRoutingRequest {
  signals: RoutingSignals;
  profile: RoutingProfile;
  budget: RoutingBudget;
}

export interface ModelRoutingInput {
  requestedRole: ModelTier;
  failureClass: FailureClass | null;
  diagnosisConfidence: number | null;
  boundedContextBytes: number;
  remainingInferenceBudgetUsd: number;
  profileId: string;
  /**
   * Opt-in adaptive tier selection. Absent, the requested role is used
   * unchanged, which keeps fixed routing the reproducible control and the safe
   * default until phase 10 evaluates promotion.
   */
  adaptive?: AdaptiveRoutingRequest;
}

export interface ModelRouteDecision {
  role: ModelTier;
  modelId: string;
  price: ModelPrice;
  profileId: string;
  fallbackReason?: string;
  /** Present only when adaptive selection ran; names why the tier was chosen. */
  adaptiveReason?: RoutingReason;
  /** Binds the decision to the exact frozen routing profile that produced it. */
  routingProfileHash?: string;
}

function validInput(input: ModelRoutingInput): void {
  if (!['nano', 'super', 'ultra'].includes(input.requestedRole)) {
    throw new RangeError('requestedRole is invalid');
  }
  if (input.diagnosisConfidence !== null && (
    !Number.isFinite(input.diagnosisConfidence) ||
    input.diagnosisConfidence < 0 ||
    input.diagnosisConfidence > 1
  )) throw new RangeError('diagnosisConfidence must be null or from zero to one');
  if (!Number.isSafeInteger(input.boundedContextBytes) || input.boundedContextBytes < 0) {
    throw new RangeError('boundedContextBytes must be a non-negative safe integer');
  }
  if (!Number.isFinite(input.remainingInferenceBudgetUsd) || input.remainingInferenceBudgetUsd < 0) {
    throw new RangeError('remainingInferenceBudgetUsd must be non-negative and finite');
  }
  if (!input.profileId.trim()) throw new RangeError('profileId must be non-empty');
}

export class ModelRouter {
  private readonly baseline: ModelSelectionProfile;
  private readonly profiles: ReadonlyMap<string, ModelSelectionProfile>;

  constructor(
    defaultModels: Readonly<Record<ModelTier, string>>,
    defaultPrices: ModelPrices,
    profiles: readonly ModelSelectionProfile[] = [],
  ) {
    this.baseline = {
      schemaVersion: MODEL_SELECTION_SCHEMA_VERSION,
      profileId: DEFAULT_ROUTING_PROFILE_ID,
      complete: true,
      pricesVerified: true,
      models: { ...defaultModels },
      prices: structuredClone(defaultPrices),
    };
    this.profiles = new Map(profiles.map((profile) => [profile.profileId, profile]));
  }

  select(input: ModelRoutingInput): ModelRouteDecision {
    validInput(input);
    const selected = input.profileId === DEVELOPMENT_ROUTING_PROFILE_ID
      ? { ...this.baseline, profileId: DEVELOPMENT_ROUTING_PROFILE_ID }
      : input.profileId === DEFAULT_ROUTING_PROFILE_ID
      ? this.baseline
      : this.profiles.get(input.profileId);
    const usable = selected?.complete === true && selected.pricesVerified === true;
    const profile = usable ? selected : this.baseline;
    const adaptive = input.adaptive === undefined
      ? undefined
      : routeModel(input.adaptive.signals, input.adaptive.profile, input.adaptive.budget);
    if (adaptive?.tier === null) throw new RoutingAbstentionError(adaptive.reason, adaptive.profileHash);
    const role = adaptive?.tier ?? input.requestedRole;
    return {
      role,
      modelId: profile.models[role],
      price: { ...profile.prices[role] },
      profileId: profile.profileId,
      ...(!usable && input.profileId !== DEFAULT_ROUTING_PROFILE_ID
        ? { fallbackReason: selected === undefined
            ? 'selected profile is unavailable'
            : 'selected profile is incomplete or has unverified prices' }
        : {}),
      ...(adaptive === undefined
        ? {}
        : { adaptiveReason: adaptive.reason, routingProfileHash: adaptive.profileHash }),
    };
  }
}
