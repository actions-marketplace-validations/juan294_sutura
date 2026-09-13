# Phase 1: Reject ES module syntax added to CommonJS files

Status: Completed

## Change

`packages/core/src/engine/module-syntax.ts` (new)

```text
COMMONJS_FILE = /\.cjs$/u
ESM_IMPORT   = /^\s*import\s+(?!\()/u        # static import; dynamic import( is valid CJS
ESM_EXPORT   = /^\s*export\s+(?:default\b|const\b|let\b|var\b|function\b|class\b|async\b|\{|\*)/u

isCommonJsPath(path): COMMONJS_FILE.test(path)
addsEsModuleSyntax(lines): lines.some(l => ESM_IMPORT.test(l) || ESM_EXPORT.test(l))
```

`packages/core/src/engine/patch-rules.ts`, inside the per-hunk loop of `vetPatch` (`:113-124`):

```text
if (isCommonJsPath(path) && addsEsModuleSyntax(additions))
  violations.push(`adds ES module syntax to CommonJS file: ${path}`)
```

`packages/core/src/audit/mechanical.ts`

```text
moduleSyntax(files): for each file/hunk, if isCommonJsPath(filePath(file)) && addsEsModuleSyntax(hunk.additions) return failed('module-syntax', file, hunk); else passed('module-syntax')
export checkModuleSyntax(diff)
runMechanicalChecks: append moduleSyntax(files) as the seventh entry; append passed('module-syntax') in the invalid-diff branch
```

`packages/core/src/domain.ts:71-82`: add `'module-syntax'` to `GreenwashCheck`.

## Fixtures and tests

- `packages/core/src/audit/__fixtures__/module-syntax.diff`: the chalk diff from run 33802470792.
- `packages/core/src/engine/module-syntax.test.ts`: matches the three real added lines; does not match `const chalk = require('chalk').default;`, `exports.renderStatus = ...`, `const mod = await import('chalk');`, or a `.js` path.
- `packages/core/src/engine/patch-rules.test.ts`: `rejects ES module syntax added to a .cjs file (live runs 33802470792, 33802888547, 33803376832)` using the three verbatim diffs; `accepts the CommonJS default-import repair` with `+const chalk = require('chalk').default;`.
- `packages/core/src/audit/mechanical.test.ts`: add `['module-syntax', 'module-syntax', "+import chalk from 'chalk';"]` to `CASES`; extend the honest-fix expectation with `{ name: 'module-syntax', passed: true }`.
- `packages/core/src/audit/audit.test.ts`: add `'module-syntax'` to the mechanical-refusal `it.each`; update the checks length assertion from 7 to 8 wherever the mechanical count is asserted.
- `packages/core/src/domain.test.ts` and `packages/core/src/report/report.test.ts`: add the name to the exhaustive lists.

## Automated success criteria

- `pnpm --filter @sutura/core exec vitest run src/engine/module-syntax.test.ts src/engine/patch-rules.test.ts src/audit/mechanical.test.ts src/audit/audit.test.ts src/domain.test.ts src/report/report.test.ts src/audit-only.test.ts` passes.
- `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, `pnpm run test` pass.
- `pnpm run ci:local` passes on the integrated commit with `packages/action/dist/index.cjs` rebuilt.

Stop after the phase is integrated into local `develop`.
