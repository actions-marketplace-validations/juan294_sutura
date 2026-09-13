# Sutura counterfactual proof and Arena plan (WS-2)

Date: 2026-09-04

Status: Phases 1 to 10 implemented and on `develop`; live authorization gates
G1 to G4 pending

Owner: WS-2 (Counterfactual proof and Arena)

Integration branch: `develop`

Base commit: `e58dc6ba43b6d3bdc55a5d2bcaeae4fab16bea50`

Research: `docs/research/2026-09-04-sutura-counterfactual-arena.md`

Workstream: `docs/plans/2026-09-04-sutura-issue-workstreams.md` (WS-2 section)

Roadmap: `docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md` Phase 2 and
Phase 3 (benchmark).

## Objective

Make Sutura's verification value visible and measurable.

Phase 2 delivers the counterfactual proof: for selected cases, two or three
plausible alternative patches are evaluated from the same ConTree checkpoint
through the identical gate stack that the accepted patch passes, and the exact
rule that rejects each deceptive alternative is recorded in the evidence and the
ATIF export.

Phase 3 delivers the Arena: a comparison harness whose invariants make three
baseline comparisons (single-branch, first-green-wins, fixed-parallel versus
beam) reproducible from one versioned manifest, a stratified case-selection
manifest for 100 public software-engineering cases, and a public Arena result
page with a downloadable machine-readable report.

## Issues covered

| Order | Issue | Roadmap item | Phase |
| ---: | --- | --- | ---: |
| 1 | #69 | Two or three alternative patches from the same ConTree checkpoint | 1, 3 |
| 2 | #70 | At least one shortcut that weakens a test, type check, lint rule, or error path | 1, 3 |
| 3 | #71 | Every candidate through the same mechanical and model-audit gates | 1, 4 |
| 4 | #72 | Record the exact rule, hidden test, policy, or audit finding | 1, 3 |
| 5 | #75 | Measure additional cost, latency, and sandbox operations | 1, 3 |
| 6 | #74 | Counterfactual results in the evidence and ATIF formats | 2 |
| 7 | #73 | Side-by-side view in the Case Lab | 10 |
| 8 | #81 | Identical selection, limits, models, and scoring across comparisons | 5 |
| 9 | #78 | Single-branch repair baseline | 6 |
| 10 | #79 | "First green patch wins" baseline | 6 |
| 11 | #80 | Fixed parallel search versus beam search | 6 |
| 12 | #76 | Stratified 100-case selection | 7 |
| 13 | #77 | Language, failure class, repository, difficulty, inclusion reason | 7 |
| 14 | #53 | Public Sutura Arena page and machine-readable report | 8 |
| 15 | #82 | Expansion toward 200 cases | 9 |

## Design decisions

### D1. The counterfactual gate stack is the production gate stack

Research section 2 establishes that the production stack for a winning
candidate is exactly four calls in one order:

1. `policyVerdict` (`vetPatch` then `evaluatePatchPolicy`)
2. `race` against the failing image with the diagnosed verification command
3. `audit` (mechanical checks → held check → fresh suite rerun → Ultra
   adjudication)
4. `enforceWinnerPolicy` (repository required commands and resource limits)

Counterfactual evaluation calls the same four functions in the same order on
the same baseline image, and records the first gate that rejects. It does not
re-implement any check. `enforceWinnerPolicy` and the sandbox command helpers
move out of `heal.ts` into their own modules so both callers share one
definition without a circular import.

### D2. Alternatives run from the same ConTree checkpoint by construction

`race` applies each diff to `ctx.failingImage`, which is the same baseline
image every controlled search proposal applies to
(`packages/core/src/engine/repair-attempt.ts:188`). No new checkpoint concept is
introduced.

### D3. Rejecting a deceptive patch costs zero inference

`audit` short-circuits at the mechanical layer before any Ultra call. A
shortcut that weakens a test, a type check, a lint rule, or an error path is
rejected by a named mechanical rule for zero inference; a plausible but wrong
patch is rejected by the verification race, also for zero inference. The
counterfactual feature therefore adds sandbox operations and elapsed time, and
adds inference only for an alternative that survives every deterministic gate.
This is the measured claim for #75.

### D4. Alternatives live outside the frozen corpus

`packages/placebo/corpus/**` and `packages/placebo/src/score.ts` are frozen
denominators, and any file added inside a case directory would change
`corpusHash` and therefore every evaluation manifest hash, including the
benchmark WS-4 is running. Counterfactual alternatives live in a sibling tree
`packages/placebo/counterfactual/<caseId>/` with its own manifest and its own
hash. The corpus stays byte-identical.

### D5. Offline evidence first, live evidence second

The provider-free counterfactual harness reproduces gates 1 to 3a
(patch policy, verification race, mechanical checks) plus the hidden test set,
which is every gate a deceptive alternative can reach. It runs in CI with no
provider and no spend, and it is the Phase 2 exit-gate evidence. The live path
through `repairFailure` adds gates 3b and 4 and is exercised by a paid run
under its own authorization.

### D6. "First green patch wins" is a measurement arm, never a product path

The baseline is a separate scoring projection over recorded evidence plus, for
cases Sutura refused before execution, one sandbox-only execution of the
candidate. It never reaches `repairFailure`, never produces a `CaseFile`
outcome, and is quarantined in `packages/placebo`. Roadmap strategy rule 10
(Sutura never automatically merges a generated repair) is unaffected.

### D7. Baseline search modes are expressed through existing limits

`SearchLimits` already bounds `initialBranches`, `beamWidth`, `maximumDepth`,
and `maximumTotalBranches`, and `config.ts` already validates them. The three
search arms are:

| Arm | initialBranches | beamWidth | maximumDepth | maximumTotalBranches |
| --- | ---: | ---: | ---: | ---: |
| `sutura` (beam) | 4 | 2 | 4 | 12 |
| `single-branch` | 1 | 1 | 1 | 1 |
| `fixed-parallel` | 4 | 1 | 1 | 4 |

No engine change, no new constant, and `DEFAULT_SEARCH_LIMITS`,
`DEFAULT_REPAIR_BUDGET_LIMITS`, and `REPAIR_ATTEMPT_COSTS` stay byte-identical.

### D8. Nothing weakens an existing gate

No change to any mechanical check, the adjudication prompt, the policy schema,
any Placebo fixture, `packages/placebo/src/score.ts`, or any terminal outcome
class. Every new field is additive and optional.

## Phases

| Phase | Name | Issues | Files | Depends on | Batch |
| ---: | --- | --- | --- | --- | --- |
| 1 | Counterfactual gate engine in core | 69, 70, 71, 72, 75 | `packages/core/src/engine/sandbox-command.ts`, `packages/core/src/audit/repository-policy.ts`, `packages/core/src/counterfactual/*`, `packages/core/src/heal.ts`, `packages/core/src/domain.ts`, `packages/core/src/index.ts` | None | Not batch-eligible |
| 2 | Counterfactual evidence, trace, and ATIF | 74 | `packages/core/src/trace/types.ts`, `packages/core/src/report/casefile.ts`, `packages/evaluation/src/validate.ts`, `packages/evaluation/src/atif.ts`, `packages/evaluation/src/schema.ts` | 1 | Not batch-eligible |
| 3 | Placebo counterfactual set and offline harness | 69, 70, 72, 75 | `packages/placebo/counterfactual/**`, `packages/placebo/src/counterfactual.ts`, `packages/placebo/src/cli.ts`, `docs/demo/sutura-counterfactual-v0.2.json` | 1 | Not batch-eligible |
| 4 | Live path wiring through the CLI and adapter | 71, 75 | `packages/cli/src/args.ts`, `packages/cli/src/heal.ts`, `packages/placebo/src/adapters.ts`, `packages/placebo/src/harness.ts`, `packages/placebo/src/types.ts`, `packages/action/dist/index.cjs` | 1, 3 | Not batch-eligible |
| 5 | Comparison invariant harness | 81 | `packages/placebo/src/comparison.ts`, `packages/placebo/src/types.ts` | None | `[batch-eligible]` with 7 |
| 6 | Baseline arms | 78, 79, 80 | `packages/placebo/src/comparison.ts`, `packages/placebo/src/baseline.ts`, `packages/placebo/src/cli.ts` | 5 | Not batch-eligible |
| 7 | Arena case selection manifest | 76, 77 | `packages/placebo/src/selection.ts`, `packages/placebo/arena/**` | None | `[batch-eligible]` with 5 |
| 8 | Arena report page and machine-readable report | 53 | `packages/placebo/src/arena.ts`, `packages/placebo/src/cli.ts`, `docs/demo/sutura-arena-*.{json,html}` | 5, 6, 7 | Not batch-eligible |
| 9 | Expansion readiness gate | 82 | `packages/placebo/src/comparison.ts`, this plan | 8 | Not batch-eligible |
| 10 | Case Lab side-by-side view | 73 | `packages/case-lab/src/render.ts`, `result.ts` | WS-1 #66, #67 on `develop` | Done |

Phase files live in `docs/plans/2026-09-04-sutura-counterfactual-arena-phases/`.

## Verification

Each phase runs its focused tests, then `pnpm run typecheck`, `pnpm run lint`,
`pnpm run build`, and `pnpm run test`. Every integrated commit that touches
`packages/core` runs `pnpm run ci:local` before the push and rebuilds
`packages/action/dist/index.cjs` in the same commit.

Frozen-input check for every phase:

```bash
git diff --stat <base>..HEAD -- packages/placebo/corpus packages/placebo/src/score.ts
```

must be empty, and `DEFAULT_SEARCH_LIMITS`, `DEFAULT_REPAIR_BUDGET_LIMITS`, and
`REPAIR_ATTEMPT_COSTS` must be byte-identical.

The offline corpus self-check must remain 51 benchmark cases and 55 evaluations
(`pnpm --filter placebo run smoke:offline`).

## Measured offline result

`pnpm --filter placebo run counterfactual`, recorded in
`docs/demo/sutura-counterfactual-v0.2.json`:

| Measure | Value |
| --- | ---: |
| Cases with alternatives | 5 |
| Alternatives evaluated | 15 |
| Alternatives rejected by a deterministic gate | 14 |
| Declared shortcuts | 10 |
| Shortcuts rejected | 10 |
| Observed gates that differed from their declaration | 0 |
| Inference spent | USD 0.00 |
| Sandbox-equivalent operations added | 17 |

Distinct rejecting rules observed: `adds pass-with-no-tests bypass`,
`adds unsafe Python shortcut: tests/test_app.py`,
`deletes test file: case.test.js`, `loosened-type`, `relaxed-config`,
`touches tool config: pyproject.toml`, `touches tool config: tsconfig.json`,
`verification-command`, `weakened-assertion`.

The one alternative no deterministic gate rejected is
`python-repair-missing-await/drop-the-coroutine`: it makes the visible suite
exit 0 and the hidden test set fail. That is the case's own demonstration that
a green suite is not sufficient, and it is recorded as such rather than counted
as a rejection.

The Arena harness is validated end to end offline with the scripted control
adapters in `docs/demo/sutura-arena-controls-v0.2.json` and rendered to
`docs/demo/sutura-arena-v0.2.{json,html}`. Those artifacts carry a
`CONTROL ARTIFACT — NOT A SUTURA RESULT` banner: the `dummy` control approves
all 19 traps and the `refuse-all` control approves none, which is the
known-answer test proving every arm is wired to the same scorer. The measured
Arena replaces them under gate G2.

## Success criteria

Phase 2 (roadmap exit gate):

- [ ] At least four representative Placebo cases record one accepted or
      correctly refused outcome beside two or three rejected alternatives.
- [ ] Every alternative declared `shortcut` is rejected, and the recorded
      rejecting gate is deterministic (never `adjudication`).
- [ ] Every rejection names an exact rule: a mechanical check name, a policy
      violation string, the verification command exit, or a hidden test set
      hash.
- [ ] The counterfactual feature adds no false approval and does not change any
      production outcome (asserted by test).
- [ ] Additional cost, latency, and sandbox operations are measured per
      alternative and in total.
- [ ] Counterfactual results appear in the evaluation manifest and in the ATIF
      export without repeating any patch body.

Phase 3 (roadmap benchmark exit gate):

- [ ] Every comparison arm is refused unless case selection, limits, models,
      routing profile, budget profile, and score contract are identical.
- [ ] The three baseline arms run on the existing Placebo corpus and on replay
      fixtures with no paid dispatch.
- [ ] The selection manifest records language, failure class, repository,
      difficulty, and inclusion reason for every case, and stratification is
      deterministic from a catalog snapshot.
- [ ] The Arena page and the machine-readable report render every measure the
      roadmap "Public Arena view" section lists, from one manifest.
- [ ] No failed case is removed from any denominator.
- [ ] Expansion toward 200 cases is refused until the 100-case run is complete,
      affordable, and statistically useful.

## Authorization gates

This plan authorizes no push to a paid workflow, no canary, no live case run,
no benchmark, and no release. Each of the following needs its own explicit
authorization with the exact candidate commit.

### G1. Live counterfactual case run (Phase 4 evidence)

Purpose: prove gates 3b and 4 on the live path, which the offline harness
cannot reach.

- Commands, one dispatch per case:
  ```bash
  pnpm run placebo:live run --authorize --counterfactual \
    --controller-sha <controller 40-char sha> --subject-sha <subject 40-char sha> \
    --case repair-off-by-one
  pnpm run placebo:live run --authorize --counterfactual \
    --controller-sha <controller 40-char sha> --subject-sha <subject 40-char sha> \
    --case trap-error-propagation-removal
  ```
- Cases: 2 (one repairable, one trap), each with 3 alternatives.
- Maximum spend: USD 1.00.
- Reserve: USD 0.25 for one retry of a failed dispatch.
- Maximum operations: 2 dispatches.
- Expected cost: about USD 0.24 to USD 0.30 at the measured USD 0.12 per
  evaluation, plus zero inference for every alternative that is rejected before
  adjudication.
- Stop condition: stop at USD 1.00 spent, or after the second failed dispatch,
  whichever comes first.
- Prerequisite: `pnpm run push-freeze on --reason "counterfactual live run on <sha>"`
  is owned by WS-4; WS-2 requests it before the first dispatch.

### G2. 100-case Arena comparison run (Phase 8 evidence)

Purpose: the roadmap Phase 3 benchmark exit gate.

- Command, on a runner that holds the provider secrets:
  ```bash
  node packages/placebo/bin/placebo.js compare \
    --arm sutura --arm single-branch --arm fixed-parallel --arm first-green-wins \
    --adapter sutura --sutura-command <subject cli path> \
    --output docs/demo/sutura-arena-<sha>.json
  node packages/placebo/bin/placebo.js arena \
    --comparison docs/demo/sutura-arena-<sha>.json \
    --selection packages/placebo/arena/<selection>.json \
    --counterfactual docs/demo/sutura-counterfactual-v0.2.json \
    --output-json docs/demo/sutura-arena-<sha>-report.json \
    --output-html docs/demo/sutura-arena-<sha>.html
  ```
- Cases: 100 per executed arm. `first-green-wins` is a projection over the
  `sutura` arm plus at most 19 sandbox-only trap executions, so it costs no
  inference.
- Executed arms: 3 (`sutura`, `single-branch`, `fixed-parallel`) = 300
  evaluations.
- Expected cost: about USD 36 at the measured USD 0.12 per evaluation.
  `single-branch` and `fixed-parallel` use fewer branches, so the realistic
  range is USD 24 to USD 40.
- Maximum spend: USD 60.00.
- Reserve: USD 15.00 for re-running failed cases without reducing the
  denominator.
- Maximum operations: 300 dispatches plus 60 retries.
- Stop condition: stop at USD 60.00 spent, or when failed dispatches exceed 20
  percent of any arm, whichever comes first.
- Prerequisite: `develop` push freeze for the whole run (WS-4 owns it).

### G3. Nebius SWE environment catalog read (Phase 7 input)

Purpose: #76 stratified selection over SWE-bench Verified and SWE-rebench
environments.

- Command: `pnpm run arena:catalog --output packages/placebo/arena/catalog-<date>.json`
  dispatched through GitHub Actions so `CONTREE_TOKEN` never enters a worktree.
- Cost: no inference. Read-only catalog pagination.
- Maximum operations: 50 catalog requests.
- Stop condition: stop after 50 requests or on any non-2xx response.
- Until this gate is authorized, Phase 7 is validated end to end against the
  committed Placebo corpus as its catalog snapshot, and the 100-case selection
  is not produced.

### G4. 200-case expansion (#82)

Refused by construction until `expansionReadiness` reports the 100-case run
complete, its measured cost within an authorized cap, and the primary measure's
95 percent interval wide enough that doubling the denominator narrows it
materially. The gate command and cap are recorded in Phase 9 after G2 returns
measured numbers, never before.

## Out of scope

- Any change to `DEFAULT_SEARCH_LIMITS`, `DEFAULT_REPAIR_BUDGET_LIMITS`,
  `REPAIR_ATTEMPT_COSTS`, the adjudication prompt, or any mechanical check.
- Any change to `packages/placebo/corpus/**` or `packages/placebo/src/score.ts`.
- Nano and Ultra sampling parameters, the 8,192-token completion envelope, and
  `force_nonempty_content`. Tracked by the search-recovery plan.
- Data Lab upload and batch inference (WS-3).
- The Case Lab product surface itself (WS-1). Phase 10 consumes it.
