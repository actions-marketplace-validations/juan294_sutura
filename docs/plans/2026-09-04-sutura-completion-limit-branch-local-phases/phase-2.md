# Phase 2: Orchestration replay, changelog, bundle

Status: Complete

Depends on: Phase 1

## Goal

Prove through `healCase` that the `08459fe` chalk shape now reaches depth 2, record the behavior change, and ship the rebuilt Action bundle in the same commit as the engine change.

## Change

`packages/core/src/heal.test.ts`

```text
new case: 'replays run 33836899254: one completion limit among applied proposals continues to depth 2'
  executor = InMemoryExecutor(command => install/git init → 0; every diagnosed test → 1, { operationLimit: 4 })
  value = context('repair-off-by-one', [], 'test-assertion', { executor, search: { initialBranches: 4, beamWidth: 2, maximumDepth: 2, maximumTotalBranches: 12 } })
  superCalls = 0
  chat.mockImplementation(tier):
    nano  → diagnosis('test-assertion')
    super → superCalls += 1
            superCalls === 3 ? { text: '{"replacement":"', finishReason: 'length' }
                             : { text: JSON.stringify({ replacement: <valid replacement text distinct per call> }) }
    ultra → { approved: true }
  caseFile = await healCase(value.ctx)
  assert caseFile.outcome === 'gave-up'                       // tests keep failing, no candidate
  assert super calls >= 5                                       // 4 at depth 1 plus at least 1 at depth 2
  assert caseFile.search has exactly one node with terminalReason 'completion-limit'
  assert caseFile.search has at least one node with depth 2
  assert no depth-2 node has parentId equal to the completion-limit node's nodeId
  assert stages contain no 'Cancellation requested' note
```

Use the same replacement-text convention as the existing controlled-repair tests in this file so each proposal applies a patch (`changedFiles.length > 0`). If the existing helper only supports one scripted replacement, extend the helper rather than the production code.

`CHANGELOG.md`, under `## [0.2.1]` → `### Changed`:

```text
- A Super reply that reaches the completion-token limit now ends only its own search branch; the search stops early only when such replies outnumber applied proposals.
```

`packages/action/dist/index.cjs`: rebuild with the repository's bundle command and commit in the same commit as the `packages/core` change.

`docs/plans/2026-09-04-sutura-completion-limit-branch-local.md`: set `Status:` to `Implemented locally; live authorization gates pending` and tick the automated success criteria that passed.

## Automated success criteria

- `pnpm --filter @sutura/core exec vitest run src/heal.test.ts` passes, including `replays live run 12` unchanged.
- `pnpm run ci:local` passes on the integrated commit.
- The bundle verification step in `ci:local` confirms `packages/action/dist/index.cjs` matches the source.
- `git diff --stat` shows no path under `packages/placebo/corpus` or `packages/placebo/src/score.ts`.

## Manual success criteria

- Read the new heal test's trace expectations against the archived trace `.sutura/placebo-v0.2.1-failed-runs/upstream-rerun-08459fe/placebo-v0.2.1-live-artifacts/upstream-formatter-release.json` (sequences 40 to 45) and confirm the replay reproduces the same depth-1 decision sequence before diverging at `run-finish`.

Stop after the phase is integrated into local `develop`.
