# Nebius Token Factory json_schema drift (2026-09-16)

Status: provider-side regression, worked around in Sutura (contract `sutura-super-repair-v6`).

## What changed

The provider-contract canary (`scripts/provider-contract-canary.mjs`) passed on the
unmodified v0.3.0 code at 2026-09-15 07:17 UTC ([run 34940994118](https://github.com/juan294/sutura/actions/runs/34940994118))
and failed on the same code from 2026-09-16 16:23 UTC on ([runs 35121616563, 35121893061, 35131458002](https://github.com/juan294/sutura/actions/workflows/provider-contract-canary.yml)),
plus 2/2 local runs of the v0.3.0 checkout. The Nebius status page listed no Token Factory incident.

## Isolation (raw HTTP, the canary's exact request body)

| Variant | `choices[0].message.content` |
| --- | --- |
| `response_format: json_schema` (strict, temperature 1) | `"…number {n  return left + right;n}"` — escape backslash dropped |
| same, temperature 0 | identical (deterministic) |
| same, `strict: false` | `"…number {  return left + right;}"` — line breaks dropped |
| same schema, Ultra / Nano | single-line replacement, no line breaks |
| **`response_format: json_object`** | `"…number {\\n  return left + right;\\n}"` — correct |
| **no `response_format`** | correct |

Raw request and response bodies: `packages/core/src/llm/__fixtures__/nebius-json-schema-drift-2026-09-16/`.
With `json_schema` rewritten to `json_object` at the fetch boundary the full canary passed 3/3
(393 input / 29 output tokens).

## Impact and fix

`json_schema` was used by the repair proposal request (`packages/core/src/engine/repair-attempt.ts`)
and the diagnosis-hypotheses request (`packages/core/src/diagnose/hypotheses.ts`), so every live
repair on Nemotron produced corrupted replacements, not only the canary. Both now send
`json_object`; the contracts were always enforced locally. `replay-fetch.ts` compares the two
request shapes as one, so bundles captured before 2026-09-16 still replay.

## Report to Nebius

One request reproduces it: POST `https://api.tokenfactory.nebius.com/v1/chat/completions` with
`request-json-schema.json` from the fixture directory returns the dropped-escape content; the same
body with `{"response_format":{"type":"json_object"}}` returns correct escapes.
