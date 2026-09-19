# CI recovery planning review

Date: September 14, 2026. Subject: [recovery plan](2026-09-14-sutura-ci-recovery.md) and its six phase files. Reviewed implementation baseline: `31e69ccfaf104741bd89dffe5c09e4af748ab69e` on `develop`.

Two independent read-only research/review passes were used, as required by the project planning workflow. The primary agent read the relevant implementation and incorporated the findings. Both reviewers approved the revised scope. This is plan approval, not implementation or live acceptance.

## Findings and resolutions

| Review finding | Resolution |
| --- | --- |
| REST non-force ref update does not condition target publication on current journal ownership and can admit a stale ancestor race | Phase 5 now uses atomic GraphQL `updateRefs` with explicit before-OIDs for target and journal. Added sibling/ancestor/state-head races and all-or-nothing live checks. |
| Current SHA cannot reveal a branch deleted/recreated or reset back to the same SHA | Require actual rules preventing force updates and deletion; remove the absolute detection claim. Unsupported protection leaves Recover unavailable. |
| “Authenticate through controller” implied an unspecified service | Select authenticated workflow dispatch to trusted controller jobs, derive actor from GitHub context and permit only the App to write the journal. Bound and measure heartbeat job overhead. |
| Requiring an offline candidate producer to prove termination would defeat takeover | Expired producer leases permit a new generation, retaining reservations and rejecting stale submissions. Pending non-fenced side effects reconcile separately. |
| Short reconciler could accidentally own long-running repair work | Separate durable dispatch intent/acknowledgment from long-running bounded worker jobs; add duplicate-delivery and crash-before-ack controls. |
| Incumbent wrapper integration was less concrete than fallback | Add `sutura agent run --adapter claude` for new sessions. No automatic attach to existing Codex/Claude sessions; independent observation still works. |
| Observing a push could imply false agent attribution | Restrict managed registration to its assigned ref and explicitly keep observation/ownership separate from candidate authorship. |

Assurance review confirmed applicable changed-target contracts, exact candidate checks, protected surfaces, nondeploying destinations, independent resulting-CI observation, honest missing-cost handling and preserved exclusions. There is no new per-fix human review requirement. Reviewers identified transport overhead as a pilot measurement concern, not evidence of savings.

## Checks and limits

- Parent, six sequential phase files and this review record exist; phases have dependencies, pseudocode, owned files, automated/live criteria and stop gates.
- Local document checks cover relative links, phase references, source-reference existence/line bounds, unresolved markers and whitespace, including new untracked files.
- Current official GitHub documentation was checked for commit/ref conditions and workflow scheduling/authentication behavior. The selected Claude CLI version/help was inspected locally; no model invocation occurred.
- No application code, workflow, agent schedule, repository permission or remote state changed. No paid run, release or submission action occurred. Application tests were not run for these planning-only Markdown files.
- Actual App permissions, branch rules, atomic races, adapter confinement, authenticated execution and end-to-end recovery remain mandatory implementation/pilot evidence. Documentation and mock tests cannot substitute for those probes.

All planning design decisions are resolved. Begin implementation with phase 1; do not describe any planned capability as already enabled.
