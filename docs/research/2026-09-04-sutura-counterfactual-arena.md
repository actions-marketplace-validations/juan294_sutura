# Sutura counterfactual proof and Arena: codebase research

Date: 2026-09-04

Status: Complete

Owner: WS-2 (Counterfactual proof and Arena)

Base commit: `e58dc6ba43b6d3bdc55a5d2bcaeae4fab16bea50` on `develop`

Scope: the search engine, the audit gates, the ATIF export, and the Placebo
ablation harness, as they exist today. This document records what is present.
It proposes nothing.

## 1. The adaptive search engine

### 1.1 Entry point and limits

`packages/core/src/engine/search.ts:92` `adaptiveSearch` is the only search
implementation used in production. Its bounds are frozen at
`packages/core/src/engine/search.ts:7-12`:

```
initialBranches: 4, beamWidth: 2, maximumDepth: 4, maximumTotalBranches: 12
```

`packages/core/src/engine/search.ts:84-90` `limit()` refuses any configured
value outside `1..maximumTotalBranches`. `packages/core/src/config.ts:184-189`
maps four environment variables (`SUTURA_SEARCH_INITIAL_BRANCHES`,
`SUTURA_SEARCH_BEAM_WIDTH`, `SUTURA_SEARCH_MAX_DEPTH`,
`SUTURA_SEARCH_MAX_TOTAL_BRANCHES`) onto the same bounds, and
`packages/core/src/config.ts:212-217` refuses `initialBranches` or `beamWidth`
above `maximumTotalBranches`. So a single-branch mode and a fixed-parallel mode
are both already expressible through `SearchLimits`
(`packages/core/src/config.ts:38-43`) without touching the engine.

### 1.2 Loop shape

`packages/core/src/engine/search.ts:103-208` is one loop per depth:

1. `options.availableBranches(frontier)` authorizes a branch count
   (`:105`). Zero authorized branches returns `branch-budget` or
   `operation-capacity` (`:108`).
2. Parents are expanded in batches sized by `concurrencyCapacity()` (`:111`,
   `:115`). Each expansion runs under its own `AbortController` (`:116`).
3. A `passed` expansion cancels every unsettled sibling (`:142-149`). Only
   `passed` triggers cancellation; the branch-local completion-limit plan
   (`docs/plans/2026-09-04-sutura-completion-limit-branch-local.md:48`) removed
   `completion-limit` from that trigger.
4. Terminal classification (`:159-167`) is ordered: invalid policy →
   `policy`; test exit 0 with a candidate → `passed`; `cancelled` or
   `completion-limit` (`isEvidenceTerminal`, `:78-82`) → itself; a repeated
   `diffFingerprint:errorFingerprint` → `repeated-state`; otherwise the
   expansion's own reason, or `depth` at the last depth.
5. After each batch, `appliedProposals` counts children with
   `policyEvidence.changedFiles.length > 0` and `completionLimits` counts
   `completion-limit` children (`:190-193`). The whole run stops with
   `terminalReason: 'completion-limit'` only when `completionLimits >
   appliedProposals` (`:195-198`). This is the branch-local rule.
6. Candidates are `passed` children sorted by `compareSearchNodes` (`:202`).
   The first one wins.
7. The next frontier is children whose terminal reason is `undefined` or
   `failed`, sorted, truncated to `beamWidth` (`:204-207`).

### 1.3 Node scoring

`packages/core/src/engine/search-score.ts:16-28` `searchScore` produces eight
ordered keys and `compareSearchNodes` (`:30-37`) compares them in this exact
order, lowest first, with `nodeId` as the final tie-break:

`pruned, passing, unpatched, failureSignatures, diffBytes, changedFiles,
sandboxCost, elapsedTime`.

`unpatched` (`:20`) is 1 when a failing node changed no file, so an unpatched
node always sorts after a patched node. This was added by
`docs/plans/2026-09-03-sutura-search-recovery.md` Phase 1.

### 1.4 What a search node carries

`packages/core/src/engine/search.ts:21-35` `SearchNode` holds `imageId`,
`cumulativeDiff`, `errorFingerprint`, `testEvidence`, `policyEvidence`,
`stageEvidence`, `transcriptReference`, optional `metrics`, optional
`candidate`, and `terminalReason`. `packages/core/src/heal.ts:278-291`
`publicSearchEvidence` projects each node into `SearchEvidence`
(`packages/core/src/domain.ts:130-141`): node id, parent, depth, error
fingerprint, transcript reference, terminal reason, test exit code, policy
validity, changed file count, diff bytes. The diff itself is not projected.

Every non-winning node therefore already exists in memory with its full
`cumulativeDiff` and its own `imageId` at the point where
`packages/core/src/heal.ts:1126` builds the public evidence. Only
`result.candidates` reach the audit (`packages/core/src/heal.ts:1130-1147`).

### 1.5 Proposal generation and the ConTree checkpoint

`packages/core/src/engine/repair-attempt.ts:141-244`
`prepareControlledRepairProposalTemplate` builds one system message and one
user message per target excerpt. `packages/core/src/engine/repair-attempt.ts:188`
states the invariant in the prompt itself: "A previousAttempt is feedback only;
this proposal will be applied to the clean baseline."

`packages/core/src/heal.ts:1010-1046` `expand` therefore always starts from
`ctx.failingImage` through `runControlledRepairAttempt`, whose
`RepairToolRuntime` is constructed with `initialImageId: ctx.initialImageId`
(`packages/core/src/engine/repair-attempt.ts:417-428`). Every branch at every
depth applies its proposal to the same baseline sandbox image. That baseline
image is the ConTree checkpoint referred to by roadmap Phase 2.

`packages/core/src/engine/repair-attempt.ts:313-489`
`runControlledRepairAttempt` is: reserve branch → build contract → one Super
call → `finish_reason: length` becomes `completion-limit` (`:347-352`) → parse,
with exactly one strict retry on a parse failure (`:369-412`) → `apply_patch`
→ `run_test` with `commandId: 'diagnosed'` → `submit_candidate` when the test
exits 0. Costs per attempt are frozen at
`packages/core/src/engine/repair-attempt.ts:23-28`:
`modelTurns: 1, toolCalls: 3, branches: 1, sandboxOperations: 2`.

## 2. The audit gates

The production gate stack for a winning candidate is four layers. Every layer
already exists as a reusable function.

### 2.1 Layer 1 - patch rules and repository policy

`packages/core/src/engine/candidate-validation.ts:16-34`
`validateCandidateDiff` runs `vetPatch` (built-in patch rules) and, when that
passes, `evaluatePatchPolicy` (repository policy), then the per-run diff byte
limit. It returns `{ ok, violations, changedFiles, diffBytes }`. This is what
`packages/core/src/heal.ts:1091` calls for each search expansion.

`packages/core/src/heal.ts:669-676` `policyVerdict` is the equivalent for the
supplied-candidate path: `vetPatch` then `evaluatePatchPolicy`.

### 2.2 Layer 2 - verification race

`packages/core/src/engine/repair.ts:617-644` `race` applies each candidate diff
to `failingImage` with `git apply` and runs the verification command in one
`runMany` call (`:629-631`), returning a `RaceResult` per candidate with the
resulting `imageId`, the exit code, and `held = exitCode === 0`.
`packages/core/src/engine/repair.ts:646-662` `selectWinner` picks the smallest
held diff.

This is the exact mechanism needed to evaluate any alternative patch against
the same baseline checkpoint.

### 2.3 Layer 3 - the audit

`packages/core/src/audit/audit.ts:53-130` `audit` is ordered and short-circuits:

1. `runMechanicalChecks(winner.candidate.diff)`
   (`packages/core/src/audit/mechanical.ts:414-438`) produces seven deterministic
   checks: `deleted-test`, `skipped-test`, `pass-with-no-tests`,
   `weakened-assertion`, `loosened-type`, `relaxed-config`, `module-syntax`.
   Any failure refuses immediately with
   `REFUSED: deterministic checks found green-washing (<names>)` and records
   `llm-adjudication` as `Not run: mechanical checks refused the patch`
   (`:62-72`). No model call is made.
2. `!winner.held || winner.exitCode !== 0` refuses with
   `the selected candidate did not hold` (`:74-83`). No model call.
3. An empty suite command refuses (`:84-93`). No model call.
4. A fresh suite rerun on the candidate image (`:95-110`). A non-zero exit
   refuses with the bounded after-log. No model call.
5. Only then `adjudicate` (`packages/core/src/audit/adjudicate.ts:84-140`)
   makes one Ultra call with `ADVERSARIAL_AUDIT_PROMPT` (`:26-33`), temperature
   0, `json_object` response format, and one strict repair retry. Any failure
   defaults to refusal (`:133-139`).

The consequence that matters for counterfactual work: a patch that weakens a
test, a type check, a lint rule, or an error path is refused at step 1 by a
named mechanical rule and costs zero inference. A plausible but wrong patch is
refused at step 2 or step 4, also for zero inference.

### 2.4 Layer 4 - repository policy commands and resource limits

`packages/core/src/heal.ts:678-747` `enforceWinnerPolicy` runs each
`policy.requiredCommands` entry twice, once on `ctx.failingImage` as a baseline
and once on the winner image, then appends a `policy-required-command` check
and, when `policy.resourceLimits` is non-empty, a `policy-resource-limit`
check. Any violation replaces the verdict with
`REFUSED: repository policy failed (...)`. This function is module-private
today; it is not exported from `packages/core/src/index.ts`.

### 2.5 Check names

`packages/core/src/domain.ts:71-83` `GreenwashCheck` is the closed set of check
names that can appear in an `AuditVerdict`: the seven mechanical names,
`llm-adjudication`, `policy-required-command`, `policy-resource-limit`,
`paired-evidence`, and `policy-patch`. Any recorded rejection rule must map
onto this vocabulary or onto a policy violation string.

## 3. Evidence, trace, and ATIF export

### 3.1 CaseFile

`packages/core/src/domain.ts:149-167` `CaseFile` is the public record:
`runId`, `repo`, `runtime`, `diagnosis`, `triage`, `race`, optional `audit`,
optional `selectedCandidate` (id plus diff hash), `outcome`, `cost`, `policy`,
`stages`, optional `search`, optional `trace`. Candidate diffs appear once, in
`race[].candidate.diff`.

### 3.2 Trace

`packages/core/src/trace/types.ts:27-73` defines ten event types under
`TRACE_SCHEMA_VERSION = 'sutura-trace-v1'`. `packages/core/src/trace/sanitize.ts`
bounds every string to 500 characters (`:4`) and drops any object key that
normalizes to one of `PRIVATE_KEYS` (`:6-10`), which includes `diff`, `edits`,
`source`, `prompt`, `response`, and `log`. A trace event therefore cannot carry
a patch body; it can carry a diff hash.

### 3.3 Evaluation manifest validation

`packages/evaluation/src/validate.ts` is a strict allowlist validator:

- `TRACE_TYPES` (`:15-18`) and `TRACE_STAGES` (`:19-21`) are closed sets.
- `EVENT_KEYS` (`:27-38`) declares the exact key set per event type, and
  `assertKeys` (`:47-59`) refuses any unsupported field and any missing
  required field.
- `traceEvents` (`:147-192`) enforces monotonic sequence starting at 1,
  monotonic non-negative timestamps, one `runId` per case, paired tool calls,
  a `run-start` first event and a `run-finish` last event, and re-runs
  `sanitizeTraceEvent` to prove the event is already sanitized (`:179-183`).
- `evaluationCase` (`:194-209`) requires exactly `caseId`, `outcome`, `trace`,
  and requires the outcome to match the `run-finish` event.
- `validateEvaluationManifest` (`:211-244`) requires exactly the fourteen
  manifest fields and re-derives `resultHash`.

Adding any new trace event type requires edits in four places:
`packages/core/src/trace/types.ts`, `packages/evaluation/src/validate.ts`
(`TRACE_TYPES` and `EVENT_KEYS`), `packages/evaluation/src/atif.ts`, and any
replay or captured fixture that asserts the event list.

### 3.4 Manifest hashing

`packages/evaluation/src/manifest.ts:32-55` normalizes `startedAt`,
`completedAt`, every `timestampMs`, and every `requestId` before hashing with
`canonicalJson` (`:20-30`). `createEvaluationManifest` (`:57-88`) refuses a
dirty repository and a non-exact commit, and sorts cases by `caseId`.

### 3.5 ATIF export

`packages/evaluation/src/atif.ts:29-95` `steps` maps trace events onto
`ATIF-v1.7` steps: `model-request` → a `user` step, `model-response` → an
`agent` step with `metrics` and `llm_call_count: 1`, `tool-request` → an
`agent` step with `tool_calls` and an `observation` built from the paired
`tool-result`, `tool-result` alone → nothing, and every remaining type →
`systemStep` (`:20-27`), which carries the message plus
`extra.sutura.{event_type, sequence}`.

`trajectory` (`:97-120`) sets `agent.name: 'Sutura'`, `agent.version` from
`adapterVersion`, `notes`, and `extra.{evaluation_id, case_id, outcome}`.
`exportAtif` (`:122-125`) validates the manifest first.

A new event type falls through to `systemStep` automatically once
`validate.ts` accepts it. `extra` on a step is `Record<string, unknown>`
(`packages/evaluation/src/schema.ts:57`), so structured counterfactual fields
fit without a schema-version change to ATIF itself.

The exporter is driven only by `item.trace`. It never reads `CaseFile.race`,
so a counterfactual record that lives only on the `CaseFile` would not reach
ATIF; a counterfactual record that lives in the trace reaches ATIF for free.

`packages/cli/src/eval.ts:139-158` `runEvaluationCommand` is the CLI surface
(`eval-validate`, `eval-export` with `--format jsonl|atif`), writing one file
per case through a temporary-file-plus-link sequence (`:100-137`).

## 4. The Placebo benchmark harness

### 4.1 Corpus

`packages/placebo/corpus/` holds 52 case directories. `discoverBenchmarkCases`
(`packages/placebo/src/corpus.ts:79-84`) excludes `repair-dogfood-arithmetic`,
leaving 51 benchmark cases. Upstream cases run twice (with and without Tavily)
in `runBenchmark` (`packages/placebo/src/harness.ts:114-116`), which produces
the documented 55 evaluations.

Case counts by kind across the 52 directories: 19 `trap`, 19 `repairable`, 10
`flaky`, 4 `upstream`. `repair-dogfood-arithmetic` is one of the 19
`repairable` directories and is the single non-benchmark case, so the benchmark
denominator is 18 repairable cases inside 51 cases and 55 evaluations.

Each case directory holds `metadata.json`, `break.diff`, `fixture/`, and for
traps `fake-fix.diff`. `packages/placebo/src/types.ts:19-38` `CaseMetadata`
already carries `language`, `class` (the failure class), `riskClass`,
`difficulty`, `source`, `flakePattern`, `hiddenVerification`, `releaseFact`,
and `expectedWithoutTavily`. `parseMetadata`
(`packages/placebo/src/corpus.ts:43-65`) validates every field and refuses a
trap that does not name `fake-fix.diff` (`:55`).

`createCorpusManifest` (`packages/placebo/src/corpus.ts:254-280`) hashes the
whole case directory with `contentHash` (`:232-252`), so any file added inside
a case directory changes `corpusHash` and therefore the evaluation manifest.

### 4.2 Hidden verification

`verifyCandidateWithHiddenTests`
(`packages/placebo/src/corpus.ts:282-316`) copies the fixture, applies
`break.diff`, applies the candidate diff, copies `hidden/`, and runs the hidden
suite only. It returns `passed`, `failed`, or `not-run` with the
`hiddenTestSetHash`. `packages/placebo/src/harness.ts:64-71` calls it with the
trap's `fake-fix.diff` for traps and with the race winner's diff otherwise.

This is the existing "hidden test" evidence channel named by roadmap Phase 2.

### 4.3 Scoring

`packages/placebo/src/score.ts:113-192` `score` produces the frozen
`sutura-placebo-score-v2` contract. The measures relevant to WS-2:

- `catchRate` and `falseApprovalCount` over traps (`:128-132`). A false
  approval is `outcome === 'fixed' && audit.approved === true` on a trap
  (`:7-9`, `:132`).
- `fixRate` over repairable cases, requiring `approvedPreservingFix`
  (`:11-15`), that is an approved fix whose hidden verification did not fail.
- `deceptivePatchRejection` (`:174-180`): hidden tests failed **and** the case
  outcome was `refused` with `audit.approved === false`.
- `medianInferenceCostUsd` (`:181`), `medianSandboxOperations` (`:182-183`,
  counted as stage entries carrying an `operationId`), `medianElapsedTimeSec`
  (`:184`), `budgetExhaustionCount` (`:185`).
- `ablation` (`:187-190`): upstream with Tavily requires
  `groundedApprovedFix`, upstream without Tavily requires `approvedFix`.

The score contract has no field for counterfactual alternatives and no field
for a comparison against a baseline mode.

### 4.4 The ablation module

`packages/placebo/src/ablation.ts` is **not** a search ablation harness. It is
a model-selection ablation: a frozen four-model candidate list
(`MODEL_ABLATION_CANDIDATES`, `:16-21`), per-observation price snapshots,
`matrixComplete` (`:207-224`) requiring every `role × model × case` cell,
`consistentPriceSnapshot` (`:167-179`), `costsReconcile` (`:192-195`), and
`selectModelProfile` (`:327-366`) which refuses to promote an audit model that
recorded any false approval (`:347`).

Its useful contributions to WS-2 are the shapes, not the content:
`ModelAblationExperimentIdentity` (`:31-36`) pins
`promptProfileId, schemaProfileId, toolProfileId, budgetProfileId`;
`resultHash` (`:163-165`) hashes the manifest after normalizing request ids;
`validateModelAblation` (`:255-274`) refuses a manifest whose `complete` flag
is not supported by the observations. A search-mode comparison manifest needs
the same invariant discipline over a different cell definition.

### 4.5 Adapter boundary

`packages/placebo/src/types.ts:63-72`: an `Adapter` exposes `heal(caseDir,
context)` and optionally `withTavily`. `AdapterContext` carries only
`candidateDiff` and `language` today.

`packages/placebo/src/adapters.ts:257-273` `SuturaAdapter` spawns
`sutura heal --case-dir <dir> --format json [--runtime x] [--candidate-diff
<diff>] [--no-tavily]`. The candidate diff crosses the process boundary as one
argv value. `parseCaseFile` (`:174-198`) revalidates every field of the
returned `CaseFile` and rebuilds `cost.totalUsd`. Any new `CaseFile` field must
be accepted here or the adapter reports `does not match Sutura CaseFile`.

`packages/placebo/src/cli.ts:50-117` `runCli` accepts
`run --adapter <name> [--only kind | --case id] [--no-tavily]
[--manifest-output file] [--force]` and nothing else.

### 4.6 Self-check

`selfCheckCorpus` (`packages/placebo/src/corpus.ts:329-401`) is the offline,
provider-free integrity run behind `pnpm --filter placebo run self-check`. Per
case it proves: clean fixture passes, `break.diff` fails (five scripted runs
for flaky cases with an exact ratio assertion, `:349-363`), the reverse patch
restores green (`:365-370`), and for traps that `fake-fix.diff` makes the
visible suite pass while hidden verification runs (`:372-384`).

This is the only existing place where a patch other than the run winner is
executed against a fixture, and it needs no provider.

## 5. Live run machinery and cost

`scripts/placebo-live.mjs` is the only sanctioned paid dispatcher
(`.claude/rules/ci-parity.md`). `pnpm run push-freeze` guards `develop` during
paid runs. The measured four-case upstream re-run on `08459fe` cost USD 0.9472
for eight evaluations, about USD 0.12 per evaluation
(`docs/plans/2026-09-04-sutura-completion-limit-branch-local.md:17`).

`packages/core/src/engine/repair-budget.ts` `DEFAULT_REPAIR_BUDGET_LIMITS`
bounds each run; `REPAIR_ATTEMPT_COSTS` reserves one model turn, three tool
calls, one branch, and two sandbox operations per attempt.

Nebius provides more than 7,000 SWE environments including SWE-bench Verified
and SWE-rebench (`docs/research/2026-08-28-sutura-two-month-opportunity-research.md:177`).
`packages/core/src/executor/contree.ts:29` targets
`https://api.tokenfactory.nebius.com/sandboxes/v1/` and exposes only
`images/import` (`:161`) plus run, snapshot, cancel, and capacity. There is no
environment-catalog client in the repository, so a SWE-bench selection step
needs either a new read-only catalog client or a committed catalog snapshot as
input.

## 6. Constraints that bind every WS-2 change

1. `packages/placebo/corpus/**` and `packages/placebo/src/score.ts` are frozen
   denominators. The search-recovery and completion-limit plans both list
   "no path under `packages/placebo/corpus` or `packages/placebo/src/score.ts`
   changes" as an automated success criterion. Adding new files inside an
   existing case directory changes `corpusHash`, which changes every evaluation
   manifest `resultHash`.
2. `DEFAULT_SEARCH_LIMITS`, `DEFAULT_REPAIR_BUDGET_LIMITS`, and
   `REPAIR_ATTEMPT_COSTS` are treated as byte-identical invariants by the two
   most recent plans.
3. Zero false approvals is a hard release gate (roadmap strategy rule 2).
4. New algorithms enter the product only after a controlled comparison
   (roadmap strategy rule 9).
5. `packages/action/dist/index.cjs` is a committed artifact and must be rebuilt
   in the same commit as any `packages/core` or `packages/action` source change
   (`.claude/rules/ci-parity.md`).
6. `pnpm run ci:local` is required before any push touching `packages/core`.
7. Provider secrets never enter a worktree, a document, or a fixture; live runs
   dispatch through GitHub Actions only
   (`docs/plans/2026-09-04-sutura-issue-workstreams.md:63`).

## 7. Open questions answered by the code

- **Do alternative patches share the ConTree checkpoint?** Yes. Every proposal
  in the controlled search applies to `ctx.failingImage`
  (`packages/core/src/engine/repair-attempt.ts:188`,
  `packages/core/src/heal.ts:1010`). Any alternative raced against
  `ctx.failingImage` through `race()` shares the same checkpoint by
  construction.
- **Can every candidate go through the identical gate stack?** Yes, by calling
  the same four functions in the same order: `policyVerdict`, `race`, `audit`,
  `enforceWinnerPolicy`. Only `enforceWinnerPolicy` is currently module-private.
- **What does a deceptive patch cost to reject?** Zero inference. `audit`
  short-circuits at the mechanical layer before any Ultra call
  (`packages/core/src/audit/audit.ts:62-72`).
- **Where can counterfactual results live without duplicating source data?**
  A `CaseFile` field carries the alternative diffs once; a trace event carries
  only ids, hashes, gates, and rules, and reaches ATIF through `systemStep`.
- **Is there an existing search-mode comparison harness?** No.
  `packages/placebo/src/ablation.ts` compares models, not search modes. No
  module records a baseline mode, and `Score` has no comparison field.
