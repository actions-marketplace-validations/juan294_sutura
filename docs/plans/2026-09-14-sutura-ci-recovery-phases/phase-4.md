# Phase 4: Durable recovery metrics and attribution

Parent: [CI recovery plan](../2026-09-14-sutura-ci-recovery.md). Depends on: phase 3. Status: planned.

## Changes

Add `packages/core/src/recovery/metrics.ts`; extend `scripts/fleet-dogfood-metrics.mjs`, its existing tests and `docs/adoption/fleet-dogfood-metrics.md`. Add v2 schema/examples and deterministic report fixtures. Connect core/Action incident outputs before activating pilot measurement. Preserve v1 as historical evidence with its original semantics.

```text
event key = repository numeric ID + incident ID + journal operation ID
persist validated sanitized events once, with bytes hash and observed timestamp
enrich by authenticated source run/attempt + candidate + PR + destination CI IDs
derive report from persistent event history, not current artifact availability
keep missing/ambiguous attribution and costs explicit
```

Persist parsed immutable evidence before Actions artifacts expire. Use atomic local writes and a durable per-repository sanitized journal export; restarting the collector must not overwrite known events with `unknown`. Keep original observation and later corrections as separate events. Retain evidence through the currently required judging-access period recorded by the submission program; verify its dates at release. Detailed private data stays in ignored storage or its private repository, aggregate publication requires a privacy review.

Report candidate author, verifier, branch updater and outcome independently. `repairPrsOpened` must resolve an actual PR ID. `recovered` requires exact accepted candidate linkage and resulting required work-branch CI; a later unrelated green commit is `resolved-externally`. A green monitor, verification-only success, opened/merged PR or skipped check cannot count as recovered. Adapter provenance must be authenticated, not inferred from commit author text.

Record source incidents, attempt counts, mode/eligibility, source-to-green time, wait time, lease takeovers, overlap, dispatch failures, postpublication failures, measured inference costs, sandbox amount/unit, Actions duration, available agent token/session usage, configured versus observed Action SHA, and evidence/cost completeness. Pending jobs are pending. Removed/frozen installations and unavailable repositories retain their historical evidence but receive no new work.

Report recovery rates for all eligible incidents, and coverage across all observed failures. Keep infra-stop/unresolved/missing evidence in denominators where eligible. Distinguish controlled demos from daily use. Historical forty-five-day before/after comparison is descriptive; actor identity and causal savings remain unknown when not recorded.

For paired experiments, run incumbent alone versus Sutura-first/fallback on independent copies of the same frozen fixture, alternate order and match correctness/allowed spend/time. Include Sutura verification and unsuccessful attempts in total resource use. No artificial failures in real projects. Report paired outcomes and raw sample sizes; insufficient data means no performance claim. An unused subscription call is not automatically money saved under a fixed subscription.

## Automated acceptance

- [ ] v1 imports preserve original meaning; no historic monitor-green row becomes recovered.
- [ ] Artifact expiration, collector crash and rerun preserve previously known immutable events.
- [ ] Duplicate/out-of-order observations do not inflate incident, attempt or PR counts.
- [ ] Fixed without PR, PR without integration, integration with red/missing/skipped checks each fails recovery attribution.
- [ ] Agent-authored patch verified by Sutura and completed externally retains all three roles.
- [ ] Unrelated later green, superseded source and unknown actor/cost remain honestly classified.
- [ ] Active jobs, installation disablement, mixed Action versions, multiple API pages and missing permissions render correctly.
- [ ] Public export omits repository names/private URLs/logs/source/identifying free text; cost totals sum only compatible known units.

Run collector node tests, core metric tests and release-contract tests sequentially; validate schemas and rendered example reports.

## Operator/live acceptance

- [ ] Trace one report row end-to-end through source failure, journal, adapter, verifier, actual PR and destination CI evidence.
- [ ] Compare against an independently read GitHub timeline. Inspect launchd report freshness and export recovery after deleting only task-owned temporary artifact downloads.
- [ ] Preserve a preactivation baseline and start a dated observation window. No claim of forty-five days before that period actually elapses.

The daily collector remains the existing scheduled facility, with one incident-based report replacing the misleading PR proxy. No new hosted dashboard is required. Stop at the phase gate unless continuous execution is authorized.
