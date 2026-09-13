# Phase 7 — Adaptive Nemotron routing under a shared budget

## Local implementation review — 2026-09-08

The explicitly selected `development-adaptive-v1` profile now drives production route decisions. Diagnosis recovery and challenge generation carry distinct purposes. A reserved model quote is frozen and forwarded through dispatch and trace reporting, and controller routing metadata is excluded from billed request-byte estimates. Repair escalation is bounded within the run scope; existing default budgets and the fixed default routing profile are unchanged.

These are local implementation and regression results. No new paid comparison establishes a cost reduction, repair-rate improvement, or quiet-provider reliability. Historical provider-contract checks retain their original candidate identities.


Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on phase 6. Sequential, not batch eligible.

## Outcome and source

Replace profile-only selection with a bounded deterministic routing policy whose use of confidence, task purpose, context and feedback is visible and measurable. Keep fixed routing as a reproducible control and safe default until phase 10 evaluates promotion.

Read `packages/core/src/llm/router.ts:1`, `router.test.ts:1`, `cost.ts:1`, `types.ts:1`, configuration and client call sites, `packages/core/src/engine/repair-budget.ts:1`, and phase 4's challenge purpose. Own those files, phase 1 route evidence codecs, focused tests and rebuilt Action dist. Proposed `packages/core/src/llm/routing-policy.ts` and tests; proposed `docs/evaluation/routing-policy.md` records decision table/version without duplicating benchmark results.

## Deterministic initial policy

Roles remain nano/super/ultra; purpose is distinct. Map to explicitly configured, available NVIDIA models via Nebius. No invented currently available model IDs or price discounts. Validate actual model/pricing contracts before phase 10. Missing/unverified profile selects a valid fixed baseline or abstains if baseline itself is unaffordable/unavailable.

| Purpose/signal | Initial decision |
| --- | --- |
| Routine initial classification within configured nano context limit | Nano; confidence from result may schedule one recovery call |
| Recovery, conflicting diagnosis, low confidence below 0.7 or two-target repair | Super |
| Single-target repair, confidence at least 0.9, supported small excerpt, no previous failure | Nano candidate, if profile enables this evaluated option |
| Repair otherwise | Super |
| One structurally valid but unsuccessful repair with new execution feedback | Escalate at most once to Ultra if reserved budget allows |
| Independent challenge generation | Super, candidate-blind |
| Semantic adjudication | Ultra; never downgrade required final audit to finance repair work |

Context eligibility uses configured model input/output token ceilings and a conservative byte-to-token bound, with model-specific limits and safety margin recorded in the profile. No raw untrusted request field can claim a smaller context/budget. Thresholds above are initial **development hypotheses**, frozen after validation selection; final held-out results cannot tune them. A router refitted after held-out inspection becomes a new development profile and needs replacement held-out families for an unseen-performance claim. Structured output/transport retries consume existing retry and budget limits and do not create unlimited model escalation.

```text
reserve = fullAuditAndRequiredChallengeCost(run)
available = remainingBudget - reserve
route = decisionTable(purpose, diagnosis, targetCount, contextBound, priorFeedback)
if !verifiedModelContract(route) or !fitsWorstCaseReservation(route, available):
    route = permittedAffordableFallbackForPurposeOrAbstain()
record(route, reason, available, reserve, profileHash)
response = invoke(route, boundedPrompt, cappedOutput)
chargeActualUsageIncludingFailures(response)
assert auditReserveRemainsAvailable
```

Routing never changes patch authority, challenge requirements, policy or test commands. Record requested and returned model IDs; unexpected returned identity is explicit contract failure, not silently the requested model. Do not claim a paid pricing discount because a tier name is smaller. Price/date changes invalidate cost comparisons unless recomputed consistently from retained token counts.

## Automated success criteria

- [x] Table-driven boundary tests at 0.7/0.9, context limits, missing confidence, one/two targets, exhaustion and previous failure demonstrate actual changed route decisions.
- [x] Budget tests reserve maximum input/output, charge retries and provider failures, retain audit reserve, stop on missing price/model contracts and cap escalation at one.
- [x] Same inputs/profile yield identical decisions; candidate or provenance cannot override purpose or safety gates.
- [x] End-to-end deterministic controls show valid/invalid patches receive identical verifier gates across profiles; trace/replay preserves route reasons and returned model identity.
- [x] Existing fixed profile remains reproducible; `pnpm --filter @sutura/core exec vitest run src/llm/router.test.ts src/llm/routing-policy.test.ts` and relevant repair-budget/replay tests pass.

## Manual success criteria

Reviewer can explain one Nano selection, one escalation and one budget abstention from evidence. Publish no cost or success improvement yet. Phase 10 runs paired profiles at matched correctness; an unsuccessful cost hypothesis leaves the implemented adaptive profile selectable and reports its limits while fixed routing stays default.

## Phase gate

Follow the parent plan's implementation/review/fix/simplification loop. Run focused checks and the standard local commands sequentially: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`. Rebuild the committed Action bundle for core/Action changes, run `pnpm run verify:bundle`, and complete `pnpm run ci:local` before any later push involving core. New process/build/sandbox tests use explicit timeouts of at least 30 seconds. Inspect actual hosted triggers before any push; never create a Vercel preview or use hosted CI to debug. Record actual results and the integrated source identity; stop after this phase. Remote actions and participant messages require the concrete authorization described in the parent plan.

## Progress record — September 6

Implemented source: `262ec32`. No push, provider inference or paid routing occurred.

`packages/core/src/llm/routing-policy.ts` implements the decision table with boundary behavior at 0.7 and 0.9, two-target repair forced to super, the nano-repair option gated behind the profile, at most one ultra escalation on new execution feedback, context-limit and unverified-contract fallbacks, and abstention when no permitted tier is both verified and affordable. `availableUsd` is defined as what remains after the mandatory audit and challenge reserve, so routing cannot spend it, and adjudication is never downgraded to finance repair work. Decisions are deterministic for the same signals, profile and budget, and every rejected tier is recorded with its reason beside a profile hash that changes with any frozen field and ignores tier order. 20 tests.

Not built in this pass, and not claimed:

- The policy is wired into `ModelRouter.select` as an opt-in `adaptive` input. Absent it, the requested role is used unchanged, so fixed routing stays the reproducible control and the safe default until phase 10 evaluates promotion. When supplied, the chosen tier is priced from the same profile the fixed path would use, an abstaining policy keeps the requested role rather than inventing one, and the decision carries both the reason and the frozen routing profile hash. Adaptive selection cannot change the profile identity. 5 added tests; the existing router tests are unchanged.
- No call site passes `adaptive` yet, so no production request is adaptively routed. Turning it on for a purpose is a promotion decision phase 10 owns.
- No model or price contract is validated against a live provider; phase 10 owns that.

## Second pass — September 6

`routing-integration.test.ts` holds the policy against the budget it spends
from and the gates it cannot change. 10 tests.

The audit reserve survives every routing decision: a run routes from what is
left after the reserve is held back, the reserve is still spendable afterwards,
and when only the reserve would cover the request the policy abstains rather
than spending it. A model turn reserves its worst case and refunds only what
was not spent; settling the same reservation twice is refused. A provider
failure and a retry each consume a turn like any other, so two failures exhaust
a two-turn budget: the money is refunded, the attempt is not.

A missing price or model contract stops the run rather than routing to the tier
anyway, and ultra escalation is capped at one per run.

One defect this surfaced and fixed: an abstention reported
`affordable-fallback` whatever the actual obstacle, so a run that abstained
because no tier had a verified contract read as though it could not afford one.
The abstention now names why the last permitted tier was unusable; the rejected
list already carried the per-tier reasons and is unchanged.

Nothing a candidate supplies reaches the policy: adjudication routes to the
same tier with the same reason and the same profile hash whether or not the
signals carry a preferred tier, an agent name or a trusted flag. The same
signals, profile and budget give byte-identical decisions across repeated
calls. The profile hash ignores tier order and moves on any frozen field.

The verifier runs the same ordered gate stack for a valid and an invalid patch;
they differ only in where the walk stops, which is what makes a cross-profile
comparison meaningful.

`docs/evaluation/routing-policy.md` documents the table, what a decision cannot
do, how to read a nano selection, an escalation and a budget abstention, and
the limits: no live provider validation and no cost or success claim.

Local verification: `router.test.ts`, `routing-policy.test.ts`,
`repair-budget.test.ts` and `routing-integration.test.ts` pass together.
