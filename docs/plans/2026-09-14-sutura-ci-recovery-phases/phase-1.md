# Phase 1: Durable incidents, policy and limits

Parent: [CI recovery plan](../2026-09-14-sutura-ci-recovery.md). Depends on: approved plan. Status: planned.

## Changes

Add `packages/core/src/recovery/{types,policy,transitions,budget,store}.ts` and focused sibling tests. Add `packages/core/src/github/recovery-store.ts`; extend GitHub types/API adapters to carry numeric repository/workflow identities and run attempts. Export stable contracts from core. Add fixture policies under `packages/core/test/fixtures/recovery/`.

Keep `.sutura.json` semantics intact. Parse `.sutura-recovery.json` separately, bound from a controller-selected trusted commit. Validate exact refs, check producer identities, principal/adapter allowlists, limits, mode and contract-to-target qualifications. Policy absence means legacy behavior, never automatic Recover. Both policies and trusted instruction/contract files are protected candidate paths.

Store an active index, repository budget account and immutable per-transition records on one dedicated orphan `sutura-state` branch. Initial creation must handle two installers racing without overwriting an existing branch. Normal writes use `createCommitOnBranch(expectedHeadOid)`. State-branch rules restrict writes to the controller App and prohibit force updates/deletion. If those rules cannot be established, recovery coordination is not qualified; do not trust an arbitrary contributor's direct journal edit.

Local command requests enter through authenticated `workflow_dispatch` on the trusted controller workflow. Derive actor identity from GitHub's authenticated dispatch context, check the configured principal allowlist, validate operation ID/session/revision/generation and bounded inputs, then mutate through the App. Payload actor fields cannot override the authenticated sender. A rerun is reauthorized against its actual triggering identity and cannot replay a spent command. Controller verification/worker events are derived within trusted jobs; local commands cannot assert a gate passed. Local CLI credentials authorize dispatch/read only as required by the chosen repository credential; journal branch rules deny direct writes. Candidate model processes receive neither local dispatch credentials nor App credentials. Status uses read-only API access.

```text
transition(opId, command):
  repeat at most 5 times with bounded jitter:
    head, state, serverTime = read authenticated journal
    if state.contains(opId): return recorded result
    reject invalid actor, stale generation, policy mismatch or time uncertainty
    next = reducer(state, command, serverTime)
    reserve incident + repository resources in next, atomically
    commit(expectedHeadOid=head, event=opId, materializedState=next)
    on conflict: reread
    on timeout: search committed opId before retry
  return contention-blocked
```

Use fresh GitHub response time, never candidate timestamps. Lease acquisition, renewal and expiry decisions require bounded clock uncertainty. One-minute renewal; five-minute expiry; fifteen-minute maximum ownership. A terminal incident cannot renew. The ninety-minute incident deadline and fifty-minute active allowance cannot reset across sessions or reruns.

Persist spend reservations before **all** provider operations, including preparation/snapshot/import and external verification. Adapt the existing per-search `RepairBudget` rather than replacing its internal safeguards. Unknown billable execution remains reserved until reconciled; declared provider units retain their original unit. Static repository allocations bound the pilot total without a second global distributed lock.

Bound records to 32 KiB each, event payloads to an allowlisted schema, active incidents to 100 per repository and nonterminal history reads through a paginated index. Retain immutable sanitized event history; checkpoints may shrink the active index without force-rewriting history. Capacity exhaustion stops new dispatch and emits a reason. No raw logs/source/prompts/secrets in Git. State-branch bootstrap and retention are task-owned artifacts, not cleanup authority over application branches.

## Automated acceptance

- [ ] Two claimants racing on one head produce exactly one owner; losing requests cannot reserve money.
- [ ] Different incidents racing for the last repository allowance cannot overspend.
- [ ] Timeout after successful commit is read back by operation ID, without duplicate event/reservation.
- [ ] Expired generation cannot renew/submit; heartbeat cannot extend maximum ownership.
- [ ] Duplicate events and run attempts retain history without resetting budgets; newer SHA invalidates candidate.
- [ ] Unknown spend, clock error, corrupt state, deleted/reset journal and capacity exhaustion fail closed.
- [ ] Excluded/frozen identity, forged actor, candidate policy edit and unqualified Recover policy are refused before provider execution.
- [ ] Forged payload actor, replayed dispatch, unauthorized workflow ref and direct non-App journal write cannot create authority.
- [ ] Legacy policy fixtures retain behavior. Payload redaction tests reject secrets, source and hidden evidence.

Run focused core/GitHub/Action tests, then typecheck, lint and bundle verification sequentially. New API behavior requires a captured sanitized real response fixture before live activation; mocks alone do not establish the contract.

## Operator/live acceptance

- [ ] On the authorized demo repository only, run a bounded two-writer API probe and timeout/read-back probe; retain request identities and branch history without credentials.
- [ ] Verify state-branch writes cannot trigger source CI/deployments; actual repository rules deny non-controller journal writes and force/deletion operations without relying on payload validation.

These live checks can be executed by the implementation agent. No routine manual user operation is required. If unavailable, local code may complete with live qualification pending; no live recovery is enabled.

Stop after phase completion unless continuous execution is authorized. Phase 2 consumes the recorded contract version and test evidence.
