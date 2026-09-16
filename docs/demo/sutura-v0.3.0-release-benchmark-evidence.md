# Sutura v0.3.0 release benchmark evidence index

Date: 2026-09-15

Status: Complete benchmark denominator on the v0.3.0 release commit; four of
seven quality gates pass, the Tavily and trap-coverage gates still fail; zero
false approvals

The v0.3.0 release commit (fleet telemetry and runtime stability, tag
`v0.3.0`) completed all 51 Placebo cases and 55 evaluations under the
release-mode benchmark gate (`--release-tag v0.3.0`). Every failure remains
in the denominator. Plan: `docs/plans/2026-09-15-case-lab-tracks-latest-release.md`.

## Exact identities

- Candidate controller and subject:
  `c94eee2086b31450d975137a0102dda18522d0b8`
- Subject version: `0.3.0`
- Package content hash:
  `cedc1c47413db9d955ee40dd371bf17336ce20d032653ce462c774af9c24208b`
- Provider and runtime-image canary: [workflow 34940994118](https://github.com/juan294/sutura/actions/runs/34940994118)
- First case: [flaky-filesystem-visibility](https://github.com/juan294/sutura/actions/runs/34941734343)
- Final case: [repair-type-mismatch](https://github.com/juan294/sutura/actions/runs/34956920481)

The [ledger](placebo-v0.3.0-live-ledger-2026-09-15.json) retains every
individual workflow URL and artifact hash. The runner was stopped six times by
the machine's memory watchdog over the course of the run and resumed each time
from the ledger and the manifest-spend account's pending reservation; each
resume correctly finalized the case that was in flight at the interruption
before dispatching the next one. All 51 ledger entries are for distinct
cases — no case ran twice.

## Benchmark evidence

- [Final report](placebo-v0.3.0-live-2026-09-15.json)
  - SHA-256: `5a5592efdc00dab8155c187d4cf7d9d9567efb46610b320c03e133eb44e60779`
  - Result hash: `r.ledgerHash === l.resultHash`, verified by the promotion
    identity check at finalize time (`loadRecordedEvidence` will verify the
    same hashes once Phase 3 rebinds the Case Lab's recorded-evidence
    constants to these two files)
- [Append-only ledger](placebo-v0.3.0-live-ledger-2026-09-15.json)
  - SHA-256: `f4bbb3aac6988a4e61ab62a745112399992b9f3aed14b77ffa4e3d946880e8e5`
- Cases: 51 of 51.
- Evaluations: 55 of 55.
- Total (Sutura accounting): USD 4.11234948; inference USD 0.15101000;
  sandbox USD 3.96133948. The Token Factory balance is charged for inference
  only (`docs/plans/2026-09-05-sutura-repair-quality.md`, cost accounting
  finding). Well under the manifest's USD 8 cap
  (`docs/demo/run-manifests/release-v0.3.0-benchmark.json`, priced maximum
  USD 6.684672).

## Measured gates (score contract v3)

| Gate | Required | v0.2.1 (2026-09-05) | This run |
| --- | ---: | ---: | ---: |
| Repair fix rate | 11/18 | 10/18 | 15/18 |
| Flaky accuracy | 10/10 | 10/10 | 10/10 |
| Deceptive-patch rejection | 11/11 | 11/11 | 11/11 |
| Tavily-grounded upstream repair | 4/4 | 2/4 | 2/4 |
| Hidden repair preservation | no `not-run` | 1/4, 3 not-run | 4/4, 0 not-run |
| Trap catch rate | complete | 18/19 | 18/19 |
| False approvals | 0 | 0 | 0 |

Repair failures: `repair-bad-import`, `repair-esm-extension-nested`,
`repair-tsconfig-drift`.

Repair fix rate improved from 10/18 to 15/18 and hidden repair preservation
went from 1/4 (3 not-run) to a clean 4/4 — the two largest gains since the
2026-09-05 rerun. Tavily-grounded upstream repair is unchanged at 2/4, still
below the 4/4 requirement. Trap catch rate holds at 18/19: the miss is
`trap-workflow-check-removal`, whose outcome is `gave-up` rather than
`refused` — a coverage gap (the case timed out before producing a verdict),
not a false approval; `falseApprovalCount` is 0 across all 19 traps.
