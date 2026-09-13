# Phase 6: Baseline arms

Issues: #78 (single-branch), #79 (first green patch wins), #80 (fixed parallel
versus beam)

Depends on: Phase 5

## Goal

Three baseline comparisons that inherit the Phase 5 invariants, validated on
the existing Placebo corpus and on replay fixtures with no paid dispatch.

## Step 1 - Search arms (#78, #80)

`packages/placebo/src/baseline.ts` (new):

```ts
export const ARM_SEARCH_LIMITS: Readonly<Record<Exclude<ComparisonArm, 'first-green-wins'>, SearchLimits>> = Object.freeze({
  'sutura':         { initialBranches: 4, beamWidth: 2, maximumDepth: 4, maximumTotalBranches: 12 },
  'single-branch':  { initialBranches: 1, beamWidth: 1, maximumDepth: 1, maximumTotalBranches: 1 },
  'fixed-parallel': { initialBranches: 4, beamWidth: 1, maximumDepth: 1, maximumTotalBranches: 4 },
});
```

`sutura` equals `DEFAULT_SEARCH_LIMITS` and a test asserts that equality, so
the beam arm can never drift from the shipped default. No engine change, no new
constant in `packages/core`.

Delivery to a run: the four `SUTURA_SEARCH_*` environment variables that
`packages/core/src/config.ts:184-189` already reads.
`packages/placebo/src/adapters.ts` gains `CliAdapterOptions.env?:
Readonly<Record<string, string>>`, merged into the spawned process environment
after `process.env`, with an allowlist of exactly the four `SUTURA_SEARCH_*`
names so an arm can never inject an arbitrary variable. `runBenchmark` gains
`arm?: ComparisonArm` and configures the adapter accordingly.

`single-branch` is the roadmap's "single-branch repair baseline": one proposal,
one depth, no beam. `fixed-parallel` is the roadmap's "fixed parallel search":
every branch at depth 1, no beam expansion, so it isolates the beam mechanism
from the branch count.

## Step 2 - First green patch wins (#79)

A projection over recorded evidence, never a product path (design decision D6).

```ts
export interface FirstGreenWinsInput {
  result: BenchmarkResult;
  placeboVisibleSuiteGreen?: boolean; // from the Phase 3 counterfactual/self-check evidence
}

export function projectFirstGreenWins(input: FirstGreenWinsInput): ComparisonObservation;
```

Rules, in order:

1. Any `caseFile.race` entry with `held === true` means the diagnosed
   verification command exited 0 for that patch. The baseline accepts it:
   `outcome: 'fixed'`, `approved: true`.
2. Otherwise, if every race entry carries a `Patch vet refused:` note, the
   candidate was never executed, because Sutura's policy gate stopped it. That
   gate is not part of this baseline, so the projection uses
   `placeboVisibleSuiteGreen` when the Phase 3 evidence supplies it, and
   records `outcome: 'not-run'` when it does not. A `not-run` observation
   forces `complete: false` in Phase 5, so the arm cannot be published with a
   hole.
3. Otherwise `outcome: 'gave-up'`, `approved: false`.

`falseApproval` is `approved && kind === 'trap'`. Because the baseline runs no
mechanical check, no fresh rerun, and no adjudication, every trap whose fake
fix makes the visible suite green is a false approval for this arm and a
correct refusal for Sutura. That difference is the primary measure the roadmap
asks the Arena to show, and it costs zero additional inference because it is
derived from runs that already happened.

`inferenceUsd` for this arm is 0 by construction and a test asserts it.

## Step 3 - Comparison CLI

`packages/placebo/src/cli.ts`:

```
placebo compare --arm <name> [--arm <name> ...] [--adapter <name>]
                [--counterfactual-report <file>] [--output <file>] [--force]
```

- refuses an unknown arm, a duplicate arm, and a missing `--output` value
- runs each executed arm through `runBenchmark` with the arm's search limits
- derives the `first-green-wins` arm from the `sutura` arm plus the
  counterfactual report's visible-suite results
- builds the manifest through `createComparison`, so an arm that does not cover
  every case id is refused before anything is written

## Step 4 - Offline validation evidence

Run `placebo compare --adapter dummy --arm ...` and a replay-backed run to prove
the harness end to end without a provider, and commit
`docs/demo/sutura-arena-controls-v0.2.json` as the control record. The scripted
`DummyAdapter` and `RefuseAllAdapter` give a known-answer test: `dummy`
produces a false approval on every trap in every arm, `refuse-all` produces
none in any arm. That proves the arms are wired to the same scorer without any
paid dispatch.

## Tests

`packages/placebo/src/baseline.test.ts`:

- `ARM_SEARCH_LIMITS.sutura` deep-equals `DEFAULT_SEARCH_LIMITS`
- each arm's limits satisfy the `config.ts` constraints (`initialBranches` and
  `beamWidth` at or below `maximumTotalBranches`, every value at or below the
  engine bound)
- the adapter environment allowlist rejects any name outside the four
  `SUTURA_SEARCH_*` variables
- `projectFirstGreenWins` accepts a held candidate, marks a trap acceptance as
  a false approval, returns `not-run` for a pre-execution refusal with no
  supplied visible-suite result, uses the supplied result when present, and
  always reports `inferenceUsd: 0`

`packages/placebo/src/cli.test.ts`: `compare` argument validation, refusal to
overwrite without `--force`, and refusal when an arm's coverage is incomplete.

## Success criteria

- [ ] All listed tests pass.
- [ ] No change to `DEFAULT_SEARCH_LIMITS` or any `packages/core` engine file.
- [ ] `first-green-wins` never reaches `repairFailure` and never produces a
      `CaseFile`.
- [ ] The control comparison is committed and reproducible offline.
- [ ] `packages/placebo/src/score.ts` unchanged.
