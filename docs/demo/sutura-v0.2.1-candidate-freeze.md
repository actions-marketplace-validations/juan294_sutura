# Sutura v0.2.1 candidate freeze

Date: 2026-09-04

Integrated candidate base: `096a48e7ffb5e95103ee91746644386bba1a0c12`

Branch: `develop`

State: feature freeze active; candidate gates in progress

## Selection evidence

The integrated base was the first clean `origin/develop` commit whose ancestry
contained all four workstream lines:

- WS-1 Case Lab: `8d60f329bed548fc0e5b62dc0b4a363ce61b7e43`
- WS-2 Counterfactual and Arena: `ed8ea35a176aeb2d5f1be963515d65c8452ff3bf`
- WS-3 Data Lab and adoption: `43836804dd280032e2c1352a966cd9b0e225cd25`
- WS-4 evidence and submission gates: `6d850d5f569d851cf6f5b6a483077ac8b0fd62a5`

At selection, the local `develop` checkout was clean and exactly matched
`origin/develop`. The candidate used by each subsequent gate is always resolved
from the then-current exact `origin/develop` SHA. Evidence-only or permitted
corrective commits therefore replace the operative candidate and reset every
candidate-dependent gate; this note preserves the immutable integration base.

## Admission policy

No new product feature is admitted after this record. A commit may enter the
candidate line only when it is:

1. a security fix;
2. a release or packaging fix;
3. an evidence-contract or evidence-record update; or
4. a demo-blocking fix required for the existing Case Lab or judge path.

Every admitted fix must name its category in the commit or evidence record.
It replaces the operative candidate, invalidates prior candidate-bound local,
canary, benchmark, matrix, and release evidence, and restarts the affected
gates. Paid runs retain the separate push-freeze lifecycle and authorization
caps in the WS-4 plan.

## Gate state at freeze

- Feature freeze and admission policy: active.
- Sequential local CI: passed on exact candidate
  `75a2810fb4586cd36238dedd630303799e706c7a` after admitted demo-blocking
  commit `622feea40f56b2455a5effd8daeee5acbd9730a1` reset the earlier pass.
  The suite included 179 Placebo tests in 674.00 seconds and packed
  `sutura@0.2.1` with the exact Action SHA.
- Candidate install: passed for `sutura@0.2.1`, Action commit
  `75a2810fb4586cd36238dedd630303799e706c7a`, and package content hash
  `dc33f1a985190a336f040165aa982ae4bad4da9fdbf2eb68cc90dc1376887ec6`;
  setup and doctor completed without failures, unclear instructions, or manual
  intervention.
- External-matrix and release-workflow contracts: 16 tests passed on the same
  candidate. The live candidate matrix and ConTree-bearing release-candidate
  workflow remain gated; no live workflow was dispatched.
- Provider and ConTree canaries: passed in workflow `33884265464` on exact
  candidate `f8195e8a82ffe1527d755ae7ecb8a047484af9fa`. The committed artifacts
  retain provider usage and latency, exact runtime image digests, imported
  image identity, required tools, and the ConTree operation ID. The subsequent
  read-only Placebo gate passed every precondition.
- Targeted Tavily proof: passed in workflow `33887916292` on the same exact
  candidate. Tavily enabled fixed `upstream-retry-release` with the official
  Execa 6.0.0 release in grounding, the no-Tavily pair gave up, false approvals
  remained zero, and measured cost was USD 0.24664956. The freeze was active
  for the paid workflow and removed at terminal success.
- Full Placebo benchmark: completed 51 cases and 55 evaluations on the same
  exact candidate for USD 6.14571914 with zero false approvals. It failed five
  reviewed quality gates: repair 9/18, flaky accuracy 9/10, Tavily upstream
  3/4, hidden repair preservation 0/4 with four `not-run`, and deceptive-patch
  rejection 10/11. This candidate is not release-ready. The full failed result
  is indexed in `docs/demo/sutura-v0.2.1-phase-0-evidence.md`.
- Candidate simplify review: the documented fallback found no blocking reuse,
  quality, efficiency, security, or plan-compliance issue. The operational
  report is in the public-repository-ignored `docs/agents/` directory.
- Release and public acceptance: blocked on all preceding candidate evidence
  and their separate authorization gates.
