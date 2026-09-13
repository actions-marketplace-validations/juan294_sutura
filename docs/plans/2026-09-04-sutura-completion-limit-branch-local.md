# Sutura branch-local completion limit plan

Date: 2026-09-04

Status: Implemented locally; live authorization gates pending

Integration branch: `develop`

Parent plan: `docs/plans/2026-09-03-sutura-search-recovery.md` (its "Measured result after implementation" section is the evidence for this plan; this plan inserts before the Phase 4 benchmark rerun of `docs/plans/2026-09-01-sutura-v0.2.1-evidence-remediation.md`)

## Objective

Stop one runaway Super reply from ending an adaptive search that still holds patched branches. A `completion-limit` terminal becomes local to its branch. The whole search still stops when runaway replies outnumber applied proposals, which is the systematic case the global rule was written for. No fixture, scorer, search limit, budget, policy rule, or audit changes.

## Measured evidence

Four-case upstream re-run on `develop` commit `08459febad47294b8202f4dac5d8feeedf1c37c5` on 2026-09-04 (archive `.sutura/placebo-v0.2.1-failed-runs/upstream-rerun-08459fe/`, USD 0.9472):

| Case | With Tavily | Super turns | Runaway replies | Live branches when the search stopped | Run |
| --- | --- | --- | --- | --- | --- |
| upstream-client-release | gave-up | 5 | 1 | 3 patched depth-1 branches retained | 33836453870 |
| upstream-formatter-release | gave-up | 5 | 1 | 2 patched depth-1 branches retained | 33836899254 |
| upstream-parser-release | fixed | 4 | 0 | candidate found | 33837301600 |
| upstream-retry-release | fixed | 4 | 0 | candidate found | 33837788877 |

Both `gave-up` traces end the same way: three or four `Retain branch in frontier` decisions, one `Branch terminal: completion-limit`, then `run-finish` with `gave-up`. The runaway reply is 8,192 output tokens for about 8,790 bytes, about one byte per token, which is a degenerate repetition loop rather than a long proposal. Inference for each of those runs was under USD 0.014, so the stop was not a budget stop.

The runaway is stochastic, not a v5 contract artifact. Across the four archived re-runs, 71 Super proposal turns ran with the v5 request (`5a4fd146`, `dd3cc7a`, `08459fe`) and 2 reached the completion limit, both in the `08459fe` run. The 17 v4 turns on `d03a8d15` had none.

## Where the rule lives

- `packages/core/src/engine/search.ts:78-80` `isGlobalTerminal` names `completion-limit` as the only global terminal.
- `packages/core/src/engine/search.ts:127-135` cancels every unfinished sibling in the batch as soon as one expansion returns `passed` or a global terminal.
- `packages/core/src/engine/search.ts:192-195` returns `{ candidates: [], terminalReason: 'completion-limit' }` after the batch when any child is a global terminal, discarding the frontier.
- `packages/core/src/engine/search.ts:82-86` `isEvidenceTerminal` lets `cancelled` and `completion-limit` override `repeated-state`.
- `packages/core/src/engine/search.ts:201-204` builds the next frontier from children whose `terminalReason` is `undefined` or `failed`.
- `packages/core/src/heal.ts:1122` maps a repair attempt with `failureKind: 'completion-limit'` to a node `terminalReason: 'completion-limit'`; `packages/core/src/engine/repair-attempt.ts:347-352` and `:396-401` produce that failure kind from provider `finish_reason: length` on the first proposal or its retry.
- `packages/core/src/engine/search-score.ts:20` already ranks a no-patch node (`changedFiles.length === 0`) after every patched node.

## Why the rule was global

Commit `c7f3125` (2026-08-29, "stop retries after repair completion limits") answered live run 12, where five of six Super replies hit the completion ceiling and the run gave up after spending every turn on truncated output (`docs/plans/2026-08-29-live-repair-reliability-notes.md`, "Completion-budget revision"). The acceptance line in `docs/plans/2026-08-29-live-repair-reliability.md:156` reads: "A completion-limit terminal cancels unfinished siblings, stops later batches and depths, and never discards a valid candidate that completed in the same batch." The protected property was: when the model cannot finish a proposal at all, stop spending. That property must survive.

## Design decisions

- A `completion-limit` node is terminal for its own branch only. It is never re-expanded: re-expansion would resend the same prompt for the same excerpt, and the frontier already prefers patched siblings. It keeps `terminalReason: 'completion-limit'` in search evidence, so traces and the public case file are unchanged in shape.
- The search stops globally with `terminalReason: 'completion-limit'` only when, over the whole run so far, completion-limit nodes outnumber nodes whose proposal applied a patch (`policyEvidence.changedFiles.length > 0`). This is evaluated after each batch settles. Live run 12 (one batch of one, zero patches, one runaway) still stops after the first Super call, exactly as today's replay test asserts. The `08459fe` shape (one runaway among three or four applied proposals) continues.
- A completion-limit expansion no longer cancels its unfinished siblings. Only `passed` triggers early cancellation. Reason: with concurrent batches the runaway is usually the last reply to settle (15 s versus 1 to 5 s), but if it settled first the old cancellation would discard siblings that were about to apply patches. The extra spend in the systematic case is bounded by one batch, at most `initialBranches` turns, each already reserved against the inference budget at `CONTROLLED_REPAIR_MAX_TOKENS` output tokens (`repair-attempt.ts:281`).
- Existing bounds are unchanged and still cap the run: `DEFAULT_REPAIR_BUDGET_LIMITS.modelTurns`, `inferenceCostUsd`, `branches`, `DEFAULT_SEARCH_LIMITS`, and the per-attempt worst-case reservation.
- `isEvidenceTerminal` stays as it is so `completion-limit` and `cancelled` still override `repeated-state`.
- No change to `heal.ts` control flow, `repair-attempt.ts`, `search-score.ts`, `domain.ts`, the audit, policy rules, or any Placebo fixture or scorer. The 8,192-token envelope and Super sampling parameters are out of scope.

## Phases

| Phase | Name | Files | Depends on | Batch |
| --- | --- | --- | --- | --- |
| 1 | Branch-local completion limit in the search engine | `packages/core/src/engine/search.ts`, `packages/core/src/engine/search.test.ts` | None | Not batch-eligible (Phase 2 depends on it) |
| 2 | Orchestration replay, changelog, bundle | `packages/core/src/heal.test.ts`, `CHANGELOG.md`, `packages/action/dist/index.cjs`, this plan's status line | Phase 1 | Not batch-eligible |

Phase files: `docs/plans/2026-09-04-sutura-completion-limit-branch-local-phases/phase-1.md`, `phase-2.md`.

## Verification

Each phase runs its focused tests, then `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and `pnpm run test`. The integrated candidate runs `pnpm run ci:local` and rebuilds `packages/action/dist/index.cjs` in the same commit as the `packages/core` change.

Live measurement, each under its own authorization and cap:

1. Provider contract canary on the exact candidate. The request serializer does not change, so the contract version stays `sutura-super-repair-v5`; the canary is still required by the live gate and must be dispatched by hand for a push that does not touch `packages/core/src/llm` (`gh workflow run provider-contract-canary.yml --ref develop`).
2. The same four upstream cases through `scripts/placebo-live.mjs run` (about USD 1.00). Target: no with-Tavily run ends `gave-up` with a `completion-limit` node while any depth-1 node was retained in the frontier. Because the runaway is stochastic, a run with zero runaway replies proves nothing about this change and must be reported as such.
3. The complete 51-case, 55-evaluation benchmark from Phase 4 of the parent plan. Targets are unchanged.

## Success criteria

Automated:

- [x] `packages/core/src/engine/search.test.ts` covers: one completion limit among applied proposals continues to depth 2; runaways outnumbering applied proposals stop the run with `terminalReason: 'completion-limit'`; a completion-limit node is never a parent; a completion-limit expansion cancels no sibling; a passing candidate in the same batch is still kept.
- [x] `packages/core/src/heal.test.ts` keeps `replays live run 12: one completion limit stops the remaining repair branches` passing unchanged, and adds a replay of the `08459fe` chalk shape that reaches depth 2 after one completion limit.
- [x] No path under `packages/placebo/corpus` or `packages/placebo/src/score.ts` changes, and `DEFAULT_SEARCH_LIMITS`, `DEFAULT_REPAIR_BUDGET_LIMITS`, and `REPAIR_ATTEMPT_COSTS` are byte-identical.
- [x] `pnpm run ci:local` passes on the integrated commit.

Manual:

- [x] Review that the global stop still fires for the live run 12 shape and that no new constant or configurable limit was introduced.
- [ ] Confirm the live canary passed on the pushed candidate before any live case dispatch.

## Out of scope

- The 8,192-token completion envelope, `force_nonempty_content`, and Super sampling parameters. The runaway rate (2 of 71 v5 turns) is a model behavior; this plan only stops it from discarding good branches.
- Re-expanding a completion-limit node with a different target. Target rotation already exists for `failed` parents; extending it to completion-limit nodes needs its own measurement.
- Any change to beam width, depth, branch count, or budgets.

## Authorization gates

This plan does not authorize a push, a canary, a live case run, a benchmark, or a release. Each needs its own exact candidate and explicit authorization.
