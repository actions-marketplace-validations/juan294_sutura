# Phase 2: Case Lab package, server-defined cases, request boundary, limits, result contract

Issues: #59 (server-defined case identifiers), #60 (reject arbitrary input), #61 (limit logic), #63 (secret-free contract tests)

Depends on: none

## Goal

`packages/case-lab` exists with pure, fully tested modules that every later phase composes. Nothing in this phase performs network I/O.

## Package layout

```
packages/case-lab/
  package.json          @sutura/case-lab 0.2.1, private, type module, deps @sutura/core workspace:*, devDeps esbuild
  tsconfig.json         extends ../../tsconfig.json, outDir dist, rootDir src, types node
  tsconfig.build.json   excludes *.test.ts and *.test-helper.ts
  bin/case-lab.js       #!/usr/bin/env node; import '../dist/bin.js'
  release.json          { "version": "0.2.0", "actionSha": "a943ded4c734aed75c5c63f2b2dd63a2f44556c2" }
  src/index.ts          barrel
  src/cases.ts          CASE_LAB_CASES, caseLabCase(), isCaseLabCaseId()
  src/request.ts        parseCaseLabRequest(), CaseLabRequestError
  src/limits.ts         CASE_LAB_LIMITS, caseLabDispatchDecision()
  src/result.ts         CaseLabResult, createCaseLabResult(), validateCaseLabResult(), assertCaseLabResultPublicSafe(), modeLabel()
  src/canonical.ts      canonicalJson(), contentHash()  (TypeScript twin of scripts/evidence-contract.mjs:6-20)
  src/*.test.ts         colocated tests
```

Root wiring: `pnpm-workspace.yaml` already includes `packages/*`; the four script names (`build`, `lint`, `test`, `typecheck`) wire into `pnpm -r`. No root `package.json` change is needed.

## Pseudocode

`cases.ts`

```ts
export type CaseLabCaseId = 'javascript-repair' | 'python-repair' | 'flaky-failure' | 'greenwash-trap' | 'upstream-incident';
export interface CaseLabCase { id; title; scenario; language: 'javascript'|'python'; runtime: 'node'|'python';
  placeboCaseId; materializer: { kind: 'break', name } | { kind: 'matrix', name }; expectedOutcome; description; }
export const CASE_LAB_CASES: readonly CaseLabCase[] = Object.freeze([...five entries from the plan table...]);
export function caseLabCase(id: unknown): CaseLabCase
  // throws CaseLabRequestError(`caseId must be one of ${ids.join(', ')}`) for anything not strictly equal to an entry id
```

`request.ts`

```ts
const MAX_REQUEST_BYTES = 256;
export function parseCaseLabRequest(body: unknown): { caseId: CaseLabCaseId }
  // body must be a plain object (not array/null), exactly one key `caseId`, string value that is a server-defined id.
  // any other key (repository, repo, ref, branch, command, patch, diff, text, prompt, ...) -> CaseLabRequestError('request accepts only caseId')
  // serialized size over MAX_REQUEST_BYTES -> CaseLabRequestError('request exceeds 256 bytes')
export function parseCaseLabRequestText(text: string): ... // JSON.parse guarded, non-JSON -> 'request must be a JSON object'
```

`limits.ts`

```ts
export const CASE_LAB_LIMITS = Object.freeze({ maxConcurrentRuns: 1, maxRunsPerHour: 4, worstCaseRunUsd: 0.75, dailySpendStopUsd: 6, maxRunsPerDay: 8 });
export interface DispatchWindow { enabled: boolean; activeRuns: number; runsInLastHour: number; runsToday: number; }
export function caseLabDispatchDecision(window: DispatchWindow, limits = CASE_LAB_LIMITS): { allowed: true } | { allowed: false; reason: 'disabled'|'concurrency'|'hourly-throttle'|'daily-spend-stop' }
  // order: disabled, concurrency, hourly, daily. maxRunsPerDay must equal floor(dailySpendStopUsd / worstCaseRunUsd) (asserted in a test).
  // negative or non-integer counts -> RangeError('run counts must be nonnegative integers') (fail closed)
export function runsToday(runs: {createdAt: string}[], now: Date): number  // UTC day
export function runsInLastHour(runs, now): number
```

`result.ts`: types from the plan's "Result document contract"; `createCaseLabResult(base)` appends `resultHash: contentHash(base)`; `validateCaseLabResult(value)` rebuilds the base, checks every field type, mode, enum, link URLs (`https://github.com/` only, no credentials), and hash equality, then calls `assertCaseLabResultPublicSafe`; `MAX_RESULT_BYTES = 4 MiB`.

`modeLabel`: `live` → "Live run", `replay` → "Deterministic replay", `recorded` → "Recorded live result". Labels are the only allowed strings; the site tests assert them verbatim.

## Security tests (#59, #60), all in `src/request.test.ts` and `src/cases.test.ts`

- Exactly five ids; each maps to a Placebo case id present in `docs/demo/placebo-v0.2-corpus.json` (read the file in the test, no network).
- Rejects: unknown id, id with different case (`JavaScript-Repair`), id with whitespace, prototype keys (`__proto__`, `constructor`), arrays, numbers, empty object, `{ caseId, repository: 'x/y' }`, `{ caseId, ref: 'main' }`, `{ caseId, command: 'rm -rf' }`, `{ caseId, patch: '...' }`, `{ caseId, text: '...' }`, oversized body, non-JSON text, JSON string/number top-level.
- Every rejection throws `CaseLabRequestError` whose message names the accepted contract.

## Secret contract tests (#63), `src/result.test.ts`

- A result containing `ghp_…`, `github_pat_…`, `Authorization: Bearer x`, `/Users/juan/…`, or a supplied secret value is rejected by `assertCaseLabResultPublicSafe`.
- Links outside `https://github.com/` are rejected; `https://user:pw@github.com/...` is rejected.

## Verification

```bash
pnpm --filter @sutura/case-lab test && pnpm run typecheck && pnpm run lint && pnpm run build
```

## Success criteria

- [x] Package builds, lints, typechecks, and tests pass under `pnpm -r`.
- [x] `parseCaseLabRequest` accepts exactly `{ caseId: <one of five> }` and nothing else.
- [x] `caseLabDispatchDecision` is total, ordered, and fail-closed on invalid counts.
- [x] `validateCaseLabResult` round-trips `createCaseLabResult` and rejects a tampered hash.
