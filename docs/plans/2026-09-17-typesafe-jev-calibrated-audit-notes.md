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
