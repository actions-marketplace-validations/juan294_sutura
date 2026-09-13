# Phase 5: Phase 6 exact candidate and release

Status: Active on the frozen integrated candidate line based at
`096a48e7ffb5e95103ee91746644386bba1a0c12`

Issues: #107-#115

## Candidate boundary

1. Fetch `origin/develop`; require clean local `develop` at the exact remote
   head. Confirm terminal integrated commits for all three upstream workstreams.
2. Record that 40-character SHA as the candidate in the roadmap and a new
   candidate evidence note. Close #107 only when the feature-freeze state is
   committed and communicated.
3. Enforce #108 by admitting only security, release, evidence, or demo-blocking
   fixes. Any admitted fix replaces the candidate and resets steps 4-8.

## Local and remote gates

4. Run `pnpm run ci:local` sequentially on the exact candidate (#109).
5. Run `node scripts/test-candidate-install.mjs "$CANDIDATE_SHA"`, the
   candidate matrix contract, and the exact-SHA release-candidate workflow
   (#110).
6. Execute G4 only after authorization; retain both SHA-bound canary artifacts
   (#111).
7. Perform the documented reuse, quality, and efficiency review fallback and
   independent plan-compliance review; fix and rerun gates as needed (#112).
8. Assemble the eleven-record v0.2.1 release-evidence input. Require complete,
   ready, exact-identity output before publication.

## Release

9. Present the complete diff and G5. After separate authorization, follow the
   develop-based release path exactly (#113).
10. Publish v0.2.1 only if the verified candidate is not already the immutable
    public v0.2.1 identity; otherwise document why no later patch is needed
    (#114).
11. Verify npm, Action tag, Marketplace listing, GitHub release, publish
    workflow artifact, and `node scripts/test-public-install.mjs` in a clean
    environment (#115).

Each issue closes only after the exact gate evidence and integrated commit are
on `develop`. Publication failure stops; it is never papered over by a second
release.
