# Phase 2: Independent watchdog and preparation recovery

Parent: [CI recovery plan](../2026-09-14-sutura-ci-recovery.md). Depends on: phase 1. Status: planned.

## Changes

Add `packages/core/src/recovery/reconcile.ts`, `packages/action/src/recovery.ts` and focused tests. Extend `packages/core/src/orchestrate.ts`, GitHub adapters, `packages/cli/src/setup.ts` and `doctor.ts`; add trusted command mapping in recovery policy. Update generated workflow inputs and Action bundle together. Read any newly affected modules completely during implementation.

Separate metadata observation from detailed failed-log acquisition. Record incident identity before logs, command classification, checkout or any provider calls. Exceptions have an incident outcome even when no case file exists. Recovery-enabled orchestration uses the journal rather than legacy check/tag suppression. Existing comments/checks become presentation, not lock authority. Never mix legacy and recovery controllers for the same configured source.

```text
reconcile(repository):
  validate enabled policy, exclusions, immutable controller version
  page observations since durable watermark with overlap
  inspect each configured work ref and registered expected SHA/checks
  append missing, failed, cancelled, superseded or completed observations
  for each nonterminal incident:
    reconcile outstanding provider/publication operation first
    if owner healthy: leave it working
    if producer lease expired: take over generation; retain unknown cost reservations
    if non-fenced external operation pending: reconcile before another such operation
    claim next eligible work under cumulative limits
  persist watermark only after observations are durable
```

Install completion-event and `workflow_dispatch` entrypoints plus scheduled reconciliation at minutes `7,22,37,52`. Completion events need no model call for green CI. The reconciler is bounded to five minutes per run with API pagination/cursors and backoff. Schedule and event paths invoke the same reducer. Controller runs trusted pinned code without checking out/executing the failed revision in its privileged job.

Separate this short reconciler from long-running repair/verification jobs. Persist dispatch intent and worst-case reservation before scheduling a worker; pass operation ID, generation and allowance. The worker atomically acknowledges that intent and deduplicates before calling a provider. It renews within its existing trusted job. Reconciliation does not wait for ten-minute repair or fifteen-minute fallback, and another tick cannot dispatch an acknowledged operation twice. A timed-out dispatch is reconciled by operation ID and actual workflow/job identity before redispatch; a late duplicate worker exits without spending.

Local command dispatches, including heartbeats, use the phase 1 authenticated transport. They run small concurrent reducer jobs with CAS, not a GitHub concurrency group that could replace pending commands. A delayed heartbeat may expire a lease; stale work is fenced and any wasted computation remains measured. Bound total command jobs and reconciliation Actions usage in the activation manifest.

`doctor` validates workflow presence on the actual default branch, active schedule, pinned Action, expected workflow IDs/check producers, policy hash, trigger exclusions, journal access and last successful reconciliation. Workflow existence alone is not health. Avoid committing the state branch into normal source history. Reject setup if existing push/tag/PR/external deploy triggers could act on state/candidate branches; produce the specific configuration diff for remediation within authority.

Track expected CI for explicit watched refs even when an agent never calls `watch`. For a registered or observed push, wait a configured ten-minute start grace and thirty-minute run deadline. An absent, cancelled, skipped or infrastructure-failed workflow never implies green. Permit at most one policy-allowlisted rerun for transient CI infrastructure; permanently missing triggers/configuration produce a bounded escalation, not a source patch guessed from no evidence.

Resolve current command-discovery failures with an explicit mapping from workflow/job/step identity to a trusted command ID and cwd. Logs can identify a matching observed command, but cannot inject arbitrary shell. If no unique trusted mapping exists, hand off with `missing-trusted-command`. Snapshot exclusions may omit only policy-declared non-executable assets; never omit code/dependency/test/contract inputs to make reproduction appear successful. Fix a snapshot blocker only when reproduced in the in-scope pilot. Do not reopen excluded repositories to exercise it.

## Automated acceptance

- [ ] Failed CI with no agent registration is observed and assigned on the next successful event/reconciliation pass.
- [ ] Missed event, repeated event, out-of-order completion and rerun each preserve one incident and correct attempt history.
- [ ] Agent crash, old permanent check and stranded legacy tag cannot silently suppress recovery; unknown execution stays blocked until reconciled.
- [ ] An offline candidate producer does not prevent lease takeover; its stale submission fails and its possible spend stays reserved.
- [ ] Crash after dispatch before acknowledgment and duplicate worker deliveries cause at most one provider start under the operation ID.
- [ ] Missing log/command/setup failure has a durable reason and bounded next action, with sanitized real failure fixtures.
- [ ] Matching configured command reaches reproduction; conflicting/log-injected command is refused.
- [ ] No provider calls occur for healthy CI, frozen/excluded repos, state-branch writes or Sutura's own observation workflows.
- [ ] CI never starts, remains pending, cancels or skips: none count as recovered. Pagination survives more than one API page.
- [ ] Sutura-origin candidate CI is correlated to the parent incident without launching recursive repair chains.

Run focused tests, then the sequential repository verification chain; core changes require `ci:local` before any push.

## Operator/live acceptance

- [ ] Demonstrate one intentionally unclaimed demo failure, one killed worker and one dropped event recovered by reconciliation.
- [ ] Capture actual detection latency and scheduler health. Stop the local agent worker and show GitHub monitoring still runs.
- [ ] Inspect all monitored/deployment triggers and actual resulting runs; no state-branch CI storm.

Phase 2 adds unattended monitoring but does not enable work-branch advancement. Stop at the phase gate unless continuous execution is authorized.
