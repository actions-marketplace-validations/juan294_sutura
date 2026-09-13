# Phase 4: Run authorized evidence and publish the baseline

Dependencies: Phases 1-3

Batch status: Sequential

Authority: Local verification first; each remote or paid step has a separate gate

## Goal

Run the complete live evidence program, promote public-safe results, update claims, and close Phase 0 without starting later roadmap work.

## Preconditions

- Phases 1-3 are merged into local `develop`.
- `codex-simplify` completed and all accepted fixes are integrated.
- `pnpm run ci:local` passes on the exact integrated commit.
- Sutura and demo task worktrees are clean.
- The exact controller commit, subject commit, run counts, worst-case per-case bounds, proposed cap, and reserve are written in an operational report.
- The user separately authorizes each outward or paid action.

## Step 1: Integrate and verify controller code

Run:

```bash
pnpm run ci:local
git status --short --branch
git rev-parse HEAD
```

Verify the demo repository's complete local gate separately.

Stop and present:

- Exact Sutura controller commit.
- Exact demo commit.
- Exact v0.2.0 subject commit.
- Planned workflow and case counts.
- Maximum authorized spend proposal and reserve for each live controller.
- Which remote branches, pull requests, and artifacts will be created.

Do not infer authorization from approval of this plan.

## Step 2: Push the controllers

After explicit push authorization:

1. Push the exact Sutura `develop` commit.
2. Monitor exact-SHA CI to terminal success.
3. Integrate the demo changes into its documented default branch.
4. Push the exact demo commit.
5. Monitor demo CI to terminal success.
6. Record both commits and run URLs.

A failed CI run blocks all live evidence.

## Step 3: Refresh live contracts

After explicit canary authorization:

1. Dispatch the provider-contract canary on the exact Sutura controller commit.
2. Verify its artifact, model, endpoint, schema, tool behavior, token use, request ID, and age.
3. Run the exact ConTree preparation, network-isolation, branch, cancellation, and resource probes required by the current live contract.
4. Record total canary cost.

Do not reuse a stale canary after a provider or model contract change.

## Step 4: Run Placebo v0.2

After explicit benchmark authorization with one cap and reserve:

1. Run the read-only `gate` command.
2. Run the resumable `streak` command.
3. Stop automatically at the cap reserve or any safety failure.
4. Resume only under the same exact identities and remaining authorized cap.
5. Finalize only after 51 cases and 55 evaluations exist.
6. Preserve all failed, refused, gave-up, and infrastructure outcomes.

If a false approval occurs, stop immediately. Do not continue to gather a better-looking score.

If the cap stops an incomplete run, report completed denominator, spend, reserve, and estimated completion cap. Do not promote a partial result as the v0.2 benchmark.

## Step 5: Run the candidate matrix

After separate candidate-matrix authorization:

1. Gate exact identities.
2. Run the eight cases sequentially in candidate mode.
3. Finalize with the existing analyzer.
4. Require 8/8 and zero false approvals.
5. Preserve every public run, artifact, PR, and check link.

A failed candidate case remains in the result. Repair product defects through a new candidate; do not edit outcome JSON.

## Step 6: Run the public matrix

After separate public-matrix authorization:

1. Verify npm and tag identity again.
2. Run the eight cases sequentially in public mode.
3. Finalize with the existing analyzer.
4. Require 8/8 and zero false approvals.
5. Compare candidate and public package content hashes.

A public-only defect requires a patch-release plan. Do not move the v0.2.0 tag.

## Step 7: Clean matrix state

After explicit cleanup authorization:

- Close only controller-recorded matrix pull requests.
- Delete only controller-recorded matrix branches.
- Preserve workflow runs, artifacts, checks, comments, and closed PR pages used as evidence.
- Verify the default branch and unrelated refs are unchanged.
- Record cleanup results.

## Step 8: Promote evidence

Add:

- `docs/demo/placebo-v0.2-live-2026-09.md`
- `docs/demo/placebo-v0.2-live-2026-09.json`
- `docs/demo/sutura-v0.2.0-candidate-matrix.json`
- `docs/demo/sutura-v0.2.0-public-matrix.json`
- `docs/demo/sutura-v0.2.0-phase-0-evidence.md`
- Release-evidence input and normalized output under `docs/demo/` when each stays within the public evidence contract

Update:

- `README.md`
- `packages/placebo/README.md`
- `docs/demo/placebo-v0.2-local.md`
- `docs/release/v0.2.0-release-playbook.md`
- `docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md`

The concise report includes:

- Complete score and denominators.
- Results by language, difficulty, failure class, and flake pattern.
- Hidden-test preservation.
- Tavily ablation.
- Median and total inference cost.
- Median and total sandbox cost and operations.
- Median and total elapsed time.
- Budget exhaustion count.
- Every failed case ID.
- Controller, subject, package, corpus, run, artifact, and result hashes.

Review redaction before commit. The public result must contain no credential, authorization header, secret, local private path, or private repository data.

## Step 9: Reconcile evidence status

Set these records from direct evidence:

- `benchmark`
- `candidate-matrix`
- `dogfood`
- `github-release`
- `local-gate`
- `npm`
- `public-matrix`

Keep these records pending with their roadmap owner:

- `demo` -> Phase 1
- `marketplace` -> Phase 4
- `feedback` -> Phase 5
- `devpost` -> Phase 7

The normalized final-submission manifest remains `ready: false`. This is expected at Phase 0.

## Automated success criteria

- Placebo finalization contains 51 unique cases and 55 evaluations.
- False approvals are zero and hidden verification is 15/15.
- Candidate and public matrices each report 8/8 and zero false approvals.
- All evidence hashes and public URLs validate.
- README numbers equal the machine-readable result.
- Phase 0 evidence status matches the owner map.
- `pnpm run ci:local` passes after evidence promotion.

## Manual success criteria

- Inspect at least one repair, refusal, flake, upstream, Python, policy, direct-branch, and audit-only public result.
- Open sampled links while signed out.
- Confirm all claims distinguish observed result from target.
- Confirm the dogfood equivalence note names both commits accurately.

## Final integration and cleanup

1. Commit the reviewed evidence and documentation on the task branch.
2. Integrate into local `develop`.
3. Run the complete local gate at the integrated commit.
4. If an authorized evidence push is part of the operation, push and monitor exact-SHA CI.
5. Remove the Sutura task worktree and local branch.
6. Remove the demo task worktree and local branch after integration to its documented default branch.
7. Verify no controller-owned remote matrix branch or open matrix PR remains.
8. Preserve unrelated `docs/demo/thumbnail/` content.

## Exit gate

- All Phase 0-owned evidence is accepted.
- The roadmap marks Phase 0 `Accepted` and Phase 1 active.
- No later roadmap phase was started.
- No task-owned worktree, local branch, remote matrix branch, or open matrix PR remains.
