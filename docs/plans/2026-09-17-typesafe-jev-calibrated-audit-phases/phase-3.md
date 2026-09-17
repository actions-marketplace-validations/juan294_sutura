# Phase 3: Gate wiring, construction, trace, docs, dist

Plan: [2026-09-17-typesafe-jev-calibrated-audit.md](../2026-09-17-typesafe-jev-calibrated-audit.md)

Status: not started. Depends on Phases 1 and 2 merged.

## Goal

The adjudication gate asks Jev after Nemotron and Astra, records a
`typesafe-audit` row with its probabilities and confidence on every run, and
can only veto. The Action, the CLI, and `sutura audit` construct the client
only when `TYPESAFE_API_KEY` is present. Every secret list, doc, and the
committed `dist` are updated.

## Facts (VERIFIED 2026-09-17)

- Gate: `verification/runtime.ts:84-93`; "not run" rows `:75-76`; input type `:18-34`.
- CLI audit path: `audit-only.ts:37-38,155-175`.
- Context threading: `heal.ts:133` (context type), `:845` (traced wrapper),
  `:1206` and `:1526` (both `evaluateRuntimeCandidate` calls);
  `orchestrate.ts:213,726`; `verification/external.ts:28,136`;
  counterfactual (`counterfactual/evaluate.ts:298`) omits the second opinion and omits Jev too.
- Trace wrapper: `tracedTierLlm` (`heal.ts:279-327`) and `tracedAuditLlm` (`:329-331`).
- Construction: `packages/action/src/main.ts:109-139` (recorder secrets, client with recording fetch),
  `packages/action/src/verify-execution.ts:65`, `packages/cli/src/heal.ts:486-488,544-546`.
- CLI setup and doctor: `setup.ts:9-13,49-51,88-89`, `doctor.ts:185-190`.
- Secret lists: `scripts/placebo-live.mjs:810,844`, `packages/case-lab/src/cli.ts:308`,
  `packages/case-lab/src/dispatcher.ts:20-28` (+ `dispatcher.test.ts:77`),
  `packages/case-lab/demo/case-lab.yml:190,245`.
- Check union and tests: `domain.ts:75-87`, `domain.test.ts:80`,
  `report/report.test.ts:58`, `report/audit-report.test.ts:31-62`,
  `verification/runtime.test.ts:44-75`.
- Docs: `README.md:76-84` (runtime roles), `:229-230`, `:420` (env lists),
  `docs/evaluation/README.md:66`, `CHANGELOG.md` `[0.3.1]`, `CLAUDE.md` Stack.
- Committed dist rule: `.claude/rules/ci-parity.md` (rebuild `packages/action/dist/index.cjs` in the same commit).

## Changes

### 1. Check name — `domain.ts`

`GreenwashCheck` += `'typesafe-audit'`; `domain.test.ts:80` union listing and
`report/report.test.ts:58` name list += the same.

### 2. Gate — `verification/runtime.ts`

```ts
// RuntimeCandidateInput
/** Optional veto-only TypeSafe Jev calibrated audit. Absent when TYPESAFE_API_KEY is unconfigured. */
typesafeAudit?: TypeSafeAuditClient;
typesafeAuditBudget?: TypeSafeAuditBudget;

// case 'audit', when the fresh rerun fails (:75-76), add:
verdict.checks.push({ name: 'typesafe-audit', passed: false, evidence: 'Not run: the fresh suite rerun failed' });

// case 'adjudication'
const result = await adjudicate(input.llm, adjudicationContext);
const second = await secondOpinion(input.secondOpinion, adjudicationContext, input.secondOpinionBudget);
const third = await typesafeAudit(input.typesafeAudit, adjudicationContext, input.typesafeAuditBudget);
const approved = result.approved && second.status !== 'refused' && third.status !== 'refused';
verdict.checks.push({ name: 'llm-adjudication', ... });
verdict.checks.push({ name: 'second-opinion', ... });
verdict.checks.push({ name: 'typesafe-audit', passed: third.status !== 'refused', evidence: typesafeAuditEvidence(third) });
verdict.reasoning = approved ? result.reasoning
  : result.approved && second.status === 'refused' ? `REFUSED by second opinion (${second.model}): ${second.reasoning}`
  : result.approved && third.status === 'refused' ? `REFUSED by calibrated audit (${third.model}): ${third.reasoning}`
  : result.reasoning;
return { ..., artifacts: artifact('adjudication', { nemotron: result, secondOpinion: second, typesafeAudit: third }) };
```

`typesafeAuditEvidence(r)` (in `audit/typesafe-audit.ts`, exported) renders
`${model}: ${status}: ${reasoning}` where `reasoning` for a non-skipped result
is `P(green-wash)=0.97 confidence=0.94; touches-only-tests=0.01 weakens-assertion=0.98 suppresses-error=0.03 unrelated-change=0.02`
(two decimals). The row is pushed **always**, `skipped` when unconfigured, so
case files stay uniform (same rule as the Astra row).

Mirror in `audit-only.ts:155-175`: `const third = await typesafeAudit(context.typesafeAudit, adjudicationContext, context.typesafeAuditBudget)`,
the row after `second-opinion`, and `approved` AND-ed the same way. Context
type (`:37-38`) gains the two optional fields.

### 3. Threading — `heal.ts`, `orchestrate.ts`, `verification/external.ts`

- `heal.ts:133`: `typesafeAudit?: TypeSafeAuditClient`.
- `heal.ts:845`: `...(ctx.typesafeAudit === undefined ? {} : { typesafeAudit: tracedTypeSafeAudit(ctx.typesafeAudit, trace) })`.
- `heal.ts:1206` and `:1526`: `...(fullContext.typesafeAudit === undefined ? {} : { typesafeAudit: fullContext.typesafeAudit, typesafeAuditBudget: budget })`.
- `orchestrate.ts:213` field and `:726` spread.
- `verification/external.ts:28` field and `:136` spread (external verification gets the row too; its `challengeMode: 'required'` is untouched).

### 4. Trace — `heal.ts` next to `tracedAuditLlm`

```ts
export function tracedTypeSafeAudit(
  client: TypeSafeAuditClient,
  trace: TraceRecorder,
): TypeSafeAuditClient {
  return {
    modelId: () => client.modelId(),
    async decide(state, questions, options) {
      const serialized = JSON.stringify({ state, questions });
      trace.record({
        type: "model-request",
        stage: "audit",
        role: "user",
        model: client.modelId(),
        summary: `Calibrated audit request with ${Object.keys(questions).length} questions and ${Buffer.byteLength(serialized, "utf8")} bytes`,
        promptHash: sha256(serialized),
        promptExcerpt: String(questions.verdict?.instructions ?? "").slice(
          0,
          160,
        ),
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        latencyMs: 0,
        costUsd: 0,
        requestId: null,
      });
      const decision = await client.decide(state, questions, options);
      trace.record({
        type: "model-response",
        stage: "audit",
        role: "assistant",
        model: decision.model,
        summary: JSON.stringify(decision.answers), // probabilities and confidence, nothing else
        inputTokens: decision.usage.inTok,
        outputTokens: decision.usage.outTok,
        reasoningTokens: 0,
        latencyMs: decision.latencyMs,
        costUsd: decision.usd,
        requestId: decision.requestId,
      });
      return decision;
    },
  };
}
```

No new trace event type; `sutura-trace-v1` unchanged.

### 5. Construction

- `packages/action/src/main.ts`: recorder secrets (`:109-116`) += `config.typesafeApiKey ?? ''`;
  after the Astra client:
  `const typesafeAudit = config.typesafeApiKey ? new TypeSafeClient({ apiKey: config.typesafeApiKey, ledger: nebius.ledger }, recorder ? { fetch: recordingTypeSafeFetch(recorder, globalThis.fetch as ...) } : {}) : undefined;`
  and `...(typesafeAudit ? { typesafeAudit } : {})` into `orchestrate`.
- `packages/action/src/verify-execution.ts:65` sibling without the recorder.
- `packages/cli/src/heal.ts:486-488` and `:544-546` siblings; the returned
  runtime objects spread `...(typesafeAudit ? { typesafeAudit } : {})`;
  `auditWithRuntime` passes it through (`:520-524` pattern).
- `packages/core/src/index.ts`: export `recordingTypeSafeFetch` next to
  `recordingOpenAiFetch` (`:269`).

`main.test.ts`: secrets array contains the key when configured; the client is
constructed only with the key (mirror the Astra assertions).

### 6. CLI setup, doctor, secret lists

- `setup.ts:13`: `ALWAYS_OPTIONAL_SECRET_NAMES = ['OPENAI_API_KEY', 'TYPESAFE_API_KEY']`;
  workflow template (`:88-89`) += `          typesafe-api-key: \${{ secrets.TYPESAFE_API_KEY }}`; `setup.test.ts` asserts the new line only if it already asserts the `openai-api-key` line (it does not today, so no snapshot change is expected).
- `doctor.ts:188-190` sibling: `Optional GitHub secret TYPESAFE_API_KEY is configured.`
- `scripts/placebo-live.mjs:810,844`: `process.env.TYPESAFE_API_KEY` in both arrays.
- `packages/case-lab/src/cli.ts:308`: `env.TYPESAFE_API_KEY`.
- `packages/case-lab/src/dispatcher.ts:20-28` `FORBIDDEN_DISPATCHER_ENV` += `'TYPESAFE_API_KEY'`; `dispatcher.test.ts:77` list.
- `packages/case-lab/demo/case-lab.yml:190` (Action `with:`) += `typesafe-api-key: ${{ secrets.TYPESAFE_API_KEY }}`;
  `:245` (publish step `env:`) += `TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}`.
  The demo repository's contract tests are shape-based since v0.3.1 Phase 1;
  Phase 4's `publish-demo` verifies demo CI stays green, which is the check
  that this addition did not break the demo's own tests.

### 7. Docs

- `README.md:76-84` runtime roles table: new row
  `| TypeSafe Jev (optional calibrated audit) | A System One decision model answers the same adversarial question as a typed choice with calibrated probabilities when \`TYPESAFE_API_KEY\` is configured. It can only reject a Nemotron approval (P(green-wash) ≥ 0.5 at confidence ≥ 0.7), never approve one; uncertain, absent, failed, or over its own USD 0.02 budget, it is recorded and the run proceeds on the other gates. Thresholds measured on 88 labeled Placebo diffs on 2026-09-17. |`Env lists at`:229-230`and`:420`: `optional TAVILY_API_KEY, OPENAI_API_KEY, and TYPESAFE_API_KEY`.
- `docs/evaluation/README.md:66` sibling row pointing at `TypeSafeClient` and `typesafeAudit`.
- `CHANGELOG.md`: add to the existing `## [0.3.1] - 2026-09-17` Added list
  (0.3.1 is unreleased; the section already exists): the paragraph above in one
  sentence plus the budget input. `[Unreleased]` stays empty.
- `CLAUDE.md` Stack: `- Optional veto-only audit voices: GPT-6 Astra (OPENAI_API_KEY), TypeSafe Jev (TYPESAFE_API_KEY)`.
- `docs/decisions/2026-09-17-calibrated-audit-veto.md` (ADR, format of
  `2026-09-08-verification-execution-identity.md`): why a third voice, why
  veto-only, the two thresholds and their measured basis, why `uncertain` does
  not block, why routing does not consume the confidence yet.

### 8. Dist

`pnpm run build` → `packages/action/dist/index.cjs` rebuilt and committed in
the same commit as the wiring.

## Tests

- `verification/runtime.test.ts` (extend the helper at `:30-42` to accept `typesafeAudit`):
  1. Nemotron and Astra approve, Jev returns `{ verdict: { choice: 'green_wash', probabilities: { green_wash: 0.97, legitimate_repair: 0.03 }, confidence: 0.94 }, ...nouls }` → `verification.status === 'failed'`, reasoning `^REFUSED by calibrated audit`, row `passed: false` with evidence containing `P(green-wash)=0.97`.
  2. Jev uncertain (`confidence: 0.63`, `green_wash: 0.81`) → `passed`, row `passed: true`, evidence contains `uncertain` and `confidence=0.63`.
  3. No Jev configured → `passed`, row `skipped`, evidence names `TYPESAFE_API_KEY`.
  4. Jev refuses but Nemotron already refused → gate failed, reasoning is Nemotron's, Jev row still recorded.
  5. Fresh rerun fails → `typesafe-audit` "Not run" row present.
- `audit-report.test.ts:31-62`: expected rows += `| typesafe-audit | PASS | jev-latest: skipped: Not configured: TYPESAFE\_API\_KEY absent |`.
- `heal.test.ts` or `trace/recorder.test.ts`: `tracedTypeSafeAudit` records one `model-request` and one `model-response` with `stage: 'audit'`, `model: 'jev-latest'`, `costUsd` and `latencyMs` from the decision.
- `packages/action/src/main.test.ts`, `packages/cli/src/setup.test.ts`, `doctor.test.ts`, `packages/case-lab/src/dispatcher.test.ts` updated as listed.

## Verification

```bash
pnpm --filter @sutura/core test && pnpm --filter @sutura/action test && pnpm --filter sutura test && pnpm --filter @sutura/case-lab test
pnpm run build && git status --porcelain packages/action/dist
pnpm run ci:local
```

## Done when

`ci:local` green; `dist/index.cjs` rebuilt and committed with the wiring;
pushed to `develop` with the CI-monitor agent spawned per
`.claude/rules/push-accountability.md`. The phase report lists every file
touched against §"File overlap check" in the plan. STOP.
