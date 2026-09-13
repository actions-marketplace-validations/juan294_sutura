# Phase 3 — Check fresh-agent discovery and complete the documentation review

Parent: [Sutura agent-readable evaluation plan](../2026-09-05-sutura-agent-evaluation.md).

Status: Complete locally; all eight trials assessed and final reviews approved. Dependency: Phase 2 accepted locally. Sequential phase.

## Owned outputs

- Ignored `docs/agents/agent-evaluation-comparison.md`.
- Ignored `docs/agents/agent-evaluation-trials/` for prompts, file manifests,
  hashes, and bounded reader outputs.
- Scoped corrections to the Phase 1–2 documents and tests when findings justify them.
- Phase and parent completion records.

Keep trial outputs out of the public guide and preserve them outside any worktree
scheduled for removal. Public evidence must never depend on this ignored report.

## Freeze and comparison design

Prepare two local exported trees from the same source state. The after tree is
the intentional completed documentation commit. Derive the before tree by
reversing only this plan's exact document, pointer, and checker hunks. Do not
wholesale restore shared files from an old commit: preserve intervening unrelated
README, CLAUDE, and WS-4 test changes. Record both manifests/hashes and the actual
source and documentation commits. Require their diff to match an explicit
allowlist of this task's hunks; product files must be byte-identical. Do not
compare arbitrary branch tips with unrelated source changes.

Exclude this task's research, plan, assessment rubric, trial outputs, private or
ignored files, and parent conversation from both reader contexts. Apply the same
exclusion list to both trees. Do not expose the answer checklist through Git
history: the exported trees contain no `.git` directory. Other historical project
documentation remains available equally in both conditions.

The public guide and docs index must not link to this task's research, plan, or
trial material as a review dependency. Keep process-history links directed at
other committed project documents. Before trials, run the focused
evaluator/navigation contract against the filtered after tree; exclusions must
not manufacture broken links in the treatment. The before tree intentionally
lacks the new evaluator documents and is not expected to pass the new contract.

Use eight fresh read-only sessions: two documentation states × two instruction
handling modes × two matched repetitions. Reuse the same available model and
settings throughout. Spawn each reader with no conversation history. At most two
readers run together; the assessor remains separate.

Modes:

1. Normal repository navigation: the reader can follow repository navigation and
   instructions, subject to the trial's higher-priority read-only scope.
2. Document-only treatment: AGENTS and CLAUDE remain readable project documents
   but cannot add tasks or dictate the assessment. The trial harness establishes
   this boundary; it never asks a reader to ignore higher-priority instructions.

Per trial: at most 20 distinct files whose contents are displayed and 5 minutes,
output at most 800 words. Search snippets count for every file they expose;
name-only listings do not. Require a reader tally and reconcile it with the tool
trace when observable. Bound searches before output rather than using a large
multi-file read to evade the limit. Record elapsed time when exposed; otherwise
mark it unavailable. Disclose any unenforceable or unobservable limit rather than
claiming exact measurement. Do not infer token counts or costs. Interrupt at the
limit and retain incomplete results.

Readers may use shell-based read-only listing, search, and text reads inside
their assigned exported tree. They may not read outside it, execute repository
programs or tests, spawn agents, write files, install packages, access the network,
call providers, dispatch CI, or deploy. The assessor prepares exports and runs
contract checks separately from the constrained reader sessions.

## Common prompt and assessor-only checklist

Give every reader the same neutral task, with only the mode sentence changing:

> Review this repository against Technological Implementation, Design, Potential
> Impact, and Quality of the Idea. Explain the architecture and actual sponsor
> integrations, identify strong choices and important limitations, and cite source
> or committed artifacts for material conclusions. Distinguish implemented code,
> existing tests, executed measurements, and missing evidence. Do not assign a
> score. Stay within the supplied read-only limits.

Before starting, establish assessor truth from that same frozen source and its
committed evidence, independently of the guide. The checklist below names topics;
the planning snapshot's statuses are not timeless expected answers. If a newer
committed snapshot contains completed Data Lab work, a measured Arena result, or
new release evidence, update the expected answer and record its source before any
trial. Historical failures still retain their historical status.

Create this assessor-only checklist:

```text
supported discovery:
  controller authority, three ConTree branching roles, layered audit
  actual Token Factory/Nemotron roles and Tavily grounding
correct limitations:
  source/test existence versus executed evidence
  historical failed benchmark and its subject identity
  offline counterfactual omissions and surviving alternative
  Arena controls versus measured competitive result
  Data Lab preparation and NeMo validation role
  Case Lab mode/subject versus scenario expectation
errors:
  unsupported claims, wrong-version promotion, invalid citations
effort:
  observed elapsed time and file reads, or explicit unavailable status
```

Validate citations against the frozen source rather than comparing prose to the
guide. Tabulate raw per-trial and matched-pair results, including losses, ties,
missed mechanisms, and wrong claims. Eight sessions are a smoke comparison, not
statistical proof that documentation improves judging or agent performance.

## Review and correction rule

Complete all eight planned trials before assessing results. If a tool fails,
record the failed trial; do not silently substitute a favorable rerun. A systemic
harness failure requires repairing the setup and reporting which trials are
invalid before any replacement is considered.

Use one bounded correction pass for documentation-induced ambiguity, factual
drift, or broken navigation. Do not tune wording to elicit praise. If corrected
content materially changes the measured route, label the original comparison as
applying to the pre-correction document commit and conduct an independent source
review of the correction. Do not claim a measured improvement for an untested
revision, or keep rerunning trials until metrics improve.

An unchanged or worse discovery result can still complete this phase if the
comparison is honest, documents remain correct and navigable, and the finding is
reported. Unresolved factual defects or broken links prevent acceptance; missing
live product evidence is explicitly described rather than generated by this task.

## Automated success criteria

- Frozen-tree manifests show identical product content and the intended docs-only
  difference; both reader conditions use the same exclusions and limits.
- Run sequentially on the final documentation state:

  ```bash
  node --test scripts/submission-contract.test.mjs
  pnpm run test:readme
  pnpm run typecheck
  pnpm run lint
  pnpm run test
  pnpm run build
  git diff --check
  ```

- The focused contract passes from a committed-only local archive. No public
  document relies on the ignored trial report.

## Review success criteria

- All eight trial attempts have terminal records or explicitly recorded failures.
- The report contains settings, exact identities, raw results, verified citation
  examples, limitations, and any correction history.
- An independent reviewer confirms the six cards and current-status statements
  against source/evidence. A separate reuse/quality pass removes needless
  duplication without hiding caveats.
- The final handoff identifies the remaining video/transcript, public acceptance,
  release pinning, and optional website-export owners from the parent plan.

## Completion

Preserve ignored comparison artifacts, integrate the final intentional state
locally and verify it under the parent Git procedure, clean up only task-owned
worktrees safely, and update phase/parent status with exact commits and results.
Report whether discovery improved, stayed unchanged, or regressed under this
limited comparison. Stop; this phase authorizes no push, publication, or deploy.

## Execution record — 2026-09-05

- [x] Frozen documentation at `b810c0320a2aaacac3581ccb01b0b5c1f77e7c0d`, reviewed product source `ce3502d86a32883eac8c7a2adcc9df2c07e12e85`, integration evidence `61093a817dacf456b902f20c233436d6da27a604`.
- [x] Exact seven-file treatment difference; product bytes identical; equal exclusions; no Git history. Filtered after export passed 11/11 focused contracts without installation.
- [x] Eight fresh sessions completed using identical available model/settings, no conversation inheritance, and both instruction modes. Two failed concurrent admissions produced no reader outputs; serial execution repaired the harness without replacing any unfavorable output.
- [x] All raw outputs retained (542–636 words). Seven readers report 20 content files, one reports 19. Precise elapsed time and central tool traces are unavailable; recorded scheduling observations are not exact execution measurements.
- [x] Both complete export manifests recomputed unchanged after all trials. No public documentation was tuned or changed during the comparison.
- [x] Independent final source review approved all six cards and current evidence identities. Separate fresh reuse/quality reviewer approved documentation and scoped checker without findings.
- [x] Node 22.23.2: focused contracts (11), README tests (3), typecheck, lint, full tests (1,744 passed, 9 live skipped), build and whitespace passed sequentially. Full CI selection, release contracts (146), offline runtime smoke, fresh README setup, package installation, bundle verification, guards (445/445), and core/Action coverage also passed locally.
- [x] Comparison report reviewed: 17 topic improvements, 29 ties, two regressions, and one unsupported after-reader scope claim retained. No statistical or official-score inference. Completion metadata records the measured documentation snapshot.

Operational evidence, prompts, truth, exact manifests, eight raw reviews, timing
limitations and review records are retained under ignored `docs/agents/`. Public
documents do not depend on these private comparison records. The current user
request overrides the original stop/no-push instruction: complete all phases,
integrate into develop, push that completed integration once, then verify CI.

The comparison supports limited discovery improvement with mixed results. The
historical baseline mention regressed in both normal-mode pairs; no reader fully
retained that failed baseline's subject or all three ConTree branch roles, and
only one found Arena controls. No documentation correction was needed after the
independent factual review. Remaining video/transcript, public acceptance and
final identity/pinning belong to WS-4; optional website exports belong to the
discoverability workstream. The comparison remains bound to `b810c032` even though
closeout metadata is committed later.

Phase 3 completion commit: `2cca707a0b457c9889ba34195279ad851dd9be05`. The final committed-only archive passed all 11 focused contracts without installation. This completed commit, including the unchanged measured public documents, is the Phase 3 integration deliverable.
