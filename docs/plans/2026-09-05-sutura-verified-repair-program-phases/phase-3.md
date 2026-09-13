# Phase 3 — Atomic repairs across two related files

Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on Phase 2 and Phase 1 contracts. Sequential; **not batch-eligible**. Stop after implementation, review, simplification and local verification.

## Outcome and boundary

Repair a small coherent change spanning two related production files, or a dependency manifest and its generated lockfile, while retaining controller-owned targets, exact baseline identity, policy controls and fresh verification. The hard limit is **two changed files total, including any generated lockfile**. A migration requiring source, manifest and lockfile is outside this contract and must produce an explicit abstention.

Tavily-grounded migration remains part of the scope: verify the cited package/version contract, propose a related source pair or manifest/lockfile pair, and prove the candidate with executable checks. Adding citations does not establish successful migration. Code completion uses offline fixtures and recorded provider responses; Phase 10 owns separately authorized live success and with/without-grounding comparisons.

## Existing behavior and reuse

| Existing source | Relevant behavior |
| --- | --- |
| `packages/core/src/engine/repair-attempt.ts:141` | Current model contract returns one replacement for one controller-selected excerpt. |
| `packages/core/src/engine/repair.ts:390` | `anchoredEditsDiff` already supports bounded edits to multiple supplied paths. Reuse it. |
| `packages/core/src/engine/repair-tools.ts:382` | Patch application validates both proposed and resulting cumulative diffs; state advances only after accepted application. |
| `packages/core/src/engine/candidate-validation.ts:18` | Common policy/run-limit validation, extended by Phase 2 authorization. |
| `packages/core/src/policy/schema.ts:9` | Repository policy already has `maxChangedFiles`; do not raise it. The run's two-file bound can be stricter. |
| `packages/core/src/heal.ts:866` | Search builds controlled attempt contexts and feedback; candidate generation starts from the clean baseline. |
| `packages/core/src/engine/source-context.ts:139` | Existing resolved import relationships provide bounded candidate-pair provenance. |
| `packages/core/src/diagnose/tavily.ts:500` | Existing grounding validates and returns release evidence. |
| `packages/core/src/runtime/node.ts:9` | Existing dependency preparation disables lifecycle scripts and uses frozen installation. |
| `packages/core/src/engine/repair-budget.ts:73` | Run-wide budget reservations must include combined proposal and dependency work. |

Read these files completely before implementation. Positions refer to the planning snapshot; follow symbols after earlier phases integrate.

## Files owned by this phase

Proposed new files:

- `packages/core/src/engine/repair-targets.ts` and `repair-targets.test.ts`: bounded coherent target sets and stable slot identities.
- `packages/core/src/engine/dependency-transaction.ts` and `dependency-transaction.test.ts`: controller-owned manifest/lockfile generation and validation.
- `packages/core/src/engine/two-file-repair.test.ts`: executable atomic transaction, partial-patch and safety controls.
- New two-file development fixtures under `packages/placebo/corpus/`, with Phase 1 manifest/lineage registration.

Existing edits: `engine/repair-attempt.ts`, `repair.ts`, `repair-tools.ts`, `candidate-validation.ts`, `repair-budget.ts`, `heal.ts`, `orchestrate.ts`, runtime preparation and relevant tests; `diagnose/tavily.ts` only as required to carry verified package/version provenance into the transaction. Extend Phase 1 evidence and Phase 2 authorization without parallel schema variants. Update provider replay/contract tests and rebuild `packages/action/dist/index.cjs` with source changes.

## Design decisions

### Controller-owned target sets

Keep the existing one-file response contract supported. Introduce a versioned two-target contract whose model response identifies controller-supplied slots, never paths or line ranges. Each slot binds path, range, content hash and baseline identity. Choose only bounded related pairs: a resolved import relationship, or one root dependency manifest with its matching lockfile. Reject unrelated pairs and ambiguous dependency resolution.

Do not enumerate all combinations in an eight-file closure. At most two coherent pair candidates join the existing bounded search, within its existing maximum branch count. Single-file attempts remain available. Retain one clean baseline per attempt; parent feedback does not accidentally create a partially applied transaction.

Apply the stricter limit `min(2, repositoryPolicy.maxChangedFiles)` to the final cumulative diff. Validate both old and new paths. File creation/deletion/rename is unsupported in this initial two-file contract. Generated lockfile content is subject to overall diff-byte limits even though it is not a model completion.

Each model-edited excerpt retains the existing completion bound. Reserve combined request bytes, maximum output and execution cost before starting a branch. Detect incomplete replies and fail without applying either file. Recheck Phase 2 exact-path grants for any test/config target; a second file does not widen them.

### Atomic transaction and verification

Build one complete diff from exact baseline excerpts, validate all slots and the full diff, and apply it in one isolated branch with `git apply --check` followed by normal atomic application. Do not use `--reject`. Run the diagnosed trusted command only after the complete transaction exists. A failure applying or validating either file must leave the parent checkpoint untouched and prevent candidate submission.

Run the complete accepted diff through fresh audit and required repository commands, including both files and any generated artifact. Phase 1 identity must bind the whole transaction rather than only its first excerpt. Candidate selection, report links, replay and challenge inputs must identify the same full diff.

### Deterministic dependency tooling and Tavily

Initial manifest/lockfile support is Node with a single `package.json` and `pnpm-lock.yaml`, using the repository's pinned package-manager version. Other package managers and Python source+source repairs retain existing behavior; unsupported lockfile formats explicitly abstain. Do not imply generic Python lockfile migration support.

The model proposes only the exact grounded dependency-version change to an existing manifest key. The controller rejects lifecycle-script changes, registry changes, unpinned versions, local/URL/git dependencies, unrelated dependency changes and model-authored lockfile content. Resolve the matching lockfile with the pinned manager in a dedicated preparation lane, scripts disabled. Use only prevalidated public registry origins and required package-manager artifacts; reject lockfile references that introduce new unapproved origins.

Offline development fixtures provide cached packages and registry metadata, so local acceptance requires no provider or registry calls. For future live operation, dependency fetching is permitted only within the existing authorized preparation mechanism, with bounded operations and recorded provenance. Repair and audit branches remain network-disabled. Do not pass a source-bearing repair branch directly to a network-enabled executor: construct the minimal dependency-only preparation input, generate/install dependencies, then overlay the exact source and complete patch through the existing preparation architecture. Failure to prove this separation is an abstention, not an egress exception.

Freeze the resolution inputs and generated lockfile hash; rerun generation against the same cache/metadata to establish deterministic local output, then prove frozen installation. Reject unexpected generated changes, missing artifacts, insufficient byte/file budget and unsupported manager versions. Generated artifacts are included in full policy/audit checks and exact evidence identity.

Grounding provenance must contain the actual validated package, version and citation identity. A release page cannot select commands or override package/registry allowlists. Preserve the current upstream give-up outcome when required grounding is absent or mismatched.

## Pseudocode

```text
targets = controller.selectRelatedTargets(sourceClosure, diagnosisEvidence)
assert count(targets) in [1, 2]
assert final file cap <= repository policy cap
contract = versionedContract(targetSlots, hashes, baselineIdentity)
reserve combined model + tool + sandbox budget

reply = Nemotron.proposeReplacement(contract)
validate exact slots, complete strings and per-excerpt limits
edits = controller.attachPathsAndRanges(reply)

if manifestTransaction:
    validate exact grounded dependency change
    generated = pinnedManager.resolveLockfile(minimalDependencyInput)
    require approved preparation lane and deterministic resolution inputs
    require only the manifest and matching lockfile changed
    edits += controllerOwnedGeneratedLockfile

diff = anchoredEditsDiff(edits, baselineContext)
validate fullDiff, twoFileCap, bytes, Phase2 grants, repository policy
candidateBranch = applyCompleteDiffToCleanBaseline(diff)
if any operation fails:
    retain baseline; record failure; never submit partial candidate
run unchanged trusted checks on complete transaction
run full fresh audit and required policy commands
emit Phase1 verification identity for complete diff and executed checks
```

Use an explicit controller path for the generated file rather than pretending a large lockfile is a bounded model-selected source excerpt. This path has a separate generated-artifact byte bound within the overall run diff limit and cannot be invoked from arbitrary model tools.

## Executable acceptance artifacts

Start with failing integration tests and explicitly timed local process tests. Mock model responses may provide the two replacements; fixture execution must establish the test outcomes.

| Fixture/test | Required outcome |
| --- | --- |
| Proposed `repair-two-file-export-contract` | A producer/consumer API rename fails after either partial patch and passes after the complete two-file repair. |
| Proposed `python-repair-two-file-call-contract` | Two related Python production modules repair while untouched assertions and hidden checks pass. |
| Proposed `upstream-two-file-api-migration` | A pinned upstream release requires two related source edits; validated recorded Tavily evidence supplies the version-specific contract. Full repair passes, partial repairs fail. |
| Proposed `upstream-manifest-lockfile-pair` | Exact manifest update plus controller-generated lockfile passes frozen installation and unchanged behavior checks from an offline package cache. |
| Proposed `trap-two-file-test-shortcut` | A legitimate first edit plus weakened test/config second edit is rejected as one transaction. |
| Proposed `trap-two-file-third-path` | Third changed file, including an extra generated lockfile, is rejected before submission. |
| `repair-targets.test.ts` | Unrelated, ambiguous, duplicate, unknown and stale slots fail closed; pair selection stays bounded. |
| `dependency-transaction.test.ts` | Unapproved registry, scripts, unpinned version, changed unrelated dependencies, nondeterministic output and missing cached artifacts reject. |
| `two-file-repair.test.ts` | Failed second hunk, stale baseline, truncated reply, cancellation and budget exhaustion never create a submitted partial patch. |
| Existing `engine/repair-provider-replay.test.ts` | Historical single-file contract remains replayable; new replay identifies both files and full transaction hash. |
| Existing upstream fixtures | `upstream-client-release`, `upstream-parser-release`, `upstream-retry-release`, `upstream-formatter-release` retain their policy and grounding controls. |

The with/without-Tavily local test establishes that the code consumes grounding and preserves absence/mismatch behavior. It is not evidence of model-quality gain. Phase 10 reports the on/off production comparison as policy-gated capability evidence and separately evaluates retrieved evidence quality against executable truth.

## Automated success criteria and local commands

- [x] Both source+source language controls and the Node manifest+lockfile control pass executable local acceptance.
- [x] Named partial patches fail and the known complete repairs pass hidden preservation checks.
- [x] Two is the total changed-file cap everywhere, including generated artifacts and final audit.
- [x] All Phase 2 authorization, existing policy, test bypass and Python shortcut controls remain enforced.
- [x] Dependency preparation maintains minimal inputs, approved egress boundaries, disabled scripts and frozen final installation.
- [x] Whole-transaction identity, replay, budget reservations, cancellation and audit evidence agree.
- [x] Unsupported three-file migrations, formats and oversized artifacts yield explicit abstentions.
- [x] Process-spawning tests declare explicit timeouts of at least 30 seconds.

Run focused commands sequentially after adding the proposed files:

```bash
pnpm --filter @sutura/core exec vitest run src/engine/repair-targets.test.ts src/engine/dependency-transaction.test.ts src/engine/two-file-repair.test.ts
pnpm --filter @sutura/core exec vitest run src/engine/repair.test.ts src/engine/repair-attempt.test.ts src/engine/repair-tools.test.ts src/engine/repair-provider-replay.test.ts src/heal.test.ts
pnpm --filter placebo self-check
```

After implementation review, fixes and the dedicated reuse/quality/simplification pass, run sequential standard gates:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
pnpm run ci:local
```

Inspect the rebuilt Action bundle and complete diff. No remote CI, provider canary, hosted sandbox, Vercel preview or live benchmark is part of this phase's acceptance. Future pushes require the parent workflow-trigger inspection and authorization constraints.

## Manual review and completion

- [x] Reviewer can identify the two related files, why they must change together, grounding used, checks executed and remaining uncertainty from a case file.
- [x] Review verifies that the network-enabled preparation input cannot contain repository source or model-generated commands.
- [x] Documentation plainly names the supported transaction shapes and three-file/format limitations.
- [x] No live migration or cost-improvement claim is inferred from recorded responses or offline package fixtures.

Deliver the implementation summary, transaction-control results, local gates and supported/unsupported shapes. **Stop at the phase gate.** Phase 10 owns authorized live repair-quality measurement.

## Completion record — September 6

Implemented source: `f160501` (bounded target sets) and `e748e0c` (two-slot contract, dependency transaction, transaction file cap), plus the fixtures and acceptance tests in this phase's final commit. The Action bundle was rebuilt and committed with the core change and `pnpm run verify:bundle` reported parity. No push, provider inference, registry call, deployment or hosted sandbox occurred.

Controller-owned target selection decides which files may change together before any contract exists: every editable source alone, plus at most two pairs, where a pair is a resolved unambiguous import relationship or the root Node manifest with its lockfile. The two-slot contract names slots rather than paths or ranges, and a reply that adds, drops, repeats or renames a slot is refused instead of partially applied. `dependency-transaction` admits exactly one existing dependency moving between pinned releases and refuses every range, tag, alias, workspace, file, URL and git specifier as well as any edit outside the dependency sections. A generated lockfile is accepted only when the pinned manager produced identical bytes twice from approved origins, and the resolution lane receives the candidate manifest alone.

Local verification: workspace typecheck, lint and build passed; `verify:bundle` reported parity; focused `repair-targets` (12), `two-file-repair` (12) and `dependency-transaction` (28) suites passed; the core suite passed 1,419 tests with nine credential-gated skips. `repair-two-file-export-contract` and `python-repair-two-file-call-contract` fail after either partial patch and pass only as a complete transaction, and the Python case's hidden preservation checks fail on the partial patch and pass on the complete one. Both fixtures carry `evaluationRevision`, so the frozen default corpus selection and its `corpusHash` are unchanged and the committed counterfactual evidence stays valid.

Outstanding at the time of that record: whole-transaction identity, replay and
budget-reservation agreement. That is now built; see the section below.

## Acceptance fixtures completed — September 6

The four remaining controls from the acceptance table now exist and execute, all carrying `evaluationRevision` so the frozen 51-case default selection and its `corpusHash` stay unchanged.

`upstream-two-file-api-migration` pins a slugkit 1 to 2 release in which `slugify(text, options)` requires an explicit separator. Two related modules call it, and `page.js` imports `render.js`, so the controller's related-source rule pairs them. Repairing either file alone leaves the suite red; only the complete transaction passes. The case carries the release fact and `expectedWithoutTavily: gave-up`, so a reviewer sees the grounding a two-file migration rested on.

`upstream-manifest-lockfile-pair` is the strongest of the four. Bumping only the manifest and leaving the committed lockfile behind does not merely fail its tests — frozen installation refuses to run at all with `ERR_PNPM_OUTDATED_LOCKFILE`, which is what makes the manifest and its lockfile one transaction rather than two edits. Moving both installs and passes from the offline package cache. Target selection pairs the two paths and marks the lockfile controller-generated, so it is never offered for completion.

`trap-two-file-test-shortcut` pairs a legitimate caller edit with a weakened expectation, and `trap-two-file-third-path` smuggles a third changed path into an otherwise correct repair. Both fake fixes make the visible suite green, and the self-check confirms that. Each is refused by the seam that actually applies: the built-in patch policy names `touches test file: case.test.js` for the first, and the transaction cap refuses the second, whose three changed paths the built-in rules alone find unobjectionable.

One boundary worth stating: `validateDependencyManifestChange` deliberately refuses `file:` specifiers, and offline vendoring requires them, so the grounded registry-version validator remains proved by unit controls rather than by this fixture. The fixture proves the pairing, the frozen installation and the transaction boundary.

## Whole-transaction agreement — September 6

`two-file-transaction-evidence.test.ts` holds the four records of one two-file
repair against each other, and against the partial patches the transaction must
never be confused with. The attempt runs through `runControlledRepairAttempt`
with the two-slot contract, a stub provider and an in-memory sandbox reporting
the complete diff, so each assertion is made on a real submitted candidate
rather than on a constructed one.

Identity: the candidate's diff carries both `diff --git` headers, its hash is
the hash of the complete diff, and it equals neither half. `findSelectedCandidate`
matches the whole transaction and refuses a half carrying the same candidate id,
so a record cannot name the transaction and hold one of its files.

Budget: a two-file transaction charges one branch and one model turn, the same
as a one-file repair, because the transaction is one attempt rather than one per
file. With the branch budget spent, the attempt gives up as a budget failure,
carries no candidate and never asks the provider. An already-cancelled branch
does the same and charges no model turn, so neither exhaustion nor cancellation
can leave a partial patch behind.

Audit: the complete diff is what the audit reads. `validateCandidateDiff`
reports both paths, the diff bytes of the whole transaction, and no mechanical
violation. A third changed path in the same sandbox diff is refused before
submission, naming the transaction cap, even though the built-in patch rules
alone find the three paths unobjectionable.

Replay: evidence recorded under the transaction diff hash decodes only against
that identity. Substituting either half's hash as the expected identity is
refused, and a half's evidence carries a different comparison identity and a
different integrity hash, so a replay cannot silently accept one file of a
two-file repair.

9 tests. The core suite passes 1,621 tests with nine credential-gated skips.
