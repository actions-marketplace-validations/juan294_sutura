# Phase 2: Make policy, provider, and terminal evidence fail closed

Status: Implemented and verified locally

## Goal

Give every expected safe stop the correct terminal class and produce a valid artifact even when execution stops early.

## Work

1. Map repository-policy denial to `refused` with the exact policy finding. Keep true search exhaustion as `gave-up`.
2. Add one bounded strict-schema retry for an invalid diagnosis response. Charge both calls to the existing total inference budget.
3. Add a terminal failure envelope with `infra-stop`, error class, observed costs, `costStatus`, fixture identity, package identity, and available operation IDs.
4. Run matrix collection and upload under `always()` after fixture identity exists. Do not require an HTML case artifact or repair PR for `infra-stop`.
5. Make the local controller accept a completed failed workflow only when its terminal artifact validates. A failed workflow without that artifact remains a hard stop.
6. Test controller resume, cleanup ownership, unknown cost, and early Action/audit failure.

## Automated success criteria

- Both repository-policy matrix fixtures end as `refused` and are not false approvals.
- One invalid provider response followed by one valid response succeeds within the same budget.
- Two invalid responses produce one validated `infra-stop` artifact.
- Deleted-image, provider, Action, and collector failures retain exact fixture and run identities.
- No test requires manual ledger or fixture-SHA reconstruction.
- Focused tests and the complete local gate pass.

## Manual success criteria

- Inspect one early Action failure and one audit-only failure artifact.
- Confirm unavailable cost is labeled unavailable and is not described as zero spend.

Stop after the phase is integrated into local `develop` and its task worktree is removed.
