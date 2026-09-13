# Phase 3 - Real Data Lab experiment (#84, #87, #52)

## Changes

- [ ] Run the exact Gate A upload command after authorization.
- [ ] Run the exact Gate B batch command after authorization.
- [ ] Finalize exactly one operation and publish winning/losing prompt versions
  with cost, latency, exact denominator, quality, dataset/operation identities,
  and input/output hashes.
- [ ] Validate the terminal report and mark the roadmap Data Lab items complete.

## Automated success

- experiment record and report pass their strict validators
- dataset input hash equals the committed JSONL content hash and the request hash
  equals the separately reviewed request identity
- output hash is calculated from canonical returned provider rows
- denominator is 55 evaluations x 2 prompt variants
- cost is finite, non-negative, and at or below USD 0.05

## Manual success

Gate A and Gate B authorization. Without authorization this phase remains blocked,
while Phases 4-6 continue.
