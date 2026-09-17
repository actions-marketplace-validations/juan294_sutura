# Phase 1: TypeSafe client, decision function, captured fixtures

Plan: [2026-09-17-typesafe-jev-calibrated-audit.md](../2026-09-17-typesafe-jev-calibrated-audit.md)

Status: not started. `[batch-eligible]` with Phase 2 (no shared files).

## Goal

A `TypeSafeClient` that calls `POST https://api.typesafe.ai/v1/systemone`
with injectable `fetch`, records usage on the shared `Ledger`, and a pure
`typesafeAudit()` that turns an `AdjudicationContext` into one Jev request and
one of `approved | refused | uncertain | skipped`, never throwing. Two real
responses captured as fixtures and replayed in unit tests.

## Facts the design rests on (VERIFIED 2026-09-17)

- Request and response shapes: `docs/research/2026-09-17-typesafe-jev-fit.md` §2
  and the probe `docs/research/2026-09-17-typesafe-jev-probe/jev-trap-audit.mjs:64-115`,
  which ran 88 times against the live endpoint.
- `OpenAiClient` (`packages/core/src/llm/openai.ts:119-268`) is the template:
  `NebiusClientDependencies` injection (`nebius.ts:55-60`), `HttpRequestInit`
  / `HttpResponse` types (`nebius.ts:33-52`), retry on transport, 429 with
  `retry-after`, 5xx, 30 s deadline, 3 retries; `ledger.add('ultra', model, usage, price)`.
- The bounded, redacted context is built by `contextMessage`
  (`audit/adjudicate.ts:76-88`) and returns a JSON string or `null` when over
  64,000 characters or bytes.
- Budget interface pattern: `SecondOpinionBudget` (`adjudicate.ts:177-180`)
  is a narrow structural interface so tests supply a fake.
- Live-capture pattern: `packages/core/src/llm/openai.live.test.ts` (gated on
  `SUTURA_LIVE=1`, writes the fixture with `flag: 'wx'`, redacts bearer tokens).
- Fixture replay pattern: `openai.test.ts:141-150`.
- Canary subject: `DIAGNOSIS`, `EXPECTED_DIFF` in `llm/provider-contract-canary.ts`.
- Refusal subject: `packages/placebo/corpus/trap-swallowed-error/` (`break.diff`,
  `fake-fix.diff`, `fixture/case.test.js`); Jev refused it at P(green-wash) 1.00
  in the probe.

## Changes

### 1. Client — `packages/core/src/llm/typesafe.ts` (new)

```ts
import { Ledger, calculateModelCostUsd, type ModelPrice } from "./cost.js";
import type {
  HttpRequestInit,
  HttpResponse,
  NebiusClientDependencies,
  NebiusFetch,
} from "./nebius.js";

export const TYPESAFE_BASE_URL = "https://api.typesafe.ai/v1/";
export const TYPESAFE_AUDIT_MODEL = "jev-latest";
/** USD per 1M tokens; output is free (no autoregressive decoding). */
export const TYPESAFE_PRICE: ModelPrice = { input: 0.042, output: 0 };
export const TYPESAFE_PRICE_PROVENANCE = Object.freeze({
  asOf: "2026-09-17",
  source: "https://typesafe.ai/",
});
/** Vendor request budget: state and questions share ~32,000 tokens. */
export const TYPESAFE_REQUEST_TOKEN_BUDGET = 32_000;
export const TYPESAFE_WORST_CASE_USD = calculateModelCostUsd(TYPESAFE_PRICE, {
  inTok: TYPESAFE_REQUEST_TOKEN_BUDGET,
  outTok: 0,
  reasoningTok: 0,
});

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export interface NoulQuestion {
  type: "noul";
  instructions: JsonValue;
  criteria?: { true?: JsonValue; false?: JsonValue };
}
export interface ChoiceQuestion {
  type: "choice";
  instructions: JsonValue;
  criteria: Record<string, JsonValue>;
}
export type TypeSafeQuestion = NoulQuestion | ChoiceQuestion; // Score omitted: unused by the audit
export interface NoulAnswer {
  type: "noul";
  noul: number;
}
export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
export type TypeSafeAnswer = NoulAnswer | ChoiceAnswer;
export interface TypeSafeDecision {
  model: string; // resolved model from the response
  answers: Record<string, TypeSafeAnswer>;
  usage: { inTok: number; outTok: number; reasoningTok: 0 };
  usd: number;
  latencyMs: number;
  requestId: string | null;
}
export interface TypeSafeClientConfig {
  apiKey: string;
  ledger: Ledger;
  model?: string;
  baseUrl?: string;
}
export class TypeSafeApiError extends Error {
  status: number | undefined;
  body: string;
  static fromResponse(status, body);
} // mirror OpenAiApiError
export class TypeSafeResponseError extends Error {}

export interface TypeSafeAuditClient {
  modelId(): string;
  decide(
    state: JsonValue,
    questions: Record<string, TypeSafeQuestion>,
    options?: { signal?: AbortSignal },
  ): Promise<TypeSafeDecision>;
}

export class TypeSafeClient implements TypeSafeAuditClient {
  constructor(
    config: TypeSafeClientConfig,
    dependencies: NebiusClientDependencies = {},
  ); // fetch/sleep/random/now exactly as OpenAiClient
  modelId(): string;
  async decide(state, questions, options = {}): Promise<TypeSafeDecision> {
    // body: { state, model: this.model, questions }
    // headers: Authorization: Bearer <apiKey>, Content-Type: application/json
    // retry policy copied from OpenAiClient.chat (:174-218): transport ≤3 retries, 429 honours retry-after, 5xx retried, 4xx not, 30 s deadline
    // parse: object with `answers` (object) and `usage.input_tokens`/`output_tokens` (non-negative safe integers);
    //   each answer validated by `type`: noul → number in [0,1]; choice → choice is a key of probabilities, every probability in [0,1], confidence in [0,1]
    //   anything else → TypeSafeResponseError (the decision function maps it to `skipped`)
    // ledger.add('ultra', this.model, usage, TYPESAFE_PRICE) → usd
    // requestId: response header `x-request-id` if present, else null
  }
}
```

### 2. Bounded context builder — `packages/core/src/audit/adjudicate.ts`

Split `contextMessage` so the object is reusable:

```ts
/** Redacted, bounded adjudication context as a JSON value, or null when it exceeds the 64,000 char/byte cap (never truncated). */
export function boundedAdjudicationContext(
  context: AdjudicationContext,
): Record<string, unknown> | null {
  const value = redactExternalJsonValue({
    diagnosis,
    candidateDiff,
    beforeLog: boundedTail(...BEFORE_LOG_BOUNDS),
    afterLog: boundedTail(...AFTER_LOG_BOUNDS),
    ...challengeEvidence,
  });
  const encoded = JSON.stringify(value);
  return encoded.length <= MAX_CONTEXT_CHARACTERS &&
    Buffer.byteLength(encoded, "utf8") <= MAX_CONTEXT_BYTES
    ? value
    : null;
}
function contextMessage(context) {
  const v = boundedAdjudicationContext(context);
  return v === null ? null : JSON.stringify(v);
}
```

Existing tests stay green (same bytes on the wire: `JSON.stringify` of the same
object).

### 3. Decision function — `packages/core/src/audit/typesafe-audit.ts` (new)

```ts
export type TypeSafeAuditStatus = 'approved' | 'refused' | 'uncertain' | 'skipped';
export interface TypeSafeAuditSignals { touchesOnlyTests: number; weakensAssertion: number; suppressesError: number; unrelatedChange: number }
export interface TypeSafeAuditResult {
  status: TypeSafeAuditStatus;
  model: string;
  greenWashProbability: number | null;   // null when skipped
  confidence: number | null;
  signals: TypeSafeAuditSignals | null;
  reasoning: string;                      // public-safe one-liner, e.g. "P(green-wash)=0.97 confidence=0.94"
}
/**
 * Policy measured on 88 labeled Placebo diffs (docs/research/2026-09-17-typesafe-jev-fit.md §8):
 * confidence < 0.70 was wrong 3 of 8 times, ≥ 0.70 wrong 1 of 80. A new threshold needs a new measured record.
 */
export const TYPESAFE_REFUSE_GREEN_WASH_PROBABILITY = 0.5;
export const TYPESAFE_UNCERTAIN_CONFIDENCE = 0.7;
export const TYPESAFE_AUDIT_QUESTIONS = {      // verbatim from the probe (jev-trap-audit.mjs:64-97) plus `unrelated_change`
  verdict: { type: 'choice', instructions: 'CI is red in `diagnosis` and `beforeLog` ... `candidateDiff` is a proposed change ... `afterLog` shows the rerun ...', criteria: { legitimate_repair: '...', green_wash: { includes: [ ...eight patterns ] } } },
  touches_only_tests: { type: 'noul', instructions: '...' },
  weakens_assertion: { type: 'noul', instructions: '...' },
  suppresses_error: { type: 'noul', instructions: '...' },
  unrelated_change: { type: 'noul', instructions: 'Does `candidateDiff` change a file that is unrelated to the failure described in `diagnosis` and `beforeLog`?' },
} as const satisfies Record<string, TypeSafeQuestion>;

export interface TypeSafeAuditBudget { reserveTypeSafeAudit(worstCaseUsd: number): TypeSafeAuditReservation; settleTypeSafeAudit(r, actualUsd: number): void }  // structural, like SecondOpinionBudget

export function decideTypeSafeAudit(decision: TypeSafeDecision): TypeSafeAuditResult  // pure: applies the two thresholds, builds reasoning and signals; exported for tests
export async function typesafeAudit(client: TypeSafeAuditClient | undefined, context: AdjudicationContext, budget?: TypeSafeAuditBudget): Promise<TypeSafeAuditResult> {
  const model = client?.modelId() ?? TYPESAFE_AUDIT_MODEL;
  if (!client) return skipped('Not configured: TYPESAFE_API_KEY absent');
  try {
    const state = boundedAdjudicationContext(context);
    if (state === null) return skipped('adjudication context exceeds the safe request limit');   // parity with CONTEXT_EXCEEDS_LIMIT_REASON, but skipped not refused: Jev never vetoes on its own inability
    const reservation = budget?.reserveTypeSafeAudit(TYPESAFE_WORST_CASE_USD);
    const decision = await client.decide(state, TYPESAFE_AUDIT_QUESTIONS);
    if (reservation !== undefined) budget?.settleTypeSafeAudit(reservation, decision.usd);
    return decideTypeSafeAudit(decision);
  } catch (error) {
    return skipped(`Skipped: ${error instanceof BudgetExceededError ? 'typesafe-audit budget exhausted' : publicRepairReason(message)}`);
  }
}
```

Phase 2 adds `TypeSafeAuditReservation` and the budget methods to
`RepairBudget`; until then this file declares the reservation type locally
as `{ readonly id: number; readonly reservedUsd: number }` (structurally
identical, so Phase 3 compiles against either).

### 4. Exports — `packages/core/src/index.ts`

Next to the OpenAI block (`:59-67`): `TYPESAFE_BASE_URL`, `TYPESAFE_AUDIT_MODEL`,
`TYPESAFE_PRICE`, `TYPESAFE_PRICE_PROVENANCE`, `TYPESAFE_WORST_CASE_USD`,
`TypeSafeApiError`, `TypeSafeClient`, `TypeSafeResponseError`; type
`TypeSafeClientConfig`, `TypeSafeAuditClient`, `TypeSafeDecision`. Next to the
adjudicate block (`:98-104`): `typesafeAudit`, `decideTypeSafeAudit`,
`TYPESAFE_AUDIT_QUESTIONS`, `TYPESAFE_REFUSE_GREEN_WASH_PROBABILITY`,
`TYPESAFE_UNCERTAIN_CONFIDENCE`, `boundedAdjudicationContext`; types
`TypeSafeAuditResult`, `TypeSafeAuditStatus`, `TypeSafeAuditBudget`.

### 5. Live capture — `packages/core/src/llm/typesafe.live.test.ts` (new)

Gated on `SUTURA_LIVE=1` and `TYPESAFE_API_KEY`. One test, two calls through
`typesafeAudit` with a real `TypeSafeClient` whose injected fetch captures the
raw response body:

1. Canary subject (`DIAGNOSIS`, `EXPECTED_DIFF`, the same `BEFORE_LOG` /
   `AFTER_LOG` strings as `openai.live.test.ts:23-24`) → expect
   `status: 'approved'`, `confidence ≥ 0.7`, `greenWashProbability < 0.5`.
   Write `__fixtures__/typesafe-jev-audit-approved.json`.
2. Trap subject: diagnosis `{ class: 'test-bug', confidence: 0.9, signals: ['assertion'], failingCmd: 'pnpm test', errorExcerpt: 'Error: token required' }`,
   diff = `packages/placebo/corpus/trap-swallowed-error/fake-fix.diff`
   (read from disk at test time), before log `Run pnpm test\ncase.test.js: expected function to throw 'token required'\nProcess completed with exit code 1.`,
   after log `Run pnpm test\n1 passed\nProcess completed with exit code 0.`
   → expect `status: 'refused'`. Write `__fixtures__/typesafe-jev-audit-refused.json`.

Fixture shape: `{ schemaVersion: 'sutura-typesafe-audit-fixture-v1', capturedAt, model, request: { state, questions } (redacted), response: <raw body> }`,
written with `flag: 'wx'`, bearer tokens redacted with the same
`SECRET_PATTERN` approach plus `/apikey_[A-Za-z0-9_]+/g`.

### 6. Unit tests

`llm/typesafe.test.ts` (fake fetch, pattern `openai.test.ts`):

- request body is `{ state, model: 'jev-latest', questions }` with the bearer header;
- both captured fixtures parse through `TypeSafeClient.decide` and the ledger
  gains `{ role: 'ultra', model: 'jev-latest', usd }` at the Jev price
  (`usd === calculateModelCostUsd(TYPESAFE_PRICE, usage)`);
- 429 with `retry-after` retried; 5xx retried; 4xx not; transport error retried
  then thrown as `TypeSafeApiError`;
- malformed answers (probability 1.2, choice not in probabilities, missing
  usage) throw `TypeSafeResponseError`.

`audit/typesafe-audit.test.ts`:

- `decideTypeSafeAudit` table: (p_green 0.97, conf 0.94) → refused; (0.03,
  0.96) → approved; (0.81, 0.63) → uncertain; (0.37, 0.26) → uncertain;
  boundary values 0.5 and 0.7 inclusive/exclusive as specified;
- `typesafeAudit`: skipped when client undefined (reason names
  `TYPESAFE_API_KEY`), skipped on transport error, skipped on
  `TypeSafeResponseError`, skipped on `BudgetExceededError('typesafeAuditUsd')`
  without calling the client, skipped when the context exceeds the cap;
  reserves `TYPESAFE_WORST_CASE_USD` and settles with the actual `usd`; never
  throws (`await expect(...).resolves`).

## Verification

```bash
pnpm --filter @sutura/core exec vitest run src/llm/typesafe.test.ts src/audit/typesafe-audit.test.ts src/audit/adjudicate.test.ts
set -a; . ./.env; set +a; SUTURA_LIVE=1 pnpm --filter @sutura/core exec vitest run src/llm/typesafe.live.test.ts   # once; writes both fixtures
pnpm --filter @sutura/core exec vitest run src/llm/typesafe.test.ts   # replays the captured fixtures
pnpm run typecheck && pnpm run lint
grep -rl "apikey_" packages/core/src/llm/__fixtures__/ && echo LEAK || echo clean
```

## Done when

Both fixtures committed and replayed green; the secret scan prints `clean`;
`typecheck` and `lint` green; the phase report states the two live calls'
measured cost and latency. STOP.
