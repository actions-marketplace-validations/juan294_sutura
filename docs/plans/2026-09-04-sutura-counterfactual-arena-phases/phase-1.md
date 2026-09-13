# Phase 1: Counterfactual gate engine in core

Issues: #69, #70, #71, #72, #75 (engine half)

Depends on: nothing

## Goal

Evaluate two or three alternative patches from the same ConTree checkpoint
through the identical production gate stack, and record for each one the exact
gate and rule that rejected it plus its added cost, latency, and sandbox
operations.

## Step 1 - Extract the shared gate helpers

`packages/core/src/engine/sandbox-command.ts` (new): move
`sandboxTargetCommand` and `sandboxExecutableCommand` out of `heal.ts`
unchanged. `heal.ts` imports and re-exports them so no existing import breaks.

`packages/core/src/audit/repository-policy.ts` (new): move
`enforceWinnerPolicy` out of `heal.ts` with an explicit input object instead of
`RepairFailureContext`:

```ts
export interface RepositoryPolicyGateInput {
  executor: Executor;
  baselineImageId: ImageId;
  policy: RepositoryPolicy;
  runtime: RuntimeAdapter;
  observe(record: {
    attempt: number;
    result: RunResult;
    parentImageId: ImageId;
    note: string;
  }): void;
}

export function enforceRepositoryPolicy(
  input: RepositoryPolicyGateInput,
  winner: RaceResult,
  verdict: AuditVerdict,
): Promise<AuditVerdict>;
```

Body is byte-equivalent to the current `enforceWinnerPolicy`: the same required
command loop, the same baseline-versus-candidate pairing, the same
`policy-required-command` and `policy-resource-limit` checks, the same refusal
string. `heal.ts` keeps a thin `enforceWinnerPolicy` wrapper that adapts
`RepairFailureContext` and the `StageLedger`, so existing `heal.test.ts`
assertions on stage notes and attempt numbers stay valid.

## Step 2 - Counterfactual types

`packages/core/src/counterfactual/types.ts` (new):

```ts
export const MAX_COUNTERFACTUAL_ALTERNATIVES = 3;
export const MIN_COUNTERFACTUAL_ALTERNATIVES = 2;

export type CounterfactualIntent = 'plausible' | 'shortcut';

export type CounterfactualGate =
  | 'patch-policy'
  | 'verification'
  | 'mechanical'
  | 'suite-rerun'
  | 'adjudication'
  | 'repository-policy';

export interface CounterfactualAlternative {
  id: string;
  intent: CounterfactualIntent;
  rationale: string;
  diff: string;
}

export interface CounterfactualRejection {
  gate: CounterfactualGate;
  rule: string;
  evidence: string;
}

export interface CounterfactualCost {
  inferenceUsd: number;
  sandboxOperations: number;
  elapsedTimeSec: number;
}

export interface CounterfactualResult {
  id: string;
  intent: CounterfactualIntent;
  rationale: string;
  diffHash: string;
  nodeId: string;
  approved: boolean;
  testExitCode: number;
  checks: AuditVerdict['checks'];
  reasoning: string;
  rejectedBy?: CounterfactualRejection;
  cost: CounterfactualCost;
}

export interface CounterfactualEvidence {
  acceptedCandidateId?: string;
  alternatives: CounterfactualResult[];
  cost: CounterfactualCost;
}
```

`diffHash` is `sha256` of the diff, matching `candidateIdentity`. The diff body
itself is not repeated here; `CaseFile.race` already carries the accepted
patch, and Phase 3 carries the alternative bodies in the counterfactual set on
disk. Where a consumer needs an alternative body from a live run, it reads it
from `CaseFile.counterfactual` only if `includeDiffs` was requested; the
default is hashes only.

`packages/core/src/counterfactual/validate.ts` (new)
`validateCounterfactualAlternatives(value)`:

- 2 to 3 entries.
- Unique, non-empty, bounded ids matching `/^[a-z0-9][a-z0-9-]{0,63}$/u`.
- Distinct non-empty rationales.
- Distinct non-empty diffs, each parsing as a valid unified diff with at least
  one file (`parseUnifiedDiff`).
- Every diff at or below `REPAIR_PROPOSAL_LIMITS`-consistent byte bound
  (`policy.maxDiffBytes` is applied later by the gate itself; this check bounds
  the input at 64 KiB).
- At least one entry with `intent: 'shortcut'` (#70).
- Refuses with a message naming the field and the cause.

## Step 3 - The evaluator

`packages/core/src/counterfactual/evaluate.ts` (new):

```ts
export interface CounterfactualEvaluationInput {
  executor: Executor;
  llm: AuditLlm;
  baselineImageId: ImageId;
  diagnosis: Diagnosis;
  policy: RepositoryPolicy;
  runtime: RuntimeAdapter;
  beforeLog: string;
  verificationCommand: string;
  diffBytesLimit: number;
  alternatives: readonly CounterfactualAlternative[];
  acceptedCandidateId?: string;
  cost: CostLedger;
  ledger: StageLedgerPort;   // record(entry): string; entries(): StageEvidence[]
  trace?: TraceRecorder;
}

export async function evaluateCounterfactuals(
  input: CounterfactualEvaluationInput,
): Promise<CounterfactualEvidence>;
```

Per alternative, in this exact order, stopping at the first rejection:

1. `validateCandidateDiff(diff, diagnosis, policy, diffBytesLimit)`. Not ok →
   gate `patch-policy`, `rule` = the first violation, `evidence` = every
   violation joined with `; `. No sandbox operation is spent.
2. `race(executor, baselineImageId, [alternative], verificationCommand, observe)`
   for one candidate. This is the same call the supplied-candidate path makes.
   `held === false` → the audit still runs and refuses at its held check, so
   the gate is `verification` with `rule` = `verification-command` and
   `evidence` = `exit <code>`.
3. `audit(executor, llm, raceResult, { diagnosis, beforeLog, suiteCommand:
   verificationCommand }, observe)`. Map the refusal to a gate:
   - any failed mechanical check → `mechanical`, `rule` = the first failed
     check name, `evidence` = that check's evidence.
   - `held === false` or non-zero race exit → `verification`.
   - reasoning starting `REFUSED: fresh suite rerun exited` → `suite-rerun`,
     `rule` = `fresh-suite-rerun`.
   - failed `llm-adjudication` → `adjudication`, `rule` = `llm-adjudication`,
     `evidence` = the adjudication reasoning.
4. `enforceRepositoryPolicy(...)` on an approved verdict. A refusal maps to
   `repository-policy` with `rule` = `policy-required-command` or
   `policy-resource-limit`.

`approved` is the final verdict's `approved`. `checks` and `reasoning` are the
final verdict's, so an alternative carries the same evidence shape as the
accepted patch.

Cost accounting per alternative: snapshot `cost.totalUsd()` and
`ledger.entries()` before and after, then

- `inferenceUsd` = the difference in `totalUsd()`,
- `sandboxOperations` = the number of added entries carrying an `operationId`,
- `elapsedTimeSec` = the sum of `metrics.elapsedTimeSec` over added entries.

No wall clock is read, so the measurement is deterministic under replay.
`CounterfactualEvidence.cost` is the sum over alternatives, which is the
"additional cost, latency, and sandbox operations" of #75.

Every alternative emits one `counterfactual-result` trace event (Phase 2 adds
the event type; Phase 1 records it through `trace?.record` behind a type that
Phase 2 introduces, so Phase 1 and Phase 2 land in one commit).

## Step 4 - Wire into `repairFailure`

`packages/core/src/domain.ts`: add
`counterfactual?: CounterfactualEvidence` to `CaseFile`, after `search`.

`packages/core/src/heal.ts`:

- `RepairFailureContext.counterfactuals?: readonly CounterfactualAlternative[]`.
- `makeCaseFile` accepts an optional `counterfactual` argument and includes it
  only when defined.
- In the controlled-search path, after `enforceWinnerPolicy` on the winner and
  before `makeCaseFile`, run `evaluateCounterfactuals` when
  `ctx.counterfactuals` is present and non-empty.
- In the supplied-candidate path, run it after the winner audit for the same
  reason, and also when the supplied candidate was refused before execution, so
  a trap case still shows alternatives beside its correct refusal.
- The production outcome is computed before counterfactual evaluation and is
  never read back from it.

`packages/core/src/index.ts`: export `evaluateCounterfactuals`,
`validateCounterfactualAlternatives`, `MAX_COUNTERFACTUAL_ALTERNATIVES`,
`MIN_COUNTERFACTUAL_ALTERNATIVES`, `enforceRepositoryPolicy`, and the
counterfactual types.

## Tests

`packages/core/src/counterfactual/validate.test.ts`:

- refuses fewer than two and more than three alternatives
- refuses duplicate ids, duplicate diffs, duplicate rationales
- refuses a set with no `shortcut`
- refuses an unparseable diff
- accepts a valid two-entry and a valid three-entry set

`packages/core/src/counterfactual/evaluate.test.ts` with `InMemoryExecutor` and
a scripted `AuditLlm`:

- a shortcut that deletes a test is rejected at gate `mechanical` with rule
  `deleted-test`, and the scripted Ultra model is never called
- a shortcut that adds `.skip` is rejected at `mechanical` with `skipped-test`
- a shortcut that adds `as any` is rejected at `mechanical` with
  `loosened-type`
- a shortcut that removes an error path and is caught by the repository policy
  is rejected at `patch-policy` with the policy violation string
- a plausible but wrong patch whose verification command exits non-zero is
  rejected at `verification` with rule `verification-command`
- a correct alternative that passes every deterministic gate reaches
  `adjudication`, and an Ultra refusal is recorded at gate `adjudication`
- an approved alternative records `approved: true` and no `rejectedBy`
- `cost` sums exactly the operations and elapsed seconds the added ledger
  entries report, and is zero inference for every alternative rejected before
  adjudication

`packages/core/src/heal.test.ts` additions:

- a run with counterfactuals attaches `counterfactual` to the `CaseFile` and
  leaves `outcome`, `audit`, `race`, `search`, and `selectedCandidate`
  byte-identical to the same run without counterfactuals
- a trap-shaped supplied candidate refused before execution still records
  alternatives

`packages/core/src/audit/repository-policy.test.ts`: the moved gate keeps the
required-command pairing, the resource-limit check, and the refusal string.

## Success criteria

- [ ] All listed tests pass.
- [ ] `git diff --stat` shows no path under `packages/placebo/corpus` or
      `packages/placebo/src/score.ts`.
- [ ] `DEFAULT_SEARCH_LIMITS`, `DEFAULT_REPAIR_BUDGET_LIMITS`, and
      `REPAIR_ATTEMPT_COSTS` are byte-identical.
- [ ] No mechanical check, the adjudication prompt, or any policy rule changed.
- [ ] `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, `pnpm run test`.
