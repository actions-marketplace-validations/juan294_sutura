# Sutura submission video script

Planned running time: 2:55. This script follows the qualitative submission
story in [the Devpost source](sutura-submission.md). Candidate-bound results
are read from their evidence artifacts during recording; this script states no
result before that evidence exists.

## 0:00-0:20 — A green check can hide a fake repair

On screen: a failed CI run beside a patch that makes the command green by
weakening the test.

Narration: “A green check is not proof of a repair. An agent can delete the
evidence, relax the rules, or fix the wrong thing. Sutura asks a harder
question: did the patch repair the diagnosed failure without cheating?”

## 0:20-1:20 — From failure to a verified repair

On screen: open one Case Lab failure, start its repair or deterministic replay,
and follow the exact run identity through diagnosis, isolated reproduction,
repair branches, the trusted test, and the clean audit result. End on the
evidence-backed pull request and HTML case file.

Narration: “Sutura reads the exact failed GitHub Actions run and prepares
dependencies before it overlays source. Network access is then disabled.
Independent reproductions separate persistent failures from flakes. Nemotron
Super proposes a bounded replacement for a source excerpt selected by the
controller. Sutura applies the diff, runs the observed trusted command, rebuilds
the winner on a clean branch, and opens a pull request only after policy checks
and an independent audit. It never merges for you.”

## 1:20-1:55 — Reject the counterfactual shortcut

Recording gate: include this section only after its candidate-bound WS-2
counterfactual evidence is committed.

On screen: compare the accepted patch with a counterfactual patch that deletes,
skips, or weakens the failing check. Show the mechanical violation and the
refusal outcome.

Narration: “Passing the immediate command is necessary, but it is not enough.
The same failure also gets a tempting shortcut. Sutura detects changes to test
coverage, assertions, compiler rules, module boundaries, and unrelated files.
The valid repair continues; the greenwashing patch becomes evidence for a
refusal.”

## 1:55-2:25 — Nebius and NVIDIA architecture

On screen: animate the architecture diagram from failure evidence to the
sanitized trajectory.

Narration: “Nebius Token Factory serves Nemotron Nano for diagnosis, Super for
bounded repair proposals, and Ultra for adversarial review. ConTree prepares
one dependency image and branches isolated triage, search, and audit children.
Sutura records a sanitized evaluation trace, exports local Data Lab JSONL, and
emits an NVIDIA ATIF trajectory validated with NeMo Agent Toolkit.”

## 2:25-2:45 — Evidence, including failures

Recording gate: show the Arena record only after its candidate-bound WS-2
evidence is committed.

On screen: open the candidate-bound Placebo report, dogfood ledger, inference
ledger, and external-user records used by the final cut. Include the Arena
record when the recording gate above is satisfied.

Narration: “The submission evidence is generated from one exact candidate.
Placebo keeps unsuccessful cases in the denominator, dogfood binds the shipped
Action executable, Arena tests plausible bad alternatives, and the ledgers
separate inference usage from sandbox usage. External-user evidence stays bound
to the same candidate instead of becoming a detached testimonial.”

## 2:45-2:55 — Human review remains the release gate

On screen: the repair pull request awaiting maintainer review.

Narration: “Sutura can diagnose, test, audit, and explain a repair. It cannot
approve its own work. The maintainer reviews the evidence and decides whether
to merge.”
