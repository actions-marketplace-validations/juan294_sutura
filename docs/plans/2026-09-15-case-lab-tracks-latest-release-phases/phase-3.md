# Phase 3: Case Lab pin, evidence rebinding, launch caps, stale docs

Plan: [2026-09-15-case-lab-tracks-latest-release.md](../2026-09-15-case-lab-tracks-latest-release.md)

Status: Done. Case Lab bound to v0.3.0 everywhere (release identity, evidence
constants, launch caps 24 runs/USD 18). Plan-compliance reviewed (APPROVE)
and `/simplify` applied. STOP-condition check held (`trap-weakened-expect`,
`flaky-timer-race` unchanged structurally). 220/220 case-lab tests,
306/306 release-contracts, `ci:fast` green. `verify-pin --tag v0.3.0` shows
3 PASS + 1 expected FAIL (sutura-demo byte-identity, pending Phase 5).

## Goal

`packages/case-lab` binds to v0.3.0 everywhere, the live-run caps become
24 runs / USD 18 per UTC day, every v0.2.0 identity statement in the docs is
either updated or explicitly labelled historical, and the full Case Lab suite
is green. Nothing is published in this phase.

## Changes

### 1. Release identity and workflow pins

- `packages/case-lab/release.json`: `{"version": "0.3.0", "actionSha": "c94eee2086b31450d975137a0102dda18522d0b8"}`.
- `packages/case-lab/demo/case-lab.yml:38` `SUTURA_ACTION_SHA`, `:40`
  `SUTURA_CONTROLLER_SHA`, `:184` `uses: juan294/sutura/packages/action@…`: all
  `c94eee2086b31450d975137a0102dda18522d0b8`. Controller = action = release
  commit from now on (the rule; Sep 5 pinned the controller to a develop
  candidate).

### 2. Recorded evidence rebinding

- `packages/case-lab/src/evidence.ts:7-8`:
  `RECORDED_RESULT_FILE = 'docs/demo/placebo-v0.3.0-live-2026-09-<dd>.json'`,
  `RECORDED_LEDGER_FILE = 'docs/demo/placebo-v0.3.0-live-ledger-2026-09-<dd>.json'`
  (the exact names committed in Phase 2).
- `packages/case-lab/src/replay.ts:29` `EVIDENCE_URL`: same file under
  `https://github.com/juan294/sutura/blob/develop/…`.
- `packages/case-lab/src/replay.test.ts:43-45` ("refuses tampered evidence")
  writes the fixture copies under the literal v0.2 names; switch to
  `RECORDED_RESULT_FILE` / `RECORDED_LEDGER_FILE` so the test follows the
  constants.
- `packages/case-lab/src/verification-contract.test.ts:10` and the
  `packages/placebo`/`packages/evaluation` tests that read
  `placebo-v0.2-live-2026-09.json` use it as a historical fixture, not as the
  Case Lab binding: leave them unchanged.
- The v0.3.0 ledger carries `packageContentHash`/`packageIntegrity` (absent in
  v0.2). `loadRecordedEvidence` (`evidence.ts:66-93`) only proves hashes, so
  no code change; confirm `recordedResult` renders the five cases from the new
  file (`replay.test.ts` "produces one validated recorded result per case in
  roadmap order").
- `packages/case-lab/src/replay.test.ts:67-82` hardcodes per-case values read
  from the v0.2 evidence (`python-repair` and `upstream-incident` were
  `infra-stop`; `javascript-repair` inference USD ≈ 0.005507; `upstream-incident`
  elapsed ≈ 72700.265 ms proving the Tavily arm is chosen). Re-derive every
  one of them from the v0.3.0 result file — read the values, do not guess —
  and keep the structural assertions (the Tavily-enabled arm is the one
  selected for `upstream-incident`; `greenwash-trap` is `refused` with
  `audit.approved === false`; `flaky-failure` is `flaky-no-patch`). If the
  v0.3.0 benchmark did not produce those two outcomes for `trap-weakened-expect`
  and `flaky-timer-race`, STOP: `acceptance.ts:144-149` and the Case Lab's
  expectation labels (`cases.ts:98-123`) depend on them, and that is a product
  finding for Juan, not a test to loosen.
- `packages/case-lab/src/result.test.ts:18-20,41-58` builds a literal v0.2
  document and never reads `release.json`: unchanged.

### 3. Launch-day caps (decision 3)

- `packages/case-lab/src/limits.ts:15-20`:
  `dailySpendStopUsd: 18`, `maxRunsPerDay: 24` (`worstCaseRunUsd 0.75` stays;
  `assertLimits` requires `24 === floor(18 / 0.75)`). `maxRunsPerHour: 4` and
  `maxConcurrentRuns: 1` unchanged (decision covered the daily cap only; 24
  runs at 4/hour needs six busy hours, which is the intended shape).
- `packages/case-lab/src/limits.test.ts:18-21`: the expected object.
- `packages/case-lab/demo/case-lab.yml:41`: `CASE_LAB_DAILY_RUN_CAP: '24'`;
  `packages/case-lab/src/demo-workflow.test.ts:56` accordingly.
- `packages/case-lab/README.md:50-54` limits table: 24 per day, USD 18 daily
  stop; the "Spend amplification" row at `:109` states the new ceiling.
- `packages/case-lab/src/dispatcher.test.ts:155-170` derives from the
  constants; `render.ts:866` reads them at build time. No change.

### 4. Stale identity statements

| File | Line | Change |
| --- | --- | --- |
| `docs/evaluation/README.md` | 107 | Demo identity row: "Action is v0.3.0 at `c94eee20…`, equal to the current release; recorded evidence `placebo-v0.3.0-live-2026-09-<dd>.json`" |
| `README.md` | 100-102 | Evidence links: add the v0.3.0 result/ledger/index; keep v0.2 links labelled historical (the `submission-contract` version-drift rule requires a "historical" label on non-current versions) |
| `packages/placebo/README.md` | 35-37 | same treatment |
| `packages/case-lab/README.md` | 10-12, 126 | recorded-result sentence names the v0.3.0 file; `verify-pin [--tag v0.3.0]` |
| `packages/case-lab/replay/README.md` | 25 | fallback file name |
| `docs/evaluation/architecture.md` | 103 | add the v0.3.0 evidence next to the historical ones |
| `docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md` | 233 | the active roadmap's "(Done: `release.json` names v0.2.0…)" becomes "names the newest release tag; `release:case-lab check` enforces it (plan 2026-09-15)" |
| `docs/demo/run-manifests/README.md` | table | already updated in Phase 2; verify |

`docs/demo/*.md` historical reports, `docs/research/*` and the 2026-09-04 Case
Lab plan/notes are historical records and are not rewritten. The acceptance
`links-public` check (`acceptance.ts:298-311`) HEAD-requests `links.evidence`,
so the new `EVIDENCE_URL` must already exist on `origin/develop` (it does after
Phase 2) before the Phase 5 deploy.

## Tests

- `pnpm --filter @sutura/case-lab test` — 220/220, in particular
  `replay.test.ts:34,61` now assert `subjectSha === c94eee20…` through
  `loadRelease()`.
- `node packages/case-lab/bin/case-lab.js verify-pin --tag v0.3.0` — the first
  three `PASS` lines; the fourth (`sutura-demo … byte-identical`) is expected
  to fail until Phase 5 publishes the workflow. Record that exact failure line
  in the phase report.
- `node packages/case-lab/bin/case-lab.js catalog --out /tmp/case-lab-catalog`
  writes five results whose `release.actionSha` is `c94eee20…` and whose
  `mode` is `recorded`.
- `pnpm run test:release-contracts` (covers `submission-contract.test.mjs`
  version-drift on the README edits).

## Verification

```bash
pnpm --filter @sutura/core build && pnpm --filter @sutura/case-lab build
pnpm --filter @sutura/case-lab test
node packages/case-lab/bin/case-lab.js verify-pin --tag v0.3.0
node packages/case-lab/bin/case-lab.js catalog --out "$(mktemp -d)/catalog" && echo catalog-ok
pnpm run ci:fast
```

## Done when

All of the above are green except the single expected `sutura-demo` byte-identity
line, the change is committed on a worktree branch off `develop` and pushed
(the Phase 4 gate is not yet wired, so the push is permitted), CI is green.
Delete the temp branch `chore/case-lab-pin-v0.3.0` after this lands. STOP.
