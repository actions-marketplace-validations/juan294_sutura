# Phase 5: Static site, stable result URLs, readable result, acceptance script

Issues: #66 (stable result URLs that survive refresh), #67 (readable on desktop and mobile); deliverable for WS-4 #116, #117, #118 (signed-out acceptance script)

Depends on: Phase 4

## Goal

`case-lab build-site` writes a static site to `packages/case-lab/dist/site` that works signed-out, whose every result URL is a plain GET that re-renders the same result after refresh, and whose main result is readable at 375 px and 1280 px.

## URL contract (#66)

| URL | Source | Behavior on refresh |
| --- | --- | --- |
| `/` | `index.html` | Static |
| `/replay/<case-id>/` | pre-rendered from the Phase 4 catalog; `replay/<case-id>/result.json` beside it | Static |
| `/result/?id=<request-id>` | `result/index.html` + client script | Fetches `https://raw.githubusercontent.com/juan294/sutura-demo/case-lab-results/results/<request-id>.json`; while 404, polls `https://api.github.com/repos/juan294/sutura-demo/actions/workflows/case-lab.yml/runs?per_page=30` (public, unauthenticated) for `display_title === "Case Lab <request-id> <case-id>"` every 15 s and shows status; renders the same page from the same JSON on every load |
| `/catalog.json` | cases, release identity, limits, labels | Static |

The request id is the only client-supplied value on the result page; it must match `^cl-[0-9]{13}-[a-f0-9]{8}$` before any fetch, else the page shows "Unknown result id" and fetches nothing.

## Files

```
packages/case-lab/src/render.ts        pure DOM-free renderer: renderResultDocument(result): string (full page), renderResultBody(result), renderCaseCard(case), renderCounterfactual(caseFile) -> '' when absent (WS-2 extension point)
packages/case-lab/src/site.ts          buildSite({ outDir, catalog, release }): writes index.html, replay/<id>/index.html + result.json, result/index.html, catalog.json, case-lab.css, case-lab.js
packages/case-lab/src/client.ts        browser entry (bundled with esbuild to case-lab.js, format iife, target es2022): reads ?id, fetches JSON, calls renderResultBody, polls run status; no eval, no innerHTML from unescaped input (renderer escapes everything)
packages/case-lab/assets/case-lab.css  responsive styles (single column below 720 px, tables in overflow-x containers, 16 px minimum font, prefers-color-scheme)
packages/case-lab/scripts/bundle-client.mjs   esbuild build of client.ts
packages/case-lab/src/acceptance.ts    acceptance(baseUrl, options) -> AcceptanceRecord; CLI `case-lab acceptance --base-url <url> [--live-result <request-id>] [--out file]`
packages/case-lab/src/render.test.ts, site.test.ts, acceptance.test.ts
```

## Result view sections (roadmap `docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md:199-210`), in order

1. Header: case title, mode badge (`modeLabel`), outcome badge (`fixed | flaky-no-patch | refused | gave-up | infra-stop`), expected outcome, release identity (`v<version>`, action sha), identity shas.
2. Failed commit and CI evidence: `links.ciRun`, `links.pullRequest`, failing command and error excerpt from `caseFile.diagnosis`.
3. Nano diagnosis and confidence: `diagnosis.class`, `diagnosis.confidence`, signals, grounding citations when present.
4. ConTree search tree and branch status: table of `caseFile.search` nodes (node, parent, depth, terminal reason, test exit, policy valid, changed files, diff bytes) plus triage outcome from `caseFile.triage`.
5. Super proposals and candidate patches: `caseFile.race` entries with candidate id, rationale, held, exit code, and the diff in a `<pre>` (escaped).
6. Rejected patches and rejection reasons: race entries not selected, audit checks with `passed: false` and their evidence; refusal reasoning.
7. Clean audit branch and Ultra verdict: `caseFile.audit.approved`, checks table, reasoning.
8. Final outcome with the mode label repeated.
9. Cost and resources: inference USD by role, sandbox USD, elapsed, CPU, max RSS, sandbox operation count from `stages`.
10. Links: workflow run, pull request or refusal comment, check, case file artifact, replay bundle artifact (artifact links carry the note "requires GitHub sign-in"), evidence file, ATIF trajectory when present.
11. `renderCounterfactual(caseFile)` placeholder slot between 6 and 7 (empty today).

All dynamic text passes through `escapeHtml` (copy the five-character function from `packages/core/src/report/format.ts:11`; no dependency on core report internals so the browser bundle stays small).

## Readability (#67)

- Viewport meta, `color-scheme` light dark, system font stack, 16 px base, line length capped at 72 ch on desktop, single column below 720 px, sticky-free layout, every table inside `.scroll` (`overflow-x: auto`), diff blocks wrap at `pre-wrap` with horizontal scroll fallback, badges use text as well as color, landmarks `header/main/nav/footer`, headings in order, links underlined.
- Manual check with a browser at 375 px and 1280 px against `node packages/case-lab/bin/case-lab.js serve` (a 30-line static server in `src/serve.ts` for local review and for the acceptance test).

## Acceptance script (WS-4 #116, #117, #118)

`acceptance(baseUrl)` performs signed-out `fetch` requests only (no cookies, no auth header) and returns `{ schemaVersion: 'sutura-case-lab-acceptance-v1', baseUrl, checkedAt, checks: [...], passed }` where checks are:

- `index-loads`: 200, five case links, release identity text.
- `replay-<case-id>`: 200, mode label present in `<title>` and header, `result.json` validates with `validateCaseLabResult`, viewport meta present, no `Set-Cookie`, no `WWW-Authenticate`.
- `refusal-and-flaky`: `greenwash-trap` outcome `refused`, `flaky-failure` outcome `flaky-no-patch` (from the validated JSON).
- `mobile-css`: stylesheet contains the `max-width: 719px` breakpoint and `overflow-x: auto`.
- `links-public`: every `https://github.com/` link in the five result JSONs returns 200 or 302 to a public page without authentication (HEAD, 10 s timeout, 5 concurrent).
- `live-result-<id>` when `--live-result` is given: result JSON fetched from the raw branch validates, `mode === 'live'`, `links.workflowRun` resolves.

`--out` writes the record with `flag: 'wx'`.

## Tests

- `render.test.ts`: snapshot-free assertions that each of the eleven sections renders for a `fixed`, a `refused`, a `flaky-no-patch`, and an `infra-stop` result from the Phase 4 catalog; that `<script>` in a diff is escaped; that `renderCounterfactual` returns `''` when absent.
- `site.test.ts`: builds into a temp dir; asserts the file set, that every `replay/<id>/result.json` validates, that `index.html` lists five cases with `modeLabel`s, and that `case-lab.js` contains no `innerHTML =` assignment from `location` (grep).
- `acceptance.test.ts`: runs the local static server on the built site and asserts `passed: true` with a 60 s timeout; a second test serves a site with a tampered `result.json` and asserts the failing check name.

## Verification

```bash
pnpm --filter @sutura/case-lab test && pnpm run typecheck && pnpm run lint && pnpm run build
node packages/case-lab/bin/case-lab.js build-site && node packages/case-lab/bin/case-lab.js serve --port 4177 &
node packages/case-lab/bin/case-lab.js acceptance --base-url http://127.0.0.1:4177
```

## Success criteria

- [x] Every result URL is a stable GET that re-renders after refresh.
- [x] Eleven result sections render from the catalog for all five cases.
- [x] Acceptance script passes locally and is documented for WS-4.
- [x] Manual mobile and desktop review recorded in the notes file.
