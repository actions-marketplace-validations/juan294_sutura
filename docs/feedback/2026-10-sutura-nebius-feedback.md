# Sutura feedback for Nebius and NVIDIA

Status: draft based on verified repository contracts and retained live-run
evidence. Final provider and submission verification remain separately gated.

## Verified local integration behavior

- Sutura isolates dependency preparation from source execution and keeps repair,
  triage, and audit commands network-disabled by contract.
- The ConTree adapter records bounded operation, cancellation, snapshot, and
  branch lineage evidence. Local tests cover cancellation and capacity behavior.
- Token Factory responses are validated against bounded schemas. Model roles
  remain separate from actual model IDs and recorded prices.
- Evaluation traces remove hidden reasoning, credentials, full source, and
  unbounded tool arguments at recorder storage time.

These statements describe repository contracts and local tests. They are not
claims about current service behavior.

## Observed live integration problems

- ConTree import of a pinned `ghcr.io/astral-sh/uv` image digest returned HTTP
  404. The affected Python cases stopped as infrastructure outcomes
  before source execution. Follow-up probes showed that ConTree accepted a
  versioned Docker Hub tag while OCI digest imports through the tested paths
  failed. The repository therefore verifies the tag's resolved platform digest
  before use. The retained account is in the
  [v0.2.1 remediation record](../plans/2026-09-01-sutura-v0.2.1-evidence-remediation.md).
- Tavily returned HTTP 403 on the `upstream-retry-release` search after the
  preceding upstream cases returned citations with the same candidate and
  credential. Sutura surfaced `infra-stop` and did not treat an ungrounded
  repair as success. The run identity and paired no-Tavily outcome are recorded
  in the [WS-4 research](../research/2026-09-04-sutura-ws4-evidence-submission.md).
- Live Nemotron Super calls returned invalid JSON and schema-incompatible
  repair proposals. Some responses were truncated at the provider completion
  boundary; others contained fields outside the controller-owned replacement
  contract. Sutura rejected those responses before sandbox mutation and added
  deterministic replay coverage from the retained runs.
- The coding-agent request initially omitted the model-card-recommended
  `force_nonempty_content` chat-template argument. Sutura now sends
  `force_nonempty_content: true` with thinking disabled and verifies the exact
  request through replay and provider-canary contracts. The change and its
  fallback boundary are recorded in the
  [search-recovery plan](../plans/2026-09-03-sutura-search-recovery.md).
- A small number of Super calls entered degenerate completion-limit loops and
  consumed the configured completion envelope without producing a usable
  replacement. The first stop rule ended the whole adaptive search even when
  sibling branches held applied patches. The controller now keeps that terminal
  local to the runaway branch unless completion limits outnumber productive
  proposals, as documented in the
  [branch-local completion record](../plans/2026-09-04-sutura-completion-limit-branch-local.md).

## Requested features

- Publish versioned JavaScript SDK and OpenAPI schemas for ConTree operations,
  cancellation, errors, and capacity fields.
- Expose image deletion, retention, network-policy, cold-start, branch-latency,
  cancellation, and resource metrics through stable typed fields.
- Publish model metadata and prices as a versioned, hashable catalog snapshot.
- Provide consistent request IDs, rate-limit headers, error classes, and retry
  guidance for parallel function-calling workloads.
- Document function-calling and JSON Schema conformance by model.
- Document GitHub OIDC or another short-lived credential flow if supported.
- Document Data Lab redaction, upload, retention, and Zero Data Retention behavior.
- Provide a versioned public compatibility matrix for ConTree image references,
  including registry, tag, OCI index digest, and platform manifest behavior.

## Proposed impact

These features would reduce custom validation code, make cost and latency
evidence reproducible, improve recovery from partial failures, and let a CI
repair system use shorter-lived credentials. The observations above are
retained failures, not estimates of general service reliability. The requests
are proposed product improvements rather than claims about undocumented
capabilities.
