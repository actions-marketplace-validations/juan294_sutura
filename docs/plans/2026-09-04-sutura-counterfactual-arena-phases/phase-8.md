# Phase 8: Arena report page and machine-readable report

Issue: #53

Depends on: Phase 5, Phase 6, Phase 7

## Goal

One concise public result page and one downloadable machine-readable report,
both derived from a single validated comparison manifest, showing every measure
the roadmap "Public Arena view" section lists.

## Step 1 - The machine-readable report

`packages/placebo/src/arena.ts` (new).

```ts
export const ARENA_REPORT_SCHEMA_VERSION = 'sutura-arena-report-v1' as const;

export interface ArenaReport {
  schemaVersion: typeof ARENA_REPORT_SCHEMA_VERSION;
  comparison: ComparisonManifest;      // embedded, not restated
  selection?: ArenaSelectionManifest;  // present for a selection-driven run
  counterfactual?: { schemaVersion: string; resultHash: string; totals: ... };
  measures: ArenaMeasures;
  generatedAt: string;
  resultHash: string;
}
```

`measures` is computed from the manifest, never entered by hand, and covers
exactly the roadmap list:

| Roadmap measure | Source |
| --- | --- |
| Repair success rate | `Score.fixRate` per arm, with a Wilson 95 percent interval |
| False approval count and rate | `Score.falseApprovalCount` and `catchRate` per arm |
| Flake and upstream classification accuracy | `Score.flakyAccuracy`, `Score.flakeAccuracyByPattern`, `Score.ablation` |
| Median and tail latency | median and p95 of `ComparisonObservation.elapsedTimeSec` per arm |
| Provider and sandbox cost | sum and median of `inferenceUsd`; `ComparisonArmRecord.totals` |
| Token and sandbox operation counts | sum and median of `sandboxOperations`; token totals from the evaluation manifests when present |
| Resource use | `Score.medianSandboxOperations`, `Score.budgetExhaustionCount` |
| Results by language and failure class | `Score.languageMeasures`, `Score.repairRateByFailureClass`, and per-arm grouping of observations |
| Complete failures and refusal reasons | every `fixRate.failures` entry plus a refusal-reason histogram from the observations |

`resultHash` normalizes `generatedAt` and every `elapsedTimeSec` before hashing,
matching the Phase 3 and Phase 5 rule, so the report is reproducible.

`arenaReport(manifest, extras)` calls `validateComparison` first and refuses an
incomplete manifest unless `allowIncomplete` is set, in which case the report
is marked `complete: false` and the page says so in its first line.

## Step 2 - The page

`renderArena(report): string` produces one self-contained HTML document in the
same house style as `packages/core/src/report/casefile.ts`: inline styles, no
external asset, light and dark palettes, a `table-wrap` scroll container for
every wide table, a mobile breakpoint, and `escapeHtml` on every interpolated
value.

Structure:

1. Header: comparison id, Sutura commit, corpus name and version, case count,
   completeness, and a one-line statement of what is held identical across arms.
2. Headline row: repair success rate and false approval count per arm, side by
   side, with intervals.
3. Why green is not enough: the counterfactual totals, when the counterfactual
   report is supplied, linking the rejected-alternative count and the distinct
   rejecting gates.
4. A measure table per roadmap measure, one column per arm.
5. Results by language and by failure class.
6. Complete failures: every case id that no arm repaired, and the refusal
   reason histogram. No failed case is hidden.
7. Reproduction footer: the exact commands, the selection manifest hash, the
   corpus hash, the comparison result hash, and the report result hash.

The page never renders a patch body and never renders a repository path from an
untrusted source without escaping.

## Step 3 - CLI and artefacts

`packages/placebo/src/cli.ts`:

```
placebo arena --comparison <file> [--selection <file>] [--counterfactual <file>]
              --output-json <file> --output-html <file> [--force] [--allow-incomplete]
```

Committed artefacts from the offline control run:

- `docs/demo/sutura-arena-v0.2.json`
- `docs/demo/sutura-arena-v0.2.html`

These are the control-adapter Arena, clearly labelled as controls, proving the
renderer and the report end to end with no paid dispatch. The measured Arena
over real cases is produced under gate G2 and replaces these as the public
evidence, with the control artefacts retained.

## Tests

`packages/placebo/src/arena.test.ts`:

- every roadmap measure appears in `measures` and in the rendered page
- an incomplete comparison is refused without `allowIncomplete` and is labelled
  when allowed
- `resultHash` is stable across `generatedAt` and timing changes and unstable
  across any measure change
- the page escapes a case id containing HTML metacharacters
- the page contains no `<script>` and no external URL other than the recorded
  evidence links
- the failures section lists every case in `fixRate.failures` for every arm, so
  no failed case is removed from the denominator

## Success criteria

- [ ] All listed tests pass.
- [ ] Control Arena JSON and HTML committed and reproducible.
- [ ] The page renders every roadmap "Public Arena view" measure.
- [ ] `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`.
- [ ] Gate G2 recorded with its exact command, cap, reserve, and stop condition.
