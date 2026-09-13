# Sutura agent-readable evaluation documentation

Date: 2026-09-05

Status: All three phases complete and verified locally; final integration/publication closeout follows the current owner request.

Owner: Juan

Planning base: local `develop` at `2278ab9f682fae67d85de614068b7d2bbedf6347`.

Integration branch: `develop`. Release branch: `main`.

Planning workspace: `/Users/juan/code/sutura-agent-evaluation-research`, branch
`docs/agent-evaluation-research`. Research and plan files are currently local,
uncommitted task artifacts. Preserve them before any worktree cleanup.

## Objective

A reviewer starting from the repository can find Sutura's distinctive engineering,
understand its product value, and verify the claims against code, tests, and
versioned evidence. The reading route must also work when the reviewer treats
repository instructions only as ordinary documentation.

The deliverable is a small Markdown documentation layer plus focused local
consistency checks. It does not certify release readiness or change repair behavior.

## Inputs and current state

Read both inputs completely before implementation:

- [Research and L'Ayalga comparison](../research/2026-09-05-sutura-agent-evaluation.md).
- [Evaluator-guide draft](../research/2026-09-05-sutura-evaluator-guide-draft.md).

Those inputs describe source `974612b7ece1b7386b8c71d136b3a3ecda860ab1`.
Planning rebased the isolated workspace by a local fast-forward to `2278ab9`;
the added About page and discoverability playbook were inspected. No inference
that an old result validates the newer source is permitted.

| Existing contract | Planning implication |
| --- | --- |
| Root overview, architecture, and dated failed benchmark: [README.md:24](../../README.md?plain=1#L24), [README.md:82](../../README.md?plain=1#L82) | Route to canonical evidence; do not duplicate benchmark datasets or invent current metrics. |
| Source package identity versus demo pin: [submission source:5](../devpost/sutura-submission.md?plain=1#L5), [Case Lab release:1](../../packages/case-lab/release.json#L1) | Reviewed source, benchmark subject, and demo Action SHA are separate identities. |
| Conditional replay and recorded-result fallback: [replay README:3](../../packages/case-lab/replay/README.md?plain=1#L3) | Retain each result's mode and subject; scenario expectations are not observations. |
| Existing six submission checks: [submission-contract.test.mjs:43](../../scripts/submission-contract.test.mjs#L43) | Extend this Node test file; no new package, parser dependency, workflow, or package script. |
| Checks already in release-contracts and local gates: [package.json:28](../../package.json#L28) | New checks inherit existing execution without another CI job. |
| Case Lab About content: [about.md:1](../../packages/case-lab/content/about.md?plain=1#L1) | Consume the established website; site changes belong to the discoverability workstream. |
| WS-4 ownership: [issue workstreams:26](2026-09-04-sutura-issue-workstreams.md?plain=1#L26) | Keep edits out of `docs/demo`, `docs/devpost`, and release identity files. |
| Freeze admission and invalidation: [candidate freeze:27](../demo/sutura-v0.2.1-candidate-freeze.md?plain=1#L27) | Classify commits as evidence documentation/contracts. Documentation does not exempt a new candidate from existing exact-commit gates. |

## Design decisions and alternatives

| Option | Benefit | Cost | Decision |
| --- | --- | --- | --- |
| Two canonical evaluator documents with Markdown evidence cards | Portable, reviewable, small maintenance surface | Some factual review remains human/agent judgment | Selected |
| A custom claims JSON schema plus generated prose | Stronger machine validation of repeated metrics | Another format and generator without a demonstrated consumer | Deferred |
| Website `/llms.txt`, Markdown exports, and new routes now | Another route for web-reading agents | Overlaps ongoing site work and requires separate deployment | Deferred |
| Copy the whole research dossier into agent entry files | Many claims immediately loaded | Long startup context, duplicated facts, historical material mixed into review | Rejected |

The optional scope question offered repository-first work or website exports.
No change was requested before drafting, so this plan uses the stated
repository-first assumption. There are no unresolved design questions.

### D1. Two documents carry the narrative

Create `docs/evaluation/README.md` as the canonical entry point, aiming for
700–900 words and no more than 1,200. Its opening gives the problem, three
supported strengths, direct proof links, and the evidence limitation.

Create `docs/evaluation/architecture.md` for six source-backed evidence cards,
a plain-text lifecycle, and a link to the existing architecture diagram.
Target at most 2,000 words. Word targets guide editing; they are not external
tool limits or product release gates.

Do not create competing `EVALUATION.md`, `criteria.md`, `integrations.md`, or
`claims.json` files in this scope. The guide contains the rubric and sponsor
tables; architecture holds the detailed claims.

### D2. Evidence cards are a small authoring convention

Use stable simple IDs and these visible fields: Claim, Product value, Criterion,
Implementation, Verification, Mode and revision, Limit. The architecture cards:

1. `controller-authority`: bounded model proposals and controller-owned edits/tests.
2. `contree-branches`: dependency preparation plus triage, repair, and audit branches.
3. `layered-audit`: mechanical gates, rerun, and semantic adjudication.
4. `flake-triage`: bounded sampling, uncertainty, and stopping behavior.
5. `grounded-dependencies`: Tavily sources, validation, and versioned ablations.
6. `counterfactual-verification`: alternative patches, rejecting gates, and offline limits.

Use ordinary links, descriptive source symbols, and line references checked
against the reviewed source. Simple explicit anchors such as
`<a id="layered-audit"></a>` may support stable navigation; they contain no hidden
claims or instructions. Avoid requiring a general Markdown parser.

### D3. Version status travels with each claim

For source behavior, record the exact reviewed commit and inspection date. A
test link means a test exists. Fresh test success requires its actual command,
revision, result, and execution record. Live evidence separately retains its
subject SHA, corpus, date, denominator, and outcome.

Prefer a short interpretation and a link to the canonical measured report over
copying numbers into another table. Preserve the failed historical v0.2 baseline,
offline counterfactual omissions and surviving alternative, Arena control status,
Data Lab preparation status, and NeMo's validation role. On implementation,
refresh these descriptions from evidence actually available in the integration
snapshot. Do not import results from another worktree merely because they exist.

Do not require `reviewed source SHA == documentation HEAD`: a documentation
commit cannot contain its own hash, and historical measured subjects intentionally
differ. Review source-byte changes on integration; keep a still-valid reviewed
identity or conduct a new source review. Final submission pinning remains WS-4 work.

### D4. Discovery is ordinary navigation

Add brief relative Markdown links in root README, AGENTS, CLAUDE, and a small
new `docs/README.md`. Put evaluator documents before process history in that index.
Keep contributor instructions and precedence intact. Correct the already observed
five-repairs wording and the stale no-hosted-deployment description while editing
their immediate paragraphs. Replace the public context pointer to ignored strategy
with a public guide pointer; never publish the ignored strategy file.

### D5. Validate public portability locally

Extend `scripts/submission-contract.test.mjs` with narrowly scoped helpers for
these documents, their card fields, anchors, and entry links. Test the helpers
with deliberate broken-target and missing-field mutations. This is a shared
WS-4 file: inspect and reconcile its current changes before extending it. Preserve
all then-current checks and semantics, including their historical-version rules;
six is the inspected baseline count, not a fixed limit on future checks.

Run the focused tests in a local archive of the intentional committed state as
well as the worktree. That catches dependencies on untracked or ignored evidence.
No test fetches Git history or the network; default shallow CI checkouts must work.
Semantic correctness remains a source-review responsibility.

## Phases and ownership

| Phase | Deliverable | Files | Depends on | Status |
| --- | --- | --- | --- | --- |
| [1](2026-09-05-sutura-agent-evaluation-phases/phase-1.md) | Current guide, architecture cards, and content/link contract | New `docs/evaluation/README.md`, `docs/evaluation/architecture.md`; extend `scripts/submission-contract.test.mjs` | This plan | Complete; `e2441e4` locally integrated |
| [2](2026-09-05-sutura-agent-evaluation-phases/phase-2.md) | Discoverable entry links, concise docs index, consistency corrections | `README.md`, `AGENTS.md`, `CLAUDE.md`, new `docs/README.md`; extend same test file | Phase 1 | Complete at `b526d3b`; included in final integration |
| [3](2026-09-05-sutura-agent-evaluation-phases/phase-3.md) | Bounded fresh-reader comparison and final source review | Ignored `docs/agents/agent-evaluation-comparison.md` and trial outputs; scoped corrections to Phases 1–2 files if supported | Phase 2 | Complete at `2cca707`; measured docs `b810c03` |

All phases are sequential. None is batch eligible: Phase 2 requires Phase 1's
destinations and shares its test file; Phase 3 evaluates their combined output.
Independent read-only reviewers can work in parallel within a phase. Verification
commands run sequentially.

## Verification and phase gates

After each implementation phase, run the relevant focused documentation checks,
then the project's required typecheck, lint, tests, and build sequentially. The
exact commands appear in the phase files. Run `ci:fast` before a future push;
`ci:local` is additionally required if scope ever changes to core. This plan
does not authorize that core scope expansion.

Each phase follows implement → independent review → fixes → simplify review →
verification. Use the documented dedicated reuse/quality review if
`codex-simplify` remains unavailable. Stop after each phase as required by this
task's RPI gates; the older four-workstream blanket continuation does not extend
this new plan's scope.

Automated acceptance: all new target files/anchors resolve; all six cards have
required evidence fields; entry links resolve in a tracked-only archive; existing
submission contracts remain passing; local project gates pass.

Review acceptance: supported source claims, accurate identity/mode labels, a
readable four-criterion mapping, no dependence on ignored files, a text-readable
demo route, and an honest comparison report. Improved judging scores are not an
acceptance requirement. Missing live product evidence remains visible.

## Git, budget, and integration

`/plan` produces only these plan artifacts; it does not implement, commit, push,
open a PR, or deploy. At `/implement`, preserve the uncommitted research and plan
inputs, use the existing task-owned isolated workspace or a fresh phase worktree,
and check current branches and unrelated changes before mutations.

After phase verification, commit only intended files following typecheck/lint and
the Conventional Commit policy; integrate into local `develop` with the documented
branch workflow, verify the integrated state, and remove only clean task-owned
worktrees/branches whose artifacts are safely retained. Never discard untracked
research, plan, or comparison records during cleanup. Subsequent phases can use
new worktrees. Update this plan's phase status with the actual integrated commit.

Remote publication is outside this plan. Relevant triggers inspected locally:

- Pushes/PRs to `develop` or `main` run CI and CodeQL:
  [ci.yml:3](../../.github/workflows/ci.yml#L3),
  [codeql.yml:3](../../.github/workflows/codeql.yml#L3).
- PRs to those branches also run dependency review:
  [dependency-review.yml:3](../../.github/workflows/dependency-review.yml#L3).
- A failed or timed-out CI run can start the repair monitor:
  [sutura.yml:5](../../.github/workflows/sutura.yml#L5).
- Release publication can trigger npm publishing:
  [publish.yml:3](../../.github/workflows/publish.yml#L3).
- The deployment playbook specifies prebuilt production deploys:
  [discoverability-playbook.md:18](../release/discoverability-playbook.md?plain=1#L18).
  The local `vercel.json` does not prove that remote Git previews are disabled.

Before any separately requested push, inspect then-current remote workflow and
Vercel Git triggers, complete applicable local gates, and check the push freeze.
If a preview would run, stop before pushing and use the documented non-destructive
bypass or disable path. Never deploy a preview. Do not use CI to debug the docs.

The comparison uses existing assistant subagents with fixed limits, not separate
provider API jobs. This is not a claim of zero assistant cost. No paid Sutura
provider call, ConTree run, hosted build, or production deployment is in scope.

## Deferred handoffs

- WS-4: after the real video exists, publish captions/transcript with actual
  timestamps → demonstrated behavior → claim ID → exact evidence/source links.
  Use the final cut, not the planned script timings. No empty transcript is created.
- WS-4: final released source/evidence/demo identities, public URL acceptance,
  and submission assembly. The new guide is navigation, not a replacement release
  evidence record.
- Discoverability: consider `/llms.txt` and Markdown website exports after the
  repository route has been evaluated, with their own build and deployment scope.
- Later, if useful: generated claims JSON, minimal Copilot pointers, a few
  invariant-to-evidence source comments, and actual demo screenshots with text.
  None is required to complete these three phases.

## Planning completion

Two independent reviewers read the parent and all three phase files. Their
findings were resolved: snapshot-bound assessor truth, preservation of shared
WS-4 tests, exact-hunk baseline construction, explicit read-budget semantics,
filtered-export link validation, and archive-owned tracked-file checks.

Local validation checked all four plan files, relative links and line bounds,
whitespace, and the absence of unresolved clarification markers. No application
tests were run for this planning-only change. Implementation begins only in a
subsequent `/implement` phase.

## Implementation progress

- [x] Phase 1: guide, six architecture cards, source review, quality review, and documentation mutations.
- [x] Phase 2: ordinary discovery links and docs index.
- [x] Phase 3: eight bounded readers, honest comparison, independent source review, and dedicated quality review.

Phase 1 source reviewed at `ce3502d86a32883eac8c7a2adcc9df2c07e12e85`.
Node 22.23.2 local focused checks (9), typecheck, lint, full tests
(1,744 passed, 9 credential-gated tests skipped), build, and whitespace checks passed.

Phase 1 documentation commit: `e2441e480179cd1890385240f7d45bc1c964ab8b`, fast-forwarded into local `develop`.
The dependency-free committed archive passed all nine focused checks.

Phase 2 focused checks (11), README setup contract (3), typecheck, lint, full tests
(1,744 passed, 9 live tests skipped), build, and whitespace checks passed sequentially
on Node 22.23.2. Remaining integration is deferred until all phases are complete.

Phase 2 documentation commit: `b526d3b7adc635fe5e1cd7ca341b40a5efa98f2e`.
Committed-only archive: 11/11 passed. Concurrent documentation/evidence from
`61093a817dacf456b902f20c233436d6da27a604` was merged into the isolated task branch
before Phase 3. Product source is byte-identical to the reviewed `ce3502d` source;
the new candidate-matrix evidence was added to the guide and assessor truth before trials.


Phase 3 froze public documentation at `b810c0320a2aaacac3581ccb01b0b5c1f77e7c0d`.
All eight fresh readers completed. Both exports retained identical product bytes
and unchanged post-trial manifests. Across 48 paired topic observations, 17
improved, 29 tied and two regressed; one after reader overstated existing renderer
copy scope. This is a small discovery comparison, not statistical evidence or a
judging score. Historical identity, full branching-role discovery and Arena
coverage remain gaps. No public wording was tuned after the trials.

Independent final source and reuse/quality reviews approved the final guide,
cards, navigation and checker. The full local CI selection, coverage, typecheck,
lint, build, offline runtime smoke, fresh-clone README setup, package install,
release contracts (146) and guards (445/445) passed. Full tests: 1,744 passed,
9 opt-in live tests skipped. Detailed logs and the comparison remain ignored
operational artifacts, preserved on the integration worktree before task cleanup.

The current implementation request explicitly authorizes all phases, one final
completed develop push and green CI verification. It overrides this plan's
original phase stops and remote-publication exclusion. Production deployment,
preview deployment, release pinning, video/transcript and public acceptance remain
separate work. Vercel Git integration was inspected and is absent; current
workflow triggers and push-freeze admission were checked before publication.

Phase 3 completion commit: `2cca707a0b457c9889ba34195279ad851dd9be05`. The final committed-only archive passed all 11 focused contracts without installation. This completed commit, including the unchanged measured public documents, is the Phase 3 integration deliverable.
