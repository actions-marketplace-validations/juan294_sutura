# Phase 2: Module-system hint and violation feedback

Status: Completed

## Goal

Tell the Super model which module system the selected excerpt uses, and carry the exact policy violation into the next attempt's feedback and the case file.

## Change

`packages/core/src/engine/module-syntax.ts`: `isEsModulePath(path)` and `moduleSystemInstruction(path)`, which returns a CommonJS instruction for `.cjs` targets (use `require()`; for an ES-module-only dependency use `require('pkg').default` or destructure the named export), an ES module instruction for `.mjs` targets, and `undefined` otherwise.

`packages/core/src/engine/repair-attempt.ts`

- `prepareControlledRepairProposalTemplate.contract`: append `moduleSystemInstruction(target.path)` to the per-contract system message, before the repeated-proposal line. The contract is memoized per target, so the line is computed once per target.
- `runControlledRepairAttempt`: when `apply_patch` is rejected, the reason becomes `Repair proposal patch was not accepted: <tool message>` through `publicRepairReason`. The tool message for a policy rejection is the joined violation list, so `heal.ts` now records `policy failure: Repair proposal patch was not accepted: adds ES module syntax to CommonJS file: app.cjs` in the stage ledger and passes the same text to the child attempt as `previousAttempt.testOutput`.

## Tests

`packages/core/src/engine/repair-attempt.test.ts`, `describe('module-system hints and policy feedback')`: `.cjs` target system message contains the CommonJS line; `.mjs` target contains the ES module line; `.ts` target contains neither; a rejected `import` proposal on `app.cjs` returns `failureKind: 'policy'` with the violation text and makes no sandbox call (live run 33810847395).

`packages/core/src/engine/module-syntax.test.ts`: `isEsModulePath` and `moduleSystemInstruction` by extension.

## Automated success criteria

- Focused suites, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, `pnpm run test`, and `pnpm run ci:local` pass on the integrated commit with the Action bundle rebuilt.
