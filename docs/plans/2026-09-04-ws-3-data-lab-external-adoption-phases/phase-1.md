# Phase 1 - Public-safe Data Lab boundary (#83)

## Changes

- [x] Add failing tests for credentials, ordinary-looking supplied secrets,
  Unix/Windows private paths, source/log/diff keys, arbitrary nested keys,
  oversized rows, and determinism.
- [x] Add `packages/evaluation/src/datalab.ts` with a strict versioned row schema,
  allowlisted Placebo input parsing, hashed case identity, two fixed prompt
  variants, row/body bounds, and canonical JSONL export.
- [x] Export the public Data Lab contract from `packages/evaluation/src/index.ts`.

## Pseudocode

```text
validate known Placebo result identity and exactly 55 results
for each result in stable order:
  select only kind/language/failureClass/flakePattern/tavilyEnabled/outcome/numbers
  derive opaque customId = sha256(result identity + prompt version)
  emit fixed messages for prompt variants A and B
reject any row that violates the exact schema or byte bounds
canonicalize and hash all 110 rows
```

## Automated success

- `pnpm --filter @sutura/evaluation test`
- `pnpm --filter @sutura/evaluation typecheck`
- `pnpm --filter @sutura/evaluation lint`

## Manual success

None.
