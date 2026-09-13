# Phase 2: Build resumable Placebo live evidence

Dependency: Phase 1

Batch status: Sequential

Authority: Local implementation only; no workflow dispatch

## Goal

Create a case-level benchmark workflow and a local controller that can stop and resume without losing paid evidence.

## Files

Modify:

- `packages/placebo/src/types.ts`
- `packages/placebo/src/harness.ts`
- `packages/placebo/src/harness.test.ts`
- `packages/placebo/src/cli.ts`
- `packages/placebo/src/cli.test.ts`
- `packages/placebo/README.md`
- `package.json`
- `.gitignore`
- `scripts/release-workflow.test.mjs`
- `scripts/release-evidence.test.mjs`

Add:

- `scripts/placebo-live.mjs`
- `scripts/placebo-live.test.mjs`
- `.github/workflows/placebo-live-case.yml`

Generated only during authorized execution:

- `.sutura/placebo-v0.2-live-ledger.json`
- `.sutura/placebo-v0.2-live.lock`
- `.sutura/placebo-v0.2-live-artifacts/`

## Implementation

### 1. Add exact case selection

Add `caseId?: string` to `BenchmarkOptions`.

Pseudocode:

```text
allCases = discoverCases()
if caseId is set:
    selected = allCases where id == caseId
    require selected.length == 1 before createPortableTestRuntime or adapter call
else:
    selected = current kind filter
```

CLI syntax:

```bash
placebo run --adapter sutura --case repair-off-by-one
```

Rules:

- `--case` accepts one bounded corpus ID.
- An unknown ID exits before adapter, provider, sandbox, or Tavily work.
- `--case` and `--only` cannot appear together.
- An upstream case without `--no-tavily` still produces its with/without pair.
- The complete default run remains unchanged.

### 2. Define the case artifact schema

`scripts/placebo-live.mjs` owns `sutura-placebo-live-case-v1`.

Required fields:

- Controller SHA and GitHub run ID.
- Subject version and release SHA.
- Candidate/public package content hash and package integrity from publish run `33388564135`.
- Corpus version and canonical corpus hash.
- Case ID and case content hash.
- One result, or two results for an upstream pair.
- Evaluation manifest hash.
- Inference cost, sandbox cost, and total cost.
- Artifact name and result hash.

Bound the artifact to 10 MiB. Validate all URLs, IDs, finite costs, trace arrays, operation IDs, and terminal outcomes before hashing.

### 3. Add the trusted case workflow

`.github/workflows/placebo-live-case.yml` uses `workflow_dispatch` with:

```text
subject-sha
case-id
controller-id
```

The workflow must:

1. Validate the exact SHA and allowlisted case ID before setup.
2. Check out the controller commit in `controller/`.
3. Check out the subject release in `subject/` at the input SHA.
4. Verify the subject tag, package version, corpus hash, and public install hashes.
5. Install with frozen lockfiles.
6. Build both trees.
7. Invoke the controller harness with the subject CLI binary through discrete arguments.
8. Write report and manifest files to the runner temporary directory.
9. Create the bounded case evidence object.
10. Upload exactly one artifact named from the controller ID and case ID.

Use `timeout-minutes: 30` for one case. Use only `contents: read`. Never grant write, pull-request, issue, or ID-token permissions.

The workflow must not echo credential values. It receives the existing Nebius, Tavily, and ConTree secrets and variable only in the execution step.

### 4. Add the append-only ledger

The ledger schema is `sutura-placebo-live-ledger-v1`.

Each entry records:

- Case ID.
- Run ID and run URL.
- Artifact name and SHA-256.
- Controller SHA and subject SHA.
- Result hash.
- Terminal outcomes.
- Evaluation count.
- Inference, sandbox, and total USD.
- Recorded timestamp.

The ledger result hash covers the ordered entries. An append operation must compare every existing entry with the committed or prior scratch ledger and refuse mutation, removal, duplication, or identity drift.

Order cases by kind and stable case ID: flaky, trap, upstream, repairable.

### 5. Add controller commands

```text
placebo-live.mjs gate --controller-sha SHA --subject-sha SHA
placebo-live.mjs run --controller-sha SHA --subject-sha SHA --case ID --authorize
placebo-live.mjs streak --controller-sha SHA --subject-sha SHA --authorize --cap-usd N --initial-reserve-usd N
placebo-live.mjs finalize --controller-sha SHA --subject-sha SHA --output-dir PATH
```

`gate` is read-only. It verifies:

- Clean local controller identity.
- `origin/develop` equality.
- Exact controller push CI.
- Fresh provider canary.
- Subject tag and release identity.
- Publish run and install artifact identity.
- Corpus and controls hashes.
- Existing ledger integrity.

`run` dispatches one case and appends only after full artifact validation.

`streak` resumes existing entries, enforces literal authorization and the reserve calculation, and stops on a safety or identity failure.

`finalize` performs no provider call. It requires all 51 case IDs and 55 evaluations, combines the results, calculates the canonical score, validates hidden-test and language measures, and writes to a new empty output directory.

### 6. Keep raw output out of Git during execution

Ignore all scratch ledger, lock, and artifact paths. Finalization writes to an ignored staging directory first. Phase 4 performs public-safe review before promotion to `docs/demo/`.

## Tests

Add tests for:

- Exact single-case selection.
- Unknown and duplicate case input before adapter use.
- Upstream paired behavior under exact case selection.
- Case artifact bounds and deterministic hash.
- Wrong controller, subject, corpus, package, run, or artifact identity.
- Append-only resume after partial completion.
- Stable canonical ordering independent of workflow completion order.
- Cap reserve before dispatch.
- Stop on false approval.
- Retain valid `gave-up`, `refused`, and `infra-stop` results.
- Refuse finalization at 50 cases, 54 evaluations, duplicate cases, or missing upstream pair.
- Final score equality with a direct in-memory benchmark over recorded fixtures.
- Workflow has read-only permissions, a 30-minute timeout, exact checkouts, and one artifact upload.

## Automated success criteria

- Recorded fixtures can simulate an interrupted 20-case run and resume to all 51 cases without repeating one.
- The finalizer produces 55 evaluations and the expected denominator for every score group.
- A false approval prevents a second dispatch.
- All tests run without live credentials.

## Manual success criteria

- Inspect the workflow and confirm that only the selected public synthetic case enters the live system.
- Confirm the subject CLI comes from the exact v0.2.0 checkout, not the controller worktree.
- Confirm scratch artifacts are ignored.

## Verification

```bash
pnpm --filter placebo run typecheck
pnpm --filter placebo run lint
pnpm --filter placebo run test
pnpm run test:release-contracts
pnpm run typecheck
pnpm run lint
git diff --check
```

## Exit gate

- The controller can complete and resume a fully recorded fake 51-case run locally.
- Workflow contracts pass without dispatch.
- The exact live cap command is documented but not executed.
- No provider or GitHub mutation occurred.
