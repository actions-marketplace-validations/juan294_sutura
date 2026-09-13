# Sutura technical evaluation guide

Reviewed source: `095bfc08dc0294d6a43dee235b7dc712429f2faa` plus the local implementation changes inspected on 2026-09-08. Scope: repository source, test definitions, and retained evidence. This is not a fresh deployment or live-provider validation; the final integrated candidate requires its own verification and manifest.

## The project in one minute

A green CI command can hide a deleted test, weakened assertion, or repair to the
wrong cause. Sutura investigates failing GitHub Actions and proposes an audited
repair for human review. Its [product workflow](../devpost/sutura-submission.md?plain=1#L40)
retains failure evidence and never merges the generated repair.

- **Controller authority:** the model proposes a bounded replacement; the
  controller selects its target and runs trusted verification.
  [Source and regression proof](architecture.md#controller-authority).
- **Reusable isolation:** dependency preparation feeds separate reproduction,
  repair, and audit branches. [ConTree evidence](architecture.md#contree-branches).
- **Layered audit:** mechanical checks, a fresh rerun, and semantic review can
  refuse a previously green candidate. [Audit evidence](architecture.md#layered-audit).

No clean quality measurement exists for the current candidate. The September 6–8 preflight passed its provider/image contract, the six-case smoke passed, and Stage 3 stopped on a real false approval after 72 of 80 cases. Its five attempts spent USD 12.55 against a USD 10 cap. The false-approval defect and cumulative restart cap are fixed locally; those fixes do not produce a repair rate. The held-out 20 remain unopened. Read [the retained Stage 3 record](../demo/run-manifests/development-validation-v1-evidence.md), [evidence status](#evidence-status) and [limitations](#limitations) before treating these mechanisms as release proof.
The [architecture cards](architecture.md) connect each claim to code and tests.

## Current local verification implementation

[Generated repairs](../../packages/core/src/heal.ts), [supplied patches](../../packages/core/src/verification/external.ts) and counterfactuals share production verification gates. A separate baseline-only challenge-generation call freezes a bounded set before candidate work. The controller qualifies baseline observations, checks each candidate with repeated probes, then applies policy, mechanical audit, clean rerun and adjudication before search admission. Required contracts bind a frozen source manifest. Default healing remains optional; external verification requires assurance.

The [CLI](../../packages/cli/src/verify.ts) and [read-only Action](../../packages/action/src/verify-execution.ts) retain canonical evidence and artifact bytes. The Action authenticates the exact same-repository failed run and source SHA; fork sources are refused. [Evidence v2](../../packages/core/src/verification/types.ts) records the actual executor baseline image ID separately from an unavailable OCI digest, with observed model, operation and cost records. These are local implementation claims, not a published release or new live quality result.

Remaining external work includes clean capped Stage 3 and held-out measurement, authorized publication, consented participants, the [independent human record walkthrough](record-walkthrough.md), and [December judging-access evidence](../runbooks/judging-access.md). Historical reports below retain the source and limitations of the runs they describe.

See [evaluation recovery](run-recovery.md) for durable job recovery, cumulative spend reservations, offline failure tests, and terminal notification setup.

<a id="criteria"></a>
## Hackathon criteria

The [official rubric](https://nebiusglobalaihackathon.devpost.com/rules) provides
these four criteria.

| Criterion | Supported behavior | Evidence and limit |
| --- | --- | --- |
| Technological Implementation | Bounded proposals, isolated execution, independent audit | [Controller and audit cards](architecture.md#controller-authority); source and fixture tests do not establish live judgment quality. |
| Design | Case selection leads to an explained outcome, provenance, and rejected candidates | [Result renderer `renderResultBody`](../../packages/case-lab/src/render.ts#L347); this review did not test the hosted experience. |
| Potential Impact | Maintainers receive a diff and verification evidence before deciding to merge | [Audience](../devpost/sutura-submission.md?plain=1#L23) and [dogfood record](../demo/sutura-v0.2.0-phase-0-evidence.md?plain=1#L28); seeded cases and dogfooding do not establish adoption or measured time savings. |
| Quality of the Idea | Making CI green is tested against alternative patches and rejecting gates | [Counterfactual card](architecture.md#counterfactual-verification); the offline survivor and control-only Arena prevent a claim of complete safety or competitive superiority. |

## NVIDIA, Nebius, and Tavily roles

| Integration | Why used | Source or artifact and actual mode |
| --- | --- | --- |
| NVIDIA Nemotron through Nebius Token Factory | Separate diagnosis, proposal, and audit roles | [`DEFAULT_MODELS`](../../packages/core/src/config.ts#L10), [`createTokenFactoryClient`](../../packages/core/src/llm/token-factory.ts#L25): implemented runtime client; measured subjects remain in the reports below. Requested role and actual provider model are distinct. |
| Nebius ConTree | Share prepared dependencies while isolating execution branches | [`prepareSandbox`](../../packages/core/src/heal.ts#L483): runtime implementation; image availability and dependency support constrain execution. |
| Tavily | Ground dependency failures in release sources | [`ground`](../../packages/core/src/diagnose/tavily.ts#L500): runtime Search/Extract with validation; [versioned ablations](architecture.md#grounded-dependencies) retain failed arms. |
| Nebius Data Lab | Execute a finite, manifest-bound quality experiment with recoverable submissions and exact output joins | [Runner](../../scripts/datalab-quality-experiment.mjs) and [dataset and request](../datalab/README.md): locally implemented and fixture tested; actual upload and batch inference remain pending. |
| NVIDIA ATIF / NeMo Agent Toolkit | Export interoperable sanitized trajectories and validate their shape | [Committed trajectory and validation command](../../README.md?plain=1#L350): offline validation; NeMo is not the live repair orchestrator. |

## Follow a Case Lab result

Open the [Case Lab](https://sutura-case-lab.vercel.app/), choose a case, and follow
these source-backed sections. [Replay provenance](../../packages/case-lab/replay/README.md?plain=1#L3)
distinguishes deterministic bundles from recorded-result fallback. The catalog's
[`expectedOutcomeFor`](../../packages/case-lab/src/cases.ts#L54) records expectations, not observations.

| Visible section | Renderer to inspect |
| --- | --- |
| Mode badge and failed commit / CI evidence | [`renderHeader`](../../packages/case-lab/src/render.ts#L164), [`renderEvidence`](../../packages/case-lab/src/render.ts#L185) |
| ConTree search tree and branch status | [`renderSearch`](../../packages/case-lab/src/render.ts#L214) |
| Rejected patches and rejection reasons | [`renderRejections`](../../packages/case-lab/src/render.ts#L252) |
| Clean audit branch and Ultra verdict | [`renderAudit`](../../packages/case-lab/src/render.ts#L273) |
| Accepted patch beside rejected alternatives, when attached | [`renderCounterfactual`](../../packages/case-lab/src/render.ts#L120) |

Empty search and “Not run” audit states describe that run's path. Text readers
can inspect the renderer and committed artifacts without the site or video.

<a id="evidence-status"></a>
## Evidence status

Canonical reports retain dates, corpus, denominators, outcomes, and identities.
Evidence was refreshed from integration snapshot
`61093a817dacf456b902f20c233436d6da27a604`; product source bytes are unchanged
from the reviewed source. Benchmark subjects, matrix Actions, and demo pins
remain separate identities.

| Evidence | Status and interpretation |
| --- | --- |
| [Latest repair-quality rerun, 2026-09-05](../demo/sutura-v0.2.1-repair-quality-evidence.md?plain=1#L13) | Live Placebo v0.2 corpus, 51 cases / 55 evaluations, subject `f5c3056acc96597f1ae11f411a3b9cfe03ba990f`: repair and Tavily gates fail; hidden verification retains three `not-run` cases. Zero observed false approvals does not make it release-ready. |
| [Candidate external matrix](../demo/sutura-v0.2.1-candidate-matrix.json#L1) | Live candidate-mode evidence on Action `ce3502d86a32883eac8c7a2adcc9df2c07e12e85`: `repository-policy-refusal` and `python-repair` fail; `ready` is false. This is not a public-release matrix or hosted-demo acceptance. |
| [Earlier v0.2.1 candidate](../demo/sutura-v0.2.1-phase-0-evidence.md?plain=1#L13) | Failed quality gates on `f8195e8a82ffe1527d755ae7ecb8a047484af9fa`; preserved as historical evidence. |
| [Historical v0.2.0 baseline and matrices](../demo/sutura-v0.2.0-phase-0-evidence.md?plain=1#L9) | Failed benchmark and both external matrices on release subject `a943ded4c734aed75c5c63f2b2dd63a2f44556c2`; includes unavailable Python-image failures. |
| [Counterfactual report](../demo/sutura-counterfactual-v0.2.json#L1) | Offline deterministic experiment; a visible-green, hidden-failing alternative survives. See [gate omissions](architecture.md#counterfactual-verification). |
| [Arena report](../demo/sutura-arena-v0.2.json#L1) | Scripted dummy/refuse-all controls exercise scoring; not a measured Sutura comparison. |
| [Demo identity](../../packages/case-lab/release.json#L1) | Action remains v0.2.0 at `a943ded4c734aed75c5c63f2b2dd63a2f44556c2`, separate from current source package v0.2.1 and later benchmark subjects. |

<a id="limitations"></a>
## Limitations and reproducing the review

Source inspection establishes implemented behavior; linked tests establish
existence, not a fresh pass. Live outcomes describe their measured subject.
Offline fixtures omit provider behavior; controls validate a harness; Data Lab
upload, batch inference, and final submission evidence remain separate work.
Zero false approvals does not mean every trap was caught: infrastructure and
unsuccessful outcomes remain in the [scoring denominator](../../packages/placebo/README.md?plain=1#L202).

Follow [contributor setup](../../README.md?plain=1#L235) and the existing
[offline replay commands](../../README.md?plain=1#L262). The documentation check
is `node --test scripts/submission-contract.test.mjs`; run project typecheck,
lint, tests, and build sequentially. These local checks do not measure live
repair quality. Final acceptance follows the [release evidence contract](../demo/sutura-v0.2.1-release-evidence-requirements.json#L1).

On refresh, review changed source bytes and update inspected references. Keep
reviewed source, historical benchmark subject, and demo Action identity separate;
a documentation commit cannot contain its own final hash.
