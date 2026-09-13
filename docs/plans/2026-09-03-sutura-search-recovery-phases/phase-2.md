# Phase 2: Proposal validity retry and provider flag `[batch-eligible]`

Status: Completed; live canary pending separate authorization

## Goal

An invalid Super proposal costs one bounded retry instead of the whole branch, and the request carries NVIDIA's documented coding-agent flag.

## Change A: bounded proposal retry

`packages/core/src/engine/repair-attempt.ts`, inside `runControlledRepairAttempt` after the `finishReason === 'length'` check (`:335-340`):

```text
parseAttempt(replyText):
  proposal = parseProposal(replyText)
  proposalDiff = anchoredEditsDiff([{ path, startLine, endLine, replacement }], ctx.sourceContext)
  return { proposal, proposalDiff }

try first = parseAttempt(reply.text)
catch firstError:
  retryMessages = [
    ...messages,
    { role: 'assistant', content: reply.text },
    { role: 'user', content: 'The previous reply was not a valid repair proposal: <publicRepairReason(firstError.message)>. Return only ' + JSON.stringify(REPAIR_PROPOSAL_EXAMPLE) + ' with the complete replacement text.' },
  ]
  retryBytes = Buffer.byteLength(JSON.stringify({ messages: retryMessages, responseSchema: schema }), 'utf8')
  retry = requestRepairModel({ llm, budget, messages: retryMessages, options, worstCaseUsd: price => worstCaseRequestUsd(retryBytes, price.input, price.output), signal, observeCapacity })
  if !retry.ok: return retry.outcome
  if retry.reply.finishReason === 'length': return completion-limit outcome (same text as today)
  try first = parseAttempt(retry.reply.text)
  catch secondError: return { status: 'gave-up', failureKind: 'invalid', reason: publicRepairReason(secondError.message) }
```

Rules:

- Exactly one retry. The second model turn reserves and settles through `requestRepairModel`, so it is charged to `modelTurns` and `inferenceCostUsd` like any other turn and fails closed on budget.
- `REPAIR_ATTEMPT_COSTS.modelTurns` stays 1. The retry is opportunistic; `availableBranches` in `heal.ts:950-964` recomputes from the budget snapshot before every expansion, so a retry reduces later capacity honestly instead of being pre-reserved.
- `ctx.observe` records one ledger entry `Proposal retry after invalid response` before the second request.
- The retry message is redacted through `publicRepairReason` and never includes hidden reasoning.

## Change B: `force_nonempty_content`

`packages/core/src/llm/nebius.ts:408-414`

```text
thinkingMode === 'disabled' -> { enable_thinking: false, force_nonempty_content: true }
```

`packages/core/src/llm/provider-contract-canary.ts:17`: `SUPER_REPAIR_PROVIDER_CONTRACT_VERSION = 'sutura-super-repair-v5'`.

The canary already asserts `finish_reason === 'stop'`, no think prefix, zero reasoning tokens, and the exact arithmetic diff, so it fails closed if the provider rejects or mishandles the field. If the live canary fails on the field, revert Change B alone and keep `v4`.

## Tests

`packages/core/src/engine/repair-attempt.test.ts` (reuse the `llm()` helper; make `chat` return values from a queue):

- `retries one invalid proposal and submits the valid second reply`: queue `['not json', JSON.stringify({ replacement: fixedSource })]`, executor results as in the accepted-patch replay. Assert `outcome.status === 'submitted'`, `chat` called twice, second call's messages end with an assistant turn equal to `'not json'` followed by a user turn containing `REPAIR_PROPOSAL_EXAMPLE`, and `budget.snapshot().modelTurns === 2`.
- `fails closed after a second invalid proposal`: queue `['not json', 'still not json']`. Assert `status: 'gave-up'`, `failureKind: 'invalid'`, `chat` called twice, no `apply_patch` executed.
- `does not retry a completion-limit reply`: first reply `{ text: '', finishReason: 'length' }`. Assert `failureKind: 'completion-limit'`, `chat` called once.
- `stops the retry on budget`: `RepairBudget` with `modelTurns: 1`. Queue `['not json', valid]`. Assert `failureKind: 'budget'`, `chat` called once.

`packages/core/src/llm/nebius.test.ts`

- Update `replays canary 33312570131: sends chat_template_kwargs directly` (`:235-253`) to expect `{ enable_thinking: false, force_nonempty_content: true }`.
- Assert `enabled` and `low-effort` bodies are unchanged (`:265-275`).

`packages/core/src/llm/provider-contract-canary.test.ts`

- Update the expected `contractVersion` to `sutura-super-repair-v5`.

## Automated success criteria

- `pnpm --filter @sutura/core exec vitest run src/engine/repair-attempt.test.ts src/llm/nebius.test.ts src/llm/provider-contract-canary.test.ts` passes.
- `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:release-contracts` pass.

## Manual success criteria

- Confirm the retry never runs after `finishReason === 'length'` or after a budget or provider failure.
- Live canary with `sutura-super-repair-v5` passes on the exact candidate before any benchmark dispatch (separate authorization).

Stop after the phase is integrated into local `develop`.
