# Phase 4: Deterministic replay for every case, labeled

Issues: #64 (deterministic replay for every case using `packages/core/src/replay`), #65 (label live and replayed runs)

Depends on: Phase 2

## Goal

`case-lab replay <case-id>` produces a validated `CaseLabResult` for every one of the five cases without credentials or network, from one of two evidence sources, each labeled by `mode`:

1. `replay`: a complete replay bundle at `packages/case-lab/replay/<case-id>.json` replayed through `replayBundle` (`packages/core/src/replay/replay-orchestrate.ts:67`). The replayed outcome must equal the bundle's recorded outcome (the CLI contract at `packages/cli/src/replay.ts:62-67`).
2. `recorded`: the committed live result for the case's Placebo id in `docs/demo/placebo-v0.2-live-2026-09.json` with its run URL from `docs/demo/placebo-v0.2-live-ledger-2026-09.json`, when no complete bundle exists yet.

Today no complete bundle exists for any of the five cases (research section 2.3), so the catalog is `recorded` for all five; `python-repair` and `upstream-incident` honestly carry `outcome: infra-stop` from the v0.2.0 baseline with `matchesExpectation: false`. Gate B captures bundles for `javascript-repair` and `greenwash-trap`.

## Files

```
packages/case-lab/src/replay.ts        recordedResult(caseId, sources), replayedResult(caseId, bundle), replayCatalog()
packages/case-lab/src/evidence.ts      loadRecordedEvidence(rootDir) -> { result, ledger } with hash checks
packages/case-lab/src/bin.ts           CLI: replay <case-id> [--out file] | catalog [--out dir] | capture-replay --request-id <id> --out dir | publish-result ... (Phase 6 fills publish-result)
packages/case-lab/replay/README.md     what a bundle is, how it is captured, the sha binding to release.json
packages/case-lab/src/replay.test.ts, evidence.test.ts, bin.test.ts
```

## Pseudocode

```ts
export async function replayCatalog(options: { rootDir; replayDir; now }): Promise<CaseLabResult[]>
  for each case in CASE_LAB_CASES:
    bundlePath = replayDir/<id>.json
    if exists(bundlePath): result = await replayedResult(case, parseReplayBundle(JSON.parse(read)))   // partial bundle -> throws (fail closed)
    else: result = recordedResult(case, loadRecordedEvidence(rootDir))
    validateCaseLabResult(result)
  return results

export function recordedResult(case, evidence): CaseLabResult
  entry = evidence.result.results.find(r => r.caseId === case.placeboCaseId && (r.tavilyEnabled ?? true))  // upstream: the Tavily-enabled arm
  ledgerEntry = evidence.ledger.entries.find(e => e.caseId === case.placeboCaseId)
  return createCaseLabResult({ requestId: `recorded-${case.id}`, mode: 'recorded', caseId, release: from release.json, identity: { controllerSha: evidence.result.controllerSha },
    outcome: entry.caseFile.outcome, expectedOutcome, matchesExpectation, links: { workflowRun: ledgerEntry.runUrl, evidence: 'https://github.com/juan294/sutura/blob/develop/docs/demo/placebo-v0.2-live-2026-09.json' },
    caseFile: entry.caseFile, recordedFrom: { file, resultHash: evidence.result.resultHash, runUrl, subjectSha: evidence.result.subjectSha, recordedAt: ledgerEntry.recordedAt },
    cost: { inferenceUsd: sum(entry.caseFile.cost.entries.usd), sandboxUsd: sum(stage.metrics.cost), status: 'observed' }, elapsedMs: entry.elapsedTimeMs, createdAt })

export async function replayedResult(case, bundle): CaseLabResult
  if bundle.actionSha !== release.actionSha -> throw CaseLabReplayError(`replay bundle actionSha must equal release.json actionSha ${release.actionSha}`)
  const { caseFile } = await replayBundle(bundle)
  if caseFile.outcome !== bundle.outcome -> throw (same contract as the CLI)
  return createCaseLabResult({ mode: 'replay', requestId: `replay-${case.id}`, replayedFrom: { bundleSha256, capturedRunUrl: bundle-derived, actionSha }, caseFile, ... })
```

`loadRecordedEvidence` verifies `result.resultHash` by recomputing the canonical hash of the base (same rule as `scripts/placebo-live.mjs:431-476`; `ledgerHash` must equal `ledger.resultHash`) so a tampered evidence file cannot feed the Case Lab. The recorded `caseFile` objects must be plain data (the file stores `cost.entries` without `totalUsd()`); `CaseLabResult.caseFile` is the plain shape.

`capture-replay`: `gh run download <run-id> -R juan294/sutura-demo --name sutura-replay-<ci-run-id>.json` into a temp dir, parse with `parseReplayBundle`, require `completeness.complete`, require `actionSha === release.actionSha`, write `replay/<case-id>.json` with `flag: 'wx'` (never overwrite), print the SHA-256. The run id and ci run id come from the published result JSON (`links.workflowRun`, `links.ciRun`).

## Labels (#65)

`modeLabel(mode)` from Phase 2 is the only label source. Each result JSON carries `mode`; the site (Phase 5) renders the label in the page title, the header badge, and the `<title>`. Tests assert the three literal strings.

## Tests

- `replayCatalog` returns five validated results, one per case, in `CASE_LAB_CASES` order; all `recorded` today; `javascript-repair` is `fixed`, `flaky-failure` is `flaky-no-patch`, `greenwash-trap` is `refused`, `python-repair` and `upstream-incident` are `infra-stop` with `matchesExpectation: false` (this test pins the honest baseline; it changes only when a bundle is captured or the evidence file is replaced).
- A synthetic complete bundle (`createCompleteReplayBundleForTest` from `@sutura/core`, with `actionSha` set to the release sha) replays through `replayedResult` and yields `mode: 'replay'`; a partial bundle throws; a bundle with a different `actionSha` throws with the release sha in the message.
- Tampered `resultHash` in a copied evidence file throws.
- Explicit timeouts of at least 30 s on tests that replay a bundle.

## Verification

```bash
pnpm --filter @sutura/case-lab test && pnpm run typecheck && pnpm run lint && pnpm run build
node packages/case-lab/bin/case-lab.js catalog --out /tmp/case-lab-catalog   # five files, each validates
```

## Success criteria

- [x] Every case has a tested deterministic result source.
- [x] Replay bundles are bound to the release sha and fail closed when partial or drifted.
- [x] `mode` and its three labels are the single source of truth for live versus replay.
