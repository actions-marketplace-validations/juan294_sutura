# Phase 4: Off-site presence: GitHub, npm, Marketplace, Devpost

Depends on: none. `[batch-eligible]` with Phases 1 and 2 (no shared files).

## Goal

Every place Sutura is already listed links to the Case Lab and carries descriptive metadata, so search engines see a consistent name, description, and canonical site across GitHub, npm, and Devpost.

## Files

- `README.md:14-19`
- `packages/cli/package.json:20-30`
- Repository settings on GitHub (homepage, topics, social preview): applied with `gh api`, recorded here
- `docs/adoption/ws-3-marketplace-checklist.md` (one added line)
- `docs/devpost/sutura-submission.md` (link line)
- `/Users/juan/code/sutura-demo/README.md` (Case Lab URL, currently deferred until Gate A)

## Changes

1. `README.md`: add a line under the badges: "Try it: [Sutura Case Lab](https://sutura-case-lab.vercel.app/) — five verified CI repairs, no account needed." Replace the paragraph at `:14-19` so its first sentence links the Case Lab URL. `pnpm run test:readme` must still pass; the `<!-- setup-check -->` block is untouched.
2. Repository metadata:
   ```bash
   gh api -X PATCH repos/juan294/sutura -f homepage=https://sutura-case-lab.vercel.app
   gh api -X PUT repos/juan294/sutura/topics -f 'names[]=ci-repair' -f 'names[]=github-actions' -f 'names[]=nebius' -f 'names[]=nemotron' -f 'names[]=self-healing-ci' -f 'names[]=tavily' -f 'names[]=ai-agents' -f 'names[]=continuous-integration' -f 'names[]=devops' -f 'names[]=typescript' -f 'names[]=flaky-tests' -f 'names[]=code-repair'
   ```
   Social preview image: upload `packages/case-lab/assets/social-card.png` in Settings → General → Social preview (no API; manual, Juan).
3. `packages/cli/package.json`: `homepage` → the Case Lab URL; `keywords` → `ci`, `github-actions`, `ai`, `ai-agents`, `code-repair`, `self-healing-ci`, `flaky-tests`, `nemotron`, `nebius`, `testing`, `devops`. Do not change `description` (preflight parity). Do not publish; the next release carries it.
4. `docs/adoption/ws-3-marketplace-checklist.md`: add a gate line "Listing description links to the Case Lab URL". Publication stays gated.
5. `docs/devpost/sutura-submission.md`: ensure the "Try it out" links list the Case Lab first, then the repository.
6. `sutura-demo/README.md`: replace the "URL recorded once Gate A runs" sentence with the live URL and note that live runs are disabled until Gate A.

## Verification

- `pnpm run test:readme && pnpm run ci:fast`
- `gh api repos/juan294/sutura --jq '{homepage,topics}'` shows the new values.
- `cd /Users/juan/code/sutura-demo && pnpm run verify:readme && pnpm test`
- `node scripts/marketplace-evidence.mjs preflight --candidate "$(git rev-parse HEAD)"` still passes on the task branch.

## Success criteria

- [x] Repository homepage and topics updated; social preview uploaded.
- [x] README, npm metadata, Devpost draft, and demo README link the Case Lab.
- [x] Marketplace preflight still passes.
