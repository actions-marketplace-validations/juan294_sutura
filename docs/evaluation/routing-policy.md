# Adaptive routing policy

Sutura routes each model request to a tier through a deterministic decision
table. Fixed routing remains the default and the reproducible control; the
adaptive policy is opt-in per request and is not enabled at any call site.
Whether to promote it is a phase 10 decision that needs paired measurement at
matched correctness, not a judgement made here.

Source: `packages/core/src/llm/routing-policy.ts`. Version identifier
`sutura-routing-policy-v1`.

## What the policy sees

| Signal | Meaning |
| --- | --- |
| `purpose` | classification, diagnosis-recovery, repair, challenge-generation or adjudication |
| `confidence` | diagnosis confidence; an absent value is treated as low, never as high |
| `targetCount` | how many files the repair must change together |
| `requestBytes` | request size, compared against a per-tier context ceiling that already includes a safety margin |
| `priorRepairFeedback` | a structurally valid but unsuccessful earlier repair produced new execution feedback |
| `ultraEscalationsUsed` | escalations already spent in this run |

The budget it reads is what remains **after** the mandatory audit and challenge
reserve is held back, so routing cannot spend the capacity the run needs to
finish auditing.

## The decision table

- Confidence at or below 0.7 is low; at or above 0.9 is high. The boundaries
  are inclusive on the side that is more conservative.
- A repair that must change two files goes to super, whatever the confidence.
- The nano-repair option is only available when the profile enables it.
- Adjudication runs on ultra and is never downgraded to finance repair work.
- New execution feedback after a failed repair may escalate to ultra at most
  once per run; a second attempt is refused with `escalation-cap`.
- A tier whose context ceiling cannot hold the request is rejected with
  `context-limit`.
- A tier without a verified model and price contract is rejected with
  `unverified-contract`.
- A tier whose worst-case cost exceeds what is available is rejected with
  `affordable-fallback`.

When no permitted tier is both verified and affordable, the policy abstains:
`tier` is null and the reason names why the last permitted tier was unusable.
Every rejected tier is recorded with its own reason, so a decision explains
itself without a reader re-deriving it.

## What a decision cannot do

- It cannot change the profile identity. The profile hash covers every frozen
  field and ignores tier order, so reordering the verified tiers produces the
  same hash and changing a context ceiling does not.
- It cannot move a safety gate. The verifier runs the same ordered gate stack
  whatever tier answered, and a candidate or its provenance supplies no field
  the policy reads.
- It cannot raise a limit. The budget refuses any limit above the frozen
  default outright.

## Reading one decision

- **A nano selection**: classification with a request inside nano's context
  ceiling and a verified nano contract. Reason `purpose-default`, no rejected
  tiers.
- **An escalation**: a repair whose earlier attempt was structurally valid,
  failed, and produced new execution feedback, with no escalation spent yet.
  Reason `ultra-escalation`. A second such request reports `escalation-cap` and
  stays on super.
- **A budget abstention**: adjudication with nothing left after the audit
  reserve. `tier` is null, the reason is `affordable-fallback`, and `rejected`
  names ultra. The run reports insufficient evidence rather than adjudicating
  on a cheaper tier.

## Limits

No model or price contract here has been validated against a live provider, and
no cost or success improvement is claimed. Phase 10 runs the paired profiles at
matched correctness. If the cost hypothesis does not hold, the adaptive profile
stays selectable and its limits are reported; fixed routing stays the default.
