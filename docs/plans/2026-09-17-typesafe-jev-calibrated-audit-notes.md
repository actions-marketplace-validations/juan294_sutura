# `2026-09-17-typesafe-jev-calibrated-audit` — Notes

## Deviations

### Phase 1: audit question wording adapted to the production state keys

- **Plan said:** the questions are "verbatim from the probe plus `unrelated_change`".
- **Found:** the probe's state used `repo` and `candidate_diff`; production state is
  the bounded adjudication context with `diagnosis`, `candidateDiff`, `beforeLog`,
  `afterLog`.
- **Chose:** keep the criteria verbatim and point the instructions at the production
  keys, with a code comment saying the field names were adapted.
- **Why:** questions must reference the fields that exist in `state`; the criteria,
  which carry the measured policy, are unchanged.

### Phase 1: the ledger records the resolved model, not the requested alias

- **Plan said:** `ledger.add('ultra', this.model, usage, TYPESAFE_PRICE)`.
- **Found:** the live response resolves `jev-latest` to `jev-1.13.0`.
- **Chose (review request):** charge the ledger and report the decision under
  `response.model`; the client validates it as a non-empty string; the parser also
  rejects an answer whose own `type` disagrees with its question's type.
- **Why:** README's principle that a ledger entry names the actual routed provider
  model; the calibration probe is only valid for the snapshot the alias resolves to;
  a type mismatch is the shape of the 2026-09-16 Nemotron drift.

### Phase 2: replay validation also exempts the new budget key from the integer check

- **Plan said:** the integer exemption lives in `engine/repair-budget.ts` `boundedLimit`.
- **Found:** `replay/validate.ts` `validateRepairBudgets` duplicates that list, so a
  bundle recording `typesafeAuditUsd: 0.02` would fail as "must be an integer".
- **Chose:** exempt it there too; the simplify pass then replaced both lists with one
  exported `USD_BUDGET_KEYS` set.
- **Why:** replay of a bundle recorded with the new budget must validate.

### Simplify pass (after Phases 1 and 2): two findings deferred

- **Found:** the retry/backoff scaffold now exists three times (`nebius.ts`,
  `openai.ts`, `typesafe.ts`), and the skip-reserve-call-settle envelope exists
  twice (`secondOpinion`, `typesafeAudit`).
- **Chose:** not extracted in this cycle; `nebius.ts` and `openai.ts` are outside the
  reviewed diff and the launch time-box is fixed.
- **Why:** both are pre-existing duplication this diff extends rather than creates;
  they are recorded here as follow-ups for v0.3.2.

### Phase 2: the Action bundle is rebuilt on the integration branch, not in Phase 3

- **Plan said:** Phase 2 does not rebuild `packages/action/dist/index.cjs`; Phase 3
  rebuilds it once.
- **Found:** `scripts/verify-bundle.mjs` (in `ci:fast`, `ci:local`, and `ci.yml`)
  fails whenever the committed bundle lags the source, and Phase 2 changed
  `packages/action/src/input.ts`; `ci:local` on the merged branch stopped there.
- **Chose:** rebuild and commit the bundle on `jev-phases-1-2` before review; Phase 3
  rebuilds it again with its own changes.
- **Why:** `.claude/rules/ci-parity.md` requires the bundle in the same commit as any
  core or action source change; deferring it would have left the branch unpushable.

### Verification: one pre-existing local failure in `ci:local`, outside this branch

- **Plan said:** `ci:local` green on the merged tree.
- **Found:** every gate passed except the Placebo corpus self-check
  (`packages/placebo/src/corpus.test.ts` "proves every break patch is red and every
  clean fixture is green"), which fails on this machine for the single fixture
  `upstream-client-release` with `ERR_PNPM_NO_OFFLINE_TARBALL` (a different package
  each run: is-extglob, convert-source-map, @eslint/config-array, picocolors).
  Reproduced deterministically with a one-fixture self-check. The branch changes no
  file under `packages/placebo` (`git diff develop..HEAD -- packages/placebo` is
  empty), the vendored darwin runtime contains the packages, and `ci.yml` on
  `origin/develop` (`96e2411`, Linux) is green.
- **Chose:** treat it as a pre-existing local-environment defect, record it here and
  in memory, and not block Phases 1 and 2 on it. The pre-push hook runs `ci:fast`,
  which does not include this suite; CI on Linux is the gate of record.
- **Why:** a failure that is byte-for-byte independent of the change cannot be
  evidence about the change; investigating the darwin runtime is separate work.

### Phase 3: evidence row detail, construction tests, and the replay capture helper

- **Plan said:** `typesafeAuditEvidence` renders one string; `main.test.ts` mirrors
  "the Astra assertions"; the replay test builds a synthetic bundle.
- **Found:** no Astra construction assertions exist in `main.test.ts`; no existing
  test helper drives a run as far as the adjudication gate, so no bundle with audit
  exchanges could be synthesised from the old helper; the run-level wrapper in
  `evaluateRuntimeCandidate` overwrites any reasoning not prefixed `REFUSED` with
  `FAILED: adjudication: audit-refused` (pre-existing, identical for Astra).
- **Chose:** the row's detail is the short reasoning (`P(green-wash)=… confidence=…`)
  plus the four signals when not skipped, and `REFUSED by calibrated audit` uses the
  short form; three new construction tests with a mocked `orchestrate` and a
  network-free octokit fake; a new `complete-audit-bundle.test-helper.ts` that
  records a real `orchestrate()` run through the real recording wrappers so the
  replay test replays genuinely captured `openai` and `typesafe` exchanges (two
  pre-existing quirks are worked around inside the helper only: the git-apply tool
  echoes the diff on stdout, and replay reconstructs a Tavily client unconditionally);
  the Nemotron-and-Jev-both-refuse test asserts the reasoning is not attributed to
  Jev rather than asserting Nemotron's literal text.
- **Why:** each follows the existing mechanism instead of bending production code to
  fit the plan's wording; reviewers confirmed no production path was changed for a
  test.

### Phase 3: provider facts recorded in the research doc before the docs cited them

- **Plan said:** `docs/security/provider-processing.md` states the vendor facts read on
  2026-09-17.
- **Found:** the research doc's privacy bullet still said those pages remained to be
  read, so the docs cited facts with no recorded source.
- **Chose:** a dated addendum in the research doc (§5) quoting the privacy policy and
  naming the DPA and sub-processor URLs, committed before the docs merge.
- **Why:** verified claims name their evidence.

### Simplify pass (after Phase 3): applied and deferred

- **Applied:** one `vetoVoiceRows` composition (`packages/core/src/audit/veto-voices.ts`)
  builds the second-opinion and calibrated-audit rows and names the first active
  refusal, replacing the nested reasoning ternary in `verification/runtime.ts` and the
  asymmetric evidence string in `audit-only.ts`; two shared trace-event builders in
  `heal.ts` serve both `tracedTierLlm` and `tracedTypeSafeAudit`; the replay test
  helpers share one fixtures module; the inert octokit proxy in the Action test is
  reduced to a minimal guard.
- **Deferred:** (1) replay reconstructs optional providers by scanning recorded
  exchanges while it still constructs Tavily unconditionally; the deeper fix is the
  recorder declaring configured providers in the bundle configuration, which touches
  the bundle schema and both test helpers. (2) Astra and Jev are awaited sequentially;
  running them concurrently would save one round trip per audit but collides with the
  strictly ordered shared replay cursor. Both are follow-ups for v0.3.2.

### Phase 4: benchmark controller crash and a never-dispatched reservation

- **Found:** after 16 cases the streak controller died because its `gh run list
--limit 100` poll exceeded the 120 s subprocess timeout (killed with SIGTERM) and the
  script treats that as fatal. The manifest-spend account held a USD 1.00 pending
  reservation for `trap-deleted-test` (controller id `pl-1789641869467-00ba8524`,
  started 10:44:29Z). The resumed controller polled silently for a run with that
  title until its own 35-minute deadline.
- **Evidence:** `gh run list --workflow placebo-live-case.yml --limit 200` shows zero
  runs created after 10:40:00Z and zero runs whose title carries that controller id;
  the last case run is `trap-conditional-assertion-deletion` at 10:39:17Z. No run,
  no provider billing.
- **Chose (Juan approved 2026-09-17):** preserve copies of the account and the case
  ledger, set the pending entry to null with a `reconciliations` record naming the
  case, controller id, resolution `never-dispatched`, the evidence counts and
  `measuredUsd: 0`, then restart the streak from the 16-entry ledger with the freeze
  still on.
- **Why:** the manifest README allows reconciling a pending entry only against the
  exact run and measured cost; the measured cost of a dispatch that never reached
  GitHub is zero, and that is proven rather than assumed.

### Phase 4: infrastructure stop on `trap-snapshot-acceptance`, continued by decision

- **Found:** at case 24 of 51 the case run (35221136830) ended with outcome
  `infra-stop`: Nemotron Nano returned an invalid diagnosis response and the CLI
  stopped before any sandbox work. The artifact records USD 0 inference and sandbox
  with an empty ledger; the accounting kept the USD 1.00 reservation pending because
  an infra-stop's cost is unknown by rule, and the manifest stop policy ends the
  streak on any infra stop.
- **Chose (Juan approved 2026-09-17):** settle the reservation at the artifact's
  recorded cost (USD 0) with a `reconciliations` record naming the run, the cause
  and the recorded figures; continue the remaining cases with
  `SUTURA_ALLOW_INFRA_STOP_LEDGER=1`. The infra-stop entry stays in the ledger and
  in the release evidence, disclosed as a Nano provider failure unrelated to the
  Astra or Jev voices, which were never reached.
- **Why:** the tooling's own comment distinguishes a single transient provider error
  from a degraded environment and makes continuing an explicit operator decision;
  the decision and its evidence are recorded here rather than left implicit.

### Phase 4: second infrastructure stop on `repair-null-guard`, settled at an estimate

- **Found:** at case 47 of 51 the case run (35230408690) ended with outcome
  `infra-stop`: ConTree sandbox preparation failed with a socket timeout before any
  model call. The artifact states provider cost is unavailable, so the reservation
  could not be settled at a measured figure. The `streak` command always stops on an
  infra-stop ledger regardless of the operator flag, so the remaining cases were run
  one at a time through the single-case path, which honours it.
- **Chose (Juan approved 2026-09-17):** settle the reservation at an explicit
  upper-bound estimate, the highest per-case cost recorded in this run (USD 0.189624,
  `upstream-formatter-release`), marked `measured: false` in the account, and finish
  the last four cases. The release evidence discloses two infra-stops, one Nano and
  one ConTree, both before any audit voice ran.
- **Why:** an unmeasured cost must not be cleared as zero; an explicit, labelled
  upper bound keeps the account conservative and the run honest.

### Phase 4: the benchmark workflow never passes the optional keys

- **Plan said:** expect at least one `gpt-6-astra` and one `jev-1.13.0` cost entry per
  adjudicated case in the release benchmark.
- **Found:** `.github/workflows/placebo-live-case.yml` at the tag passes only
  `NEBIUS_API_KEY` and `TAVILY_API_KEY` to the subject, so every case file in the
  v0.3.1 benchmark records both optional rows as `skipped: Not configured`. The
  v0.3.1 Astra phase had the same gap; its expectation was never true either.
- **Chose (Juan, 2026-09-17):** publish the benchmark as the release evidence with the
  gap disclosed in `docs/demo/sutura-v0.3.1-release-benchmark-evidence.md`, bump the
  Case Lab to v0.3.1, and rely on the public demo workflow, which does pass both
  keys, for the live smoke run that exercises the calibrated audit. Fixing the
  benchmark workflow needs a later release tag.
- **Why:** the tag cannot change; the release is already published; the Case Lab must
  track the newest release by design.

### Phase 4: measured v0.3.1 gates versus v0.3.0

- Zero false approvals; traps 17/19 (one Nano infra-stop, one gave-up); repairs
  10/18 against 15/18; hidden preservation 3/15 against 4/15; flaky 10/10; USD 3.77.
  The Case Lab recorded results now show `python-repair` as gave-up and
  `upstream-incident` as fixed; the replay test expectations were rebound to the
  new files. The fix-rate drop is recorded as unexplained, not attributed.

### Phase 4: the live publish path could never pass on a fresh tag; controller pin redefined

- **Found:** the first live smoke run at v0.3.1 repaired the case (`Sutura outcome:
fixed`, with the Astra and Jev voices configured) but the demo's
  `publish-result` step refused: "replay bundle actionSha e724f3b… must equal the
  release actionSha c94eee2…". The demo checks out the Sutura controller at
  `SUTURA_CONTROLLER_SHA`, and the release gate required that pin to equal the tag
  commit, whose own `packages/case-lab/release.json` is written before the tag exists
  and therefore names the previous release. Every first live publish after a tag
  failed by construction; the v0.3.0 record's Incident 2 fixed a different half of
  the same problem.
- **Chose:** `release:case-lab check` now requires the controller pin to name a commit
  whose committed `release.json` (read through the GitHub contents API, so a shallow
  CI checkout works) names the newest tag; `bump` no longer rewrites the controller
  pin, which is set in a follow-up commit once the bump commit exists; the demo
  workflow copy pins the controller to the bump commit `88446895…`. Tests cover the
  new rule and the bump semantics.
- **Why:** the controller must know the release it publishes; only a commit after
  the bump can. The Action pin and the subject identity are unchanged.
