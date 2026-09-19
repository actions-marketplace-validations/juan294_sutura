# Phase 5: Bounded completion on nondeploying work branches

Parent: [CI recovery plan](../2026-09-14-sutura-ci-recovery.md). Depends on: phase 4. Status: planned.

## Changes

Add `packages/core/src/recovery/{eligibility,publication}.ts` and race/fault tests. Extend GitHub recovery API, Action repository publication and orchestrator integration. Add exact-candidate check collection and explicit App credential plumbing; retain existing verify mode's no-mutation boundary. Update doctor/setup qualification and the Action bundle in the same phase.

Recover v1 advances only an explicitly permitted work branch. It never merges the original feature PR, uses the PR merge API, changes branch rules or bypasses required review. A destination requiring PR integration remains Repair. Bootstrap includes a scoped GitHub App credential held by trusted controller jobs, with minimum permissions verified against actual endpoints. The candidate producer receives none of it.

```text
candidate = create immutable single-parent commit(parent=sourceSha, bytes=verifiedDiff)
assert every changed target has applicable frozen contract coverage
publish generation-specific candidate branch through sole publisher
record actual repair PR identity; run allowed candidate checks on exact candidateSha

complete incident:
  require no ambiguous prior side effect or old publisher process
  require active generation, current policy and deployment qualification
  require target==sourceSha and candidate.parents==[sourceSha]
  require exact source/diff/policy/evidence/check identities, every required gate passed
  intentHead = atomically write intent(operationId, target, sourceSha, candidateSha)
  publicationCommit = prebuild journal child of intentHead recording target-written
  recheck eligibility, then GitHub updateRefs atomically:
    targetRef: beforeOid=sourceSha, afterOid=candidateSha, force=false
    stateRef: beforeOid=intentHead, afterOid=publicationCommit, force=false
  on conflict: reread both refs and reevaluate; never weaken conditions
  on timeout: reconcile operation ID and both refs; never assume failure
  observe configured CI on resulting work-branch revision
  green -> recovered; red/missing -> bounded handoff or explicit blocked reason
```

Use GitHub's documented [atomic multi-ref update](https://docs.github.com/en/graphql/reference/git#updaterefs), not REST `updateRef`. Prebuilding an unreferenced journal commit must not advance any ref or execute repository code. Both updates must satisfy repository rules without bypass; unavailable API/rules support disables Recover. This transaction commits target advancement and its journal event together. Any ownership, disable or policy transition advances the journal head and fences an older transaction. A disable is acknowledged only after its journal CAS commits; an already-committed target advance is reconciled, not undone.

Serialize publication workers, with cancellation disabled, while treating the journal and API conditions as the correctness boundary. Candidate workers cannot mutate remote code. A missing producer heartbeat permits generation takeover because the producer cannot publish; it does not release worst-case cost reservations. Outstanding non-fenced branch/PR/provider operations require actual state reconciliation and, where needed, authoritative publisher-job termination before repetition. Keep these intents deterministic by incident, generation and candidate hash. Timeouts before/after branch, PR and target writes read back actual state. No claim of exactly-once external APIs; the contract is one reconciled logical operation with no blind retry.

The explicit before-OID checks reject both sibling advances and stale ancestor targets, while the single-parent invariant retains narrow scope. Require repository rules preventing deletion and force updates of watched work and journal refs, without allowing the App to bypass them. Current SHA/ancestry cannot detect a delete/recreate or force-reset that returns to the identical SHA; do not claim an ABA detector. If rules cannot prevent this condition, Recover is unavailable. Do not recreate a vanished target. Conflicting/unexpected branch history requires requalification.

Workflows must expose trusted exact-candidate checks, with expected workflow/check producer IDs. A synthetic PR merge SHA or an agent's own check is insufficient. Required checks that behave differently on the original branch need an independently qualified equivalent or Recover stays disabled. After advancing the work branch, correlate its actual CI/PR-head checks and remain responsible until completion/deadline. Do not recurse into a new budget because the repair itself failed CI.

Initial target scope is deliberately small: at most two mapped code files, contracts covering changed callables/properties and explicit exclusions for tests, workflow/policy/instructions, dependency, credential, authorization, payment, migration and deploy code. Verify changed syntax targets, not just globs. Unsupported dependency/impact mapping abstains. Passing sampled contracts still does not prove universal correctness.

## Automated acceptance

- [ ] Optional, absent, unrelated or omitted challenge/required-command evidence never unlocks completion.
- [ ] Changes outside mapped targets, indirect unqualified impact, reserved paths and forgeable check producers refuse before target writes.
- [ ] Correct approved candidate and exact required checks permit only its configured destination.
- [ ] Two publishers, expired worker, lost response and crash after each external step reconcile without duplicate promotion.
- [ ] Newer sibling or stale ancestor target during promotion rejects both target and journal update; no overwrite or false recovery.
- [ ] Journal ownership/disable/policy change during publication rejects both updates; an acknowledged disable fences old publication transactions.
- [ ] Branch rules block force/delete; unsupported rules, protection requiring PR, deployment ambiguity and freeze activation stop completion without bypass.
- [ ] Candidate changes after verification or checks refer to a different SHA invalidate eligibility.
- [ ] Published branch with red/missing/pending CI remains unresolved; retained incident budget prevents repair loops.
- [ ] Emergency disable stops new actions; pending outcomes reconcile without cancelling unrelated CI or reverting code.

Run focused controls, full `ci:local`, bundle parity and guard coverage sequentially before a push. Live guards require captured sanitized response/log fixtures.

## Operator/live acceptance

- [ ] Demonstrate one correct branch recovery and one deceptive candidate refusal in the authorized nondeploying demo repository.
- [ ] Run bounded real sibling/stale-ancestor/state-head races and publication-timeout rehearsals. Confirm atomic all-or-nothing behavior and both resulting refs, not only mocks.
- [ ] Verify App-created candidate/target events actually run CI unattended and that state writes trigger no CI/deployments.
- [ ] Prove disabling Recover leaves verification and reporting usable; no force updates or production effects occurred.

Failure of any live concurrency, trigger, confinement or assurance gate leaves Recover disabled. Stop at the phase gate unless continuous execution is authorized.
