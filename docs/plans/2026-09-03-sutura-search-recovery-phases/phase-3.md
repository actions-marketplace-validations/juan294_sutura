# Phase 3: Identical re-proposal recovery and target rotation

Status: Completed

Dependency: Phase 2 (both phases edit `packages/core/src/engine/repair-attempt.ts`)

## Goal

A depth-2 or deeper branch that repeats its parent's proposal gets one explicit request for a different replacement before the search discards it, and a parent that produced no patch expands on a different excerpt.

## Change A: feedback flag

`packages/core/src/engine/repair-attempt.ts:29-33`

```text
interface RepairAttemptFeedback { candidateDiff; testOutput; errorFingerprint; repeatedProposal?: true }
```

In `prepareControlledRepairProposalTemplate.contract` (`:189-221`): the feedback object is already redacted and digested into the memo key, so `repeatedProposal: true` produces a distinct contract. When it is set, append one system line to the copied system message for that contract only: `The previous proposal was identical to an earlier failed proposal for this excerpt. Return a materially different replacement.`

## Change B: identical-proposal recovery

`packages/core/src/heal.ts` expand callback (`:1000-1088`):

```text
outcome = runControlledRepairAttempt(attemptContext(parent, targetIndex) ...)
if parent !== undefined
   && (outcome.status === 'submitted' || outcome.status === 'checkpoint')
   && diffFingerprint(outcome.candidate.diff) === diffFingerprint(parent.cumulativeDiff)
   && availableBranchesNow() >= 1:
  ledger.record({ stage: 'search', note: `Identical proposal for ${nodeId}; requesting an alternative` })
  outcome = runControlledRepairAttempt({
    ...attemptContext(parent, targetIndex, { repeatedProposal: true }),
    branchId: nodeId, operationIdPrefix: `${operationId}-alt`, signal, trace, ...
  })
return outcome as today
```

`attemptContext` gains an optional third argument that merges `repeatedProposal: true` into the feedback and keys the map with a `:repeat` suffix so the memoized contexts stay distinct. `availableBranchesNow()` is the existing `availableBranches([parent])` closure. If the second proposal is still identical, `search.ts:158-166` marks the node `repeated-state` as today. The alternative attempt is charged to `branches`, `modelTurns`, `toolCalls`, and `sandboxOperations` through the normal reservations.

## Change C: target rotation for unpatched parents

`packages/core/src/heal.ts:1000-1003`

```text
parentTarget = nodeTargets.get(parent.id) ?? 0
targetIndex = parent === undefined
  ? (branch - 1) % proposalTemplate.targetCount
  : parent.cumulativeDiff === '' && proposalTemplate.targetCount > 1
    ? (parentTarget + 1) % proposalTemplate.targetCount
    : parentTarget
```

## Tests

`packages/core/src/engine/repair-attempt.test.ts`

- `adds the repeated-proposal instruction only when feedback sets it`: build the template, call `contract({ candidateDiff: diff, testOutput: 'fail', errorFingerprint: 'f', repeatedProposal: true }, 0)` and `contract({ candidateDiff: diff, testOutput: 'fail', errorFingerprint: 'f' }, 0)`. Assert the first system message contains `materially different replacement` and the second does not, and that the two contracts are distinct objects.

`packages/core/src/heal.test.ts` (extend the harness used by `replaces a failed first-depth proposal from the clean baseline with bounded feedback`, `:438`):

- `requests one alternative when a child repeats its parent proposal`: script Super replies so depth 1 returns `wrongSource`, depth 2 first returns `wrongSource` again, then `fixedSource`. Assert the run ends `fixed`, the ledger contains `Identical proposal for search-`, the alternative attempt's user message includes `"repeatedProposal":true`, and the trace has one more `model-request` than the baseline expectation.
- `marks the node repeated-state when the alternative is identical too`: script depth 2 to return `wrongSource` twice. Assert the search evidence shows `terminalReason: 'repeated-state'` for that node and the outcome is `gave-up`.
- `expands an unpatched parent on the next target`: two editable sources; branch 1 (target 0) returns invalid JSON twice (no patch, Phase 2 retry exhausted); assert that its child's request selects `target 1` by reading `selectedTarget.path` from the chat messages.

## Automated success criteria

- `pnpm --filter @sutura/core exec vitest run src/engine/repair-attempt.test.ts src/heal.test.ts` passes.
- `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, `pnpm run test` pass.
- `pnpm run ci:local` passes on the integrated commit, and `packages/action/dist/index.cjs` is rebuilt in the same commit.

## Manual success criteria

- Confirm the alternative attempt is skipped, not forced, when `availableBranches` is 0.
- Confirm no change to `DEFAULT_SEARCH_LIMITS` or `REPAIR_ATTEMPT_COSTS`.

Stop after the phase is integrated into local `develop`. The next step is the live measurement sequence in the parent plan's Verification section, each under separate authorization.
