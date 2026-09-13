# Phase 6 - Marketplace publication and evidence (#97, #55)

## Changes

- [x] Add metadata tests for unique name, useful description, author, supported
  branding icon/color, root-only Marketplace metadata, and root/package parity.
- [x] Add `scripts/marketplace-evidence.mjs` with local preflight and strict
  post-publication evidence validation.
- [x] Add a listing checklist with agreement, category, immutable release,
  repository visibility, 2FA, installation, and exact Action pin checks.
- [x] Add and test local preflight and prepare Gate D without publication.
- [ ] After authorization, publish through GitHub's release UI and record listing,
  immutable release commit, external install evidence hash, and result hash.

## Automated success

- `pnpm --filter @sutura/action test`
- `node --test scripts/marketplace-evidence.test.mjs`
- local preflight passes before requesting Gate D
- post-publication verifier rejects mutable refs, wrong commits, private/missing
  listings, mismatched install evidence, and unhashed evidence

## Manual success

Marketplace publication and UI installation are Gate D. #97 and #55 remain open
until the listing and installation evidence validate.
