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
