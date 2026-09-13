# Sutura Case Lab research: current demo path, replay contracts, and the control-plane decision

Date: 2026-09-04

Status: Complete

Workstream: WS-1 Public Case Lab (`docs/plans/2026-09-04-sutura-issue-workstreams.md:81-106`)

Issues: #68, #59, #60, #63, #62, #61, #64, #65, #66, #67, #51, #50

Base commit: `be0f59a` on `develop`

## Questions

1. What is the current demo path, and where is the collaborator-only `workflow_dispatch` instruction that issue #68 removes?
2. What replay contracts exist, and what evidence can drive a deterministic replay for each of the five Case Lab scenarios?
3. Do Nebius Serverless Jobs or Serverless Endpoints satisfy the roadmap conditions for the public control plane (asynchronous execution, secret isolation, request limits, stable result URLs)?
4. Which existing patterns (dispatch, gates, evidence, security, packaging) does a new Case Lab package inherit?

## 1. Current demo path

### 1.1 The instruction lives in a second public repository

The collaborator-only instruction is not in this repository. It is the "Judge path" section of the separate public repository `juan294/sutura-demo`, cloned at `/Users/juan/code/sutura-demo` (HEAD `4835920dd49b3ddc2fde7181309b48c4f7831ec0`, remote `main`, `has_pages: false`):

- `/Users/juan/code/sutura-demo/README.md:7-14` tells visitors to open **Actions → Break me → Run workflow**, select `assertion`, `flaky`, `upstream`, or `greenwash-bait`, and watch the pull requests.
- `/Users/juan/code/sutura-demo/README.md:50` pins the Action to commit `b2ee9e0435b8db235030e25b2c7a350cc83131bc`.
- `/Users/juan/code/sutura-demo/.github/workflows/break-me.yml:4-14` is the `workflow_dispatch` trigger with one `choice` input `failure`; its permissions are `actions: write`, `contents: write`, `pull-requests: write` (`:16-19`).
- `/Users/juan/code/sutura-demo/.github/workflows/sutura.yml:29` uses `juan294/sutura/packages/action@b2ee9e0435b8db235030e25b2c7a350cc83131bc`.

`docs/research/2026-08-28-sutura-two-month-opportunity-research.md:367` records why the trigger is collaborator-only: "GitHub requires write access to run a manual workflow." `docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-11.md:19-23` named the same README lines and the same stale pin.

This repository's README already replaced its own link to the judge demo. Commit `7fd26d1` changed the paragraph to the current text at `README.md:15-17`: "The public judge demo remains disabled until the release, provider-spend, and non-collaborator acceptance gates are authorized and pass against one exact release commit." No `workflow_dispatch` instruction remains in `README.md` (`git log -S "workflow_dispatch" -- README.md` returns nothing).

### 1.2 What the demo repository already contains

`/Users/juan/code/sutura-demo` (three commits: `82123a8`, `c63e7bc`, `4835920`) holds four committed break patches and one matrix materializer:

- `.breaks/assertion.diff`, `.breaks/flaky.diff`, `.breaks/greenwash-bait.diff`, `.breaks/upstream.diff`, applied by `scripts/materialize-break.mjs` with `git apply --check` (`README.md:50`).
- `scripts/materialize-matrix-case.mjs` materializes the eight external matrix cases, including `python-repair` (fixture `python-repair-missing-await`) and `python-refusal` (`scripts/test-external-matrix.mjs:15-24` in this repository).
- `.github/workflows/matrix-case.yml` (collaborator dispatch) checks out the exact demo commit and the exact Sutura commit with `persist-credentials: false`, validates every input with bash regexes, builds Sutura, materializes a fixture, pushes a controller-owned `matrix/<controller-id>/<case-id>` branch, dispatches `matrix-fixture-ci.yml`, waits for the red run, runs `./.sutura-action/packages/action` with `capture-replay: 'true'`, downloads its own `sutura-replay-<ci-run-id>.json` artifact with `gh run download "$GITHUB_RUN_ID"`, locates the `sutura-case-file-<ci-run-id>.html` artifact id, and uploads one public-safe evidence artifact (`matrix-case.yml:37-227`).
- `.github/workflows/sutura.yml:3-12` triggers on `workflow_run` of `CI` and on `workflow_dispatch` with a `run_id` input; it skips `matrix/` branches (`:25-31`).

The demo repository has the secrets `CONTREE_TOKEN`, `NEBIUS_API_KEY`, `TAVILY_API_KEY` and the variable `CONTREE_PROJECT` (`gh api /repos/juan294/sutura-demo/actions/secrets` and `.../variables` on 2026-09-04). Its default workflow token permission is `read` with `can_approve_pull_request_reviews: true`.

The five roadmap scenarios map onto materializers that already exist:

| Scenario (`docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md:191-197`) | Demo materializer | Placebo case | Expected outcome |
| --- | --- | --- | --- |
| JavaScript repair | `.breaks/assertion.diff` | `repair-off-by-one` | `fixed` |
| Python repair | `scripts/materialize-matrix-case.mjs python-repair` | `python-repair-missing-await` | `fixed` |
| Deterministic flaky failure | `.breaks/flaky.diff` | `flaky-timer-race` | `flaky-no-patch` |
| Greenwash trap | `.breaks/greenwash-bait.diff` | `trap-weakened-expect` | `refused` |
| Upstream dependency incident | `.breaks/upstream.diff` | `upstream-formatter-release` | `fixed` with Tavily grounding |

The expected outcomes come from `docs/demo/placebo-v0.2-corpus.json` (`metadata.expected` per case) and `scripts/test-external-matrix.mjs:15-24`.

### 1.3 The `demo` evidence record

`docs/demo/sutura-v0.2.1-release-evidence-requirements.json` lists `demo` among eleven required records, names the gate `public-demo-enable`, assigns `"demo": 1` (the only Phase 1 owned record), and sets `pendingMeansNotReleaseReady: true`. `scripts/release-evidence.mjs:21-24` freezes the ID list; `:149` restricts evidence references to `docs/demo/` or `docs/feedback/` paths or GitHub URLs and checks the SHA-256 of the referenced file. There is no builder for the `demo` record; it arrives from the input file and is validated generically. The materialized record in `docs/demo/sutura-v0.2.0-release-evidence.json` is `{"id":"demo","required":true,"status":"pending","evidence":[],"authorizationGate":"public-demo-enable"}`.

### 1.4 Hosting state

Neither repository has GitHub Pages (`gh api repos/juan294/sutura/pages` returns 404; both report `has_pages: false`). There is no committed `.html` file, no `site/` directory, and no Pages workflow (`git ls-files '*.html'` is empty). `CLAUDE.md` states "No hosted deployment."

Available deployment tooling on this machine, checked on 2026-09-04: the Vercel CLI 59.11.2 is installed and authenticated as `juan294` (`vercel whoami`), with one team (`thecreativetoken`) and several unrelated projects. `nebius`, `contree`, `wrangler`, `netlify`, and `flyctl` are not installed. `NEBIUS_API_KEY`, `CONTREE_TOKEN`, `CONTREE_PROJECT`, `TAVILY_API_KEY`, and `NEBIUS_IAM_TOKEN` are unset in the local shell. No `~/.nebius` directory exists.

### 1.5 GitHub access facts that bound a public trigger

- Creating a `workflow_dispatch` event requires the fine-grained token permission "Actions" with write access (`POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` is listed under Actions write in the GitHub fine-grained permissions reference). Reading runs and artifacts (`GET .../actions/runs/{run_id}`, `GET .../actions/artifacts`) needs Actions read.
- The dispatch response returns `workflow_run_id`, and at most 25 inputs are accepted.
- Reading a workflow run on a public repository needs no authentication ("Anyone with read access to the repository can use this endpoint").
- Downloading a workflow artifact requires a signed-in user with read access. Signed-out visitors receive 404 on artifact URLs. Workflow run pages, pull requests, check runs, commit comments, and raw file content on public repositories are readable signed-out.
- `juan294/sutura` branch protection on `develop` requires the `checks` status context; default workflow permissions are `read`; `sha_pinning_required` is `false`. The local `gh` token has `repo` and `workflow` scopes.

## 2. Replay contracts

### 2.1 Bundle schema and validation

`packages/core/src/replay/bundle.ts:15` defines `REPLAY_BUNDLE_SCHEMA_VERSION = 'sutura-replay-v1'`, with caps `MAX_BODY_BYTES = 1 MiB`, `MAX_HTTP_EXCHANGES = 512`, `MAX_PORT_CALLS = 256`, `MAX_EXECUTOR_CALLS = 512` (`:17-20`). The bundle type at `bundle.ts:132-149` carries `runId`, `repo`, `actionSha`, `capturedAt`, the recorded `github`, `repository`, `executor`, and `http` streams, the `configuration` (triage, race, budgets, search limits, runtime, image, models, routing profile), `completeness: { complete, overflowedBoundaries, pendingBoundaries }`, and an optional `outcome`. Boundaries are `github | repository | executor | nebius | tavily | contree` (`:62-68`).

`ReplayRecorder.finish(outcome)` (`bundle.ts:597`) computes `complete = overflowedBoundaries.length === 0 && pendingBoundaries.length === 0` (`:616`). Over-cap calls mark overflow and downgrade the bundle to partial rather than throwing (`:441-462`).

`parseReplayBundle` (`packages/core/src/replay/validate.ts:410`) validates every field and throws `ReplayValidationError` (`:38`) with messages such as `bundle.completeness is internally inconsistent` (`:484`), `bundle.completeness is missing completed <streams> streams` (`:495`), and `bundle.completeness contains truncated or unreplayable body evidence` (`:502`).

### 2.2 Replaying a bundle

`replayBundle` (`packages/core/src/replay/replay-orchestrate.ts:66`) refuses partial bundles with `ReplayValidationError('bundle', 'is partial; complete provider, repository, and sandbox recordings are required')` (`:71-76`), builds recorded-call cursors for ports, HTTP (excluding `contree`, which is replayed through the recorded executor), and executor calls (`:79-92`), constructs a `GitHubAdapter` over the replaying API, a Token Factory client with `apiKey: 'replay-only'` and a replay `fetch`, and a `TavilyClient('replay-only')` (`:100-111`), then calls the real `orchestrate` with the recorded configuration (`:114-140`). Every cursor must be fully consumed (`:141`), so a replay that diverges from the recording fails.

The CLI command `sutura replay --bundle <path> --format json` (`packages/cli/src/replay.ts:49-70`) reads a bundle bounded to 16 MiB (`:11`, `:20-46`), parses it, replays it, and throws `Replay outcome mismatch: recorded <a>, replayed <b>` when the replayed outcome differs from the recorded one (`:62-67`). It needs no credentials, network, or sandbox. `README.md:220-226` documents the command.

Recording is opt-in through the Action input `capture-replay` (`action.yml:38-41`; `packages/action/src/input.ts:118`; `packages/action/src/main.ts:79`). A recorded run uploads `sutura-replay-<runId>.json` as a workflow artifact (`packages/core/src/orchestrate.ts:509-524`), best effort, next to `sutura-case-file-<runId>.html` (`:494-507`).

### 2.3 Existing complete bundles

`packages/action/src/__fixtures__/captured/manifest.json` (`schemaVersion: sutura-captured-fixtures-v1`) lists 29 captured entries. Twenty-six record only the `github` boundary. Three are full-boundary captures (`contree`, `executor`, `github`, `nebius`, `repository`): `33321106629` (dogfood gave-up), `33323765566` (dogfood streak attempt 1 gave-up), and `33325938237` (dogfood refused after Ultra returned null tool calls). No complete bundle exists for a `fixed` or `flaky-no-patch` outcome, and none corresponds to a Placebo case. `packages/core/src/replay/complete-bundle.test-helper.ts` builds a synthetic complete bundle for tests (exported as `createCompleteReplayBundleForTest`, `packages/core/src/index.ts:167`). Two of the three complete bundles no longer replay on `develop`: `packages/core/src/replay/replay-orchestrate.test.ts:121` and `:143` assert that they fail closed with `ReplayMismatchError` because request shapes drifted since capture. A bundle therefore replays only against the Sutura commit family that recorded it; the bundle carries that identity in `actionSha` (`bundle.ts:135`).

### 2.4 Committed recorded results for the five scenarios

`docs/demo/placebo-v0.2-live-2026-09.json` (`schemaVersion: sutura-placebo-live-result-v1`, subject `a943ded4c734aed75c5c63f2b2dd63a2f44556c2`, controller `48ac760399950dcc82542ffba5269323da3a1e76`) contains 55 `results`, each with `caseId`, `caseFile`, `elapsedTimeMs`, `failureClass`, `flakePattern`, `kind`, `language`, `tavilyEnabled`, `triageExitCodes`. Every `caseFile` is a complete `CaseFile` (`packages/core/src/domain.ts:149-167`) with `diagnosis`, `triage`, `race`, `audit`, `selectedCandidate`, `outcome`, `cost.entries`, `policy`, `stages` with per-stage `metrics` (cost, elapsed, CPU, RSS), and `search`. `docs/demo/placebo-v0.2-live-ledger-2026-09.json` maps each case to its public run URL, artifact name, artifact SHA-256, and cost.

Recorded outcomes for the five scenario cases in that file:

| Case | Recorded outcome | Inference USD | Sandbox USD | Stages | Search nodes |
| --- | --- | ---: | ---: | ---: | ---: |
| `repair-off-by-one` | `fixed` | 0.005507 | 0.1503 | 27 | 4 |
| `python-repair-missing-await` | `infra-stop` | 0 | 0 | 1 | 0 |
| `flaky-timer-race` | `flaky-no-patch` | 0.000434 | 0.1042 | 13 | 0 |
| `trap-weakened-expect` | `refused` | 0.000223 | 0.0972 | 13 | 0 |
| `upstream-formatter-release` | `infra-stop` (both Tavily arms) | 0 | 0.0388 | 4 | 0 |

The Python and upstream results are `infra-stop` because the v0.2.0 Python image digest returned HTTP 404 in ConTree and the upstream dependency snapshot omitted `file:vendor/...` packages (`docs/plans/2026-09-01-sutura-v0.2.1-evidence-remediation-notes.md:9`, `:25-27`). Both defects were remediated locally on `develop` (`packages/core/src/runtime/python.ts:25-26` pins the replacement digests; the notes file records the dependency snapshot fix), but no live v0.2.1 result exists yet. The v0.2.1 benchmark is WS-4 issue #47.

`docs/demo/sutura-v0.2.0-public-matrix.json` records the eight-case public matrix at demo commit `4835920dd49b3ddc2fde7181309b48c4f7831ec0` with `outcomeLinks` to demo workflow runs, artifacts, pull requests, and check runs (for example `https://github.com/juan294/sutura-demo/pull/17`), `javascript-repair` passed as `fixed`, `javascript-flake` as `flaky-no-patch`, and `python-repair` failed as `infra-stop`.

### 2.5 Evidence rendering

`renderCaseFile` (`packages/core/src/report/casefile.ts:342-382`) renders a self-contained HTML case file with inline CSS (`STYLES`, `:216-340`), `<meta name="color-scheme" content="light dark">`, an outcome body class, and five `aria-labelledby` sections (Diagnosis, Triage, Procedure, Pathology, Discharge). All interpolated values pass through `escapeHtml` (`packages/core/src/report/format.ts:11`). `renderCaseFile` and `renderAuditCaseFile` are exported from `packages/core/src/index.ts:124-127`. The PR comment renderer is `renderComment` (`packages/core/src/report/markdown.ts:132`). `packages/action/src/evidence.ts:5-45` emits five runtime evidence log lines (`Nemotron runtime:`, `Tavily runtime:`, `ConTree runtime:`, `Sandbox evidence:`, `Policy evidence:`).

The evaluation trace and ATIF export live in `packages/evaluation/src/schema.ts:3-76` (`sutura-evaluation-v1`, `ATIF-v1.7`) and `packages/evaluation/src/atif.ts:122` (`exportAtif`). `createEvaluationManifest` (`packages/evaluation/src/manifest.ts:57`) refuses a dirty repository and requires an exact 40-character commit.

## 3. Nebius serverless facts

Checked on 2026-09-04 against `https://docs.nebius.com/serverless/overview`, `https://docs.nebius.com/serverless/endpoints/manage`, `https://docs.nebius.com/serverless/jobs/manage`, `https://docs.nebius.com/compute/virtual-machines/types`, and `https://nebius.com/blog/posts/introducing-serverless` (2026-03-26).

Serverless AI is "a Nebius AI Cloud service for running containerized AI workloads without creating or operating virtual machines (VMs) or clusters." Billing is "per-second for the computing and storage resources that you allocate to endpoints and jobs." Jobs and Endpoints are "currently available in public preview through the Nebius web console and CLI."

Endpoints:

- `nebius ai endpoint create` takes `--image`, `--container-command`, `--container-port`, `--env`, `--env-secret` (SecretStash `key=secret_selector`), `--auth token` with `--token` or `--token-secret`, `--platform`, `--preset`, `--public`, `--preemptible`, `--inject-file` (read-only, 64 KiB each).
- "Each HTTP port is available through a managed https:// URL." `--public` assigns a public IP but is "not required to reach the endpoint from the internet."
- Authentication: "If the parameter isn't set (default), no authentication is required"; `--auth token` enables token authentication.
- Creation takes "approximately five minutes."
- The documentation states nothing about request rate limits, request size limits, request timeouts, minimum or maximum replicas, autoscaling, or scale to zero. The example platform is `gpu-h100-sxm` with preset `1gpu-16vcpu-200gb`; the platform list page names CPU-only platforms `cpu-d3` and `cpu-e2` for Compute but does not state whether Serverless endpoints accept them.
- The launch post describes endpoints as suited for "pre-production deployments and testing scenarios" and lists startup latency as "Slow" in Q1 2026, "Moderate" in Q2-Q3 2026.

Jobs:

- `nebius ai job create` returns a job ID and runs asynchronously; creation "usually takes a few minutes."
- `--timeout` minimum 1 hour, maximum 168 hours, default 24 hours.
- Jobs have no public URL; logs are read with `nebius ai job logs <id>`; the VM is deleted on completion.
- "VMs without GPUs only support the regular type" (non-preemptible).

Pricing pages `https://docs.nebius.com/serverless/pricing`, `https://docs.nebius.com/serverless/quotas`, and `https://nebius.com/prices-serverless` return HTTP 404. Serverless pricing is not published in the fetched documentation.

Account state: no Nebius AI Cloud CLI, profile, or IAM token exists on this machine (section 1.4). The Token Factory key held as a GitHub secret authenticates the inference API at `https://api.tokenfactory.nebius.com/v1/`; it is not an AI Cloud IAM credential.

## 4. Patterns a Case Lab package inherits

### 4.1 Dispatch and polling

`scripts/placebo-live.mjs` dispatches with `gh workflow run placebo-live-case.yml --ref develop -f ...` through one `execFile` wrapper (`:479-487`, `:576-586`), polls `gh run list --json databaseId,displayTitle,status,conclusion,url,headSha` every 10 seconds for 35 minutes matching the exact `run-name` (`:541-560`), re-verifies the run's `headSha` after completion (`:551`), downloads the artifact by exact name into a temp dir, requires exactly one JSON file (`:562-574`), validates identity fields against the dispatch (`:596-600`), and appends to a lockfile-protected, atomically written ledger (`:493-515`). `scripts/external-matrix-live.mjs:24` targets `juan294/sutura-demo` with `gh workflow run matrix-case.yml -R juan294/sutura-demo --ref main` (`:432-441`) and gates on remote `main` equality, green exact-main CI, and secret presence (`:365-395`).

`.github/workflows/placebo-live-case.yml:32-42` re-validates every input with bash regexes (`^[a-f0-9]{40}$`, `^[a-z0-9-]{1,100}$`, `^[A-Za-z0-9-]{1,64}$`) before any checkout; both checkouts use `persist-credentials: false`; the corpus membership check runs in the runner (`:80`).

### 4.2 Spend and stop conditions

`placeboSpendDecision` (`scripts/placebo-live.mjs:369-378`) allows a dispatch only when `spent + max(initialReserve, observedMaximum) <= cap`, computed in integer micro-dollars; `boundedUsd` (`:32-37`) rejects values outside `[0, 100]`. Streaks require the literal `--authorize` flag (`:397`) and stop for `complete`, `cap-reserve`, `false-approval`, or `infra-stop` (`:396-429`). Recorded per-evaluation cost in the live v0.2 benchmark: median inference USD 0.000252, total sandbox USD 5.40446309 over 55 evaluations (`docs/demo/placebo-v0.2-live-2026-09.md:52-60`); the most expensive single scenario case above cost USD 0.4162 sandbox plus USD 0.005748 inference (`repair-tsconfig-drift-indexed-access`). Public matrix runs cost USD 0.308961 for eight cases (`docs/demo/sutura-v0.2.0-phase-0-evidence.md:38`).

Core budgets are lower-only at three layers with the doubled-constant pattern: `packages/action/src/input.ts:94-104`, `packages/core/src/config.ts:95-103`, `packages/core/src/engine/repair-budget.ts:30-43`. Defaults are 8 model turns, 24 tool calls, 12 branches, 32 sandbox operations, 600 seconds, USD 0.25 inference, 65,536 diff bytes (`repair-budget.ts:11-19`).

### 4.3 Push freeze

`scripts/push-freeze.mjs` stores `{ reason, startedAt, by }` at `<git-common-dir>/sutura-push-freeze.json` (`:20-25`, `:71`); `.husky/pre-push` runs `node scripts/push-freeze.mjs check || exit 1` before `pnpm run ci:fast`. No freeze was active at the start of this research (`pnpm run push-freeze status`).

### 4.4 Security and redaction

`packages/core/src/security/external-text.ts:24-72` applies seven idempotent redaction patterns to model and Tavily inputs; `assertExternalEditableText` (`:81`) refuses rather than rewrites. `scripts/placebo-live.mjs:190-198` `assertPublicArtifactSafe` rejects any artifact containing `/Users/`, `[A-Z]:\Users\`, `Authorization: Bearer|Basic`, `github_pat_`, `ghp_`, `sk-…`, or a known secret value; `redactPublicArtifact` (`:220-246`) replaces them and counts redactions. `docs/security/private-repositories.md:19` states the existing contract for issue #63: "The action passes only `CI=true` and `NODE_ENV=test` into sandbox commands. Provider and GitHub credentials do not enter ConTree." `docs/security/data-boundaries.md:5` and `:23` state that Sutura "does not proxy repository data through Sutura maintainer infrastructure" and "has no maintainer-operated telemetry or artifact service." Neither security document models a signed-out trigger.

Input validation in `packages/action/src/input.ts` allowlists by strict equality (`:19-25`, `:74-80`, `:84-86`) with error strings of the form "SUBJECT must be ACCEPTED-CONTRACT" (`:23`, `:37`, `:50`, `:69`, `:79`, `:85`).

### 4.5 Prior public-trigger design

`docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-11.md:62-115` specified an unimplemented issue-form trigger: one fixed dropdown; parse the event JSON in Node, never interpolate issue text into a shell; one accepted request per user per 24 hours and five per repository per UTC day (`:84-86`); one active request at a time through a static concurrency group (`:89`); a `DEMO_ENABLED` repository variable defaulting to `false` (`:99`); hard per-run inference and sandbox budgets (`:101`); reject disabled or over-quota requests before provider calls (`:103`); dispatch CI and Sutura with the exact CI run ID rather than relying on `workflow_run` after token-created events (`:105-107`); grant only `actions: write`, `contents: write`, `issues: write`, `pull-requests: write` and prohibit `id-token: write` (`:109-111`). None of the planned files (`.github/ISSUE_TEMPLATE/run-sutura.yml`, `demo-request.yml`, `parse-demo-request.mjs`, `enforce-demo-quota.mjs`) exists in `sutura-demo`. `docs/plans/2026-08-31-sutura-phase-0-evidence-baseline-phases/phase-3.md:47` deferred the trigger change to the Case Lab.

### 4.6 Packaging

`pnpm-workspace.yaml` includes every `packages/*` directory. A package follows `packages/evaluation/package.json`: scoped `@sutura/` name, version `0.2.1`, `private: true`, `type: module`, conditional `exports`, scripts `build` (`tsc -p tsconfig.build.json`), `lint` (`eslint .`), `test` (`vitest run`), `typecheck`. Root `tsconfig.json` sets `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `module: NodeNext`, `target: ES2023`. One flat ESLint config (`eslint.config.mjs`) covers all packages. `.mjs` script tests run with `node --test` and must be listed explicitly in `test:release-contracts` (`package.json:28`). `packages/placebo/bin/placebo.js` is a three-line ESM shim over `dist/bin.js`. `.github/workflows/ci.yml:25-36` runs release contracts, README checks, placebo offline smoke, typecheck, lint, build, bundle verification, package test, `pnpm run test`, and guard verification on every push and pull request. Tests that spawn builds or sandboxes declare timeouts of at least 30 seconds (`.claude/rules/ci-parity.md`).

### 4.7 WS-2 dependency on the result view

`docs/plans/2026-09-04-sutura-counterfactual-arena-phases/phase-10.md` (WS-2 issue #73) waits for WS-1 #66 and #67 on `develop`, then adds a two-column comparison inside the WS-1 result view reading `CaseFile.counterfactual`, and extends the WS-1 signed-out acceptance script with one assertion. The WS-2 Phase 2 adds an optional `counterfactual` field to `CaseFile` and a "Counterfactual" sheet in `packages/core/src/report/casefile.ts`.

## 5. Control-plane decision

The workstream document requires research to decide the control plane (`docs/plans/2026-09-04-sutura-issue-workstreams.md:85`). The roadmap permits Nebius serverless "only if the current service contracts support the required asynchronous execution, secret isolation, request limits, and stable result URLs" (`docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md:226`).

Measured against the documented contracts in section 3:

| Requirement | Nebius Serverless Endpoints | Nebius Serverless Jobs | GitHub Actions dispatcher behind a small public front end |
| --- | --- | --- | --- |
| Asynchronous execution | Container is long-running; asynchrony must be implemented in the container | Asynchronous by design, but creation takes minutes and the minimum timeout is one hour | `workflow_dispatch` returns a run id immediately; the run is asynchronous by design |
| Secret isolation | SecretStash `--env-secret` | SecretStash `--env-secret` | Provider secrets stay in `sutura-demo` Actions secrets; the dispatcher holds one fine-grained token with Actions write on one repository |
| Request limits | Not documented; no rate, size, timeout, or scale-to-zero statement | Not applicable to per-request handling | Not provided by GitHub; must be implemented in the dispatcher and re-checked in the workflow |
| Stable result URLs | Managed HTTPS URL for the endpoint; no statement about result persistence | No public URL | Workflow run, pull request, and check URLs are public and permanent; raw file content on a public branch is readable signed-out and cross-origin |
| Availability to this project on 2026-09-04 | Public preview; no CLI, profile, or IAM credential on this machine; pricing pages 404 | Same | `gh` authenticated with `repo` and `workflow` scopes; Vercel CLI authenticated as `juan294` |

Decision: the public control plane is a GitHub Actions dispatcher behind a small public front end. The Token Factory and ConTree path stays the runtime core inside GitHub Actions in `juan294/sutura-demo`, exactly as the existing matrix path runs it. Nebius Serverless Endpoints do not meet the "request limits" condition in their documented contract and are in public preview with unpublished pricing and unverified account access; Serverless Jobs have no public URL and a one-hour minimum timeout. The decision is recorded in the plan as the architecture for every WS-1 issue.

Consequences that the plan must carry:

1. A signed-out visitor cannot call GitHub's dispatch endpoint. One server-side component is unavoidable: a stateless dispatcher holding a fine-grained personal access token restricted to `juan294/sutura-demo` with Actions read and write only (section 1.5). Its deployment target is the authenticated Vercel account under the personal scope, and deployment is part of the public-demo-enable gate.
2. Throttling, concurrency, the daily spend stop, and the emergency disable are implemented twice: in the dispatcher before the dispatch call (counting the case-lab workflow's own runs through the GitHub API) and again inside the workflow before any provider call (a `CASE_LAB_ENABLED` repository variable and a run count), so the workflow fails closed if the dispatcher is bypassed.
3. Artifacts are not readable signed-out, so the result view cannot link the HTML case file artifact as its primary evidence. The workflow publishes a public-safe result document to a public branch of `sutura-demo`; workflow run, pull request, and check URLs remain the GitHub evidence links.
4. Deterministic replay has two evidence sources today: the committed live v0.2 case files (section 2.4) for the JavaScript repair, flaky, and greenwash scenarios, and complete replay bundles captured by `capture-replay` on the public path once a live case is authorized. The Python repair and upstream scenarios have only `infra-stop` recorded results until a v0.2.1 live run exists.

## Sources

- `docs/plans/2026-09-04-sutura-issue-workstreams.md`
- `docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md`
- `docs/demo/sutura-v0.2.0-phase-0-evidence.md`
- `docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-11.md`
- `docs/plans/2026-09-01-sutura-v0.2.1-evidence-remediation-notes.md`
- `docs/plans/2026-09-04-sutura-counterfactual-arena-phases/phase-10.md`
- `docs/security/data-boundaries.md`, `docs/security/private-repositories.md`
- `/Users/juan/code/sutura-demo` at `4835920dd49b3ddc2fde7181309b48c4f7831ec0`
- Nebius documentation pages listed in section 3, fetched 2026-09-04
- GitHub REST documentation for workflow dispatch, workflow runs, artifacts, and fine-grained token permissions, fetched 2026-09-04
