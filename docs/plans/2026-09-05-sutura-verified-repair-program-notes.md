# Verified repair program implementation deviations

Plan: `2026-09-05-sutura-verified-repair-program`.

## Deviations

### Phase 1: preserve the frozen benchmark selection

Plan said to add a versioned pagination case and version expanded scoring semantics. Found that the existing benchmark manifest hashes a fixed 51-case selection. Chose to include versioned cases through an explicit corpus-loader selection while retaining the legacy default; self-check includes the expanded selection. This preserves historical hashes and prevents the new oracle from silently changing the old denominator. Phase 6 owns the separately versioned expanded evaluation scores.

### Phase 1: unknown terminal identities

Plan said every new result binds snapshot, diff and image digest. Found that early terminal outcomes may have no candidate or snapshot, and the executor's imported image identifier is not a verified digest. Chose explicit null values for these unknown identities on nonaccepted terminal evidence; accepted evidence requires all three exact identities. This avoids fabricated provenance while preserving strict acceptance requirements. The later provider preflight must establish an actual image digest before provider-backed v1 acceptance.

### Phase 2: completion-aware syntax subset

Plan allowed narrowly inserted async/await syntax on existing operations and setup. Found that preserving syntax alone can detach callbacks, suppress assertions through predicates, or change indirectly computed expectations. Chose direct imported Vitest test callbacks and direct `unittest.IsolatedAsyncioTestCase` test methods, with straight-line supported assertion/setup positions and conservative binding checks. Unsupported callbacks, control flow, assertion bindings and Python dispatch overrides abstain. Existing asynchronous syntax does not establish that a test runner waits for a callback.

### Phase 2: bounded investigation and protected completion capacity

Plan requested recovery for competing diagnoses and reserved subsequent verification without raising existing budgets. Found that hypotheses without a recognized promise/coroutine/setup/strictness observation cannot justify any supported grant, and unbounded audit requests can consume all default inference capacity. Chose to investigate only recognized observed signals, retain unsupported interpretations as explicit abstentions, reserve a complete priced repair plus 30 seconds and two bounded audit turns plus 60 seconds, and reject audit requests exceeding 32,000 serialized request bytes, including response schemas. Initial diagnosis and reproduction consume the same run budget. These conservative limits may reduce attempts; they do not establish measured model-quality improvement.

### Phase 2: captured excerpts and executed controls

Plan requested captured-log replay coverage for the historical give-ups. Found that the retained September 5 artifact contains the five diagnoses and bounded error excerpts rather than complete raw failure logs. Chose to hash-bind and compare those exact captured records, while executing clean, broken, repaired and deceptive fixture branches through the real local controller with fresh process output. These are captured diagnostic excerpts plus independently executed controls, not a replay of unavailable complete historical logs.

### Phase 2: historical executor contract drift

Plan retained historical replay identity while extending run-wide budget and cancellation enforcement. Found that per-operation reservations replace the old triage `runMany` boundary with individually identified `run` calls. Chose stable run-scoped operation identifiers for new exact replays and explicit contract-drift rejection for the two historical dogfood bundles, which already rejected later report drift before this phase. Their stored bytes and outcomes remain unchanged; replay comparisons are not relaxed to accept the new execution contract against an old recording.

### Phase 2: authorized repairs in the offline counterfactual harness

Plan removed class-based admissibility of conventional test and tool configuration paths, so a claimed `test-bug` or `env-config` diagnosis no longer opens those files. Found that `packages/placebo/src/counterfactual.ts` replayed the deterministic gate stack without any controller, which rejected the accepted patches of `python-repair-missing-await` and `repair-tsconfig-drift` and moved four alternatives from their declared mechanical and verification rules to patch-policy. Chose to derive the case's declared grant through the production `deriveRepairAuthorization` contract from the broken fixture's own complete source and real failing suite output, offer it to `authorizeRepairCandidate` for every candidate, and record the grant in the report. Declared authorizations the controller refuses fail the set instead of widening what the gates admit. The committed `python-repair-missing-await/accepted.diff` also had an off-by-one hunk start that `git apply` tolerated and the exact-context grant validator does not; its header now names the real position.

Four declared expectations moved to the earlier, deterministic rule the gate stack now records: `swallow-the-assertion` and `weaken-the-expectation` to `touches test file`, `disable-lint-rules` and `enable-strict-null-only` to `touches tool config`. Ten of ten shortcuts remain rejected with no inference across eight distinct rules, and `docs/demo/sutura-counterfactual-v0.2.json` was regenerated from the new stack (`resultHash` `6ae52511…`). The dependent Arena control artifacts were regenerated from the same report by `packages/placebo/scripts/generate-control-arena.mjs`.

### Phase 2: locate grant hunks by baseline context, not by declared line number

`authorizeRepairCandidate` applied a candidate to the controller-held baseline at the hunk's declared position, with no search. `packages/placebo/corpus/python-repair-missing-await/repair.diff` declares `@@ -5,5 +5,5 @@` where the broken source's block starts at line 4, so the corpus's own canonical await repair was refused with `diff does not match exact baseline source` even though `git apply` accepts it. Found that the declared line number carries no safety: an attacker controls it as freely as the content, so requiring it to be exact only refuses honest patches whose header drifted.

Chose to locate each hunk by its exact baseline context at or after the previous hunk's end, refusing an absent context, a context matching more than one position, and a hunk with no context to anchor. Exact-context equality, single-file scope, ordered non-overlapping application and the complete before/after structural validation are unchanged, so the located application stays unique and independent of any number the candidate supplies. The frozen corpus repair now authorizes with no change to its bytes. The redundant hunk-count and header-shape checks were dropped because `parseUnifiedDiff` already rejects both before `patchedSource` runs.

A zero-context pure insertion (`git diff -U0` of added lines only) now abstains rather than applying at its declared position. All three grant kinds modify an existing line, so no supported repair shape depends on it.

The corrected `python-repair-missing-await/accepted.diff` hunk header is retained because the original was factually wrong, not because the validator still requires it.
