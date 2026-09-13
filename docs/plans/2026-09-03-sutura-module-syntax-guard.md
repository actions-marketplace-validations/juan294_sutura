# Sutura module-syntax guard plan

Date: 2026-09-03

Status: Implemented locally; live authorization gates pending

Integration branch: `develop`

Parent plan: `docs/plans/2026-09-01-sutura-v0.2.1-evidence-remediation.md` (inserts before its Phase 4 benchmark rerun, after `docs/plans/2026-09-03-sutura-search-recovery.md`)

## Objective

Reject, deterministically and before any model verdict, a candidate that introduces ES module `import` or `export` syntax into a `.cjs` file. The sandbox test runner (Vitest) transforms that syntax and reports green, but Node rejects it at runtime.

## Measured evidence

Four live Placebo artifacts across two runs on 2026-09-03 show the pattern. Each candidate passed the sandbox test.

| Case | Commit | Run | Added line | Ultra verdict |
| --- | --- | --- | --- | --- |
| upstream-parser-release | `d03a8d15` | 33787636996 | `import fetch from 'node-fetch';` in `app.cjs` | refused |
| upstream-formatter-release | `5a4fd146` | 33802470792 | `import chalk from 'chalk';` in `app.cjs` | refused |
| upstream-parser-release | `5a4fd146` | 33802888547 | `import fetch from 'node-fetch';` in `app.cjs` | refused |
| upstream-retry-release | `5a4fd146` | 33803376832 | `import { execa } from 'execa';` in `app.cjs` | **approved** |

The Ultra audit is the only guard today and it is inconsistent. No rule in `packages/core/src/engine/patch-rules.ts`, `packages/core/src/engine/candidate-validation.ts`, `packages/core/src/audit/mechanical.ts`, or `packages/core/src/policy/` inspects module syntax (verified by grep for `.cjs`, `cjs`, `esm`, `require(`).

## Design decisions

- One shared detector, `packages/core/src/engine/module-syntax.ts`, used in two places: `vetPatch` (rejects during search and for supplied candidates, so the search continues to a real fix) and a new mechanical audit check `module-syntax` (so no LLM verdict can approve it, including audit-only mode).
- Scope is `.cjs` files only. That is the direction backed by real artifacts, as `.claude/rules/ci-parity.md` requires. The `.mjs` direction (`require`, `module.exports`) has no artifact yet and has a legitimate ESM idiom (`createRequire`) that a line rule would misjudge.
- Dynamic `import(...)` is valid CommonJS and must not match. `exports.name = ...` must not match the `export` pattern.
- Fixture: the real chalk diff from run 33802470792 becomes `packages/core/src/audit/__fixtures__/module-syntax.diff`. The node-fetch and execa diffs are asserted verbatim in `patch-rules.test.ts` with their run identifiers.
- No change to any Placebo fixture, scorer, limit, or policy schema.

## Phases

| Phase | Name | Files | Status |
| ---: | --- | --- | --- |
| 1 | Reject ES module syntax added to CommonJS files | `engine/module-syntax.ts`, `engine/patch-rules.ts`, `audit/mechanical.ts`, `domain.ts` | Completed (`dd3cc7a`) |
| 2 | Module-system hint and violation feedback | `engine/module-syntax.ts`, `engine/repair-attempt.ts` | Completed |

Phase files:

- `docs/plans/2026-09-03-sutura-module-syntax-guard-phases/phase-1.md`
- `docs/plans/2026-09-03-sutura-module-syntax-guard-phases/phase-2.md`

Phase 2 was added on 2026-09-04 after the four-case re-run on `dd3cc7a` (USD 0.9421) ended 0/4 with Tavily: the guard rejected five ES-module candidates at apply time and no false green reached the audit, but the model was never told the selected file was CommonJS and a policy rejection fed back only `policy: Repair proposal patch was not accepted`.

## Verification

Focused tests, then `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, `pnpm run test`, `pnpm run ci:local`, and the Action bundle rebuilt in the same commit. Live measurement is the four-case upstream re-run (about USD 1.00) followed by the full v0.2.1 benchmark under the authorized USD 10.00 cap.

## Success criteria

Automated:

- The three real diffs fail `vetPatch` with a violation naming the file and the rule.
- `runMechanicalChecks` on the chalk fixture returns `module-syntax` failed with hunk evidence, and `audit()` refuses it before any sandbox or LLM call.
- The honest-fix fixture and every existing accepted diff still pass.
- `pnpm run ci:local` passes on the integrated commit.

Manual:

- Confirm the check name renders in the case file Pathology table without a label change.
