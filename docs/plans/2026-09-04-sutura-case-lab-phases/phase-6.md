# Phase 6: Live path in the demo repository, release pin, gate preparation

Issues: #51 (demo pinned to an exact release identity, tested against `v0.2.0`), #50 (public demo usable by a signed-out non-collaborator; prepared to the gate), #68 (demo README final text)

Depends on: Phases 3 and 5

## Goal

`juan294/sutura-demo` has a fail-closed `case-lab.yml` workflow that the dispatcher targets, pinned to the release identity in `packages/case-lab/release.json`, publishing public-safe result documents to the `case-lab-results` branch. Everything up to Gate A and Gate B is done, tested, and pushed; the gates themselves are recorded, not executed.

## Files in this repository

```
packages/case-lab/demo/case-lab.yml                 committed copy of the demo workflow (source of truth; the demo repo copy must be byte-identical)
packages/case-lab/demo/materialize-case-lab-case.mjs committed copy of the demo materializer
packages/case-lab/src/pin.ts                        loadRelease(), verifyPin({ workflowText, release, tagSha? })
packages/case-lab/src/publish.ts                    publishResult(inputs) -> CaseLabResult  (used by `case-lab publish-result` in the workflow)
packages/case-lab/src/bin.ts                        publish-result, verify-pin, dispatch --base-url --case, capture-replay
packages/case-lab/src/pin.test.ts, publish.test.ts, demo-workflow.test.ts
```

## Files in `/Users/juan/code/sutura-demo`

```
.github/workflows/case-lab.yml                      copied from packages/case-lab/demo/case-lab.yml
scripts/materialize-case-lab-case.mjs               copied from packages/case-lab/demo/
test/case-lab-workflow-contract.test.js             permissions, inputs, gate steps, pin, no secrets outside the Action step
README.md                                           Case Lab section final text, pin sentence referencing release.json
```

## `case-lab.yml` contract

```yaml
name: Case Lab
run-name: Case Lab ${{ inputs.request-id }} ${{ inputs.case-id }}
on:
  workflow_dispatch:
    inputs:
      case-id:    { type: choice, required: true, options: [javascript-repair, python-repair, flaky-failure, greenwash-trap, upstream-incident] }
      request-id: { type: string, required: true, description: Bounded dispatcher request id }
permissions: { actions: write, checks: write, contents: write, pull-requests: write }
concurrency: { group: case-lab, cancel-in-progress: false }
env:
  SUTURA_ACTION_SHA: a943ded4c734aed75c5c63f2b2dd63a2f44556c2     # must equal packages/case-lab/release.json actionSha (verify-pin)
  SUTURA_CONTROLLER_SHA: <develop commit that contains packages/case-lab>   # tooling checkout; WS-4 sets both to the submitted release
  CASE_LAB_DAILY_RUN_CAP: '8'
jobs:
  case:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - Gate: test "${{ vars.CASE_LAB_ENABLED }}" = true || { echo "Case Lab is disabled: set repository variable CASE_LAB_ENABLED=true to enable"; exit 1; }
      - Validate: [[ "$REQUEST_ID" =~ ^cl-[0-9]{13}-[a-f0-9]{8}$ ]]; case-id is one of the five (bash case statement)
      - Daily cap: count=$(gh run list --workflow case-lab.yml --created ">=$(date -u +%Y-%m-%dT00:00:00Z)" --json databaseId --jq length); test "$count" -le "$CASE_LAB_DAILY_RUN_CAP" || exit 1   (this run is included in the count)
      - Check out trusted demo main (persist-credentials: false), record DEMO_SHA
      - Check out juan294/sutura at SUTURA_CONTROLLER_SHA into .sutura (persist-credentials: false); pnpm install --frozen-lockfile; pnpm build (only @sutura/core and @sutura/case-lab filters)
      - Materialize: node scripts/materialize-case-lab-case.mjs "$CASE_ID"  (break -> scripts/materialize-break.mjs <name>; matrix -> scripts/materialize-matrix-case.mjs python-repair)
      - Branch case-lab/<request-id>/<case-id>; commit; push; open PR for repair cases (javascript-repair, python-repair, upstream-incident); flaky and trap open a PR too (Sutura reports on the PR)
      - Dispatch red CI: ci.yml for node cases, matrix-fixture-ci.yml -f case-id=python-repair for python; gh run watch must fail; record CI_RUN_ID
      - Action: uses juan294/sutura/packages/action@${{ env.SUTURA_ACTION_SHA }} with github-token, run-id, nebius-api-key, tavily-api-key, contree-token, contree-project, capture-replay: 'true', runtime from the case; continue-on-error: true; id sutura
      - Collect: download sutura-replay-<CI_RUN_ID>.json from this run (retry 12 x 5 s); find case-file artifact id; repair PR url (gh pr list --head sutura/fix-<CI_RUN_ID>); check run url (external_id sutura:<repo>:workflow-run:<CI_RUN_ID>)
      - Publish: node .sutura/packages/case-lab/bin/case-lab.js publish-result --request-id --case --outcome "${{ steps.sutura.outputs.outcome }}" --replay <file> --demo-sha --controller-sha --workflow-run-url --ci-run-url --pull-request-url --repair-pull-request-url --check-url --case-file-artifact-url --replay-artifact-url --out "$RUNNER_TEMP/result.json"
      - Commit result: git worktree add "$RUNNER_TEMP/results" case-lab-results (create orphan on first use); copy to results/<request-id>.json (refuse overwrite); commit; push
      - Upload artifact sutura-case-lab-<request-id> (result.json), if-no-files-found: error, retention 90 days
```

`uses:` cannot read `env` at the `uses` position in GitHub Actions; the pin is therefore a literal in the `uses:` line and `verify-pin` parses that literal. `SUTURA_ACTION_SHA` in `env` is kept equal to it for the shell steps; the contract test asserts both literals are identical.

Provider secrets appear only in the Action step (`with:`), never in `env:` of any other step; the contract test asserts that the string `secrets.` occurs only inside the `Action` step block (#63).

## `publish-result`

```ts
export async function publishResult(inputs): Promise<CaseLabResult>
  const case = caseLabCase(inputs.caseId)
  let caseFile: CaseFile | undefined; let replayedFrom
  if inputs.replayPath: bundle = parseReplayBundle(read); if bundle.actionSha !== release.actionSha -> throw
      if bundle.completeness.complete: ({ caseFile } = await replayBundle(bundle)); require caseFile.outcome === inputs.outcome
      else: caseFile = undefined  (result carries outcome and links only; page explains "bundle partial")
  outcome = inputs.outcome must be one of five outcomes (an empty Action output means infra-stop)
  cost: from caseFile when present, else { status: 'unavailable' }
  result = createCaseLabResult({ mode: 'live', requestId: inputs.requestId (validated), ... links from inputs (each publicGitHubUrl) })
  assertCaseLabResultPublicSafe(result, [process.env.NEBIUS_API_KEY, ...]) ; write with flag 'wx'
```

## Pin (#51)

- `release.json` holds `{ version: '0.2.0', actionSha: 'a943ded4c734aed75c5c63f2b2dd63a2f44556c2' }` (the current public release; `docs/demo/sutura-v0.2.0-phase-0-evidence.md:11`).
- `verifyPin({ workflowText, release })` asserts the `uses:` literal and `SUTURA_ACTION_SHA` equal `release.actionSha`; `case-lab verify-pin --tag v0.2.0` additionally runs `gh api repos/juan294/sutura/git/ref/tags/v0.2.0` (dereferencing an annotated tag to its commit) and `gh api repos/juan294/sutura-demo/contents/.github/workflows/case-lab.yml?ref=main` and asserts both agree with the committed copy. The unit test covers the parser; the networked check is run once in this phase and its output recorded in the notes.
- `demo-workflow.test.ts` asserts the committed copy under `packages/case-lab/demo/` parses, has exactly the two inputs, the five choice options equal `CASE_LAB_CASES` ids, the permission set is exactly the four listed, `id-token` is absent, the concurrency group is the static string `case-lab`, and the gate step precedes every checkout.

## Gate preparation (#50)

- `case-lab dispatch --base-url <url> --case <id>` posts to `/api/dispatch` and prints the request id and result URL (used by Gate B and by a maintainer smoke test).
- The plan's "Authorization gates" section holds the exact commands, cap, and expected cost; the notes file records the date the gate was presented.
- Push the demo repository changes to `main` with `CASE_LAB_ENABLED` unset, so the workflow refuses at its first step and no provider call is possible; verify with `gh workflow run case-lab.yml -R juan294/sutura-demo -f case-id=flaky-failure -f request-id=cl-0000000000000-00000000` that the run fails at the gate step within one minute (this dispatch is free: no checkout, no provider call).

## Verification

```bash
pnpm --filter @sutura/case-lab test && pnpm run typecheck && pnpm run lint && pnpm run build && pnpm run ci:fast
cd /Users/juan/code/sutura-demo && pnpm test && pnpm run typecheck && pnpm run lint && pnpm run verify:readme
node packages/case-lab/bin/case-lab.js verify-pin --tag v0.2.0
```

## Success criteria

- [x] Demo workflow is fail-closed (disabled by default, input re-validation, daily cap, static concurrency, minimum permissions, secrets only in the Action step), with contract tests in both repositories.
- [x] Pin verified against `v0.2.0`; `verify-pin` proves tag, file, and workflow agreement.
- [x] Disabled dispatch proven on the real repository with a free run that fails at the gate step.
- [x] Gate A and Gate B recorded with exact commands, cap, and expected cost.
