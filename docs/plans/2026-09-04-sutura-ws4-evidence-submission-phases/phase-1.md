# Phase 1: dispatch freeze and Tavily recovery

Status: Integrated and remotely verified at
`625f642afa92bd981e4eb149306383fb925f3aed`

Issues prepared: #47

## Goal

Make every paid Placebo or external-matrix dispatch depend on the shared active
push freeze, and make the exact `upstream-retry-release` Tavily 403 recover only
through bounded, release-grounded behavior.

## Tasks

1. Add failing lifecycle tests to `scripts/push-freeze.test.mjs` for a reusable
   active-freeze assertion, including missing, valid, and unreadable markers.
2. Add failing runner tests proving a single-case dispatch cannot reach `gh`
   without the marker and that a streak rechecks the marker between cases.
3. Export the shared assertion from `scripts/push-freeze.mjs`; invoke it
   immediately before the `gh workflow run` call in
   `scripts/placebo-live.mjs` and `scripts/external-matrix-live.mjs`.
4. Make both single-case `run` commands require numeric `--cap-usd` and
   `--initial-reserve-usd`, reject invalid or under-reserved dispatches, and
   retain streak mode's existing cumulative cap behavior.
5. Add Tavily tests for `403 -> 200`, `403 -> 403`, non-retried 401, bounded
   public errors, release extraction after two 403 responses, and rethrow of the
   original 403 when exact extraction produces no citation.
6. Implement one identical-request retry for search status 403. In `ground`,
   permit registry-verified release extraction after the terminal 403 only for
   one relevant validated dependency; require a non-empty exact citation or
   rethrow the original error.
7. Extend the opt-in live Tavily test with the exact Execa 6 query. Do not run it
   until G1 is authorized.
8. Rebuild the Action bundle because `packages/core` changes.

## Verification

Run sequentially:

```bash
node --test scripts/push-freeze.test.mjs
node --test scripts/placebo-live.test.mjs
node --test scripts/external-matrix-live.test.mjs
pnpm --filter @sutura/core test -- src/diagnose/tavily.test.ts
pnpm --filter @sutura/cli test -- src/cli.test.ts
pnpm run test:release-contracts
pnpm run ci:local
```

`packages/action/dist/index.cjs` must be clean after the final build. No live
test and no GitHub workflow dispatch occurs in this phase.

## Exit

- Focused and full local gates pass.
- The task commit is integrated on `develop` and remote CI is green.
- The read-only live gate identifies G4 canary authorization as the only missing
  prerequisite before G1 is presented for a settled exact candidate.
