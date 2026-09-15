# Phase 3: GPT-6 Astra second-opinion auditor

Plan: [2026-09-15-launch-readiness-v0.3.1.md](../2026-09-15-launch-readiness-v0.3.1.md)

Status: not started. `[batch-eligible]` with Phases 1 and 2. Touches
`packages/core` and `packages/action` → `ci:local` before pushing; rebuild
`packages/action/dist/index.cjs` in the same commit. Time-box: green by
Wednesday 22:00 or v0.3.1 ships without it.

## Goal

When `OPENAI_API_KEY` is present, the adjudication gate asks GPT-6 Astra the
same adversarial question after Nemotron and records a second check row.
Astra can only veto. When the key is absent, or Astra fails, or its budget is
exhausted, the row says `skipped` and the run proceeds on Nemotron alone. The
runtime remains Nemotron on Nebius Token Factory (the Nebius hard gate).

## Facts the design rests on (VERIFIED)

- Production gate: `packages/core/src/verification/runtime.ts:80-85`
  (`case 'adjudication'` inside `evaluateRuntimeCandidate`). `audit.ts:56`
  is exported but not called in production; `audit-only.ts:145` is the CLI
  `sutura audit` path. `AuditLlm = TierLlm<'ultra'>` (`audit/adjudicate.ts:13`).
- `GreenwashCheck` (`domain.ts:75-87`) is a closed union; `CostLedger.entries[].role`
  is `'nano'|'super'|'ultra'`; the report renderers are generic per row and
  key the cost table by role (`report/format.ts:5-9`), so charging Astra as
  `role: 'ultra'`, `model: 'gpt-6-astra'` renders without renderer changes.
- `adjudicate()` fails closed on any non-budget error (`adjudicate.ts:136-144`).
- `Ledger.add(role, model, usage, routedPrice)` accepts an explicit price
  (`llm/cost.ts:62-84`); `NebiusClient` owns its own ledger and hard-codes
  `/chat/completions` plus `temperature` in the body (`nebius.ts:111-113,
  :414-462`), so Astra gets its own small client that writes into the **same**
  `Ledger` instance.
- `inferenceCostUsd` defaults to 0.25 and is lower-only bounded
  (`engine/repair-budget.ts:11-19, :30-43`); one Astra adjudication worst-cases
  at ≈ 16 K input × USD 10/M + 4 096 output × USD 50/M ≈ USD 0.36, typical
  ≈ USD 0.04 (benchmark ultra entries: 2 310 in / ~300 out).
- Replay boundaries are chosen by the recording wrapper, not by URL
  (`replay/record-fetch.ts:167-264`); `tavily` is optional because it is absent
  from `REQUIRED_REPLAY_BOUNDARIES` (`replay/validate.ts:21`) and
  `bundle.ts:610-612`.
- OpenAI (developer docs, 2026-09-15): model id `gpt-6-astra`; Chat
  Completions supported (Responses needed only for tool calling); remove
  `temperature`/`top_p`; `reasoning_effort` ∈ low|medium|high (not `none`);
  pricing USD 10 input / 1 cached / 50 output per 1M (standard).

## Changes

### 1. Client — `packages/core/src/llm/openai.ts` (new)

```ts
export const OPENAI_BASE_URL = 'https://api.openai.com/v1/';
export const SECOND_OPINION_MODEL = 'gpt-6-astra';
export const SECOND_OPINION_PRICE: ModelPrice = { input: 10, output: 50 };
export const SECOND_OPINION_PRICE_PROVENANCE = Object.freeze({ asOf: '2026-09-15', source: 'https://developers.openai.com/api/docs/pricing' });

export interface OpenAiClientConfig { apiKey: string; ledger: Ledger; model?: string; baseUrl?: string }
export class OpenAiClient implements TierLlm<'ultra'> {
  constructor(config: OpenAiClientConfig, dependencies: NebiusClientDependencies = {}) // reuse NebiusFetch/sleep/random/now types
  modelId(): string { return this.model; }
  async chat(tier: 'ultra', messages, options = {}): Promise<TierLlmReply> {
    // body: { model, messages, max_completion_tokens: options.maxTokens ?? 4096,
    //         reasoning_effort: options.reasoningEffort ?? 'low',
    //         response_format: options.responseFormat === undefined ? undefined : { type: 'json_object' } }
    // NO temperature, top_p, tools. Headers: Authorization Bearer, Content-Type.
    // Retry: same policy as NebiusClient (:481-537): transport ≤3 retries, HTTP retry on 429/5xx, 30 s deadline, retry-after honoured.
    // Parse: choices[0].message.content (string, non-empty) → text; usage.prompt_tokens, completion_tokens,
    //        completion_tokens_details?.reasoning_tokens ?? 0 → usage {inTok, outTok: completion - reasoning, reasoningTok}.
    // this.ledger.add('ultra', this.model, usage, SECOND_OPINION_PRICE); return { text, usage, usd, model, latencyMs, requestId }.
  }
}
export class OpenAiApiError extends Error { status; body }  // mirror NebiusApiError.fromResponse
```

Export from `packages/core/src/index.ts` next to the Nebius exports.

### 2. Adjudication with fail-open semantics — `audit/adjudicate.ts`

Refactor the body of `adjudicate` into `adjudicateWith(llm, ctx, { failClosed })`;
`adjudicate` keeps its signature and `failClosed: true`. Add:

```ts
export type SecondOpinionStatus = 'approved' | 'refused' | 'skipped';
export interface SecondOpinionResult { status: SecondOpinionStatus; reasoning: string; model: string }
export async function secondOpinion(llm: AdjudicationLlm | undefined, ctx: AdjudicationContext, budget?: SecondOpinionBudget): Promise<SecondOpinionResult> {
  if (!llm) return { status: 'skipped', reasoning: 'Not configured: OPENAI_API_KEY absent', model: SECOND_OPINION_MODEL };
  try {
    const reservation = budget?.reserve(SECOND_OPINION_WORST_CASE_USD);   // throws BudgetExceededError('secondOpinionUsd')
    const result = await adjudicateWith(llm, ctx, { failClosed: false });  // throws on transport/parse
    budget?.settle(reservation, actualUsd);
    return { status: result.approved ? 'approved' : 'refused', reasoning: result.reasoning, model };
  } catch (error) {
    return { status: 'skipped', reasoning: `Skipped: ${error instanceof BudgetExceededError ? 'second-opinion budget exhausted' : publicSafe(error)}`, model };
  }
}
```

Same prompt, same context bounds, same JSON validation; `OPTIONS` for Astra
omit `temperature` (the client ignores it anyway) and set `reasoningEffort: 'low'`.

### 3. Gate — `verification/runtime.ts` `case 'adjudication'`

```ts
const result = await adjudicate(input.llm, adjudicationContext);
const second = await secondOpinion(input.secondOpinion, adjudicationContext, input.secondOpinionBudget);
const approved = result.approved && second.status !== 'refused';
verdict.checks.push({ name: 'llm-adjudication', passed: result.approved, evidence: result.reasoning });
verdict.checks.push({ name: 'second-opinion', passed: second.status !== 'refused', evidence: `${second.model}: ${second.status}: ${second.reasoning}` });
verdict.reasoning = approved ? result.reasoning : second.status === 'refused' && result.approved ? `REFUSED by second opinion (${second.model}): ${second.reasoning}` : result.reasoning;
return { ...(approved ? passed : { status: 'failed', reasons: ['audit-refused'] }), artifacts: artifact('adjudication', { nemotron: result, secondOpinion: second }) };
```

- `RuntimeCandidateInput` gains `secondOpinion?: AuditLlm` and
  `secondOpinionBudget?: SecondOpinionBudget`.
- `domain.ts` `GreenwashCheck` += `'second-opinion'`. `audit.test.ts:103,125`
  assert exactly 8 rows in the `audit()` path — that path is unchanged (no
  second-opinion row there), so they stay green. Mirror the row in
  `audit-only.ts:145-168` (CLI `sutura audit`) for parity.
- The row is pushed **always** when the gate runs (status `skipped` when
  unconfigured), so case files are uniform; update snapshot/report tests that
  count rows on the runtime path.

### 4. Budget — `engine/repair-budget.ts`

Add `secondOpinionUsd: 0.30` to `RepairBudgetLimits` and
`DEFAULT_REPAIR_BUDGET_LIMITS` (lower-only like the rest), a
`reserveSecondOpinion(worstCaseUsd)` / `settleSecondOpinion` pair mirroring
`reserveModelTurn`/`settleModelTurn` but against its own counter, and
`BudgetExceededError('secondOpinionUsd')`. Config env
`SUTURA_SECOND_OPINION_USD` (optional, ≤ 0.30); Action input
`repair-second-opinion-usd` alongside the other `repair-*` inputs. Case file
`budget` evidence lists the new key.

### 5. Config and construction

- `config.ts`: `openaiApiKey?: string` via `optional(env, 'OPENAI_API_KEY')`,
  assigned only when present (`config.test.ts:32-34` pattern).
- `packages/action/src/input.ts:111`: `optional(environment, read, 'openai-api-key', 'OPENAI_API_KEY')`;
  `action.yml` and `packages/action/action.yml`: new input after
  `tavily-api-key` — `openai-api-key: { description: Optional OpenAI key for the GPT-6 Astra second-opinion audit, required: false }`.
- `packages/action/src/main.ts`: add `config.openaiApiKey ?? ''` to the
  recorder secrets (`:110-116`); construct
  `const secondOpinion = config.openaiApiKey ? new OpenAiClient({ apiKey, ledger: nebius.ledger }, recorder ? { fetch: recordingOpenAiFetch(recorder, globalThis.fetch) } : {}) : undefined;`
  and spread `...(secondOpinion ? { secondOpinion } : {})` into `orchestrate`.
- Thread `secondOpinion` through `orchestrate` → `heal` context
  (`RepairFailureContext`) → both `evaluateRuntimeCandidate` calls
  (`heal.ts:1192`, `:1511`) and `verification/external.ts:132`; the
  counterfactual path (`counterfactual/evaluate.ts:298`) omits it.
  `tracedLlm` wraps it too (tier `'ultra'` → stage `audit`).
- CLI: `packages/cli/src/heal.ts:459-496` `runtimeFromEnvironment` builds the
  same optional client; `setup.ts:11` `OPTIONAL_SECRET_NAMES` and the workflow
  template (`:49`, `:86`) list `OPENAI_API_KEY`; `doctor.ts:185-186` reports it
  as optional.
- Secret lists: `scripts/placebo-live.mjs:810,844`, `packages/case-lab/src/cli.ts:308`,
  `packages/case-lab/src/dispatcher.ts:21-24` (`FORBIDDEN_DISPATCHER_ENV`).
- Demo workflow `packages/case-lab/demo/case-lab.yml` Action step: add
  `openai-api-key: ${{ secrets.OPENAI_API_KEY }}` (the demo contract test's
  secrets regex is widened in Phase 1). The secret itself is set on
  `sutura-demo` and `sutura` in Phase 4 (`gh secret set` is classifier-blocked
  in this tool; Juan runs it with `!`).

### 6. Replay boundary `openai`

`replay/bundle.ts:63` `RecordedHttpBoundary` += `'openai'`;
`replay/validate.ts:19` `HTTP_BOUNDARIES` += `'openai'` (**not**
`REQUIRED_REPLAY_BOUNDARIES`); `record-fetch.ts`: `recordingOpenAiFetch`
cloned from `recordingTavilyFetch` (`:218-264`) with boundary `'openai'`;
`replay-fetch.ts:102-116`: an `openai` overload; `scripts/captured-fixtures.test.mjs`
`BOUNDARY_TESTS` += `['packages/core/src/llm/openai.test.ts', 'openai']` and
`PENDING_CAPTURE_IMPORTS` += that path until a captured bundle with an
`openai` exchange exists (Phase 4's benchmark produces them).

### 7. Key and fixture

- Create a project-scoped key named `sutura-second-opinion` in Juan's
  logged-in browser session (`https://platform.openai.com/api-keys`), with
  the `mcp__claude-in-chrome__*` tools; store it only in the local shell env
  for this phase's live test. Never commit it; the recorder redacts it.
- `packages/core/src/llm/openai.live.test.ts` gated on `SUTURA_LIVE=1`
  (pattern `nebius.live.test.ts:8-22`): one real adjudication of the
  provider-contract canary subject (`llm/provider-contract-canary.ts:19-44`),
  asserts `approved: true`, and writes the redacted response to
  `packages/core/src/llm/__fixtures__/openai-gpt-6-astra-adjudication.json`
  (`flag: 'wx'`). `openai.test.ts` replays that fixture through the client
  (fixture-backed guard, ci-parity rule).

### 8. Docs

README "Models" paragraph (Nemotron runtime; optional GPT-6 Astra second
opinion, veto-only, `OPENAI_API_KEY`), `packages/action/README.md` inputs,
`docs/evaluation/README.md` architecture note, CHANGELOG `[Unreleased]` Added.

## Tests

- `openai.test.ts`: request body has no `temperature`/`top_p`, has
  `reasoning_effort: 'low'` and `response_format`; usage → ledger entry
  `{ role: 'ultra', model: 'gpt-6-astra', usd }` at the Astra price; 429 with
  `retry-after` retried; 5xx retried; 4xx not; the captured fixture parses.
- `adjudicate.test.ts`: `secondOpinion` → `approved` / `refused` / `skipped`
  on transport error / `skipped` on `BudgetExceededError('secondOpinionUsd')`
  / `skipped` when llm undefined; never throws.
- `verification/runtime.test.ts` (or the existing gate tests): Nemotron
  approves + Astra refuses → gate `failed: audit-refused`, reasoning starts
  `REFUSED by second opinion`; Nemotron approves + Astra skipped → passed with
  the `skipped` row; Nemotron refuses → Astra still recorded, gate failed.
- `config.test.ts`, `packages/action/src/input.test.ts`, `main.test.ts`
  (secrets array, client constructed only with the key), `replay/validate.test.ts`
  (an `openai` exchange validates; a bundle without it is still complete),
  `replay-fetch.test.ts` overload.
- Report tests: the new row renders as `second-opinion | PASS | gpt-6-astra: skipped: …`.

## Verification

```bash
pnpm --filter @sutura/core test && pnpm --filter @sutura/action test && pnpm --filter sutura test
SUTURA_LIVE=1 OPENAI_API_KEY=… pnpm --filter @sutura/core exec vitest run src/llm/openai.live.test.ts   # once; writes the fixture
pnpm run build && git status --porcelain packages/action/dist
pnpm run ci:local
```

## Done when

All tests green with the captured fixture committed; `dist/index.cjs` rebuilt;
`ci:local` green; pushed. The phase report states the measured cost of the
live adjudication. STOP.
