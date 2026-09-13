# Phase 6 — Blinded evaluation, real NeMo execution and Arena preparation

## Local implementation review — 2026-09-08

Production runtime verification records are preserved in CaseFile with codec validation, and external CLI/Action verification forwards canonical evidence and its content-addressed artifact. Evidence v2 retains the actual immutable executor baseline image identity separately from an unavailable OCI digest. Repetition hashes distinguish identical verdicts reached from different observations.

The independent human walkthrough remains open. A person other than the author must trace one valid and one deceptive record using `docs/evaluation/record-walkthrough.md`; local tests and this source audit do not replace that review.


Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on phase 5. **[batch-eligible] with phase 9 only.** All evaluation remains local in this phase; Data Lab upload/batch and live Arena are phase 10.

## Outcome and ownership

Build the evaluation machinery that can test whether the new verifier and sponsor integrations help. Retain the old 110-row Data Lab v1 dataset as historical outcome-classification preparation. Produce a separate v2 quality task, actual standalone NeMo evaluation, and an immutable 100-case inventory with contamination controls.

Own `packages/evaluation/`, `packages/placebo/src/` evaluation/selection/comparison files and new corpus cases, `scripts/datalab-experiment.mjs:1` and its tests, plus `docs/datalab/` and evaluation-experiment documentation. Reuse `packages/evaluation/src/datalab.ts:306` where legacy expected outcome currently follows kind/grounding flags; add a versioned exporter/scorer. Consume trusted declarations from phase 1 as public task context, while keeping held-out sampled inputs/outputs out of all inference prompts. Cover JSON-property observations in addition to callable probes. Read `packages/evaluation/src/atif.ts:1`, `schema.ts:1`, `packages/evaluation/scripts/validate-atif.py:1`, `pyproject.toml:1`, `packages/placebo/src/comparison.ts:20` and `selection.ts:1` completely.

Do not edit core/shared contracts, Action dist, root package scripts, shared README, workflows, adoption files or shared release validators. New commands run directly in this phase; phase 10 integrates root local-gate wiring. This keeps phase 9 genuinely independent.

## Evaluation task and dataset

Construct blinded records from executed patches: original failure, bounded before/after production diff, public contracts and selected baseline/visible execution observations. Exclude case kind, expected outcome, final Sutura verdict, adjudicator recommendation, hidden tests/results, agent identity and label-bearing filenames. Hash source records and document redaction. Labels are derived offline from independent executable truth/preservation checks and explicit policy oracle, with `unknown` retained when execution is missing. Model task: predict `preserves-contract | breaks-contract | insufficient-evidence`, cite input evidence and calibrated confidence. Never train the model to map a fixture label to its declared outcome.

Pre-register two prompt variants, one direct rubric and one evidence-citation rubric. Use the same verified available NVIDIA model for the paired Data Lab comparison, fixed output schema and token caps. Development records tune prompts; validation selects one; held-out records are evaluated once after selection. Evaluate balanced accuracy over known labels, false-approval rate on deceptive patches, false-refusal rate on valid patches, abstention/coverage, calibration and cost. Report unknown and missing batch outputs separately. Safety quality is not the same metric as rubric-label agreement.

```text
split = freezeByRootFamily(corpus, counts={dev:60, validation:20, heldout:20})
for executedRecord in sourceManifest:
    truth = independentEvaluatorOnlyOracle(executedRecord)
    blindInput = redactAndRemoveOutcomeLeaks(executedRecord)
    assert noForbiddenMetadata(blindInput)
    emit(modelInput=blindInput, privateScoringKey=truth, lineage=sourceHash)
preparePairedBatch(promptA, promptB, identicalInputs, verifiedModel, finiteCaps)
score(joinByExactCustomId(outputs, privateScoringKey), retainMissing=True)
```

Data Lab input bytes can include the supplied candidate, because this is an offline evaluator of candidate quality. That differs deliberately from phase 4 challenge generation, which must never see a candidate. Scoring keys remain separate from uploaded model inputs. Data Lab data management metadata must not leak into batch prompt construction. Preserve existing idempotent prepare/upload/run/recover/finalize state machine and exact custom-ID joins; handle partial jobs without relaunching automatically.

## Standalone NeMo evaluator

NVIDIA documents base `nvidia-nat-eval` for standalone ATIF `EvaluationHarness` and ATIF-native evaluators; this fits recorded Sutura trajectories without replacing runtime orchestration. Use the existing pinned NVIDIA repository revision `23cd127dfba56994cd272f2771350d0ec13f3dd1` for matching ATIF/eval packages if its source contains this API. Inspect it before lock changes; if unavailable, select and record one compatible upstream immutable revision for both packages with contract tests. Never leave an unpinned latest dependency. This is an implementation compatibility check, not a product design question. [NVIDIA evaluation documentation](https://docs.nvidia.com/nemo/agent-toolkit/latest/workflows/evaluate.html), [custom evaluator source](https://github.com/NVIDIA/NeMo-Agent-Toolkit/blob/develop/docs/source/extend/custom-components/custom-evaluator.md).

Proposed `packages/evaluation/scripts/evaluate-atif.py`, `test_evaluate_atif.py` and bounded fixture manifest. Implement real `EvaluationHarness` invocation with ATIF-native custom evaluators for complete gate coverage, outcome agreement against evaluator-only truth, false approval/refusal, operation/latency accounting and evidence provenance. Evaluators return item-level results and denominators, not just Pydantic validity. Keep existing `validate-atif.py` distinct. Deterministic evaluators require no paid LLM; later Nemotron/Data Lab judgments are compared to these external outcomes rather than defining truth themselves.

```text
trajectories = validateAtifAndLoadBoundedManifest()
evaluators = {gateCoverage, independentOutcomeAgreement, resourceAccounting}
outputs = await EvaluationHarness(evaluators).evaluate(trajectories)
assert each requested evaluator produced terminal per-item results
writeHashedReport(toolRevision, configHash, trajectoryHashes, outputs)
```

The pseudocode describes semantics; use the API signature from the inspected pin. A local installed smoke test must demonstrate actual harness execution with one correct, one deceptive and one infrastructure-stop trajectory and expected nonidentical scores. A hand-written scorer without invoking NVIDIA's harness does not satisfy this phase.

## Arena and comparison contract

Freeze exactly 100 unique cases: 60 development, 20 validation, 20 held out. Expand by distinct root defects, including unfamiliar JS/TS/Python async, two-file contracts, upstream migrations, preservation regressions, flakes and deception. Pin upstream repositories/commits/licenses and offline dependencies. Synthetic mutations share family identity with originals and cannot cross splits. Publish split hashes and counts before live evaluation; retain hidden expectations outside all inference inputs. Public code can contain benchmark assets, but runtime packaging and prompt tests must prove they are inaccessible to the model context and candidate sandbox.

Reuse existing comparison arms and Wilson intervals. Extend observation records for challenge/routing versions and oracle status. Compare matched budgets/model availability and fixed candidate sets for verifier ablations. Report pairwise outcomes, per-language/family/split slices, correctly verified repairs per priced dollar, coverage, median and p95 latency with sample sizes. Keep first-green explicitly derived. Do not pool the historical 51 cases with expanded new-oracle metrics into one trend line.

## Automated success criteria

- [x] Leak-sentinel tests inject kind, labels, hidden verdicts, agent provenance and answer-bearing filenames; model prompt export removes/rejects them while scoring retains valid joins.
- [x] Dataset tests reject duplicates, split-family overlap, missing licenses/provenance, source-hash mismatch and missing outputs falsely scored correct.
- [x] Perturb execution truth and confirm quality scores change; alter only fixture kind and confirm blinded predictions cannot obtain it.
- [x] Run the real local NeMo harness via `uv run --project packages/evaluation python packages/evaluation/scripts/evaluate-atif.py` with the implemented manifest CLI; run Python unit tests directly through the same locked environment. Existing `pnpm run test:atif` remains passing.
- [x] `pnpm --filter @sutura/evaluation test`, `pnpm --filter placebo self-check`, and `node --test scripts/datalab-experiment.test.mjs` pass sequentially.
- [x] Comparison mutations reject changed models/budgets/splits and never interpret missing or infrastructure outcomes as negative-cost wins.

## Manual success criteria

- [ ] Independent reviewer checks one valid and one deceptive record end to end from executable truth through sanitized model input and final score.
- [x] Reviewer audits the held-out split for family leakage and records known benchmark familiarity limits.
- [x] Real local NeMo output exists; Data Lab remains explicitly prepared, not uploaded or measured until phase 10.

## Phase gate

Follow the parent plan's implementation/review/fix/simplification loop. Run focused checks and the standard local commands sequentially: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`. Rebuild the committed Action bundle for core/Action changes, run `pnpm run verify:bundle`, and complete `pnpm run ci:local` before any later push involving core. New process/build/sandbox tests use explicit timeouts of at least 30 seconds. Inspect actual hosted triggers before any push; never create a Vercel preview or use hosted CI to debug. Record actual results and the integrated source identity; stop after this phase. Remote actions and participant messages require the concrete authorization described in the parent plan.

## Progress record — September 6

Implemented source: this phase's commit. No provider call, Data Lab upload, batch job or paid evaluation occurred.

`packages/evaluation/src/blinded.ts` implements the contamination controls. `blindExecutedRecord` keeps the failure, candidate diff, public contracts and executed observations — the candidate is deliberately retained, because this is an offline evaluator of candidate quality, unlike phase 4 challenge generation — and removes case kind, expected outcome, final verdict, adjudicator recommendation, hidden tests and results, agent identity, and any changed path whose name carries a label. `assertNoForbiddenMetadata` fails on a forbidden key nested anywhere in a prompt-bound structure. `freezeSplitByRootFamily` assigns whole root families, so a synthetic mutation can never land in a different split from the case it derives from, and produces the same assignments and split hash for the same corpus in any input order. 30 tests.

Not built in this pass, and not claimed:

- The standalone NeMo `EvaluationHarness` invocation is built and runs. `nvidia-nat-eval` is locked at the same pinned revision `23cd127dfba56994cd272f2771350d0ec13f3dd1` as `nvidia-nat-atif`, resolving to `1.9.0.dev87+g23cd127d`. `packages/evaluation/scripts/evaluate_atif.py` dispatches three ATIF-native evaluators through `EvaluationHarness.evaluate` rather than scoring locally, and refuses a report where any requested evaluator produced no terminal result or returned fewer items than samples.

  The evaluators are deterministic and need no provider: gate coverage over recorded Sutura event types, outcome agreement against evaluator-only expected truth, and resource accounting over timed steps. A sample with no declared truth scores `NaN` and carries an error rather than counting as agreement, so an unknown expectation cannot inflate a score.

  The installed smoke test runs one correct, one deceptive and one infrastructure-stop trajectory and asserts the scores are not identical. Measured: gate coverage 1.0 / 1.0 / 0.5, outcome agreement 1.0 / 0.0 / 1.0. The stopped run recorded no audit result or finish; the deceptive run recorded a refusal where the truth expected a repair. `test:atif-eval` runs inside `ci:local`.

  The uv pin that blocked this is fixed: `required-version` accepts any 0.12.x, the relaxation left `uv.lock` byte-identical, and `test:atif` is also in `ci:local` so it cannot rot again.
- The v2 quality task and its two pre-registered prompt variants are built. `buildQualityPrompt` serves `direct-rubric-v2` and `evidence-citation-v2` over byte-identical inputs, differing only in the instruction, which is what makes comparing them meaningful. The record is asserted label-free immediately before serialization, so a caller cannot reach the prompt with an unblinded record and have it sent anyway, and a variant that was not pre-registered is refused rather than tuned in after seeing results. The response schema is closed over the three labels with bounded citations and a calibrated confidence.

  `scoreQualityPredictions` keeps unknown truth and unanswered records out of accuracy and reports them as their own counts, so a run that returned half its answers cannot look like a run that answered them correctly. Balanced accuracy averages per-class recall, so always predicting the majority label scores 0.5 rather than 0.9. False approval and false refusal are separate rates, abstention is its own rate rather than a wrong answer, and confidence is reported separately for correct and incorrect decisions. Nothing scorable returns nulls rather than zeros. 23 tests.

  The paired Data Lab batch itself is still not built; no prompt was constructed or sent, and no provider or upload was touched.
- The inventory machinery is built and was run against the real corpus. `buildEvaluationInventory` freezes the 60/20/20 split by root family, publishes a split hash and an inventory hash that moves when any fixture content or the corpus revision changes, and is reproducible for the same corpus in any order. A short corpus is reported as a shortfall and never frozen as a smaller split, because quietly freezing fewer cases as if they were the registered 100 would make every later held-out number describe a different experiment from the one that was pre-registered. An oversized corpus is refused rather than silently sampled. 8 tests.

  Run against the expanded corpus on September 6 it reports `incomplete`: **63 of the required 100 cases across 50 distinct root families, 37 missing**. That is the honest state of the inventory, and no split hash is published until the corpus reaches 100. Authoring 37 further distinct root defects, with pinned upstream repositories, commits, licenses and offline dependencies, is the outstanding work.
- Balanced accuracy, false-approval and false-refusal scoring, calibration and cost accounting are not implemented.

## Second pass — September 6

The inventory is complete and frozen.

38 corpus cases were added, each one distinct root defect with its own family:
19 Python, 16 JavaScript and 3 TypeScript; 26 repairable, 8 traps, 3 flakes and
1 upstream migration. They are generated from a table
(`packages/placebo/scripts/inventory-cases.mjs`) by
`generate-inventory-cases.mjs`, which produces every patch with
`git diff --no-index`, so the committed bytes are the bytes Git writes rather
than a hand-assembled approximation. Every added case carries
`evaluationRevision: inventory-v1`, so the frozen v0.2 default selection and
its committed `corpusHash` are unchanged and the historical 51-case scores
still mean what they meant.

The defects cover mutable default arguments, integer division, suffix
stripping, sort keys, exclusive ranges, async gather ordering, decimal money
arithmetic, deduplication order, timezone-aware comparison, regex anchoring,
lookup defaults, resource release, internal list aliasing, numeric sort
comparators, shallow-copy mutation, settled-result handling, zero-based months,
parse radix, strict equality, regex `lastIndex`, JSON clone type loss, map key
identity, optional index access, discriminated-union narrowing, percentage
rounding preservation, a config-and-consumer two-file transaction and an
upstream separator release. The traps cover tautological assertions,
expected-failure markers, widened numeric tolerance, a patched subject under
test, non-null assertions, empty catch blocks, loosened precision and a
narrowed input set.

Two defects were found while validating them and fixed rather than kept: a
decimal-rounding case whose float and exact arithmetic happened to agree on the
chosen inputs, and a percentage case whose visible test passed under the broken
rounding. Both were only visible because every case is executed rather than
reviewed.

`packages/evaluation/scripts/inventory.mjs` freezes the inventory from the
corpus on disk rather than from a list kept beside it. Run against the
completed corpus it reports 100 cases across 94 root families, split 60/20/20,
split hash `14453c118c71…`, inventory hash `ee6954ca1d7d…`; the record is
`docs/evaluation/inventory-v1.json` and `docs/evaluation/README-inventory.md`.
Four tests hold it: the corpus supplies exactly the registered count, the
freeze is reproducible and keeps each family in one split, a short corpus
freezes nothing rather than a smaller split, and a changed fixture moves the
inventory hash.

`packages/evaluation/src/dataset.ts` validates a quality dataset and prepares,
but never sends, the paired batch. Validation refuses a record counted twice, a
root family that appears in two splits, a record with no stated source, licence
or revision, a record whose bytes no longer hash to what it was registered
under, an unbounded custom id, an unknown split and a label surviving anywhere
inside a record. `preparePairedBatch` sends byte-identical inputs to both
pre-registered variants, differing only in the instruction, names each request
after its dataset entry so outputs join without a heuristic, and refuses to
place a scoring key in a request. `joinBatchOutputs` joins by exact custom id
and leaves a missing output missing, because an answer that never arrived is
not a correct one. 14 tests.

Leak sentinels are now explicit: eight injected fields (case kind, expected
outcome, final verdict, hidden verdict, adjudicator recommendation, agent
provenance, label and split) are each removed from the model-facing record, a
sentinel nested inside an observation is rejected rather than only a top-level
one, and answer-bearing filenames are dropped while the join key survives. The
lineage hash is the one thing that changes when only the fixture kind changes,
and it is opaque: the kind itself reaches neither the prompt nor anything a
reader could decode it from. 10 added tests.

Perturbation is covered: moving the executable truth while the answers stay
fixed changes balanced accuracy and moves the false-refusal rate, relabelling a
deceptive record moves the false-approval rate, and an unknown truth or a
missing answer stays out of every rate. 3 added tests.

The comparison contract now carries `challengeVersion`, `routingVersion` and
`splitHash` invariants and an `oracleStatus` per observation, and
`firstInvariantDifference` names each of them. `comparisonSlices` reports
per-language, per-kind and per-split slices over decided cases only.
`comparisonEfficiency` reports coverage beside correctly verified repairs per
priced dollar, and an arm that stopped on infrastructure scores zero rather
than reading as the cheapest arm; an arm that priced nothing reports no rate at
all rather than an unbounded one. 5 added tests.

Still not built, and not claimed: the paired batch is prepared but nothing has
been uploaded, dispatched or measured, and no provider was called. Calibration
and cost accounting beyond the per-arm dollar rate are not implemented. Phase
10 owns every paid measurement.

## Third pass — September 6

The held-out split audit found a real defect and fixed it. The freeze filled
development, then validation, then held out, taking families in alphabetical
order, which gave a held-out split of 15 families made almost entirely of traps
and upstream migrations with a single Python case: it measured the end of the
alphabet rather than the corpus. Families are now taken largest first and each
goes to whichever split would still be furthest from full against its own
share. The held-out split is now 20 families for 20 cases with a representative
mix, and the split hash changed with the fix, which is the point of publishing
one. Three tests pin the property so the bias cannot return.

No family appears in two splits, and this is enforced in three places rather
than inspected once: the freeze assigns a family as a unit, the inventory test
asserts it against the real corpus, and the dataset validator refuses an export
where one spans splits. The known limits are recorded in
`docs/evaluation/README-inventory.md`: every case is synthetic, so no model has
seen these files and the defect shapes are one author's choice; the held-out
split is 16 JavaScript to 3 Python to 1 TypeScript, so per-language held-out
numbers are not comparable; 20 held-out cases give wide intervals and are
reported as a proportion with an interval; and the split is opened once.

Real NeMo output exists and is committed. `docs/evaluation/nemo-atif-report.json`
is the output of `EvaluationHarness.evaluate` over the three trajectories,
hashed and reproducible: gate coverage 1.0 / 1.0 / 0.5, outcome agreement
1.0 / 0.0 / 1.0, resource accounting 1.0 / 1.0 / 1.0. The stopped run recorded
no audit result or finish; the deceptive run recorded a refusal where the truth
expected a repair.

Data Lab remains prepared and nothing more. The paired batch is constructed
offline from the validated dataset; **no prompt was sent, no job dispatched, no
file uploaded and no provider called.**

The three named commands pass sequentially: `@sutura/evaluation` 116 tests,
`placebo self-check` 28 tests over the 101 fixtures, and
`datalab-experiment.test.mjs` 21 tests. The self-check run found one stale
assertion, a hardcoded expanded-selection count of 62, now 100 with the
assertion that actually matters beside it: the frozen slice keeps its committed
`corpusHash` and the expanded selection does not share it.

`docs/evaluation/record-walkthrough.md` traces one valid and one deceptive
record end to end, from executable truth through the exact prompt bytes to the
score, with the commands to reproduce each step. It is written so an
independent reviewer can follow it. **That review has not happened**, so the
manual criterion it serves stays open: a walkthrough a reviewer could follow is
not a reviewer having followed it.
