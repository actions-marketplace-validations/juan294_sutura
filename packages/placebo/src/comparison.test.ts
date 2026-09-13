import { DEFAULT_MODELS, DEFAULT_REPAIR_BUDGET_LIMITS, DEFAULT_ROUTING_PROFILE_ID } from '@sutura/core';
import { describe, expect, it } from 'vitest';

import { ARM_SEARCH_LIMITS } from './baseline.js';
import {
  budgetProfileHash,
  comparisonEfficiency,
  comparisonSlices,
  comparisonSummary,
  createComparison,
  expansionReadiness,
  firstInvariantDifference,
  SCORE_CONTRACT_VERSION,
  validateComparison,
  wilsonInterval,
  type ComparisonArm,
  type ComparisonInvariants,
  type ComparisonObservation,
} from './comparison.js';
import { score } from './score.js';
import type { Score } from './types.js';

const CASE_IDS = ['case-a', 'case-b', 'case-c', 'case-d'] as const;

function invariants(overrides: Partial<ComparisonInvariants> = {}): ComparisonInvariants {
  return {
    caseIds: [...CASE_IDS],
    corpusName: 'placebo',
    corpusVersion: '0.2',
    corpusHash: 'a'.repeat(64),
    models: { ...DEFAULT_MODELS },
    routingProfile: DEFAULT_ROUTING_PROFILE_ID,
    budgetProfileHash: budgetProfileHash(DEFAULT_REPAIR_BUDGET_LIMITS),
    scoreContractVersion: SCORE_CONTRACT_VERSION,
    tavilyEnabled: true,
    suturaCommit: 'b'.repeat(40),
    ...overrides,
  };
}

function observation(
  caseId: string,
  overrides: Partial<ComparisonObservation> = {},
): ComparisonObservation {
  return {
    caseId,
    kind: 'repairable',
    language: 'javascript',
    failureClass: 'test-assertion',
    outcome: 'fixed',
    approved: true,
    falseApproval: false,
    hiddenVerification: 'passed',
    inferenceUsd: 0.12,
    sandboxOperations: 6,
    elapsedTimeSec: 30,
    ...overrides,
  };
}

function armScore(fixed: number, of: number, falseApprovals = 0): Score {
  return {
    ...score([]),
    fixRate: { fixed, of, failures: [] },
    catchRate: { refused: of - fixed, of },
    falseApprovalCount: falseApprovals,
    flakyAccuracy: { correct: fixed, of },
  };
}

function arm(
  name: ComparisonArm,
  observations: ComparisonObservation[],
  overrides: Partial<{ derived: boolean; auditEnabled: boolean; score: Score }> = {},
) {
  const derived = overrides.derived ?? name === 'first-green-wins';
  return {
    arm: name,
    searchLimits: derived
      ? null
      : { ...ARM_SEARCH_LIMITS[name as Exclude<ComparisonArm, 'first-green-wins'>] },
    auditEnabled: overrides.auditEnabled ?? !derived,
    derived,
    observations,
    score: overrides.score ??
      armScore(observations.filter(({ approved }) => approved).length, observations.length),
  };
}

function fullObservations(approvedCount: number = CASE_IDS.length): ComparisonObservation[] {
  return CASE_IDS.map((caseId, index) => observation(caseId, index < approvedCount
    ? {}
    : { outcome: 'gave-up', approved: false }));
}

function completeManifest(overrides: { primaryApproved?: number; baselineApproved?: number } = {}) {
  return createComparison({
    comparisonId: 'compare-1',
    invariants: invariants(),
    arms: [
      arm('sutura', fullObservations(overrides.primaryApproved ?? 3)),
      arm('single-branch', fullObservations(overrides.baselineApproved ?? 2)),
      arm('fixed-parallel', fullObservations(2)),
      arm('first-green-wins', fullObservations(4).map((item) => ({
        ...item, inferenceUsd: 0, sandboxOperations: 0, elapsedTimeSec: 0,
      }))),
    ],
  });
}

describe('comparison invariants', () => {
  it('records every arm sorted and computes totals from observations', () => {
    const manifest = completeManifest();

    expect(manifest.arms.map(({ arm: name }) => name))
      .toEqual(['sutura', 'single-branch', 'fixed-parallel', 'first-green-wins']);
    expect(manifest.complete).toBe(true);
    expect(manifest.arms[0]?.totals).toEqual({
      inferenceUsd: 0.48,
      sandboxOperations: 24,
      elapsedTimeSec: 120,
    });
    expect(validateComparison(manifest)).toEqual(manifest);
  });

  it('refuses an arm that misses a case or observes one outside the selection', () => {
    expect(() => createComparison({
      comparisonId: 'compare-1',
      invariants: invariants(),
      arms: [arm('sutura', fullObservations().slice(0, 3))],
    })).toThrow('Arm sutura is missing 1 case: case-d');

    expect(() => createComparison({
      comparisonId: 'compare-1',
      invariants: invariants(),
      arms: [arm('sutura', [...fullObservations(), observation('case-e')])],
    })).toThrow('Arm sutura observed a case outside the selection: case-e');
  });

  it('refuses a duplicate observation, a duplicate arm, and an unknown arm', () => {
    expect(() => createComparison({
      comparisonId: 'compare-1',
      invariants: invariants(),
      arms: [arm('sutura', [...fullObservations().slice(0, 3), observation('case-a')])],
    })).toThrow('Arm sutura observed case-a more than once');

    expect(() => createComparison({
      comparisonId: 'compare-1',
      invariants: invariants(),
      arms: [arm('sutura', fullObservations()), arm('sutura', fullObservations())],
    })).toThrow('must not repeat an arm');

    expect(() => createComparison({
      comparisonId: 'compare-1',
      invariants: invariants(),
      arms: [arm('beam-plus' as ComparisonArm, fullObservations())],
    })).toThrow('Unsupported comparison arm: beam-plus');
  });

  it('refuses a derived arm with search limits and an executed arm without them', () => {
    expect(() => createComparison({
      comparisonId: 'compare-1',
      invariants: invariants(),
      arms: [{ ...arm('sutura', fullObservations()), derived: true }],
    })).toThrow('Arm sutura is derived and must not declare search limits');

    expect(() => createComparison({
      comparisonId: 'compare-1',
      invariants: invariants(),
      arms: [{ ...arm('sutura', fullObservations()), searchLimits: null }],
    })).toThrow('Arm sutura was executed and must declare its search limits');
  });

  it('refuses a malformed invariant set', () => {
    expect(() => createComparison({
      comparisonId: 'compare-1',
      invariants: invariants({ caseIds: [] }),
      arms: [],
    })).toThrow('invariants.caseIds must be non-empty');
    expect(() => createComparison({
      comparisonId: 'compare-1',
      invariants: invariants({ caseIds: ['case-a', 'case-a'] }),
      arms: [],
    })).toThrow('invariants.caseIds must be unique');
    expect(() => createComparison({
      comparisonId: 'compare-1',
      invariants: invariants({ corpusHash: 'short' }),
      arms: [],
    })).toThrow('invariants.corpusHash must be a SHA-256 digest');
    expect(() => createComparison({
      comparisonId: 'compare-1',
      invariants: invariants({ suturaCommit: 'not-a-commit' }),
      arms: [],
    })).toThrow('invariants.suturaCommit must be an exact 40-character commit');
  });

  it('names the first invariant two runs disagree on', () => {
    expect(firstInvariantDifference(invariants(), invariants())).toBeNull();
    expect(firstInvariantDifference(invariants(), invariants({ caseIds: ['case-a'] })))
      .toBe('caseIds');
    expect(firstInvariantDifference(invariants(), invariants({ routingProfile: 'other' })))
      .toBe('routingProfile');
    expect(firstInvariantDifference(invariants(), invariants({ tavilyEnabled: false })))
      .toBe('tavilyEnabled');
    expect(firstInvariantDifference(invariants(), invariants({
      models: { ...DEFAULT_MODELS, ultra: 'other/model' },
    }))).toBe('models');
    expect(firstInvariantDifference(invariants(), invariants({ budgetProfileHash: 'c'.repeat(64) })))
      .toBe('budgetProfileHash');
  });

  it('is incomplete when an arm is missing or an observation is not-run', () => {
    const missingArm = createComparison({
      comparisonId: 'compare-1',
      invariants: invariants(),
      arms: [arm('sutura', fullObservations())],
    });
    expect(missingArm.complete).toBe(false);

    const notRun = createComparison({
      comparisonId: 'compare-1',
      invariants: invariants(),
      arms: [
        arm('sutura', fullObservations()),
        arm('single-branch', fullObservations()),
        arm('fixed-parallel', fullObservations()),
        arm('first-green-wins', [
          ...fullObservations().slice(0, 3),
          observation('case-d', { outcome: 'not-run', approved: false }),
        ]),
      ],
    });
    expect(notRun.complete).toBe(false);
  });

  it('hashes stably across timings and unstably across observations', () => {
    const first = completeManifest();
    const slower = createComparison({
      comparisonId: 'compare-1',
      invariants: invariants(),
      arms: [
        arm('sutura', fullObservations(3).map((item) => ({ ...item, elapsedTimeSec: 99 }))),
        arm('single-branch', fullObservations(2)),
        arm('fixed-parallel', fullObservations(2)),
        arm('first-green-wins', fullObservations(4).map((item) => ({
          ...item, inferenceUsd: 0, sandboxOperations: 0, elapsedTimeSec: 0,
        }))),
      ],
    });
    expect(slower.resultHash).toBe(first.resultHash);

    const different = completeManifest({ primaryApproved: 4 });
    expect(different.resultHash).not.toBe(first.resultHash);
  });

  it('refuses a tampered complete flag and a tampered hash', () => {
    const manifest = completeManifest();

    expect(() => validateComparison({ ...manifest, resultHash: 'f'.repeat(64) }))
      .toThrow('Comparison result hash mismatch');
    expect(() => validateComparison({ ...manifest, complete: false }))
      .toThrow('Comparison result hash mismatch');
  });
});

describe('Wilson intervals', () => {
  it('covers the boundaries without leaving the unit interval', () => {
    const none = wilsonInterval(0, 10);
    expect(none.value).toBe(0);
    expect(none.lower).toBe(0);
    expect(none.upper).toBeGreaterThan(0);
    expect(none.upper).toBeLessThan(1);

    const all = wilsonInterval(10, 10);
    expect(all.value).toBe(1);
    expect(all.upper).toBe(1);
    expect(all.lower).toBeGreaterThan(0);
    expect(all.lower).toBeLessThan(1);
  });

  it('reports a full interval for an empty denominator', () => {
    expect(wilsonInterval(0, 0)).toMatchObject({ lower: 0, upper: 1, width: 1 });
  });

  it('narrows as the denominator grows at a fixed proportion', () => {
    expect(wilsonInterval(100, 200).width).toBeLessThan(wilsonInterval(50, 100).width);
  });

  it('refuses impossible inputs', () => {
    expect(() => wilsonInterval(3, 2)).toThrow('0 <= numerator <= denominator');
    expect(() => wilsonInterval(-1, 2)).toThrow('0 <= numerator <= denominator');
    expect(() => wilsonInterval(1.5, 2)).toThrow('0 <= numerator <= denominator');
  });
});

describe('comparison summary', () => {
  it('reports every arm with intervals, latency, and cost', () => {
    const summaries = comparisonSummary(completeManifest());

    expect(summaries.map(({ arm: name }) => name))
      .toEqual(['sutura', 'single-branch', 'fixed-parallel', 'first-green-wins']);
    expect(summaries[0]?.repairRate).toMatchObject({ numerator: 3, denominator: 4 });
    expect(summaries[0]?.medianElapsedTimeSec).toBe(30);
    expect(summaries[0]?.p95ElapsedTimeSec).toBe(30);
    expect(summaries[3]?.derived).toBe(true);
    expect(summaries[3]?.inferenceUsd).toBe(0);
  });
});

describe('expansion readiness', () => {
  const budget = { authorizedUsd: 60, spentUsd: 2 };

  it('refuses an incomplete comparison', () => {
    const manifest = createComparison({
      comparisonId: 'compare-1',
      invariants: invariants(),
      arms: [arm('sutura', fullObservations(3)), arm('single-branch', fullObservations(2))],
    });

    const readiness = expansionReadiness(manifest, budget);

    expect(readiness.ready).toBe(false);
    expect(readiness.complete).toBe(false);
    expect(readiness.reasons.join(' ')).toContain('incomplete');
  });

  it('refuses an expansion that does not fit the remaining authorized budget', () => {
    const readiness = expansionReadiness(completeManifest(), { authorizedUsd: 3, spentUsd: 2 });

    expect(readiness.affordable).toBe(false);
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons.join(' ')).toContain('remaining authorized budget');
    expect(readiness.measuredUsdPerCase).toBeCloseTo(0.12, 10);
  });

  it('refuses expansion when the comparison is already decided', () => {
    const readiness = expansionReadiness(
      completeManifest({ primaryApproved: 4, baselineApproved: 0 }),
      { authorizedUsd: 1_000, spentUsd: 0 },
    );

    expect(readiness.statisticallyUseful).toBe(false);
    expect(readiness.reasons.join(' ')).toContain('already disjoint');
  });

  it('is ready when the run is complete, affordable, and still undecided', () => {
    const readiness = expansionReadiness(completeManifest(), { authorizedUsd: 1_000, spentUsd: 0 });

    expect(readiness.ready).toBe(true);
    expect(readiness.reasons).toEqual([]);
    expect(readiness.projectedWidthAt200).toBeLessThan(readiness.primaryMeasure.width);
  });

  it('excludes the derived arm from the measured cost per case', () => {
    const readiness = expansionReadiness(completeManifest(), { authorizedUsd: 1_000, spentUsd: 0 });

    expect(readiness.executedArms).toBe(3);
    expect(readiness.executedObservations).toBe(12);
    expect(readiness.measuredUsdPerCase).toBeCloseTo(0.12, 10);
  });
});

describe('comparison mutations and cost efficiency', () => {
  it('names a changed model, budget, routing version, challenge version or split', () => {
    const base = invariants({
      challengeVersion: 'protocol-v1', routingVersion: 'fixed-v1', splitHash: 'c'.repeat(64),
    });

    expect(firstInvariantDifference(base, invariants({
      ...base, models: { ...base.models, super: 'other-model' },
    }))).toBe('models');
    expect(firstInvariantDifference(base, invariants({
      ...base, budgetProfileHash: 'd'.repeat(64),
    }))).toBe('budgetProfileHash');
    expect(firstInvariantDifference(base, invariants({ ...base, splitHash: 'e'.repeat(64) })))
      .toBe('splitHash');
    expect(firstInvariantDifference(base, invariants({ ...base, challengeVersion: 'protocol-v2' })))
      .toBe('challengeVersion');
    expect(firstInvariantDifference(base, invariants({ ...base, routingVersion: 'adaptive-v1' })))
      .toBe('routingVersion');
    expect(firstInvariantDifference(base, invariants({ ...base }))).toBeNull();
  });

  it('slices an arm by language, kind and declared split over decided cases', () => {
    const observations = [
      observation('case-a', { language: 'javascript', kind: 'repairable' }),
      observation('case-b', { language: 'python', kind: 'repairable' }),
      observation('case-c', { language: 'python', kind: 'trap', outcome: 'refused', approved: false }),
      observation('case-d', { language: 'python', kind: 'repairable', outcome: 'infra-stop', approved: false }),
    ];
    const slices = comparisonSlices(arm('sutura', observations), {
      'case-a': 'development', 'case-b': 'development', 'case-c': 'validation', 'case-d': 'held-out',
    });

    const python = slices.find((slice) => slice.dimension === 'language' && slice.value === 'python')!;
    expect(python.cases).toBe(3);
    // The infrastructure stop is not decided, so it is not in the denominator.
    expect(python.decided).toBe(2);
    expect(python.verifiedRepairs).toBe(1);
    expect(python.repairRate.denominator).toBe(2);
    expect(slices.filter(({ dimension }) => dimension === 'split').map(({ value }) => value))
      .toEqual(['development', 'held-out', 'validation']);
  });

  it('never lets a stopped arm read as the cheapest one', () => {
    const complete = createComparison({
      comparisonId: 'compare-cost',
      invariants: invariants(),
      arms: [
        arm('sutura', fullObservations(4)),
        arm('single-branch', CASE_IDS.map((caseId) => observation(caseId, {
          outcome: 'infra-stop', approved: false, inferenceUsd: 0.001,
        })), { score: armScore(0, 4) }),
      ],
    });
    const [primary, stopped] = comparisonEfficiency(complete);

    expect(primary!.verifiedRepairs).toBe(4);
    expect(stopped!.verifiedRepairs).toBe(0);
    expect(stopped!.undecided).toBe(4);
    expect(stopped!.coverage.value).toBe(0);
    expect(stopped!.verifiedRepairsPerUsd).toBe(0);
    expect(primary!.verifiedRepairsPerUsd!).toBeGreaterThan(stopped!.verifiedRepairsPerUsd!);
  });

  it('reports no rate at all when nothing was priced, rather than an unbounded one', () => {
    const free = createComparison({
      comparisonId: 'compare-free',
      invariants: invariants(),
      arms: [arm('first-green-wins', fullObservations(4).map((item) => ({
        ...item, inferenceUsd: 0, sandboxOperations: 0, elapsedTimeSec: 0,
      })))],
    });

    expect(comparisonEfficiency(free)[0]!.verifiedRepairsPerUsd).toBeNull();
  });

  it('does not count an approved patch a hidden check or an unknown oracle contradicts', () => {
    const observations = [
      observation('case-a'),
      observation('case-b', { hiddenVerification: 'failed', falseApproval: true }),
      observation('case-c', { oracleStatus: 'unknown' }),
      observation('case-d', { oracleStatus: 'verified' }),
    ];
    const slices = comparisonSlices(arm('sutura', observations));
    const repairable = slices.find(({ dimension, value }) => dimension === 'kind' && value === 'repairable')!;

    expect(repairable.decided).toBe(4);
    expect(repairable.verifiedRepairs).toBe(2);
    expect(repairable.falseApprovals).toBe(1);
  });
});
