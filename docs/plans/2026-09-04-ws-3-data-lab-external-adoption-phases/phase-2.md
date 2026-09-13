# Phase 2 - Data Lab provenance, privacy, and batch client (#85, #88, #86)

## Changes

- [x] Add failing tests for dataset/operation response identity, dataset version,
  input/output hashes, immutable request identity, terminal status, and cost cap.
- [x] Add an injected `DataLabClient` for official dataset create, batch-operation
  create, operation read, result read, and dataset-content read endpoints.
- [x] Add canonical experiment-record and batch-report schemas with dataset ID,
  version, input hash, operation ID, output dataset ID/version, output hash, model,
  prompt versions, completion window, limits, estimated/calculated cost, latency, and
  quality per prompt variant.
- [x] Add `scripts/datalab-experiment.mjs` prepare/upload/run-batch/finalize commands.
  Upload and dispatch require the literal gate tokens in the main plan.
- [x] Generate and commit the 110-row public-safe request artifact under
  `docs/datalab/` from the 55-record public Placebo artifact.
- [x] Update `docs/security/data-boundaries.md` and
  `docs/security/private-repositories.md` with current ZDR, explicit upload,
  Data Lab retention/processing, batch outputs, deletion, and residual-risk facts.

## Automated success

- `pnpm --filter @sutura/evaluation test`
- `node --test scripts/datalab-experiment.test.mjs`
- dry-run preparation is byte-identical on two invocations
- no gate token or API key appears in an artifact

## Manual success

None for client/preparation. Actual dispatch remains Gate B.
