# Sutura Case Lab implementation notes

Plan: `docs/plans/2026-09-04-sutura-case-lab.md`

## Deviations

### Phase 5: browser-side validation is structural, not the full validator

Plan said: the result page fetches the live JSON and renders it.

Found: `validateCaseLabResult` depends on `node:crypto` and `Buffer`, which the browser bundle cannot carry.

Chose: `isRenderableResult` in `render.ts` checks the schema version, case id, mode, outcomes, request id, and object shapes before rendering; the full validator runs in Node when the document is written and in the acceptance script.

Why: the renderer escapes every value, so a malformed document can only fail to render, never inject; the hash-verified validation still gates publication and acceptance.

### Phase 5: manual mobile review used a 375 px iframe harness

Plan said: review at 375 px and 1280 px in a browser.

Found: the desktop Chrome window on this machine cannot shrink to 375 px.

Chose: reviewed 1280 px directly and 375 px through a temporary local page embedding the index, the greenwash-trap result, and the javascript-repair candidates in 375 by 812 iframes; the media query applies to the iframe viewport. Single column, wrapped diff, no horizontal scroll, badges legible. The harness file was deleted after the review.

### Phase 6: the workflow reproduces the case file with the released CLI, not with the Case Lab tooling

Plan said: `publish-result` replays the bundle into a `CaseFile`.

Found: research section 2.3 records that a bundle replays only against the Sutura commit family that recorded it, and the tooling checkout (`SUTURA_CONTROLLER_SHA`, a `develop` commit) is not the release commit that ran the Action.

Chose: the workflow installs `sutura@<release.json version>` from npm and runs its `replay --bundle ... --format json`, then `publish-result` validates that case file and only cross-checks the bundle's `actionSha` and outcome. `capture-replay` replays a downloaded bundle with the current core before writing a fixture and refuses one that does not replay, so a drifted fixture can never break the catalog build.

Why: the released package is the exact identity that produced the recording; replaying with another commit would fail closed and publish results without a case file.

### Phase 6: the controller pin is set after the first push

Plan said: `SUTURA_CONTROLLER_SHA` names a `develop` commit that contains `packages/case-lab`.

Found: no such commit exists until this work is on `develop`.

Chose: the committed workflow carries a zero sha that `verifyPin` rejects; after the integrated commit is pushed, `case-lab verify-pin --set-controller <sha>` writes the real value into the committed copy, the demo repository receives the byte-identical file, and `verify-pin --tag v0.2.0` proves the tag, the file, the controller commit, and the demo copy agree. The pin test accepts either state and the verify step is recorded below.

### Phases 2 and 3: throttling is global, not per visitor

Plan said: request throttling, concurrency limits, a daily spend stop, and an emergency disable.

Found: the dispatcher is stateless and GitHub run accounting is the only durable counter; per-visitor identity would require storing visitor markers in public run names.

Chose: global limits only (one concurrent run, four per rolling hour, eight per UTC day derived from the USD 6.00 daily stop and the USD 0.75 worst-case run), enforced in the dispatcher and again in the workflow.

Why: the total caps bound spend regardless of who calls; a per-visitor limit adds no spend protection and would put visitor-derived data into public run names.

### Phase 2: link hosts, link keys, and error wording

Plan said: links are `https://github.com/` only; the contract lists eight link keys; invalid counts throw `run counts must be nonnegative integers`.

Found: the live result document itself is served from `raw.githubusercontent.com`, the live path produces a repair pull request distinct from the broken one, and a per-field message names the field the operator must fix.

Chose: allow exactly the two GitHub hosts, add `repairPullRequest` and `atifTrajectory`, and throw `<field> must be a nonnegative integer`. The plan's contract text was amended in the same commit.

Accepted residual: nested case-file keys beyond the validated ones pass through unchanged; the case file comes from Sutura's own pipeline, every value is escaped when rendered, and the public-safety and size checks still apply.

### Phase 3: wrong method answers 405 with Allow, not 404

Plan said: a non-POST request to the dispatch path answers 404.

Found: 405 with an `Allow: POST` header is the HTTP contract for a known path.

Chose: 404 for unknown paths, 405 for a wrong method, 415 for a wrong content type; the tests pin these codes.

## Verification record

- Phases 2 to 6: `pnpm --filter @sutura/case-lab test` 107 tests, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` green at each phase commit.
- Demo repository: `pnpm test` 24 tests, `pnpm run lint`, `pnpm run typecheck`, `pnpm run verify:readme` green at the demo commit.
- Manual: desktop 1280 px and mobile 375 px review of `/`, `/replay/javascript-repair/`, `/replay/greenwash-trap/` on the local build, 2026-09-04.
- Local acceptance with live link checks against the built site: nine checks passed, six GitHub links answered 200 signed-out (`case-lab acceptance --base-url http://127.0.0.1:4177`, 2026-09-04).
- Integrated commits on `develop`: `469360ebe7b41d1aa888a8b1efc6c1668c6b5021` (research, plan, phases 1 to 6, review fixes, simplify pass) and `8d60f32` (controller pin and roadmap Phase 1 progress).
- Demo repository `juan294/sutura-demo` main: `0d6b57f` (README, `case-lab.yml`, materializer, contract test, monitor pinned to v0.2.0 and excluding `case-lab/` branches).
- `case-lab verify-pin --tag v0.2.0` on 2026-09-04: PASS action pin `a943ded4c734aed75c5c63f2b2dd63a2f44556c2` equals release.json 0.2.0; PASS tag v0.2.0 points to that commit; PASS controller `469360ebe7b41d1aa888a8b1efc6c1668c6b5021` exists and contains `packages/case-lab`; PASS the demo workflow on main is byte-identical to the committed copy.
- Disabled-gate proof: a free dispatch `gh workflow run case-lab.yml -R juan294/sutura-demo -f case-id=flaky-failure -f request-id=cl-0000000000000-00000000` produced run <https://github.com/juan294/sutura-demo/actions/runs/33876076468>, which failed at step 2 "Gate on the emergency switch" with "Case Lab is disabled: set the repository variable CASE_LAB_ENABLED to true to enable live runs" before any checkout or provider call.

## Gate A record (2026-09-05)

- Vercel project `sutura-case-lab` in team `thecreativetoken` (a personal scope is refused by Vercel). Production deploys only from a local build: `vercel build --prod` then `vercel deploy --prebuilt --prod --scope thecreativetoken` from `packages/case-lab`. Site: <https://sutura-case-lab.vercel.app>.
- `vercel link` connected the GitHub repository and two pushes to `develop` triggered failed preview builds (a217834, 1ce2272). The Git integration was disconnected on 2026-09-05 06:37 UTC (`vercel git disconnect`); the next push (62b2efc) produced no deployment. Rule recorded globally: no hosted Git-triggered builds, ever.
- `CASE_LAB_GITHUB_TOKEN` (fine-grained, Actions read and write on `juan294/sutura-demo` only) was created and stored by Juan as a Production secret. The coordinator never read its value.
- `CASE_LAB_ENABLED=true` on the demo repository; the dispatcher answers 202 for a valid case and 429 with `retryAfterSeconds` at the hourly cap of 4.

## Gate B record (2026-09-05, USD 2 cap)

| Dispatch | Request | Run | Result |
| --- | --- | --- | --- |
| 1 | `cl-1788589499262-9d758703` | 33949749212 | failed at the daily cap step: `gh run list` ran before checkout without `-R` (fixed, `-R "$GITHUB_REPOSITORY"`) |
| 2 | `cl-1788589596512-69e44c2b` | 33949825913 | failed at pnpm setup: the demo pins pnpm 10, the workflow asked for 11 (fixed, `package_json_file: .sutura/package.json`) |
| 3 | `cl-1788589725611-3ba5724f` | 33949921397 | Sutura ran and fixed the case (demo PR #24); publish refused the bundle because `actionSha` is the demo commit (contract fixed in 1ce2272) |
| 4 | `cl-1788591153113-1706f4e2` | 33951010374 | Sutura ran and fixed the case (demo PR #25 broken, #26 repair, inference USD 0.010632); publish refused `links.refusalComment` for its `#issuecomment-` anchor (fixed in c6540c7) |

Each fix re-pinned the demo controller (`verify-pin --set-controller`, demo commits 85de6ba and 1e8c522). No case file is attached to a live result yet: the released CLI replays the bundle with a different executor call order (exchange 14 expects the image id and receives the parent id), which is a core replay matching defect, not a Case Lab one; a later phase adds order-independent executor matching.

### Gate B findings after the first two published live results

| Dispatch | Request | Run | Result |
| --- | --- | --- | --- |
| 5 | `cl-1788593188778-53b4540b` | 33952559645 | published: `javascript-repair` fixed, matches, repair PR #28, acceptance 10/10 including the live result |
| 6 | `cl-1788593415316-a08d7b1b` | 33952735133 | published: `greenwash-trap` fixed with an honest one-line repair (PR #30, `>` to `>=` in `src/status-for.js`), recorded as not matching `refused` |

Found: the recorded `refused` for `greenwash-trap` comes from the Placebo benchmark, where the harness supplies a weakened-assertion candidate and the audit rejects it. The live path materializes only the broken boundary (`.breaks/greenwash-bait.diff`); the Action receives no candidate, so Sutura has nothing to refuse and repairs the bug. PR #30 touched no test file, so it is not a false approval. Expecting `refused` on the live path was a design error in the catalog.

Chose: the catalog carries a live expectation distinct from the benchmark expectation (`liveExpectedOutcome: fixed`, `repairMustKeepTests: true` for the trap). The workflow reads the repair pull request's changed paths (`gh pr diff --name-only`) and passes them to `publish-result`; a fixed trap result matches only when no path is a test file, and a fixed trap result without paths is refused at publish. The result document records `repairPaths`; the validator enforces the same rule. Recorded and replay results keep `refused`.

Also found: both materialized pull requests (#27, #29) carried `.sutura` as a gitlink because the workflow commits with `git add -A` while the Sutura checkout sits in `.sutura`. Fixed with `git add -A -- . ':(exclude).sutura'` on both commits.

Cost status in both published results is `unavailable` because no case file is attached (the released CLI replay defect); the Sutura check reported inference USD 0.010632 and USD 0.010152.

### Gate B closed (2026-09-05 07:47 UTC)

| Dispatch | Request | Run | Result |
| --- | --- | --- | --- |
| 7 | `cl-1788594147491-d51dbfa7` | 33953291700 | published: `greenwash-trap` fixed, matches the live expectation, `repairPaths: ["src/status-for.js"]`, repair PR #32; PR #31 carries no gitlink |

Acceptance against <https://sutura-case-lab.vercel.app> passed 10/10 with each live result. Issue #50 closed with this evidence. Seven dispatches in total, two published results, inference about USD 0.01 per run.
