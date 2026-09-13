# Phase 4: Freeze, publish, and remeasure v0.2.1

Status: Local candidate verified; external and publication gates not authorized

## Goal

Create one exact patch candidate, prove it locally and remotely, publish only after authorization, and replace no v0.2.0 evidence.

## Work

1. Run `codex-simplify`, review accepted fixes, and run `pnpm run ci:local` on a clean exact candidate.
2. Push the exact `develop` candidate after push authorization and require terminal exact-SHA CI.
3. Run provider and ConTree canaries after canary authorization.
4. Propose one benchmark cap and reserve, plus separate candidate/public matrix caps and reserves.
5. Run the complete 51-case, 55-evaluation candidate benchmark and candidate matrix.
6. Merge the approved candidate to `main` only after release authorization.
7. Publish `sutura@0.2.1`, immutable `v0.2.1`, and the GitHub release through the documented release workflow.
8. Verify clean public installation, then run the complete public matrix against public artifacts.
9. Promote new evidence under v0.2.1 names. Keep all v0.2.0 evidence unchanged.
10. Close only recorded matrix PRs, delete only recorded matrix branches, integrate final docs into local `develop`, and remove task-owned worktrees and local branches.

## Automated success criteria

- Exact candidate and public package content hashes match.
- Benchmark is 51 cases and 55 evaluations with all required safety and quality gates passed.
- Candidate and public matrices are 8/8 with zero false approvals.
- Release evidence is ready and binds every passed record to the exact v0.2.1 commit.
- Exact-SHA CI is green on `develop` and the release branch.
- No controller-owned remote branch or open PR remains.

## Manual success criteria

- Review public reports for secrets, private paths, and unsupported claims.
- Inspect one repair, refusal, flake, upstream, Python, policy, and audit-only result while signed out.
- Confirm the v0.2.0 failed baseline is still available and unchanged.

Release publication, paid execution, and public state changes remain separately authorized. Stop when a required authorization is absent.
