# Phase 1: Rank patched branches first `[batch-eligible]`

Status: Completed

## Goal

A branch that applied no patch never takes a beam slot from a branch that did.

## Change

`packages/core/src/engine/search-score.ts`

```text
interface SearchScore { pruned; passing; unpatched; failureSignatures; diffBytes; changedFiles; sandboxCost; elapsedTime; nodeId }

searchScore(node):
  unpatched = node.testEvidence.exitCode !== 0 && node.policyEvidence.changedFiles.length === 0 ? 1 : 0

compareSearchNodes order:
  pruned, passing, unpatched, failureSignatures, diffBytes, changedFiles, sandboxCost, elapsedTime, nodeId
```

No change to `search.ts`. The frontier at `search.ts:201-204` already sorts with `compareSearchNodes` and slices to `beamWidth`, so unpatched nodes fall out of the beam whenever enough patched non-terminal nodes exist, and remain expandable when nothing better exists.

## Tests

`packages/core/src/engine/search-score.test.ts`

- Extend `orders pass, failure count, diff size, resources, then node id`: add `unpatched = node({ id: 'node-000', cumulativeDiff: '', policyEvidence: { valid: true, violations: [], changedFiles: [], diffBytes: 0 } })` and assert it sorts after every patched failing node and before a policy-denied node.
- Assert `searchScore(unpatched).unpatched === 1` and `searchScore(node({})).unpatched === 0`.

`packages/core/src/engine/search.test.ts`

- New case `keeps patched failures in the beam ahead of a branch that produced no patch`, reproducing the chalk shape: `initialBranches: 4, beamWidth: 2, maximumDepth: 2`. `expand` returns, for depth 1, branches 1, 2, and 4 as distinct patched failures (`expansion('diff-1', 1, 'e1')` and so on) and branch 3 as `{ ...expansion('', 1, 'invalid: Repair proposal must be valid JSON'), policyEvidence: { valid: true, violations: [], changedFiles: [], diffBytes: 0 }, terminalReason: 'failed' }`. Assert the two depth-2 nodes have `parentId` in `{'search-001','search-002','search-004'}` and never `'search-003'`.
- Keep `still prunes repeated generic failed states` unchanged; it must still pass.

## Automated success criteria

- `pnpm --filter @sutura/core exec vitest run src/engine/search-score.test.ts src/engine/search.test.ts` passes.
- `pnpm run typecheck` and `pnpm run lint` pass.

## Manual success criteria

- Confirm the new key sits after `passing` and before `failureSignatures`, so a passing node is never affected.

Stop after the phase is integrated into local `develop`.
