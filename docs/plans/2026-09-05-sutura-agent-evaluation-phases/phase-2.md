# Phase 2 — Expose the evaluator route

Parent: [Sutura agent-readable evaluation plan](../2026-09-05-sutura-agent-evaluation.md).

Status: Complete locally; final integration pending. Dependency: Phase 1 accepted locally. Sequential phase.

## Owned files

- Root `README.md`, `AGENTS.md`, and `CLAUDE.md`.
- New `docs/README.md`.
- Extend `scripts/submission-contract.test.mjs`.
- Update this phase record and parent status on completion.

## Implementation

Re-read the current entry points and inspect competing README changes before
editing. Preserve the existing setup block, release numbers, security statements,
agent precedence rules, commands, and workflow gates.

```text
README.md:
  correct the opening five-repairs claim to repair/refusal cases with labeled evidence
  after the short product/demo introduction, add "Technical review"
  link directly to docs/evaluation/README.md with useful descriptive text
  link docs/README.md for the broader documentation index

AGENTS.md:
  add a short "Repository evaluation" section near the opening
  ordinary Markdown link to docs/evaluation/README.md
  state that the guide maps implementation, tests, evidence modes, and limitations
  leave command dispatch, precedence, and phase gates intact

CLAUDE.md:
  add ordinary Markdown evaluator link in Project File Locations
  correct Deployment to distinguish the Action/CLI from hosted Case Lab
  replace public Context's ignored strategy pointer with the public evaluation route
  preserve the ignored file and all other operational rules

docs/README.md:
  first: For evaluators -> evaluator guide, architecture cards, submission source
  next: For users/contributors -> root setup and package READMEs
  next: Evidence/security -> existing canonical reports and security docs
  last: Process history -> dated research and plans
  keep to short links and descriptions, with no duplicated metrics
```

Public review navigation must not depend on this task's research drafts, plan,
or ignored comparison records. For process history, link existing committed files
such as the hackathon roadmap and Case Lab research, which remain available in
Phase 3's filtered exports. Use file targets supported by the local-link checker.

The new sections are navigation rather than directives to reach a favorable
verdict. Keep each agent pointer under approximately 80 words. The current
README CTA correction is already within this plan's reviewed findings; no new
claim of public availability is introduced.

## Contract changes and pseudocode

Inspect and reconcile current WS-4 edits to the shared submission-contract file;
retain every existing check and its semantics. Write failing navigation
assertions before inserting pointers:

```text
for entry in [README.md, AGENTS.md, CLAUDE.md, docs/README.md]:
  resolve an ordinary relative Markdown link from entry to evaluator guide
  require the destination; reject a bare path or code-fenced example as the only link

require docs index places evaluator section before process history
check newly authored pointer targets with the Phase 1 local-link helper
negative cases: omitted guide link, misspelled destination, example-only pointer
```

Do not apply a blanket historical version ban to the guide or root README.
Do not parse all contributor instructions or attempt to guarantee that an unknown
agent will load these files. The contract verifies that the links exist and work.

## Automated success criteria

- Navigation tests demonstrate a red/green result and reject their mutations.
- Run sequentially:

  ```bash
  node --test scripts/submission-contract.test.mjs
  pnpm run test:readme
  pnpm run typecheck
  pnpm run lint
  pnpm run test
  pnpm run build
  git diff --check
  ```

- Repeat the committed-only local archive check from Phase 1. It must resolve
  the new entry links without the research worktree or ignored strategy files.
- The existing README setup contract still passes; no new workflow or package
  script is required.

## Review success criteria

- A reader finds the evaluator guide in one link from each entry point.
- The opening makes the three engineering strengths and evidence status apparent
  without reading RPI commands or operational reports.
- The correction accurately describes a mix of repair, refusal, and no-patch
  cases. CLAUDE describes the hosted demo without claiming a freshly checked deploy.
- The docs index distinguishes current review material from historical process.
- No changes were made to WS-4 evidence, submitted video, release pins, Case Lab
  behavior, provider configuration, or Git/deployment rules.

## Completion

Review for factual drift and duplication, resolve findings, run the checks and
parent integration procedure, then record the actual integrated commit here.
Stop after this phase. Phase 3 measures the combined documentation route.

## Execution record — 2026-09-05

- [x] Navigation red: 10/11 passed, missing README pointer failed as intended. Green: 11/11, including omitted, misspelled, fenced, inline-code, image-only and broken-index mutations.
- [x] Independent compliance and dedicated reuse/quality review approved; README setup, security and contributor rules preserved.
- [x] `pnpm run test:readme` (3/3), `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` (1,744 passed, 9 live tests skipped), `pnpm run build`, and `git diff --check` passed sequentially on Node 22.23.2.
- [x] Committed-only archive: 11/11 passed without dependency install at `b526d3b7adc635fe5e1cd7ca341b40a5efa98f2e`.

The full task stays isolated until final integration, per owner policy and implementation notes. Logs: local `docs/agents/phase-2-*`.
