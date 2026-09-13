# Phase 1: Remove the collaborator-only instruction

Issue: #68

Depends on: none

## Goal

No public document tells a visitor to run a `workflow_dispatch` workflow that requires collaborator access.

## Files

- `/Users/juan/code/sutura-demo/README.md` (separate public repository, WS-1 owned "demo workflows, README demo section")
- `README.md:15-17` in this repository

## Changes

1. `sutura-demo/README.md`: replace the "Judge path" section (`:7-16`) with a "Case Lab" section that says the public Case Lab (URL recorded once Gate A runs; until then the sentence names the package and states that the public path is disabled) accepts five fixed cases and needs no GitHub account, that collaborators may still use the `Break me` and `Sutura external matrix case` workflows for maintenance, and that the visitor path never accepts arbitrary repositories, refs, commands, patches, or text. Keep the cases table, updated to five rows with the Case Lab ids. Update `:50` to reference `packages/case-lab/release.json` as the pin source (value updated in Phase 6).
2. `README.md:15-17`: replace the three-line paragraph with one that names the Case Lab (`packages/case-lab`), states that it is self-service for signed-out visitors once the public-demo gate is authorized, and that every case has a labeled deterministic replay.
3. `sutura-demo/scripts/verify-readme.mjs` must still pass (it extracts the `<!-- setup-check -->` block; leave that block unchanged).

## Verification

- `cd /Users/juan/code/sutura-demo && pnpm run verify:readme && pnpm test` (workflow-contract test still passes; `break-me.yml` is unchanged in this phase).
- `grep -n "Run workflow" /Users/juan/code/sutura-demo/README.md` returns nothing.
- `pnpm run test:readme` in this repository.

## Success criteria

- [x] `sutura-demo/README.md` has no instruction to run a workflow manually.
- [x] `README.md` describes the Case Lab and the gate honestly.
- [x] Both README checks pass.
