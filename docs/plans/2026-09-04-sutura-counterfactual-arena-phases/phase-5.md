# Phase 5: Comparison invariant harness

Issue: #81

Depends on: nothing. `[batch-eligible]` with Phase 7.

## Goal

Build the invariant harness first so every later comparison inherits it. A
comparison manifest is refused unless case selection, limits, provider models,
routing profile, budget profile, and scoring contract are identical across every
arm.

## Design

`packages/placebo/src/comparison.ts` (new), modelled on the discipline in
`packages/placebo/src/ablation.ts` (frozen candidate list, experiment identity,
`matrixComplete`, `resultHash`, a `complete` flag that the validator re-derives).

```ts
export const COMPARISON_SCHEMA_VERSION = 'sutura-search-comparison-v1' as const;

export const COMPARISON_ARMS = [
  'sutura', 'single-branch', 'fixed-parallel', 'first-green-wins',
] as const;
export type ComparisonArm = typeof COMPARISON_ARMS[number];

export interface ComparisonInvariants {
  caseIds: readonly string[];        // sorted, non-empty, unique
  corpusName: string;
  corpusVersion: string;
  corpusHash: string;                // 64 hex
  models: { nano: string; super: string; ultra: string };
  routingProfile: string;
  budgetProfileHash: string;         // canonical hash of the budget limits
  scoreContractVersion: 'sutura-placebo-score-v2';
  tavilyEnabled: boolean;
  suturaCommit: string;              // 40 hex
}

export interface ComparisonArmRecord {
  arm: ComparisonArm;
  searchLimits: SearchLimits | null; // null for first-green-wins (a projection)
  auditEnabled: boolean;
  derived: boolean;                  // true when the arm is a projection
  observations: ComparisonObservation[];
  score: Score;
  totals: { inferenceUsd: number; sandboxOperations: number; elapsedTimeSec: number };
}

export interface ComparisonObservation {
  caseId: string;
  kind: CaseKind;
  language: FixtureLanguage;
  failureClass: FailureClass;
  outcome: CaseFile['outcome'] | 'not-run';
  approved: boolean;
  falseApproval: boolean;
  hiddenVerification: 'passed' | 'failed' | 'not-run';
  inferenceUsd: number;
  sandboxOperations: number;
  elapsedTimeSec: number;
}

export interface ComparisonManifest {
  schemaVersion: typeof COMPARISON_SCHEMA_VERSION;
  comparisonId: string;
  invariants: ComparisonInvariants;
  arms: ComparisonArmRecord[];
  complete: boolean;
  resultHash: string;
}
```

`createComparison(input)`:

- refuses an empty or duplicated `caseIds` list
- refuses an arm whose observations do not cover exactly `caseIds`, so no
  failed case can be dropped from a denominator (roadmap strategy rule 3)
- refuses a duplicate arm
- refuses `first-green-wins` with a non-null `searchLimits`, and refuses any
  executed arm with a null one
- sorts arms by the declared `COMPARISON_ARMS` order and observations by
  `caseId`
- sets `complete` only when every arm in `COMPARISON_ARMS` is present, each
  covers every case id, and no observation is `not-run`
- computes `resultHash` over the canonical manifest with `elapsedTimeSec`
  normalized to 0, matching the Phase 3 reproducibility rule

`validateComparison(manifest)` re-derives `complete` and `resultHash` and
refuses a mismatch, exactly as `validateModelAblation` does.

`comparisonSummary(manifest)` returns, per arm and per primary measure, the
value plus a Wilson 95 percent interval on the proportion measures (repair
rate, catch rate, flake accuracy). This is the input Phase 8 renders and Phase 9
uses to decide expansion readiness.

`budgetProfileHash(limits)` is `sha256(canonicalJson(limits))` over
`RepairBudgetLimits`, so a budget change invalidates a comparison instead of
silently changing its meaning.

## Tests

`packages/placebo/src/comparison.test.ts`:

- refuses an arm missing a case id, and refuses an arm with an extra case id
- refuses two arms whose invariants differ in models, routing profile, budget
  hash, corpus hash, tavily flag, or score contract version
- refuses a duplicate arm and an unknown arm name
- `complete` is false when any observation is `not-run`
- `resultHash` is stable across `elapsedTimeSec` changes and unstable across
  any observation change
- `validateComparison` refuses a tampered `complete` flag and a tampered hash
- Wilson intervals are correct at the boundaries 0/n and n/n

## Success criteria

- [ ] All listed tests pass.
- [ ] `packages/placebo/src/score.ts` unchanged.
- [ ] No arm can be recorded with a partial denominator.
- [ ] `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`.
