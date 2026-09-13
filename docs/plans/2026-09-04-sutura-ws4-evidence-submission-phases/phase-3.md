# Phase 3: Phase 5 qualitative submission source

Status: Qualitative source integrated and remotely verified at
`625f642afa92bd981e4eb149306383fb925f3aed`; measured/public work remains gated

Issues: #99, #100, #101, #102, #105, #104, draft #56 and #57

## Tasks

1. Create `docs/devpost/sutura-submission.md` with the existing product title,
   one-sentence value, problem, audience, differentiation, workflow, one clear
   architecture diagram, and direct roles for Nano, Super, Ultra, Token
   Factory, ConTree, Data Lab, ATIF, and NeMo Agent Toolkit.
2. Derive the significant-work narrative from commits after the official
   2026-08-26 submission start. Describe shipped repository work; do not claim
   uncommitted or merely planned features.
3. Expand `docs/feedback/2026-10-sutura-nebius-feedback.md` with the observed
   ConTree image 404, Tavily 403, invalid Nemotron JSON,
   `force_nonempty_content`, and completion-limit loops. Keep local contracts,
   live observations, and feature requests visibly separate.
4. Create `docs/devpost/sutura-video-script.md` using the roadmap's six timed
   sections and a total below 180 seconds. Use no final metric until its evidence
   commit exists.
5. Add `scripts/submission-contract.test.mjs` and register it in
   `test:release-contracts`. Test required sections and roles, one diagram,
   local links, version consistency, bounded timeline, and the absence of
   unfinished markers.

## Evidence discipline

No blank metric template, invented number, `TODO`, `TBD`, fake URL, or mutable
release identity enters these files. If a section depends on later evidence, it
is omitted and added in Phase 4 rather than represented by a placeholder.

## Verification

```bash
node --test scripts/submission-contract.test.mjs
pnpm run test:release-contracts
pnpm run test:readme
```

Close #99, #100, #101, #102, #105, and #104 only when each acceptance criterion
is evidenced by committed text on `develop`. #56 and #57 remain open until
their measured/public parts are terminal.
