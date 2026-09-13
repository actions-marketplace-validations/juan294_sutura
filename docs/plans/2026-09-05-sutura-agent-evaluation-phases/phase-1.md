# Phase 1 — Write the source-backed evaluator documentation

Parent: [Sutura agent-readable evaluation plan](../2026-09-05-sutura-agent-evaluation.md).

Status: Complete, verified locally. Dependency: finalized parent plan. Sequential phase.

## Owned files

- New `docs/evaluation/README.md`.
- New `docs/evaluation/architecture.md`.
- Extend `scripts/submission-contract.test.mjs`.
- Update this phase record and the parent status on completion.

## Preparation

Read both research inputs linked by the parent completely. Resolve the current
local integration SHA, inspect the diff since planning base `2278ab9`, and verify
that the source, test, artifact, and renderer references being promoted still
support their claims. Do not copy the research's old line numbers without checking.

Inspect current committed evidence requirements, Case Lab release pin and modes,
Placebo reports, counterfactual scope, Arena controls, and Data Lab/ATIF status.
Record source SHA separately from measured subjects. Exclude sibling-worktree
results absent from the integration snapshot. Missing public evidence is a stated
limitation; it does not require a live run to finish this documentation phase.

## Checkable document specification

Use the existing evaluator draft as content input, split into these documents:

```text
docs/evaluation/README.md
  reviewed source identity + date + source-review scope
  problem and three supported strengths with proof links
  ordinary link to architecture.md
  four official criteria -> supported behavior -> evidence + limits
  sponsor usage -> reason used -> source/artifact -> actual mode
  Case Lab route -> named visible section -> renderer symbol/source
  explicit #evidence-status section linking canonical reports
  explicit #limitations section: source/tests/live/offline/control/pending
  link to canonical contributor setup and existing offline review commands
  refresh note: reviewed source != historical subject != demo Action

docs/evaluation/architecture.md
  reviewed source identity + date
  plain-text lifecycle and link to existing architecture diagram
  six cards, using the IDs and fields in parent decision D2
  source symbols + relative file/line links + tests/artifacts
  back link to guide and its evidence-status/limitations anchors
```

The first three cards carry the headline engineering argument. Include a bounded
audit example showing that a failed rerun skips later adjudication. Preserve its
test-existence versus executed-test distinction. Do not copy large snippets or
maintain new benchmark numbers when a canonical report already carries them.

Use explicit simple section IDs for important cross-document links. For Markdown
source-line links use `?plain=1#L…`; use normal `#L…` links for code. Every source
link also names a symbol or useful descriptive label. At final submission freeze,
WS-4 may add immutable public source URLs after confirming those commits exist
on the submitted remote.

## Contract changes and pseudocode

Inspect and reconcile current WS-4 edits to this shared test file. Keep all
existing checks and semantics (six at the planning baseline). Add narrowly scoped
checks in the same Node test file, starting red before creating the documents:

```text
EVALUATOR_DOCS = [guide path, architecture path]
CARD_IDS = six literal IDs from D2

checkEvaluatorDocs(read):
  require both documents and reviewed 40-hex source identity
  require four criterion names in guide's criterion section
  require guide links to architecture, canonical evidence, and limitations
  for cardId in CARD_IDS:
    locate card by explicit id; reject duplicate ids
    require nonempty D2 fields
    require Implementation link to repository source + named symbol
    require Verification link to test or canonical artifact
    require explicit inspection/execution mode and limitation
  validate supported local links in the two docs

checkLocalTarget(document, link, read):
  URL-resolve relative target against document
  separate query and fragment before filesystem lookup
  reject absolute local paths and traversal outside repository
  require target file
  if fragment is L-number or L-start-L-end: check ordered in-bounds lines
  if fragment is a simple explicit section ID: require that target id
  use only these fragment forms in newly authored docs
  errors name document and broken target
```

Do not broaden the older submission link check to reject existing ordinary
headings or introduce new constraints on unrelated historical documents. A local
target outside the two authored docs can use an existing simple heading only if
the helper explicitly supports it; otherwise link the file with a line label.
Do not implement a general Markdown slugger or parser.

Add mutation cases using injected text/temporary files for a nonexistent target,
out-of-range line, missing explicit section, duplicate card ID, and missing Limit
field. Keep helper validation offline and independent of full Git history.
Ignored-file portability is ultimately checked by the archive test below; do
not require not-yet-staged new files to be tracked during the initial red/green loop.

## Automated success criteria

- New contract fails before documents exist, passes with the completed documents,
  and each deliberately invalid mutation is rejected with an informative error.
- All then-current submission checks still pass unchanged in meaning.
- Run sequentially from the repository root:

  ```bash
  node --test scripts/submission-contract.test.mjs
  pnpm run typecheck
  pnpm run lint
  pnpm run test
  pnpm run build
  git diff --check
  ```

- After committing the intended phase state locally, export it with `git archive`
  into a fresh temporary directory. Run `node --test
  scripts/submission-contract.test.mjs` there with no dependency install. All
  evaluator links must resolve from committed content, excluding ignored files.

## Review success criteria

- Review all six cards against the actual functions and named tests/artifacts.
- Verify that source SHA, historical benchmark subject, demo pin, and validation
  state are not conflated. Report missing evidence explicitly.
- Confirm no generated verdict, requested score, unsupported superiority claim,
  or test-existence claim presented as a fresh pass.
- Check the rendered Markdown reading order and plain-text intelligibility.
  Screenshots and public demo availability are not asserted by this phase.

## Completion

Run independent content and reuse/quality review, resolve findings, complete the
local checks and parent integration procedure, and record the actual commit and
commands here. Stop after this phase; Phase 2 introduces the discovery pointers.

## Execution record — 2026-09-05

- [x] Current source/evidence inspected at `ce3502d86a32883eac8c7a2adcc9df2c07e12e85`; newer failed candidate evidence retained separately.
- [x] Initial contract red: 8/9 passed, missing guide failed as intended. Final focused check: 9/9 passed, including malformed/encoded link mutations.
- [x] Independent plan/source review and dedicated reuse/quality review approved after lifecycle and link-diagnostic corrections.
- [x] `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`, and `git diff --check` passed sequentially on Node 22.23.2. Full tests: 1,744 passed, 9 live credential-gated tests skipped.
- [x] Committed-only archive: 9/9 passed without dependency install. Commit `e2441e480179cd1890385240f7d45bc1c964ab8b` fast-forwarded into local `develop`.

Execution logs and reviews are preserved locally under `docs/agents/phase-1-*`.
