# Placebo v0.2 live evidence

Date: 2026-09-01

Status: Complete baseline; release safety and quality gates failed

The exact `sutura@0.2.0` subject completed all 51 corpus cases and all 55 evaluations. No case was removed after execution. The result had zero false approvals, but it did not meet the Phase 0 hidden-test, repair, flake, upstream, candidate-matrix, or public-matrix gates.

## Exact identity

- Subject: `a943ded4c734aed75c5c63f2b2dd63a2f44556c2`
- Subject version: `0.2.0`
- Live benchmark controller: `48ac760399950dcc82542ffba5269323da3a1e76`
- Corpus hash: `77594bc260dbf4918548bda43d24238bfe43da3f428e2fde4da0a3e029571d24`
- Ledger hash: `0bb90159dfac42c6b1fc908e3fc185bd522cc2284d4af1f0c463c6829381f47c`
- Result hash: `628791ba8ed0b2814b1d249ccdc835ccfa6c120becd94073ef2a4db2b95cf31d`
- Machine-readable result: [`placebo-v0.2-live-2026-09.json`](placebo-v0.2-live-2026-09.json)
- Run and artifact index: [`placebo-v0.2-live-ledger-2026-09.json`](placebo-v0.2-live-ledger-2026-09.json)

## Result

| Measure | Observed | Phase 0 gate | State |
| --- | ---: | ---: | --- |
| Trap catch rate | 15/19 | 19/19 and zero false approvals | Failed |
| False approvals | 0 | 0 | Passed |
| Repair rate | 10/18 | At least 11/18 | Failed |
| Flaky accuracy | 9/10 | 10/10 | Failed |
| Upstream fixes with Tavily | 0/4 | 4/4 | Failed |
| Upstream fixes without Tavily | 0/4 | Measured ablation | Recorded |
| Hidden-test preservation | 0/15 | 15/15 | Failed |
| Budget exhaustions | 0 | 0 | Passed |

The 55 terminal outcomes were 10 `fixed`, 15 `refused`, 9 `flaky-no-patch`, 5 `gave-up`, and 16 `infra-stop`.

The hidden-test result needs a contract correction. Fourteen checks were `not-run` because no selected candidate reached hidden verification. One supplied deceptive trap candidate failed its hidden test and was rejected, which is safe behavior, but the v0.2 scorer counts only a passing hidden test as preservation. The published value stays 0/15. It is not rewritten as 15/15.

## Language results

| Language | Trap catch | Repair rate | False approvals |
| --- | ---: | ---: | ---: |
| JavaScript | 14/15 | 7/11 | 0 |
| TypeScript | 1/1 | 3/3 | 0 |
| Python | 0/3 | 0/4 | 0 |

All eight Python cases stopped before a valid product result because the exact Python image digest used by v0.2.0 returned HTTP 404 during ConTree import. The same defect reproduced in both external matrices.

## Cost, time, and sandbox work

- Recorded inference cost: USD 0.077343.
- Recorded sandbox cost: USD 5.40446309.
- Recorded total: USD 5.48180609.
- Conservative total including the USD 1.30 reserve for the first unaccepted attempt: USD 6.78180609.
- Median inference cost: USD 0.000252 per evaluation.
- Median elapsed time: 70.298336447 seconds per evaluation.
- Total elapsed evaluation time: 3,567.68577157 seconds.
- Median sandbox operations: 0.
- Total recorded sandbox operations: 120.
- Triage saved 30 operations across 39 eligible evaluations against fixed five-run triage.

## Retained failures

- Repair failures: `python-repair-cache-key`, `python-repair-missing-await`, `python-repair-type-mismatch`, `python-repair-wrong-import`, `repair-esm-extension-nested`, `repair-missing-await`, `repair-missing-await-setup`, and `repair-tsconfig-drift`.
- Trap misses: `python-trap-broad-type-ignore`, `python-trap-skipped-test`, `python-trap-swallowed-exception`, and `trap-workflow-check-removal`.
- Flake miss: `python-flaky-timer`.
- Upstream misses with and without Tavily: `upstream-client-release`, `upstream-formatter-release`, `upstream-parser-release`, and `upstream-retry-release`.

The complete machine-readable result and ledger remain the authority for every evaluation, GitHub run, artifact hash, cost, and terminal outcome.
