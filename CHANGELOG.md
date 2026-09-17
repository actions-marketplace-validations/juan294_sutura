# Changelog

## [Unreleased]

## [0.3.1] - 2026-09-17

### Added

- Repair proposals and diagnosis hypotheses request `response_format: json_object` instead of `json_schema`; the proposal and hypothesis contracts are enforced locally (`parseProposal`, `validateHypotheses`). Provider contract `sutura-super-repair-v6`. Reason: on 2026-09-16 Nebius Token Factory's schema-guided decoding began dropping string escapes (`{n  return` for `{\n  return`) on every Nemotron model, producing uncompilable patches; the same request with `json_object` is correct. Raw evidence in `packages/core/src/llm/__fixtures__/nebius-json-schema-drift-2026-09-16/`; replay compares the two request shapes as one so bundles captured before the change still replay.

- Optional GPT-6 Astra second opinion on the adjudication gate: when `OPENAI_API_KEY` is configured, a different provider re-runs the same adversarial audit as a veto-only check (it can reject a Nemotron approval but never approve on its own); absent, failed, timed out, or over its own USD 0.30 budget, it is recorded `skipped` and the run proceeds on Nemotron alone. The runtime model remains Nemotron on Nebius Token Factory.
- Optional TypeSafe Jev calibrated audit as a third, veto-only voice on the adjudication gate: when `TYPESAFE_API_KEY` is configured, a System One decision model answers the same adversarial question as a typed choice with calibrated probabilities (it can reject a Nemotron approval when P(green-wash) is at or above 0.5 at confidence at or above 0.7, but never approve on its own); uncertain, absent, failed, or over its own USD 0.02 budget (`repair-typesafe-audit-usd`), it is recorded and the run proceeds on the other gates. The call is recorded as an optional `typesafe` replay boundary.
- The public Case Lab tracks the newest release tag: `release:case-lab` gate wired into pre-push and CI, release-mode Placebo benchmark (`--release-tag`), and the Case Lab live-run cap raised to 24 runs / USD 18 per day.

### Fixed

- Replay bundle identity checks (`publish.ts`, `replay.ts`) compare `actionSha` against the release commit instead of the demo commit, fixing a v0.3.0 regression that blocked every live Case Lab dispatch from publishing a result.
- `release:case-lab deploy` links to the correct Vercel project by name before building or deploying, instead of silently creating a new one when no local link exists.
- Replay compares `updateCheckRun` without the checkout-derived check annotations, so a real live bundle replays deterministically; the v0.3.0 Case Lab live bundle (run 34977342282) is now a named replay fixture for the `gave-up` path and for the release-bound `actionSha` guard.
- `release:case-lab` resolves repository paths against the repository root and builds `@sutura/case-lab` before `verify-pin`, so `check` and `bump` behave the same from any working directory or fresh worktree.
- `runTest` no longer discards a trusted test run's evidence when its combined stdout+stderr exceeds the 16KB cap; it now always records the bounded, truncated output and lets the actual exit code decide pass/fail, instead of refusing a possibly-correct patch outright.
- The public demo's repair-monitor workflow had lost its `case-lab/` and `matrix/` branch guards and its pinned Action reference; both are restored, and the demo's own contract tests are now shape-based instead of asserting literal pinned values, so they cannot silently go stale the same way again.

## [0.3.0] - 2026-09-14

### Added

- Add cumulative fleet dogfood metrics with bounded evidence collection, collaborator-repository support, and separate counts for attempted, claimed, provider-invoked, search-started, fixed, non-repairable, and unknown runs.
- Add structured terminal-failure telemetry for Action identity, target commit and pull request, failure code and stage, runtime detection, provider calls, sandbox operations, search state, and terminal-comment state.
- Add `SUTURA_DISABLED=true` as a repository-level opt-out for deferred or unsupported projects.

### Fixed

- Detect the project runtime from root manifests before scanning nested files, while bounding traversal and retained evidence for large monorepositories.
- Bind replay and terminal evidence to the installed Sutura Action commit instead of GitHub's default-branch workflow SHA.
- Complete an existing pull-request or commit comment when a claimed repair attempt terminates unexpectedly.
- Preserve infrastructure stops and distinguish non-repairable CI conclusions in fleet metrics.
- Let the CLI bundle and Placebo patch-sweep verification finish before their test processes exit.

### Changed

- Record the clean Stage 3 development and validation measurement: 80/80 terminal results, 15/15 deceptive patches rejected, zero false approvals, and zero infrastructure stops.
- Refresh production and development dependencies.

Retired guidance: none.

## [0.2.1] - 2026-09-13

### Added

- Reject ES module `import`/`export` syntax introduced into CommonJS files as an unsafe repair, naming the target module system and the policy violation.
- Add a `develop` push freeze (`pnpm run push-freeze on|off|status`) shared across worktrees; `.husky/pre-push` refuses to push while a paid live run has the branch frozen.
- Verify patches supplied by other agents through the same isolated reproduction, challenge, policy, clean-rerun, and audit pipeline used for generated repairs.
- Add controller-owned behavioral challenges, bounded two-file repair transactions, deterministic replay views, and candidate-bound evaluation tooling.
- Add the public Case Lab, sanitized ATIF and Data Lab exports, maintainer-study tooling, and a complete Devpost submission gallery.

### Fixed

- Pin the Python repair runtime to an importable Linux image manifest and prove Python, `uv`, Git, and tar availability before live evidence runs.
- Preserve safe vendored `file:vendor/...` packages during isolated dependency preparation so grounded upstream repairs can run.
- Emit bounded terminal failure evidence when the Action or matrix stops before a normal case file exists.
- Keep unavailable cost evidence as unknown instead of reporting an unproven zero.
- Retry one invalid diagnosis response under the same strict schema and cost envelope, then fail closed.
- Recover adaptive search branches that repeat an identical proposal by requesting a materially different repair instead of stalling.
- Preserve cumulative benchmark spend and pending GitHub jobs across restarts, including delayed workflow-title recovery and terminal notifications.
- Preserve the primary Action outcome when later output writes fail, and harden four CodeQL-reported regular expressions against polynomial backtracking.

### Changed

- A Super reply that reaches the completion-token limit now ends only its own search branch; the search stops early only when such replies outnumber applied proposals.
- Split hidden repair preservation from deceptive-patch rejection in the v2 Placebo score contract.
- Require the provider and Python runtime canaries in candidate and dogfood gates.
- Make candidate benchmark and matrix evidence bind to measured package content, exact commits, and complete terminal outcomes.
- Expand Placebo v0.2 to a frozen 100-case inventory with development, validation, flake, deception, upstream, and hidden-preservation strata.
- Refresh development dependencies and document the completed 80-case development measurement, including its failed repair and hidden-preservation gates.

Retired guidance: none.

## [0.2.0] - 2026-08-31

### Added

- Add a bounded repair agent with adaptive checkpoint search, exact source targeting, automatic patch verification, and an independent final audit.
- Add deterministic model routing, progressive flake triage, model-specific Nebius Token Factory contracts, and an exact-SHA provider canary.
- Add verified Python repair support with locked dependency preparation and network-disabled execution.
- Expand Placebo v0.2 with JavaScript and Python repair, flake, upstream-release, and adversarial policy cases.
- Add deterministic replay capture, offline orchestration, sanitized ATIF exports, GitHub Checks, and reduced-assurance audit-only mode.
- Add candidate and public package verification, external release matrices, fail-closed release evidence, and the canonical 10/10 live repair ledger.

### Fixed

- Make live repairs controller-owned, bounded by exact source ranges, and automatically verified before acceptance.
- Correct provider thinking controls, tool-call handling, zero-reasoning usage handling, and null tool-call compatibility.
- Fail closed on incomplete, malformed, drifting, or lossy replay evidence.
- Preserve trusted workspace paths, fixture bytes, Git environments, and repair completion limits.
- Make Sutura's own workflow fail unless the product outcome is `fixed`.

### Changed

- Resolve the `v0.2.0` Action tag to an immutable commit during setup and verify the pin with `doctor`.
- Replace fixed candidate races with adaptive repair search and explicit branch, operation, time, inference, tool, and diff budgets.
- Make Sutura workflow rows describe whether repair was requested, unnecessary, or not triggered.
- Strengthen local, pre-push, exact-SHA CI, package-install, guard-coverage, and release-publication contracts.

## 0.1.1 - 2026-08-28

- Use a unique GitHub Marketplace name for the public Action.
- Repair actionable failures from every GitHub Actions event with an exact head branch.
- Record direct-run evidence as a comment on the failing commit.

## 0.1.0 - 2026-08-28

- Verify failed GitHub Actions runs with isolated reproduction and repair races.
- Reject flaky failures and unsafe shortcuts before publication.
- Open evidence-backed pull requests for human review.
- Install the public GitHub Action through the `sutura` npm CLI.
- Keep provider billing with each repository through bring-your-own-key setup.
