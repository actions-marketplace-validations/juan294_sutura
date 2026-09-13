# Phase 1: Branch-local completion limit in the search engine

Status: Complete

## Goal

One runaway reply ends its own branch. The run ends only when runaway replies outnumber applied proposals. Siblings are never cancelled because of a runaway.

## Change

`packages/core/src/engine/search.ts`

```text
remove isGlobalTerminal

isEvidenceTerminal(reason): reason === 'cancelled' || reason === 'completion-limit'   // unchanged behavior, inline the check

adaptiveSearch:
  appliedProposals = 0        // nodes whose proposal applied a patch
  completionLimits = 0        // nodes with terminalReason 'completion-limit'

  inside the batch Promise.all:
    early cancellation triggers only on `passed`   // drop `|| isGlobalTerminal(expansion.terminalReason)`

  after the batch's children are built and their decisions recorded:
    for child of batch children:
      if child.policyEvidence.changedFiles.length > 0: appliedProposals += 1
      if child.terminalReason === 'completion-limit': completionLimits += 1
    if children.some(passed): break                                   // unchanged
    if completionLimits > appliedProposals:
      nodes.push(...children)
      return { nodes, candidates: [], terminalReason: 'completion-limit' }
    start += batch.length

  frontier filter unchanged: terminalReason === undefined || terminalReason === 'failed'
  // 'completion-limit' stays out of the frontier, so it is never a parent
```

The counters cover the whole run, not one batch or one depth. A depth-2 batch that adds a second runaway against three applied proposals continues; a fourth runaway against three applied proposals stops.

`AdaptiveSearchResult.terminalReason` keeps `'completion-limit'`; `SearchNode.terminalReason` is unchanged.

## Tests

`packages/core/src/engine/search.test.ts`

- Replace `stops globally on a completion limit and preserves cancelled sibling evidence` with two cases:
  - `continues past one completion limit while applied proposals outnumber it`: `initialBranches: 4, beamWidth: 2, maximumDepth: 2, maximumTotalBranches: 8, availableBranches: () => 8, concurrencyCapacity: () => 4`, `cancel` is a `vi.fn`. Depth 1: branches 1, 2, 4 return `expansion('diff-N', 1, 'eN')`; branch 3 returns `{ ...expansion('', 1, 'completion-limit: Repair proposal reached the provider completion-token limit'), policyEvidence: { valid: true, violations: [], changedFiles: [], diffBytes: 0 }, terminalReason: 'completion-limit' }`. Depth 2: `expansion('depth-2-' + parent.id, 1, 'depth-2-' + parent.id)`. Assert `cancel` was never called, `expand` was called 6 times, the two depth-2 nodes have `parentId` in `{'search-001','search-002','search-004'}`, `result.terminalReason === 'frontier-exhausted'` (depth-2 children carry `terminalReason: 'depth'` because `maximumDepth` is 2, so the next frontier is empty), and `result.nodes[2]?.terminalReason === 'completion-limit'`.
  - `stops the run when completion limits outnumber applied proposals`: `initialBranches: 2, beamWidth: 2, maximumDepth: 3, maximumTotalBranches: 6, availableBranches: () => 6, concurrencyCapacity: () => 2`. Both depth-1 branches return the completion-limit expansion above. Assert `expand` was called 2 times, `result.terminalReason === 'completion-limit'`, and every node has `terminalReason: 'completion-limit'`.
- Add `one completion limit in a batch of one stops the run` reproducing live run 12: `initialBranches: 4, beamWidth: 2, maximumDepth: 4, maximumTotalBranches: 12, availableBranches: () => 4, concurrencyCapacity: () => 1`; the first expansion is the completion-limit expansion. Assert `expand` was called once and `result.terminalReason === 'completion-limit'`.
- Add `never expands a completion-limit node`: `initialBranches: 2, beamWidth: 2, maximumDepth: 2, maximumTotalBranches: 6, availableBranches: () => 6, concurrencyCapacity: () => 2`. Depth 1: branch 1 returns `expansion('diff-1', 1, 'e1')`, branch 2 returns the completion-limit expansion. Depth 2: `expansion('depth-2-' + parent.id, 1, 'depth-2')`. Assert `expand` was called 3 times and the only depth-2 node has `parentId === 'search-001'`.
- Keep `keeps a passing candidate when its batch also reaches a completion limit` unchanged; it must still pass.
- Keep `cancels unfinished siblings and preserves their terminal node` unchanged.

## Automated success criteria

- `pnpm --filter @sutura/core exec vitest run src/engine/search.test.ts src/engine/search-score.test.ts` passes.
- `pnpm run typecheck` and `pnpm run lint` pass.
- `git diff --stat` touches only `packages/core/src/engine/search.ts` and `packages/core/src/engine/search.test.ts`.

## Manual success criteria

- Confirm no new exported constant or option was added to `search.ts`; the rule uses only the two run counters.
- Confirm `packages/core/src/heal.test.ts` `replays live run 12` still passes without edits (`pnpm --filter @sutura/core exec vitest run src/heal.test.ts -t "live run 12"`).

Stop after the phase is integrated into local `develop`.
