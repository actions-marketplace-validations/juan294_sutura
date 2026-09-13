# WS-4 evidence, submission, and release research

Date: 2026-09-04

Status: Complete

Scope: Current repository behavior for the WS-4 Phase 0, Phase 5, Phase 6,
and Phase 7 workstream.

## Workstream contract and current state

WS-4 owns 35 issues: #47-#49, #56-#58, and #99-#127. Its required order is
Phase 0 evidence, Phase 5 submission material, Phase 6 final-candidate work,
then Phase 7 public acceptance and submission
(`docs/plans/2026-09-04-sutura-issue-workstreams.md:172-210`). The shared
coordination contract requires worktree implementation, evidence on `develop`
before issue closure, a freeze check before every push, and an exact recorded
authorization boundary for live or public actions
(`docs/plans/2026-09-04-sutura-issue-workstreams.md:52-65`).

At the start of this research, local `develop`, `origin/develop`, and
`origin/HEAD` identified commit
`e58dc6ba43b6d3bdc55a5d2bcaeae4fab16bea50`. The roadmap names Phase 0 as
blocked pending accepted v0.2.1 evidence and names the
`upstream-retry-release` Tavily response as the next action
(`docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md:3-21`). Its phase
table still records Phase 0 as blocked and Phases 5-7 as not started
(`docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md:128-142`).

The v0.2.1 remediation plan has local candidate verification complete while
provider, publication, and public-state gates remain unauthorized
(`docs/plans/2026-09-01-sutura-v0.2.1-evidence-remediation.md:1-15,61-69`).
Its final phase requires one exact candidate, complete benchmark and matrices,
separate release authorization, immutable publication, and exact public
verification
(`docs/plans/2026-09-01-sutura-v0.2.1-evidence-remediation-phases/phase-4.md:1-37`).

## Push-freeze implementation

`pnpm run push-freeze` invokes `scripts/push-freeze.mjs`
(`package.json:21-23`). By default, the script resolves a marker named
`sutura-push-freeze.json` in the Git common directory, so linked worktrees read
the same state (`scripts/push-freeze.mjs:20-25`). A missing marker means no
freeze; an unreadable marker is represented as an active state with an
unreadable-marker reason (`scripts/push-freeze.mjs:27-33`).

The `on` operation requires a reason, refuses to overwrite an existing freeze,
and records the reason, an ISO timestamp, and the configured Git user
(`scripts/push-freeze.mjs:59-73`). The `off` operation removes the marker and
is idempotent (`scripts/push-freeze.mjs:75-82`). `status` always exits
successfully and distinguishes the two states in its output, while `check`
returns failure only when a marker exists (`scripts/push-freeze.mjs:84-91`).

The pre-push hook calls `push-freeze.mjs check` before `pnpm run ci:fast`
(`.husky/pre-push:1-6`). Tests cover common-directory resolution, the complete
freeze lifecycle, refusal to overwrite a freeze, CLI exit status, and the fact
that the pre-push hook does not start verification while frozen
(`scripts/push-freeze.test.mjs:25-103`). At the research snapshot,
`pnpm run push-freeze status` reported no active freeze.

## Paid-run dispatch paths

The Placebo single-case path requires literal `--authorize`, takes the local
lock, runs the existing candidate gate, and dispatches
`placebo-live-case.yml` with exact controller, subject, case, and correlation
identities (`scripts/placebo-live.mjs:576-615,659-670`). The streak path runs
the candidate gate once and dispatches later cases with that gate skipped
(`scripts/placebo-live.mjs:671-684`). Its case loop reserves budget before
each dispatch and stops on cap reserve, false approval, or infrastructure stop
(`scripts/placebo-live.mjs:396-428`).

The Placebo candidate gate requires controller and subject identity to be the
same exact commit, delegates to the dogfood release gate, and validates the
canonical 51-case corpus (`scripts/placebo-live.mjs:527-539`). The workflow
checks out and verifies the exact controller and subject, passes provider
credentials only to the live case step, and uploads one bounded artifact
(`.github/workflows/placebo-live-case.yml:32-80,92-125`).

The external-matrix path validates exact controller, Action, and demo
identities; delegates to the Placebo candidate gate; verifies demo `main` and
its exact CI; and confirms required secret and variable names
(`scripts/external-matrix-live.mjs:365-393`). Its single-case and streak paths
dispatch `matrix-case.yml` in `juan294/sutura-demo` and retain one validated
case artifact per run (`scripts/external-matrix-live.mjs:432-474,510-550`).
Its loop uses the same reserve decision and stops on cap reserve, false
approval, or infrastructure stop
(`scripts/external-matrix-live.mjs:215-249`).

Neither runner imports or reads the push-freeze controller before its
`gh workflow run` call. The Placebo dispatch call is at
`scripts/placebo-live.mjs:576-585`; the external-matrix dispatch call is at
`scripts/external-matrix-live.mjs:432-439`. Their current test imports cover
artifact, ledger, streak, cleanup, and finalization helpers, but not a
freeze-state dispatch helper (`scripts/placebo-live.test.mjs:5-16`;
`scripts/external-matrix-live.test.mjs:4-14`).

## Tavily and `upstream-retry-release`

The Tavily client posts to `https://api.tavily.com/search` with bearer
authentication, JSON content type, the redacted query, a bounded result count,
basic depth, and no generated answer
(`packages/core/src/diagnose/tavily.ts:6,99-101,120-167`). A non-success HTTP
response becomes a `TavilyRequestError` containing its status code
(`packages/core/src/diagnose/tavily.ts:172-177`). The separate extraction path
uses `/extract`; extraction failures during optional registry-backed release
enrichment do not discard a successful primary search
(`packages/core/src/diagnose/tavily.ts:201-266,414-448`).

Grounding derives a bounded query from the diagnosis, lockfile additions, and
validated dependency hints, redacts it, awaits primary search, then adds any
registry-verified release citations
(`packages/core/src/diagnose/tavily.ts:292-404,451-477`). The CLI reads a
trimmed `TAVILY_API_KEY`, constructs this client for an enabled run, and turns
an escaped runtime error into a public `infra-stop` case file
(`packages/core/src/config.ts:202-205`; `packages/cli/src/heal.ts:398-433`;
`packages/cli/src/cli.ts:38-80,150-157`).

The Placebo harness evaluates every upstream case first with Tavily and then
without Tavily (`packages/placebo/src/harness.ts:101-120`). The
`upstream-retry-release` fixture models an Execa 5 to Execa 6 change and
declares an expected grounded repair
(`packages/placebo/corpus/upstream-retry-release/metadata.json:1`).

The latest retained artifact for that case identifies workflow run
`33855319374` and controller/subject
`da98aff6a9d25e8cbb9818429ea91cdc49623262`. Its Tavily evaluation is
`infra-stop` with `Tavily search request failed with status 403`; its paired
disabled evaluation is `gave-up`
(`.sutura/placebo-v0.2.1-live-artifacts/upstream-retry-release.json:1`). The
same ledger records USD 0.09690827 total for that two-evaluation case
(`.sutura/placebo-v0.2.1-live-ledger.json:1`).

Earlier recorded executions of the same fixture completed as `fixed` with
Tavily in runs `33788056265` and `33837788877`
(`docs/plans/2026-09-03-sutura-search-recovery.md:17-46`). On the newest
four-case sequence, the preceding client, formatter, and parser cases produced
six, six, and seven Tavily citations respectively before the retry case's 403,
as retained in their current local artifacts
(`.sutura/placebo-v0.2.1-live-artifacts/upstream-client-release.json:1`;
`.sutura/placebo-v0.2.1-live-artifacts/upstream-formatter-release.json:1`;
`.sutura/placebo-v0.2.1-live-artifacts/upstream-parser-release.json:1`).

## Existing submission and release material

The README already contains the product name and one-line value statement,
the runtime architecture diagram, the repair workflow, provider-role mapping,
and the current measured baseline (`README.md:1-120`). It also documents the
evaluation manifest, ATIF export, local Data Lab export boundary, release
gates, and Placebo command surface (`README.md:291-343,381-393`).

The repository has a local Nebius feedback draft. It separates locally tested
integration behavior from current service claims, lists observed integration
needs, and records requested SDK, schema, metrics, retention, and credential
capabilities (`docs/feedback/2026-10-sutura-nebius-feedback.md:1-48`). There is
no `docs/devpost/` directory in the research snapshot. The roadmap supplies
the required Phase 5 content list and the exact six-part, sub-three-minute
video timing (`docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md:333-369`).

The current v0.2.0 evidence index records the benchmark and both matrices as
failed, dogfood/release/local/npm evidence as passed, and demo, Marketplace,
feedback, and Devpost as pending
(`docs/demo/sutura-v0.2.0-phase-0-evidence.md:9-35`). The v0.2.1 requirements
retain eleven required evidence identities and seven authorization gates
(`docs/demo/sutura-v0.2.1-release-evidence-requirements.json:1`). The evidence
builder rejects unfinished reference text, binds exact candidate identities,
and computes completeness and readiness from those records
(`scripts/release-evidence.mjs:114-225`).

The exact-SHA candidate workflow runs release-contract tests, builds the
repository, checks the committed Action bundle, runs the runtime-image canary,
and verifies candidate installation without publishing
(`.github/workflows/release-candidate.yml:1-53`). The public publish workflow
verifies tag, version, `main`, CI, package, and Action identities around npm
publication and public installation (`.github/workflows/publish.yml:1-76`).
The adopted release-verification model fixes candidate identity before
evidence, rejects zero-pass and required misses, and places tag creation after
complete evidence and authorization
(`docs/release/e2e-pro-playbook.md:150-175,997-1085`).

## Cross-workstream boundary

The first Phase 6 candidate must contain the merged output of WS-1, WS-2, and
WS-3 (`docs/plans/2026-09-04-sutura-issue-workstreams.md:30`). WS-1 supplies
the signed-out acceptance script that WS-4 runs for issues #116-#118
(`docs/plans/2026-09-04-sutura-issue-workstreams.md:104,207`). At the research
snapshot, none of the three upstream workstreams had terminal evidence on
`develop`; therefore their merged output and the final signed-out script were
not yet present.
