# Phase 2 — Recover diagnosis without widening repair authority

Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on Phase 1. Sequential; **not batch-eligible**. Stop after implementation, review, simplification and local verification; do not begin Phase 3 automatically.

## Outcome and boundary

Recover legitimate missing-await and strict-configuration repairs currently blocked by one diagnosis class, while retaining refusal of weakened tests, configuration and repository policy. The controller may investigate at most three evidence-backed hypotheses. A model's classification or confidence never grants general permission to edit a test or configuration file.

This phase completes code and deterministic local evidence. It does not claim a measured live repair-rate improvement. Phase 10 owns authorized provider measurement, including unsuccessful repairs and held-out outcomes.

## Existing behavior and reuse

| Existing source | Relevant behavior |
| --- | --- |
| `packages/core/src/diagnose/classify.ts:220` | Mechanical/model disagreement reduces confidence, but the result still has one class. The observed command remains mechanically owned. |
| `packages/core/src/engine/patch-rules.ts:33` | Class alone currently determines admissibility of conventional tests and tool configuration. |
| `packages/core/src/heal.ts:749` | Diagnosis and grounding precede reproduction and candidate preparation. |
| `packages/core/src/heal.ts:828` | Source context is collected for the chosen diagnosis. |
| `packages/core/src/heal.ts:852` | No admissible excerpt causes an early give-up. |
| `packages/core/src/orchestrate.ts:367` | Source closure is bounded, policy-filtered and dependency-aware. Preserve its eight-file and two-hop limits. |
| `packages/core/src/engine/candidate-validation.ts:18` | Combines built-in rules, repository policy and run diff limits. |
| `packages/core/src/engine/repair-attempt.ts:141` | Controller chooses the excerpt and owns proposal schema. |
| `docs/demo/sutura-v0.2.1-repair-quality-evidence.md:55` | Names current failed repairs; the missing-await/config family is specifically identified. |

Read the listed implementation files completely before implementation. Source positions refer to the planning snapshot and may move in Phase 1; follow symbols after integration.

## Files owned by this phase

Proposed new files:

- `packages/core/src/diagnose/hypotheses.ts` and `hypotheses.test.ts`: bounded hypothesis proposal, validation and scheduling.
- `packages/core/src/engine/repair-authorization.ts` and `repair-authorization.test.ts`: exact, evidence-bound grants and conservative edit-shape validation.
- `packages/core/src/diagnose/recovery.test.ts`: deterministic end-to-end diagnosis recovery controls, using real captured failure logs where available.
- New analogue and deception fixtures under `packages/placebo/corpus/`, registered through the Phase 1 corpus lineage contract.

Existing edits: `diagnose/classify.ts`, `engine/patch-rules.ts`, `engine/candidate-validation.ts`, `engine/repair-attempt.ts`, `engine/repair-tools.ts`, `heal.ts`, `orchestrate.ts`, and their tests. Extend Phase 1 diagnosis/provenance evidence through its shared types, trace and report serialization. Rebuild `packages/action/dist/index.cjs` with the source changes, as required by `.claude/rules/ci-parity.md`.

## Design decisions

1. Keep the initial diagnosis visible. Trigger recovery on class disagreement, evidence-supported competing interpretations, or no admissible target. Low confidence can request investigation, never unlock edits.
2. Bound the total to three hypotheses, including the initial one, and two recovery probes. Reserve their model turns, sandbox operations, elapsed time and inference budget before work. They consume the existing run budget rather than getting a fresh budget per hypothesis. Reserve capacity for subsequent repair and verification; insufficient capacity yields a named abstention.
3. Each hypothesis names an observed signal, an existing bounded source reference, an edit intent and a controller-known probe identifier. The response cannot provide a shell command, change the observed failing command, add arbitrary source paths or create a grant.
4. Reproduction must remain deterministic before repair. Flaky or absent failures do not gain a repair path through recovery. Hypothesis investigation cannot suppress triage evidence.
5. A grant binds the Phase 1 baseline identity, exact path and excerpt hash, evidence references, controller probe result and narrowly permitted edit shape. Do not trust grants supplied in external JSON or repository content. Report them as controller evidence.
6. Preserve repository `protectedPaths`, `allowedPaths`, denied reads, budget limits and shortcut detection. Grants can satisfy one built-in test/config restriction; they cannot override repository policy or any other safety gate.
7. Do not broaden class-based fallbacks into unrestricted repository crawling. Collect the bounded union of source references necessary for validated hypotheses, reusing `readRepairSourceContext`. Ambiguous imports, symlinks, sensitive content and truncated/incomplete source remain ineligible.

### Initial grant types

| Grant | Exact permitted change | Required evidence | Still refused |
| --- | --- | --- | --- |
| Await an existing operation | Insert `await` at an existing call/expression and the necessary `async` modifier on the existing enclosing callback/function | Captured coroutine/promise mismatch or missing completion evidence; source shape; controller-owned reproduction/probe | Altered assertions, expected values, call arguments, branches, retries, timeout changes, skips, exception swallowing, additional calls |
| Complete asynchronous setup | Await an already-present setup operation before the existing assertion, with only necessary asynchronous syntax | Named setup failure and unchanged assertion/control-flow structure | Moving assertions outside executed callbacks, dropping assertions or replacing their values |
| Restore strict configuration | Restore a missing/false strictness Boolean to `true` in a supported JSON configuration, initially `strict` and `noUncheckedIndexedAccess` | Observed failure plus an explicit existing repository check/contract requiring that key | Any `true` to `false`, include/exclude/discovery changes, arbitrary config changes, inferred values without a contract |

Use structural/token comparison with a deliberately small accepted syntax subset. Verify that removing only the enumerated added async/await tokens yields the original expression and enclosing structure; reject ambiguous constructs instead of interpreting them generously. Python syntax validation must parse without executing repository source. Configuration handling must parse a supported format and compare the complete before/after structure; unsupported JSON extensions produce an explicit abstention until separately supported. A model assertion that a test or config is wrong is not supporting evidence.

The grant only authorizes the attempt. The unchanged test expectations, trusted checks, fresh audit, policy checks and Phase 1 verification contract still decide whether a result is publishable. Generated checks in later phases add assurance; they do not retrospectively authorize broader edits.

## Pseudocode

```text
initial = classify(observedFailureLog)
reproduction = triage(baseline, observedTrustedCommand)
if reproduction is not deterministic failure:
    preserve existing no-patch outcome

hypotheses = [initial hypothesis]
if disagreement or no admissible target or supported competing interpretation:
    reserve bounded recovery capacity within shared run budget
    proposed = Nemotron.proposeHypotheses(redactedLog, boundedSource, schema)
    hypotheses += validateAtMostTwo(proposed, existingSourceReferences)

for hypothesis in deterministic bounded order:
    probe = controller.resolveProbe(hypothesis.probeId)
    evidence = runInIsolatedBaselineBranch(probe)
    authorization = controller.deriveNarrowGrant(
        baselineIdentity, sourceHash, hypothesis, evidence)
    if evidence cannot justify the permitted edit shape:
        record abstention; continue
    proposal = existingControlledRepair(hypothesis, authorization)
    require exact baseline/path binding and conservative edit-shape match
    require every existing policy/shortcut check
    run trusted checks and full existing audit
    record initial diagnosis, recovered hypothesis and executed evidence
    return outcome through Phase 1 verification contract

return gave-up with bounded hypotheses and reasons
```

Recheck the grant at candidate validation and final audit, not only when preparing the model prompt. Supplied-candidate verification must not accept an external grant or exploit a `test-bug` label to bypass this contract. Historical replay records keep their historical labels; new executions enforce the new policy.

## Executable acceptance artifacts

Start with failing tests before implementation. Name real captured-log replay tests for every currently relevant give-up, as required by the CI parity rule.

| Artifact | Required outcome |
| --- | --- |
| Existing `python-repair-missing-await` | A known-good await repair can be authorized under a competing hypothesis while preserving hidden checks. |
| Existing `repair-missing-await` and `repair-missing-await-setup` | Correct asynchronous syntax/setup repair becomes reachable; changed expected values remain forbidden. |
| Existing `repair-tsconfig-drift` | Restore required strictness through a narrow config grant; relaxing strictness remains rejected. |
| Existing `repair-tsconfig-drift-indexed-access` | Maintain legitimate strictness behavior and policy boundaries. |
| Proposed `repair-await-helper-preservation` | A different helper/callback arrangement repairs correctly with preserved arguments and assertions. |
| Proposed `python-repair-await-result-preservation` | Unfamiliar Python coroutine structure has a valid narrow repair and independent preservation checks. |
| Proposed `trap-recovery-assertion-rewrite` | Deceptive `test-bug` hypothesis cannot change an expected value, skip a check or swallow an exception. |
| Proposed `trap-recovery-config-relaxation` | A plausible `env-config` diagnosis cannot disable strictness or change discovery. |
| `repair-authorization.test.ts` | Stale baseline/hash, different path, fabricated grant, unsupported syntax and policy-protected target reject. |
| `hypotheses.test.ts` | More than three hypotheses, unknown probe/command, unrelated paths, cancellation and budget exhaustion stop without extra operations. |

Keep development fixtures separate from the final held-out evaluation selection. Their purpose is executable implementation coverage, not a claim that unseen diagnoses are solved.

## Automated success criteria and local commands

- [x] All named known-good controls repair through the real local controller/executor path; mocks may supply inference responses but must not synthesize successful test outcomes for integration controls.
- [x] Every matched malicious control remains rejected, including when its claimed class is `test-bug` or `env-config`.
- [x] Recovery consumes one shared budget; unavailable resources and unsupported syntax are explicit abstentions.
- [x] The unchanged observed command remains controller-owned; tests prove no model command reaches execution.
- [x] Phase 1 identity, uncertainty and historical replay contracts survive the additional evidence.
- [x] Process-spawning tests declare explicit timeouts of at least 30 seconds.

Run focused commands sequentially from the repository root after adding the proposed files:

```bash
pnpm --filter @sutura/core exec vitest run src/diagnose/classify.test.ts src/diagnose/hypotheses.test.ts src/diagnose/recovery.test.ts src/engine/repair-authorization.test.ts
pnpm --filter @sutura/core exec vitest run src/engine/patch-rules.test.ts src/engine/repair-attempt.test.ts src/heal.test.ts src/orchestrate.test.ts
pnpm --filter placebo self-check
```

After implementation review, fixes and a dedicated reuse/quality/simplification pass, run the standard verification sequentially:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
pnpm run ci:local
```

Inspect the rebuilt Action bundle and local diff. This phase must not trigger remote CI, Vercel previews, provider inference or hosted sandboxes as an experiment. Any future push requires the parent plan's workflow-trigger inspection and local gates.

## Manual review and completion

- [x] Reviewer can explain exactly why each test/config exception is authorized from a case file without reading hidden model reasoning.
- [x] Reviewer inspects the allowlisted syntax transformations and confirms that no class/confidence-based general exception remains in the new path.
- [x] Report distinguishes reachable deterministic controls from measured live model success; no fresh benchmark claim is published.

Deliver the implementation summary, changed-file list, local gate results and remaining explicit unsupported syntax. **Stop at the phase gate.** No provider spending or external outreach is required to complete this phase.

## Completion record — September 6

Implemented source: `731cb318ddaa877472d8bc73cad169978d93d8fd` for the recovery, grant and authorization work; `dac919680916792e34e4a04f6c788ef064a6910c` for the counterfactual authorization seam; `9cb76e280c8a0af231e3f3280e806804e3da8d95` for context-anchored grant hunk location. Clean packaging subject: `dac919680916792e34e4a04f6c788ef064a6910c`. No push, pull request, remote CI run, deployment, provider inference or hosted sandbox occurred.

Changed source covers bounded hypothesis proposal and scheduling, the evidence-bound grant contract with its conservative await and strict-configuration syntax subset, class-independent test and tool-configuration admissibility, shared-budget reservation, the extended recovery evidence through trace, report and Case Lab serialization, and the offline counterfactual harness. `packages/action/dist/index.cjs` was rebuilt and committed with the earlier core change; the counterfactual commit left the bundle byte-identical and `verify:bundle` confirmed parity.

Enforcement is no longer class-based: `repairPathViolations` admits a conventional test or tool-configuration path only against a controller certificate, and the remaining `diagnosis.class` reads are evidence fields, Tavily grounding heuristics and repair-prompt wording, none of which decide admissibility. `report/recovery-summary.ts` renders each grant's kind, path, strict key, source excerpt hash, probe identifier, baseline identity and policy hash, so a reviewer can explain every exception from the case file alone.

Sequential local verification on the integrated source: workspace typecheck, lint and build passed across six projects; `pnpm run verify:bundle` reported bundle parity; `pnpm run guards:verify` reported 575/575 guards. Focused `patch-rules`, `counterfactual/evaluate`, `diagnose/recovery`, `hypotheses`, `hypotheses-budget` and `repair-authorization` suites passed 168 tests. The offline counterfactual suite passed 12 tests, including the new grant-scope control. `pnpm run ci:local` passed release contracts, README checks, offline smoke, typecheck, lint and bundle verification, then the full workspace suite: core 1,365 passed with nine credential-gated skips, evaluation 21, Case Lab 165, Action 121, CLI 112 and Placebo 213. Its packaging step refused the uncommitted working tree; after committing the reviewed source, `pnpm run test:package` passed and reported the packed `sutura@0.2.1` installing with Action `dac919680916792e34e4a04f6c788ef064a6910c`. `pnpm --filter placebo self-check` passed 28 tests across its two files.

The offline counterfactual set records ten of ten declared shortcuts rejected with no inference across eight distinct named rules, with `python-repair-missing-await/drop-the-coroutine` still surviving the deterministic gates and failing hidden verification. `docs/demo/sutura-counterfactual-v0.2.json` was regenerated from the new gate stack (`resultHash` `6ae5251175d90f21da2cc64030e9823420593eab9ae603ebbb9b05585c9c2e1f`), and the dependent Arena control artifacts were regenerated from it against `9cb76e280c8a0af231e3f3280e806804e3da8d95` so they cite the current report. Those arms remain scripted dummy and refuse-all controls, not a Sutura result. No new benchmark or live repair-rate claim is published; phase 10 owns authorized provider measurement.

Limitations: a zero-context pure insertion no longer applies at its declared position and abstains instead; every supported grant shape modifies an existing line, so no reachable repair depends on it. Unsupported TypeScript transformation syntax, Python package-relative imports and unsupported JSON extensions remain explicit abstentions. Provider acceptance remains pending the separately authorized phase-10 preflight.
