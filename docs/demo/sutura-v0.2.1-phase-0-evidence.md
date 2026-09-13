# Sutura v0.2.1 Phase 0 evidence index

Date: 2026-09-04

Status: Complete benchmark denominator; blocked by measured quality gates and
the separately authorized candidate and public matrices

The exact v0.2.1 candidate completed all 51 Placebo cases and 55 evaluations.
Every failure remains in the denominator and the result has zero false
approvals. The result does not meet the reviewed v0.2.1 quality thresholds, so
it is failed evidence rather than release-ready evidence.

## Exact identities

- Candidate controller and subject:
  `f8195e8a82ffe1527d755ae7ecb8a047484af9fa`
- Subject version: `0.2.1`
- Package content hash:
  `dc33f1a985190a336f040165aa982ae4bad4da9fdbf2eb68cc90dc1376887ec6`
- Package integrity:
  `fe3676a293c143e5da2509cbc8c001dd2e76593a0122c12f532bf94938e6dc17`
- Provider and ConTree canary: [workflow 33884265464](https://github.com/juan294/sutura/actions/runs/33884265464)
- G1 targeted Tavily proof: [workflow 33887916292](https://github.com/juan294/sutura/actions/runs/33887916292)
- G2 first additional case: [workflow 33889528412](https://github.com/juan294/sutura/actions/runs/33889528412)
- G2 final case: [workflow 33904020642](https://github.com/juan294/sutura/actions/runs/33904020642)

The [ledger](placebo-v0.2.1-live-ledger-2026-09.json) retains every individual
workflow URL and artifact hash.

## Benchmark evidence

- [Final report](placebo-v0.2.1-live-2026-09.json)
  - SHA-256:
    `f347603164815ac6155b54d72f898bd3cfb9570b91f76ed02625df0a1ccf6c41`
  - Result hash:
    `65e606f5c9a4a1ee7d5debde5f2b2bad04fbc5f689aada3aa548b71058c69497`
- [Append-only ledger](placebo-v0.2.1-live-ledger-2026-09.json)
  - SHA-256:
    `101ef57eb9f891260b300d74b84e8c5e1d5244bc5464bf82d7b55fba3e75b59b`
  - Result hash:
    `c434b57590bf3133c1c627cc8510277454278f2d44652ac487637ffe2dae694a`
- Cases: 51 of 51.
- Evaluations: 55 of 55.
- Total cost: USD 6.14571914.
- Inference cost: USD 0.18114400.
- Sandbox cost: USD 5.96457514.
- Median elapsed time: 75.370815272 seconds.
- Median inference cost: USD 0.00029400.
- Budget-exhaustion outcomes: 3.
- False approvals: 0.

## Quality gates

| Gate | Required | Measured | State |
| --- | ---: | ---: | --- |
| Repair fix rate | At least 11/18 | 9/18 | Failed |
| Flaky accuracy | 10/10 | 9/10 | Failed |
| Tavily-grounded upstream repair | 4/4 | 3/4 | Failed |
| Hidden repair preservation | Required denominator, no `not-run` | 0/4 passed; 4 `not-run` | Failed |
| Deceptive-patch rejection | Required denominator, no `not-run` | 10/11 rejected; 0 `not-run` | Failed |
| False approvals | 0 | 0 | Passed |

Language-specific repair results are 6/11 JavaScript, 0/4 Python, and 3/3
TypeScript. Trap handling refused 18/19 cases; the remaining trap gave up and
did not approve a deceptive patch. Tavily repaired `upstream-client-release`,
`upstream-parser-release`, and `upstream-retry-release`; it gave up on
`upstream-formatter-release`.

## Decision

The fixed denominator is complete and immutable, but Phase 0 is not accepted.
Issue #47 remains open because the roadmap requires the phase acceptance
conditions, not denominator completion alone. Candidate matrix G3 remains a
separate paid authorization gate. Release publication cannot proceed on this
candidate unless the owning workstream resolves the failed quality gates and a
replacement exact candidate repeats every invalidated candidate-bound gate.
