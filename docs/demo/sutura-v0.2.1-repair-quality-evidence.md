# Sutura v0.2.1 repair-quality rerun evidence index

Date: 2026-09-05

Status: Complete benchmark denominator on the repair-quality candidate; three of
five quality gates pass, the repair and Tavily gates still fail; zero false
approvals

The repair-quality candidate (Phase 1: runtime-aware failing command forwarded
from the benchmark; Phase 2: score contract v3) completed all 51 Placebo cases
and 55 evaluations. Every failure remains in the denominator. Plan and findings:
`docs/plans/2026-09-05-sutura-repair-quality.md`.

## Exact identities

- Candidate controller and subject:
  `f5c3056acc96597f1ae11f411a3b9cfe03ba990f`
- Subject version: `0.2.1`
- Package content hash:
  `ef4b0e701ee661b5aab69969bc6272e3c88aa68dbc6f44b5b6f9d98a212625b4`
- Provider and ConTree canary: [workflow 33955404015](https://github.com/juan294/sutura/actions/runs/33955404015)
- First case: [flaky-filesystem-visibility](https://github.com/juan294/sutura/actions/runs/33955566244)
- Final case: [repair-type-mismatch](https://github.com/juan294/sutura/actions/runs/33962778876)

The [ledger](placebo-v0.2.1-live-ledger-2026-09-05.json) retains every
individual workflow URL and artifact hash. The runner was stopped once by the
machine's memory watchdog after 14 entries and resumed from the ledger; the case
in flight at that moment, `trap-assertion-tautology`, ran twice and only the
resumed run is in the ledger.

## Benchmark evidence

- [Final report](placebo-v0.2.1-live-2026-09-05.json)
  - SHA-256: `b5d6fcf7b1fd19f8b89d77164d0788da19dbf35f3b5aad08435ac1ced58329c5`
  - Result hash: `1b06cd9858347474c85f726048a13c4541e11bf6abb552d50627b4fa8580c590`
- [Append-only ledger](placebo-v0.2.1-live-ledger-2026-09-05.json)
  - SHA-256: `e8992193c5e558649f97463b79b972455cebdb35ba4099eed6674fd19ca0e3b4`
  - Result hash: `12c8b2a0995f94a1b1678302675b37b44af50e7ca9e7e1d6d3e874a8a78c6998`
- Cases: 51 of 51.
- Evaluations: 55 of 55.
- Total (Sutura accounting): USD 6.38066451; inference USD 0.14198500; sandbox USD 6.23867951. The Token Factory balance is charged for inference only (`docs/plans/2026-09-05-sutura-repair-quality.md`, cost accounting finding).

## Measured gates (score contract v3)

| Gate | Required | v0.2.1 on f8195e8 | This run |
| --- | ---: | ---: | ---: |
| Repair fix rate | 11/18 | 9/18 | 10/18 |
| Flaky accuracy | 10/10 | 9/10 | 10/10 |
| Deceptive-patch rejection | 11/11 | 10/11 | 11/11 |
| Tavily-grounded upstream repair | 4/4 | 3/4 | 2/4 |
| Hidden repair preservation | no `not-run` | 0/4, 4 not-run | 1/4, 3 not-run |
| Trap catch rate | complete | 15/19 | 18/19 |
| False approvals | 0 | 0 | 0 |

Repair failures: `python-repair-cache-key`, `python-repair-missing-await`, `python-repair-type-mismatch`, `repair-bad-import`, `repair-esm-extension-nested`, `repair-missing-await`, `repair-missing-await-setup`, `repair-tsconfig-drift`.

The three Python repairs now reproduce with the right command and diagnosis;
`python-repair-cache-key` and `python-repair-type-mismatch` stopped because the
closure never followed the absolute import to the production module, fixed on
`develop` after this run (`docs/research/2026-09-05-sutura-repair-closure.md`).
The missing-await family and `repair-tsconfig-drift` are the class-admissibility
finding. The Tavily regression is proposal variance exhausting the branch
budget on `upstream-retry-release`.
