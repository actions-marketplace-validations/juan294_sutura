# Verification evidence for opaque sandbox image identities

Date: 2026-09-08. Status: adopted for local implementation.

ConTree returns immutable image identifiers from completed operations. Its
current import boundary uses verified registry tags; the
[Python runtime contract](../../packages/core/src/runtime/python.ts) records
that digest-form imports are rejected by the beta provider. An image UUID is
not an OCI digest. Hashing a UUID would not make it one, and a registry lookup
alone does not attest to the bytes imported by another service.

Keep `sutura-verification-evidence-v1` validation unchanged: accepted v1
records still require their original digest identity. New executed records use
`sutura-verification-evidence-v2`. They bind the actual immutable baseline
returned by preparation as `executorImageId`, with the source snapshot,
trusted policy and supplied or generated diff hashes. `imageDigest` remains
null when the executor did not establish an OCI digest. Recorded commands and
gate artifacts describe what executed against that baseline. This is provider
execution identity, not independent image attestation.

V2 distinguishes Git source identity from a local immutable snapshot. A non-Git
local fixture records absent Git commits explicitly and binds its actual
snapshot and policy hashes. It never invents a commit hash to satisfy a
serializer. External verification still requires the operator's exact Git
source and trusted policy commits before provider execution.

The artifact retains an integrity hash over actual stored bytes and a separate
normalized comparison hash. Models retain purpose, requested and returned IDs,
and observed usage. Dated catalog prices support estimates only when the
observed model and price contract match. Missing usage or unknown pricing is
unavailable, not zero. Raw sandbox amounts have unknown units unless separately
established; they are not converted into USD by this decision.

This change does not authorize a provider run or make historical results
current. Paid manifests still bind their declared runtime/preflight contract
and exact candidate. Image canaries, live provider behavior and clean quality
measurement remain separate evidence requirements.
