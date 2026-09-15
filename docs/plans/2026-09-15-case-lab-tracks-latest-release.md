# Case Lab always tracks the latest production release

Date: 2026-09-15

Status: Approved design; implementation not started

Owner: Juan

Integration branch: `develop`

Research basis: this conversation (2026-09-15), all claims read from the working
tree at `chore/case-lab-pin-v0.3.0` (develop + an uncommitted pin bump) or from
live `gh`/`vercel` output the same day. Every file reference below is
`path:line` as of that tree.

## Rule

The public Case Lab (`https://sutura-case-lab.vercel.app` and the
`juan294/sutura-demo` workflow) always runs the newest production release tag on
`main`. Never a develop candidate, never a stale release. A release is not done
until the Case Lab follows it.

## Why this needs a plan and not a bump

The Case Lab is bound to a release in four places, and one of them needs a paid
benchmark that today's tooling cannot run against a release commit:

| Binding | Where | State on 2026-09-15 |
| --- | --- | --- |
| Release identity | `packages/case-lab/release.json:2-3` | `0.2.0` / `a943ded4…` (bumped to `0.3.0` / `c94eee20…` on the temp branch, uncommitted) |
| Demo workflow pins | `packages/case-lab/demo/case-lab.yml:38` (`SUTURA_ACTION_SHA`), `:40` (`SUTURA_CONTROLLER_SHA`), `:184` (`uses: juan294/sutura/packages/action@…`), plus the byte-identical copy on `sutura-demo` `main` | action `a943ded4…`, controller `f5c3056a…` (a develop candidate) |
| Recorded evidence | `packages/case-lab/src/evidence.ts:7-8` names `docs/demo/placebo-v0.2-live-2026-09.json` and its ledger; `packages/case-lab/src/replay.test.ts:34,61` require that file's `subjectSha` to equal `release.json.actionSha`; `packages/case-lab/src/replay.ts:29` links the same file | subject `a943ded4…` (v0.2.0). No `placebo-v0.3.0-live-*` evidence exists |
| Deployed site | Vercel project `sutura-case-lab`, deployed by `vercel deploy --prod` from the CLI (last: 2026-09-05); `/api/health` reports `release` from the bundled `release.json` (`packages/case-lab/src/dispatcher.ts:146-153`) | reports `0.2.0` / `a943ded4…` |

No fixture in `packages/case-lab/replay/` has ever been captured (the directory
holds only `README.md`), so every one of the five cases resolves to the recorded
benchmark through `packages/case-lab/src/replay.ts:234-256`.

The benchmark (`pnpm run placebo:live streak`) runs the 51 frozen Placebo cases
(55 evaluations) serially in about 2 h 40 min for USD 5.5–6.4 in Sutura
accounting (inference share USD 0.14–0.18; the sandbox share has no matching
provider line item, `docs/plans/2026-09-05-sutura-repair-quality.md:87`). Its
gate refuses anything that is not `origin/develop` HEAD with a successful
`develop` push CI run and canaries under 24 h old
(`scripts/dogfood.mjs:421-467`), and dispatch is hard-coded `--ref develop`
(`scripts/placebo-live.mjs:727`). `v0.3.0` is `c94eee2086b31450d975137a0102dda18522d0b8`,
a squash commit on `main` with a successful `main` push CI run
(34865984293), tree-identical to develop `79d510ca…`, and with no canary run.
Since 2026-09-08 every paid dispatch also requires a run manifest
(`scripts/placebo-live.mjs:858-866`, `scripts/manifest-spend.mjs:78-81`); no
manifest exists for the 51-case release benchmark.

Nothing enforces any of this at release time. `scripts/release-workflow.test.mjs`
checks seven package manifests (`:11-23`) but not `release.json`; no script,
workflow or playbook step runs `case-lab verify-pin --tag`; the v0.3.0 release
on 2026-09-14 shipped without touching the Case Lab.

## Decisions (Juan, 2026-09-15)

1. **Gate scope: block.** After a release tag, the pre-push hook and `ci.yml`
   refuse every push to `develop` until `release.json`, the demo workflow pins
   and the recorded evidence all name the newest `v*` tag on `main`. The bump
   commit itself passes, so it is the one permitted push (consistent with
   `.claude/rules/ci-parity.md` "never push on red").
2. **Per-release cost: the full 51-case benchmark** against the tag commit,
   `--cap-usd 8 --initial-reserve-usd 1.00`, under a push freeze, with its own
   run manifest. The same artifact is the release evidence.
3. **Launch-day caps: 24 live runs / USD 18 per UTC day** (hourly cap stays 4,
   concurrency stays 1), effective at the Phase 5 deploy.

## Design

### A. Release-mode benchmark

`placebo:live gate|run|streak` gain `--release-tag <vX.Y.Z>`. In that mode the
gate resolves the tag through `gh api repos/juan294/sutura/git/ref/tags/<tag>`
(dereferencing annotated tags exactly as `packages/case-lab/src/cli.ts:195-201`
does), requires controller = subject = the tag commit, and runs `gateDogfood`
with `branch: 'main'`: `origin/main` must contain the commit, a successful
`main` push CI run must exist for it, both canaries must be under 24 h.
Dispatch uses `--ref <tag>` so `GITHUB_SHA` equals the controller commit
(`.github/workflows/placebo-live-case.yml:82` asserts exactly that). Canaries
are produced beforehand by `gh workflow run provider-contract-canary.yml --ref <tag>`
(that workflow uploads both `provider-contract-canary` and
`runtime-image-canary`, `.github/workflows/provider-contract-canary.yml:26-42`).
Develop mode is unchanged. Both modes are covered by fixture-backed tests; the
`main` fixtures are the real `gh api` listings for `c94eee2…` captured in
Phase 1.

### B. Release-benchmark manifest

`docs/demo/run-manifests/release-v0.3.0-benchmark.json` and
`release-v0.3.0-benchmark-config.json`: 51 frozen subjects in
`orderedPlaceboCaseIds()` order, `corpusHash 785cfc70…`, `imageDigest` =
`PYTHON_IMAGE_INDEX_DIGEST` (`packages/core/src/runtime/python.ts:25`),
`candidateCommit c94eee20…`, caps sized for 51 subjects. One manifest per
release; historical manifests are never rewritten
(`docs/demo/run-manifests/README.md:33`).

### C. `pnpm run release:case-lab`

`scripts/release-case-lab.mjs`, house style (importable, injected `git`/`gh`/
`fetch`/`command`, read-only subcommands versus literal `--authorize`, every
error names the file, the observed value and the expected value):

| Subcommand | Effect | Network | Authorization |
| --- | --- | --- | --- |
| `check` | newest `v*` tag reachable from `origin/main` ⇔ `release.json` ⇔ demo workflow pins ⇔ recorded evidence `subjectSha`/`subjectVersion` ⇔ `EVIDENCE_URL` | `git ls-remote` + `git fetch` (injected in tests) | none |
| `bump --tag <tag> --result <file> --ledger <file>` | rewrites `release.json`, the three workflow SHAs, `evidence.ts` constants, `replay.ts` `EVIDENCE_URL`; then `case-lab verify-pin --tag` | as `verify-pin` | none (local edit) |
| `publish-demo --authorize` | PUT `.github/workflows/case-lab.yml` to `sutura-demo` `main` via `gh api`; re-verify byte identity | `gh` | literal flag |
| `deploy --authorize` | `vercel deploy --prod --scope thecreativetoken` from `packages/case-lab`; then assert `GET /api/health` `.release` equals `release.json` | `vercel`, `fetch` | literal flag |

`check` is wired into `.husky/pre-push` after `push-freeze check` and into
`ci.yml` as a step before `test:release-contracts`. It is not added to
`test:release-contracts`, which stays offline by convention (every `gh`/`fetch`
there is injected; `publish.yml` deliberately does not rerun it,
`scripts/release-workflow.test.mjs:67-73`).

### D. Playbook

A new `### 8a. Case Lab follows the release` between `### 8. Authorize and tag`
(`docs/release/e2e-pro-playbook.md:1082`) and `### 9. Rollback` (`:1090`),
inside the 200-line cap of §8, and a dated record
`docs/release/v0.3.0-case-lab-record.md`.

## Phases

| # | Phase | File | Paid | Batch |
| --- | --- | --- | --- | --- |
| 1 | Release-mode benchmark gate and the v0.3.0 run manifest | [phase-1](2026-09-15-case-lab-tracks-latest-release-phases/phase-1.md) | no | `[batch-eligible]` with 4 |
| 2 | Run the v0.3.0 benchmark and promote the evidence | [phase-2](2026-09-15-case-lab-tracks-latest-release-phases/phase-2.md) | **yes: cap USD 8, ~3 h, push freeze** | after 1 |
| 3 | Case Lab pin, evidence rebinding, launch caps, stale docs | [phase-3](2026-09-15-case-lab-tracks-latest-release-phases/phase-3.md) | no | after 2 |
| 4 | `release:case-lab` script and its tests | [phase-4](2026-09-15-case-lab-tracks-latest-release-phases/phase-4.md) | no | `[batch-eligible]` with 1 |
| 5 | Wire the gate, publish the demo workflow, deploy, smoke, playbook | [phase-5](2026-09-15-case-lab-tracks-latest-release-phases/phase-5.md) | outward-facing | after 3 and 4 |

Dependency graph: 1 → 2 → 3 → 5; 4 → 5. Phases 1 and 4 touch disjoint files
(1: `scripts/placebo-live.mjs`, `scripts/dogfood.mjs`, their tests, fixtures,
manifests; 4: new `scripts/release-case-lab.mjs`, its test, `package.json`
scripts). Phase 4 deliberately does **not** wire the hook or CI, because until
Phase 3 lands the check would fail on `develop`; wiring is Phase 5.

Each phase is one conversation; stop after each and wait for confirmation.
Implementation happens in a worktree off `develop`. The existing temp branch
`chore/case-lab-pin-v0.3.0` (uncommitted `release.json` + demo workflow bump)
is folded into Phase 3; do not push it before then.

## Success criteria

Automated (all must hold at the end of Phase 5):

- `pnpm run release:case-lab check` exits 0 on `develop` HEAD.
- `pnpm run ci:fast` green; `pnpm run ci:local` green once before the Phase 5
  push (Phases 1 and 4 touch guards).
- `node packages/case-lab/bin/case-lab.js verify-pin --tag v0.3.0` prints four
  `PASS` lines including "byte-identical to the committed copy".
- `pnpm --filter @sutura/case-lab test`: `replay.test.ts` "loads the committed
  live result" and "produces one validated recorded result per case" pass with
  `subjectSha === c94eee20…`.
- `curl -s https://sutura-case-lab.vercel.app/api/health` returns
  `"release":{"version":"0.3.0","actionSha":"c94eee2086b31450d975137a0102dda18522d0b8"}`
  and `"maxRunsPerDay":24`.
- `docs/demo/placebo-v0.3.0-live-2026-09-<dd>.json` has `subjectSha c94eee20…`,
  `subjectVersion 0.3.0`, 51 ledger entries, 55 results, and its `resultHash`
  and `ledgerHash` verify through `loadRecordedEvidence`.
- A red-path proof: with `release.json` temporarily reverted to `0.2.0`,
  `release:case-lab check` exits 1 and the message names
  `packages/case-lab/release.json`, `0.2.0`, `v0.3.0` and the fix command.

Manual (Juan):

- One live Case Lab run from the public site after the Phase 5 deploy
  completes and its result page shows release `0.3.0`.
- Authorization for the Phase 2 paid run and for the Phase 5
  `publish-demo`/`deploy` steps is given in those conversations, not assumed
  from this plan.

## Out of scope

- The Astra second-opinion auditor (separate plan; it will re-run this cycle
  for v0.3.1).
- Capturing per-case replay fixtures (`case-lab capture-replay`); the recorded
  benchmark remains the deterministic source.
- Changing what the benchmark measures or the score contract.
- The Product Hunt launch assets.

## Standing per-release obligation (record in the playbook)

Every release from v0.3.0 onward: tag → canaries at the tag → push freeze →
manifest → 51-case benchmark against the tag commit → promote evidence → bump →
publish demo workflow → deploy → health check → freeze off. Budget ~USD 8 cap
and ~3 h of frozen `develop` per release.
