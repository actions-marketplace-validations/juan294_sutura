# Phase 6: Small pilot, evidence and release readiness

Parent: [CI recovery plan](../2026-09-14-sutura-ci-recovery.md). Depends on: phase 5. Status: planned.

## Changes

Add a recovery acceptance matrix and result schema under `docs/evaluation/`; extend `scripts/dogfood.mjs` and its existing manifest/accounting machinery rather than introducing another paid-run entrypoint. Add `docs/adoption/ci-recovery.md` covering setup, modes, agent protocol, incident states, emergency disable, costs and limitations. Update README, evaluator guide, Action/CLI help and release evidence contracts to match the exact shipped version. Reconcile stale program status against current evidence while preserving historical measurements.

Prepare one private finite manifest listing repository IDs, exact source/Action/policy/adapter/model identities, branches, synthetic cases, provider price/unit bounds, attempt counts, daily/lifetime allocations, CI/API budget, expiry, cleanup and exclusion checks. Do not infer a new spending ceiling from historical benchmark money. Apply existing session authorization only where it covers those actions. Paid dogfood dispatches go through `pnpm run dogfood` and the existing push-freeze procedure; local work may continue during a frozen measured candidate.

Start in the demo repository on explicit nondeploying work refs. Once fault controls pass, activate at most two already-included projects in Verify/Repair for ordinary usage. Their choice is deterministic: confirmed access, clean installation health, no freeze/exclusion, known CI commands and no uncovered deployment side effects. Keep selected private identities in ignored operational reports. Do not change all fleet Action pins or enable Recover outside the qualified demo scope in this phase.

```text
pilot:
  assert all earlier automated and live qualification gates
  run named fault controls on demo only, within one cumulative manifest
  capture exact source -> owner -> candidate -> verification -> branch -> CI timeline
  enable two qualified ordinary-use observers in Verify/Repair
  retain daily incident metrics, pending failures and cost completeness
  publish claims only for capabilities and outcomes demonstrated on shipped identity
```

Mandatory acceptance controls: nobody claims, incumbent succeeds, owner disappears, lease race, duplicate/rerun events, absent CI, unavailable adapter, budget exhaustion, deceptive patch, missing contract, stale head, ambiguous publication, valid recovery and postpublication red CI. All must have expected outcomes, no unaccounted dispatch, no duplicate target update and no false recovery count. Every gave-up becomes a named replay before the next paid dispatch.

Require a seven-day observation report before describing the rollout as sustained daily use. Zero real failures is a valid observed result, not permission to manufacture adoption statistics. Pilot promotion is supported by deterministic safety controls; small samples and zero observed false approvals are not a production-safety proof. A control failure disables Recover, preserves evidence and opens a named remediation item. Repair/watchdog remain useful independently.

Compare agent-alone versus Sutura-first/fallback on matched replayable fixtures, including total resource cost and verification in both arms. Preserve negative results. Real-use reports answer: how many failed incidents were detected; how many were unowned; how many reached green through each path; how long they stayed red; how much resource was used; what remains unsupported. Do not sell an unmeasured subscription saving.

Release through the existing workflow after required candidate/install/security/evidence gates. Rebuild/pin exact artifacts and recheck post-push CI. Preserve all excluded projects without GitHub mutations. Update submission text and gallery captions only when execution-backed evidence warrants the claims and publication authority applies. No claimed video completion, participant study, sponsor result or final Devpost readiness follows merely from shipping this enhancement.

## Automated acceptance

- [ ] Named recovery matrix passes on frozen candidate; required guards have real sanitized fixtures.
- [ ] Full local CI mirror, Action bundle parity, release contracts, packed CLI/Action installation and applicable security checks pass.
- [ ] Fleet exclusion/freeze tests reject setup, worker dispatch, publication and collection on excluded identities.
- [ ] Manifest ceiling survives restarts/handoffs; report retains unknown costs and all unsuccessful attempts.
- [ ] Report examples, mode defaults, CLI/Action help and release/submission claims match demonstrated behavior.
- [ ] Evidence links/hashes, source vs evidence-commit identity and retention through judging are validated.

## Operator/live acceptance

- [ ] Review the recorded demo timelines and real GitHub refs/checks; all mandatory live controls pass.
- [ ] Confirm no agent reminder/manual CI polling is needed on the supported path; record any assistance as an onboarding finding.
- [ ] Confirm no state/candidate branch can deploy and App/adapter permissions match the audited configuration.
- [ ] Review seven-day report with every unresolved incident visible and no unsupported savings claim.
- [ ] Exercise emergency disable and preserve old evidence; delete only task-owned temporary pilot artifacts according to the manifest.
- [ ] Run a separate current submission checklist: public install/demo, project text, actual video, sponsor evidence, required feedback, access/retention and current event requirements.

No mandatory human review of each fix is introduced. Operator/live checks are work the implementation agent can perform and document; user decisions are limited to genuinely missing authority or product intent. End with exact release/pilot status, measured outcomes and remaining submission dependencies. Do not call the whole hackathon submission complete from this phase's code checks alone.
