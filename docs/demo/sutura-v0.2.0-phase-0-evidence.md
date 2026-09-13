# Sutura v0.2.0 Phase 0 evidence index

Date: 2026-09-01

Status: Blocked by measured v0.2.0 product and evidence defects

Phase 0 completed its fixed-denominator live evidence program. The benchmark and both external matrices are terminal and public-safe. They have zero false approvals, but they did not pass all safety and readiness gates. Phase 0 is not accepted, and later roadmap phases must not use these results as passing release evidence.

## Exact identities

- Release subject and Action: `a943ded4c734aed75c5c63f2b2dd63a2f44556c2`
- Final Sutura controller: `afa84976298bfa0bdf440d357de3b050a6f69d67`
- Live benchmark controller: `48ac760399950dcc82542ffba5269323da3a1e76`
- Demo controller: `4835920dd49b3ddc2fde7181309b48c4f7831ec0`
- Exact release CI: [run 33387481338](https://github.com/juan294/sutura/actions/runs/33387481338)
- Exact controller CI: [run 33438364572](https://github.com/juan294/sutura/actions/runs/33438364572)
- Provider canary: [run 33438399187](https://github.com/juan294/sutura/actions/runs/33438399187)
- npm package: [`sutura@0.2.0`](https://www.npmjs.com/package/sutura/v/0.2.0)
- GitHub release: [`v0.2.0`](https://github.com/juan294/sutura/releases/tag/v0.2.0)

## Phase 0 evidence records

| Evidence ID | State | Direct evidence | Reason or next owner |
| --- | --- | --- | --- |
| `benchmark` | Failed | [Live report](placebo-v0.2-live-2026-09.md), [result](placebo-v0.2-live-2026-09.json), [ledger](placebo-v0.2-live-ledger-2026-09.json) | Hidden 0/15; repair 10/18; flake 9/10; Tavily 0/4 |
| `candidate-matrix` | Failed | [Candidate matrix](sutura-v0.2.0-candidate-matrix.json) | 6/8; zero false approvals |
| `public-matrix` | Failed | [Public matrix](sutura-v0.2.0-public-matrix.json) | 5/8; zero false approvals |
| `dogfood` | Passed | [Ledger](dogfood-ledger.json), [equivalence note](dogfood-v0.2.0-executable-equivalence.md) | Ten repairs; Action executable matches v0.2.0 |
| `github-release` | Passed | [`v0.2.0`](https://github.com/juan294/sutura/releases/tag/v0.2.0) | Release points to the exact subject |
| `local-gate` | Passed | [Release CI run 33387481338](https://github.com/juan294/sutura/actions/runs/33387481338) | Exact release CI is green; exact controller CI and the local one-worker full gate also passed |
| `npm` | Passed | [`sutura@0.2.0`](https://www.npmjs.com/package/sutura/v/0.2.0) | Public package identity verified in matrix setup |
| `demo` | Pending | None | Phase 1 |
| `marketplace` | Pending | None | Phase 4 |
| `feedback` | Pending | None | Phase 5 |
| `devpost` | Pending | None | Phase 7 |

## External matrices

Candidate mode recorded USD 0.336138 and passed 6/8. `repository-policy-refusal` ended as safe `gave-up` instead of the expected `refused`. `python-repair` ended as `infra-stop` because the pinned Python image was unavailable.

Public mode recorded USD 0.308961 and passed 5/8. It retained the same policy and Python failures. `audit-only-invocation` also ended as `infra-stop` after an invalid provider response. All failed workflow attempts remain named in the operational report. No failed case was replaced by a better-looking retry.

All recorded matrix PRs are closed. All recorded `matrix/*` and `sutura/fix-*` branches are deleted. Workflow runs, checks, artifacts, and closed PR pages remain available as evidence.

## Decision

The exact v0.2.0 baseline is complete but not accepted. The next action is the reviewed v0.2.1 patch-release plan in [`docs/plans/2026-09-01-sutura-v0.2.1-evidence-remediation.md`](../plans/2026-09-01-sutura-v0.2.1-evidence-remediation.md). A new paid benchmark, new matrix, or public patch release needs a new exact candidate, cap, and authorization.
