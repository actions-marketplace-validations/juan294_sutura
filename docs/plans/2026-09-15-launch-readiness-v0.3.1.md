# Launch readiness: v0.3.1 with the Astra second opinion, working live demo, Product Hunt on 2026-09-18

Date: 2026-09-15 (Tuesday evening)

Status: Phases 1-3 done, merged to `develop` at `28c79b8` (2026-09-16). Phase
4 blocked: `main` tagged `v0.3.1` (`3fd99d8`) but npm publish deferred pending
Nebius/Nemotron provider drift (unrelated to this release) blocking the Case
Lab benchmark — see `docs/plans/2026-09-15-launch-readiness-v0.3.1-notes.md`.
**2026-09-17:** the tag was deleted and the cycle resumed
under `docs/plans/2026-09-17-typesafe-jev-calibrated-audit.md` Phase 4 (see the notes addendum);
v0.3.1 shipped and Phase 5 is done: the Product Hunt launch is scheduled for
2026-09-18 00:01 PT with the GPT-6 Astra Challenge opt-in
(`docs/launch/product-hunt-2026-09-18/listing.md`).

Owner: Juan

Integration branch: `develop` · Release branch: `main`

Hard deadline: Product Hunt GPT-6 Astra Challenge launch window
**2026-09-18 00:00–23:59 PT** (publishes 00:01 PT = 09:01 CEST Friday). The
launch must be scheduled before that from a draft; a "join the GPT-6 Astra
Challenge" prompt appears at scheduling (Juan's contest research, 2026-09-15).

Research basis (all VERIFIED 2026-09-15 unless marked): this conversation's
reads of `develop` at `aaddfa0`, the two gitignored reports
`docs/agents/astra-wiring-research-2026-09-15.md` and
`docs/agents/demo-delta-research-2026-09-15.md`, OpenAI's developer docs
(model guidance and pricing pages), and live `gh`/`vercel`/`curl` output.

## What is true today

| Area                               | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Evidence                                                                                                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Case Lab tracks the newest release | Done and enforced (`release:case-lab check` in pre-push + CI), bound to v0.3.0, deployed, caps 24 runs / USD 18                                                                                                                                                                                                                                                                                                                                                                                 | `docs/release/v0.3.0-case-lab-record.md`                                                                                                                                                     |
| Live runs on the Case Lab          | **Disabled** (Vercel env and `sutura-demo` repo variable both `false`)                                                                                                                                                                                                                                                                                                                                                                                                                          | `/api/health` → `enabled:false`; `gh variable list -R juan294/sutura-demo`                                                                                                                   |
| Live publish path                  | Broken at v0.3.0 (Action stamps its own commit; Case Lab compared against the demo commit). Fixed on `develop` (`a278812`), ships at v0.3.1                                                                                                                                                                                                                                                                                                                                                     | record, Incident 2                                                                                                                                                                           |
| Live repair on the demo            | **Every case has been unfixable since 2026-09-13.** `juan294/sutura-demo` `main` CI is red: PR #37 replaced `.github/workflows/sutura.yml` with the fleet-dogfood template, dropping the `case-lab/` and `matrix/` branch guards and the `packages/action@<sha>` pin; its contract tests still expect the old shape, and our Phase 5 publish added a fourth failure (`CASE_LAB_DAILY_RUN_CAP: '8'`). Four unrelated test failures make the whole suite red after any correct patch              | `gh run list -R juan294/sutura-demo --workflow ci.yml --branch main`: success through `5a213f5` (09-05), failure `e3f727a` (09-13) and `f8ea06f` (09-15); failed-test names in the 09-15 log |
| Sutura repair tool                 | Turns a large-but-valid test output into `gave-up`: `run_test` refuses when combined output > 16 000 bytes (`packages/core/src/engine/repair-tools.ts:25,375-379`) before recording `latestTest`; `repair-attempt.ts:668-669` then reports "did not produce valid evidence" and `heal.ts:1343-1357` discards the diff. In the 09-15 live run the model produced a **correct patch four times**; the injected test passed; the 30 004-byte output of the four unrelated failures tripped the cap | `docs/agents/demo-delta-research-2026-09-15.md` §A0; replay of the committed bundle                                                                                                          |
| Astra in the product               | **Not started.** The Nemotron runtime is the Nebius hard gate; "built with Astra" is contest-eligible but "runs Astra" is the better fit                                                                                                                                                                                                                                                                                                                                                        | plan 2026-09-15 conversation                                                                                                                                                                 |
| Product Hunt launch                | Nothing drafted or scheduled. Assets exist: eight 1536×1024 gallery PNGs (`docs/devpost/gallery-2026-09-13/`), the 1200×630 social card, three Case Lab screenshots, Devpost text and a 2:55 video script; **no video file exists**                                                                                                                                                                                                                                                             | report §B                                                                                                                                                                                    |

## Design decisions

1. **The demo repo must be green before the demo can fix anything.** Restore
   the branch guards to the demo's repair monitor, keep the new template
   otherwise, and make its contract tests read the workflow's own values
   (shape assertions) instead of literal pins, so `release:case-lab
publish-demo` can never turn its CI red again. `publish-demo` then refuses
   to report success until the demo's CI on the new commit is green.
2. **Bounded output is evidence, refusal is not.** `run_test` records the
   bounded tail plus an `outputTruncated` flag and lets the exit code decide;
   the audit gate re-runs the suite anyway. Guard fixture: the real 30 004-byte
   output from run 34977342282.
3. **Astra as a veto-only second opinion, never a gate on availability.**
   OpenAI Chat Completions (Astra supports it; Responses is required only for
   tool calling — OpenAI model guidance, read 2026-09-15), model `gpt-6-astra`,
   `reasoning_effort: 'low'`, no `temperature`/`top_p`, `response_format:
json_object`, same `ADVERSARIAL_AUDIT_PROMPT`. `approved = nemotron.approved
&& astra.status !== 'refused'`; transport, parse or budget failures record
   `skipped`, never `refused`. Charged as `role: 'ultra'`, `model:
'gpt-6-astra'` at USD 10 / 50 per 1M (OpenAI pricing page, 2026-09-15)
   against a **separate** `secondOpinionUsd` budget (default 0.30), because
   `inferenceCostUsd` is lower-only bounded at 0.25 and one Astra adjudication
   worst-cases at ≈ USD 0.23. Recorded as an optional `openai` replay boundary
   like `tavily`. The Nebius gates are untouched (at least one NVIDIA model,
   not exclusivity: `docs/research/2026-08-26-nebius-hackathon-fit.md:30-32`).
4. **One release cycle carries everything: v0.3.1**, then `### 8a` from
   `docs/release/e2e-pro-playbook.md` (benchmark cap USD 10 because Astra adds
   ≈ USD 0.04 per adjudication), re-enable live runs, and a smoke run that
   publishes a `fixed` `javascript-repair`.
5. **Product Hunt content is honest by construction**: Nemotron runtime + GPT-6
   Astra second opinion; 24 live runs per day; deterministic replays always
   available; the 2026-09-15 evidence numbers, nothing projected.

## Phases

| #   | Phase                                                                                           | File                                                            | Paid / outward                                                            | Batch                                                              |
| --- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Demo repository green: guards back, shape-based contract tests, `publish-demo` verifies demo CI | [phase-1](2026-09-15-launch-readiness-v0.3.1-phases/phase-1.md) | pushes to `sutura-demo` (authorized by this plan)                         | `[batch-eligible]` with 2 and 3                                    |
| 2   | Bounded test output is evidence (`run_test` cap)                                                | [phase-2](2026-09-15-launch-readiness-v0.3.1-phases/phase-2.md) | no                                                                        | `[batch-eligible]` with 1 and 3                                    |
| 3   | GPT-6 Astra second-opinion auditor                                                              | [phase-3](2026-09-15-launch-readiness-v0.3.1-phases/phase-3.md) | one live call to capture the fixture (cents); key creation in the browser | `[batch-eligible]` with 1 and 2                                    |
| 4   | Release v0.3.1 and the `### 8a` cycle: benchmark, bump, publish, deploy, re-enable, smoke       | [phase-4](2026-09-15-launch-readiness-v0.3.1-phases/phase-4.md) | **yes: cap USD 10, ~3 h, push freeze; npm publish; deploy**               | after 1, 2, 3                                                      |
| 5   | Product Hunt launch: assets, copy, draft, schedule for 2026-09-18                               | [phase-5](2026-09-15-launch-readiness-v0.3.1-phases/phase-5.md) | outward (scheduling needs Juan's go)                                      | asset and copy work can start with 1–3; scheduling after 4's smoke |

File overlap check for the batch: Phase 1 touches `juan294/sutura-demo` and
`scripts/release-case-lab.mjs` (+ test); Phase 2 touches
`packages/core/src/engine/repair-tools.ts`, `repair-attempt.ts`, their tests, a
new engine fixture, and `packages/action/dist/index.cjs`; Phase 3 touches
`packages/core/src/llm/openai.ts` (new), `audit/adjudicate.ts`,
`verification/runtime.ts`, `domain.ts`, `config.ts`, `engine/repair-budget.ts`,
`replay/{bundle,validate,replay-fetch,record-fetch}.ts`, `packages/action/src/{input,main}.ts`,
both `action.yml`, `packages/cli/src/{heal,setup,doctor}.ts`, docs, and
`packages/action/dist/index.cjs`. **Phases 2 and 3 both rebuild
`packages/action/dist/index.cjs`**: whichever merges second rebuilds it on the
merged tree before pushing (`pnpm run build && git diff --stat packages/action/dist`).
Everything else is disjoint.

## Schedule (Europe/Madrid)

- **Wed 09-16:** Phases 1, 2, 3 in parallel worktrees (`/batch`), each with
  `ci:fast`; Phase 3 needs Juan's OpenAI key (browser session at
  `platform.openai.com/api-keys` is logged in) and one live capture. Evening:
  merge all three, `ci:local` on the merged tree, push. Phase 5 asset prep
  (resized gallery, thumbnail, copy draft) in parallel — no code dependency.
- **Thu 09-17 morning:** Phase 4 — release PR `develop → main`, tag, publish,
  canaries, benchmark (≈ 3 h of wall clock: use it for Phase 5 copy), bump,
  publish-demo, deploy, re-enable, smoke.
- **Thu 09-17 afternoon:** Phase 5 — draft on Product Hunt from the prepared
  assets, join the challenge, schedule for 09-18 00:01 PT, maker comment.
- **Fri 09-18 09:01 CEST:** live. Watch the Case Lab daily cap.

Time-box: if Phase 3 is not green by Wednesday 22:00, v0.3.1 ships with
Phases 1, 2 and the publish fix only, and the launch story stays "built with
Astra" (eligible per Product Hunt staff replies in Juan's research).

## Success criteria (whole plan)

Automated:

- `juan294/sutura-demo` `main` CI green; `gh run list -R juan294/sutura-demo --workflow ci.yml --branch main -L 1` → success.
- `pnpm run ci:local` green on the merged tree after Phases 1–3; `guards:verify` still 100 %.
- Replay of the committed bundle `packages/case-lab/src/__fixtures__/live-34977342282-javascript-repair-gave-up.json` still reproduces `gave-up` (it is recorded evidence; the fix changes behaviour of _new_ runs only, and the named test stays green because the recorded tool result is replayed, not recomputed — verify this explicitly in Phase 2; if the replay diverges, the fixture's test asserts the new mismatch message and the phase report explains why).
- `curl https://sutura-case-lab.vercel.app/api/health` → `enabled:true`, `release.version 0.3.1`.
- One live `javascript-repair` run from the public site publishes a result page with `outcome: fixed` and, when `OPENAI_API_KEY` is set on `sutura-demo`, a `second-opinion` check row in the case file.
- `docs/demo/placebo-v0.3.1-live-2026-09-17.json` bound to the v0.3.1 tag commit, 51/51, zero false approvals, and at least one `cost.entries[].model === 'gpt-6-astra'`.

Manual (Juan):

- Product Hunt launch scheduled for 2026-09-18 with the challenge joined; the Maker comment states the runtime split and the live-run cap.

## Out of scope

- Raising `inferenceCostUsd` above 0.25 or changing the Nemotron routing.
- Astra anywhere except the adjudication gate.
- A recorded product video (no file exists; the script is at
  `docs/devpost/sutura-video-script.md`). Phase 5 offers a 60–90 s screen
  capture of the Case Lab as an optional manual step.
