# Phase 1: Correct evidence ownership and dogfood equivalence

Dependency: None

Batch status: Sequential

Authority: Local implementation only

## Goal

Make the evidence model truthful before adding new live results. Preserve the ten-run dogfood streak without claiming that it ran on a later commit.

## Files

Modify:

- `scripts/release-evidence.mjs`
- `scripts/release-evidence.test.mjs`
- `scripts/dogfood.mjs`
- `scripts/dogfood.test.mjs`
- `docs/demo/dogfood-ledger.md`
- `docs/demo/sutura-v0.2.0-release-evidence-requirements.json`
- `scripts/release-workflow.test.mjs`
- `docs/release/v0.2.0-release-playbook.md`
- `docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md`

Add:

- `docs/demo/dogfood-v0.2.0-executable-equivalence.md`
- `docs/plans/2026-08-31-sutura-phase-0-evidence-baseline-notes.md` only when a verified deviation occurs

## Implementation

### 1. Add an Action executable fingerprint

Use the Git object IDs for these exact files:

```text
action.yml
packages/action/action.yml
packages/action/dist/index.cjs
```

Pseudocode:

```text
function actionExecutableFingerprint(commit):
    exactSha(commit)
    entries = []
    for path in ACTION_EXECUTABLE_PATHS:
        blob = git rev-parse "commit:path"
        require exact 40-character object id
        entries.push({path, blob})
    return contentHash(entries sorted by path)
```

Do not hash a working-tree file. Read committed Git objects only.

Expose the Git reader through dependency injection in tests. Missing paths, malformed object IDs, or Git errors fail closed.

### 2. Correct `verifyDogfoodStreak`

Keep these existing requirements:

- Ten trailing entries.
- Ten distinct CI run IDs, Sutura run IDs, dogfood SHAs, and repair PR URLs.
- One exact Action SHA across the ten entries.
- Every outcome is `fixed`.
- The complete phase spend stays within its existing cap.
- The recorded `packagesTreeHash` is identical across the streak.

Add these requirements:

```text
actualActionPackagesTree = git rev-parse "actionSha:packages"
require every entry.packagesTreeHash == actualActionPackagesTree
require actionExecutableFingerprint(actionSha) == actionExecutableFingerprint(releaseCommit)
```

Remove the requirement that the complete `packages` tree at the streak Action SHA equals the complete `packages` tree at the release commit.

Return bounded equivalence metadata with the dogfood check. It contains streak Action SHA `a99e23199a80ae6ee51fe1680afb74188416160c`, release commit `a943ded4c734aed75c5c63f2b2dd63a2f44556c2`, the calculated SHA-256 executable fingerprint, and the exact ordered executable path list.

### 3. Preserve equivalence metadata in release evidence

Permit the `dogfood` check to retain the exact bounded equivalence object. Do not permit arbitrary metadata on other evidence records.

The normalized release manifest must include the equivalence object only when:

- The check ID is `dogfood`.
- The status is `passed`.
- Both commits are exact SHAs.
- The path list exactly matches the constant ordered path list.
- The fingerprint is a valid SHA-256 value.

### 4. Generate the human evidence note

Extend the dogfood renderer or add a focused renderer that writes:

- Streak Action SHA.
- Release commit.
- Ten fixed attempts and total spend.
- Exact executable path list.
- Calculated fingerprint.
- Wider package-tree difference limited to CLI setup and test files.
- A direct statement that no dogfood run executed on the release commit.

The note must not include secrets, local paths, or unverified claims.

### 5. Correct evidence ownership

Extend the evidence requirements file with an `ownerPhaseByEvidenceId` object:

```text
benchmark -> 0
candidate-matrix -> 0
dogfood -> 0
github-release -> 0
local-gate -> 0
npm -> 0
public-matrix -> 0
demo -> 1
marketplace -> 4
feedback -> 5
devpost -> 7
```

Keep every record required for the final submission. Do not change `pendingMeansNotReleaseReady`.

Update the playbook and roadmap so Phase 0 acceptance does not mean the final submission manifest is ready.

## Tests

Add tests that prove:

- Unrelated CLI source and test changes preserve dogfood executable equivalence.
- A one-byte Action bundle change fails equivalence.
- A root or package Action metadata change fails equivalence.
- A ledger package-tree hash that does not match the streak commit fails.
- Split Action SHAs still fail.
- Fewer than ten fixed attempts still fail.
- Equivalence metadata is deterministic and bounded.
- Non-dogfood checks cannot inject equivalence metadata.
- Every evidence ID has exactly one owner phase.
- The Phase 0 owner set contains exactly seven records.

## Automated success criteria

- `node scripts/release-evidence.mjs dogfood-status --ledger docs/demo/dogfood-ledger.json --candidate a943ded4c734aed75c5c63f2b2dd63a2f44556c2` reports `passed`.
- The command reports streak commit `a99e23199a80ae6ee51fe1680afb74188416160c`, not the release commit, as the execution identity.
- Mutating an executed artifact in a test fixture makes the same verification fail.
- Release contract tests pass.

## Manual success criteria

- Read the equivalence note and confirm that it distinguishes executed identity from equivalent release identity.
- Confirm no text implies that v0.2.0 itself completed ten live repairs.

## Verification

```bash
pnpm run test:release-contracts
node scripts/release-evidence.mjs dogfood-status --ledger docs/demo/dogfood-ledger.json --candidate a943ded4c734aed75c5c63f2b2dd63a2f44556c2
git diff --check
```

## Exit gate

- Dogfood reports `passed` through exact executable equivalence.
- Evidence ownership is versioned and tested.
- The roadmap and playbook match the executable schema.
- No live provider, GitHub mutation, or remote push occurred.
