# First-try repair reliability implementation plan

Date: 2026-08-30

Research sources:

- `docs/research/2026-08-29-ci-failure-retrospective.md` (29 red runs; 1 fix in 22 dogfood attempts; 0 of 4 real failures diagnosed)
- `docs/research/2026-08-29-live-repair-control-path.md`
- Session research (2026-08-30): guard inventory, replay/fixture/evidence map, dogfood dispatch mechanics — findings folded into "Evidence that defines the problem" below

Baseline: `develop` at `efcb897c442c53f6b2d58a2a7dc5189d32200053`
(`packages/` tree `8769ed91231dadf81b719a64f398f2f4069b8c02`;
`packages/action/dist/index.cjs` sha256
`7ae44a73b13cfacab3c82b31d7efa522ef8467d170b93ba9d5eaace5fc11e712`)

Integration branch: `develop`

Supersedes: Phase 5 of `docs/plans/2026-08-29-live-repair-reliability.md`
("one final live dogfood proof"). Phases 1–4 of that plan remain complete and
are not reopened; their invariants 10–12 become executable gates here.

## Objective

Make Sutura repair a real CI failure on the first try, and make that claim
provable before any developer sees the product:

1. every fail-closed guard in `packages/action` and `packages/core` is reached
   by a test, and every guard at an external input boundary is driven by a
   fixture captured from a real run or real provider response;
2. a dogfood run cannot be dispatched unless a provider-contract canary bound
   to the exact candidate SHA is green and the previous `gave-up` replays
   locally as a named test;
3. every `gave-up` becomes a machine-readable replay bundle and then a named
   replay test before the next candidate is pushed;
4. the single-assertion fixture passes 10 of 10 consecutive live runs on one
   unchanged code tree before any harder fixture or any promotion.

## Evidence that defines the problem

All VERIFIED in the 2026-08-30 research session unless labeled INFERRED.

- **337 fail-closed guard sites** in `packages/{action,core}/src` (non-test),
  as a research baseline only. The executable gate re-derives `N` at run time.
  **127** are reached by any test. **0** are reached by a captured artifact.
  All 29 fixture files under the five `__fixtures__`/`fixtures` directories are
  hand-authored (`acme/widget`, sequential-hex SHAs, 2–4 line logs, no ANSI).
- Of the four guards that crashed Sutura on our own real failures,
  `packages/action/src/github.ts:238` ("Workflow run metadata does not match")
  and `packages/core/src/orchestrate.ts:509` ("Failed-step logs do not contain
  an observed failing command") are reached by **no test**;
  `packages/core/src/runtime/detect.ts:58` and `packages/core/src/llm/json.ts:74`
  are reached only by hand-typed input. `classify.ts:175` has a near-identical
  message that *is* tested and that a text search mistakes for coverage.
- The replay suite (`packages/core/src/engine/repair-provider-replay.test.ts`,
  `orchestrate.test.ts:552/1079/1152`) sends real serialized requests through
  `createTokenFactoryClient` but every provider reply is an inline literal from
  `providerResponse()` (`:51-70`). No run ID, SHA, or artifact hash links a test
  to the live run it is named after.
- A `gave-up` cannot be replayed locally: the case file is presentational HTML
  (`packages/core/src/report/casefile.ts:342`); `caseFile.trace` is populated at
  `heal.ts:639` but never leaves the process; wire bodies are built at
  `nebius.ts:414-439` and discarded; no CLI accepts a run ID or artifact
  (`packages/cli/src/args.ts:6-16`); `sutura heal` hard-requires live ConTree and
  Nebius credentials (`packages/cli/src/heal.ts:409-420`).
- Dogfood dispatch is manual: 16 hand-typed two-file commits and 16 hand-run
  `gh workflow run ci.yml --ref dogfood/sutura-v02-live-N`. The fixture
  (`packages/core/src/dogfood-add.ts` + `.test.ts`, `left - right`) is committed
  nowhere and absent from the 51-case Placebo corpus. All 16 dogfood branches and
  `sutura/fix-33118205130` are deleted from the remote.
- No executable dispatch gate exists. The canary result is stdout-only
  (`scripts/provider-contract-canary.mjs`), never persisted or bound to a SHA.
  `grep -rn consecutive` finds one prose line. There is no `dogfood` release
  evidence id (`scripts/release-evidence.mjs:16-19`).
- `require-fixed` was added in `82aabdf` at 19:34Z on 2026-08-29, 72 minutes
  after the last dogfood run; all 16 live Sutura runs are green in the Actions
  UI despite `gave-up`.
- Cost per live attempt: ~$0.56 ConTree sandbox + ~$0.001 inference + ~12 min
  CI (`docs/research/2026-08-29-ci-failure-retrospective.md:167-169`). Sandbox
  cost is read from the provider (`contree.ts:604`) and summed, never capped.

## Decisions taken with the user (2026-08-30)

1. **Live spend:** the streak script is batch-authorized once per streak
   attempt; it runs up to 10 sequential gated runs on one exact SHA, halts on
   the first non-`fixed`, and stops at a hard cap of USD 10.00. Before each
   dispatch it reserves USD 1.50 for attempt 1, then the highest observed
   per-attempt cost, and refuses when `spent + reserve > USD 10.00`.
2. **Capture policy:** replay capture is an opt-in Action input
   `capture-replay` (default `false`). Sutura's own `sutura.yml` sets it
   `true`. Authorization headers are never recorded; existing credential
   redaction (`packages/core/src/security/external-text.ts`) is applied to
   every recorded string; artifact visibility equals repository read access.
3. **Guard scope:** all product guards in the run-time-derived `N` get a
   reaching test. Guards at the six
   external input boundaries must additionally be driven by captured fixtures,
   enforced by a contract test.

## Approved Phase 5 cap extension (2026-08-31)

The user authorized completion of the remaining four samples under a total
Phase 5 live-spend cap of USD 14.00. The streak runner now applies the cap to
all entries in the scratch ledger, including earlier non-fixed candidates,
rather than only to the trailing fixed entries for the current candidate. At
authorization, prior Phase 5 spend was USD 9.153422 and candidate
`a99e23199a80ae6ee51fe1680afb74188416160c` had six consecutive fixed entries.
The existing reserve rule remains unchanged, and the runner still halts on the
first non-`fixed` outcome.

## Approved implementation corrections (2026-08-30)

The user approved these corrections after implementation preflight found that
the original mechanics could not satisfy their own acceptance criteria:

1. `RepositoryPort` is the sixth recorded boundary. Phase 1 records
   `readPolicyAtSha`, `checkoutHead`, `readSourceExcerpts`, and `publishFix`.
   Nebius, Tavily, and ConTree use boundary-specific recorders that share one
   bundle writer; ConTree replay records logical executor operations rather
   than assuming every request body is a string.
2. Guard acceptance is dynamic `N/N`. The scanner finds inline and multiline
   guards, excludes test-support code, maps Istanbul `statementMap` + `s` hits
   to source lines, and deletes structurally unreachable guards with a note.
3. Historical capture produces 26 unique CI-run partial bundles. They test the
   GitHub and log-parsing boundaries only. Full `sutura replay` is accepted only
   for complete bundles from the authorized capture session or Phase 5.
4. The streak writes in-progress ledger state under a gitignored scratch path.
   It commits the canonical ledger once the streak ends, explicitly dispatches
   `ci.yml` on each repair branch, and correlates the Sutura run through the
   `sutura-case-file-<ciRunId>.html` artifact name.
5. The verified Phase 1-4 candidate is merged and pushed to `develop`, and its
   exact push CI must be green, before Phase 5. The ledger or gave-up repair is
   integrated afterward.
6. Phase 5 retains a separate stop for one-time live-spend authorization. No
   canary or dogfood attempt is dispatched before that authorization.

## Design options

### D1: Where captures happen

**Selected:** wrap the existing injection points — `NebiusClientDependencies.fetch`
(`packages/core/src/llm/nebius.ts:52`), `ContreeExecutorConfig.fetch`
(`packages/core/src/executor/contree.ts:103`), `TavilyClientDependencies.fetch`
(`packages/core/src/diagnose/tavily.ts:33`), and the `GitHubApi` interface
(`packages/action/src/github.ts`, implemented by `createGitHubApi` in
`octokit.ts`) — with three boundary-specific HTTP recorders, plus GitHub and
`RepositoryPort` decorators, that append to one `ReplayBundle`. The bundle is
uploaded as a second artifact `sutura-replay-<runId>.json` beside the HTML.

*Rejected:* extending `TraceEvent` with raw bodies (the sanitizer at
`packages/core/src/trace/sanitize.ts:6-11` strips `prompt`, `response`,
`source`, `diff` by design and caps strings at 500 chars); embedding JSON in
the HTML case file (one artifact, one purpose; HTML consumers do not want
megabytes of JSON).

### D2: Bootstrapping captured fixtures from history

**Selected:** `scripts/capture-run.mjs` materializes the GitHub half of a
bundle (workflow run, jobs, raw job logs) for any historical run ID via
`gh api`. The A, B, and C evidence maps to 26 unique triggering CI runs; B
identities are stored separately instead of duplicated as new CI bundles.
These partial bundles test GitHub and log parsing only. The provider half is captured by the canary
(~$0.001 per call). The ConTree half needs one authorized live sandbox run.

*Rejected:* waiting for the first gated live run to produce every fixture —
Phase 3 would have nothing real to test against.

### D3: Enforcing "every guard is tested"

**Selected:** install `@vitest/coverage-v8`; `scripts/guards-verify.mjs`
statically scans product guard sites anywhere on a line, maps Istanbul
statements and hits to source lines, and fails on any guard line with zero hits.
A separate contract test asserts that boundary test files load fixtures from
`__fixtures__/captured/` with a manifest entry (run ID, head SHA, artifact
SHA-256).

*Rejected:* a hand-maintained guard-to-test allowlist — it drifts exactly like
the prose rules did.

### D4: Dispatch gate and streak

**Selected:** `scripts/dogfood.mjs` with `gate`, `run`, and `streak`
subcommands and an append-only, content-hashed ledger at
`docs/demo/dogfood-ledger.json`. In-progress entries stay in a gitignored
scratch file so the exact candidate remains clean; the canonical ledger is
written once at streak end. A new `dogfood` release-evidence id requires
at least 10 consecutive `fixed` entries whose Action SHA has the same
`packages/` tree hash as the release commit. The streak is keyed to the code,
so any `packages/` change resets it.

*Rejected:* keying the streak to the `develop` SHA (a docs-only commit would
reset it) or to the Action bundle hash alone (core changes reach the CLI path
without changing the bundle).

### D5: Local replay

**Selected:** `sutura replay --bundle <file> --format json` runs the real
`orchestrate()` (`packages/core/src/orchestrate.ts:482`) against a recorded
`GitHubApi`, recorded provider and Tavily fetches, and a recorded `Executor`
keyed by operation sequence. It accepts complete bundles only; historical
partial bundles are consumed by boundary-level regression tests. No credentials. The produced `CaseFile` outcome
must equal the recorded outcome.

*Rejected:* provider-only replay at the `runControlledRepairAttempt` level
(what exists today) — it cannot reproduce log-parsing, source-closure, runtime
detection, or sandbox terminals, which were 10 of the 16 live give-ups.

## Architecture

```text
live Sutura run (capture-replay: true)
  GitHubApi ──recorder──┐
  RepositoryPort ─record┤
  Nebius fetch ─recorder┤
  Tavily fetch ─recorder┼──> ReplayBundle ──redact──> sutura-replay-<runId>.json (artifact)
  ConTree fetch recorder┘                                  │
                                                           ▼
                                  scripts/capture-run.mjs <run-id>   (or historical GitHub-only)
                                                           │
                                                           ▼
                        packages/*/src/__fixtures__/captured/<runId>/bundle.json + manifest.json
                                                           │
                    ┌──────────────────────────────────────┼────────────────────────┐
                    ▼                                      ▼                        ▼
   guard tests (boundary guards must load captured)   sutura replay --bundle    scripts/dogfood.mjs gate
   scripts/guards-verify.mjs (v8 line hits)           (offline orchestrate)     (CI green + canary artifact
                                                                                 + last gave-up replays)
                                                                                        │
                                                                                        ▼
                                                                          dogfood.mjs streak ──> ledger
                                                                                        │
                                                                                        ▼
                                                                    release evidence id `dogfood` (≥10 consecutive)
```

## Cross-phase invariants

1. A recorded bundle never contains an `Authorization` header value, an API
   key, a bearer token, or any string that fails
   `redactExternalText` (`packages/core/src/security/external-text.ts`).
   A contract test greps every committed captured fixture for
   `/Bearer\s+\S+|sk-|nb-|ghp_|github_pat_/u` and fails on a hit.
2. Recording never changes production behavior: with `capture-replay` false,
   no recorder is constructed and no bundle artifact exists. The e2e storyline
   mutation counts (`orchestration.e2e.test.ts:667-683`) remain unchanged.
3. Replay is deterministic: the same bundle produces the same `CaseFile`
   outcome, candidate ID, and diff hash on every run, with no network access
   (tests run with `fetch` replaced by a throwing stub).
4. A boundary guard test that loads a hand-written fixture fails the
   captured-fixture contract test. The six boundaries are: GitHub run
   metadata + job logs (`packages/action/src/github.ts`, `octokit.ts`),
   provider HTTP (`packages/core/src/llm/nebius.ts`, `json.ts`), ConTree HTTP
   (`packages/core/src/executor/contree.ts`), Tavily HTTP
   (`packages/core/src/diagnose/tavily.ts`), and checkout filesystem / runtime
   detection (`packages/action/src/repository.ts`,
   `packages/core/src/runtime/detect.ts`, `python.ts`), plus the
   `RepositoryPort` call stream.
5. `scripts/guards-verify.mjs` fails CI when any derived product guard site in
   `packages/{action,core}/src` (excluding tests and test support) has zero v8 hits.
6. `scripts/dogfood.mjs gate` refuses to dispatch unless all four conditions
   hold on the exact `HEAD` SHA: clean tree and `HEAD == origin/develop`; CI
   `success` for `head_sha == HEAD` on `develop`; a canary artifact whose
   `headSha == HEAD` and whose contract version equals
   `SUPER_REPAIR_PROVIDER_CONTRACT_VERSION`; and the last ledger entry is
   `fixed`, or its bundle has a named replay test whose name contains the run
   ID and that passes.
7. The ledger is append-only. Every entry carries the CI run ID, Sutura run ID,
   dogfood SHA, Action SHA, `packages/` tree hash, outcome, bundle artifact
   SHA-256, sandbox USD, and inference USD. `resultHash` is the canonical-JSON
   hash of all entries.
8. `streak` halts on the first non-`fixed` outcome and refuses the next
   dispatch when total Phase 5 ledger spend plus the reserved per-attempt
   headroom would exceed USD 14.00.
9. After a `gave-up`, no candidate is pushed to `develop` until the bundle is
   committed as a captured fixture, a named replay test reproduces the
   terminal, and the complete local gate (`pnpm run ci:local`) passes.
10. Rebuild and commit `packages/action/dist/index.cjs` in the same commit as
    any `packages/core` or `packages/action` source change
    (`.claude/rules/ci-parity.md`).

## Phase sequence

| Phase | Name | Dependency | Batch status |
| ---: | --- | --- | --- |
| 1 | Replay bundle capture at the six boundaries | None | Sequential |
| 2 | Historical capture, bundle contract, `sutura replay`, captured-fixture manifest | Phase 1 | Sequential |
| 3a | Guard tests: GitHub adapter, repository, orchestration | Phase 2 | `[batch-eligible]` |
| 3b | Guard tests: provider, Tavily, ConTree, routing | Phase 2 | `[batch-eligible]` |
| 3c | Guard tests: engine, budget, policy, runtime, config + `guards:verify` | Phase 2 | `[batch-eligible]` |
| 4 | Dogfood automation: canonical fixture, gate, streak, ledger, canary artifact, evidence id | Phase 2 | `[batch-eligible]` |
| 5 | Live 10/10 streak and the gave-up loop | Phases 3a, 3b, 3c, 4 | Sequential; batch-authorized |

Batch note: 3a, 3b, 3c, and 4 share no source files. 3a/3b/3c each add tests
and captured fixtures under disjoint module directories and touch no
production `.ts` other than adding an `export` where a guard is currently
private. Phase 4 touches `scripts/`, `.github/workflows/`, `packages/placebo/`,
`docs/demo/`, and `packages/action/src/workflow.test.ts` only. `[batch-eligible]`
means `/batch` may run them in four worktrees, each opening its own PR.

Detailed phase files:

- `docs/plans/2026-08-30-first-try-repair-reliability-phases/phase-1.md`
- `docs/plans/2026-08-30-first-try-repair-reliability-phases/phase-2.md`
- `docs/plans/2026-08-30-first-try-repair-reliability-phases/phase-3a.md`
- `docs/plans/2026-08-30-first-try-repair-reliability-phases/phase-3b.md`
- `docs/plans/2026-08-30-first-try-repair-reliability-phases/phase-3c.md`
- `docs/plans/2026-08-30-first-try-repair-reliability-phases/phase-4.md`
- `docs/plans/2026-08-30-first-try-repair-reliability-phases/phase-5.md`

## Local verification gate

Run sequentially with `;` or `&&`, never as parallel calls:

```bash
pnpm run ci:fast
pnpm run guards:verify            # from Phase 3c onward
pnpm run test:captured-fixtures   # from Phase 2 onward
pnpm run ci:local
git diff --check
```

Then `/simplify` (reuse, quality, efficiency), fix all findings, and repeat.

## Final automated acceptance

- With `capture-replay: true`, a Sutura run uploads exactly two artifacts:
  `sutura-case-file-<runId>.html` and `sutura-replay-<runId>.json`; with the
  input false, exactly one.
- `sutura replay --bundle` of every complete committed captured bundle
  reproduces the recorded outcome offline; historical partial bundles drive
  GitHub and log-parsing boundary tests only.
- `scripts/guards-verify.mjs` reports `N/N` guard sites hit, with `N`
  re-derived by the script at run time and never hard-coded.
- `scripts/captured-fixtures.test.mjs` proves every boundary test loads a
  manifest-backed captured fixture and no captured file contains a credential.
- `scripts/dogfood.mjs gate` refuses on each of: dirty tree, `HEAD` behind
  `origin/develop`, no CI success for `HEAD`, no canary artifact for `HEAD`,
  stale canary contract version, last ledger entry `gave-up` without a passing
  named replay test.
- `docs/demo/dogfood-ledger.json` validates, and `scripts/release-evidence.mjs`
  reports the `dogfood` id `passed` only when ≥10 consecutive `fixed` entries
  share the release commit's `packages/` tree hash.
- The complete local gate and simplification reviews pass.
- Before Phase 5, the verified Phase 1-4 SHA is merged and pushed to
  `develop`, and exact-SHA push CI is green. Execution then stops for the
  separate live-spend authorization.

## Final live acceptance (Phase 5)

1. `pnpm run dogfood gate` passes on the exact `develop` SHA.
2. `pnpm run dogfood streak --authorize` runs up to 10 gated live attempts.
3. Every attempt reports `fixed`, opens one repair PR whose commit is a direct
   child of the dogfood SHA and changes only `left - right` to `left + right`,
   and whose CI is green.
4. The ledger shows 10 consecutive `fixed` entries on one `packages/` tree
   hash; total Phase 5 ledger spend is at most USD 14.00; the `dogfood`
   evidence id is `passed`.
5. Remote dogfood and repair branches from the streak are preserved as public
   evidence.

## Scope boundaries

This plan does not publish v0.2.0, tag a release, publish npm or Marketplace
artifacts, merge to `main`, add harder dogfood fixtures, enable a public demo,
upload Data Lab records, or update Devpost. It does not cap ConTree sandbox
spend inside the product (only the streak script caps it); that is a separate
product decision.

## Completion state

- [x] Phase 1: Replay bundle capture at the six boundaries
- [x] Phase 2: Historical capture, bundle contract, `sutura replay`, captured-fixture manifest
- [x] Phase 3a: Guard tests — GitHub adapter, repository, orchestration
- [x] Phase 3b: Guard tests — provider, Tavily, ConTree, routing
- [x] Phase 3c: Guard tests — engine, budget, policy, runtime, config + `guards:verify`
- [x] Phase 4: Dogfood automation
- [x] Phase 5: Live 10/10 streak
