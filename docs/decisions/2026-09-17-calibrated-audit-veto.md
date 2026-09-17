# A calibrated third voice on the adjudication gate, veto-only

Date: 2026-09-17. Status: adopted for v0.3.1.

The adjudication gate runs Nemotron Ultra `adjudicate` and the optional GPT-6
Astra `secondOpinion`
([`packages/core/src/verification/runtime.ts`](../../packages/core/src/verification/runtime.ts))
and ANDs two booleans. Neither voice reports a confidence; the decision is
`{ approved: boolean, reasoning }` on both sides
([`packages/core/src/audit/adjudicate.ts`](../../packages/core/src/audit/adjudicate.ts)).
Commit `3397eac` (2026-09-16) also showed that a free-text-then-parsed
decision can fail in a new way: Nebius Token Factory's schema-guided decoding
began dropping string escapes, corrupting every structured Nemotron response
until the client switched to `json_object` and added local contract
enforcement. TypeSafe Jev's answer is chosen from the caller's schema by
construction, so it cannot emit that failure shape, and it reports a
calibrated probability and confidence the other two voices do not have. A
third voice closes both gaps without touching the first two.

The new voice keeps the exact contract the Astra second opinion already set:
veto-only, and fail-open to `skipped` on anything short of a confident
refusal. `approved = nemotron.approved && astra.status !== 'refused' &&
jev.status !== 'refused'`. A missing `TYPESAFE_API_KEY`, a transport error, a
malformed response, or spend over the client's own USD 0.02 budget
(`typesafeAuditUsd` in
[`packages/core/src/engine/repair-budget.ts`](../../packages/core/src/engine/repair-budget.ts))
all record `skipped`, never `approved`. Jev can never be the reason a
candidate is accepted, and it can never widen acceptance beyond what Nemotron
already approved. Nemotron on Nebius Token Factory remains the runtime model
this project entered the hackathon to demonstrate.

The two thresholds — refuse when `P(green_wash) ≥ 0.50`, and treat
`confidence < 0.70` as `uncertain` rather than a usable answer — are not
defaults; they are read off a measurement. The probe in
[`docs/research/2026-09-17-typesafe-jev-probe/jev-trap-audit.mjs`](../research/2026-09-17-typesafe-jev-probe/jev-trap-audit.mjs)
ran the adjudication question against all 88 labeled Placebo diffs (31
green-wash traps, 57 legitimate repairs) on 2026-09-17; results are recorded
in
[`docs/research/2026-09-17-typesafe-jev-fit.md`](../research/2026-09-17-typesafe-jev-fit.md)
§8. Raw accuracy was 84/88 (95.5%). Applying the veto policy: of the 31
traps, 28 were refused, 2 were uncertain, and 1 was approved; of the 57
legitimate repairs, 51 were approved, 6 were uncertain, and zero were
refused. Confidence tracked correctness the way the vendor's docs claim it
should: below the 0.70 cut the policy was wrong 3 times out of 8 cases, at or
above it the policy was wrong once out of 80. The 0.50 probability cut and
the 0.70 confidence cut are this measurement, not a guess, and changing them
requires a new measured record, the same discipline the model price table
already follows.

`uncertain` does not block the run because it is not evidence of a
green-wash; it is evidence that Jev's calibration has nothing useful to say
about this diff. The measurement above showed that below-threshold answers
are wrong more than a third of the time, indistinguishable from a coin flip
weighted slightly by the model's own admission that it does not know. Sutura
already has two other gates — Nemotron's adjudication and, when configured,
Astra's second opinion — that decide the run when Jev abstains, and both
carry their own fail-closed policies independent of this one. Recording the
row with its numbers and letting the run proceed on the other gates is
strictly safer than either blocking on a coin flip or discarding the
abstention silently.

Jev's confidence is not consumed anywhere in
[`packages/core/src/llm/routing-policy.ts`](../../packages/core/src/llm/routing-policy.ts).
That file's `LOW_CONFIDENCE` and `HIGH_CONFIDENCE` thresholds are frozen
until a held-out measurement justifies changing them, and the probe above
was run once, without a repeat for self-consistency, against small synthetic
fixtures far below Jev's 32,000-token budget. A single run of 88 cases used
to set a veto threshold is not the held-out evidence routing changes require.

This decision does not authorize changing Nemotron's role as the runtime
model behind Sutura's diagnosis and repair pipeline; does not authorize any
change to `routing-policy.ts` or to how confidence is used for model
selection; and does not authorize re-measuring or re-labeling the Placebo
corpus. Those remain separate, future work, each with its own evidence
requirement.
