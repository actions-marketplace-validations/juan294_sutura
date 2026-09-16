# Phase 2: Bounded test output is evidence

Plan: [2026-09-15-launch-readiness-v0.3.1.md](../2026-09-15-launch-readiness-v0.3.1.md)

Status: done, merged to `develop` at `28c79b8`. Commit `fef7ddf` (branch
`worktree-agent-ad8780961d76c7291`). Replay divergence resolved per the
plan's own success-criteria fallback (see `docs/plans/2026-09-15-launch-readiness-v0.3.1-notes.md`).

## Goal

A trusted test run whose combined output exceeds the tool cap is recorded with
its exit code and a bounded tail, instead of being refused as "sandbox" and
discarding a correct candidate.

## Current behaviour (VERIFIED)

`packages/core/src/engine/repair-tools.ts`:

```ts
const MAX_TOOL_OUTPUT_BYTES = 16_000;                       // :25
…
private async runTest(value: unknown): Promise<RepairToolResult> {   // :367
  …
  const result = await this.run(command, this.current.editableImageId, MAX_TEST_TIMEOUT_SEC);
  const output = bounded([result.stdout, result.stderr].filter(Boolean).join('\n'));
  if (result.truncated || Buffer.byteLength(…) > MAX_TOOL_OUTPUT_BYTES) {   // :374-377
    return failure('sandbox', 'Test output exceeded the bounded tool limit');
  }
  this.current.latestTest = { commandId, imageId, exitCode, output, metrics };  // :380
```

`packages/core/src/engine/repair-attempt.ts:668-669` turns that failure into
`{ status: 'gave-up', failureKind: 'sandbox', reason: 'Automatic trusted test did not produce valid evidence' }`,
and `packages/core/src/heal.ts:1343-1357` drops the candidate diff.
`bounded()` (`repair-tools.ts:125-128`) already produces the redacted tail;
the refusal happens after computing it.

## Change

```ts
// repair-tools.ts runTest
const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
const outputTruncated = result.truncated || Buffer.byteLength(combined, 'utf8') > MAX_TOOL_OUTPUT_BYTES;
const output = bounded(combined);
this.current.latestTest = {
  commandId: args.commandId, imageId: result.imageId, exitCode: result.exitCode, output, metrics: result.metrics,
  ...(outputTruncated ? { outputTruncated: true } : {}),
};
this.observe(result, this.current.editableImageId, `run_test ${args.commandId}${outputTruncated ? ' (output truncated)' : ''}`);
const note = outputTruncated ? `\n[output truncated to the last ${MAX_TOOL_OUTPUT_BYTES} bytes; exit code ${result.exitCode} is authoritative]` : '';
return { ok: true, message: `${output || `Test exited ${result.exitCode}`}${note}`, imageId: result.imageId, exitCode: result.exitCode };
```

- The `latestTest` type (wherever `RepairToolState.latestTest` is declared in
  `repair-tools.ts`/`repair.ts`) gains `readonly outputTruncated?: boolean`.
- `repair-attempt.ts:668` is unchanged: with `tested.ok === true` and
  `latestTest` set, exit code 0 proceeds to `submit_candidate`, exit code ≠ 0
  becomes a `checkpoint` with the bounded evidence.
- The other caps (`:278` read, `:353` search, `:434` diff, `:458`) are
  unchanged: they bound *inputs* to the model, not evidence.
- Trace/case-file: nothing new to render; the `run_test` stage note carries
  the truncation marker.

## Tests (executable artifacts)

- Fixture from the real run (rule: guards backed by real logs):
  `packages/core/src/engine/__fixtures__/case-lab-34977342282-run-test.json`
  = `{ stdout, stderr, exitCode: 1 }` extracted from executor exchange
  sequence 15 of
  `packages/case-lab/src/__fixtures__/live-34977342282-javascript-repair-gave-up.json`
  (30 004 bytes combined; public-safe — it is the same redacted bundle).
- `repair-tools.test.ts` (existing file; add):
  - "run_test records a truncated trusted run as evidence instead of refusing":
    executor stub returns the fixture; assert `ok: true`, `exitCode: 1`,
    `state().latestTest?.outputTruncated === true`, `message` ends with the
    truncation note, `output` length ≤ 16 000 bytes and equals `bounded(...)`.
  - "run_test keeps the executor's own truncation flag as evidence": stub
    `result.truncated = true`, exit 0 → `ok: true`, `outputTruncated: true`.
- `repair-attempt.test.ts` (existing; add): with the fixture output and exit
  0, the attempt reaches `submit_candidate` (status `submitted`); with exit 1
  it returns `checkpoint` carrying `test.outputTruncated === true`. Assert no
  `gave-up` with reason "did not produce valid evidence" for either.
- Replay determinism check (plan-level criterion): `pnpm --filter
  @sutura/case-lab exec vitest run src/replay.test.ts` must stay green — the
  named live-bundle test replays recorded tool results, so the recorded
  `gave-up` is reproduced unchanged. If it diverges, stop and report; do not
  edit the fixture.

## Verification

```bash
pnpm --filter @sutura/core exec vitest run src/engine
pnpm --filter @sutura/case-lab exec vitest run src/replay.test.ts
pnpm run build && git status --porcelain packages/action/dist   # rebuilt bundle must be committed
pnpm run ci:local
```

## Done when

Both new tests green with the real fixture, `ci:local` green, `dist/index.cjs`
rebuilt in the same commit, pushed. STOP.
