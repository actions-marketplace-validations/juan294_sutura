# Phase 4: Release v0.3.1 and the `### 8a` cycle

Plan: [2026-09-15-launch-readiness-v0.3.1.md](../2026-09-15-launch-readiness-v0.3.1.md)

Status: not started. Requires Phases 1–3 merged on `develop` with green CI.
Paid and outward-facing: npm publish, ~USD 10 cap benchmark, demo publish,
Vercel deploy, re-enabling live runs. Each authorization is requested in this
phase's conversation at the marked steps.

## Goal

`v0.3.1` tagged on `main` and published; the Case Lab bound to it with fresh
benchmark evidence; live runs enabled; one public live `javascript-repair`
run publishes a `fixed` result with a `second-opinion` row.

## Part A — release v0.3.1 (template: the v0.3.0 release PR #143)

1. Version literals → `0.3.1` (all seven `package.json`, `packages/core/src/index.ts:277 VERSION`,
   `scripts/install-test-lib.mjs:10 RELEASE_VERSION`, `scripts/release-workflow.test.mjs:11-21`,
   `scripts/adoption-study.test.mjs` literals, README install examples
   `npx sutura@0.3.1 …` and `--release 0.3.1`).
2. Placebo controller state paths: `scripts/placebo-live.mjs:30-32` and `:918`
   (`placebo-v0.3.0-live-*` → `v0.3.1`), `.gitignore:18-22` (add the v0.3.1
   entries, keep v0.3.0), `scripts/placebo-live.test.mjs:34` gitignore test.
3. `docs/demo/sutura-v0.3.1-release-evidence-requirements.json` cloned from the
   v0.3.0 file with `releaseVersion: '0.3.1'`; `scripts/release-workflow.test.mjs:114-115`
   points at it.
4. `CHANGELOG.md`: `## [Unreleased]` → `## [0.3.1] - 2026-09-17` (Added: Astra
   second opinion, Case Lab release tracking, live-run cap; Fixed: replay
   bundle identity, replay determinism, bounded test output, deploy link,
   demo guards).
5. `pnpm run ci:local`; PR `develop → main` titled `release: v0.3.1`; squash
   merge (as #143 was); wait for `ci.yml` on `main`; annotated tag `v0.3.1` on
   the squash commit; GitHub release from the tag with the CHANGELOG section as
   body → `publish.yml` publishes `sutura@0.3.1` to npm (verifies tag ==
   version, `origin/main`, exact-head CI, bundle freshness). **Authorization:
   tag + release.**
6. `develop`: reconcile after the squash (as `79d510c` did), then note that
   `release:case-lab check` now **refuses every push** until Part B lands.

## Part B — `### 8a. Case Lab follows the release`

Secrets first (Juan runs; classifier-blocked here):
`! gh secret set OPENAI_API_KEY -R juan294/sutura -b "$OPENAI_API_KEY"` and the same
for `-R juan294/sutura-demo`. Confirm presence only (`gh secret list`).

1. Canaries at the tag: `gh workflow run provider-contract-canary.yml --ref v0.3.1`; watch to success.
2. Manifest `docs/demo/run-manifests/release-v0.3.1-benchmark.json` (+ `-config.json`)
   from the v0.3.0 pair: `candidateCommit` = tag commit, `inferenceUsd: 10`,
   `models` += `{ modelId: 'gpt-6-astra', inputPerMillionUsd: 10, outputPerMillionUsd: 50, priceAsOf: '2026-09-15' }`
   (the priced ceiling rises accordingly — present it), README row "Prepared".
3. Gate (read-only): `pnpm run placebo:live gate --release-tag v0.3.1 --controller-sha <sha> --subject-sha <sha>` → seven PASS.
4. **Authorization: cap USD 10, reserve 1.00, push freeze ~3 h.** Then the
   Phase 2 sequence from `docs/plans/2026-09-15-case-lab-tracks-latest-release-phases/phase-2.md`
   with `v0.3.1`, `OPENAI_API_KEY` exported in the operator shell (the
   workflow reads the repo secret). Expect ≥ 1 `gpt-6-astra` cost entry per
   adjudicated case and zero false approvals.
5. Finalize, promote to `docs/demo/placebo-v0.3.1-live-2026-09-17.{json,md}` +
   ledger, evidence index `docs/demo/sutura-v0.3.1-release-benchmark-evidence.md`
   (compare the measured gates against 2026-09-15; call out the second-opinion
   rows: approved / refused / skipped counts and total Astra spend).
6. `pnpm run push-freeze off`; `pnpm run release:case-lab bump --tag v0.3.1 --result … --ledger …`;
   Phase 3 of the Case Lab plan for the test-expectation rebinding
   (`replay.test.ts:67-82` values from the new file; the five outcomes must
   still include `refused` for the greenwash trap and `flaky-no-patch`).
   Commit and push (the gate passes on the bump commit).
7. **Authorization: publish + deploy.** `pnpm run release:case-lab publish-demo --authorize`
   (now waits for green demo CI, Phase 1) → `deploy --authorize` → health
   shows `0.3.1`.
8. Re-enable: Vercel env `CASE_LAB_ENABLED=true` (`vercel env rm/add` from
   `packages/case-lab`, then the deploy step again since env is baked at
   build) and `! gh variable set CASE_LAB_ENABLED -R juan294/sutura-demo -b true`.
   Health → `enabled:true`.
9. Smoke: `node packages/case-lab/bin/case-lab.js dispatch --base-url https://sutura-case-lab.vercel.app --case javascript-repair`;
   poll the result page; require `mode: live`, `outcome: fixed`,
   `release.version 0.3.1`, and a `second-opinion` row in `caseFile.audit.checks`.
   If it is not `fixed`, download the bundle, replay it, and report the
   terminal reason before anything else — do not launch on an unverified demo.
10. Record `docs/release/v0.3.1-case-lab-record.md` (same sections as v0.3.0);
    CLAUDE.md Deployment pointer → v0.3.1 record; memory note.

## Success criteria

Automated: `gh release view v0.3.1` and `npm view sutura@0.3.1 version`;
`release:case-lab check` PASS on `develop`; health `0.3.1` + `enabled:true`;
smoke result JSON as above; `docs/demo/placebo-v0.3.1-live-2026-09-17.json`
with `subjectSha` = tag commit and ≥ 1 `gpt-6-astra` entry.

Manual: Juan gives the three authorizations at steps A5, B4, B7.

## Done when

All of the above; the demo is verifiably fixing its flagship case in public.
STOP. Phase 5 scheduling may proceed.
