# Sutura Phase 0 evidence baseline implementation plan

Date: 2026-08-31

Status: Finalized; implementation not started

Roadmap source: `docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md`

Integration branch: `develop`

Published subject: `sutura@0.2.0`

Published release commit: `a943ded4c734aed75c5c63f2b2dd63a2f44556c2`

Dogfood streak commit: `a99e23199a80ae6ee51fe1680afb74188416160c`

## Objective

Create an honest, reproducible v0.2 baseline before Sutura adds the public Case Lab or new intelligence.

Phase 0 must:

1. Bind existing release and dogfood evidence to exact executable identities.
2. Run all 51 Placebo v0.2 cases, including four paired upstream ablations, for 55 retained evaluations.
3. Run the complete candidate and public eight-case external matrices.
4. Preserve failures, costs, latency, sandbox operations, and exact public links.
5. Update public claims only after the evidence is complete.

This plan authorizes local implementation only. It does not authorize a push, GitHub workflow dispatch, demo repository mutation, provider spending, Data Lab upload, release, or publication.

## Approved corrections to the roadmap

### Future evidence ownership

Expected: Phase 0 would make all eleven release-evidence records terminal.

Found: `demo`, `devpost`, `feedback`, and `marketplace` belong to later roadmap phases. `scripts/release-evidence.mjs` also supports `pending` and `skipped`, not `not-applicable`.

Approved: Phase 0 makes only its owned records terminal. Later records remain `pending` with a named roadmap phase and next action. Phase 0 can be accepted while the complete submission manifest still reports `ready: false`.

### Dogfood identity

Expected: The ten successful dogfood repairs would pass the v0.2.0 release verifier directly.

Found: The streak used `a99e23199a80ae6ee51fe1680afb74188416160c`. Release commit `a943ded4c734aed75c5c63f2b2dd63a2f44556c2` changed CLI setup behavior and tests, so the complete `packages` tree differs. The root Action metadata, packaged Action metadata, and executed Action bundle are identical between the two commits.

Approved: Prove executable equivalence and retain the original streak identity. Do not repeat ten paid repairs when that proof passes. Any change to the Action bundle or Action metadata must fail the equivalence gate.

### Missing external matrix executor

Expected: `scripts/test-external-matrix.mjs` could execute the matrix.

Found: It defines and validates the eight results, but production code supplies no `executeCase` implementation. Its CLI only analyzes a pre-existing JSON array.

Approved: Add one bounded, resumable controller and one trusted demo-repository workflow that produce the input. Keep the existing analyzer as the final denominator and false-approval gate.

## Current verified baseline

| Evidence | Current fact |
| --- | --- |
| Release | GitHub release `v0.2.0` points to `a943ded4c734aed75c5c63f2b2dd63a2f44556c2` |
| Exact main CI | Run `33387481338` completed successfully on the release commit |
| Publish and install | Run `33388564135` completed successfully on the release commit |
| Candidate package hash | `999e189d91dc52383361e739f075056622308da6360b5d9187fea8f303330572` |
| Public package hash | `999e189d91dc52383361e739f075056622308da6360b5d9187fea8f303330572` |
| Package integrity | `6365ab9af9cfcef0cdfe1441b95c9de2ff504e2181e77fdf5669ff92eef3937f` in candidate and public install evidence |
| Dogfood | Ten trailing fixed attempts at `a99e23199a80ae6ee51fe1680afb74188416160c` |
| Placebo corpus | 51 cases and canonical corpus hash `77594bc260dbf4918548bda43d24238bfe43da3f428e2fde4da0a3e029571d24` |
| Live v0.2 result | Not run |
| Candidate matrix | No live executor or accepted result |
| Public matrix | No live executor or accepted result |
| Local live credentials | Not present in the shell; required credentials are configured as GitHub repository secrets and variables |

## Chosen design

### Evidence layers

Use four separate evidence layers:

```text
existing public release proof
  -> exact executable-equivalence proof
  -> resumable Placebo case evidence
  -> candidate and public external matrices
  -> concise Phase 0 evidence index
```

Do not turn the eleven-record manifest into one synchronous release gate. It remains a consistency index for the full hackathon submission.

### Dogfood executable equivalence

The dogfood claim is about the GitHub Action repair runtime. Compare Git object identities for these executed artifacts:

```text
action.yml
packages/action/action.yml
packages/action/dist/index.cjs
```

The verifier must also prove that every trailing streak entry uses one Action commit and that its recorded `packagesTreeHash` equals the actual `packages` tree at that Action commit.

The evidence statement must say:

> Ten consecutive live repairs ran at `a99e23199a80ae6ee51fe1680afb74188416160c`. The v0.2.0 release has identical Action metadata and executable bundle. CLI setup and test-only changes account for the wider package-tree difference.

It must not say that the ten runs executed at the v0.2.0 release commit.

### Resumable Placebo execution

Run one corpus case per GitHub workflow dispatch. An upstream case produces its required with-Tavily and without-Tavily pair in the same run.

```text
local controller
  -> validate exact controller and subject identities
  -> dispatch one allowlisted case
  -> GitHub runner checks out benchmark controller
  -> GitHub runner checks out v0.2.0 subject separately
  -> run current public corpus against exact v0.2.0 CLI source
  -> upload one bounded case artifact
  -> controller downloads and validates artifact
  -> append content-hashed scratch ledger
  -> stop, resume, or dispatch next case
```

The benchmark controller and subject are separate identities:

- Controller identity: exact integrated commit that owns the workflow, corpus selector, and evidence validation.
- Subject identity: `sutura@0.2.0` and release commit `a943ded4c734aed75c5c63f2b2dd63a2f44556c2`.
- Public artifact equivalence: the existing candidate/public install hashes from run `33388564135`.
- Corpus identity: canonical v0.2 hash `77594bc260dbf4918548bda43d24238bfe43da3f428e2fde4da0a3e029571d24`.

The workflow builds the exact subject checkout in a separate directory. The benchmark harness invokes that checkout's CLI binary by an argument array, never by a shell string.

### Live benchmark cost control

The controller runs cases sequentially. It requires literal `--authorize`, an exact controller SHA, an exact subject SHA, `--cap-usd`, and `--initial-reserve-usd`.

Before each dispatch:

```text
spent = sum(validated completed case costs)
reserve = max(initial reserve, maximum validated completed case cost)
if spent + reserve > cap:
    stop before dispatch
```

Each case keeps Sutura's existing per-run limits: eight repair model turns, 24 tool calls, 12 branches, 32 sandbox operations, 600 seconds of repair time, and USD 0.25 of repair-agent inference. Diagnosis, audit, Tavily, and sandbox costs remain in the reported complete case cost.

Run order limits early risk:

1. Flaky cases.
2. Greenwash traps.
3. Upstream cases and their ablation pairs.
4. Repairable cases.

A false approval, invalid artifact, identity mismatch, secret leak, or executable-contract failure stops the controller immediately. A valid `gave-up`, `refused`, or `infra-stop` result remains in the denominator and does not disappear from the ledger.

### External matrix execution

Use `juan294/sutura-demo` because it is public and already has the required GitHub secrets and ConTree project variable. Do not create a new repository or ask the user to copy secrets.

Add one trusted manual workflow to that repository. It accepts only:

```text
mode: candidate | public
case-id: one of the eight versioned matrix IDs
action-sha: one exact 40-character commit
controller-id: one bounded correlation identifier
```

The workflow uses a second `actions/checkout` at the exact Action SHA and invokes the Action through a literal local path. Candidate mode builds the CLI tarball from that exact checkout. Public mode installs `sutura@0.2.0`. Both modes record the installed content hash and resolved Action commit.

Each case starts from a clean committed fixture. The workflow produces one bounded JSON artifact with stable GitHub links, costs, stages, and the terminal result. The local controller validates and appends the result before the next case.

The existing `createExternalMatrixManifest` remains the final eight-of-eight and zero-false-approval gate for each mode.

### Evidence promotion

Live controllers write only to ignored `.sutura/` scratch paths while they run. Promotion happens after complete validation.

Promote:

- One concise public-safe Placebo v0.2 report under `docs/demo/`.
- One machine-readable summary under `docs/demo/`.
- Candidate and public matrix manifests under `docs/demo/`.
- One dogfood executable-equivalence note under `docs/demo/`.
- One Phase 0 evidence index under `docs/demo/`.

Keep large raw case artifacts in GitHub Actions. The public summary records exact run URLs, artifact names, hashes, and subject identity.

## Rejected designs

### Repeat the ten-run dogfood streak

Rejected because the executed Action metadata and bundle are identical. Repeating the streak would spend money and time without testing changed repair code.

### Run all 55 evaluations in one process

Rejected because a late failure, six-hour runner limit, provider interruption, or computer restart could lose the whole run. Per-case artifacts and an append-only ledger permit exact resume.

### Treat the existing matrix analyzer as execution proof

Rejected because synthetic input can satisfy the analyzer. Every accepted result needs a real workflow run, artifact, operation identifier, and public link.

### Complete all eleven evidence IDs in Phase 0

Rejected because the Case Lab, external feedback, Marketplace work, and Devpost submission belong to later phases.

### Move or rewrite the v0.2.0 tag

Rejected because public release identity is immutable. A verified product defect requires a new patch release.

## Phase sequence

| Phase | Name | Dependency | Batch status |
| ---: | --- | --- | --- |
| 1 | Correct evidence ownership and dogfood equivalence | None | Sequential |
| 2 | Build resumable Placebo live evidence | Phase 1 | Sequential |
| 3 | Build the real candidate/public matrix runner | Phase 2 evidence primitives | Sequential |
| 4 | Run authorized evidence and publish the baseline | Phases 1-3 | Sequential |

Detailed phase files:

- `docs/plans/2026-08-31-sutura-phase-0-evidence-baseline-phases/phase-1.md`
- `docs/plans/2026-08-31-sutura-phase-0-evidence-baseline-phases/phase-2.md`
- `docs/plans/2026-08-31-sutura-phase-0-evidence-baseline-phases/phase-3.md`
- `docs/plans/2026-08-31-sutura-phase-0-evidence-baseline-phases/phase-4.md`

No phase is batch-eligible. Phases 2 and 3 both depend on the corrected evidence identity and reuse live-run validation patterns. Phase 4 consumes all earlier outputs.

## Cross-phase implementation rules

- Follow red, green, refactor for every behavior change.
- Use recorded GitHub and provider responses in normal tests.
- Keep every live test and workflow dispatch opt-in.
- Use one isolated worktree or temporary branch per implementation phase.
- Preserve `docs/demo/thumbnail/` and all unrelated work.
- Run verification sequentially.
- Rebuild and verify `packages/action/dist/index.cjs` only when runtime source changes.
- Run `codex-simplify` after implementation review and before the final local gate.
- Merge verified work into local `develop`, verify the exact integrated commit, then remove the task worktree and local task branch.
- Do not push, mutate `sutura-demo`, dispatch a live workflow, or spend provider credit without the separate authorization stated in Phase 4.
- Record deviations in `docs/plans/2026-08-31-sutura-phase-0-evidence-baseline-notes.md` before implementing them.

## Primary measures and gates

### Completeness gates

- Exactly 51 unique corpus cases.
- Exactly 55 evaluations after four paired upstream ablations.
- Every failed or incomplete product result remains in the denominator.
- Exactly eight unique candidate matrix cases.
- Exactly eight unique public matrix cases.

### Safety gates

- Zero false approvals across all 19 traps.
- Hidden-test preservation is 15/15.
- Candidate and public matrices each report zero false approvals.
- No credential or private repository data appears in a public artifact.
- Every untrusted execution stage has networking disabled.

### Quality targets

- Repair rate exceeds the v0.1 rate of 6/10. With 18 v0.2 repair cases, at least 11 must be verified fixes.
- Flaky accuracy is 10/10.
- With-Tavily upstream grounding fixes all four modeled incidents.
- The without-Tavily result remains an honest measured ablation.
- JavaScript, TypeScript, and Python measures are reported separately.

A missed quality target does not erase the result. It blocks new performance claims and creates a named remediation plan before Phase 1 of the winning roadmap.

## Verification

Run after each implementation phase, as applicable:

```bash
pnpm run test:release-contracts
pnpm --filter placebo run typecheck
pnpm --filter placebo run lint
pnpm --filter placebo run test
pnpm run typecheck
pnpm run lint
pnpm run verify:bundle
```

Run the full final local gate before any push or live authorization:

```bash
pnpm run ci:local
```

Validate workflow syntax with the repository's current workflow contract tests and `actionlint` when it is available.

## Automated acceptance

- Dogfood verification passes when irrelevant CLI/test changes exist and fails when any executed Action artifact differs.
- Unknown, duplicate, missing, or mismatched Placebo case IDs fail before provider calls.
- Every case artifact binds controller SHA, subject SHA, package identity, corpus hash, run ID, artifact name, and content hash.
- The benchmark ledger is append-only, resumable, bounded, and rejects earlier-entry mutation.
- The benchmark finalizer refuses fewer than 51 cases or 55 evaluations.
- Spend reserve stops a dispatch before the authorized cap is at risk.
- A false approval stops further dispatch.
- External matrix inputs are allowlisted and shell-safe.
- Candidate mode uses a candidate tarball and public mode uses `sutura@0.2.0`.
- Matrix artifacts carry at least one real sandbox operation ID where the case contract requires sandbox work.
- Both matrix manifests retain all eight cases and fail readiness on any mismatch.
- Evidence promotion fails on a dirty identity, missing artifact, invalid hash, or incomplete denominator.

## Manual acceptance

- Review the dogfood equivalence statement for accuracy.
- Confirm the live spend proposal before authorization.
- Confirm the public reports contain no credentials or private data.
- Open sampled GitHub run, artifact, pull request, check, and refusal links while signed out.
- Confirm README numbers match the final machine-readable score.
- Confirm later evidence records remain visibly pending with their owning phases.

## Authorization gates

The following are separate decisions:

1. Push the integrated controller and workflow commit to `origin/develop`.
2. Modify and push the `sutura-demo` acceptance workflow and fixtures.
3. Run a fresh provider-contract canary.
4. Run the live Placebo v0.2 controller under one exact total cap and reserve.
5. Run the candidate external matrix under one exact cap and reserve.
6. Run the public external matrix under one exact cap and reserve.
7. Close matrix pull requests and delete matrix branches after evidence capture.
8. Publish corrected README and evidence files remotely.

An authorization for one item does not imply the next item.

## Phase 0 exit state

Phase 0 is accepted when:

- `benchmark`, `candidate-matrix`, `dogfood`, `github-release`, `local-gate`, `npm`, and `public-matrix` have direct accepted evidence.
- `demo`, `devpost`, `feedback`, and `marketplace` remain pending with their roadmap owners.
- The complete Placebo result and both matrix results satisfy the safety gates.
- Quality results are reported without omission or inflation.
- README claims match the exact evidence.
- All implementation is integrated into local `develop` with exact integrated verification.
- All task worktrees, local branches, temporary remote matrix branches, and completed matrix pull requests are cleaned according to their evidence-retention rules.
- The winning roadmap records Phase 0 as `Accepted` and names Phase 1 as the next action.

## Plan completion state

The Phase 0 design contains no unresolved questions.

Implementation authority remains local. Paid and outward-facing execution remains gated as listed above.
