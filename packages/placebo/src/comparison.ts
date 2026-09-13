import { createHash } from 'node:crypto';

import type {
  CaseFile,
  FailureClass,
  ModelTier,
  RepairBudgetLimits,
  SearchLimits,
} from '@sutura/core';
import { canonicalJson } from '@sutura/evaluation';

import { SCORE_CONTRACT_VERSION, type CaseKind, type FixtureLanguage, type Score } from './types.js';

export const COMPARISON_SCHEMA_VERSION = 'sutura-search-comparison-v1' as const;

/**
 * The comparison arms, in report order. `first-green-wins` is a projection over
 * recorded evidence and is never a product path.
 */
export const COMPARISON_ARMS = [
  'sutura',
  'single-branch',
  'fixed-parallel',
  'first-green-wins',
] as const;
export type ComparisonArm = typeof COMPARISON_ARMS[number];

export { SCORE_CONTRACT_VERSION } from './types.js';

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const OBSERVATION_OUTCOMES = new Set<ComparisonObservation['outcome']>([
  'fixed', 'flaky-no-patch', 'refused', 'gave-up', 'infra-stop', 'not-run',
]);

export interface ComparisonInvariants {
  caseIds: readonly string[];
  corpusName: string;
  corpusVersion: string;
  corpusHash: string;
  models: Readonly<Record<ModelTier, string>>;
  routingProfile: string;
  budgetProfileHash: string;
  scoreContractVersion: typeof SCORE_CONTRACT_VERSION;
  tavilyEnabled: boolean;
  suturaCommit: string;
  /**
   * Frozen versions the arms ran under. Absent on a run recorded before they
   * were tracked; present on both sides they must agree, because a changed
   * challenge protocol, routing profile or split makes two runs incomparable.
   */
  challengeVersion?: string;
  routingVersion?: string;
  splitHash?: string;
}

export interface ComparisonObservation {
  caseId: string;
  kind: CaseKind;
  language: FixtureLanguage;
  failureClass: FailureClass;
  outcome: CaseFile['outcome'] | 'not-run';
  /** Whether an independent oracle decided this case, and not what it decided. */
  oracleStatus?: 'verified' | 'unknown' | 'not-run';
  approved: boolean;
  falseApproval: boolean;
  hiddenVerification: 'passed' | 'failed' | 'not-run';
  inferenceUsd: number;
  sandboxOperations: number;
  elapsedTimeSec: number;
}

export interface ComparisonArmRecord {
  arm: ComparisonArm;
  searchLimits: SearchLimits | null;
  auditEnabled: boolean;
  derived: boolean;
  observations: ComparisonObservation[];
  score: Score;
  totals: { inferenceUsd: number; sandboxOperations: number; elapsedTimeSec: number };
}

export interface ComparisonManifest {
  schemaVersion: typeof COMPARISON_SCHEMA_VERSION;
  comparisonId: string;
  invariants: ComparisonInvariants;
  arms: ComparisonArmRecord[];
  complete: boolean;
  resultHash: string;
}

export interface ComparisonInput {
  comparisonId: string;
  invariants: ComparisonInvariants;
  arms: ReadonlyArray<Omit<ComparisonArmRecord, 'totals'> & {
    totals?: ComparisonArmRecord['totals'];
  }>;
}

export class ComparisonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComparisonError';
  }
}

function refuse(message: string): never {
  throw new ComparisonError(message);
}

/**
 * Hashes the exact budget limits an arm ran under, so a budget change
 * invalidates the comparison instead of silently changing its meaning.
 */
export function budgetProfileHash(limits: RepairBudgetLimits): string {
  return createHash('sha256').update(canonicalJson(limits)).digest('hex');
}

function sameInvariants(left: ComparisonInvariants, right: ComparisonInvariants): string | null {
  if (canonicalJson(left.caseIds) !== canonicalJson(right.caseIds)) return 'caseIds';
  for (const key of [
    'corpusName', 'corpusVersion', 'corpusHash', 'routingProfile',
    'budgetProfileHash', 'scoreContractVersion', 'suturaCommit',
    'challengeVersion', 'routingVersion', 'splitHash',
  ] as const) {
    if (left[key] !== right[key]) return key;
  }
  if (left.tavilyEnabled !== right.tavilyEnabled) return 'tavilyEnabled';
  if (canonicalJson(left.models) !== canonicalJson(right.models)) return 'models';
  return null;
}

function validateInvariants(value: ComparisonInvariants): ComparisonInvariants {
  if (value.caseIds.length === 0) refuse('invariants.caseIds must be non-empty');
  if (new Set(value.caseIds).size !== value.caseIds.length) {
    refuse('invariants.caseIds must be unique');
  }
  if (!SHA256.test(value.corpusHash)) refuse('invariants.corpusHash must be a SHA-256 digest');
  if (!SHA256.test(value.budgetProfileHash)) {
    refuse('invariants.budgetProfileHash must be a SHA-256 digest');
  }
  if (!COMMIT.test(value.suturaCommit)) {
    refuse('invariants.suturaCommit must be an exact 40-character commit');
  }
  if (value.scoreContractVersion !== SCORE_CONTRACT_VERSION) {
    refuse(`invariants.scoreContractVersion must be ${SCORE_CONTRACT_VERSION}`);
  }
  for (const tier of ['nano', 'super', 'ultra'] as const) {
    if (!value.models[tier]?.trim()) refuse(`invariants.models.${tier} must be non-empty`);
  }
  return {
    ...value,
    caseIds: [...value.caseIds].sort(),
    models: { ...value.models },
  };
}

function validateObservations(
  arm: ComparisonArm,
  observations: readonly ComparisonObservation[],
  caseIds: readonly string[],
): ComparisonObservation[] {
  const expected = new Set(caseIds);
  const seen = new Set<string>();
  for (const observation of observations) {
    if (!expected.has(observation.caseId)) {
      refuse(`Arm ${arm} observed a case outside the selection: ${observation.caseId}`);
    }
    if (seen.has(observation.caseId)) {
      refuse(`Arm ${arm} observed ${observation.caseId} more than once`);
    }
    seen.add(observation.caseId);
    if (!OBSERVATION_OUTCOMES.has(observation.outcome)) {
      refuse(`Arm ${arm} observed an unsupported outcome for ${observation.caseId}`);
    }
    for (const key of ['inferenceUsd', 'sandboxOperations', 'elapsedTimeSec'] as const) {
      const measure = observation[key];
      if (!Number.isFinite(measure) || measure < 0) {
        refuse(`Arm ${arm} ${observation.caseId} ${key} must be a non-negative finite number`);
      }
    }
  }
  const missing = caseIds.filter((caseId) => !seen.has(caseId));
  if (missing.length > 0) {
    refuse(
      `Arm ${arm} is missing ${missing.length} case${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`,
    );
  }
  return [...observations].sort((left, right) => left.caseId.localeCompare(right.caseId));
}

function armTotals(observations: readonly ComparisonObservation[]): ComparisonArmRecord['totals'] {
  return observations.reduce((totals, observation) => ({
    inferenceUsd: totals.inferenceUsd + observation.inferenceUsd,
    sandboxOperations: totals.sandboxOperations + observation.sandboxOperations,
    elapsedTimeSec: totals.elapsedTimeSec + observation.elapsedTimeSec,
  }), { inferenceUsd: 0, sandboxOperations: 0, elapsedTimeSec: 0 });
}

function normalizedForHash(value: Omit<ComparisonManifest, 'resultHash'>): unknown {
  return {
    ...value,
    arms: value.arms.map((arm) => ({
      ...arm,
      totals: { ...arm.totals, elapsedTimeSec: 0 },
      observations: arm.observations.map((observation) => ({ ...observation, elapsedTimeSec: 0 })),
    })),
  };
}

function comparisonHash(value: Omit<ComparisonManifest, 'resultHash'>): string {
  return createHash('sha256').update(canonicalJson(normalizedForHash(value))).digest('hex');
}

function isComplete(
  arms: readonly ComparisonArmRecord[],
  caseIds: readonly string[],
): boolean {
  if (arms.length !== COMPARISON_ARMS.length) return false;
  return arms.every((arm) =>
    arm.observations.length === caseIds.length &&
    arm.observations.every(({ outcome }) => outcome !== 'not-run'));
}

export function createComparison(input: ComparisonInput): ComparisonManifest {
  if (!input.comparisonId.trim()) refuse('comparisonId must be non-empty');
  const invariants = validateInvariants(input.invariants);
  if (input.arms.length === 0) refuse('a comparison must record at least one arm');
  const names = input.arms.map(({ arm }) => arm);
  if (new Set(names).size !== names.length) refuse('a comparison must not repeat an arm');
  for (const name of names) {
    if (!COMPARISON_ARMS.includes(name)) refuse(`Unsupported comparison arm: ${name}`);
  }
  const arms = input.arms
    .map((arm): ComparisonArmRecord => {
      if (arm.derived && arm.searchLimits !== null) {
        refuse(`Arm ${arm.arm} is derived and must not declare search limits`);
      }
      if (!arm.derived && arm.searchLimits === null) {
        refuse(`Arm ${arm.arm} was executed and must declare its search limits`);
      }
      if (arm.score.scoreContractVersion !== invariants.scoreContractVersion) {
        refuse(`Arm ${arm.arm} scored under a different contract version`);
      }
      const observations = validateObservations(arm.arm, arm.observations, invariants.caseIds);
      return {
        arm: arm.arm,
        searchLimits: arm.searchLimits === null ? null : { ...arm.searchLimits },
        auditEnabled: arm.auditEnabled,
        derived: arm.derived,
        observations,
        score: arm.score,
        totals: arm.totals ?? armTotals(observations),
      };
    })
    .sort((left, right) =>
      COMPARISON_ARMS.indexOf(left.arm) - COMPARISON_ARMS.indexOf(right.arm));

  const base = {
    schemaVersion: COMPARISON_SCHEMA_VERSION,
    comparisonId: input.comparisonId,
    invariants,
    arms,
    complete: isComplete(arms, invariants.caseIds),
  };
  return { ...base, resultHash: comparisonHash(base) };
}

export function validateComparison(manifest: ComparisonManifest): ComparisonManifest {
  if (manifest.schemaVersion !== COMPARISON_SCHEMA_VERSION) {
    refuse('Unsupported comparison schema version');
  }
  const { resultHash, ...base } = manifest;
  if (comparisonHash(base) !== resultHash) refuse('Comparison result hash mismatch');
  if (manifest.complete !== isComplete(manifest.arms, manifest.invariants.caseIds)) {
    refuse('Comparison complete flag is not supported by its arms');
  }
  const selection = canonicalJson([...manifest.invariants.caseIds].sort());
  for (const arm of manifest.arms) {
    const covered = canonicalJson(arm.observations.map(({ caseId }) => caseId).sort());
    if (covered !== selection) {
      refuse(`Arm ${arm.arm} does not cover the declared case selection`);
    }
    if (arm.score.scoreContractVersion !== manifest.invariants.scoreContractVersion) {
      refuse(`Arm ${arm.arm} scored under a different contract version`);
    }
  }
  return manifest;
}

/**
 * Names the first invariant two comparison runs disagree on, so a rejected
 * merge of two runs says exactly what differed.
 */
export function firstInvariantDifference(
  left: ComparisonInvariants,
  right: ComparisonInvariants,
): string | null {
  return sameInvariants(left, right);
}

export interface ProportionInterval {
  value: number;
  lower: number;
  upper: number;
  width: number;
  numerator: number;
  denominator: number;
}

/**
 * Wilson score interval at 95 percent. A zero denominator reports a full
 * interval rather than a point estimate, so an empty group never looks certain.
 */
export function wilsonInterval(numerator: number, denominator: number): ProportionInterval {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) ||
      numerator < 0 || denominator < 0 || numerator > denominator) {
    refuse('A Wilson interval needs 0 <= numerator <= denominator as integers');
  }
  if (denominator === 0) {
    return { value: 0, lower: 0, upper: 1, width: 1, numerator, denominator };
  }
  const z = 1.959_963_984_540_054;
  const proportion = numerator / denominator;
  const denominatorTerm = 1 + (z * z) / denominator;
  const centre = proportion + (z * z) / (2 * denominator);
  const spread = z * Math.sqrt(
    (proportion * (1 - proportion) + (z * z) / (4 * denominator)) / denominator,
  );
  // At p = 0 the Wilson lower bound is exactly 0 and at p = 1 the upper bound
  // is exactly 1. Pin both so floating point never reports 0.9999999999999999.
  const lower = numerator === 0 ? 0 : Math.max(0, (centre - spread) / denominatorTerm);
  const upper = numerator === denominator ? 1 : Math.min(1, (centre + spread) / denominatorTerm);
  return { value: proportion, lower, upper, width: upper - lower, numerator, denominator };
}

export interface ComparisonArmSummary {
  arm: ComparisonArm;
  derived: boolean;
  repairRate: ProportionInterval;
  catchRate: ProportionInterval;
  flakeAccuracy: ProportionInterval;
  falseApprovals: number;
  inferenceUsd: number;
  sandboxOperations: number;
  medianElapsedTimeSec: number;
  p95ElapsedTimeSec: number;
  notRun: number;
}

function quantile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index]!;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function comparisonSummary(manifest: ComparisonManifest): ComparisonArmSummary[] {
  validateComparison(manifest);
  return manifest.arms.map((arm) => {
    const elapsed = arm.observations.map(({ elapsedTimeSec }) => elapsedTimeSec);
    return {
      arm: arm.arm,
      derived: arm.derived,
      repairRate: wilsonInterval(arm.score.fixRate.fixed, arm.score.fixRate.of),
      catchRate: wilsonInterval(arm.score.catchRate.refused, arm.score.catchRate.of),
      flakeAccuracy: wilsonInterval(arm.score.flakyAccuracy.correct, arm.score.flakyAccuracy.of),
      falseApprovals: arm.score.falseApprovalCount,
      inferenceUsd: arm.totals.inferenceUsd,
      sandboxOperations: arm.totals.sandboxOperations,
      medianElapsedTimeSec: median(elapsed),
      p95ElapsedTimeSec: quantile(elapsed, 0.95),
      notRun: arm.observations.filter(({ outcome }) => outcome === 'not-run').length,
    };
  });
}

export interface ExpansionBudget {
  authorizedUsd: number;
  spentUsd: number;
}

export interface ExpansionReadiness {
  ready: boolean;
  complete: boolean;
  affordable: boolean;
  statisticallyUseful: boolean;
  executedArms: number;
  executedObservations: number;
  measuredUsdPerCase: number;
  projectedUsdForExpansion: number;
  remainingAuthorizedUsd: number;
  primaryMeasure: { arm: ComparisonArm; key: 'fixRate' } & ProportionInterval;
  baselineMeasure: { arm: ComparisonArm; key: 'fixRate' } & ProportionInterval;
  projectedWidthAt200: number;
  reasons: string[];
}

/**
 * Decides whether expanding toward 200 cases is justified. Expansion is refused
 * unless the 100-case run is complete, its projection fits inside the remaining
 * authorized budget, and doubling the denominator would narrow the primary
 * measure materially while the comparison is not already decided.
 */
export function expansionReadiness(
  manifest: ComparisonManifest,
  budget: ExpansionBudget,
): ExpansionReadiness {
  const reasons: string[] = [];
  let complete = false;
  try {
    validateComparison(manifest);
    complete = manifest.complete;
  } catch (error) {
    reasons.push(`The comparison manifest is not valid: ${(error as Error).message}`);
  }
  if (!complete && reasons.length === 0) {
    reasons.push('The comparison is incomplete: an arm did not cover every case, or an observation is not-run.');
  }

  const executed = manifest.arms.filter(({ derived }) => !derived);
  const executedObservations = executed.reduce(
    (total, arm) => total + arm.observations.length, 0,
  );
  const executedUsd = executed.reduce((total, arm) => total + arm.totals.inferenceUsd, 0);
  const measuredUsdPerCase = executedObservations === 0
    ? 0
    : executedUsd / executedObservations;
  const projectedUsdForExpansion = measuredUsdPerCase *
    manifest.invariants.caseIds.length * executed.length;
  const remainingAuthorizedUsd = budget.authorizedUsd - budget.spentUsd;
  const affordable = projectedUsdForExpansion <= remainingAuthorizedUsd;
  if (!affordable) {
    reasons.push(
      `Expansion projects USD ${projectedUsdForExpansion.toFixed(2)} against USD ${remainingAuthorizedUsd.toFixed(2)} remaining authorized budget.`,
    );
  }

  const summaries = manifest.arms.map((arm) => ({
    arm: arm.arm,
    interval: wilsonInterval(arm.score.fixRate.fixed, arm.score.fixRate.of),
  }));
  const primary = summaries.find(({ arm }) => arm === 'sutura');
  const baseline = summaries.find(({ arm }) => arm === 'single-branch');
  if (primary === undefined || baseline === undefined) {
    reasons.push('Expansion readiness needs both the sutura and single-branch arms.');
  }
  const primaryInterval = primary?.interval ?? wilsonInterval(0, 0);
  const baselineInterval = baseline?.interval ?? wilsonInterval(0, 0);
  const doubled = wilsonInterval(
    primaryInterval.numerator * 2,
    primaryInterval.denominator * 2,
  );
  const narrowsMaterially = primaryInterval.width > 0 &&
    doubled.width <= primaryInterval.width * 0.8;
  const overlaps = primaryInterval.lower <= baselineInterval.upper &&
    baselineInterval.lower <= primaryInterval.upper;
  const statisticallyUseful = narrowsMaterially && overlaps;
  if (!narrowsMaterially) {
    reasons.push(
      `Doubling the denominator narrows the primary interval from ${primaryInterval.width.toFixed(3)} to ${doubled.width.toFixed(3)}, which is under the 20 percent threshold.`,
    );
  } else if (!overlaps) {
    reasons.push(
      'The sutura and single-branch intervals are already disjoint, so the comparison is decided and more cases buy nothing.',
    );
  }

  return {
    ready: complete && affordable && statisticallyUseful && reasons.length === 0,
    complete,
    affordable,
    statisticallyUseful,
    executedArms: executed.length,
    executedObservations,
    measuredUsdPerCase,
    projectedUsdForExpansion,
    remainingAuthorizedUsd,
    primaryMeasure: { arm: 'sutura', key: 'fixRate', ...primaryInterval },
    baselineMeasure: { arm: 'single-branch', key: 'fixRate', ...baselineInterval },
    projectedWidthAt200: doubled.width,
    reasons,
  };
}

/** Outcomes that decided nothing, so they can never count as a win or as cheap. */
const UNDECIDED_OUTCOMES: ReadonlySet<ComparisonObservation['outcome']> =
  new Set<ComparisonObservation['outcome']>(['not-run', 'infra-stop']);

export interface ComparisonSlice {
  /** What this slice groups by, and the value it groups on. */
  dimension: 'language' | 'kind' | 'split';
  value: string;
  cases: number;
  /** Cases that reached a decided outcome; the denominator every rate uses. */
  decided: number;
  verifiedRepairs: number;
  falseApprovals: number;
  repairRate: ProportionInterval;
}

export interface ComparisonEfficiency {
  arm: ComparisonArm;
  /** Cases whose outcome was decided, over every case in the selection. */
  coverage: ProportionInterval;
  verifiedRepairs: number;
  inferenceUsd: number;
  /**
   * Correctly verified repairs per priced dollar, or null when nothing was
   * priced. An arm that decided nothing has a rate of zero rather than an
   * unbounded one, so stopping early can never read as the cheapest arm.
   */
  verifiedRepairsPerUsd: number | null;
  undecided: number;
}

function decided(observation: ComparisonObservation): boolean {
  return !UNDECIDED_OUTCOMES.has(observation.outcome);
}

/** A verified repair: fixed, approved, and not contradicted by a hidden check. */
function verifiedRepair(observation: ComparisonObservation): boolean {
  return decided(observation) && observation.outcome === 'fixed' &&
    observation.approved && observation.hiddenVerification !== 'failed' &&
    observation.oracleStatus !== 'unknown';
}

/**
 * Slices one arm by language, case kind and declared split.
 *
 * Every rate uses decided cases as its denominator, so an arm that stopped on
 * infrastructure reports fewer decided cases rather than a better rate.
 */
export function comparisonSlices(
  arm: Pick<ComparisonArmRecord, 'observations'>,
  splitByCase: Readonly<Record<string, string>> = {},
): ComparisonSlice[] {
  const dimensions: Array<[ComparisonSlice['dimension'], (item: ComparisonObservation) => string | undefined]> = [
    ['language', (item) => item.language],
    ['kind', (item) => item.kind],
    ['split', (item) => splitByCase[item.caseId]],
  ];
  const slices: ComparisonSlice[] = [];
  for (const [dimension, key] of dimensions) {
    const groups = new Map<string, ComparisonObservation[]>();
    for (const observation of arm.observations) {
      const value = key(observation);
      if (value === undefined) continue;
      groups.set(value, [...(groups.get(value) ?? []), observation]);
    }
    for (const [value, observations] of [...groups.entries()].sort()) {
      const decidedCount = observations.filter(decided).length;
      const repairs = observations.filter(verifiedRepair).length;
      slices.push({
        dimension,
        value,
        cases: observations.length,
        decided: decidedCount,
        verifiedRepairs: repairs,
        falseApprovals: observations.filter(({ falseApproval }) => falseApproval).length,
        repairRate: wilsonInterval(repairs, decidedCount),
      });
    }
  }
  return slices;
}

/**
 * Cost efficiency per arm.
 *
 * A missing or infrastructure-stopped case is counted as undecided rather than
 * as a cheap success, because an arm that stops early spends less and proves
 * less. Coverage is reported beside the rate so the two are read together.
 */
export function comparisonEfficiency(manifest: ComparisonManifest): ComparisonEfficiency[] {
  validateComparison(manifest);
  return manifest.arms.map((arm) => {
    const decidedCount = arm.observations.filter(decided).length;
    const repairs = arm.observations.filter(verifiedRepair).length;
    return {
      arm: arm.arm,
      coverage: wilsonInterval(decidedCount, arm.observations.length),
      verifiedRepairs: repairs,
      inferenceUsd: arm.totals.inferenceUsd,
      verifiedRepairsPerUsd: arm.totals.inferenceUsd > 0 ? repairs / arm.totals.inferenceUsd : null,
      undecided: arm.observations.length - decidedCount,
    };
  });
}
