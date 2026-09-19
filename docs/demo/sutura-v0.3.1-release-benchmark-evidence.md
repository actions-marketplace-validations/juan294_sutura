# Sutura v0.3.1 release benchmark evidence index

Date: 2026-09-17

Status: Complete benchmark denominator on the v0.3.1 release commit; zero
false approvals; two provider infrastructure stops disclosed; the optional
second-opinion and calibrated-audit voices were not exercised by this benchmark
(see Limitations).

The v0.3.1 release commit (tag `v0.3.1`) completed all 51 Placebo cases and 55
evaluations under the release-mode benchmark gate (`--release-tag v0.3.1`).
Every failure remains in the denominator. Plan:
`docs/plans/2026-09-17-typesafe-jev-calibrated-audit.md` Phase 4; deviations in
`docs/plans/2026-09-17-typesafe-jev-calibrated-audit-notes.md`.

## Exact identities

- Candidate controller and subject:
  `e724f3b22de79d6ab3f40cffa96de7776c256ce9`
- Subject version: `0.3.1`
- Package content hash:
  `03ebcc211dda8811755c5be98331c79630c838d65a2b3e4515c21e6ba8285e8d`
- Provider and runtime-image canary: [workflow 35206960212](https://github.com/juan294/sutura/actions/runs/35206960212)
- First case: [flaky-filesystem-visibility](https://github.com/juan294/sutura/actions/runs/35207350759)
  (recorded 2026-09-17T09:54:21Z)
- Final case: [repair-type-mismatch](https://github.com/juan294/sutura/actions/runs/35232345823)
  (recorded 2026-09-17T14:19:02Z)

The [ledger](placebo-v0.3.1-live-ledger-2026-09-17.json) retains every
individual workflow URL and artifact hash. All 51 ledger entries are for
distinct cases; no case ran twice.

Interruptions, taken from the ledger and the manifest-spend account:

- After case 16 the controller died because its GitHub run-listing poll
  exceeded its 120 s subprocess timeout. The pending reservation for
  `trap-deleted-test` was reconciled as never dispatched (zero runs created
  after 10:40Z, none carrying its controller id) and the case was dispatched
  fresh on resume.
- Case 24, `trap-snapshot-acceptance`, ended in `infra-stop`: Nemotron Nano
  returned an invalid diagnosis response before any sandbox work. Its
  reservation was settled at the artifact's recorded cost, USD 0.
- Case 47, `repair-null-guard`, ended in `infra-stop`: ConTree sandbox
  preparation failed with a socket timeout before any model call. Its
  reservation was settled at an explicit upper-bound estimate, USD 0.189624
  (the highest per-case cost recorded in this run), marked as an estimate in
  the account.
- After the first infra-stop the remaining cases ran one at a time through the
  single-case path under `SUTURA_ALLOW_INFRA_STOP_LEDGER=1`, an explicit
  operator decision. Both infra-stop entries remain in the result.

## Benchmark evidence

- [Final report](placebo-v0.3.1-live-2026-09-17.json)
  - SHA-256: `a9ddfaa5147dda9a353117fd8318ea85b7b57854797d584534ffc6f3800df506`
  - Result hash `b4174575388310fc7164fc094450fe0d2d967a7087328642c853d61ed20fcdfd`
    equals the ledger's `resultHash`, verified by the promotion identity check
- [Ledger](placebo-v0.3.1-live-ledger-2026-09-17.json)
  - SHA-256: `934cf97412a9009a361af69b220a248d395747f290329e4611552209a1f7e6c6`
- 51/51 cases, 55/55 evaluations (10 flaky, 19 trap, 18 repairable, 8 upstream
  evaluations across 4 cases)
- Recorded totals: USD 3.77378306 (inference USD 0.144067, sandbox USD
  3.62971606). Inference is billed from the token ledger only; sandbox is the
  reported ConTree cost. The `repair-null-guard` estimate above is in the
  manifest-spend account, not in these totals, because the artifact recorded
  no cost.

## Measured gates (score contract v3)

| Gate                       | v0.3.0 (2026-09-15) | v0.3.1 (2026-09-17)                                                      |
| -------------------------- | ------------------- | ------------------------------------------------------------------------ |
| False approvals            | 0                   | 0                                                                        |
| Trap catch rate            | 18/19               | 17/19 (one `infra-stop`, one `gave-up` on `trap-workflow-check-removal`) |
| Fix rate                   | 15/18               | 10/18 (one `infra-stop`; the other seven gave up)                        |
| Flaky accuracy             | 10/10               | 10/10                                                                    |
| Hidden repair preservation | 4/15                | 3/15                                                                     |
| Inference cost             | USD 0.15101         | USD 0.144067                                                             |
| Total recorded cost        | USD 4.11234948      | USD 3.77378306                                                           |

The fix-rate drop is a real measurement on the same corpus and the same
subject code path for repairs. Both provider infrastructure stops happened on
this day, and the seven gave-up repairs were not investigated before this
index was written; treat the difference as unexplained rather than attributed.

## Limitations

- **The GPT-6 Astra second opinion and the TypeSafe Jev calibrated audit did
  not run in this benchmark.** The Placebo benchmark workflow at the tag
  (`.github/workflows/placebo-live-case.yml`) passes only `NEBIUS_API_KEY` and
  `TAVILY_API_KEY` to the subject, so every case file records both rows as
  `skipped: Not configured`. This is a gap in the benchmark workflow, not in
  the product: the public Case Lab demo workflow passes both keys, and the
  v0.3.1 live smoke run on the Case Lab is where those rows are exercised
  publicly. Fixing the benchmark workflow requires a later release tag.
- Zero false approvals does not mean every trap was caught: one trap ended in
  an infrastructure stop and one in a gave-up.
- The `repair-null-guard` cost is an estimate, labelled as such in the
  manifest-spend account; every other figure is measured.
