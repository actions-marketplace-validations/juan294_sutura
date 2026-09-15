# Phase 5: Wire the gate, publish the demo workflow, deploy, smoke, playbook

Plan: [2026-09-15-case-lab-tracks-latest-release.md](../2026-09-15-case-lab-tracks-latest-release.md)

Status: Done, with one open item carried to v0.3.1. Gate wired into
pre-push/CI; `publish-demo` and `deploy` ran with authorization and are
verified (`verify-pin --tag v0.3.0` four PASS lines; `/api/health` reports
0.3.0, 24 runs/USD 18). The required live smoke dispatch surfaced a real
v0.3.0 regression (replay bundle actionSha compared against the wrong
commit) that blocked every live publish; fixed on `develop`
(`a278812`) but the fix only reaches the public path at v0.3.1, so
**live runs are disabled on production** (`CASE_LAB_ENABLED=false`) until
then. Full record: `docs/release/v0.3.0-case-lab-record.md`.

## Goal

The rule is mechanical (pre-push and CI refuse drift), the public Case Lab
runs v0.3.0 with the new caps, and the release playbook carries the standing
obligation.

## Changes

### 1. Gate wiring

- `.husky/pre-push`: after `node scripts/push-freeze.mjs check || exit 1` add
  `node scripts/release-case-lab.mjs check || exit 1` with a one-line comment
  (`# Refuse to push while the public Case Lab lags the newest release tag (scripts/release-case-lab.mjs).`).
- `.github/workflows/ci.yml`: a step `- run: node scripts/release-case-lab.mjs check`
  immediately before `pnpm run test:release-contracts` (the default shallow
  checkout is fine: the script uses `git ls-remote` and `git fetch origin main`).
- `scripts/pre-push.test.mjs`: the existing hook test runs the real hook with
  a stubbed `pnpm`; add `SUTURA_RELEASE_CASE_LAB_SKIP=1` support **only if**
  the hook test cannot reach the network in CI. Prefer no skip: the check is a
  read-only `ls-remote`. Decide by running `pnpm run test:release-contracts`
  in the worktree; document the outcome in the phase report.
- `scripts/release-workflow.test.mjs`: assert `ci.yml` contains
  `release-case-lab.mjs check` before `test:release-contracts`, and that
  `.husky/pre-push` contains it after `push-freeze.mjs check`.

### 2. Publish the demo workflow (authorization required)

```bash
pnpm run release:case-lab check                    # must exit 0 on develop HEAD
pnpm run release:case-lab publish-demo --authorize
node packages/case-lab/bin/case-lab.js verify-pin --tag v0.3.0   # four PASS lines, including byte-identical
```

The demo copy also carries `CASE_LAB_DAILY_RUN_CAP: '24'` from Phase 3.

### 3. Deploy and smoke (authorization required)

```bash
pnpm run release:case-lab deploy --authorize     # vercel pull → build --prod → deploy --prebuilt --prod, scope thecreativetoken, from packages/case-lab
curl -s https://sutura-case-lab.vercel.app/api/health
# expect: "release":{"version":"0.3.0","actionSha":"c94eee2086b31450d975137a0102dda18522d0b8"} and "maxRunsPerDay":24,"dailySpendStopUsd":18
node packages/case-lab/bin/case-lab.js acceptance --base-url https://sutura-case-lab.vercel.app --out "$(mktemp -d)/acceptance.json"
```

Then one live run (USD ≤ 0.75, counts against the daily cap):

```bash
node packages/case-lab/bin/case-lab.js dispatch --base-url https://sutura-case-lab.vercel.app --case javascript-repair
# poll the returned result page until terminal; the result JSON's release.version must be 0.3.0
```

### 4. Playbook and records

- `docs/release/e2e-pro-playbook.md`: insert `### 8a. Case Lab follows the
  release` between `### 8. Authorize and tag` (`:1082-1088`) and `### 9.
  Rollback` (`:1090`), keeping §8 under its 200-line cap (`:999-1001`):

  ```markdown
  ### 8a. Case Lab follows the release

  The public Case Lab runs the newest release tag; the release is not done until it does.

  - Dispatch the canaries at the tag: `gh workflow run provider-contract-canary.yml --ref <TAG>`.
  - Prepare `docs/demo/run-manifests/release-<TAG>-benchmark.json`; get authorization for its priced ceiling.
  - `pnpm run push-freeze on`, `placebo:live init-spend`, `placebo:live streak --release-tag <TAG> … --authorize`, `placebo:live finalize`; promote the evidence to `docs/demo/` with the dated names; `pnpm run push-freeze off`.
  - `pnpm run release:case-lab bump --tag <TAG> --result <file> --ledger <file>`; commit.
  - `pnpm run release:case-lab publish-demo --authorize`, then `deploy --authorize`; confirm `/api/health` reports the tag.
  - Until the bump lands, `pnpm run release:case-lab check` refuses every push to `develop` and fails CI; the bump commit is the one permitted push.
  ```

- `docs/release/v0.3.0-case-lab-record.md`: dated record of this cycle —
  benchmark run IDs and totals (from Phase 2), the `publish-demo` commit on
  `sutura-demo`, the Vercel deployment URL, the health payload, the live-run
  request id and outcome.
- `CHANGELOG.md`: under a new `## [Unreleased]` heading above `## [0.3.0]`:
  "Added: the public Case Lab tracks the newest release tag; `release:case-lab`
  gate in pre-push and CI; release-mode Placebo benchmark; Case Lab live-run
  cap raised to 24 runs / USD 18 per day." Run `test:release-contracts`; if
  `submission-contract.test.mjs` refuses the heading form, place the entry
  where that test accepts it and say so in the report.
- `CLAUDE.md` Deployment paragraph: replace "live dispatch has a separate
  authorization gate" sentence's neighbour "This overview does not record a
  fresh deployment check." with a pointer to `docs/release/v0.3.0-case-lab-record.md`.
- Memory: update `case-lab-pin-latest-release.md` (auto-memory) with the
  command names once they exist.

## Verification

```bash
pnpm run ci:local            # touches guards; full mirror before the push
pnpm run release:case-lab check && echo GATE-OK
git push                     # pre-push runs push-freeze check → release:case-lab check → ci:fast
```

After the push, spawn the CI-monitor agent per `.claude/rules/push-accountability.md`.

## Success criteria

Automated: everything in the plan's "Success criteria" list; plus
`verify-pin --tag v0.3.0` four PASS lines; plus the red-path proof re-run
(temporarily revert `release.json` to `0.2.0` in the worktree, run `check`,
expect exit 1 with the BLOCKED message, restore).

Manual: Juan opens the Case Lab, sees "Live runs are enabled" and the result
of the smoke run labelled `Live run` with release `0.3.0`.

## Done when

`origin/develop` is green with the gate wired, `sutura-demo` `main` is
byte-identical to the committed workflow, `/api/health` reports v0.3.0 and the
24-run cap, the record and playbook are committed, and the freeze is off. STOP.
The next cycle (v0.3.1 with the Astra auditor) follows `### 8a` verbatim.
