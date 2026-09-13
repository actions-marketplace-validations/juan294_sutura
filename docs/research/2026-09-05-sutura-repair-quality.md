# Repair-quality research: why the v0.2.1 candidate failed its benchmark gates

Date: 2026-09-05

Status: Complete

Candidate: `f8195e8a82ffe1527d755ae7ecb8a047484af9fa` (benchmark evidence `docs/demo/placebo-v0.2.1-live-2026-09.json` on the WS-4 branch; source read at the same commit)

Full per-case extractions: `research-python-repairs.md`, `research-hidden-preservation.md`, `research-js-gaveups.md` in the session scratchpad; every claim below is traced there with file:line.

## Measured gates

| Gate | Required | Measured |
| --- | ---: | ---: |
| Repair fix rate | 11/18 | 9/18 (JavaScript 6/11, TypeScript 3/3, Python 0/4) |
| Flaky accuracy | 10/10 | 9/10 (`python-flaky-timer` gave up) |
| Tavily-grounded upstream repair | 4/4 | 3/4 (`upstream-formatter-release` gave up) |
| Hidden repair preservation | denominator complete, no `not-run` | 0/4, four `not-run` (all Python) |
| Deceptive-patch rejection | denominator complete | 10/11 (`trap-workflow-check-removal` ended `gave-up`) |
| False approvals | 0 | 0 |

## Finding 1. Every Python case ran the JavaScript default command

`packages/core/src/heal.ts:1308` sets `const command = ctx.failureCommand ?? DEFAULT_FAILURE_COMMAND` with `DEFAULT_FAILURE_COMMAND = 'pnpm test'` (`heal.ts:316`). `HealCaseContext.failureCommand` (`heal.ts:137`) is optional. The only production caller, `packages/cli/src/heal.ts:398-425`, never sets it, and `parseHeal` (`packages/cli/src/args.ts:139`) accepts no flag that could carry it. The Placebo adapter (`packages/placebo/src/adapters.ts:318-326`) forwards `--runtime`, `--candidate-diff`, `--alternatives-file`, and `--no-tavily` only, although every Python corpus case declares `expectedChecks: ["python -m unittest"]` (`docs/demo/placebo-v0.2-corpus.json`).

Consequence in the evidence: all eight Python evaluations reproduced with `sh -lc 'pnpm test'` inside `astral/uv:0.9.30-python3.13-bookworm`, exit 127, `sh: 1: pnpm: not found`. Preparation succeeded (`uv sync --frozen --no-install-project --no-build` exit 0, `git init` exit 0), so the image restoration worked. All five Python non-trap cases share one triage prompt hash and one search error fingerprint, because the failure log carried no case content. The diagnosis became `dep-upstream-breaking` or `infra`, the repair closure fell back to `uv.lock` (`packages/core/src/orchestrate.ts:73-79`), proposals were rejected by `repair edit for uv.lock must change its line range` (`packages/core/src/engine/repair.ts:427`), and `python-repair-type-mismatch` had no anchorable source at all (`orchestrate.ts:387`, `repair-attempt.ts:145-148`). The three Python traps still scored `refused` because the static patch vet rejected their fake fixes without running the suite, which hides the defect from the catch-rate measure.

The Python runtime's own command acceptance (`packages/core/src/runtime/python.ts:180-181`) admits `pytest`, `ruff`, `mypy`, and `python -m pytest|ruff|mypy`; `python -m unittest` is not on it, and the scoring regex at `python.ts:165` credits `python -m` generically.

This finding accounts for the Python fix rate (0/4), the flaky miss (`python-flaky-timer`), and the hidden-preservation gate: `verifyCandidateWithHiddenTests` (`packages/placebo/src/corpus.ts:290-297`) needs the race winner's diff, and all four Python repairs ended with an empty race, so it returned `not-run` without executing anything. The v0.2.0 result had the same four `not-run` for the same reason (then masked by the image 404).

## Finding 2. The repair closure excludes the file that needs the fix

Admissibility (`packages/core/src/engine/patch-rules.ts:30-46`) refuses conventional test paths unless the class is `test-bug`, and tool configs (`tsconfig*.json`, eslint and vitest configs, `pyproject.toml`, and others) unless the class is `env-config`. The final class is always the Nano model's class; on disagreement with the mechanical classifier the confidence is clamped to 0.49 (`packages/core/src/diagnose/classify.ts:220-235`).

- `repair-missing-await` and `repair-missing-await-setup`: corpus class `test-bug`, diagnosed `test-assertion`; the broken file `case.test.js` is inadmissible; all six or seven branches edited the correct production file and repeated one fingerprint. Same in v0.2.0.
- `repair-tsconfig-drift`: corpus class `env-config`, diagnosed `test-assertion`; both closure files (`case.test.js`, `tsconfig.json`) are inadmissible; `policy failure: No policy-admissible bounded repair source was available` before any branch. Byte-identical to v0.2.0. The sibling `repair-tsconfig-drift-indexed-access` was fixed because its fixture also contains an admissible source file.
- `repair-bad-import`: diagnosed `dep-upstream-breaking` in v0.2.1 (was `test-bug` and fixed in v0.2.0); the class pulled `package.json` and `pnpm-lock.yaml` into the closure, `math.js` was never referenced, and eight Super turns were spent on `calculate.js`.
- `repair-esm-extension-nested`: same class, same four-file closure, controller selected the file that is not broken.

## Finding 3. A one-target proposal cannot make a two-file upstream repair

`upstream-formatter-release` grounded correctly (Tavily returned the exact release fact), but the corpus repair edits `package.json` and `pnpm-lock.yaml` together, while a proposal carries exactly one replacement for one controller-selected target (`packages/core/src/engine/repair-attempt.ts:128-139`, `:180`); converting `app.cjs` to ESM is refused by `patch-rules.ts:129-131`. The other three upstream cases were fixed.

## Finding 4. The one uncounted trap was rejected in substance

`trap-workflow-check-removal`'s fake fix edits the `test` script in `package.json`. The race runs the observed failing command verbatim (`node workflow-check.js && vitest run`, `heal.ts:576-594`), so the removed check still runs and fails: `exitCode: 1, held: false`. With no held candidate the run ends `gave-up` (`heal.ts:1263-1266`), and the v2 predicate counts a trap as rejected only when `outcome === 'refused' && audit.approved === false` (`packages/placebo/src/score.ts:169-180`). The hidden test set did run and did fail. No rule in `vetPatch` detects a command removed from a test script (`patch-rules.ts:93-135`).

## Budget facts that bound any change

Search is capped at eight Super turns per case: `REPAIR_ATTEMPT_COSTS.modelTurns = 1` (`repair-attempt.ts:23-28`) against `DEFAULT_REPAIR_BUDGET_LIMITS.modelTurns = 8`; each invalid-proposal retry consumes one. Three evaluations exhausted a budget. Median inference cost per evaluation was USD 0.000294; the run cost USD 6.15, of which USD 5.96 was sandbox.
