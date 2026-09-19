# TypeSafe Jev as a veto-only calibrated audit voice, shipping in v0.3.1 for Product Hunt

Date: 2026-09-17 (Thursday, early morning CEST)

Status: Complete 2026-09-17. v0.3.1 released (npm, GitHub), Case Lab bound and deployed with live runs enabled, smoke run published with the calibrated-audit row. Deviations in `2026-09-17-typesafe-jev-calibrated-audit-notes.md`; record in `docs/release/v0.3.1-case-lab-record.md`.

Owner: Juan

Integration branch: `develop` · Release branch: `main`

Hard deadline: Product Hunt launch window **2026-09-18 00:00–23:59 PT**
(00:01 PT = 09:01 CEST Friday). The launch must be scheduled from a draft
before that (see `docs/plans/2026-09-15-launch-readiness-v0.3.1-phases/phase-5.md`).

Research basis (VERIFIED 2026-09-17 unless marked):
`docs/research/2026-09-17-typesafe-jev-fit.md` (sections 4, 5, 6 B, 8), the
probe and its results in `docs/research/2026-09-17-typesafe-jev-probe/`, this
conversation's reads of `develop` at `3397eac`, and the Astra second-opinion
phase `docs/plans/2026-09-15-launch-readiness-v0.3.1-phases/phase-3.md`, which
this plan mirrors file for file.

## What is true today

| Area                                       | State                                                                                                                                                                                                                                                | Evidence                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Release identity                           | `v0.3.1` is tagged and pushed on `main` at `3fd99d8` but never published (npm and GitHub release deferred); `develop` is four commits ahead, including the Nemotron `json_object` fix `3397eac`                                                      | `git tag`, `docs/plans/2026-09-15-launch-readiness-v0.3.1-notes.md` Part B |
| Decision (Juan, 2026-09-17)                | **The launch release is v0.3.1**, cut fresh from `develop`; no version bump; the earlier v0.3.2 choice rested on the stale tag claim and is withdrawn                                                                                                | this plan's clarification                                                  |
| Adjudication gate                          | Nemotron Ultra `adjudicate` then GPT-6 Astra `secondOpinion`; `approved = nemotron.approved && astra.status !== 'refused'`; both rows pushed always                                                                                                  | `packages/core/src/verification/runtime.ts:84-93`                          |
| Confidence on that gate                    | None. Both voices return a boolean plus prose                                                                                                                                                                                                        | `packages/core/src/audit/adjudicate.ts:26-29,170-174`                      |
| Jev on Sutura's own labels                 | 88 Placebo diffs: 95.5% accuracy; with the policy below, 28/31 traps refused, 2 uncertain, 1 approved; 51/57 repairs approved, 6 uncertain, 0 refused; p50 347 ms; USD 0.0037 total                                                                  | `docs/research/2026-09-17-typesafe-jev-fit.md` §8, results JSON            |
| Key                                        | `sutura-research` created in the TypeSafe console (org The Creative Token); stored only as `TYPESAFE_API_KEY` in the gitignored `.env`                                                                                                               | memory `typesafe-jev-research`                                             |
| Replay boundaries                          | `nebius`, `tavily`, `contree`, `openai`; `openai` is optional (not in `REQUIRED_REPLAY_BOUNDARIES`)                                                                                                                                                  | `packages/core/src/replay/bundle.ts:63`, `validate.ts:19-21`               |
| Captured-fixture manifest boundaries       | `github`, `nebius`, `tavily`, `contree`, `repository`, `executor` (no `openai`)                                                                                                                                                                      | `packages/core/src/replay/manifest.ts:3-4,40`                              |
| Cost ledger                                | `Ledger.add(role, model, usage, routedPrice)`; `CostLedger.entries[].role` is one of `nano`, `super`, `ultra`; renderers key by role and print the model                                                                                             | `packages/core/src/llm/cost.ts:67-84`, `domain.ts:96-106`                  |
| Case file check rows                       | `GreenwashCheck` closed union in `domain.ts:75-87`; Case Lab validates `name` as text ≤ 64, so a new name renders without renderer changes                                                                                                           | `packages/case-lab/src/result.ts:347-350`, `render.ts:294`                 |
| Product Hunt                               | Phase 5 of the v0.3.1 plan not started; assets exist, no draft                                                                                                                                                                                       | that plan's status line                                                    |
| Existing doc drift the Astra addition left | `packages/case-lab/README.md:97-98` omits `OPENAI_API_KEY` from the refusal list the code enforces; `CLAUDE.md:26`, `docs/user-guide.md`, and `docs/security/provider-processing.md` never mention Astra; `packages/action/README.md` does not exist | release-path sweep, 2026-09-17                                             |
| Benchmark manifest validator               | `positiveAmount` refuses a zero output price, which is Jev's real price                                                                                                                                                                              | `scripts/verified-program-evidence.mjs:57-62,90`                           |

## Design decisions

1. **Jev is a third voice with the same veto-only contract as Astra.**
   `approved = nemotron.approved && astra.status !== 'refused' && jev.status !== 'refused'`.
   Absent key, transport error, malformed response, over budget, or over the
   provider's request budget all record `skipped`. Jev can never approve on its
   own and never widens acceptance. Nemotron stays the runtime model (Nebius
   hard gate).
2. **Policy, frozen from the probe.** Jev answers one Choice
   (`legitimate_repair` vs `green_wash`) and four Nouls (touches only tests,
   weakens an assertion, suppresses an error, changes an unrelated file).
   `confidence < 0.70` → `uncertain` (recorded with its numbers, **not**
   blocking: the other gates decide); else `P(green_wash) ≥ 0.50` → `refused`;
   else `approved`. Constants live in code with a provenance comment pointing
   at `docs/research/2026-09-17-typesafe-jev-fit.md` §8. Changing them
   requires a new measured record, like model prices.
3. **Same context as the other two voices.** The bounded, redacted
   adjudication context (`diagnosis`, `candidateDiff`, `beforeLog`,
   `afterLog`, `challengeEvidence`) becomes Jev's `state` object. Its 64,000
   character cap (≈ 16k tokens) sits under Jev's 32k request budget. Redaction
   happens before the call via `redactExternalJsonValue`, as today.
4. **Charged as `role: 'ultra'`, `model: 'jev-latest'`** at USD 0.042 input /
   0 output per 1M (typesafe.ai pricing, 2026-09-17) into the same `Ledger`,
   against a separate `typesafeAuditUsd` budget (default USD 0.02, lower-only
   bounded; one call worst-cases at 32,000 × 0.042 / 1M = USD 0.0013). No
   renderer changes: the cost table keys by role and prints the model.
5. **Recorded as an optional `typesafe` replay boundary** like `openai`.
   Fixtures are captured from real responses (one approval on the
   provider-contract canary subject, one refusal on the Placebo
   `trap-swallowed-error` fake fix) and replayed through the client in unit
   tests. The captured-fixture manifest gains `typesafe` **and** the missing
   `openai`, because a workflow capture with either exchange would otherwise
   fail manifest validation.
6. **Traced without a new event type.** A `tracedTypeSafeAudit` wrapper in
   `heal.ts` records the existing `model-request` / `model-response` events
   (stage `audit`, model `jev-latest`, response summary = the answers with
   probabilities and confidence, cost and latency from the client).
7. **Evidence carries the numbers.** The check row reads
   `jev-latest: refused: P(green-wash)=0.97 confidence=0.94; weakens-assertion=0.98 …`
   so the PR comment's Pathology table, the Case Lab result, and the case file
   all show the calibrated values, not just pass/fail.
8. **One release cycle carries everything: v0.3.1**, resuming phase 4 of the
   v0.3.1 plan from a fresh `develop → main` squash (the existing un-tagged
   squash on `main` is superseded, not reused). No version bump: literals,
   CHANGELOG section, evidence-requirements file, and Placebo paths already
   say 0.3.1. The Case Lab bump, live re-enable, and a smoke run with a
   `typesafe-audit` row are the release's definition of done. Launch copy says
   "Nemotron runtime, GPT-6 Astra second opinion, TypeSafe Jev calibrated
   veto, v0.3.1".

## Phases

| #   | Phase                                                                           | File                                                                  | Paid / outward                                                       | Batch                     |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------- |
| 1   | TypeSafe client, decision function, captured fixtures                           | [phase-1](2026-09-17-typesafe-jev-calibrated-audit-phases/phase-1.md) | two live calls (well under one cent)                                 | `[batch-eligible]` with 2 |
| 2   | Replay boundary, budget, config, Action inputs                                  | [phase-2](2026-09-17-typesafe-jev-calibrated-audit-phases/phase-2.md) | no                                                                   | `[batch-eligible]` with 1 |
| 3   | Gate wiring, construction, trace, docs, dist                                    | [phase-3](2026-09-17-typesafe-jev-calibrated-audit-phases/phase-3.md) | no                                                                   | after 1 and 2             |
| 4   | Release v0.3.1: squash, tag, publish, benchmark, bump, deploy, re-enable, smoke | [phase-4](2026-09-17-typesafe-jev-calibrated-audit-phases/phase-4.md) | **yes: cap USD 10, ~3 h, push freeze; npm publish; deploy; secrets** | after 3                   |

File overlap check for the batch: Phase 1 creates
`packages/core/src/llm/typesafe.ts`, `typesafe.test.ts`, `typesafe.live.test.ts`,
`__fixtures__/typesafe-jev-audit-*.json`, `packages/core/src/audit/typesafe-audit.ts`,
`typesafe-audit.test.ts`, and edits `audit/adjudicate.ts` (export the bounded
context builder) and `packages/core/src/index.ts`. Phase 2 edits
`replay/bundle.ts`, `replay/validate.ts` (+test), `replay/record-fetch.ts`,
`replay/replay-fetch.ts` (+test), `replay/manifest.ts` (+test),
`scripts/captured-fixtures.test.mjs`, `engine/repair-budget.ts` (+test),
`config.ts` (+test), `packages/action/src/input.ts` (+test),
`packages/action/action.yml`, root `action.yml`,
`scripts/verified-program-evidence.mjs` (+test). No shared file; Phase 2 does **not** touch
`index.ts` (Phase 3 adds the `recordingTypeSafeFetch` export). Phase 3 owns
`domain.ts`, `verification/runtime.ts`, `audit-only.ts`, `heal.ts`,
`orchestrate.ts`, `verification/external.ts`, `packages/action/src/main.ts`,
`verify-execution.ts`, `packages/cli/src/heal.ts`, `setup.ts`, `doctor.ts`,
Case Lab secret lists, the demo workflow, docs, `replay/replay-orchestrate.ts`
(replay must reconstruct the optional `openai` and `typesafe` clients, a latent
v0.3.1 gap), `packages/action/src/evidence.ts`, and `packages/action/dist/index.cjs`.

## Schedule (Europe/Madrid, 2026-09-17)

- **Morning:** Phases 1 and 2 in parallel worktrees (`/batch`), each with
  `ci:fast`. Phase 1's live capture uses `TYPESAFE_API_KEY` from `.env`.
- **Midday:** Phase 3 on the merged tree; `pnpm run ci:local`; push.
- **Afternoon:** Phase 4 Part A (release PR, tag, publish) then Part B
  (canaries, benchmark ≈ 3 h, bump, deploy, re-enable, smoke). Product Hunt
  copy and draft (existing phase 5) run during the benchmark wait.
- **Evening:** schedule the launch from the draft once the smoke result shows
  `release.version 0.3.1` and a `typesafe-audit` row.

Time-box: if Phase 3 is not green by 14:00 CEST, v0.3.1 ships without Jev
(Phases 1 and 2 are inert without Phase 3's wiring) and the launch story stays
Nemotron plus Astra. Jev then lands in v0.3.2 after the launch (unchanged: the next patch version).

## Success criteria (whole plan)

Automated:

- `pnpm run ci:local` green on the merged tree; `guards:verify` unchanged.
- `packages/core/src/llm/typesafe.test.ts` replays both captured fixtures and
  asserts the ledger entry `{ role: 'ultra', model: 'jev-latest' }` at the Jev
  price; `audit/typesafe-audit.test.ts` covers approved / refused / uncertain /
  skipped (unconfigured, transport, malformed, budget) and never throws.
- `verification/runtime.test.ts`: Nemotron and Astra approve, Jev refuses →
  gate `failed: audit-refused`, reasoning starts `REFUSED by calibrated audit`;
  Jev uncertain → gate passes with the row's numbers; Jev skipped → passes.
- `gh release view v0.3.1`, `npm view sutura@0.3.1 version`, health shows
  `0.3.1` and `enabled:true`, the smoke result JSON has `mode: live`,
  `outcome: fixed`, and a `typesafe-audit` row in `caseFile.audit.checks`.
- `docs/demo/placebo-v0.3.1-live-2026-09-17.json` records ≥ 1 `jev-latest`
  entry and zero false approvals.

Manual: Juan gives the authorizations at Phase 4 steps A5, B4, B7, sets the
`TYPESAFE_API_KEY` repository secrets (classifier-blocked here), and
schedules the Product Hunt launch.

## Out of scope

- Using Jev's confidence for model routing (`routing-policy.ts` thresholds
  are frozen until held-out measurement; see research §6 C).
- Tavily citation relevance scoring (research §6 D).
- Replacing any deterministic check (mechanical, patch vetting, flake triage).
- Product Hunt assets and copy beyond the one-line story change; the existing
  phase 5 owns the launch.
