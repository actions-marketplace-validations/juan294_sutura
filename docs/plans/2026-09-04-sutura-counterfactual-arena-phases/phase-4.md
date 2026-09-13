# Phase 4: Live path wiring through the CLI and adapter

Issues: #71 (live half), #75 (live half)

Depends on: Phase 1, Phase 3

## Goal

A real Sutura run can carry counterfactual alternatives end to end, so the two
gates the offline harness cannot reach (`suite-rerun`, `adjudication`) and the
repository-policy gate are exercised on the live path under gate G1.

## Step 1 - CLI surface

`packages/cli/src/args.ts`: `heal` accepts
`--alternatives-file <path>`. A path, never inline JSON, because a three-entry
alternative set exceeds a comfortable argv value. Validation:

- the flag requires a value that does not start with `--`
- the file is a regular file at or below 256 KiB
- its content parses as JSON `{ alternatives: [...] }` and passes
  `validateCounterfactualAlternatives`
- any failure is a usage error with the file name and the cause

`packages/cli/src/heal.ts`: read and validate the file, then pass
`counterfactuals` into `healCase`. The flag is absent by default, so every
existing invocation is byte-identical.

`packages/cli/src/args.ts` `USAGE` gains one line. `scripts/verify-readme-setup.mjs`
and the README are only touched if they enumerate flags; check before editing,
because README is a WS-1 owned path for its demo section only.

## Step 2 - `healCase` passthrough

`packages/core/src/heal.ts`: `HealCaseContext` inherits `counterfactuals` from
`RepairFailureContext` through the existing `Omit<...>`, and `healCase`
forwards it in the `repairFailure` call with the same
`...(x === undefined ? {} : { x })` style every other optional field uses.

## Step 3 - Adapter and harness

`packages/placebo/src/types.ts`: `AdapterContext.alternatives?:
readonly CounterfactualAlternative[]`.

`packages/placebo/src/adapters.ts`: `CliAdapter.commandArgs` and
`SuturaAdapter.commandArgs` append `--alternatives-file <path>` when
`context.alternativesFile` is set. The harness owns writing the file into the
per-case temporary directory, so the adapter never serializes patch bodies into
argv. `AdapterContext` therefore carries `alternativesFile?: string` and the
harness sets it.

`packages/placebo/src/harness.ts`: `BenchmarkOptions.counterfactual?: boolean`.
When set, `evaluate` looks up the case in the counterfactual set, writes
`alternatives.json` plus the diffs into the temporary root, and passes the
path. `BenchmarkResult` gains `counterfactual?: CounterfactualEvidence` taken
from `caseFile.counterfactual`.

`packages/placebo/src/cli.ts`: `run --counterfactual`.

`packages/placebo/src/score.ts` is **not** modified. The counterfactual measure
lives in the counterfactual report, not in the frozen score contract.

## Step 4 - Live runner

`scripts/placebo-live.mjs`: accept `--counterfactual` and forward it to the
dispatched workflow input. Do not change any freeze, cap, or gate behaviour;
WS-4 owns those. If the flag is absent the dispatch is byte-identical to today.

## Step 5 - Bundle

`packages/action/dist/index.cjs` is rebuilt with
`pnpm --filter @sutura/action build` and committed in the same commit as the
`packages/core` change.

## Tests

- `packages/cli/src/args.test.ts`: the flag parses, refuses a missing value,
  refuses a value starting with `--`, and refuses an oversized or malformed
  file.
- `packages/cli/src/heal.test.ts`: the parsed alternatives reach `healCase`.
- `packages/placebo/src/adapters.test.ts`: `commandArgs` includes the flag only
  when the harness supplied a path, and never includes a diff body.
- `packages/placebo/src/harness.test.ts`: with `counterfactual: true` the
  alternatives file is written and removed with the temporary root, and
  `BenchmarkResult.counterfactual` carries the returned evidence.
- `scripts/placebo-live.test.mjs`: the new flag is forwarded and its absence
  changes nothing.

## Authorization gate G1

Recorded in the parent plan. WS-2 prepares the command, the cap, and the
expected cost, requests the freeze from WS-4, and continues with Phase 5
onward while the gate is open.

## Success criteria

- [ ] All listed tests pass.
- [ ] A run without `--alternatives-file` produces a byte-identical `CaseFile`
      to the same run before this phase (asserted by a captured-fixture test).
- [ ] `packages/action/dist/index.cjs` rebuilt in the same commit.
- [ ] `pnpm run ci:local` passes on the integrated commit.
