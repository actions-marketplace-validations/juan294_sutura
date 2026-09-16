# Phase 1: Demo repository green, and `publish-demo` verifies it

Plan: [2026-09-15-launch-readiness-v0.3.1.md](../2026-09-15-launch-readiness-v0.3.1.md)

Status: done, merged to `develop` at `28c79b8`. `sutura-demo` `main` green at `79cb1884`. Local repo commit `ab24107` (branch `worktree-agent-a38b8b28f662db238`).

Pushes to `juan294/sutura-demo` `main` are authorized by this plan (the repo is
a public demo, its `main` is unprotected, and it has been red since
2026-09-13). Use the GitHub contents API through `gh api` exactly like
`scripts/release-case-lab.mjs publishDemo` does; do **not** use the stale
local clone `/Users/juan/code/sutura-demo` (ahead 1 / behind 11).

## Goal

1. `sutura-demo` `main` CI green.
2. The demo's repair monitor never fires on `case-lab/*` or `matrix/*`
   branches again.
3. The demo's contract tests derive their expectations from the workflow files
   (shape), so a pin or cap bump can never turn them red.
4. `pnpm run release:case-lab publish-demo --authorize` refuses to report
   success until the demo's CI on the published commit is green.

## What is wrong (VERIFIED)

- `sutura.yml` on `main` (commit `e3f727a`, PR #37 "ci(sutura): enable
  verified repair monitoring", 2026-09-13) has
  `if: conclusion == 'failure' || conclusion == 'timed_out'` with **no**
  `!startsWith(head_branch, 'case-lab/')` / `'matrix/'` guards, pins
  `uses: juan294/sutura@5fe16498…` (the v0.2.1 root action), and lost the
  `workflow_dispatch` retry input. The last green version (`5a213f5`) had all
  three.
- `test/workflow-contract.test.js:12` expects
  `uses: juan294/sutura/packages/action@a943ded4…`; `:32-40` expects the
  `matrix/` guard; `test/case-lab-workflow-contract.test.js:31` expects
  `CASE_LAB_DAILY_RUN_CAP: '8'` and `:57-61` the `case-lab/` guard.
- Effect on the product: every Case Lab live run's post-patch suite carries
  four unrelated failures (30 KB of output), so no case can be `fixed`.

## Changes in `juan294/sutura-demo` (one commit, via `gh api` PUT per file)

1. `.github/workflows/sutura.yml` — keep the new template's name, run-name,
   `checks: write`, `capture-replay`, `runtime: auto`; restore:
   ```yaml
   on:
     workflow_run:
       workflows: ["CI"]
       types: [completed]
     workflow_dispatch:
       inputs:
         run_id: { description: Failed CI workflow run ID to retry, required: true, type: string }
   concurrency:
     group: sutura-${{ github.event.workflow_run.id || inputs.run_id }}
   jobs:
     repair:
       if: >-
         ${{
           github.event_name == 'workflow_dispatch' ||
           ((github.event.workflow_run.conclusion == 'failure' || github.event.workflow_run.conclusion == 'timed_out') &&
             !startsWith(github.event.workflow_run.head_branch, 'matrix/') &&
             !startsWith(github.event.workflow_run.head_branch, 'case-lab/'))
         }}
       steps:
         - uses: juan294/sutura/packages/action@c94eee2086b31450d975137a0102dda18522d0b8   # newest release tag; Phase 4 moves it to v0.3.1
           with:
             run-id: ${{ github.event.workflow_run.id || inputs.run_id }}
             tavily-api-key: ${{ secrets.TAVILY_API_KEY }}
             # …the template's other inputs unchanged
   ```
2. `test/workflow-contract.test.js` "pins the package action…": replace the
   literal with a shape assertion —
   ```js
   const uses = [...workflow.matchAll(/uses: juan294\/sutura\/packages\/action@([a-f0-9]{40})/gu)];
   expect(uses).toHaveLength(1);
   ```
   and keep the `workflow_dispatch:` / `run-id:` expectations.
3. `test/case-lab-workflow-contract.test.js` "is disabled by default…":
   replace `toContain("CASE_LAB_DAILY_RUN_CAP: '8'")` with
   `expect(workflow).toMatch(/CASE_LAB_DAILY_RUN_CAP: '[1-9]\d*'/u)`; keep the
   ordering assertions. The `case-lab/` guard test stays as is (it passes once
   step 1 lands). Extend the secrets test's regex to
   `secrets\.(?:NEBIUS_API_KEY|TAVILY_API_KEY|CONTREE_TOKEN|OPENAI_API_KEY)`
   so Phase 3's input does not break it later.
4. Commit message: `ci(sutura): restore Case Lab and matrix guards, pin the
   package action, and make contract tests shape-based`.

Then watch `ci.yml` on that commit: `gh run watch <id> -R juan294/sutura-demo --exit-status`.

## Changes in this repository

`scripts/release-case-lab.mjs` `publishDemo`: after the byte-identity
re-check, poll the demo's CI for the new commit —

```js
// after `after` is verified byte-identical:
const commit = after.sha ? (JSON.parse(await dependencies.gh(['api', `repos/${DEMO_REPOSITORY}/commits/main`]))).sha : undefined;
const deadline = Date.now() + 15 * 60_000;
for (;;) {
  const runs = JSON.parse(await dependencies.gh(['api', `repos/${DEMO_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${commit}&per_page=5`]));
  const run = runs.workflow_runs?.[0];
  if (run?.status === 'completed') {
    if (run.conclusion !== 'success') throw new ReleaseCaseLabError(`${DEMO_REPOSITORY} ci.yml on ${commit} concluded ${run.conclusion}: ${run.html_url}. The Case Lab cannot repair anything while the demo suite is red.`);
    break;
  }
  if (Date.now() > deadline) throw new ReleaseCaseLabError(`${DEMO_REPOSITORY} ci.yml on ${commit} did not complete within 15 minutes`);
  await dependencies.sleep(30_000);
}
```

Also in `scripts/release-case-lab.mjs` `newestReleaseTag`: retry `git ls-remote` and `git fetch --quiet origin main` up to 3 times with 2 s / 4 s backoff on transport errors (`SSL_ERROR_SYSCALL`, `Could not resolve host`, `Connection reset`, `unable to access`) before refusing, so a network blip in the pre-push hook does not block a push (observed three times on 2026-09-15). Test: a `git` stub that throws `unable to access … SSL_ERROR_SYSCALL` twice then succeeds → `check` passes; three throws → refuses with the transport error in the message.

`scripts/release-case-lab.test.mjs`: extend test 6 (`gh` stub returns the
commit, then `queued` → `completed/success`; `sleep` stubbed) and add
"publish-demo refuses when the demo CI on the published commit is red"
(message names the repo, workflow, commit, conclusion and URL).

## Verification

```bash
gh run list -R juan294/sutura-demo --workflow ci.yml --branch main -L 1 --json conclusion   # success
node --test scripts/release-case-lab.test.mjs
pnpm run ci:fast
```

## Done when

Demo CI green on `main`; the guard is back; both test files are shape-based;
`publish-demo` has the CI check with tests; committed on a worktree branch and
pushed (gate passes: pins unchanged). Record the demo commit SHA in the phase
report. STOP.
