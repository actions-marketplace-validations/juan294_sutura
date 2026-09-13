import { createHash } from 'node:crypto';

import { canonicalJson } from '../replay/canonical-json.js';

export type ModelTier = 'nano' | 'super' | 'ultra';

export type RoutingPurpose =
  | 'classification'
  | 'diagnosis-recovery'
  | 'repair'
  | 'challenge-generation'
  | 'adjudication';

/** Frozen development thresholds; held-out results may not tune these. */
export const ROUTING_POLICY_VERSION = 'sutura-routing-policy-v1' as const;
export const LOW_CONFIDENCE = 0.7;
export const HIGH_CONFIDENCE = 0.9;
export const MAX_ULTRA_ESCALATIONS = 1;

export interface RoutingProfile {
  /** Whether the evaluated nano-repair option is enabled for this profile. */
  nanoRepairEnabled: boolean;
  /** Conservative input-byte ceiling per tier, already including a safety margin. */
  contextBytes: Readonly<Record<ModelTier, number>>;
  /** Tiers with a verified model and price contract. */
  verifiedTiers: readonly ModelTier[];
}

export interface RoutingSignals {
  purpose: RoutingPurpose;
  /** Absent confidence is treated as low, never as high. */
  confidence?: number;
  targetCount: number;
  requestBytes: number;
  /** A structurally valid but unsuccessful earlier repair with new feedback. */
  priorRepairFeedback?: boolean;
  ultraEscalationsUsed?: number;
}

export interface RoutingBudget {
  /** Remaining spend after the mandatory audit and challenge reserve is held back. */
  availableUsd: number;
  /** Worst-case cost per tier for this request. */
  worstCaseUsd: Readonly<Record<ModelTier, number>>;
}

export type RoutingReason =
  | 'purpose-default'
  | 'low-confidence'
  | 'two-target-repair'
  | 'nano-repair-option'
  | 'ultra-escalation'
  | 'escalation-cap'
  | 'context-limit'
  | 'unverified-contract'
  | 'affordable-fallback';

export interface RoutingDecision {
  tier: ModelTier | null;
  reason: RoutingReason;
  /** Every tier considered and rejected, in the order they were tried. */
  rejected: Array<{ tier: ModelTier; reason: RoutingReason }>;
  profileHash: string;
}

const FALLBACK_ORDER: Readonly<Record<RoutingPurpose, readonly ModelTier[]>> = {
  classification: ['nano', 'super'],
  'diagnosis-recovery': ['super'],
  repair: ['super', 'nano'],
  'challenge-generation': ['super'],
  adjudication: ['ultra'],
};

export function routingProfileHash(profile: RoutingProfile): string {
  return createHash('sha256').update(canonicalJson({
    version: ROUTING_POLICY_VERSION,
    nanoRepairEnabled: profile.nanoRepairEnabled,
    contextBytes: profile.contextBytes,
    verifiedTiers: [...profile.verifiedTiers].toSorted(),
  })).digest('hex');
}

/**
 * The tier the decision table prefers before any affordability or contract
 * check. Absent confidence counts as low, so a missing signal can never buy a
 * cheaper route.
 */
function preferredTier(signals: RoutingSignals, profile: RoutingProfile): {
  tier: ModelTier;
  reason: RoutingReason;
} {
  const confidence = signals.confidence ?? 0;
  switch (signals.purpose) {
    case 'adjudication':
      return { tier: 'ultra', reason: 'purpose-default' };
    case 'challenge-generation':
    case 'diagnosis-recovery':
      return { tier: 'super', reason: 'purpose-default' };
    case 'classification':
      return { tier: 'nano', reason: 'purpose-default' };
    case 'repair': {
      if (signals.priorRepairFeedback === true) {
        return (signals.ultraEscalationsUsed ?? 0) < MAX_ULTRA_ESCALATIONS
          ? { tier: 'ultra', reason: 'ultra-escalation' }
          : { tier: 'super', reason: 'escalation-cap' };
      }
      if (signals.targetCount > 1) return { tier: 'super', reason: 'two-target-repair' };
      if (confidence < LOW_CONFIDENCE) return { tier: 'super', reason: 'low-confidence' };
      if (profile.nanoRepairEnabled && confidence >= HIGH_CONFIDENCE) {
        return { tier: 'nano', reason: 'nano-repair-option' };
      }
      return { tier: 'super', reason: 'purpose-default' };
    }
  }
}

function usable(
  tier: ModelTier,
  signals: RoutingSignals,
  profile: RoutingProfile,
  budget: RoutingBudget,
): RoutingReason | null {
  if (!profile.verifiedTiers.includes(tier)) return 'unverified-contract';
  if (signals.requestBytes > profile.contextBytes[tier]) return 'context-limit';
  if (budget.worstCaseUsd[tier] > budget.availableUsd) return 'affordable-fallback';
  return null;
}

/**
 * Chooses a model tier deterministically from purpose, confidence, target
 * count, context bound and prior feedback.
 *
 * Routing never changes patch authority, challenge requirements, policy or
 * test commands, and it never spends the reserved audit and challenge budget:
 * `availableUsd` is what remains after that reserve. When no permitted tier is
 * both contract-verified and affordable the decision abstains with `null`
 * rather than silently downgrading a required audit.
 */
export function routeModel(
  signals: RoutingSignals,
  profile: RoutingProfile,
  budget: RoutingBudget,
): RoutingDecision {
  const profileHash = routingProfileHash(profile);
  const preferred = preferredTier(signals, profile);
  const nanoEligible = profile.nanoRepairEnabled && signals.targetCount === 1
    && (signals.confidence ?? 0) >= HIGH_CONFIDENCE && signals.priorRepairFeedback !== true;
  const order = [preferred.tier, ...FALLBACK_ORDER[signals.purpose].filter((tier) =>
    tier !== preferred.tier && (signals.purpose !== 'repair' || tier !== 'nano' || nanoEligible))];
  const rejected: Array<{ tier: ModelTier; reason: RoutingReason }> = [];

  for (const [index, tier] of order.entries()) {
    const problem = usable(tier, signals, profile, budget);
    if (problem === null) {
      return {
        tier,
        reason: index === 0 ? preferred.reason : 'affordable-fallback',
        rejected,
        profileHash,
      };
    }
    rejected.push({ tier, reason: problem });
  }
  // An abstention names why the last permitted tier was unusable, rather than
  // reporting a fallback that never happened.
  return {
    tier: null,
    reason: rejected.at(-1)?.reason ?? 'affordable-fallback',
    rejected,
    profileHash,
  };
}
