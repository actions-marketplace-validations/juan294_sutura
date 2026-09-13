# Sutura architecture evidence cards

Reviewed source: `ce3502d86a32883eac8c7a2adcc9df2c07e12e85`.
Inspection date: 2026-09-05. Source and test inspection describes this snapshot;
it does not report fresh test execution or provider validation.

Start with the [evaluation guide](README.md), its [evidence status](README.md#evidence-status),
and [limitations](README.md#limitations). The cards use stable IDs and seven
visible fields so their claims can be checked without following repository
instructions or interpreting a custom data format.

## Lifecycle and trust boundaries

```text
Failing GitHub Actions run + exact repository state + policy
  -> dependency-input snapshot -> dependency preparation -> source overlay
  -> initial reproduction -> bounded failure evidence
  -> Nano diagnosis -> optional Tavily grounding
  -> independent reproduction probes
  -> persistent failure: bounded Super proposals and controller-run tests
  -> passing candidate submitted for audit -> mechanical checks
  -> isolated suite rerun from patched image -> semantic adjudication
  -> required repository winner-policy checks
  -> evidence-backed repair PR for human review, or terminal failure/refusal
```

The [existing architecture diagram](../devpost/sutura-submission.md?plain=1#L55)
shows the service roles. Dependency preparation is a distinct network-enabled
stage; reproduction and repair stages record disabled-network execution.
[`prepareSandbox`](../../packages/core/src/heal.ts#L483) constructs the staged
images; [`healCase`](../../packages/core/src/heal.ts#L1311) first reproduces the
observed command, then [`repairFailure`](../../packages/core/src/heal.ts#L748)
coordinates diagnosis, triage, search, and audit. Runs may stop before search
or audit.

<a id="controller-authority"></a>
## Controller authority over proposals and verification

| Field | Evidence |
| --- | --- |
| Claim | The controller selects one policy-admissible, bounded source excerpt. The model supplies replacement text; controller code derives its coordinates, applies the patch, runs trusted verification, and submits a candidate internally. |
| Product value | A proposal cannot select an arbitrary file or substitute an easier command to manufacture success. Maintainers receive a candidate whose execution path is controlled and recorded. |
| Criterion | Technological Implementation; Quality of the Idea. |
| Implementation | `prepareControlledRepairProposalTemplate` selects editable source and constrains the response: [repair-attempt.ts:141](../../packages/core/src/engine/repair-attempt.ts#L141). `runControlledRepairAttempt` derives target coordinates and owns tool execution: [repair-attempt.ts:313](../../packages/core/src/engine/repair-attempt.ts#L313). `repairFailure` constructs trusted commands: [heal.ts:839](../../packages/core/src/heal.ts#L839). |
| Verification | The regression “the model cannot select a path or line range” asserts rejection before sandbox execution: [repair-attempt.test.ts:280](../../packages/core/src/engine/repair-attempt.test.ts#L280). The budget reservation test checks worst-case inference reservation before a request: [repair-budget.test.ts:25](../../packages/core/src/engine/repair-budget.test.ts#L25). |
| Mode and revision | Source and test definitions inspected at `ce3502d86a32883eac8c7a2adcc9df2c07e12e85` on 2026-09-05. Regression fixtures and mocked responses are not a new live-model run. |
| Limit | Bounds restrict authority, not semantic error. A selected excerpt can omit the real cause; a syntactically valid replacement can still be wrong. Candidate submission is not permission to merge. |

<a id="contree-branches"></a>
## ConTree branches across preparation, triage, repair, and audit

| Field | Evidence |
| --- | --- |
| Claim | Dependency preparation precedes source overlay; triage, adaptive repair search, and audit use isolated execution branches. Audit reruns the suite from the candidate's patched image. Search records lineage and bounded expansion. |
| Product value | Prepared dependencies can be reused while each branch preserves its own execution evidence. A reviewer can trace what reproduced, what changed, and which candidate survived. |
| Criterion | Technological Implementation; Design. |
| Implementation | `prepareSandbox`: [heal.ts:483](../../packages/core/src/heal.ts#L483); `ContreeExecutor.snapshot`: [contree.ts:170](../../packages/core/src/executor/contree.ts#L170); `triage`: [triage.ts:47](../../packages/core/src/engine/triage.ts#L47); `adaptiveSearch`: [search.ts:92](../../packages/core/src/engine/search.ts#L92); `audit` reruns from `winner.imageId`: [audit.ts:95](../../packages/core/src/audit/audit.ts#L95). `DEFAULT_SEARCH_LIMITS` defines configurable search defaults: [search.ts:7](../../packages/core/src/engine/search.ts#L7). |
| Verification | “uploads only dependency manifests before network-enabled preparation”: [contree.test.ts:827](../../packages/core/src/executor/contree.test.ts#L827). “uses stable lineage and deterministically expands the best beam”: [search.test.ts:24](../../packages/core/src/engine/search.test.ts#L24). |
| Mode and revision | Source and test definitions inspected at `ce3502d86a32883eac8c7a2adcc9df2c07e12e85` on 2026-09-05; these links establish fixture coverage, not fresh ConTree execution. |
| Limit | Runtime-image availability and supported dependency forms constrain execution. Bounded search can exhaust its budget without finding a repair; branching alone proves neither an optimal patch nor a successful audit. |

<a id="layered-audit"></a>
## Layered audit and refusal after a green command

| Field | Evidence |
| --- | --- |
| Claim | Audit applies mechanical checks, requires a held passing candidate, reruns the suite, then requests semantic adjudication. A failed fresh rerun returns refusal before the model call. |
| Product value | Earlier success cannot override a later execution failure. The refusal retains bounded failure output and avoids spending on an adjudication whose prerequisite has already failed. |
| Criterion | Technological Implementation; Quality of the Idea. |
| Implementation | `audit` orders the gates: [audit.ts:53](../../packages/core/src/audit/audit.ts#L53). Its failed-rerun branch records skipped adjudication: [audit.ts:100](../../packages/core/src/audit/audit.ts#L100). |
| Verification | “refuses when the fresh suite rerun fails and does not call Ultra”: [audit.test.ts:196](../../packages/core/src/audit/audit.test.ts#L196). “refuses a mechanically clean patch when Ultra finds the wrong-cause repair”: [audit.test.ts:180](../../packages/core/src/audit/audit.test.ts#L180). |
| Mode and revision | Source and controlled executor/model tests inspected at `ce3502d86a32883eac8c7a2adcc9df2c07e12e85` on 2026-09-05; no fresh pass is asserted by these links. |
| Limit | Mechanical rules and model judgment can miss defects. The ordering regression does not measure the auditor's live semantic accuracy or prove all repository policies were exercised. |

For the bounded example, the fixture supplies an honest diff, an earlier held
candidate, and a fresh executor exit code of 1. It also queues an approving model
reply. The assertions require refusal, retained “Assertion failed” output, and
zero model calls. Thus the queued approval cannot rescue the failed rerun. This
is an inspected test of controller ordering, not an observed live refusal.

<a id="flake-triage"></a>
## Flake triage with explicit uncertainty

| Field | Evidence |
| --- | --- |
| Claim | Progressive reproduction records counts, a versioned confidence method, Wilson interval, and stop reason. Mixed pass/fail evidence continues to the configured maximum rather than stopping at a crossed numeric boundary. |
| Product value | The terminal result explains how much reproduction evidence exists and why sampling stopped, helping distinguish a persistent failure from an intermittent one. |
| Criterion | Technological Implementation; Potential Impact. |
| Implementation | `completedTriageVerdict` retains evidence: [triage.ts:25](../../packages/core/src/engine/triage.ts#L25). `evaluateFlakeConfidence` implements decisions and boundaries: [flake-confidence.ts:58](../../packages/core/src/engine/flake-confidence.ts#L58); `wilsonInterval`: [flake-confidence.ts:40](../../packages/core/src/engine/flake-confidence.ts#L40). |
| Verification | Mixed-sequence maximum and bounded interval regressions: [flake-confidence.test.ts:39](../../packages/core/src/engine/flake-confidence.test.ts#L39). Measured flake outcomes are in the [latest benchmark](../demo/sutura-v0.2.1-repair-quality-evidence.md?plain=1#L43). |
| Mode and revision | Source and tests inspected at `ce3502d86a32883eac8c7a2adcc9df2c07e12e85` on 2026-09-05. The linked live report evaluates its separately named candidate, not this source snapshot. |
| Limit | Finite samples and the declared statistical assumptions cannot prove that a test never flakes. A benchmark's classification rate is bounded by its corpus and denominator. |

<a id="grounded-dependencies"></a>
## Grounded dependency diagnosis

| Field | Evidence |
| --- | --- |
| Claim | Tavily Search and Extract provide dependency-release citations. Optional release extraction checks exact package/version registry ownership and accepts matching public release sources. |
| Product value | Diagnosis can use release-specific evidence when installed dependency behavior changes, with inspectable citation provenance instead of relying solely on model recollection. |
| Criterion | Technological Implementation; Potential Impact. |
| Implementation | `TavilyClient.search`: [tavily.ts:140](../../packages/core/src/diagnose/tavily.ts#L140); `TavilyClient.extract`: [tavily.ts:214](../../packages/core/src/diagnose/tavily.ts#L214); `addRegistryVerifiedReleaseCitations`: [tavily.ts:460](../../packages/core/src/diagnose/tavily.ts#L460); `ground`: [tavily.ts:500](../../packages/core/src/diagnose/tavily.ts#L500). |
| Verification | Exact npm ownership and malicious/unrelated extraction tests: [tavily.test.ts:248](../../packages/core/src/diagnose/tavily.test.ts#L248), [tavily.test.ts:335](../../packages/core/src/diagnose/tavily.test.ts#L335). Versioned with/without-Tavily observations remain in the [historical report](../demo/placebo-v0.2-live-2026-09.md?plain=1#L1) and [latest full result](../demo/placebo-v0.2.1-live-2026-09-05.json#L1). |
| Mode and revision | Source and fixture tests inspected at `ce3502d86a32883eac8c7a2adcc9df2c07e12e85` on 2026-09-05; live ablations retain their own subject SHA and date. |
| Limit | Validated citations do not guarantee a correct proposal. Both arms failed all upstream repairs in the historical v0.2 result; the latest rerun still fails the Tavily gate. Neither establishes consistent benefit on arbitrary dependency failures. |

<a id="counterfactual-verification"></a>
## Counterfactual verification and surviving alternatives

| Field | Evidence |
| --- | --- |
| Claim | Alternative patches are evaluated through rejecting gates, recording evidence and added cost; passing alternatives can survive. The committed offline experiment exercises only deterministic portions of this path. |
| Product value | Reviewers can inspect why a shortcut was rejected even when visible tests passed, and see examples where the available verification remains insufficient. |
| Criterion | Quality of the Idea; Technological Implementation. |
| Implementation | `evaluateCounterfactuals` follows the production gate order: [evaluate.ts:180](../../packages/core/src/counterfactual/evaluate.ts#L180). `DETERMINISTIC_GATES` and omitted-gate reasons define offline scope: [counterfactual.ts:48](../../packages/placebo/src/counterfactual.ts#L48). |
| Verification | “approves an alternative that passes every gate” uses controlled dependencies: [evaluate.test.ts:298](../../packages/core/src/counterfactual/evaluate.test.ts#L298). The [committed offline report](../demo/sutura-counterfactual-v0.2.json#L1) retains each alternative, rejecting rule, hidden result, and cost. |
| Mode and revision | Source and test definitions inspected at `ce3502d86a32883eac8c7a2adcc9df2c07e12e85` on 2026-09-05. The report is offline corpus evidence, not fresh provider adjudication or validation of this source revision. |
| Limit | Offline coverage omits a second-image suite rerun, provider adjudication, and repository-policy commands absent from fixtures. `python-repair-missing-await/drop-the-coroutine` survives deterministic checks while failing hidden verification. The [Arena control report](../demo/sutura-arena-v0.2.json#L1) remains dummy/refuse-all scoring evidence, not a comparative Sutura win. |
