# Phase 2: Replay boundary, budget, config, Action inputs

Plan: [2026-09-17-typesafe-jev-calibrated-audit.md](../2026-09-17-typesafe-jev-calibrated-audit.md)

Status: done on branch `jev-phases-1-2` (commit `cfec936`, reviewed, simplify pass applied). `[batch-eligible]` with Phase 1 (no shared files; this
phase does not touch `packages/core/src/index.ts`).

## Goal

Everything Phase 3 needs from the platform side, each mirroring the `openai`
/ `secondOpinionUsd` precedent: a `typesafe` replay boundary that records and
replays, a `typesafeAuditUsd` sub-budget with reserve/settle, config and
Action inputs for the key and the budget.

## Facts (VERIFIED 2026-09-17)

- `RecordedHttpBoundary = 'nebius' | 'tavily' | 'contree' | 'openai'` (`replay/bundle.ts:63`).
- `HTTP_BOUNDARIES` (`replay/validate.ts:19`); `REQUIRED_REPLAY_BOUNDARIES` (`:21`) excludes `tavily` and `openai`.
- `recordingOpenAiFetch` (`replay/record-fetch.ts:218-264`) is a clone of `recordingTavilyFetch`.
- `replayFetch` overloads (`replay/replay-fetch.ts:116-134`); `replay-fetch.test.ts:49-56` tests the `openai` boundary.
- `validate.test.ts:83-95` accepts an `openai` exchange and treats a bundle without one as complete.
- Manifest boundaries (`replay/manifest.ts:3-4,40`) lack `openai`.
- `scripts/captured-fixtures.test.mjs:25-49` `BOUNDARY_TESTS` and `PENDING_CAPTURE_IMPORTS`.
- Budget: `RepairBudgetLimits.secondOpinionUsd` (`engine/repair-budget.ts:9,20,42,58,68-71,86,96,99,204-226,253`).
- Config: `SUTURA_SECOND_OPINION_USD` (`config.ts:184-187`), `OPENAI_API_KEY` (`config.ts:214-217`).
- Action: `repair-second-opinion-usd` (`packages/action/src/input.ts:105`), `openai-api-key` (`:113`), `action.yml:22-24,87`.

## Changes

### 1. Replay boundary `typesafe`

- `replay/bundle.ts:63`: `RecordedHttpBoundary` += `'typesafe'`.
- `replay/validate.ts:19`: `HTTP_BOUNDARIES` += `'typesafe'`; **not** required.
- `replay/record-fetch.ts`: `recordingTypeSafeFetch(recorder, fetch): NebiusFetch`
  cloned from `recordingOpenAiFetch` with boundary `'typesafe'`. (The
  `Authorization` header is already stripped by `SENSITIVE_HEADERS`;
  `main.ts` adds the key to the recorder secret list in Phase 3.)
- `replay/replay-fetch.ts`: overload `boundary: 'typesafe'` → `NebiusFetch`.
- `replay/manifest.ts`: `CapturedFixtureBoundary` and `BOUNDARIES` += `'openai'`, `'typesafe'`.
- `scripts/captured-fixtures.test.mjs`: `BOUNDARY_TESTS` += `['packages/core/src/llm/typesafe.test.ts', 'typesafe']`;
  `PENDING_CAPTURE_IMPORTS` += that path (until a workflow capture with a
  `typesafe` exchange exists; Phase 4's benchmark produces them).

Tests: `replay-fetch.test.ts` "replays the typesafe boundary the same way as
nebius"; `validate.test.ts` "accepts a typesafe HTTP exchange" (URL
`https://api.typesafe.ai/v1/systemone`) and "a bundle without typesafe is
complete"; `manifest.test.ts` accepts `boundaries: ['typesafe']` and
`['openai']`; `record-fetch.test.ts` has no `openai` case today, so add one `typesafe` case: the wrapper reserves a `typesafe` sequence and records the exchange with the `Authorization` header stripped.

### 2. Budget — `engine/repair-budget.ts`

- `RepairBudgetLimits` += `typesafeAuditUsd: number` (doc comment: separate
  cap for the optional TypeSafe Jev calibrated audit); `DEFAULT_REPAIR_BUDGET_LIMITS.typesafeAuditUsd = 0.02`.
- `boundedLimit`: the non-integer exemption (`:42`) += `'typesafeAuditUsd'`.
- `repairBudgetLimits`: the new key.
- `export interface TypeSafeAuditReservation { readonly id: number; readonly reservedUsd: number }`.
- `RepairBudget`: private `typesafeAuditUsd = 0`, `unsettledTypeSafeAudit` map,
  `reserveTypeSafeAudit(worstCaseUsd)` / `settleTypeSafeAudit(reservation, actualUsd)`
  copied from the second-opinion pair (`:204-226`) with
  `BudgetExceededError('typesafeAuditUsd')`; `RepairBudgetSnapshot` and
  `snapshot()` (`:86,253`) += the key.

Tests (`repair-budget.test.ts`): reserve beyond 0.02 throws; settle releases
the difference; override above the default is rejected; snapshot lists the key.

### 3. Config — `config.ts`

- `repairBudgets.typesafeAuditUsd` via `boundedPositiveNumber(env, 'SUTURA_TYPESAFE_AUDIT_USD', DEFAULT.typesafeAuditUsd, DEFAULT.typesafeAuditUsd, ...)` next to `:184-187`.
- `typesafeApiKey?: string` via `optional(env, 'TYPESAFE_API_KEY')`, assigned only when present, next to `:214-217`; the `SuturaConfig` type gains the optional field.

Tests (`config.test.ts`): key absent → field absent; present → set;
`SUTURA_TYPESAFE_AUDIT_USD=0.05` → `ConfigError` (above the default).

### 4. Action inputs — `packages/action/src/input.ts`, `packages/action/action.yml`, root `action.yml`

- `input.ts:105` sibling: `SUTURA_TYPESAFE_AUDIT_USD: String(boundedNumber(read('repair-typesafe-audit-usd'), DEFAULT.typesafeAuditUsd, DEFAULT.typesafeAuditUsd, 'repair-typesafe-audit-usd'))`.
- `input.ts:113` sibling: `optional(environment, read, 'typesafe-api-key', 'TYPESAFE_API_KEY')`.
- Both `packages/action/action.yml` and the root `action.yml` (byte-parallel copies that differ only in `main:`), after `openai-api-key`:
  `typesafe-api-key: { description: "Optional TypeSafe API key for the Jev calibrated audit. Veto-only; never widens acceptance.", required: false }`
  and after `repair-second-opinion-usd`: `repair-typesafe-audit-usd` (default `'0.02'`, lower-only).

Tests (`input.test.ts:73,85` pattern): the input maps to the env var; absent
stays absent; the budget input above 0.02 fails with the input name in the
message (ci-parity rule: errors name the cause).

### 5. Benchmark manifest accepts a stated zero output price — `scripts/verified-program-evidence.mjs:90`

`positiveAmount` (`:57-62`) refuses `outputPerMillionUsd: 0`, so a `jev-latest`
manifest row (output is free, vendor pricing 2026-09-17) would be rejected at
Phase 4 step B2. Add `nonNegativeAmount` and use it for `outputPerMillionUsd`
only, with a comment that a stated zero is a known price, distinct from an
absent one (the ADR rule "missing usage or unknown pricing is unavailable, not
zero" still holds because `undefined` and non-numbers still refuse).
`scripts/verified-program-evidence.test.mjs`: a model row with
`outputPerMillionUsd: 0` validates; a missing output price still refuses.

## Verification

```bash
pnpm --filter @sutura/core exec vitest run src/replay src/engine/repair-budget.test.ts src/config.test.ts
pnpm --filter @sutura/action exec vitest run src/input.test.ts
node --test scripts/captured-fixtures.test.mjs scripts/verified-program-evidence.test.mjs
pnpm run typecheck && pnpm run lint
```

`packages/action/dist/index.cjs` is **not** rebuilt here (Phase 3 rebuilds it
once after the wiring), so this phase's commit must not include `dist`.

## Done when

All listed tests green; `typecheck` and `lint` green; no `dist` change. STOP.
