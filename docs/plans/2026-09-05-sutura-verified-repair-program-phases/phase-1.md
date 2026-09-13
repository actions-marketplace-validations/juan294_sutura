# Phase 1 — Correct the baseline and establish evidence contracts

Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on plan acceptance. Sequential, not batch eligible.

## Outcome

Capture the actual pagination false approval as a permanent regression, define truthful evidence/cost/identity contracts for all following phases, and establish an executable local probe adapter contract. This phase does not claim the new independent challenger or public deployment is complete.

## Existing source and owned files

Read `packages/placebo/corpus/repair-off-by-one/fixture/page-count.js:1`, `case.test.js:4` and `break.diff:1` in that case directory, the related `packages/placebo/counterfactual/` accepted/rejected patches, `packages/placebo/src/corpus.ts:1`, `types.ts:1`, `counterfactual.ts:1` and corpus validators. Read `packages/core/src/domain.ts:69`, `executor/types.ts:62`, `llm/cost.ts:1`, `trace/types.ts:1`, and current report/replay codecs before changing their contracts. Read `packages/case-lab/src/result.ts:16` and its validators; extend schemas compatibly, leave the UI redesign to phase 8.

Proposed new files: `packages/core/src/verification/types.ts`, `types.test.ts`, `packages/core/src/challenges/protocol.ts`, `protocol.test.ts`, bounded adapter fixtures, an extension of trusted policy schema for declarative verification contracts, and a versioned `repair-off-by-one-preservation` corpus case with the exact rejected floor-only patch. Add lineage and split fields to corpus/evaluation types without creating a second corpus loader. Edit existing codecs, score contracts and targeted tests only as needed for these shared fields; rebuild Action dist. Create `docs/demo/sutura-pagination-regression.md` and a concrete local provider-preflight specification under `docs/demo/`.

## Implementation specification

1. Preserve old fixture and replay hashes. The new case contract is nonnegative integer item counts with positive integer page sizes and result `ceil(items/size)`; use only semantics supported by the original correct fixture. Do not invent error behavior for negative counts/zero size.
2. Freeze visible reproduction at 20/10; independent checks include 21/10, 1/10, 0/10 and exact multiples. Store known-good ceil and exact recorded floor-only patch as separately hashed controls. Confirm both pass the original visible check, only the correct patch passes preservation checks. A versioned historical annotation describes the public failure and its original release identity; do not silently replace a recorded result with fabricated successful evidence.
3. Define `VerificationEvidence` v1 and five-state gate observations, structured blocking reasons, identity/cost/mode fields exactly as the parent specifies. Create explicit legacy decoding adapters; absence of challenge evidence in an old record means absent, not passed. Version score semantics when an expanded oracle changes what is measured.
4. Extend the trusted policy schema with target-bound declarative contracts: controller-known ceiling-division/cardinality/codec-round-trip templates, exact typed input/output cases and exact JSON-property constraints. Require bounded types, trusted-policy provenance and adapter/target binding. The model can propose challenging inputs only inside these declared domains; controller code derives expected values. Existing prose/source hashes are supporting references, never oracle authority. Add public contract declarations to the supported repair fixtures independently from hidden acceptance probes. Missing or unsupported contracts mean insufficient required-challenge evidence. Test a valid reference hash paired with a wrong proposed expected value and reject it.
5. Define separate outcome, executed observation, dataset truth and presentation labels. A scenario's expected result must never supply its observed outcome. Do not copy the legacy case-kind prediction label into repair-quality truth.
6. Add a versioned cost breakdown. Keep old raw amounts available, but new serializers mark unconfirmed provider units and exclude them from USD totals. Missing cost is unknown. Token estimates must retain price source/date; elapsed time remains part of evidence integrity even where normalized comparison hashes omit it.
7. Implement a small local observation-protocol proof: controller owns typed input and assertion evaluation; sandbox adapter observes a named exported JS function or Python callable/await result, plus a bounded JSON-property observation for strict configuration repairs. JSON targets resolve from trusted baseline paths, parse as data, and compare against exact trusted values without executing arbitrary repository code. Validate bytes, types, duplicate envelopes, exit codes and limits. Controller-held frozen expected-value tables and assertion state remain outside candidate snapshot; public contract examples may reveal intended behavior and are not treated as secret assurance. Exclude controller/hidden-oracle tables and raw Git objects from snapshot packaging, and prove exclusion with sentinel fixtures. Existing execution ports expose run/stdout/exit; do not invent trusted mounts or authenticated result APIs. Full generation/qualification arrives in phase 4.
8. Record a provider preflight recipe covering JS, TypeScript, Python sync/await, JSON-property reads, branch reset and protocol errors on exact available images. Local proof is required now. Capture real provider responses only under a later finite approved request, scheduled first in phase 10; phase 4 implementation must not claim provider acceptance before then.

```text
legacy = readWithoutMutation(historicalArtifact)
regression = newVersionedCase(originalContract, exactRecordedPatch)
assert oldVisibleCheck(correctPatch) == pass
assert oldVisibleCheck(recordedWrongPatch) == pass
assert independentPreservation(recordedWrongPatch) == fail
assert independentPreservation(correctPatch) == pass

observation = decodeBoundedTypedValue(localExecutor.run(controllerInvocation))
verdict = controller.compare(observation, controllerHeldExpectation)
evidence = encodeV1(identity, mode, orderedGateObservations, typedCosts)
assert legacyDecoder(legacy).challengeStatus == absent
```

## Automated success criteria

- [x] Regression tests demonstrate the wrong patch, including the original public artifact's diff hash; corrected control and equivalent valid arithmetic control pass.
- [x] Corpus self-check verifies break/reproduce/repair and hidden-check isolation. Run `pnpm --filter placebo self-check` and focused new core protocol/type tests.
- [x] Codec tests reject identity substitution, fabricated units, missing required status, invalid hashes and stale schema; existing replay fixtures still decode with honest assurance labels.
- [x] Local JS/TS/Python/await/JSON adapters produce bounded typed observations; forged success fields, duplicate output, error exits and unsupported shapes cannot pass controller assertions. No secrets, controller-held frozen expectation tables or evaluator-hidden answers enter candidate fixture contents. Public contract examples are explicitly labeled specifications, not hidden probes.
- [x] Artifact integrity detects elapsed-time tampering; normalized comparison identity remains separately named.

## Manual success criteria

- [x] Reviewer can reproduce the pagination defect locally and explain why the old measured zero-false-approval count did not cover it.
- [x] Shared schemas and the supported probe surface are sufficient for phases 2–8 without imaginary executor capabilities.
- [x] Public annotation is prepared with exact historical identity. Publishing/deploying the annotation requires applicable authorization; until then record that the public site remains historical.

## Phase gate

Follow the parent plan's implementation/review/fix/simplification loop. Run focused checks and the standard local commands sequentially: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`. Rebuild the committed Action bundle for core/Action changes, run `pnpm run verify:bundle`, and complete `pnpm run ci:local` before any later push involving core. New process/build/sandbox tests use explicit timeouts of at least 30 seconds. Inspect actual hosted triggers before any push; never create a Vercel preview or use hosted CI to debug. Record actual results and the integrated source identity; stop after this phase. Remote actions and participant messages require the concrete authorization described in the parent plan.


## Completion record — September 5

Implemented source: `05123ac6159f48b0f3fc77d4f570e502760a1b0f`; clean packaging subject: `3633b5cf02466eb952e6daad9857c6f1f1037f66`. No remote publication, provider execution or deployment occurred.

Changed source covers the shared verification codec/types/legacy adapters, typed challenge contracts and observation adapters, policy and snapshot isolation, compatible Case Lab validation/cost rendering, versioned corpus discovery and the exact historical pagination regression. The Action bundle was rebuilt and committed with core changes. The original 51-case manifest and historical replay bytes remain unchanged.

Independent plan-compliance reviews approved the evidence/Case Lab, protocol/isolation and corpus scopes. A separate reuse/quality review approved the final changes after fixing selected-diff/source binding, duplicate/counterfactual selection overrides, Python unsupported-value coercion, reserved-path reuse and unknown-cost presentation.

Sequential local verification: focused protocol/codec/policy/snapshot/regression tests passed; typecheck, lint and build passed; bundle parity passed; the full workspace suite passed 1,852 tests with nine credential-gated skips. Packed installation passed on the clean packaging subject. Core/Action coverage exercised all 526 scanned product guards. The explicit Placebo self-check passed 28 tests across its two files, including the 53-case expanded self-check.

The `ci:local` wrapper first stopped at its committed-bundle requirement, then reached packaging and rejected a documentation-only working-tree update. Committing the reviewed source/bundle and documentation resolved those preconditions; the remaining packaging and guard commands passed sequentially. No hosted CI was used. The final integration gate will run the complete wrapper on a clean checkout.

Limitations: provider acceptance remains pending the separately authorized phase-10 preflight; TypeScript transformation syntax and Python package-relative imports are unsupported. Unknown provider units and unavailable terminal identities remain explicit. See the committed implementation notes for the frozen-corpus and terminal-identity deviations.
