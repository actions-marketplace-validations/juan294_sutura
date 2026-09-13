# Sutura issue workstreams for parallel RPI execution

Date: 2026-09-04

Status: Active

Owner: Juan

Source: GitHub issues [#47](https://github.com/juan294/sutura/issues/47) through [#127](https://github.com/juan294/sutura/issues/127), which mirror the unchecked items in `docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md`.

Base commit: `321822a` on `develop` (CI green).

## Purpose

Divide the 81 open roadmap issues into four workstreams that four agents execute at the same time. Related issues stay in one workstream in dependency order. Each workstream runs the full RPI loop (research, plan, implement, validate) without stopping for approval between phases. Each stream stops only at the authorization gates listed in this document, because those gates spend money, publish public state, or need people who are not agents.

Every issue carries a GitHub label that names its workstream: `ws-1-case-lab`, `ws-2-counterfactual-arena`, `ws-3-datalab-adoption`, `ws-4-evidence-submission`. An agent lists its work with `gh issue list --label <label> --state open`.

## Workstreams at a glance

| Stream | Name | Issues | Count | Roadmap phases | Owned paths |
| --- | --- | --- | ---: | --- | --- |
| WS-1 | Public Case Lab | 68, 59, 60, 63, 62, 61, 64, 65, 66, 67, 51, 50 | 12 | 1 | new Case Lab package, demo workflows, README demo section |
| WS-2 | Counterfactual proof and Arena | 69, 70, 71, 72, 75, 74, 73, 81, 78, 79, 80, 76, 77, 53, 82 | 15 | 2, 3 (benchmark) | `packages/core`, `packages/placebo`, `packages/evaluation/src/atif.ts`, new Arena report |
| WS-3 | Data Lab and external adoption | 83, 85, 88, 86, 84, 87, 52, 92, 98, 93, 89, 90, 91, 94, 95, 96, 97, 54, 55 | 19 | 3 (Data Lab), 4 | new `packages/evaluation` redaction and Data Lab modules, `packages/cli` setup and doctor, `action.yml`, install scripts, privacy docs, README setup |
| WS-4 | Evidence gates, submission story, release | 47, 48, 49, 99, 100, 101, 102, 103, 104, 105, 106, 56, 57, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 58 | 35 | 0, 5, 6, 7 | `docs/demo`, `docs/devpost` (new), `docs/release`, release and evidence scripts, roadmap status |

WS-1 is the largest product build and the biggest judging gain (Design 5-6/10 to 9/10). WS-4 has the most issues but most of them are documents, gate scripts, and sequential release operations.

Target: Juan expects about 99 percent of this work to be complete within three days of 2026-09-04. The roadmap dates for Phases 5 to 7 (October 13 to 29) are latest dates, not start dates. WS-4 runs the freeze, release candidate, acceptance matrix, and submission preparation on the first candidate that contains the merged output of WS-1, WS-2, and WS-3. If a later change lands on `develop` after that candidate, the final-candidate gates run again on the new candidate. Only the Devpost submission itself waits for Juan's explicit authorization.

Assignment (Juan, 2026-09-04):

| Pane | Agent | Stream | Reason |
| --- | --- | --- | --- |
| 1 | Claude Fable 5.1 (this session) | WS-1 Public Case Lab | Largest build, security-critical input boundary, control-plane architecture decision, full context from this split |
| 2 | Claude Opus | WS-2 Counterfactual proof and Arena | Deep `packages/core` search and audit engine work with the strictest verification rules |
| 3 | Codex GPT 5.6 | WS-4 Evidence gates, submission story, release | Paid-run operations, freeze ownership, evidence documents, release scripts, and long waits on external runs |
| 4 | Codex GPT 5.6 | WS-3 Data Lab and external adoption | Provider API integration, install scripts, Marketplace metadata, privacy documentation |

Codex panes follow `AGENTS.md`: every `/research`, `/plan`, `/implement`, `/validate` reference means read the matching file in `.claude/commands/` and execute it as the workflow spec.

## Cross-stream dependencies

Only four dependencies cross streams. Every other issue in a stream can complete without waiting on another stream.

| Waiting issue | Stream | Needs | From | How to handle |
| --- | --- | --- | --- | --- |
| #73 side-by-side Case Lab view | WS-2 | Case Lab result view merged to `develop` (#66, #67) | WS-1 | WS-2 does #73 last in Phase 2. If WS-1 has not merged the result view yet, WS-2 lands the counterfactual data in the evidence format (#74) and continues to Phase 3, then returns to #73. |
| #51 demo pinned to release, #50 public demo | WS-1 | A published release that contains the Case Lab code | WS-4 (#114) | WS-1 pins the demo to a release identity variable and tests pinning against `v0.2.0`. The final pin to the submitted release is a WS-4 Phase 6 step. |
| #53 public Arena, #82 expansion | WS-2 | Accepted v0.2.1 benchmark as the baseline denominator model | WS-4 (#47) | WS-2 builds the 100-case harness and runs it on replay and small paid samples. The full paid 100-case run is an authorization gate. |
| #103 measured results, #106 links | WS-4 | Terminal evidence from WS-1, WS-2, WS-3 | all | WS-4 writes these sections last, in Phase 5, from committed evidence files only. Never from a placeholder. |

## Coordination rules for all four streams

1. Work in a git worktree on a task branch. Merge into local `develop`, verify at the integrated commit, push, then remove the worktree and task branch. This is the roadmap rule 11.
2. Commit before `git pull --rebase`. Rebase on `develop` before every merge, because four streams push to the same branch.
3. `packages/action/dist/index.cjs` is a committed build artifact and the most likely conflict. On a rebase conflict in that file, take either side, rebuild with `pnpm --filter @sutura/action build`, and commit the rebuilt file in the same commit as the source change. Never hand-merge it.
4. Run `pnpm run ci:local` before pushing anything that touches `packages/core`. Never push on red `develop`. After every push, spawn a background CI monitor agent.
5. Touch only your owned paths. If an issue needs a change in another stream's path, make the smallest possible change in a separate commit with the other stream's label in the commit body, so the rebase surface is small.
6. Each stream edits only its own phase section in the roadmap. WS-4 owns the roadmap header, the evidence register, and the phase status table.
7. Close a GitHub issue only after its evidence is on `develop`. The closing comment names the integrated commit and the evidence file, run URL, or test.
8. Provider secrets never enter a worktree, a document, or a test fixture. Live runs dispatch through GitHub Actions only.
9. Check `pnpm run push-freeze status` before every push. While a freeze is active, keep working in the worktree and push later. Never bypass the pre-push hook.
10. Authorization gates are listed per stream below. At a gate, the agent prepares the exact command, cap, reserve, stop condition, and expected cost, records them in the stream's plan, and continues with every non-gated issue. It does not wait idle.

### Push freeze on `develop` during paid runs

`scripts/placebo-live.mjs` requires the controller SHA to equal `origin/develop` HEAD at every case dispatch, and the 51-case v0.2.1 benchmark takes several hours. With four streams pushing, HEAD would move during the run and later dispatches would fail the gate. Decision (Juan, 2026-09-04): a push freeze on `develop` for the duration of each paid run. The other streams keep committing in their worktrees and push after the freeze ends.

The freeze is a marker file in the Git common directory (`.git/sutura-push-freeze.json`), so every worktree of this repository sees the same state. `.husky/pre-push` refuses to push while the marker exists and prints the reason, the start time, and the owner. Never bypass it with `--no-verify`.

```bash
pnpm run push-freeze on --reason "v0.2.1 benchmark on <sha>"   # WS-4, before the first dispatch
pnpm run push-freeze status                                      # any stream, any worktree
pnpm run push-freeze off                                         # WS-4, after the last case is terminal
```

WS-4 owns the freeze. It turns the freeze on immediately before the first paid dispatch, posts the reason and expected duration as a comment on the benchmark issue, and turns it off as soon as the run is terminal. WS-4 also makes the live runners (`placebo-live.mjs run`, `external-matrix-live.mjs`) refuse to dispatch unless the freeze is on, so the gate fails closed. A stream that is blocked by the freeze continues with its next issue in its worktree and rebases when the freeze lifts.

## WS-1: Public Case Lab

Objective: a signed-out non-collaborator selects one of five allowlisted cases (JavaScript repair, Python repair, deterministic flaky failure, greenwash trap, upstream dependency incident) and receives a stable, readable result with every field listed in roadmap Phase 1.

Research must decide the control plane first: Nebius Serverless Jobs or Serverless Endpoints versus a GitHub Actions dispatcher behind a small public front end. The roadmap allows Nebius serverless only if it supports asynchronous execution, secret isolation, request limits, and stable result URLs. The Token Factory and ConTree path remains the runtime core in both designs.

Order:

1. #68 Remove the collaborator-only `workflow_dispatch` instruction (README line 15-17 region and any demo doc). Small, do first.
2. #59 Accept only server-defined case identifiers.
3. #60 Reject arbitrary repository names, refs, commands, patches, and free text. Security tests for #59 and #60 land together.
4. #63 Keep provider secrets outside ConTree.
5. #62 Protected service identity with minimum GitHub permissions.
6. #61 Throttling, concurrency limits, daily spend stop, emergency disable.
7. #64 Deterministic replay for every case, using the existing `packages/core/src/replay` contracts.
8. #65 Label live runs and replayed runs.
9. #66 Stable result URLs that survive refresh.
10. #67 Readable main result on desktop and mobile.
11. #51 Pin the demo to an exact release identity (test against `v0.2.0`; final pin is WS-4).
12. #50 Public demo usable by a signed-out non-collaborator.

Authorization gates: public demo enablement (#50) and any live paid case through the public path. The Phase 1 exit gate needs one live repair and one live refusal through the public path, so the stream prepares the dispatch and cap and asks once.

Also deliver for WS-4: an automated signed-out acceptance script that covers #116, #117, #118 (desktop repair, mobile repair or replay, refusal and flaky result). WS-4 executes it on the final candidate.

Done: Phase 1 exit gate in the roadmap, security tests prove fail-closed behaviour for arbitrary input, every case has a tested replay.

## WS-2: Counterfactual proof and Arena

Objective: make verification value visible (rejected deceptive patches beside the accepted patch) and prove it at scale with a reproducible 100-case comparison.

Order, Phase 2:

1. #69 Two or three alternative patches from the same ConTree checkpoint for selected cases.
2. #70 At least one shortcut that weakens a test, type check, lint rule, or error path.
3. #71 Every candidate through the same mechanical and model-audit gates.
4. #72 Record the exact rule, hidden test, policy, or audit finding that rejects each deceptive patch.
5. #75 Measure additional cost, latency, and sandbox operations.
6. #74 Counterfactual results in the evidence and ATIF formats without duplicating source data (`packages/evaluation/src/atif.ts`, `schema.ts`).
7. #73 Side-by-side view in the Case Lab (cross-stream, see the dependency table).

Order, Phase 3 benchmark:

8. #81 Identical case selection, limits, provider models, and scoring across comparisons. Build the invariant harness first so every later comparison inherits it.
9. #78 Single-branch repair baseline mode.
10. #79 "First green patch wins" baseline mode.
11. #80 Fixed parallel search versus current beam search (extend `packages/placebo/src/ablation.ts`).
12. #76 Stratified 100-case selection from available SWE-bench and SWE-rebench environments.
13. #77 Record language, failure class, repository, difficulty, and inclusion reason in the manifest.
14. #53 Public Sutura Arena result page and downloadable machine-readable report.
15. #82 Expand toward 200 cases only after the 100-case run is complete, affordable, and statistically useful.

Authorization gates: every paid comparison run. Validate the three baseline modes on replay fixtures and the existing Placebo corpus first, then propose one cap for the 100-case run.

Done: Phase 2 exit gate (at least four cases with rejected alternatives, every deceptive alternative rejected, zero false approvals preserved on Placebo v0.2) and Phase 3 benchmark exit gate (reproducible from a versioned manifest, full denominator, at least one primary measure improved over single-branch).

## WS-3: Data Lab and external adoption

Objective: use Nebius Data Lab in the real improvement loop with a proven redaction boundary, then prove that developers outside the project can install and get a valid result from public artifacts.

Order, Data Lab:

1. #83 Define and test the redaction boundary before any upload (new module under `packages/evaluation/src/`, tests that prove source, secrets, and private paths are absent).
2. #85 Record Data Lab dataset identifiers, versions, input hashes, and output hashes.
3. #88 Document Zero Data Retention behaviour and what the explicit dataset import changes.
4. #86 Batch inference client for at least one model, router, or prompt comparison.
5. #84 Upload only sanitized records after explicit authorization.
6. #87 Publish the winning and losing configurations with cost, latency, and quality.
7. #52 Real sanitized Data Lab import and batch experiment (the terminal evidence record). The existing 55 evaluations in `docs/demo/placebo-v0.2-live-2026-09.json` are the first candidate dataset; the Arena output from WS-2 is the second.

Order, external adoption:

8. #92 Install only from public npm and immutable Action artifacts (extend `scripts/test-public-install.mjs`).
9. #98 Update provider privacy, retention, and threat-model documentation (`docs/security`).
10. #93 Measurement instrument: time to first valid result, setup failures, unclear instructions, manual interventions. Build the record template and collection script before recruiting.
11. #89 Recruit at least three developers who did not build Sutura. Prepare the recruitment kit, consent text, and record template. The recruiting itself is a Juan action.
12. #90 Installation in at least three unfamiliar repositories.
13. #91 Include JavaScript or TypeScript and Python.
14. #94 One repair, one refusal, one flake classification through the external path.
15. #95 Correct every release-blocking installation, documentation, permission, and result-clarity defect found.
16. #96 Short attributable feedback with participant permission.
17. #97 Marketplace listing complete and installation from it verified (`action.yml` branding and metadata, listing checklist).
18. #54 External installation and usability evidence from three developers (terminal record).
19. #55 Marketplace evidence (terminal record).

Authorization gates: Data Lab upload (#84), batch inference spend (#86), Marketplace publication (#97), and the three participants (#89). The agent prepares everything up to each gate and reports the exact ask.

Done: Phase 3 Data Lab exit gate (one real batch experiment with public-safe evidence and exact hashes) and Phase 4 exit gate (three external installation records, setup guide matches the released package and Action, Marketplace pinning works).

## WS-4: Evidence gates, submission story, release

Objective: close the v0.2.1 evidence gap that blocks Phase 0, build the Devpost package and video plan, and own the freeze, release candidate, acceptance matrix, and submission sequence.

Order, Phase 0 evidence (start immediately):

1. Make the live runners require the push freeze (see the freeze section above), then own the freeze for every paid run.
2. Resolve the Tavily HTTP 403 for `upstream-retry-release` named as the roadmap next action.
3. #47 Complete live Placebo v0.2 benchmark: 51 cases, 55 evaluations, on one exact v0.2.1 candidate, under a new cap.
4. #48 Candidate eight-case external matrix on the same candidate.
5. #49 Public eight-case external matrix against published v0.2.1 artifacts (after release publication).

Order, Phase 5 submission story (start after step 2, in parallel with waiting on paid runs):

6. #99 Project title and one-sentence value statement.
7. #100 Problem, audience, why existing "fix CI" tools are insufficient.
8. #101 Product workflow with one architecture diagram.
9. #102 Direct explanation of Nano, Super, Ultra, Token Factory, ConTree, Data Lab, and NVIDIA ATIF or NeMo use.
10. #105 Nebius and NVIDIA product feedback, then #56 the final feedback report. The operational reports and memory already record the ConTree image 404, Tavily 403, invalid Nemotron JSON, `force_nonempty_content`, and completion-limit loops.
11. #104 Significant work completed after the submission period started (from git history).
12. #103 Measured Placebo, dogfood, Arena, cost, and external-user results (written last, from committed evidence only).
13. #106 Public repository, demo, release, Marketplace, benchmark, and evidence links.
14. #57 Devpost description, images, and public video. The video script follows the roadmap timing table. Recording and upload are Juan actions.

Order, Phase 6 release candidate (execute on the first complete candidate; October 21 to 24 is the latest window):

15. #109 `pnpm run ci:local` sequential on the exact candidate.
16. #110 Candidate installation and external matrix checks.
17. #111 Live provider and ConTree canaries under an authorized cap.
18. #112 Code reuse, quality, and efficiency review with `codex-simplify`.
19. #107 Feature freeze (as soon as WS-1, WS-2, and WS-3 are merged; 2026-10-21 at the latest) and #108 accept only security, release, evidence, and demo-blocking fixes after it.
20. #113 Merge the approved candidate through the release path after separate authorization.
21. #114 Publish a patch or later release only when the verified candidate requires it.
22. #115 Verify npm, Action tag, Marketplace listing, GitHub release, and public install from a clean environment.

Order, Phase 7 acceptance and submission (execute on the released candidate; October 25 to 29 is the latest window):

23. #116, #117, #118 Signed-out Case Lab desktop, mobile, refusal and flaky (run the WS-1 acceptance script on the final candidate).
24. #119 Stable evidence and download links.
25. #120 Public npm install, #121 public Marketplace install, #122 public repository setup from a clean checkout.
26. #123 Public video playback with captions and correct links.
27. #124 Devpost preview with every required field, #125 written explanation of significant work, #126 feedback section.
28. #127 Final backup of submission text, images, video link, evidence index, and release identity.
29. #58 One complete public evidence index bound to the submitted release.

Authorization gates: provider and ConTree canaries, live benchmark spend, candidate matrix spend, release publication, public matrix, public demo enable, Devpost update and submission. These match `docs/demo/sutura-v0.2.1-release-evidence-requirements.json`.

Done: Phase 0 accepted, Phase 5 exit gate (complete draft, every number links to public evidence), Phase 6 exit gate (one exact release commit supports every claim), Phase 7 submission recorded in the roadmap.

## Launch prompts

Paste one prompt into a fresh session per stream. Each prompt overrides the "stop after each phase" rule in `CLAUDE.md` for that session, because Juan asked for continuous execution to completion.

### WS-1 (pane 1, Claude Fable 5.1)

```text
You own workstream WS-1 (Public Case Lab) from docs/plans/2026-09-04-sutura-issue-workstreams.md. Read that document, CLAUDE.md, the roadmap Phase 1 section, and docs/demo/sutura-v0.2.0-phase-0-evidence.md completely. List your issues with: gh issue list --label ws-1-case-lab --state open. Run the full RPI loop without stopping between phases: /research the current demo path, replay contracts, and the Nebius serverless decision; /plan a phased implementation that covers every WS-1 issue in the documented order; /implement every phase in a worktree; /validate against the plan. Follow the coordination rules in the workstream document. Stop only at an authorization gate: prepare the exact command, cap, and expected cost, record it in the plan, then continue with every non-gated issue. Close each issue with an evidence comment after its commit is on develop. Report when every WS-1 issue is closed or blocked at a named gate.
```

### WS-2 (pane 2, Claude Opus)

```text
You own workstream WS-2 (Counterfactual proof and Arena) from docs/plans/2026-09-04-sutura-issue-workstreams.md. Read that document, CLAUDE.md, the roadmap Phase 2 and Phase 3 sections, docs/plans/2026-09-03-sutura-search-recovery.md, and docs/plans/2026-09-04-sutura-completion-limit-branch-local.md completely. List your issues with: gh issue list --label ws-2-counterfactual-arena --state open. Run the full RPI loop without stopping between phases: /research the search engine, audit gates, ATIF export, and Placebo ablation harness; /plan a phased implementation that covers every WS-2 issue in the documented order, with Phase 2 before Phase 3; /implement every phase in a worktree; /validate against the plan. Follow the coordination rules in the workstream document, including pnpm run ci:local before any push that touches packages/core. Do issue #73 last in Phase 2 and skip it until the WS-1 result view is on develop. Stop only at an authorization gate: prepare the exact command, cap, and expected cost, record it in the plan, then continue with every non-gated issue. Close each issue with an evidence comment after its commit is on develop. Report when every WS-2 issue is closed or blocked at a named gate.
```

### WS-3 (pane 4, Codex GPT 5.6)

```text
You own workstream WS-3 (Data Lab and external adoption) from docs/plans/2026-09-04-sutura-issue-workstreams.md. Read that document, CLAUDE.md, the roadmap Phase 3 Data Lab and Phase 4 sections, docs/security, and scripts/test-public-install.mjs completely. List your issues with: gh issue list --label ws-3-datalab-adoption --state open. You run in Codex: follow AGENTS.md command dispatch, so every slash command below means read the matching file in .claude/commands/ completely and execute it as the workflow spec. Run the full RPI loop without stopping between phases: /research the evaluation export, existing sanitization, the Nebius Data Lab and batch inference APIs, the install scripts, and Marketplace requirements; /plan a phased implementation that covers every WS-3 issue in the documented order, Data Lab before external adoption; /implement every phase in a worktree; /validate against the plan. Follow the coordination rules in the workstream document. Stop only at an authorization gate (Data Lab upload, batch spend, Marketplace publication, participant recruiting): prepare the exact command, cap, and the text Juan needs, record it in the plan, then continue with every non-gated issue. Close each issue with an evidence comment after its commit is on develop. Report when every WS-3 issue is closed or blocked at a named gate.
```

### WS-4 (pane 3, Codex GPT 5.6)

```text
You own workstream WS-4 (Evidence gates, submission story, release) from docs/plans/2026-09-04-sutura-issue-workstreams.md. Read that document, CLAUDE.md, the roadmap completely, docs/plans/2026-09-01-sutura-v0.2.1-evidence-remediation.md and its phase-4 file, docs/release/e2e-pro-playbook.md, and scripts/placebo-live.mjs completely. List your issues with: gh issue list --label ws-4-evidence-submission --state open. You run in Codex: follow AGENTS.md command dispatch, so every slash command below means read the matching file in .claude/commands/ completely and execute it as the workflow spec. Your first task is the push freeze: make scripts/placebo-live.mjs run and scripts/external-matrix-live.mjs refuse to dispatch unless pnpm run push-freeze status reports an active freeze, then own the freeze for every paid run (on before the first dispatch, a comment on the benchmark issue with the expected duration, off as soon as the run is terminal). Then resolve the Tavily HTTP 403 for upstream-retry-release. Run the full RPI loop without stopping between phases: /research, /plan, /implement in a worktree, /validate. Cover every WS-4 issue in the documented order: Phase 0 evidence first, Phase 5 documents while paid runs wait, Phase 6 and Phase 7 on the first candidate that contains the merged WS-1, WS-2, and WS-3 work (the October roadmap dates are latest dates, not start dates). Never write a placeholder number; write measured sections last from committed evidence. Stop only at an authorization gate: prepare the exact command, cap, reserve, stop condition, and expected cost, record it in the plan, then continue with every non-gated issue. Close each issue with an evidence comment after its commit is on develop. Keep the roadmap header, evidence register, and phase table current. Report when every WS-4 issue is closed or blocked at a named gate.
```
