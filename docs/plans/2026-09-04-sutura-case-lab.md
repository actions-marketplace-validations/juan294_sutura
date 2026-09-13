# Sutura Case Lab implementation plan

Date: 2026-09-04

Status: Active

Owner: Juan (execution: WS-1 agent, Claude Fable 5.1)

Workstream: WS-1 Public Case Lab, `docs/plans/2026-09-04-sutura-issue-workstreams.md:81-106`

Research: `docs/research/2026-09-04-sutura-case-lab.md`

Issues, in the documented order: #68, #59, #60, #63, #62, #61, #64, #65, #66, #67, #51, #50

Base commit: `be0f59a` on `develop`. Task branch `ws1-case-lab` in worktree `/Users/juan/code/sutura-ws1`.

## Goal

A signed-out non-collaborator opens one public page, selects one of five server-defined cases, and receives a stable, readable result with every field in roadmap Phase 1 (`docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md:199-210`). Every case has a deterministic, labeled replay. Arbitrary input fails closed. Live runs spend only under throttles, a concurrency limit, a daily spend stop, and an emergency disable, through a service identity with minimum GitHub permissions, with provider secrets never leaving the Actions runner.

## Architecture (decided in research section 5)

```
signed-out visitor
   │  GET  /            static index (five cases, release identity, live/replay labels)
   │  GET  /replay/<case-id>/      pre-rendered deterministic result (mode: replay | recorded)
   │  GET  /result/?id=<request-id> live result page (client fetches public JSON, polls public run API)
   │  POST /api/dispatch {caseId}   ─┐
   ▼                                 │  packages/case-lab dispatcher (Vercel function)
Vercel: static site + one function   │  holds CASE_LAB_GITHUB_TOKEN (fine-grained PAT, Actions rw on juan294/sutura-demo)
                                     │  checks CASE_LAB_ENABLED, active runs, hourly and daily caps (GitHub run list)
                                     ▼
GitHub Actions in juan294/sutura-demo: case-lab.yml (workflow_dispatch: case-id, request-id)
   re-checks vars.CASE_LAB_ENABLED and the daily cap, materializes the case, opens the broken PR,
   dispatches CI, runs juan294/sutura/packages/action@<release sha> with capture-replay,
   replays the bundle into a CaseFile, writes results/<request-id>.json to branch case-lab-results
   (provider secrets: Actions secrets → Action step only; ConTree receives CI=true, NODE_ENV=test)
```

Runtime core: Token Factory and ConTree inside the Action step, unchanged. Nebius Serverless is not used (research section 5).

## Server-defined cases

| Case id | Scenario | Demo materializer | Placebo case | Expected outcome | Runtime |
| --- | --- | --- | --- | --- | --- |
| `javascript-repair` | JavaScript repair | break `assertion` | `repair-off-by-one` | `fixed` | node |
| `python-repair` | Python repair | matrix `python-repair` | `python-repair-missing-await` | `fixed` | python |
| `flaky-failure` | Deterministic flaky failure | break `flaky` | `flaky-timer-race` | `flaky-no-patch` | node |
| `greenwash-trap` | Greenwash trap | break `greenwash-bait` | `trap-weakened-expect` | `refused` | node |
| `upstream-incident` | Upstream dependency incident | break `upstream` | `upstream-formatter-release` | `fixed` (Tavily grounded) | node |

## Result document contract

`CaseLabResult` (`sutura-case-lab-result-v1`), produced by `case-lab publish-result` in the workflow, by `case-lab replay` for fixtures, and validated everywhere by rebuilding `resultHash` (pattern: `scripts/placebo-live.mjs:260-270`):

```
{
  schemaVersion: 'sutura-case-lab-result-v1',
  requestId: 'cl-<13 digits>-<8 hex>' | 'replay-<case-id>' | 'recorded-<case-id>',
  caseId, mode: 'live' | 'replay' | 'recorded',
  release: { version, actionSha },            // #51 pin
  identity: { controllerSha, demoSha? },
  outcome: CaseFile['outcome'],
  expectedOutcome, matchesExpectation: boolean,
  links: { workflowRun?, ciRun?, pullRequest?, repairPullRequest?, refusalComment?, check?, caseFileArtifact?, replayBundleArtifact?, evidence?, atifTrajectory? }  // https://github.com/ or https://raw.githubusercontent.com/ only, no credentials, no fragment
  caseFile?: CaseFile,                        // absent only when the live bundle was partial
  recordedFrom?: { file, resultHash, runUrl, subjectSha, recordedAt },   // mode recorded
  replayedFrom?: { bundleSha256, capturedRunUrl, actionSha },            // mode replay
  cost: { inferenceUsd, sandboxUsd, status: 'observed' | 'unavailable' },
  elapsedMs?, createdAt, resultHash
}
```

Public safety: `assertCaseLabResultPublicSafe` rejects `/Users/`, `[A-Z]:\Users\`, `Authorization: Bearer|Basic`, `github_pat_`, `ghp_`, `sk-…`, and any supplied secret value (pattern: `scripts/placebo-live.mjs:190-198`). Links must pass `publicGitHubUrl` (`scripts/evidence-contract.mjs:43`).

## Limits policy (#61)

Constants in `packages/case-lab/src/limits.ts`, doubled as default and ceiling:

| Limit | Value | Basis |
| --- | ---: | --- |
| Concurrent live runs | 1 | Static concurrency group `case-lab` in the workflow and the dispatcher's active-run count |
| Live runs per rolling hour | 4 | Throttle; one visitor cannot start a burst |
| Worst-case cost per run (USD) | 0.75 | Action inference ceiling 0.25 (`repair-budget.ts:11-19`) plus the largest observed sandbox cost 0.4162 (`docs/demo/placebo-v0.2-live-2026-09.json`), rounded up |
| Daily spend stop (USD) | 6.00 | Eight runs per UTC day at worst case |
| Live runs per UTC day | 8 | `floor(6.00 / 0.75)` |
| Emergency disable | `CASE_LAB_ENABLED` env on the dispatcher and `CASE_LAB_ENABLED` repository variable in `sutura-demo`; both must equal `true` | Either switch stops spend before any provider call |

The dispatcher counts runs of `case-lab.yml` through `GET /repos/juan294/sutura-demo/actions/workflows/case-lab.yml/runs?created=>=<iso>` (Actions read). The workflow repeats the count with `gh run list` before materializing anything and exits non-zero when over the cap, so bypassing the dispatcher cannot raise spend.

## Phases

| Phase | Name | Issues | Files | Depends on | Batch |
| ---: | --- | --- | --- | --- | --- |
| 1 | Remove the collaborator-only instruction | 68 | `/Users/juan/code/sutura-demo/README.md`, `README.md` | None | Sequential |
| 2 | Case Lab package: server-defined cases, request boundary, limits, result contract | 59, 60, 61 (logic), 63 (contract) | `packages/case-lab/**` (new) | None | Sequential |
| 3 | Dispatcher and service identity | 62, 61, 63 | `packages/case-lab/src/github.ts`, `dispatcher.ts`, `api/*.js`, `vercel.json`, `README.md` | 2 | Sequential |
| 4 | Deterministic replay and labels | 64, 65 | `packages/case-lab/src/replay.ts`, `replay/**`, `src/bin.ts` | 2 | Sequential |
| 5 | Static site, stable result URLs, readable result, acceptance script | 66, 67 (+116-118 script for WS-4) | `packages/case-lab/src/render.ts`, `site.ts`, `acceptance.ts`, `assets/**` | 4 | Sequential |
| 6 | Live path in the demo repository, release pin, gate preparation | 51, 50, 68 (demo side) | `/Users/juan/code/sutura-demo/.github/workflows/case-lab.yml`, `scripts/materialize-case-lab-case.mjs`, `test/case-lab-workflow-contract.test.js`, `packages/case-lab/demo/**`, `packages/case-lab/release.json` | 3, 5 | Sequential |

Phase files: `docs/plans/2026-09-04-sutura-case-lab-phases/phase-N.md`.

No phase is `[batch-eligible]`: phases 2 to 5 share `packages/case-lab/src/index.ts` and `src/bin.ts`, and phase 6 depends on the CLI from phases 4 and 5.

## Verification

Automated, every phase: `pnpm --filter @sutura/case-lab test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, then `pnpm run ci:fast` before any push. `packages/case-lab` does not touch `packages/core`, so `pnpm run ci:local` is required only if a later phase changes core (none planned). Demo-repository changes run `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run verify:readme` in `/Users/juan/code/sutura-demo`.

Manual (browser) checks are limited to the mobile and desktop visual review in Phase 5, performed with a browser at 375 px and 1280 px widths against the local build; the acceptance script covers the structural checks automatically.

## Authorization gates

Recorded here per coordination rule 10. Neither gate is executed by this plan.

### Gate A: public demo enablement (#50)

Actions, in order, all outward-facing:

1. Create the fine-grained personal access token `sutura-case-lab-dispatcher`: resource owner `juan294`, repository access only `juan294/sutura-demo`, permissions Actions: Read and write, Metadata: Read (automatic); expiry 90 days. Copy the value once into Vercel only.
2. Deploy the Case Lab under the personal Vercel scope:
   ```bash
   cd /Users/juan/code/sutura/packages/case-lab
   vercel link --scope juan294 --project sutura-case-lab --yes
   vercel env add CASE_LAB_GITHUB_TOKEN production   # paste the token, never write it to disk
   vercel env add CASE_LAB_ENABLED production        # value: false  (site works; live dispatch refuses)
   vercel deploy --prod --scope juan294
   ```
   Cost: USD 0 (Hobby tier: static site and one Node function within free limits).
3. Set the demo repository switch only when a live case is authorized:
   ```bash
   gh variable set CASE_LAB_ENABLED -R juan294/sutura-demo --body true
   vercel env rm CASE_LAB_ENABLED production && vercel env add CASE_LAB_ENABLED production   # value: true
   vercel deploy --prod --scope juan294
   ```
4. Turn both switches back to `false` to disable.

### Gate B: live cases through the public path (Phase 1 exit gate)

One live repair (`javascript-repair`) and one live refusal (`greenwash-trap`) dispatched through the public dispatcher, plus the automated capture of their replay bundles as fixtures:

```bash
# after Gate A step 3, from the sutura checkout at the integrated commit
pnpm run push-freeze status                                  # a freeze must not be required; the Case Lab binds to the release sha, not origin/develop
node packages/case-lab/bin/case-lab.js dispatch --base-url https://sutura-case-lab.vercel.app --case javascript-repair
node packages/case-lab/bin/case-lab.js dispatch --base-url https://sutura-case-lab.vercel.app --case greenwash-trap
node packages/case-lab/bin/case-lab.js capture-replay --request-id <id> --out packages/case-lab/replay   # once per completed run
```

| Item | Value |
| --- | --- |
| Provider | Nebius Token Factory and ConTree through `juan294/sutura-demo` Actions secrets; Tavily not exercised by these two cases |
| Candidate | Action pin in `packages/case-lab/release.json` (`v0.2.0`, `a943ded4c734aed75c5c63f2b2dd63a2f44556c2`) until WS-4 publishes the submitted release |
| Expected cost | USD 0.16 (`repair-off-by-one` recorded 0.005507 inference + 0.1503 sandbox) plus USD 0.10 (`trap-weakened-expect` recorded 0.000223 + 0.0972); total about USD 0.26 |
| Cap | USD 2.00 total; reserve USD 0.75 per dispatch (worst case); at most 2 dispatches |
| Stop condition | Any `infra-stop`, any false approval (trap audit `approved: true`), or spend plus reserve above the cap |
| Result | `results/<request-id>.json` on `case-lab-results`, the workflow run URL, the pull request or refusal comment URL, and two captured replay bundles committed under `packages/case-lab/replay/` |

The `python-repair` and `upstream-incident` live cases are not part of this gate; they depend on the WS-4 v0.2.1 candidate (Python image and dependency snapshot fixes are on `develop` but unreleased).

## Cross-stream notes

- WS-2 #73 consumes `packages/case-lab/src/render.ts` after Phase 5 lands on `develop`; the renderer leaves a named `renderCounterfactual` extension point that renders nothing when `caseFile.counterfactual` is absent.
- WS-4 #116-118 run `node packages/case-lab/bin/case-lab.js acceptance --base-url <url> --out docs/demo/<file>.json` on the final candidate.
- WS-4 #114 updates `packages/case-lab/release.json` and the demo workflow pin to the submitted release; `case-lab verify-pin` proves the tag, the file, and the demo workflow agree.
- No `packages/core`, `packages/action`, or `docs/security` file changes are planned. If Phase 4 needs a core export, it is a separate one-line commit labeled `ws-2-counterfactual-arena` per coordination rule 5.

## Success criteria

Automated:

- [ ] Every WS-1 issue's acceptance items are covered by a test named in its phase file.
- [ ] `pnpm run ci:fast` passes at the integrated commit; CI is green on `develop` after each push.
- [ ] `node packages/case-lab/bin/case-lab.js acceptance --base-url <local build server>` passes for all five cases in replay or recorded mode.

Manual:

- [ ] Gate A executed by Juan (public URL live, dispatcher refusing while disabled).
- [ ] Gate B executed by Juan (one live repair, one live refusal, both replay bundles captured).
