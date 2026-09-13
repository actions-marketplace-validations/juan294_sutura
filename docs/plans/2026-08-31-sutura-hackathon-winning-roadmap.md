# Sutura hackathon winning roadmap

Date: 2026-08-31

Status: Historical delivery record; September 5 execution rebaseline below

Owner: Juan

Integration branch: `develop`

Release branch: `main`

Submission deadline: 2026-10-30 at 10:00 PDT

Planned submission date: 2026-10-29

Current phase: Known local implementation complete as of September 8; paid measurements, independent human review, publication, participant studies and submission/judging evidence remain open. See the [September 5 verified repair program](2026-09-05-sutura-verified-repair-program.md#local-completion--september-8-2026) for exact verification and remaining gates.

Detailed plan: [Verified repair program and fourteen phase files](2026-09-05-sutura-verified-repair-program.md).

Next action: Implement the new plan's baseline/pagination/contracts phase in an isolated worktree. The earlier September candidate freeze and G3 next-action text are superseded. Preserve their historical results and authorization records; they do not authorize new paid jobs. Final feature freeze remains targeted for October 21 and submission for October 29.

GitHub tracking: Issues [#47](https://github.com/juan294/sutura/issues/47) through [#127](https://github.com/juan294/sutura/issues/127) mirror every remaining unchecked roadmap item as of 2026-09-04. Parallel execution is divided into four labeled workstreams in `docs/plans/2026-09-04-sutura-issue-workstreams.md`.

## Purpose

This document preserves the August/early-September delivery history and standing release obligations. The [September 5 verified repair program](2026-09-05-sutura-verified-repair-program.md) is the current implementation source of truth after approval of the full product-audit recommendations. Below, phase numbers, dated statuses and next actions describe the earlier roadmap unless expressly reconciled with that plan.

The roadmap does not replace the technical decisions in `docs/plans/2026-08-28-sutura-hackathon-improvement.md`. That plan records the completed v0.2 implementation. This roadmap replaces its old delivery calendar and governs the work from the published v0.2.0 release through the final hackathon submission.

The roadmap also resolves one important status difference:

- The eleven implementation phases are complete.
- The hackathon evidence and judge experience are not complete.
- A published release is not the same as a submission-ready product.

## Winning thesis

AI agents can make CI green. Sutura proves whether they fixed the problem.

Sutura must show this claim through one complete, visible product experience:

1. Reproduce an exact CI failure.
2. Separate real failures from flakes and upstream incidents.
3. Explore repairs through bounded Nemotron structured proposals and ConTree branches.
4. Reject deceptive patches that only weaken enforcement.
5. Audit the surviving patch on a clean branch.
6. Publish evidence for human review without automatic merge.

The submission must make this process clear within 30 seconds and prove it within three minutes.

## Official judging target

The [hackathon overview](https://nebiusglobalaihackathon.devpost.com/) gives equal emphasis to four judging areas. It requires a working demo, public repository, public video of no more than three minutes, project description, and product feedback. The [official rules](https://nebiusglobalaihackathon.devpost.com/rules) set the deadline and require runtime use of Nebius Token Factory or Nebius AI Cloud with an NVIDIA open model.

| Judging area | Current assessment | Submission target | Required proof |
| --- | ---: | ---: | --- |
| Technological Implementation | 9/10 | 10/10 | Live v0.2 benchmark, ConTree search, Nemotron roles, Data Lab experiment, exact public evidence |
| Quality of the Idea | 9/10 | 10/10 | Counterfactual proof that distinguishes a real repair from a merely green patch |
| Potential Impact | 7/10 | 9/10 | Independent installs, unfamiliar repositories, external feedback, public benchmark comparison |
| Design | 5-6/10 | 9/10 | Public self-service Case Lab, coherent result view, deterministic replay, concise video |

These are historical internal estimates from the August roadmap, not current measured scores or official judging predictions. The September 5 audit and implementation plan replace score-based confidence with criterion-linked acceptance evidence.

## Baseline on 2026-08-31

### Shipped

- [x] Sutura v0.2.0 is published on npm.
- [x] GitHub release `v0.2.0` points to `a943ded4c734aed75c5c63f2b2dd63a2f44556c2`.
- [x] `develop` contains the released work at `ac9e678bd718f4ee7df9402fb2e22e587a843b29`.
- [x] JavaScript, TypeScript, and Python repair paths exist.
- [x] Bounded Nemotron structured repair proposals exist.
- [x] Adaptive ConTree beam search exists.
- [x] Network-disabled untrusted stages and repository policy exist.
- [x] Progressive flake classification, GitHub Checks, audit-only mode, ATIF export, and local evaluation records exist.
- [x] Ten consecutive live dogfood repairs completed with independent full CI at Action commit `a99e23199a80ae6ee51fe1680afb74188416160c`.

### Not yet accepted as hackathon evidence

- [ ] Complete live Placebo v0.2 benchmark.
- [ ] Candidate eight-case external matrix.
- [ ] Public eight-case external matrix.
- [x] Dogfood executable-equivalence proof between `a99e23199a80ae6ee51fe1680afb74188416160c` and the v0.2.0 release commit.
- [x] Current public demo that a signed-out non-collaborator can use.
- [ ] Demo pinned to the exact submitted release.
- [ ] Real sanitized Data Lab import and batch experiment.
- [ ] Public Sutura Arena comparison.
- [ ] External installation and usability evidence from at least three developers.
- [ ] Marketplace evidence.
- [ ] Final Nebius and NVIDIA feedback report.
- [ ] Devpost description, images, and public video.
- [ ] One complete public evidence index bound to the submitted release.

### Existing evidence contract

`docs/demo/sutura-v0.2.0-release-evidence-requirements.json` requires these records:

1. `benchmark`
2. `candidate-matrix`
3. `demo`
4. `dogfood`
5. `devpost`
6. `feedback`
7. `github-release`
8. `local-gate`
9. `marketplace`
10. `npm`
11. `public-matrix`

The manifest is a tracking and consistency check. It does not replace direct product evidence. A record can become `passed` only when its underlying public run, artifact, hash, or acceptance report exists.

## Strategy rules

1. Visible proof has priority over additional hidden architecture.
2. Zero false approvals remains a hard release gate.
3. Failed cases remain in every benchmark denominator.
4. A live result must bind to an exact 40-character commit and public artifact.
5. A replay can protect the demo from provider delays, but it must be labeled as a replay.
6. The public demo accepts only fixed allowlisted cases. It never accepts arbitrary repositories, commands, branches, patches, or free text.
7. Repository source and logs stay local unless an explicit sanitized export is authorized.
8. Data Lab use is opt-in, redacted, versioned, and reproducible.
9. New algorithms enter the product only after a controlled comparison.
10. Sutura never automatically merges a generated repair.
11. Each completed implementation is merged into local `develop`, verified at the integrated commit, and followed by removal of its task worktree and local task branch.
12. Push, release, deployment, live spending, public demo enablement, Data Lab upload, and Devpost submission remain separate authorization gates.

## Roadmap at a glance

| Phase | Dates | Outcome | Dependency | Status |
| ---: | --- | --- | --- | --- |
| 0 | Sep 1-5 | Complete and reconcile v0.2 evidence | None | Blocked: G2 denominator complete with zero false approvals but five quality gates failed; G3 candidate matrix separately gated |
| 1 | Sep 6-14 | Public Sutura Case Lab | Phase 0 evidence model | Implementation merged; public deployment gated |
| 2 | Sep 15-21 | Counterfactual patch proof | Case Lab result model | Implementation and offline evidence merged; live evidence gated |
| 3 | Sep 22-Oct 5 | Sutura Arena and Data Lab experiment | Phases 0 and 2 | Implementation and control artifacts merged; live evidence gated |
| 4 | Oct 6-12 | External adoption and product hardening | Public Case Lab | Not started |
| 5 | Oct 13-20 | Submission story and judge assets | Phases 1-4 | Active: qualitative source complete; measured evidence blocked |
| 6 | Oct 21-24 | Feature freeze and final release candidate | All product phases | Active: exact local CI, install contracts, and G4 canaries complete |
| 7 | Oct 25-29 | Public acceptance and submission | Final public release | Not started |
| Buffer | Oct 30 | Emergency submission correction only | Submission created | Reserved |

The dates are exit dates, not start promises. If a phase slips, reduce stretch scope before reducing evidence quality or the final buffer.

## Phase 0 - Close the v0.2 evidence gap

Dates: 2026-09-01 to 2026-09-05

Objective: Establish one honest current baseline before adding new product claims.

### Work

- [x] Audit the eleven required evidence records against current public state.
- [x] Bind valid npm, GitHub release, dogfood, local gate, and release records to exact commits and URLs.
- [x] Prove dogfood Action executable and metadata equivalence without repeating the ten-run streak.
- [x] Add resumable, content-hashed controllers before provider spending.
- [x] Run all 51 live Placebo v0.2 cases and retain all 55 evaluations.
- [x] Report JavaScript, TypeScript, and Python results separately and together.
- [x] Retain all repair failures, refusals, flakes, upstream outcomes, costs, latency, and sandbox operations.
- [x] Run all eight candidate external matrix cases with real sandbox operation identifiers where required.
- [x] Run all eight public external matrix cases against public artifacts.
- [x] Verify the provider contract and observe the ConTree Python image contract failure.
- [x] Update README claims from v0.1 to the measured v0.2 baseline.
- [x] Create the v0.2.1 patch-release plan without rewriting v0.2.0 evidence.

Phase 0 remains blocked because the benchmark hidden-test gate failed, the
candidate matrix passed 6/8, and the public matrix passed 5/8. All three had
zero false approvals. The exact failed baseline is indexed in
`docs/demo/sutura-v0.2.0-phase-0-evidence.md`.

### Exit gate

- The live benchmark has a versioned manifest, exact release identity, result hash, complete denominator, cost, latency, and public-safe report.
- Both eight-case matrices are complete with zero false approvals.
- Phase 0-owned records have an explicit terminal result. Later `demo`, `devpost`, `feedback`, and `marketplace` records remain `pending` with their owning roadmap phase and next action.
- README claims match the measured result.

### Evidence destinations

- `docs/demo/`
- `docs/agents/` for operational reports when repository policy permits
- GitHub Actions runs and artifacts bound to the exact candidate

## Phase 1 - Build the public Sutura Case Lab

Dates: 2026-09-06 to 2026-09-14

Objective: Let any judge understand and experience Sutura without GitHub collaborator access.

### Product experience

The Case Lab offers five fixed public scenarios:

1. JavaScript repair.
2. Python repair.
3. Deterministic flaky failure.
4. Greenwash trap.
5. Upstream dependency incident.

For each scenario, the result view shows:

- Exact failed commit and CI evidence.
- Nano diagnosis and confidence.
- ConTree search tree and branch status.
- Super proposals and candidate patches.
- Rejected patches and rejection reasons.
- Clean audit branch and Ultra verdict.
- Final outcome: `fixed`, `flaky-no-patch`, `refused`, `gave-up`, or `infra-stop`.
- Token cost, provider cost, latency, CPU, memory, I/O, and sandbox operations.
- Links to the GitHub run, pull request or refusal report, evidence bundle, and ATIF trajectory.

### Safety and reliability

- [x] Accept only server-defined case identifiers.
- [x] Reject arbitrary repository names, refs, commands, patches, and free text.
- [x] Apply request throttling, concurrency limits, a daily spend stop, and an emergency disable control.
- [x] Use a protected service identity with minimum GitHub permissions.
- [x] Keep provider secrets outside ConTree.
- [x] Provide a deterministic replay for every case.
- [x] Clearly label live runs and replayed runs.
- [x] Return stable result URLs that survive a page refresh.
- [x] Make the main result readable on desktop and mobile.
- [x] Remove the old instruction that asks visitors to run a collaborator-only `workflow_dispatch` action.

### Nebius deployment decision

Evaluate Nebius Serverless Jobs and Serverless Endpoints for the public control plane before implementation. Use them only if the current service contracts support the required asynchronous execution, secret isolation, request limits, and stable result URLs. The Token Factory and ConTree repair path remains the required runtime core.

### Exit gate

- A signed-out non-collaborator selects each allowlisted case and receives a stable result. (Built and locally accepted; public enablement is Gate A in `docs/plans/2026-09-04-sutura-case-lab.md`.)
- At least one live repair and one refusal complete through the public path. (Gate B in the same plan.)
- Every case has a tested replay fallback. (Done: `packages/case-lab`, five recorded results validated in CI.)
- The demo is pinned to the exact current public Sutura release. (Done: `packages/case-lab/release.json` names v0.2.0; `case-lab verify-pin` proves the demo workflow and tag agree.)
- Security tests prove that arbitrary input and unauthorized repository access fail closed. (Done: `packages/case-lab/src/request.test.ts`, `dispatcher.test.ts`, `demo-workflow.test.ts`.)

## Phase 2 - Add counterfactual patch proof

Dates: 2026-09-15 to 2026-09-21

Objective: Make Sutura's unique verification value visible and measurable.

### Work

- [x] For selected cases, create two or three plausible alternative patches from the same ConTree checkpoint.
- [x] Include at least one shortcut that weakens a test, type check, lint rule, or error path.
- [x] Run every candidate through the same declared mechanical and model-audit gates.
- [x] Record the exact rule, hidden test, policy, or audit finding that rejects each deceptive patch.
- [x] Show the accepted patch and rejected alternatives side by side in the Case Lab.
- [x] Add counterfactual results to the evidence and ATIF formats without duplicating source data.
- [x] Measure additional cost, latency, and sandbox operations.

Status (WS-2): all seven items are complete with committed offline evidence in
`docs/demo/sutura-counterfactual-v0.2.json` (5 cases, 15 alternatives, 10 of 10
declared shortcuts rejected, 0 observed gates differing from their declaration,
USD 0 inference), and the Case Lab renders the accepted patch beside the
rejected alternatives with each rejecting gate and rule.

The exit gate below is met on the offline evidence except for one line: zero
false approvals across Placebo v0.2 is preserved by construction (the feature
is opt-in, changes no gate, and is asserted not to change any production
outcome) but has not been re-confirmed by a live run on the exact candidate.
That confirmation is authorization gate G1 in
`docs/plans/2026-09-04-sutura-counterfactual-arena.md`.

### Exit gate

- At least four representative cases show one accepted or correctly refused outcome beside rejected alternatives.
- Every deceptive alternative is rejected.
- The feature preserves zero false approvals across Placebo v0.2.
- The Case Lab explains why “green” is not sufficient without requiring the judge to inspect raw logs.

## Phase 3 - Build Sutura Arena and use Data Lab

Dates: 2026-09-22 to 2026-10-05

Objective: Prove the architecture at useful scale and use Nebius evaluation services in the real improvement loop.

### Benchmark design

- [ ] Select a stratified set of 100 public software-engineering cases from available SWE-bench and SWE-rebench environments.
- [ ] Record language, failure class, repository, difficulty, and inclusion reason.
- [ ] Compare Sutura with a single-branch repair baseline.
- [ ] Compare full Sutura verification with a “first green patch wins” baseline.
- [ ] Compare current beam search with fixed parallel search.
- [x] Preserve identical case selection, limits, provider models, and scoring across comparisons.
- [ ] Expand toward 200 cases only after the 100-case run is complete, affordable, and statistically useful.

Status (WS-2): the comparison harness, the three baseline arms, the
stratification and selection manifest, the Arena page, and the expansion gate
are implemented and validated offline against the committed corpus
(`docs/demo/sutura-arena-controls-v0.2.json`,
`packages/placebo/arena/selection-placebo-v0.2.json`). The remaining items need
data, not code: the SWE environment catalog read (gate G3) and the 100-case
paid comparison run (gate G2), both recorded in
`docs/plans/2026-09-04-sutura-counterfactual-arena.md`.

### Data Lab integration

- [x] Define and test the redaction boundary before any upload.
- [ ] Upload only sanitized, public-safe evaluation records after explicit authorization.
- [ ] Record Data Lab dataset identifiers, versions, input hashes, and output hashes.
- [ ] Use batch inference for at least one model, router, or prompt comparison.
- [ ] Publish the winning and losing configurations with cost, latency, and quality results.
- [x] Document Zero Data Retention behavior and what the explicit dataset import changes.

### Public Arena view

Show:

- Repair success rate.
- False approval count and rate.
- Flake and upstream classification accuracy where applicable.
- Median and tail latency.
- Provider and sandbox cost.
- Token and sandbox operation counts.
- Resource use.
- Results by language and failure class.
- Complete failures and refusal reasons.

### Exit gate

- The 100-case comparison is reproducible from a versioned manifest.
- No failed case is removed from the denominator.
- Sutura improves at least one primary measure over the single-branch baseline without weakening zero-false-approval or security gates.
- One real Data Lab batch experiment has public-safe evidence and exact hashes.
- The Arena has a concise public result page and a downloadable machine-readable report.

## Phase 4 - External adoption and product hardening

Dates: 2026-10-06 to 2026-10-12

Objective: Prove that Sutura solves a real developer problem outside its own repository.

### Work

- [ ] Recruit at least three developers who did not build Sutura.
- [ ] Test installation in at least three unfamiliar repositories.
- [ ] Include JavaScript or TypeScript and Python.
- [ ] Install only from public npm and immutable Action artifacts.
- [ ] Measure time to first valid result, setup failures, unclear instructions, and manual interventions.
- [ ] Run one repair, one refusal, and one flake classification through the external path.
- [ ] Correct every release-blocking installation, documentation, permission, and result-clarity defect.
- [ ] Collect short, attributable feedback only with participant permission.
- [ ] Complete the Marketplace listing and verify installation from it.
- [x] Update the provider privacy, retention, and threat-model documentation.

### Exit gate

- Three external installation records exist.
- A new user can reach a useful result without repository-owner coaching.
- The public setup guide matches the released package and Action.
- Marketplace installation and immutable pinning work.
- The impact claim uses observed user evidence, not only internal opinion.

## Phase 5 - Build the submission story and judge assets

Dates: 2026-10-13 to 2026-10-20

Objective: Convert the verified product into a complete, coherent submission.

### Devpost package

- [x] Project title and one-sentence value statement.
- [x] Problem, audience, and why existing “fix CI” tools are insufficient.
- [x] Product workflow with one clear architecture diagram.
- [x] Direct explanation of Nano, Super, Ultra, Token Factory, ConTree, Data Lab, and NVIDIA ATIF or NeMo use.
- [ ] Measured Placebo, dogfood, Arena, cost, and external-user results.
- [x] Significant work completed after the submission period started.
- [x] Nebius and NVIDIA product feedback.
- [ ] Public repository, working demo, release, Marketplace, benchmark, and evidence links.

### Video plan

The public YouTube video must be shorter than three minutes.

| Time | Content |
| --- | --- |
| 0:00-0:20 | Problem: a green CI result can still be a fake repair |
| 0:20-1:20 | One live or deterministic Case Lab repair from failure through verified pull request |
| 1:20-1:55 | Counterfactual greenwash patch rejected beside the accepted patch |
| 1:55-2:25 | Nebius architecture: Nemotron routing, ConTree branching, Data Lab evaluation |
| 2:25-2:45 | Placebo, dogfood, Arena, cost, and external-user results |
| 2:45-2:55 | Human review, no automatic merge, final call to action |

### Exit gate

- The complete Devpost draft exists with no unsupported claim.
- Every number links to public evidence.
- The video is public, under three minutes, audible, legible, and accurate.
- A signed-out reviewer can follow every link.
- The README, demo, video, release, and Devpost entry use the same product language and results.

## Phase 6 - Feature freeze and final release candidate

Dates: 2026-10-21 to 2026-10-24

Objective: Freeze one submission candidate and prove its complete local and public contract.

### Work

- [x] Stop new features no later than 2026-10-21; freeze began on 2026-09-04
  from integrated candidate base `096a48e7ffb5e95103ee91746644386bba1a0c12`.
- [x] Accept only security, release, evidence, and demo-blocking fixes after the
  freeze; each admitted fix replaces the candidate and resets its gates.
- [x] Run `pnpm run ci:local` sequentially on exact candidate
  `75a2810fb4586cd36238dedd630303799e706c7a` after admitted demo-blocking
  commit `622feea40f56b2455a5effd8daeee5acbd9730a1` reset the earlier pass.
- [ ] Run candidate installation and external matrix checks.
- [x] Run live provider and ConTree contract canaries under an authorized cap;
  workflow `33884265464` passed on
  `f8195e8a82ffe1527d755ae7ecb8a047484af9fa`.
- [x] Review code reuse, quality, and efficiency with the documented
  `codex-simplify` fallback; report in
  `docs/agents/ws4-candidate-simplify-review.md` found no blocking issue.
- [ ] Merge the approved candidate through the documented release path after separate authorization.
- [ ] Publish a patch or later release only when required by the verified candidate.
- [ ] Verify npm, Action tag, Marketplace listing, GitHub release, and public install from a clean environment.

### Exit gate

- One exact 40-character release commit supports the package, Action, demo, benchmark, Arena, and submission claims.
- Exact-commit CI is terminal and green.
- Public artifact installation and the public external matrix pass.
- The release evidence contract is complete.
- No task-owned worktree or branch remains.

## Phase 7 - Final public acceptance and submission

Dates: 2026-10-25 to 2026-10-29

Objective: Test the product as a judge and submit one day before the deadline.

### Acceptance matrix

- [ ] Signed-out desktop Case Lab repair.
- [ ] Signed-out mobile Case Lab repair or replay.
- [ ] Signed-out refusal and flaky result.
- [ ] Stable evidence and download links.
- [ ] Public npm install.
- [ ] Public Marketplace install.
- [ ] Public repository setup from a clean checkout.
- [ ] Public video playback with captions and correct links.
- [ ] Devpost preview with every required field.
- [ ] Written explanation of significant work completed during the submission period.
- [ ] Feedback section complete.
- [ ] Final backup of submission text, images, video link, evidence index, and release identity.

### Submission gate

Devpost submission is an outward-facing action and needs explicit authorization. After authorization:

1. Submit on 2026-10-29.
2. Open the public submission page while signed out.
3. Verify the demo, repository, video, and evidence links again.
4. Record the final submission URL and timestamp in this roadmap.
5. Make no product change unless a verified submission blocker requires it.

### Exit gate

- The public submission exists and is independently readable.
- All links work while signed out.
- The submitted product matches the video and text.
- The final identity, evidence, and timestamp are recorded.

## Stretch lane

Stretch work can start only when Phase 0 is accepted, the Case Lab is public, and the 100-case Arena is on schedule. Stretch work must stop if it threatens the October 21 freeze.

### Stretch A - Verified failure memory

- Store repository-owned, sanitized failure fingerprints and verified repairs.
- Use Token Factory embeddings and reranking for retrieval.
- Let retrieved cases guide search but never bypass current tests, policy, or audit.
- Compare repair rate, latency, and cost with memory enabled and disabled.

### Stretch B - Capacity-aware scheduling

- Use `Retry-After` and Token Factory rate-limit headers to schedule parallel work.
- Surface throttling and recovery in evidence.
- Compare avoidable retries, completion time, and failed operations.

### Stretch C - Search algorithm comparison

- Compare beam search with best-first search or Monte Carlo tree search only after the Arena baseline exists.
- Keep a new algorithm only if it improves a declared measure without increasing false approvals.

### Stretch D - Larger Arena

- Expand from 100 toward 200 cases after the first complete report.
- Do not expand by hiding expensive, slow, or failed cases.

## Work explicitly deferred until after submission

- Automatic merge.
- Generic chat interface.
- GitLab support.
- CircleCI support.
- Broad language expansion beyond current JavaScript, TypeScript, and Python support.
- Dedicated inference endpoints without measured capacity need.
- Model fine-tuning without a supported Nemotron path and a measured product reason.
- A general fleet dashboard that does not improve the judge experience.
- A general Docker fallback that weakens the verified ConTree product contract.

## Evidence register

Update this table only when the direct evidence exists. Link the evidence and record the exact commit or release identity in the Evidence field.

| Evidence | State | Required by | Evidence |
| --- | --- | --- | --- |
| v0.2 live benchmark | Failed | Phase 0 | Complete 51-case, 55-evaluation result in `docs/demo/placebo-v0.2-live-2026-09.json`; zero false approvals; required gates missed |
| Candidate external matrix | Failed | Phase 0 | v0.2.0: 6/8; repair-quality head `ce3502d`: 6/8, zero false approvals, `python-repair` now reproduces and gives up on admissibility, `repository-policy-refusal` still gave-up; `docs/demo/sutura-v0.2.1-candidate-matrix.json` |
| Public external matrix | Failed | Phase 0 and Phase 6 | 5/8, zero false approvals; `docs/demo/sutura-v0.2.0-public-matrix.json` |
| Dogfood streak | Passed | Phase 0 | Ten consecutive fixed attempts; executable equivalence recorded in `docs/demo/dogfood-v0.2.0-executable-equivalence.md` |
| npm v0.2.0 | Passed | Baseline | `sutura@0.2.0` |
| GitHub release v0.2.0 | Passed | Baseline | Release commit `a943ded4c734aed75c5c63f2b2dd63a2f44556c2` |
| Case Lab | Live | Phase 1 | Public at <https://sutura-case-lab.vercel.app>; five recorded results plus live dispatch behind a fine-grained token; two live results published on 2026-09-05 (`javascript-repair` fixed, `greenwash-trap` fixed with the test guard); #50 closed; `docs/plans/2026-09-04-sutura-case-lab-notes.md` |
| Counterfactual proof | Not started | Phase 2 | No public comparison recorded |
| 100-case Arena | Not started | Phase 3 | No manifest recorded |
| Data Lab batch experiment | Not started | Phase 3 | Local export only; upload disabled |
| External installs | Not started | Phase 4 | Three accepted records required |
| Marketplace evidence | Not started | Phase 4 and Phase 6 | No accepted current record |
| Nebius feedback | Active | Phase 5 | Qualitative draft in `docs/feedback/2026-10-sutura-nebius-feedback.md`; final measured report remains gated |
| Public video | Not started | Phase 5 | Public YouTube URL required |
| Devpost submission | Active | Phase 7 | Qualitative source and video script in `docs/devpost/`; measured assembly and update remain gated |
| Final candidate | Active | Phase 6 | Feature-freeze record in `docs/demo/sutura-v0.2.1-candidate-freeze.md`; exact verified candidate `f8195e8a82ffe1527d755ae7ecb8a047484af9fa` contains WS-1, WS-2, WS-3, and WS-4 |
| Provider and ConTree canaries | Passed | Phase 0 and Phase 6 | Workflow `33884265464`; provider and runtime-image artifacts bound to `f8195e8a82ffe1527d755ae7ecb8a047484af9fa` in `docs/demo/` |
| v0.2.1 G1 targeted Tavily proof | Passed | Phase 0 | Workflow `33887916292`; Tavily `fixed`, no Tavily `gave-up`, zero false approvals, USD 0.24664956; exact-candidate artifact in `docs/demo/placebo-v0.2.1-g1-upstream-retry-release-f8195e8a82ffe1527d755ae7ecb8a047484af9fa.json` |
| v0.2.1 live benchmark | Failed | Phase 0 | Complete 51-case, 55-evaluation result on `f8195e8a82ffe1527d755ae7ecb8a047484af9fa`; zero false approvals; repair 9/18, flaky 9/10, Tavily 3/4, hidden preservation 0/4 with four `not-run`, deceptive rejection 10/11; `docs/demo/sutura-v0.2.1-phase-0-evidence.md` |
| Repair-quality rerun | Failed | Phase 0 | Complete 51-case, 55-evaluation result on `f5c3056acc96597f1ae11f411a3b9cfe03ba990f` under score contract v3; zero false approvals; repair 10/18, flaky 10/10, deceptive rejection 11/11, Tavily 2/4, hidden preservation 1/4 with three `not-run`; `docs/demo/sutura-v0.2.1-repair-quality-evidence.md` |
| Replay determinism | Partial | Phase 1 | Executor replay is order-independent for concurrent branches (develop `4268d51`); the remaining scheduling dependence of cancellations and capacity probes is #128 |

## Cost and authorization ledger

Do not place secrets in this document.

Before every live or paid operation, record these items in the active phase plan or operational report:

- Exact action and provider.
- Exact candidate commit.
- Maximum total spend.
- Reserved amount for validation and cleanup.
- Maximum run, branch, or operation count.
- Stop condition.
- User authorization message and date.

A cost estimate is not authorization. Stop before the cap, not after it. A retry after a failed publication, deployment, benchmark, or public demo run needs the authority defined by that workflow.

## Risk register

| Risk | Trigger | Response |
| --- | --- | --- |
| Demo provider delay | Live case exceeds the presentation window | Show deterministic replay with a clear label and link the eventual live result |
| Spend growth | Estimated remaining work approaches the authorized cap | Stop before reserve use and request a new decision with exact evidence |
| False approval | Any trap is accepted | Block the phase and release; diagnose before more breadth work |
| Benchmark selection bias | Cases are removed after execution | Keep the fixed manifest and full denominator; publish failures |
| Data exposure | Sanitization cannot prove that source or secrets are absent | Do not upload; retain local-only evaluation |
| Release identity drift | Demo, package, Action, benchmark, or video refers to different commits | Stop publication and create one replacement candidate |
| External access failure | Signed-out user cannot trigger or inspect a result | Block demo acceptance and use the replay only as temporary evidence |
| Schedule slip | Critical path extends past October 20 | Drop stretch work, reduce Arena expansion, preserve core evidence and final buffer |
| Nebius beta or API change | Provider contract or ConTree behavior changes | Run the exact canary, document the change, and use only verified supported behavior |

## Session and reboot protocol

At the start of every Sutura hackathon session:

1. Read this roadmap completely.
2. Read the active phase plan and its evidence files completely.
3. Run `git status --short --branch` and `git worktree list --porcelain`.
4. Confirm the current phase, next unchecked task, exact candidate, and authorization boundary.
5. Check public or provider state when it can change. Do not rely on an old session report for mutable facts.
6. Continue from existing evidence. Do not repeat a paid run merely because context was lost.

At the end of every session:

1. Update the current phase, checklist, evidence register, and next action in this roadmap.
2. Record exact commits, run URLs, artifact hashes, spend, and remaining blockers in the relevant evidence file.
3. Distinguish implementation complete, locally verified, remotely verified, publicly accepted, and submitted.
4. If the work is complete, merge it into local `develop` and verify the integrated commit.
5. Remove only the task-owned worktree and local task branch after integration.
6. Preserve unrelated dirty or untracked files.

## Phase acceptance rule

A phase is `Accepted` only when all of these statements are true:

- Its exit gate is complete.
- Required local verification passed.
- Required live or public evidence is terminal and linked.
- The implementation is on local `develop`.
- The exact integrated commit is recorded.
- The task worktree and local branch are removed.
- No required next action remains hidden in prose.

Use these phase states only:

- `Not started`: no accepted work has begun.
- `Active`: work is in progress and the next action is named.
- `Blocked`: a named external dependency or authorization prevents progress.
- `Accepted`: the complete exit gate has evidence.

## Final definition of done

Sutura's hackathon work is done only when:

- The product passes the exact public release gates with zero false approvals.
- The Case Lab works for a signed-out judge and has replay protection.
- Counterfactual proof shows why deceptive green patches fail.
- The Arena publishes a reproducible 100-case comparison.
- One real sanitized Data Lab batch experiment is complete.
- Three external developers have completed public installation tests.
- npm, Action, Marketplace, demo, benchmark, Arena, video, and Devpost claims refer to one exact release identity.
- The public video is under three minutes and accurately shows the product.
- The Devpost submission is public and all links work while signed out.
- The final work is integrated into `develop`.
- No task-owned worktree or local task branch remains.

Until every statement is true, the roadmap remains active.

## Product audit checkpoint — 2026-09-05

The [product and hackathon audit](../research/2026-09-05-sutura-product-hackathon-audit.md)
reviews source at `369c972777eea3c80b698db61165f07ba46e6b13`, today's evidence,
the official rules/resources, and the public Case Lab. The assessment is
complete; existing implementation and release phase states are unchanged.

The audit found a behavioral regression in the approved recorded pagination
repair, beyond the benchmark's displayed test coverage. Historical measurements
remain intact. Next planning work should prioritize that verification gap,
remaining repair failures, independent regression challenges, and maintainer
evidence, while reconciling this roadmap's older status text with dated reports.
The audit proposed focused sponsor-stack extensions and an operating period
through the December 15 judging deadline. No proposed feature or remote action
was implemented or authorized by this checkpoint.

## Approved implementation rebaseline — 2026-09-05

Juan approved all recommended scope and requested `/plan`. The [verified repair program](2026-09-05-sutura-verified-repair-program.md) carries fourteen phases: truthful baseline, diagnosis recovery, two-file repair, independent contract-backed probes, external verification, Data Lab/NeMo/Arena evaluation, adaptive routing, Case Lab UX, maintainer-study preparation, live measured evidence, pilot release, real trials/fixes, final submission, and judging access through December 15.

No feature implementation, push, deployment, participant outreach or paid run was performed by this planning task. Only phases 6 and 9 are batch eligible. Existing release obligations remain; pilot readiness, final submission readiness and fulfilled judging access are separate states. Consult the new plan for current dependencies and exact phase gates.

### September 8 cumulative spend follow-up

The local Placebo controller now accounts by paid-run manifest in the Git common
directory, independently of replaceable result ledgers. Reinitialization,
manifest/cap drift, concurrent dispatch and unresolved costs fail closed. The
[controller procedure](../demo/run-manifests/README.md#cumulative-controller-accounting)
records the recovery boundary and the remaining per-case billing limitation.
The new [Stage 3 request](../demo/run-manifests/development-validation-v2-readiness.md)
retains all 80 development/validation subjects. Authorization remains USD 0;
no paid run, publication or outreach was performed in this follow-up. The
held-out stage remains gated on reading Stage 3. Local implementation is not a
clean quality measurement or acceptance of the measurement phases.
