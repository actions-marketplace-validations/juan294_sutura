# Sutura hackathon improvement implementation plan

Date: 2026-08-28

Post-release roadmap: `docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md`

The implementation progress in this document records code completion. The post-release roadmap governs remaining benchmark, demo, external proof, submission, and final acceptance work.

Research source: `docs/research/2026-08-28-sutura-two-month-opportunity-research.md`

Target deadline: 2026-10-30 at 10:00 PT

Target release: v0.2.0

Integration branch: `develop`

Release branch: `main`

## Objective

Increase Sutura's repair quality, verification evidence, external usability, and Nebius integration before submission.

Preserve the current product contract:

- Sutura verifies repairs before publication.
- Sutura refuses unsafe shortcuts.
- Sutura reports flaky failures without a patch.
- Sutura opens pull requests for human review.
- Sutura never auto-merges.
- Each user supplies provider credentials.

## Baseline

The current release is v0.1.1 at commit `ff69e9673add77cb836d41f4ef8f18f1088167cb`.

Placebo v0.1 reports 6/10 repairable fixes and zero false approvals.

The measured evidence appears in `docs/demo/placebo-v0.1-2026-08-28.md:1-39`.

The current flow is linear:

```text
GitHub run
  -> exact checkout
  -> ConTree snapshot
  -> reproduction
  -> fixed-count triage
  -> one-shot candidate generation
  -> parallel candidate race
  -> deterministic and Ultra audit
  -> comment, artifact, and repair pull request
```

The control path appears in `packages/core/src/orchestrate.ts:384-493` and `packages/core/src/heal.ts:230-344`.

## Chosen design

Extend the current verification architecture through stable contracts and measured experiments.

Do not replace the core with a general agent framework.

The chosen system adds these layers:

```text
Security boundary
  -> Token Factory protocol layer
  -> repository policy and stage evidence
  -> bounded repair tools
  -> adaptive ConTree search
  -> evaluation and ATIF export
  -> model routing and progressive flake evidence
  -> GitHub review and reduced-assurance audit surfaces
  -> public benchmark, demo, and release evidence
```

### Rejected option: framework rewrite

A framework rewrite could provide tool orchestration and tracing faster.

It would replace tested safety boundaries and weaken Sutura's direct Nebius design.

### Rejected option: provider and language expansion first

Early provider expansion could increase reach.

It would leave the 6/10 repair rate and current security gaps unchanged.

### Rejected option: dashboard-first delivery

A dashboard could improve presentation.

It would not improve repair quality, public demo access, or private repository safety.

## Architecture decisions

### Sandbox preparation

The current archive places the complete repository into ConTree before dependency installation.

The current snapshot operation clears `/workspace` (`packages/core/src/executor/contree.ts:147-186`).

Implement a two-stage snapshot contract:

```text
dependency manifest archive
  -> network-enabled dependency installation
  -> complete repository overlay
  -> network-disabled reproduction and agent work
```

Do not claim source isolation while a network-enabled process can read the complete repository.

### Repair agent

Use Token Factory function calling through the existing `NebiusClient`.

Keep tool execution inside ConTree. Keep validation and budgets inside Sutura.

The initial tool set is fixed:

```text
read_file
search_repo
run_test
apply_patch
inspect_diff
submit_candidate
```

The ConTree snapshot excludes `.git` (`packages/core/src/executor/contree.ts:597-627`).

Create a sandbox-local Git baseline from exact overlay members before any repository command runs.

Initialize Git with hooks disabled. Test runs use disposable children and never change the editable repair image.

### Search

Use bounded beam search before considering more complex algorithms.

Each child image represents one agent state. Every expansion consumes an explicit budget.

The score combines test progress, policy compliance, diff size, resource changes, and provider cost.

### Evidence

Add one stage-oriented evidence structure to `CaseFile` (`packages/core/src/domain.ts:82-91`).

Use it for preparation, reproduction, triage, search, candidate verification, and audit.

Do not duplicate metrics inside unrelated verdict structures.

### Policy

Use `.sutura.json` with `version: 1`.

JSON keeps the action and CLI free from a new YAML parser.

The initial policy supports paths, diff limits, required commands, and resource thresholds.

Policy cannot enable networking or weaken built-in safety checks.

### Evaluation data

Keep evaluation records local by default.

Allow explicit sanitized export for Data Lab use.

Do not send repository code or logs to maintainer infrastructure.

### Audit-only mode

Keep reduced-assurance audit separate from verified healing.

Audit-only mode does not use ConTree, cannot report `fixed`, and never opens a pull request.

## Phase sequence

| Phase | Name | Dependencies | Batch status |
| ---: | --- | --- | --- |
| 1 | Secure sandbox and privacy boundary | None | `[batch-eligible]` with Phase 2 |
| 2 | Token Factory protocol foundation | None | `[batch-eligible]` with Phase 1 |
| 3 | Repository policy and stage evidence | Phases 1 and 2 | Sequential |
| 4 | Bounded tool-calling repair agent | Phase 3 | Sequential |
| 5 | Adaptive ConTree checkpoint search | Phase 4 | Sequential |
| 6 | Evaluation Lab records and ATIF export | Phase 5 | Sequential |
| 7 | Nemotron routing and progressive flake confidence | Phase 6 | Sequential |
| 8 | GitHub Checks and audit-only distribution | Phase 7 | `[batch-eligible]` with Phase 9 |
| 9 | Placebo v0.2 benchmark expansion | Phase 7 | `[batch-eligible]` with Phase 8 |
| 10 | Python project support | Phases 8 and 9 | Sequential |
| 11 | Public demo, external proof, feedback, and release readiness | Phase 10 | Sequential |

Detailed phase files:

- `docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-1.md`
- `docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-2.md`
- `docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-3.md`
- `docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-4.md`
- `docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-5.md`
- `docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-6.md`
- `docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-7.md`
- `docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-8.md`
- `docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-9.md`
- `docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-10.md`
- `docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-11.md`

## Delivery calendar

| Date | Planned result |
| --- | --- |
| 2026-09-04 | Phases 1 and 2 complete |
| 2026-09-11 | Phase 3 complete |
| 2026-09-18 | Phase 4 complete |
| 2026-09-25 | Phase 5 complete |
| 2026-10-02 | Phase 6 complete |
| 2026-10-09 | Phase 7 complete |
| 2026-10-16 | Phases 8 and 9 complete |
| 2026-10-21 | Phase 10 complete |
| 2026-10-23 | Phase 11 implementation freeze |
| 2026-10-29 | Release and submission evidence complete |

## Cross-phase implementation rules

Follow red, green, refactor for every behavior change.

Use recorded provider responses in normal tests. Keep live tests opt-in with `SUTURA_LIVE=1`.

Run local verification sequentially:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
pnpm run test:package
pnpm run test:readme
pnpm run verify:readme-setup
pnpm --filter placebo run smoke:offline
```

Rebuild `packages/action/dist/index.cjs` during every phase that changes action runtime behavior.

Use one implementation worktree or temporary branch per phase.

Preserve the untracked `docs/demo/thumbnail/` directory.

Continue through all implementation phases without phase approval stops.

Pause only at explicit authorization gates or genuine external blockers.

Do not push a phase until every local gate passes.

After Phases 1 and 2, merge both branches into one integration commit.

Run the complete local gate before Phase 3.

After Phases 8 and 9, merge both branches into one integration commit.

Run the complete local gate before Phase 10.

After an authorized push, monitor the exact remote commit until every applicable workflow reaches a terminal state.

## Experiment contract

Every intelligence change needs these artifacts:

- a fixed baseline commit
- a versioned evaluation manifest
- declared quality, cost, latency, and operation measures
- a complete result with failures retained
- an exact result hash

Keep an experiment only when it improves a primary measure without breaking a release gate.

Redaction covers every Sutura-owned external message, tool result, trace event, ATIF export, and evaluation record.

The public `NebiusClient` does not promise redaction for arbitrary caller content.

Primary measures:

- repair rate
- false approvals
- flake classification accuracy
- median end-to-end time
- inference cost
- sandbox operations
- sandbox cost
- external setup completion

## Release gates

- Placebo reports zero false approvals.
- Repairable fixes exceed the current 6/10 baseline.
- No repository source exists during network-enabled preparation.
- No repository lifecycle script executes while networking is enabled.
- Provider secrets never enter ConTree.
- Invalid repository policy stops before model or sandbox spending.
- The public demo works for a non-collaborator.
- A clean repository installs the exact public package and action.
- The package, action, demo, and benchmark use one release commit.
- Post-publication evidence binds to that commit through hashes and public run URLs.
- Every submission claim links to public evidence.

## Scope boundaries

This plan excludes automatic merge, GitLab support, CircleCI support, fleet dashboards, and dedicated endpoints.

This plan excludes Nemotron fine-tuning because Token Factory does not list Nemotron for post-training.

This plan excludes a general Docker fallback. Full verified repair remains ConTree-powered.

## Final automated acceptance

Run the complete local gate on the exact release candidate.

Run Placebo v0.2 with and without Tavily where the corpus requires the ablation.

Run live Token Factory schema, tool, and routing contract probes.

Run live ConTree preparation, network isolation, branching, cancellation, and resource probes.

Run the public package installation matrix from a clean temporary repository.

Verify the action bundle contains the release version and current source behavior.

## Final manual acceptance

A non-collaborator submits one allowlisted public demo case.

The demo returns links for the broken pull request, failed CI, Sutura run, and terminal result.

Review the case file on desktop and mobile widths.

Confirm the Devpost description, images, video, repository, and release show the same claims.

Confirm the video names Token Factory, NVIDIA Nemotron, ConTree, and the measured Placebo result.

## Authorization gates

Implementation authority does not include release or submission authority.

The following actions require their existing explicit authorization:

- push implementation branches
- merge pull requests
- create or change the public demo repository
- configure repository secrets or variables
- spend live Token Factory or ConTree credits
- import or upload Data Lab records
- enable the public demo
- spend provider credits through the public demo
- create external test repositories
- remove external test branches, comments, checks, pull requests, or artifacts
- publish npm versions
- publish Marketplace releases
- upload release assets
- merge `develop` into `main`
- create Git tags or GitHub releases
- submit or update the Devpost entry

## Plan completion state

The implementation choices are complete.

External retention behavior, provider spending, remote test state, publication, and submission remain explicit authorization gates.

## Implementation progress

- [x] Phase 1: Secure sandbox and privacy boundary
- [x] Phase 2: Token Factory protocol foundation
- [x] Phase 3: Repository policy and stage evidence
- [x] Phase 4: Bounded tool-calling repair agent
- [x] Phase 5: Adaptive ConTree checkpoint search
- [x] Phase 6: Evaluation Lab records and ATIF export
- [x] Phase 7: Nemotron routing and progressive flake confidence
- [x] Phase 8: GitHub Checks and audit-only distribution
- [x] Phase 9: Placebo v0.2 benchmark expansion
- [x] Phase 10: Python project support
- [x] Phase 11: Public demo, external proof, feedback, and release readiness
