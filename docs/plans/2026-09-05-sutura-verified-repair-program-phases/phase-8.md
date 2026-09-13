# Phase 8 — Verdict-first Case Lab and repeatable two-patch evidence

Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on phase 7. Sequential, not batch eligible. Build and inspect locally; public deployment is phase 11.

## Outcome and source

A developer understands Sutura's verdict and value before reading the execution internals. The main story demonstrates two green patches, the broken behavior in one, and the independent evidence behind acceptance/refusal. External verification uses the same result layout.

Read `packages/case-lab/src/render.ts:1`, `site.ts:1`, `result.ts:16`, `replay.ts:1`, `client.ts:1`, `labels.ts:1`, `cases.ts:1`, `limits.ts:1`, `acceptance.ts:1`, `packages/case-lab/README.md:1` and existing recorded cases completely. Own Case Lab source/content/test files, local demo script and targeted shared-report presentation if needed. Preserve fixed scenario catalog, request limits, authenticated dispatcher and secret-free browser; no arbitrary browser patch execution is added.

## Interaction specification

Create checkable local HTML states for: verified correct repair, rejected floor-only patch, flake/no patch, insufficient challenge evidence, provider/infrastructure failure and historical recorded result. Top region contains verdict, one-sentence reason, exact evidence mode/date, and next action. Then show failure → changed behavior → checks. Keep model/branch/trace details expandable below this explanation.

```text
Result
  verdict + plain-language reason
  live / replay / recorded + exact subject + timestamp
  recommended review action
  [Correct repair] [Green but broken patch]
  visible test: both pass
  preservation check: 21 items / 10 per page => expected 3
  correct patch: 3; bad patch: 2 => rejected
  evidence links / diff / checks
  expandable execution and cost details
```

Example copy: “Rejected: this patch passes the original test but undercounts a partial page.” Accepted copy: “Passed the required checks. Review the diff and the behavior tested before merging.” Never say universally safe, proven correct or production-certified. The recorded greenwash supplied-patch refusal and a live generated honest repair are different subjects; buttons must state what is being run.

Replay selects an immutable run and follows recorded operations with no provider calls. Repeated replay produces identical semantic result/evidence hashes; clock/progress animation is excluded from semantic comparison, actual measured historical time remains intact in the artifact. If a record cannot replay under the engine contract, show a labeled recorded-result view and the reason; do not silently relabel it replay. Live controls start disabled while checking real availability, then enable only when ready; explain quota, missing configuration, service outage and recorded alternatives. Retain current finite request caps unless separately reviewed and authorized.

Costs display priced inference estimate, raw/confirmed sandbox costs with units and total only where compatible. No unknown equals zero. Hide unnecessary infrastructure jargon in the first screen, retain transparent detail on demand. Provide a concise CLI verify command route with source/policy identities and read-only Action setup link; arbitrary patch upload remains CLI/Action only.

## Automated success criteria

- [x] Render tests cover all six states; no infrastructure/insufficient result gets accepted color/text or green scenario expectation.
- [x] Regression comparison binds the same baseline, exact two diff hashes, old visible test and new independent checks. Historical artifacts retain original mode/hash and annotation.
- [x] Replay tests execute twice with network/provider spies and compare semantic outputs; mismatch, unsupported version and missing artifact have explicit recorded fallback.
- [x] Browser interaction tests cover keyboard tabs, focus, expanded evidence, status announcements, responsive layouts and live-button readiness/quota transitions. Cost fixtures cover unknown units and partial records.
- [x] `pnpm --filter @sutura/case-lab test` passes; run local build and existing acceptance validator. No hosted screenshots or preview deployment needed.

## Manual success criteria

Inspect locally in browser at narrow and desktop widths, keyboard-only and signed-out-equivalent state. Confirm verdict/why/next action fits the first meaningful screen, public artifacts contain no secrets, and a reader can distinguish two submitted patches from two execution modes. Save actual screenshots after implementation, not invented mock evidence. Five-person comprehension measurement belongs to phase 12.

## Phase gate

Follow the parent plan's implementation/review/fix/simplification loop. Run focused checks and the standard local commands sequentially: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`. Rebuild the committed Action bundle for core/Action changes, run `pnpm run verify:bundle`, and complete `pnpm run ci:local` before any later push involving core. New process/build/sandbox tests use explicit timeouts of at least 30 seconds. Inspect actual hosted triggers before any push; never create a Vercel preview or use hosted CI to debug. Record actual results and the integrated source identity; stop after this phase. Remote actions and participant messages require the concrete authorization described in the parent plan.

## Progress record — September 6

The verdict-first region is built. `caseVerdict` turns a result into a headline, a one-sentence reason a reader can act on without reading anything below it, a recommended next action, and an evidence line naming the mode, exact subject and timestamp. `renderVerdict` places it directly under the header, above every execution detail.

Only a fixed outcome carries the accepted tone; refused, flaky, gave-up and infra-stop each get their own, and a test asserts across every outcome that nothing else can take `verdict-accepted`. The tone is a class rather than inline colour, so a later template change cannot style a stopped run as an acceptance. An infrastructure stop says explicitly that no conclusion should be drawn from it.

Overclaiming is tested rather than trusted: `FORBIDDEN_VERDICT_CLAIMS` covers "universally safe", "proven correct", "production-certified", "guaranteed", "bug-free" and "fully verified", and every outcome's full text is checked against all of them. A historical record reads as a historical record rather than as a run that just happened, and an outcome that missed its expectation says so instead of presenting the outcome alone. 20 tests, and the existing 185-test Case Lab suite still passes.

One constraint this surfaced: the site bundle is built for the browser, so `escapeHtml` could not move into `util.ts`, which imports `node:fs`. It now lives in a dependency-free `html.ts` that both renderers import, which also removes the circular import between `render.ts` and `verdict.ts`.

- The two-patch regression comparison is built. It binds one baseline, exactly two patches by exact diff hash, the original failing test command and the independent checks, and refuses every shape that would let the page imply a distinction the evidence does not support: fewer or more than two patches, the same patch listed twice, a patch that did not pass the original test, an inexact baseline or diff hash, a duplicate check id, and, most importantly, a check set where no check separates the two patches. The render marks which checks separate them and which agree. 9 tests.
- Replay determinism is covered. The catalog replays twice and the semantic projection, case, mode, outcome, expectation match and result hash, is identical, with a spy asserting no `fetch` call occurred. A bundle that exists but cannot replay now becomes a labelled recorded view carrying `recordedFrom.replayFallbackReason`, rather than throwing or being quietly relabelled as a replay; a case with no bundle at all carries no reason, so the two situations stay distinguishable.
Everything this phase specifies is now built. The remaining Case Lab work in
the parent plan is public deployment, which is phase 11.

## Manual inspection — September 6

Inspected in Chrome against a local build served on `127.0.0.1:8788`, case
`greenwash-trap`. Screenshots and the full record are in
[`docs/demo/case-lab/`](../../demo/case-lab/README.md).

At 1440 x 1000 the verdict already led the page. At 375 x 812, which needs a
fixed-size iframe harness because Chrome will not resize below roughly 500 CSS
px, three defects were found and fixed:

1. The identity block sat inside the header and pushed the verdict to 671 px,
   below the 812 px fold. Identity now renders after the verdict.
2. The mode note and expectation line sat in the header for the same reason.
   Both qualify the verdict, so both now render after it. The eyebrow no
   longer repeats the scenario sentence, which the verdict evidence line
   already carries; at 375 px that sentence alone was 101 px of header.
3. The 40-character subject hash in the verdict evidence line is one unbroken
   token and ran 38 px past the right edge, giving a 381 px document on a
   375 px viewport. `.verdict-evidence` now sets `overflow-wrap: anywhere`.

The consent banner was 259 px tall at 375 px because `.actions .button` forces
full width below 720 px, stacking Accept and Decline. It now keeps its buttons
inline and is 175 px tall.

Measured after the fix at 375 x 812: verdict spans 205 to 593, banner top 637,
no overlap, document width exactly 375. Keyboard-only inspection at desktop
width found 13 focusable controls, no negative `tabindex`, and a `main`
landmark. The site has no sign-in, so the captured state is the signed-out
state. `case-lab acceptance --offline` passes all 17 checks against this build.

## Progress record — browser behaviour and the verify route

The execution internals now sit in one closed `<details>` at the end of the
page: identity, the search tree, the candidate patches, the rejected patches,
cost, links, the source line and the result hash. The content is always in the
document, so a reader who searches the page or reads it without JavaScript
still finds every hash and every rejected candidate; only the initial state
changed. The first screen carries the verdict, the failure, the behaviour that
changed and the checks that decided it.

The page names the route for a patch it did not produce. The `sutura verify`
command is filled in from the run's own commits when it recorded exact ones,
and shows placeholders with a sentence saying why when it did not. Every
recorded case in the catalog is a local run whose policy commit is `local`, so
the placeholder branch is what the current site shows; a test covers each
branch. Uploading a patch stays a command-line and Action route.

`client.ts` is now a four-line bundle entry over `client-app.ts`, which runs
nothing on import. That let the browser tests exercise the real module rather
than a copy of it.

19 browser tests run the real markup and the real module in jsdom: the
disclosure order and its keyboard operation, the tab order, the verify command
in both branches, the live-button transitions (not configured, disabled,
enabled, unreachable, quota refusal with the wait, an unknown case id that
sends no request), the single polite status region, and the consent banner
including that no tracker is called before a visitor accepts. Three cost tests
cover an unknown cost that must never read as zero, an unconfirmed billing
unit, and metrics that were never measured.

jsdom does not lay a page out, so the two responsive tests assert the
stylesheet rules the measured narrow layout depends on, and the measurements
themselves live in `docs/demo/case-lab/README.md`. `jsdom` is a new dev
dependency of `@sutura/case-lab`.

Case Lab suite: 219 tests. `case-lab acceptance --offline`: 17 of 17.
