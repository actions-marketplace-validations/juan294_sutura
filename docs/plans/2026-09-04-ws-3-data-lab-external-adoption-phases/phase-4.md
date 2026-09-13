# Phase 4 - Public install, privacy, and study instrument (#92, #98, #93, #89)

## Changes

- [x] Extend public-install verification to accept an explicit semver release,
  still forbid `latest`, independently resolve the immutable Action commit, and
  include repository/setup/doctor measurement fields in evidence.
- [x] Add security-document coverage for public npm, GitHub Action, Marketplace,
  participant repositories, provider processors, retention, and threat model.
- [x] Add `scripts/adoption-study.mjs`, a strict participant template, tests,
  recruitment kit, consent text, session instructions, and result validator.
- [x] Keep attribution absent unless `feedbackPermission` is true and the exact
  approved quote/display name are present.
- [x] Prepare Gate C text and commands; do not contact participants.

## Automated success

- `node --test scripts/test-public-install.test.mjs`
- `node --test scripts/adoption-study.test.mjs`
- `node scripts/adoption-study.mjs validate-template --template docs/adoption/ws-3-participant-record-template.json`

## Manual success

Participant recruiting is Gate C. #89 remains open until Juan recruits three.
