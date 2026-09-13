# Phase 9: Expansion readiness gate

Issue: #82

Depends on: Phase 8

## Goal

Expansion toward 200 cases is refused by code until the 100-case run is
complete, affordable, and statistically useful. The roadmap wording is turned
into three checkable conditions instead of a judgement call.

## Design

`packages/placebo/src/comparison.ts`:

```ts
export interface ExpansionBudget {
  authorizedUsd: number;    // the cap the 100-case run was authorized under
  spentUsd: number;         // measured from the manifest arm totals
}

export interface ExpansionReadiness {
  ready: boolean;
  complete: boolean;
  affordable: boolean;
  statisticallyUseful: boolean;
  measuredUsdPerCase: number;
  projectedUsdForExpansion: number;
  primaryMeasure: { arm: ComparisonArm; key: 'fixRate'; value: number; lower: number; upper: number; width: number };
  projectedWidthAt200: number;
  reasons: string[];        // one sentence per failed condition, empty when ready
}

export function expansionReadiness(
  manifest: ComparisonManifest,
  budget: ExpansionBudget,
): ExpansionReadiness;
```

Conditions:

1. **Complete.** `validateComparison(manifest)` passes and `manifest.complete`
   is true. Every arm covered every case id and no observation is `not-run`.
2. **Affordable.** `measuredUsdPerCase` is the total inference cost across
   executed arms divided by the executed observation count.
   `projectedUsdForExpansion` is `measuredUsdPerCase × 100 × executedArms`.
   Affordable is `projectedUsdForExpansion <= budget.authorizedUsd -
   budget.spentUsd` — that is, expansion must fit inside remaining authorized
   budget, never inside a new assumption.
3. **Statistically useful.** The primary measure is the `sutura` arm's
   `fixRate`. Its Wilson 95 percent interval width at n = 100 is compared with
   the projected width at n = 200 holding the observed proportion constant.
   Expansion is useful only when the projected width is at least 20 percent
   narrower **and** the current interval overlaps the `single-branch` arm's
   interval, meaning the comparison is not already decided. If the intervals are
   already disjoint, doubling the denominator buys nothing and the function says
   so.

`ready` is the conjunction. `reasons` names every failed condition with the
measured numbers, so the refusal is auditable.

No expansion command exists in this phase. A 200-case run is a separate
authorization with its own cap, recorded only after `expansionReadiness`
returns `ready: true` against a real 100-case manifest.

## CLI

`placebo arena --comparison <file> --expansion-budget <usd> --spent <usd>`
prints the readiness record and exits 0 when ready, 1 when not, so the gate can
be a CI or release check rather than a memo.

## Tests

`packages/placebo/src/comparison.test.ts` additions:

- an incomplete manifest is not ready and names completeness in `reasons`
- a manifest whose projected expansion exceeds the remaining budget is not
  ready and names the projected and remaining amounts
- disjoint `sutura` and `single-branch` intervals make
  `statisticallyUseful` false with a reason that says the comparison is already
  decided
- a manifest meeting all three conditions is ready with an empty `reasons`
- `measuredUsdPerCase` excludes the derived `first-green-wins` arm, whose
  inference cost is 0 by construction

## Gate G4

Recorded in the parent plan. The exact expansion command, cap, reserve, and
stop condition are written into this phase only after gate G2 returns a real
100-case manifest and `expansionReadiness` reports `ready: true`. Writing them
earlier would be a placeholder number, which this project forbids.

## Success criteria

- [ ] All listed tests pass.
- [ ] Expansion cannot be started from any committed command while
      `expansionReadiness` is false.
- [ ] No number in this phase is written before it is measured.
