# Sutura technical evaluation guide

Draft prepared: 2026-09-05. Proposed destination: `docs/evaluation/README.md`.

Reviewed source: `974612b7ece1b7386b8c71d136b3a3ecda860ab1` on local `develop`.
This draft describes that snapshot; it does not certify the current deployment
or a submission-ready release. Links and line references below resolve within
that source tree. Rebase the guide's evidence before publishing a final version.

## The project in one minute

Sutura investigates failing GitHub Actions and proposes repairs for human review.
Its central design choice is to treat a passing command as one requirement in a
larger verification process: reproduce the failure, constrain the repair, inspect
the diff, rerun the suite, and independently audit the candidate. The product
workflow and audience are described in
[docs/devpost/sutura-submission.md:15](../devpost/sutura-submission.md?plain=1#L15).

Three engineering choices are worth inspecting first:

- **Constrained repair authority:** the controller selects the editable source
  and owns test execution, limiting what a model proposal can change.
  [Repair role:79](../devpost/sutura-submission.md?plain=1#L79).
- **Reusable sandbox isolation:** separate reproduction, repair, and audit
  branches make each stage inspectable while sharing dependency preparation.
  [ConTree design:49](../../README.md?plain=1#L49).
- **Layered verification:** a successful command still faces diff checks and
  independent audit before a maintainer receives a proposed repair.
  [Audit implementation:53](../../packages/core/src/audit/audit.ts#L53).

These choices have source and test evidence. The historical live v0.2.0 baseline
failed its release gates; this draft does not establish a passing current release.
[Evidence status:5](../demo/sutura-v0.2.0-phase-0-evidence.md?plain=1#L5).

For a repository-only review, continue through these starting points:

1. **Architecture:** the three uses of ConTree branching in
   [README.md:24](../../README.md?plain=1#L24), then the source tour below.
2. **Evidence:** the exact-release
   [v0.2.0 evidence index:9](../demo/sutura-v0.2.0-phase-0-evidence.md?plain=1#L9),
   including failed gates and complete denominators.
3. **Product experience:** the fixed case catalog in
   [packages/case-lab/src/cases.ts:1](../../packages/case-lab/src/cases.ts#L1)
   and [result provenance rules:3](../../packages/case-lab/replay/README.md?plain=1#L3).
4. **Limitations:** the evidence-status table below, before interpreting any
   result as proof of general repair reliability.

## Connecting the Case Lab to source evidence

This inspection route follows the source at the reviewed snapshot. It is not a
report of a freshly tested deployment. Start with a result's mode and original
commit, then inspect its outcome and evidence. A scenario's expected outcome is
not a measured result: the catalog records them separately from result data.
[Case contract:30](../../packages/case-lab/src/cases.ts#L30).

| Question | Where to look in a Case Lab result | Source reference |
| --- | --- | --- |
| Is this live, replayed, or recorded evidence? | The mode badge and explanation at the top; then the failed commit and CI evidence | `renderHeader` and `renderEvidence`, [render.ts:164](../../packages/case-lab/src/render.ts#L164) |
| What exploration happened? | ConTree search tree and branch status; an empty search is explicitly reported | `renderSearch`, [render.ts:212](../../packages/case-lab/src/render.ts#L212) |
| Why was a candidate rejected? | Rejected patches and rejection reasons, including failed audit checks when present | `renderRejections`, [render.ts:250](../../packages/case-lab/src/render.ts#L250) |
| Was there an independent audit? | Clean audit branch and Ultra verdict; the view explicitly says when no candidate reached it | `renderAudit`, [render.ts:271](../../packages/case-lab/src/render.ts#L271) |
| What do alternative patches demonstrate? | Accepted patch beside rejected alternatives, only when counterfactual evidence is attached | `renderCounterfactual`, [render.ts:120](../../packages/case-lab/src/render.ts#L120) |

This route also makes the product understandable when a run stops early. An
absent audit or unopened search branch is evidence about that run's path, not
proof that the feature is absent from Sutura.

## Architecture and non-obvious implementation choices

The main flow is failure evidence → Nano diagnosis → optional Tavily grounding →
prepared ConTree snapshot → independent reproductions → bounded Super repairs →
candidate checks and clean audit → repair PR or terminal report. The architecture
diagram and service roles are in
[docs/devpost/sutura-submission.md:55](../devpost/sutura-submission.md?plain=1#L55).

### ConTree serves three different verification needs

Sutura prepares dependencies before overlaying repository source, then branches
for independent triage reproductions, adaptive repair search, and clean audit.
This makes sandbox snapshots part of the verification design. Search defaults to
four initial branches, a beam of two, depth four, and twelve total branches; those
bounds do not establish an optimal repair. See
[heal.ts:476](../../packages/core/src/heal.ts#L476),
[search.ts:7](../../packages/core/src/engine/search.ts#L7), and
[search.ts:92](../../packages/core/src/engine/search.ts#L92).
Regression coverage includes deterministic lineage and beam selection in
[search.test.ts:24](../../packages/core/src/engine/search.test.ts#L24).

### Model proposals and execution authority are separate

Super proposes bounded edits to a controller-selected source excerpt. The
controller owns path selection, patch application, trusted test execution, and
submission. That is a concrete restriction on the repair agent's authority.
See the role description in
[docs/devpost/sutura-submission.md:79](../devpost/sutura-submission.md?plain=1#L79)
and edit construction in
[repair.ts:299](../../packages/core/src/engine/repair.ts#L299).
Budget reservations precede model work:
[repair-budget.ts:113](../../packages/core/src/engine/repair-budget.ts#L113),
with reservation and lower-only-limit tests in
[repair-budget.test.ts:25](../../packages/core/src/engine/repair-budget.test.ts#L25).

### A green result can still be refused

The audit checks the diff mechanically, requires the candidate to have passed,
reruns the suite, and then requests semantic adjudication. A failed rerun prevents
the later model call. This makes approval a sequence of checks with recorded
reasons, rather than a synonym for exit code zero. See
[audit.ts:53](../../packages/core/src/audit/audit.ts#L53),
[honest-approval test:91](../../packages/core/src/audit/audit.test.ts#L91),
[wrong-cause refusal test:180](../../packages/core/src/audit/audit.test.ts#L180), and
[failed-rerun test:196](../../packages/core/src/audit/audit.test.ts#L196).

**Evidence card — a failed rerun prevents a later model verdict**

| Field | Evidence |
| --- | --- |
| Claim | `audit` returns a refusal when the fresh suite rerun fails, before calling adjudication. |
| Product value | A maintainer does not receive an approved repair based on an earlier green result when the rerun has already failed. The later model call is also avoided. |
| Criterion | Technological Implementation |
| Implementation | `audit`, [audit.ts:95](../../packages/core/src/audit/audit.ts#L95) |
| Verification | The test asserts refusal, preserved failure output, and no model call: [audit.test.ts:196](../../packages/core/src/audit/audit.test.ts#L196). |
| Mode and revision | Source and test inspected at `974612b7ece1b7386b8c71d136b3a3ecda860ab1`; this test uses controlled executor and model responses. |
| Limit | This inspection did not execute the test. It establishes a regression test for controller ordering, not measured live-model judgment quality. |

The counterfactual evaluator makes this distinction inspectable by evaluating
alternative patches and recording the rejecting gate and added cost. A valid
alternative can also pass; rejection is not predetermined. See
[evaluate.ts:175](../../packages/core/src/counterfactual/evaluate.ts#L175) and
[valid-alternative test:298](../../packages/core/src/counterfactual/evaluate.test.ts#L298).
The committed offline experiment covers only a subset of production gates;
its scope is detailed below.

### Flake diagnosis records its uncertainty

Triage uses bounded repeated executions and a versioned confidence calculation,
with reproduction counts, intervals, and a stop reason. Mixed outcomes continue
to the configured limit. See
[triage.ts:25](../../packages/core/src/engine/triage.ts#L25),
[flake-confidence.ts:40](../../packages/core/src/engine/flake-confidence.ts#L40), and
[mixed-evidence test:39](../../packages/core/src/engine/flake-confidence.test.ts#L39).
Finite samples cannot prove a test never flakes.

## Hackathon criteria and evidence

The official rubric uses these four criteria with equal weighting. The table
maps review questions to evidence; it does not assign official scores.
[Official judging criteria](https://nebiusglobalaihackathon.devpost.com/rules).

| Criterion | What to inspect | Evidence and qualification |
| --- | --- | --- |
| Technological Implementation | Provider calls, bounded repair control, sandbox trust stages, audit behavior | Source and regression links above; [Token Factory contract:25](../../packages/core/src/llm/token-factory.ts#L25). Source existence and historical successful runs do not imply all release gates passed. |
| Design | Coherent path from case selection to explained outcome and evidence | [Case catalog:1](../../packages/case-lab/src/cases.ts#L1), [replay provenance:3](../../packages/case-lab/replay/README.md?plain=1#L3), [README demo status:17](../../README.md?plain=1#L17). Refusal and no-patch outcomes are intentional parts of the experience; live dispatch remains gated in this snapshot. |
| Potential Impact | Specific maintainer problem, useful repairs, safe refusals, external adoption | [Audience:23](../devpost/sutura-submission.md?plain=1#L23), [dogfood record:28](../demo/sutura-v0.2.0-phase-0-evidence.md?plain=1#L28), [scoring contract:202](../../packages/placebo/README.md?plain=1#L202). Dogfooding and seeded benchmarks do not establish broad adoption or measured time savings. |
| Quality of the Idea | Why verification adds value beyond making CI green | [Counterfactual evaluator:175](../../packages/core/src/counterfactual/evaluate.ts#L175), [offline findings:176](../plans/2026-09-04-sutura-counterfactual-arena.md?plain=1#L176). The alternative that passes visible tests but fails hidden verification is retained. Competitive superiority has not been established by the control artifacts. |

## NVIDIA, Nebius, and Tavily: actual roles

The entry requirement includes runtime Nebius usage and an NVIDIA open model.
It does not require every available sponsor product. The overview also asks
entrants to explain their integration choices.
[Hackathon requirements](https://nebiusglobalaihackathon.devpost.com/).

| Service or tool | Implemented use | Where to verify and how to qualify it |
| --- | --- | --- |
| NVIDIA Nemotron / Nebius Token Factory | Diagnosis, constrained repair proposals, and independent audit use separate roles through the provider client. | [Configured model IDs:10](../../packages/core/src/config.ts#L10), [provider factory:25](../../packages/core/src/llm/token-factory.ts#L25), [endpoint/model tests:25](../../packages/core/src/llm/token-factory.test.ts#L25). Requested role and actual provider model ID must stay distinct. |
| Nebius ConTree | Dependency preparation, snapshots, independent reproduction, repair branching, and audit execution. | [snapshot implementation:170](../../packages/core/src/executor/contree.ts#L170), [manifest-only preparation test:827](../../packages/core/src/executor/contree.test.ts#L827). Restricted dependency forms and runtime-image availability affect support. |
| Tavily | Search and extraction for dependency-release grounding, including repository ownership validation. | [Search:149](../../packages/core/src/diagnose/tavily.ts#L149), [Extract:228](../../packages/core/src/diagnose/tavily.ts#L228), [release-citation construction:542](../../packages/core/src/diagnose/tavily.ts#L542). Historical ablations differ by version; the v0.2 live run fixed 0/4 upstream cases in both arms. |
| Nebius Data Lab | Prepared sanitized dataset and an explicit upload/batch workflow. | [Data Lab evidence:3](../datalab/README.md?plain=1#L3). The prepared request is not evidence that upload or batch inference completed. |
| NVIDIA ATIF / NeMo Agent Toolkit | Sanitized trajectory export and offline trajectory-type validation. | [integration distinctions:84](../devpost/sutura-submission.md?plain=1#L84), [committed trajectory:1](../demo/sutura-trajectory-v1.atif.json#L1). NeMo is a validation dependency here, not the live repair orchestrator. |

## Evidence status and limitations

Different evidence types answer different questions. Tests document expected
behavior under their fixtures; live results describe a measured run; control
artifacts test the harness; replays reproduce recorded boundaries. None should
silently stand in for the others.

| Evidence | Observed scope | Interpretation |
| --- | --- | --- |
| Live Placebo v0.2 | Exact historical subject `a943ded4c734aed75c5c63f2b2dd63a2f44556c2`; 51 cases, 55 evaluations; 15/19 traps refused, 10/18 repairable cases fixed, 9/10 flaky classifications, zero false approvals | Completed **failed baseline**, not passing validation of this guide's source snapshot. [README.md:91](../../README.md?plain=1#L91), [evidence index:25](../demo/sutura-v0.2.0-phase-0-evidence.md?plain=1#L25). |
| Historical external matrices | Candidate 6/8 and public 5/8, both with zero false approvals | Incomplete readiness; exact failure reasons remain available. [Evidence index:37](../demo/sutura-v0.2.0-phase-0-evidence.md?plain=1#L37). |
| Offline counterfactual experiment | Five cases, fifteen alternatives; fourteen alternatives rejected and ten of ten declared shortcuts rejected | Limited to deterministic gates. One alternative passes the visible suite and fails hidden verification without deterministic rejection. [Measured account:176](../plans/2026-09-04-sutura-counterfactual-arena.md?plain=1#L176). |
| Counterfactual gate coverage | Offline harness excludes a second-image suite rerun, provider adjudication, and fixture-absent repository policy commands | The offline result does not demonstrate the complete live audit path. [Harness scope:48](../../packages/placebo/src/counterfactual.ts#L48). |
| Arena | Scripted dummy/refuse-all control artifacts exercise scoring and comparison wiring | Not a measured Sutura benchmark or a comparative win. [Control explanation:204](../plans/2026-09-04-sutura-counterfactual-arena.md?plain=1#L204). |
| Case Lab | Deterministic bundles, or recorded live results when a bundle is absent; pinned historical Action identity | Evidence mode and original subject matter. [Provenance:3](../../packages/case-lab/replay/README.md?plain=1#L3), [release identity:1](../../packages/case-lab/release.json#L1). |

Zero observed false approvals does not mean all traps were successfully detected
and refused: unsuccessful and infrastructure outcomes remain in the denominator.
The scoring contract also prevents a refuse-everything strategy from appearing
to be a useful repair tool: it has zero successful repairs.
[packages/placebo/README.md:202](../../packages/placebo/README.md?plain=1#L202).

Python execution in the historical v0.2.0 baseline stopped because its pinned
image was unavailable. Python source support and later remediation must not be
mistaken for a passing measurement of that release.
[Evidence index:39](../demo/sutura-v0.2.0-phase-0-evidence.md?plain=1#L39).

## Reproducing the review

For read-only evaluation, follow the source and artifact links above. The
committed evidence is inspectable without provider credentials. Source setup
and the project's verification commands are documented in
[README.md:227](../../README.md?plain=1#L227) and
[package.json:17](../../package.json#L17).

After contributor setup, the existing local checks are `pnpm run typecheck`,
`pnpm run lint`, `pnpm run test`, and `pnpm run build`, run sequentially.
Submission copy has a focused check:

```bash
node --test scripts/submission-contract.test.mjs
```

This research did not rerun the product suite or measure provider behavior.
The focused documentation test checks submission structure and links; it is
not evidence of repair quality. Live workflows and deployments have separate
cost and authorization controls documented in
[README.md:283](../../README.md?plain=1#L283).

## Submission completeness is a separate question

A source review can establish that these mechanisms exist. Submission acceptance
also depends on the actual demo, video, release, feedback, and required evidence
records. Consult the
[release evidence requirements:4](../demo/sutura-v0.2.1-release-evidence-requirements.json#L4)
and [submission source:7](../devpost/sutura-submission.md?plain=1#L7) for those artifacts.
This draft does not claim that the final submission is complete.
