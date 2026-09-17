# Phase 4: Release v0.3.1 and the `### 8a` cycle

Plan: [2026-09-17-typesafe-jev-calibrated-audit.md](../2026-09-17-typesafe-jev-calibrated-audit.md)

Status: done 2026-09-17; see `docs/release/v0.3.1-case-lab-record.md` (Incident 3: controller pin redefined so the live publish path can pass on a fresh tag).

Template: `docs/plans/2026-09-15-launch-readiness-v0.3.1-phases/phase-4.md`,
resumed with Jev included and its stale premises corrected. Paid and
outward-facing: npm publish, ~USD 10 cap benchmark, demo publish, Vercel
deploy, re-enabling live runs, repository secrets. Each authorization is
requested in this phase's conversation at the marked steps.

## Goal

`v0.3.1` tagged on a fresh squash of `develop` onto `main` and published; the
Case Lab bound to it with fresh benchmark evidence that includes `jev-latest`
cost entries; live runs enabled; one public live `javascript-repair` run
publishes a `fixed` result with `second-opinion` and `typesafe-audit` rows.

## Facts (VERIFIED 2026-09-17 04:30Z)

- No `v0.3.1` tag locally or on origin; `gh release list` newest is v0.3.0;
  `npm view sutura version` is 0.3.0. `origin/main` is at the un-tagged squash
  `3fd99d8` "release: v0.3.1" and its `ci.yml` is red.
- Every version literal on `develop` already says `0.3.1`
  (`scripts/release-workflow.test.mjs:11-22,114-115`, `packages/core/src/index.ts:291`,
  `packages/cli/src/args.ts:5`, `scripts/install-test-lib.mjs:10`, seven
  `package.json`, README examples). `CHANGELOG.md` has `## [0.3.1] - 2026-09-17`.
- Placebo controller paths already name v0.3.1 (`scripts/placebo-live.mjs:30-32`,
  `.gitignore:23-26`); `docs/demo/sutura-v0.3.1-release-evidence-requirements.json` exists.
- Provider-contract canary succeeded on `develop` at 2026-09-17T03:32Z after
  `3397eac`; `sutura-demo` `main` is green.
- Benchmark manifest shape: `docs/demo/run-manifests/release-v0.3.0-benchmark.json`.
- Live sequence: `docs/plans/2026-09-15-case-lab-tracks-latest-release-phases/phase-2.md:26-95`.
- The bash guard hook refuses a rebase pull while the tree has uncommitted
  files: commit first.

## Part A — release v0.3.1

1. Correct the stale record: `docs/plans/2026-09-15-launch-readiness-v0.3.1-notes.md`
   Part B paragraph gets a dated addendum stating the tag was deleted, nothing
   was published, and this plan resumes the cycle. `docs/plans/2026-09-15-launch-readiness-v0.3.1.md`
   status line points here.
2. Confirm literals: `pnpm run test:release-contracts` green on `develop`
   (already 0.3.1; no bump).
3. `CHANGELOG.md` `[0.3.1]` already lists the `json_object` change and the
   Astra second opinion; Phase 3 added the Jev entry. Set the date to the
   actual release day if it slips past 2026-09-17.
4. `pnpm run ci:local`; PR `develop → main` titled `release: v0.3.1`; squash
   merge (as #143 and #144 were); wait for `ci.yml` on `main` to be green;
   annotated tag `v0.3.1` on the new squash commit; GitHub release from the
   tag with the CHANGELOG section as body → `publish.yml` publishes
   `sutura@0.3.1` (verifies tag == version, `origin/main`, exact-head CI,
   bundle freshness). **Authorization: tag + release.**
5. `develop`: reconcile after the squash (`git merge -s ours origin/main`, as
   `269b690` did); from here `release:case-lab check` refuses every push until
   Part B's bump commit.

## Part B — `### 8a. Case Lab follows the release`

Secrets first (Juan runs; classifier-blocked here):
`! gh secret set TYPESAFE_API_KEY -R juan294/sutura -b "$TYPESAFE_API_KEY"` and
the same `-R juan294/sutura-demo`; confirm with `gh secret list` only, and
confirm `OPENAI_API_KEY` is listed on both.

1. Canaries at the tag: `gh workflow run provider-contract-canary.yml --ref v0.3.1 -R juan294/sutura`;
   watch to success. If it fails, STOP and report before any paid step.
2. Manifest `docs/demo/run-manifests/release-v0.3.1-benchmark.json` (+ `-config.json`)
   from the v0.3.0 pair: `candidateCommit` = tag commit, `inferenceUsd: 10`,
   `models` += `{ modelId: 'gpt-6-astra', inputPerMillionUsd: 10, outputPerMillionUsd: 50, priceAsOf: '2026-09-15' }`
   and `{ modelId: 'jev-latest', inputPerMillionUsd: 0.042, outputPerMillionUsd: 0, priceAsOf: '2026-09-17' }`
   (Phase 2 §5 makes the validator accept the stated zero);
   README row "Prepared". Present the priced ceiling.
3. Gate (read-only): `pnpm run placebo:live gate --release-tag v0.3.1 --controller-sha <sha> --subject-sha <sha>` → all PASS.
4. **Authorization: cap USD 10, reserve 1.00, push freeze ~3 h.** Then the
   phase-2 sequence with `v0.3.1`, `OPENAI_API_KEY` and `TYPESAFE_API_KEY`
   exported in the operator shell (the workflow reads the repo secrets). Expect
   ≥ 1 `gpt-6-astra` and ≥ 1 `jev-latest` cost entry per adjudicated case,
   zero false approvals, and the trap catch rate is not below the
   v0.3.0 record (18/19, `packages/placebo/README.md:41`); count `typesafe-audit` rows by
   status (approved / refused / uncertain / skipped).
5. Finalize; promote to `docs/demo/placebo-v0.3.1-live-2026-09-17.{json,md}` +
   ledger; evidence index `docs/demo/sutura-v0.3.1-release-benchmark-evidence.md`
   comparing against v0.3.0 and calling out the Jev and Astra row counts and
   total spend for each.
6. `pnpm run push-freeze off`; `pnpm run release:case-lab bump --tag v0.3.1 --result … --ledger …`;
   rebind the Case Lab replay test expectations (`replay.test.ts:67-82`);
   commit and push (the gate passes on the bump commit).
7. **Authorization: publish + deploy.** `pnpm run release:case-lab publish-demo --authorize`
   (waits for green demo CI, which also proves the added `typesafe-api-key`
   input did not break the demo's contract tests) → `deploy --authorize` →
   health shows `0.3.1`.
8. Re-enable: Vercel env `CASE_LAB_ENABLED=true` then deploy again;
   `! gh variable set CASE_LAB_ENABLED -R juan294/sutura-demo -b true`; health
   → `enabled:true`.
9. Smoke: `node packages/case-lab/bin/case-lab.js dispatch --base-url https://sutura-case-lab.vercel.app --case javascript-repair`;
   poll; require `mode: live`, `outcome: fixed`, `release.version 0.3.1`, and
   both `second-opinion` and `typesafe-audit` rows in `caseFile.audit.checks`
   with the Jev row carrying `P(green-wash)=` and `confidence=`. If not
   `fixed`, download the bundle, replay it, report the terminal reason first;
   do not launch on an unverified demo.
10. Record `docs/release/v0.3.1-case-lab-record.md`; CLAUDE.md Deployment
    pointer → v0.3.1 record; memory note; update the Product Hunt copy line in
    the existing phase 5 to name the calibrated veto.

## Success criteria

Automated: `gh release view v0.3.1`, `npm view sutura@0.3.1 version`,
`release:case-lab check` PASS on `develop`, health `0.3.1` + `enabled:true`,
smoke result JSON as in step 9, `docs/demo/placebo-v0.3.1-live-2026-09-17.json`
with `subjectSha` = tag commit and ≥ 1 `jev-latest` entry.

Manual: Juan gives the authorizations at A4, B4, B7 and sets the two secrets.

## Done when

All of the above; the demo fixes its flagship case in public with a
calibrated audit row. STOP. Product Hunt scheduling proceeds under the
existing phase 5.
