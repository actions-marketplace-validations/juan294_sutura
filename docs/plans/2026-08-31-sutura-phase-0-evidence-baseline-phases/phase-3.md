# Phase 3: Build the real candidate and public matrix runner

Dependency: Phase 2 evidence primitives

Batch status: Sequential

Authority: Local implementation in Sutura and `sutura-demo`; no remote mutation or workflow dispatch

## Goal

Produce real inputs for the existing eight-case matrix analyzer through a trusted, resumable workflow in the public demo repository.

## Sutura repository files

Modify:

- `scripts/test-external-matrix.mjs`
- `scripts/test-external-matrix.test.mjs`
- `package.json`
- `.gitignore`
- `docs/release/v0.2.0-release-playbook.md`

Add:

- `scripts/external-matrix-live.mjs`
- `scripts/external-matrix-live.test.mjs`

Generated only during authorized execution:

- `.sutura/external-matrix-candidate-ledger.json`
- `.sutura/external-matrix-public-ledger.json`
- `.sutura/external-matrix.lock`
- `.sutura/external-matrix-artifacts/`

## Demo repository files

Add or modify:

- `/Users/juan/code/sutura-demo/.github/workflows/matrix-case.yml`
- `/Users/juan/code/sutura-demo/scripts/materialize-matrix-case.mjs`
- `/Users/juan/code/sutura-demo/scripts/collect-matrix-evidence.mjs`
- `/Users/juan/code/sutura-demo/test/matrix-case-contract.test.js`
- `/Users/juan/code/sutura-demo/package.json`
- `/Users/juan/code/sutura-demo/pnpm-lock.yaml`
- JavaScript and Python fixture paths required by the eight declared cases

Do not change the public self-service trigger in this phase. The Case Lab owns that later change.

## Implementation

### 1. Keep the analyzer authoritative

Do not weaken `EXTERNAL_MATRIX_CASES`, expected outcomes, operation evidence, public URL validation, denominator, or false-approval logic.

Add only the metadata needed to bind a result to:

- Demo workflow run ID.
- Demo repository commit.
- Controller correlation ID.
- Candidate or public package content hash.
- Evidence artifact hash.

Every old manifest remains readable or receives an explicit schema-version migration test.

### 2. Add the demo matrix workflow

Inputs:

```text
mode: candidate | public
case-id: exact matrix case ID
action-sha: exact 40-character commit
controller-id: bounded alphanumeric correlation ID
```

The workflow validates all input before dependency installation or provider use.

Permissions are selected per case. The default is `contents: read`. Repair cases may use only the existing required `actions: write`, `contents: write`, and `pull-requests: write` permissions. No case receives `id-token: write` or issue permissions.

Checkout layout:

```text
workspace root -> trusted sutura-demo default branch
.sutura-action/ -> juan294/sutura at action-sha
```

Invoke the Action with:

```yaml
uses: ./.sutura-action/packages/action
```

Candidate CLI mode builds and packs `.sutura-action/packages/cli`. Public CLI mode installs `sutura@0.2.0`. Both paths calculate the package content hash and verify the resolved Action SHA.

### 3. Materialize the eight cases

Implement one exact path for each declared case:

| Case | Execution |
| --- | --- |
| `javascript-repair` | Existing `repair-off-by-one` fixture, broken PR, expected verified repair |
| `javascript-flake` | Existing `flaky-timer-race` fixture, exact mixed exits, expected no patch |
| `unsafe-repair-refusal` | Existing `trap-skipped-test` candidate, expected rejecting audit |
| `direct-branch-repair` | Broken branch with explicit CI dispatch and no source PR, expected repair PR |
| `repository-policy-refusal` | Broken fixture plus committed policy that denies the required source path |
| `audit-only-invocation` | Exact before/after logs and candidate diff through the installed CLI audit command |
| `python-repair` | `python-repair-missing-await` fixture and Python CI |
| `python-refusal` | `python-trap-swallowed-exception` candidate and rejecting audit |

The materializer accepts only the eight IDs and emits a bounded JSON description. It never accepts command text, paths, patches, repositories, or refs from workflow input.

### 4. Collect direct evidence

The workflow result artifact must contain:

- Declared and actual outcome.
- Audit approval.
- Package mode, version, content hash, and Action SHA.
- Setup duration.
- Inference and sandbox costs.
- Complete stage array with operation IDs.
- Public GitHub links for the CI run, Sutura run, check, result artifact, and pull request when applicable.
- Demo fixture commit and result hash.

Fail when an expected artifact, exact-SHA check, cost line, operation ID, or link is absent.

### 5. Add the local controller

Commands:

```text
external-matrix-live.mjs gate --mode MODE --controller-sha SHA --action-sha SHA
external-matrix-live.mjs run --mode MODE --controller-sha SHA --action-sha SHA --case ID --authorize
external-matrix-live.mjs streak --mode MODE --controller-sha SHA --action-sha SHA --authorize --cap-usd N --initial-reserve-usd N
external-matrix-live.mjs finalize --mode MODE --controller-sha SHA --action-sha SHA --output FILE
external-matrix-live.mjs cleanup --mode MODE --authorize
```

The controller reuses the Phase 2 identity, artifact, append-only, lock, polling, and reserve semantics. It dispatches one case at a time to `juan294/sutura-demo`.

`finalize` calls `createExternalMatrixManifest` with exactly the eight validated results.

`cleanup` closes only controller-owned matrix pull requests and deletes only controller-owned matrix branches after evidence capture. It records each removed ref. It never removes public workflow runs, artifacts, evidence links, default branches, or unrelated pull requests.

### 6. Candidate and public distinction

Candidate mode must use the exact source-built tarball at `a943ded4c734aed75c5c63f2b2dd63a2f44556c2`.

Public mode must use npm package `sutura@0.2.0` and verify that `v0.2.0` resolves to the same Action SHA.

The existing publish artifact proves their package content hashes are equal. The two matrices still run separately because installation paths can fail independently.

## Tests

Add tests for:

- Exact input allowlists and bounded correlation IDs.
- Candidate/public package-source separation.
- Static local Action invocation after exact checkout.
- Minimum permissions by case.
- Every fixture becomes the intended red, mixed, or audit state.
- Parser rejection for arbitrary paths, patches, commands, and refs.
- Controller run correlation and duplicate-run rejection.
- Artifact and public URL verification.
- Resume after any subset of eight cases.
- Reserve stop before dispatch.
- Finalization with exactly eight cases and zero false approvals.
- Cleanup touches only recorded controller-owned branches and pull requests.

## Automated success criteria

- A fully mocked candidate run and public run each produce a ready 8/8 manifest.
- One changed outcome, approval bit, Action SHA, package hash, or missing operation ID blocks readiness.
- Demo workflow tests prove all eight materializers locally without credentials.
- No live workflow is triggered by normal CI.

## Manual success criteria

- Inspect candidate and public workflow logs from local fixtures and confirm their package paths differ.
- Confirm the workflow cannot accept an arbitrary repository or command.
- Confirm cleanup ownership prefixes cannot match ordinary demo branches.

## Verification

In Sutura:

```bash
pnpm run test:release-contracts
pnpm run typecheck
pnpm run lint
git diff --check
```

In `sutura-demo`:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm test
```

## Exit gate

- Both repositories pass their local gates.
- Mocked candidate and public matrices finalize to 8/8.
- Live commands require literal authorization and exact caps.
- No remote demo change, workflow dispatch, or provider spend occurred.
