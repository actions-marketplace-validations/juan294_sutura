# Phase 10 — Integrated execution evidence and measured sponsor experiments

## Local implementation review — 2026-09-08

The cumulative spend cap is implemented per manifest, including restart reconciliation; a restart does not reset authorization. Historical Stage 3 overspend remains a real failure: its five attempts cost USD 12.55 against USD 10, and no completed clean quality measurement exists. The repaired cap does not retroactively authorize that overspend or turn those attempts into a repair-rate result.

The finite Data Lab runner now validates a frozen manifest, persists upload and batch submission intents for recovery, joins outputs by exact custom IDs, and keeps unknown or mismatched model costs unknown. Quality-task output validation includes the bounded citation limit. These paths are locally tested; no Data Lab upload or batch inference was performed. Stage 3 still requires a new exact-candidate manifest and paid authorization, followed by the separately capped held-out 20. The held-out set remains unopened.


Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on phases 8 and 9, including integrated phase 6. Sequential, not batch eligible.

## Outcome and change surface

Measure the complete product on an immutable candidate with real providers, independent oracles and honest cost accounting. Distinguish development debugging, validation selection and one held-out evaluation. Every dispatched job must terminate or be explicitly cancelled and recorded. This phase includes all recommended ablations; it does not silently shrink to a token demo.

Read `scripts/placebo-live.mjs:1`, `external-matrix-live.mjs:1`, `provider-contract-canary.mjs:1`, `runtime-image-canary.mjs:1`, `dogfood.mjs:1`, `push-freeze.mjs:1`, `datalab-experiment.mjs:1`, their tests, provider workflows and current budget controls before dispatch. Own their necessary integration changes, `package.json:1` local-gate wiring, versioned manifests/results under `docs/demo/`, `docs/datalab/`, `docs/evaluation/`, and existing Placebo comparison glue. No hidden-oracle contents enter provider prompts or the candidate runtime. Public-safe evidence is tracked; raw logs with secrets stay outside public artifacts.

## Local integration before authorization

Integrate phase 6 and 9 in isolated branches, reconcile lockfiles where required, and wire new Python/Node evaluation and review-study tests into the existing local verification suite. Do not add a new paid CI workflow as a convenience. Run the complete standard local gates and `pnpm run ci:local`, captured-fixture checks, NeMo smoke, corpus self-check, offline runtime smoke and package/CLI/Action install rehearsals sequentially. Review tests against actual supplied/correct/deceptive external patch paths, not a mocked report constructor.

Create proposed `scripts/verified-program-evidence.mjs` and tests using existing evidence-contract helpers. A run manifest is generated from actual candidate/model/image/corpus/split/config files and must specify exact hashes, test selection, subject count, repetitions, maximum output tokens, operations, elapsed time, inference cap, raw/confirmed sandbox cap, concurrency and stop policy. There are no default unlimited values. Locally validate cost upper bounds and fixtures; prepare a concrete reviewable request before asking to execute paid work. Authorization starts at zero, scoped per manifest, and cannot be inherited from historical G1/G2/G3 approvals.

## Execution order

1. Freeze source/controller identities using existing push-freeze procedure. Check credentials by presence and scoped APIs without exposing values. Execute the separately approved minimal provider/image/typed-probe contract preflight first: Node, TypeScript, Python sync/await, JSON-property observations, ConTree fresh-branch isolation, bounded output/error parsing and actual returned model IDs. Capture sanitized real response fixtures for new guards. If this fails, stop all dependent live jobs and fix locally; do not start the full benchmark.
2. Run a small development smoke using known correct pagination, exact bad floor-only, missing-await, two-file pair, flake and policy-refusal controls. Required gate failure stops expansion. A canary is not a quality benchmark.
3. Execute development/validation comparisons from phase 6 with finite pre-registered runs. Paired comparisons change one intended factor at a time. Upload the sanitized development/validation Data Lab records and run both pre-registered prompt variants under the approved cap now; complete validation-based selection before final evaluation. Data Lab selects an offline quality-evaluator prompt, not a runtime repair prompt. Any runtime prompt/routing/challenge-profile selection must also finish using development/validation data here. Freeze both the chosen offline evaluator and the runtime configuration before opening held-out results.
4. Execute the final 100-case manifest with visible labels identifying its 60/20/20 splits, using the frozen runtime configuration. Score its held-out records with the already-selected Data Lab evaluator in a separate capped batch; do not run both prompts on held-out data to choose a winner. Use held-out cases once for final estimate. Retain all attempted runs, infrastructure failures, incomplete probes and candidate alternatives. If remediation follows held-out inspection, label the old set development and acquire replacement families before claiming unseen performance.
5. Run legacy fixed-slice release quality gates separately under preserved score definitions and expanded oracle annotations. Required legacy gates remain repair >=11/18, flake 10/10, deceptive 11/11, Tavily 4/4, hidden preservation with no not-run, complete trap catch and zero measured false approval. Never drop failed cases or change denominators to pass. Run the exact eight-case candidate matrix with real Node/TS/Python paths. Every give-up becomes a named captured-log replay before the next dogfood run.
6. Complete real Tavily on/off migration pairs and the new diagnosis/multi-file/challenge/search/routing comparisons below. Grounding must name verified primary package/version sources and end in a measured repair, not just search output. Current upstream policy intentionally abstains without grounding: label on/off results as a policy-gated capability demonstration, not causal evidence of improved model reasoning. For an additional grounding-quality comparison, evaluate fixed supplied candidates with a blinded offline Nemotron evidence task using relevant primary docs versus no retrieved docs, scored against the same executable oracle. This evaluation never bypasses production grounding requirements or turns the off arm into an approved repair.
7. Finalize Data Lab development/validation and selected-prompt held-out batch records from steps 3–4, recovering existing jobs by ID if interrupted without automatic relaunch. Retain all outputs/errors and report the preselected hypothesis outcome; no post-hoc prompt tuning or runtime promotion based on held-out scores. Run the pinned NeMo harness on actual corresponding ATIF trajectories. Validation-only ATIF output and a prepared dataset cannot satisfy completion.
8. Acquire real supplied diffs from two independent coding-agent sources on the same task pack. Record exact source version/settings when available and mark unknown provenance honestly. Sources get the task/public context, never Sutura repair transcript, hidden oracle or challenger answers. Verify all supplied patches, successful and failed, with the same frozen controller settings. Keep manually authored correct/deceptive calibration controls separate. Agent service/API use needs its own finite authorization.
9. Finalize hashed results from terminal artifacts; preserve all errors and costs. Compare empirical targets and mandatory gates, explain misses, and confirm the preselected routing/evaluator decision against mandatory safety gates. Held-out results may veto deployment for a discovered safety failure, but cannot select a different threshold/prompt as the new winner without replacement held-out families. Remediate failing mandatory gates locally and rerun only the evidence invalidated by changes under a new approved manifest. No automatic spending loop.

## Experiment matrix

| Question | Paired subjects/control | Primary evidence |
| --- | --- | --- |
| Do independent probes catch green-but-wrong patches? | Same frozen valid/deceptive diff set, baseline checks vs required challenges | False approvals/refusals, coverage, named rejecting gate, hidden-oracle agreement |
| Does diagnosis recovery help? | Same failure/source, original single diagnosis vs bounded recovery | Legitimate repair reachability/success, matched deception refusal, added calls |
| Does two-file support help? | Coherent source/source or manifest/lockfile cases, one-target vs two-target policy | Whole-transaction repair and preservation; unsupported three-file abstentions |
| Does the Tavily-enabled workflow complete grounded upstream repairs? | Same source/model/budget, grounding on/off | Valid citations, preserved repair and cost; policy-gated interpretation plus separate offline evidence-quality comparison |
| Does ConTree search improve outcomes? | Existing Sutura, single-branch, fixed-parallel arms with matched maximum resources | Correct repairs, branches/operations, actual cost and latency; first-green derived separately |
| Does adaptive routing save cost without quality loss? | Fixed vs adaptive profile, identical verifier/challenges/split and caps | Paired correctness, inference cost per correct verification, latency, abstention |
| Does the Data Lab prompt experiment improve quality judgments? | Same blinded records/model, two fixed prompts | Outcome-grounded quality, false approval/refusal, coverage/calibration/cost |
| Can Sutura verify other agents' work? | Two genuine agent-source diff sets plus independent controls | Same gate semantics, exact provenance, accepted/rejected/insufficient outcomes |

Use proposed evidence manifests rather than hand-copying table numbers. Run case-order counterbalancing where service load may affect latency; if repeated stochastic runs are not funded, report single-run limits and do not imply statistically established superiority. Equal caps do not mean equal spent resources. Optional research confidence intervals are descriptive; no fabricated significance.

## Pseudocode

```text
candidate = freezeAndValidateLocalState()
manifest = prepareFiniteRun(candidate, models, images, split, experiments)
require explicit authorization for this exact manifest
preflight = executeMinimumProviderContracts(manifest)
if !preflight.passed: stop dependent work
for authorizedJob in manifest.jobs:
    require cumulative reservations fit all caps
    persist intent; dispatch once; record ID
    observe terminal result or cancel by stop policy
    append outcome, usage, artifacts, missing evidence
report = scoreOnlyTerminalBoundSubjects(allResults, independentTruth)
require mandatory gates; compare declared targets; record promotion decision
unfreeze only after every dispatched job is terminal/accounted
```

## Automated success criteria

- [x] Local manifest/evidence tests reject changed candidate/model/price/corpus, missing/duplicated results, relabeled modes, unauthorized expansion and negative/unknown cost conflation.
- [ ] All mandatory release and known-danger controls pass; new capability evidence is linked to actual terminal jobs and immutable source.
- [x] `pnpm run test:release-contracts`, new direct evidence tests, real NeMo evaluation and all standard gates pass locally before remote actions; repeat local checks after relevant fixes. September 8 verification and the fixture-only rerun scope are recorded in the parent completion entry.
- [ ] Blinded Data Lab job outputs and NeMo item outputs exist, including errors/unknowns; comparison calculations reproduce from stored files without provider access.
- [ ] Published experiment integrity covers measured timing and exact source data; raw unconfirmed sandbox units remain explicit.

## Manual success criteria and stop

Independent reviewer samples one correct repair, one false-approval trap, one abstention and one infrastructure record; reconstructs each score and verifies no hidden answer entered inference. Review all declared targets against measured results, retain unfavorable findings, and approve only supported default-profile changes. Supply final run IDs, costs/caps, source/split/config identities and remediation status. Stop after the phase; this evidence does not itself publish npm, deploy Case Lab, recruit participants or submit Devpost.

## Progress record — September 6

Every remote step is blocked on authorization rather than on effort. This phase measures the product with real providers, which the parent plan gates: all remote budgets start at zero authorized, and a concrete run manifest with finite caps and a verified price-based maximum must be approved before any dispatch. **No job was prepared, dispatched or cancelled, and no provider credential was read.**

The local half is built. `scripts/verified-program-evidence.mjs` defines the run manifest and the evidence contract a paid measurement must satisfy, and nothing in it dispatches, spends or contacts a provider.

A manifest states every cap explicitly: subjects, repetitions, maximum output tokens, sandbox operations, elapsed time, inference spend, raw sandbox units and concurrency. None has a default, because a missing cap is a refusal rather than an implied infinity: a run that could not have been costed in advance cannot be authorized in advance either. A zero, negative or infinite cap is refused the same way. The manifest also needs an exact candidate commit, image digest, corpus hash, split hash and config hash, a model list with both prices and a price date, and a stated stop policy, because a run with no stated stop can only end by exhausting a cap. `manifestMaximumUsd` prices the ceiling from the caps rather than an average, and never reports more than the spend cap.

`validateRunEvidence` answers one question in several ways: does this evidence describe the run that was authorized? It refuses a result under a different candidate, image, corpus, split or config; a different model or a different price for the same model; a missing subject, a duplicated subject, or a subject the manifest never authorized; a recorded result presented as live; a result that never reached a terminal state, while counting an explicit cancellation as the evidence it is; an unknown inference cost, a negative one, and a sandbox amount with no confirmed unit; and a run that spent past its own cap. An unconfirmed sandbox amount is reported as its own count rather than folded into a total. 15 tests, wired into `test:release-contracts`.

Still blocked, and not claimed: every criterion that needs a dispatched job. No manifest has been submitted for authorization, and none will be without an explicit request.
