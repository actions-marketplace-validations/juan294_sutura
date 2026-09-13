# First-try repair reliability implementation notes

## Phase 1 exit evidence

- Implementation lineage: `a084bce`, `44863f2`, `67a7e14`, and hardening commit `55cbe8a`.
- Core tests: 805 passed, 8 skipped.
- Action tests: 82 passed.
- Core and Action typecheck: passed.
- Core and Action lint: passed.
- Full repository build: passed twice.
- Rebuilt `packages/action/dist/index.cjs` SHA-256 after both builds: `f871911d922b7549dad8e10ff895f56a824347ba90109b0e990fef044c5222a0`.
- E2E artifact contract: the `fixed` and `gave-up` storylines assert exactly `sutura-case-file-77001.html` plus `sutura-replay-77001.json`. The replay assertion checks the final outcome, populated GitHub, Repository, logical Executor, and HTTP streams, and `completeness.complete === true`. A run without replay capture still uploads exactly one artifact.
- `git diff --check`: passed.

## Phase 2 exit evidence

- Implementation lineage: capture commits `c026b69` and `c91ff2b`; replay runtime and CLI commits `9948465` and `e1bc839`; contract and simplify corrections through `cf278fd`.
- Historical corpus: 26 unique GitHub/log partial bundles, all with local capture provenance bound to `c026b69`; manifest SHA-256 `49a0fba717ad3f71551439c489da633ad389109e83bb21ffb1e3e8b128f6d50a`.
- B-class regression tests:
  - `replays A1 push metadata as a direct run while the pre-fix guard rejects it`
  - `replays A3 with the current command retention and reproduces pre-fix slicing`
  - `replays captured A3 pre-fix log slicing and stops before diagnosis`
- Real complete replay coverage: `replays every recorded boundary through the real offline orchestration path` and CLI test `replays a complete bundle offline and prints matching CaseFile JSON` exercise the generated complete bundle without external I/O.
- Actual command: `node packages/cli/dist/bin.js replay --bundle packages/action/src/__fixtures__/captured/33239848825/bundle.json --format json`.
- Actual result: exit 1 with `bundle is partial; complete provider, repository, and sandbox recordings are required` before network or sandbox construction, as required for a historical partial bundle.
- Final verification: Core 872 passed and 8 skipped; Action 83 passed; CLI 93 passed; captured fixtures 25 passed; release contracts 52 passed; typecheck, lint, build, `verify:bundle`, `git diff --check`, and a clean archive checkout passed.

## Phase 3a exit evidence

- Scanner handoff: the Phase 3c TypeScript AST scanner derived 78 Phase 3a guards on base `5d94e0a`. Four structurally unreachable guards were deleted with the proofs below, so the current run-time-derived target is 74/74.
- Core GitHub adapter checklist:
  - `packages/core/src/github/adapter.ts:25,27` — `rejects invalid workflow run id` and `rejects an unsafe integer workflow run id`.
  - `:52,57` — `rejects failed-step logs with no/invalid/reversed timestamp bounds`.
  - `:65` — `rejects a failed step with no timestamped log lines in its bounds`.
  - `:97` — `rejects an invalid repository identifier`.
  - `:104` — `rejects a requested run that differs from the captured Action event`.
  - `:112` — `rejects captured workflow metadata that changes identity`.
  - `:124,129,132,135,138,143` — the six `rejects captured pull-request metadata` cases.
  - `:155,160` — `rejects an invalid direct-run branch` and `rejects a direct branch that moved after the captured run`.
  - `:185` — `rejects a captured run with no failed-step logs`.
  - `:200` — `rejects multiple matching Sutura checks`.
  - `:209` — `rejects workflow metadata that changes before the atomic claim`.
  - `:218` — `wraps a non-422 atomic-claim failure`.
  - `:236` — `rejects an invalid created check id`.
  - `:265` — `rejects a completion target that differs from the atomic claim`.
  - `:291,293` — the invalid fix/base branch and invalid base SHA cases in `rejects ... before creating a pull request`.
  - `:297` — `rejects a fix branch that is not based on the captured failing SHA`.
  - `:318,320` — `requires an artifact port` and `rejects invalid case-file artifact name`.
- Action boundary checklist:
  - `packages/action/src/github.ts:38,40` — `rejects invalid Action run id` and `rejects an unsafe integer Action run id`.
  - `packages/action/src/github.ts:61` — `rejects an artifact upload with a missing/zero/unsafe id`.
  - `packages/action/src/octokit.ts:18` — `rejects an unsupported captured-log response shape`; the same test file also verifies captured logs in string, `ArrayBuffer`, and `Uint8Array` form.
  - `packages/action/src/repository.ts:95` — `rejects invalid bounds before reading a captured source path`.
  - `:113,117` — the unsafe top-level path and forbidden-segment tables.
  - `:132,134,139` — directory, oversized, and changed-during-read policy tests.
  - `:149` — `requires a non-empty GitHub token`.
  - `:172,175,178` — invalid repository/SHA, head ref, and PR number cases.
  - `:202` — `fails closed when no validated ref resolves to the exact SHA`.
  - `:214,218,226` — source request count, checkout containment, and line-number tests.
  - `:235` — `rejects traversal and every symlink component`.
  - `:272` — `rejects a referenced line beyond the end of a fully scanned file`.
  - `:303` — `policy is read only from the exact commit and symlinks fail closed`.
  - `:319,324,335` — invalid fix input, mismatched checkout HEAD, and mismatched fix parent tests.
- Orchestration and healing checklist:
  - `packages/core/src/orchestrate.ts:225,228,235,238,241,244,247` — the captured `rejects captured run metadata` table.
  - `:369,372,395` — source file limit, extra response, and structurally unsafe excerpt tests.
  - `:511,515` — missing and ambiguous audited-candidate identity tests through `resolveAuditedCandidate`.
  - `:546` — `replays live crash B4`; the pre-fix slice loses the command and the current adapter retains it.
  - `:552` — the existing repeated-attempt and claimed-crash tests.
  - `:566,575` — captured A2 runtime-conflict and unverified-Python-image tests.
  - `packages/core/src/heal.ts:167,227` — bounded stage evidence and missing routing quote tests.
  - `:1221,1224` — non-empty context and failure-command tables.
  - `:1242,1247` — runtime conflict and verified Python digest tests.
  - `packages/core/src/source-window.ts:46` — `rejects a referenced line beyond the available source window`.
- Historical boundary statement: B2 remains the captured A1 push regression, B4 is the captured A3 log-slicing regression, and repository guard inputs use captured log paths plus local temporary filesystem construction. No historical bundle is described as having a repository capture.
- Verification: Core 928 passed and 8 skipped; Action 116 passed; captured fixture contracts 25 passed; repository typecheck and lint passed; `ci:fast` passed with 52 release contracts, 3 README tests, a fresh build, bundle identity verification, 116 Action tests, and 93 CLI tests; `git diff --check` passed.
## Phase 3b exit evidence

- Interim inventory: `packages/core/src/guards-3b.test.ts` derives 120 canonical `throw new` guards across the ten Phase 3b source files. It does not claim reachability. The merged Phase 3c scanner and `@vitest/coverage-v8` replace this inventory with statement-to-line `guards:verify` evidence.
- Focused guard suites: 207 passed across Nebius, JSON extraction, token factory, routing, cost, provider canary, Tavily, ConTree, memory executor, live diagnostics, and the interim checklist.
- Core suite: passed.
- Captured fixture contracts: 25 passed.
- `ci:fast`: passed after the generated Action bundle was committed with the Core control-flow change.
- Typecheck, lint, build, Action bundle verification, and `git diff --check`: passed.
- Synthetic provider evidence pending Phase 5: Nebius success and malformed response shapes, transport rejection, retry exhaustion and deadline, 400/401/404/429/503 bodies, and the labeled live-run-16 `reasoning_effort: none` 400 shape. The committed synthetic fixture is `provider/error-shapes/live-16-reasoning-effort-none.synthetic.json`.
- Synthetic Tavily evidence pending Phase 5: search and extract success shapes, transport rejection, non-success status, JSON parse failure, null/non-object bodies, missing/non-array results, invalid citations, snippet bounds, and invalid input/configuration. The committed fixtures are `tavily/search.synthetic.json` and `tavily/extract.synthetic.json`.
- Synthetic ConTree evidence pending Phase 5: import/run/snapshot operation responses, transport and timeout paths, operation status and cancellation, Location validation, file-upload IDs, output encoding and metrics, snapshot option/path/workspace validation, non-git and git symlink handling, `.npmrc` and embedded credential rejection, file/source/archive caps, and overlay shell safety. Existing `executor/__fixtures__/*.json` plus temporary local repositories provide these shapes.
- Pending captured boundaries are explicit in `packages/core/src/__fixtures__/captured/pending-boundaries.phase-3b.json`: `provider`, `tavily`, and `contree`, all pending the separately authorized Phase 5 session. No live provider, Tavily, or ConTree call was made in Phase 3b.
- Deleted unreachable guard: the final Nebius `request failed unexpectedly` throw was unreachable because each final retry path throws inside the loop; the loop is now structurally unbounded with terminal guards. The provider-canary non-canonical replacement guard remains required because diff construction normalizes line endings and a missing final newline; CRLF and missing-final-newline regressions now reach it.

## Deviations

### Phase 3a historical repository input source

- Plan said: Build repository guard fixtures from the dogfood-16 bundle's recorded `readSourceExcerpts` paths.
- Found: The approved historical corpus is intentionally GitHub/log-only and every historical bundle has an empty repository stream.
- Chose: Parse the source path from the captured dogfood-16 job log, then create the symlink, traversal, `.git`, limit, and policy inputs only in local temporary directories.
- Why: This keeps historical evidence within its authorized boundary and does not falsely describe locally constructed repository inputs as captured repository calls.

### Phase 3a structurally unreachable guards

- `packages/core/src/github/adapter.ts` base availability: every valid PR path assigns `baseSha` and `baseRef` together; every fallback direct-run path also assigns both together.
- `packages/action/src/repository.ts` source escape: every path component is checked with `lstat` and symlinks are rejected before `realpath`, so the resolved path cannot leave the real checkout root.
- `packages/action/src/repository.ts` policy escape: the policy has one fixed filename under the real checkout root and its terminal symlink is rejected before `realpath`.
- `packages/core/src/heal.ts` missing race result: `race()` rejects a cardinality mismatch and returns one result per approved candidate; every non-approved candidate is inserted into `refusedCandidates` before the merge.
- Chose: Delete these four guards. Keep the policy changed-during-read guard by extracting the bounded policy read into a directly tested helper.
- Why: The run-time guard target must contain reachable fail-closed decisions, not branches whose negated invariants were already established by earlier code.

### Phase 3a GitHub adapter path correction

- Plan said: Enumerate and test the GitHub adapter guards in `packages/action/src/github.ts`.
- Found: Phase 2 moved the transport-neutral adapter and its guards to `packages/core/src/github/adapter.ts`; the Action file now contains only its artifact-wrapper guards.
- Chose: Derive and test guards from both current files, with the Core adapter in the Phase 3a action scope.
- Why: Guard coverage must follow the production implementation that owns each fail-closed decision after the approved Phase 2 architecture change.

### Local capture source validation

- Plan said: Validate every manifest `source` as a public GitHub run URL, while the manifest type also allowed a capture commit SHA for local captures.
- Found: The 26 historical bundles were captured locally through read-only `gh api`; labeling them as workflow captures would give false provenance, and a fixture commit cannot refer to its own SHA.
- Chose: Commit the capture tool first, label every fixture `capturedBy: 'local'`, and bind `source` to capture-tool commit `c026b69`; validate workflow URLs only for workflow captures and exact commit SHAs for local captures.
- Why: The two-commit sequence gives honest, immutable, non-self-referential provenance.

### Logical Executor recording

- Plan said: Record the three provider HTTP transports, GitHub API calls, and repository calls.
- Found: ConTree HTTP does not describe the logical sandbox operations that deterministic replay must reproduce.
- Chose: Add a Core-owned `Executor` decorator that records import, snapshot, run, run-many, capacity, and cancellation calls in call-start order.
- Why: The logical Executor stream is the canonical sandbox replay boundary; ConTree HTTP remains diagnostic evidence.

### Deterministic orchestration configuration

- Plan said: Capture external boundary inputs and outputs.
- Found: Boundary records alone do not preserve triage, race, budget, search, runtime, image, model-routing, or operation-limit choices.
- Chose: Store the validated orchestration configuration in each replay bundle.
- Why: Offline replay must use the same controller inputs as the captured run.

### Checkout runtime snapshot

- Plan said: Record repository calls and their results.
- Found: `checkoutHead` returns an ephemeral path, while runtime detection later reads files at that path.
- Chose: Record a bounded, path-safe runtime-evidence snapshot and replace later checkout arguments with a stable recorded checkout ID.
- Why: Replay can materialize the same runtime inputs without depending on the original runner filesystem.

### Explicit completeness

- Plan said: Bound recorded calls and bodies.
- Found: Silent call limits, truncation, capture failures, and unfinished asynchronous calls could produce a bundle that looked complete.
- Chose: Record `complete`, `overflowedBoundaries`, and `pendingBoundaries`; reserve sequence numbers at call start; preserve raw JSON-failure bytes; and mark any unavailable body evidence incomplete.
- Why: A replay consumer must distinguish complete evidence from partial capture.

### Capture sanitation and exact body evidence

- Plan said: Store bounded, redacted replay evidence without changing provider response behavior.
- Found: Deep final redaction could corrupt large raw bodies; non-UTF-8 bytes could retain credentials; generic JSON conversion could silently lose keys or structure; and cloned provider responses added an unbounded duplicate allocation.
- Chose: Sanitize metadata, configuration, and records once; mark structural loss on its boundary; store unsafe non-UTF-8 evidence as hash-only truncation; recognize only the exact capture-truncation shape; and consume each provider response once while rebuilding its JSON/text methods from the captured bytes.
- Why: Complete bundles must be credential-safe, byte-exact within the body limit, and explicit about every lossy transformation.

### Cancellable ConTree request capture

- Plan said: Record the ConTree HTTP request and response without affecting the transport result.
- Found: A rejected transport could wait forever for a tee branch whose request stream never completed.
- Chose: Cancel unfinished request capture on transport rejection, record immediately available bodies or null partial evidence, mark the HTTP boundary incomplete, and rethrow the original error promptly.
- Why: Best-effort replay capture must never delay or replace the product transport failure.

### Shared dependency snapshot primitives deferred

- Plan said: Capture the bounded checkout evidence that runtime detection needs.
- Found: Runtime dependency validation, ConTree workspace snapshots, and replay evidence capture use different path sets, byte limits, error types, and security semantics.
- Chose: Keep the Phase 1 replay reader and canonical path set local to the repository recorder.
- Why: Extracting one shared abstraction would change established runtime and ConTree contracts; the replay materializer can define the common contract in Phase 2.

### Final upload sequencing

- Plan said: Upload the replay bundle while preparing the HTML report.
- Found: Pull-request publication, attempt-comment updates, and terminal check completion occur after report preparation.
- Chose: Upload one best-effort replay bundle only after all outcome mutations and check completion, including the unexpected-failure path.
- Why: The uploaded bundle contains the final requested mutations without changing the product outcome if capture or upload fails.

## Phase 3c exit evidence

- The TypeScript-AST scanner derives guard locations from `throw new`,
  `process.exit(...)`, and `core.setFailed(...)`. It excludes tests, test
  support, rethrows, and an explicitly marked `guards-verify: not-a-guard`.
- Batch-branch scan counts at base `5d94e0a` were 78 Action and orchestration
  guards, 121 provider guards, and 234 Phase 3c guards. The one proven
  unreachable Phase 3c guard was deleted, so the final Phase 3c scope is
  `guards: 233/233`.
- The exact Phase 3c checklist is generated on every run with
  `pnpm run guards:verify -- --scope phase-3c --scan-only --list`; the scoped
  coverage gate verifies the same derived set with
  `pnpm run guards:verify -- --scope phase-3c`.
- The final scoped coverage run completed in 18.29 seconds: Core 884 passed
  and 8 skipped; Action 85 passed. This is below the 90-second limit.
- The original eight uncovered locations closed as follows:
  - `packages/action/src/main.ts`: missing ConTree configuration, malformed
    `GITHUB_RUN_ID`, and terminal `setFailed` use the side-effect-free
    `runAction` dependency seam.
  - `packages/core/src/replay/canonical-json.ts`: a Symbol reaches the
    non-JSON-serializable terminal.
  - `packages/core/src/replay/replay-fetch.ts`: non-replayable binary evidence
    is rejected.
  - `packages/core/src/replay/validate.ts`: an unknown recorded-body shape is
    rejected.
  - `packages/core/src/runtime/python.ts`: an empty checkout reaches the
    missing-lock terminal.
  - `packages/core/src/engine/triage.ts`: the post-loop throw was deleted as
    structurally unreachable.
- The dogfood-16 runtime fixture is bound to target run `33268037618` and exact
  head `7488afea0c123f3ef84354301c6a1d90e4f9cfb0`. Its `.sutura.json` and three
  directory listings came from that local Git object. Tests use both the
  configured runtime and captured path evidence.
- Additional notable inputs cover a second reservation with `modelTurns: 1`,
  a 65,537-byte diff, runtime directory replacement and realpath escape,
  Python file replacement and UTF-16 input, and each missing Ultra reply
  field.
- Scanner tests, focused Core and Action tests, release contracts, typecheck,
  and lint passed. The committed Action entry point calls `runAction`, while
  importing `main.ts` in tests has no side effect.

### Phase 3c structurally unreachable guard

- Deleted: `packages/core/src/engine/triage.ts` post-loop throw, formerly line
  81.
- Proof: each iteration appends exactly `min(2, N - exitCodes.length)` results.
  When the final batch reaches `N`, `evaluateFlakeConfidence(exitCodes, N)` is
  at its maximum and cannot return `continue`; the function returns the
  completed verdict inside the loop.

### Phase 3c batch deviation

- The plan's final `guards: N/N` is an integration criterion because Phases
  3a, 3b, and 3c use separate batch branches.
- This branch therefore runs the same dynamic scanner and coverage mapper with
  `--scope phase-3c`. After integration, the unscoped CI command re-derives
  and verifies the combined total. No count is hard-coded in the scanner or
  CI workflow.
### Canonical dogfood fixture ordering

- Plan said: Store `return left - right;` in the fixture while also requiring `break.diff` to turn the fixture red and `repair.diff` to turn it green.
- Found: The Placebo corpus contract starts every fixture green, then applies `break.diff` and verifies that `repair.diff` restores the green state.
- Chose: Store `return left + right;` in the fixture, copy it into the dogfood worktree, and apply `break.diff` before committing the intentional failure.
- Why: The live dogfood commit still contains the required subtraction, while the canonical corpus remains self-checking and reproducible.

### Clean-checkout dogfood command

- Plan said: Run `node scripts/dogfood.mjs` directly from the package script.
- Found: The gate imports the Core provider-contract version, while `packages/core/dist/` is ignored and absent from a clean checkout.
- Chose: Build `@sutura/core` before starting the dogfood script.
- Why: The documented gate must work from a clean exact-SHA checkout without relying on stale local build output.

## Phase 4 exit evidence

- Canonical case: `repair-dogfood-arithmetic`; content hash `7a96845fc1a9d0bed0b6d7266dd1f46c37b0ad50b2b079b48eb66d05e619c59a`; 52-case corpus hash `14a7540f082966e1884aeb884603dae50e2b3246592581868efd5d63e85e898b`.
- Fixture proof: the full Placebo corpus self-check passed 20/20 harness tests, installs the nested workspace offline, accepts the clean addition, rejects the broken subtraction, and accepts the canonical repair.
- Ledger schema: `sutura-dogfood-ledger-v1`; initial entries `[]`; result hash `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`.
- Release-contract tests: 65 passed. The final dogfood and capture correction suite passed 32/32. Repository typecheck, lint, build, and `git diff --check`: passed.
- Final review corrections: enforce the hard USD 10 cap and minimum USD 1.50 initial reserve; restart attempt numbering at 1 for a new candidate; refuse reuse after a non-fixed outcome; parse exact `gh run view --log` prefixes from captured run `33269188958`; and promote the exact complete `gave-up` replay bytes with all streams and the recorded outcome intact.
- Simplification corrections: reject attempt 11 before the gate or any remote action, and inspect each completed Sutura run's artifacts only once during correlation polling.
- Merged `develop` gate on `5292df70bf09bcff90fbfebb611b493c960548db`, after exact-SHA push CI run `33311333754` passed: `clean-tree`, `origin-develop`, `develop-ci`, `ledger`, and `packages-tree` all reported `PASS`; `provider-canary` alone reported `FAIL: missing successful provider canary run`, as required before the separately authorized Phase 5 canary.

## Phase 1-4 integration evidence

- Integrated verification commit: `826ceaf08a342a1b89bb6d16bc96ef737fb86a43`; Action bundle SHA-256 `f0b696f057a26fe0f703f7e20aaec1fbeec4c029e416f0393365b65dfb06da36`.
- `ci:fast`: passed with 69 release-contract tests, 3 README tests, Action 118/118, CLI 93/93, typecheck, lint, build, and exact bundle identity.
- Dynamic guard gate: `427/427`; Core coverage 1020 passed and 8 skipped; Action coverage 118 passed.
- Captured-fixture contracts: 26/26 passed and retained 26 unique manifest-backed historical partial bundles.
- `ci:local`: passed after one isolated load-sensitive Core timeout did not reproduce; the clean rerun passed Core 1020, Action 118, Evaluation 5, CLI 93, Placebo 72, offline runtime smoke, package build, bundle identity, and packed install.
- The required integrated `codex-simplify` review found no remaining reuse, quality, or efficiency blocker. The complete acceptance sequence then passed again; the repeated Placebo suite passed 72/72 and the packed install used Action `826ceaf08a342a1b89bb6d16bc96ef737fb86a43`.
- No provider canary, live dogfood attempt, or repair branch was dispatched in Phases 1-4.

## Phase 5 gave-up loop evidence

- Live run `33321172589` repaired the replay capture path but gave up because the bounded source closure did not include the dogfood source. Its complete recovered bundle is fixture `33321106629`; total measured spend was USD 0.838811.
- Candidate `02c75f150a36633a19c1d28407d211680931dc82` passed exact-SHA CI run `33323313586`, provider canary run `33323718184`, and all six dogfood gate checks before the next paid attempt.
- Live run `33323856253` made the canonical `left - right` to `left + right` repair twice. The Core workspace passed 1030 tests after the patch. The attempt gave up because the automatic trusted command reran `pnpm -r test`; the unrelated Placebo corpus then failed in the intentionally modified dogfood checkout and the sandbox returned `-1`. Its complete bundle is fixture `33323765566`; attempt spend was USD 0.814220 and cumulative spend was USD 1.653031.
- New live captures declare `repairVerificationScope: failing-workspace`. A recursive pnpm diagnosis is scoped only when one failure-marked `packages/* test:` prefix is present; ambiguous logs keep the full command. Historical bundles without the field replay with `full`, so their recorded Executor calls remain exact. The repair PR CI remains the independent full-repository check.
- No further paid attempt was dispatched before the new live bundle had a named replay regression, focused tests, dynamic guard coverage, captured-fixture validation, and the local acceptance gate.
- Candidate `c6ec76d3eb3f5c61bccc7cfaad777d766f0ef46d` passed exact-SHA CI run `33325295547`, provider canary run `33325881533`, and all six dogfood gate checks. Live Sutura run `33326031664` then produced the canonical one-line repair and passed the scoped Core test, but refused the candidate before publication because the Ultra response included valid approval JSON with `tool_calls: null`. The provider parser rejected `null` before reading the content. The complete refused bundle is fixture `33325938237`; attempt spend was USD 1.058483 and cumulative spend was USD 2.711514.
- The provider parser now treats omitted and null `tool_calls` as the same empty list, while still rejecting null content without valid calls. The exact Ultra response is a named live regression test. Dogfood automation now promotes both `gave-up` and `refused` complete bundles, so all non-fixed model or audit evidence survives candidate replacement.

### Phase 5 total-cap extension

- Plan said: Stop all Phase 5 live work at USD 10.00 and compute streak spend from the trailing fixed entries for the current candidate.
- Found: Three repaired non-fixed candidates had already spent USD 2.711514, and six fixed samples on candidate `a99e231` brought total Phase 5 spend to USD 9.153422. The reserve correctly stopped attempt 7, but four samples remained.
- Chose: After the user's 2026-08-31 authorization, raise the total Phase 5 cap to USD 14.00 and make the runner count every scratch-ledger entry against it. Preserve exact candidate `a99e231` by resuming attempts 7-10 with the existing `dogfood run` subcommand and the same total-ledger reserve check before each dispatch; land the controller correction only after the live streak.
- Why: This directly enforces the authorized total across candidate replacements, leaves enough reserved headroom for attempts 7 through 10, and does not reset the six existing samples by changing their exact candidate SHA.
