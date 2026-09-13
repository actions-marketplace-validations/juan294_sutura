# Phase 9 — Prepare maintainer trials and public installation tasks

Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on phase 5. **[batch-eligible] with phase 6 only.** Prepare concrete outreach and scheduling requests now; no participant message is sent without separate explicit authorization. Measured sessions still depend on phase 11’s real public pilot.

## Outcome and ownership

Prepare concrete, reproducible trials for three developers installing Sutura in unfamiliar repositories and five people reviewing verification evidence. A readiness check is distinct from actual participant evidence.

Own `docs/adoption/`, `scripts/adoption-study.mjs:1`, `adoption-study.test.mjs:1`, `scripts/marketplace-evidence.mjs:1` and tests, plus proposed `scripts/review-study.mjs`/tests and `docs/adoption/verified-repair-study.md`. Read existing recruitment kit, participant template, Marketplace checklist and validators completely. Do not edit evaluation/Placebo/core, root scripts, shared README, common release validator, workflows or Action dist. Integrate common wiring in phase 10.

## Study specification

Retain existing exact-three-install acceptance semantics: three independent people, three unfamiliar repositories, public npm plus immutable public Action identity, JS/TS and Python representation, and repair/refusal/flake classifications. A builder-owned fresh clone or mocked install is a rehearsal, not adoption. Capture time to first valid result, every setup failure, unclear instruction, intervention, task outcome and artifact identity.

Add a separate append-only attempt ledger for all invited/started/completed/withdrawn/failed trials, using pseudonymous participant IDs and consent status. Existing three-success record schema remains compatible, but final report must disclose total attempts and selection into the accepted three. Do not erase failures to make `ready` true. Private contact details/session recordings live outside the public repository; public quotes/screenshots require specific consent.

Five-person review task may include the same three installers plus two additional independent reviewers. Use a frozen valid repair, deceptive green patch, flake and insufficient-evidence set with hidden expected answers in the assessor sheet. Ask the person to state verdict, why, what ran and next safe action. Measure first unaided answer before hints; target four of five correctly interpret verdict/reason/action within 60 seconds. Preserve raw answers, timing, assistance and incorrect conclusions. This is a small usability study, not statistical proof of adoption or market demand.

Add a separate paired review-impact exercise for all five reviewers: ordinary diff plus CI evidence versus Sutura's verification evidence on matched frozen cases of comparable difficulty. Counterbalance task/order assignment, using two task packs so a person does not see the answer to the same defect twice. Record assigned condition/order, correct accept/refuse/abstain decision against assessor-only truth, elapsed decision time, help and confidence. Do not display Sutura's verdict in the ordinary-CI arm. Report individual paired differences, correctness before speed, median changes and the small sample/order limitations. This answers the approved review-value question separately from the 60-second comprehension target. A slower but more accurate decision is not automatically worse; do not claim a universal time saving.

Prepare two external-agent patch-source task packs: same exact clean source, failing command, allowed scope and no hidden expectations, independent from Sutura repair/challenge transcripts. No provider integration required; collect diff bytes and actual source/version provenance during phase 10. Include correct and deceptive controls to calibrate the verifier regardless of agent success. A renamed identical hand-authored patch is not two independent agent sources.

```text
prepareStudy(publicArtifactRequirements, frozenTasks, rubric)
assert no fake participant or release evidence
recordAttempt(id, consent, task, start, assistance, terminalOutcome)
acceptedInstalls = validateExistingThreeSuccessContract(completedRecords)
reviewReport = scoreFirstUnaidedAnswers(allReviewSessions)
publishOnlyConsentedSanitizedAggregate(allAttempts, acceptedInstalls, reviewReport)
```

## Automated success criteria

- [x] Existing adoption/Marketplace validator tests remain passing; exact-three success contract is not weakened.
- [x] New ledger/review tests reject duplicate participant IDs, missing consent, fabricated release identities, invalid timing, empty answers, post-hint answers mislabeled unaided dropped failed attempts, unbalanced condition assignments and task leakage between the paired arms.
- [x] Trial rehearsals use local packed artifacts, label rehearsal mode and never satisfy public-install acceptance.
- [x] Run `node --test scripts/adoption-study.test.mjs scripts/marketplace-evidence.test.mjs scripts/review-study.test.mjs` sequentially as one local test command; validate real recruitment templates with the existing script.

## Manual success criteria

A reviewer can run the task from the prepared instructions and identify exactly what will be measured. Prepare the recruitment message, intended recipient cohort and consent text early enough to request explicit authorization for reserving October 14–20 sessions during this phase. After that authorization, scheduling may proceed; actual measured installs wait for phase 11. Without it, retain prepared messages and report the calendar dependency rather than assuming participant availability. Phase 11 supplies real public artifacts; phase 12 owns participants and results.

## Phase gate

Follow the parent plan's implementation/review/fix/simplification loop. Run focused checks and the standard local commands sequentially: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`. Rebuild the committed Action bundle for core/Action changes, run `pnpm run verify:bundle`, and complete `pnpm run ci:local` before any later push involving core. New process/build/sandbox tests use explicit timeouts of at least 30 seconds. Inspect actual hosted triggers before any push; never create a Vercel preview or use hosted CI to debug. Record actual results and the integrated source identity; stop after this phase. Remote actions and participant messages require the concrete authorization described in the parent plan.

## Progress record — September 6

`scripts/review-study.mjs` implements the study's integrity machinery. **No participant was contacted, no message was sent, and no session was scheduled.**

The attempt ledger is append-only and keeps every invited person whatever happened to them. A study that quietly drops the people who withdrew or failed reports the success rate of the people who succeeded, which is not a finding, so the ledger hash changes when a failed attempt is removed. Duplicate participant ids are refused, consent is an explicit decision rather than an absence, and a participant who has not consented cannot progress past invited or withdrawn.

Review scoring counts only answers given before any hint. An answer produced after help is a different measurement and is reported separately, because a study that counts assisted answers as unaided measures the assistance. An assisted answer labelled unaided is refused outright, as are an empty answer, a non-positive or absurd duration, a missing grade and a repeated task for one participant. The sixty-second target is reported beside correctness rather than merged into it, as a count over a small sample rather than a rate claim.

The paired review-impact exercise refuses the three ways it could quietly become meaningless: showing Sutura's verdict inside the ordinary-CI arm, giving one participant the same defect twice so the second decision measures memory, and an unbalanced condition order that would let a practice effect read as an effect of the evidence. It reports correctness beside median time rather than instead of it, and carries the small-sample caveat in the output itself. 18 tests, wired into `test:release-contracts` so they run in every local and hosted gate.

All four were outstanding at the time of that record and are now built; see
the second pass below.

## Second pass — September 6

**No participant was contacted, no message was sent, no session was scheduled
and no calendar was reserved.** Everything below is prepared material.

`scripts/review-tasks.mjs` holds the frozen task material. The four
comprehension tasks are one of each kind — a valid repair, a deceptive green
patch, a flake and a stopped run — each with the decision that is correct and
the reason that makes it correct. The participant-facing pack and the assessor
sheet come from the same source so they cannot drift apart, and they are
separated by a function rather than by discipline: `participantPack()` strips
every assessor field and then refuses to return material that still carries one.
`assessorSheet()` keeps the answers and hashes them.

The two paired packs share no defect, so nobody decides the same defect twice
and the second decision is never a memory of the first. Each pairs one
boundary-arithmetic defect with one missing-guard defect, so the two conditions
face comparable difficulty by construction rather than by assertion.

The two external-agent packs name the same clean source, the same failing
command and the same allowed scope, so two agents are asked an identical
question and the verifier sees only their bytes. Each carries a correct and a
deceptive control, so the verifier can be calibrated whether or not either
agent succeeds, and neither pack contains a hidden expectation.

Rehearsal mode is a label the acceptance contract cannot accept.
`buildRehearsalRecord()` marks a run against a locally packed artifact, and
`assertRehearsalIsNotAdoption()` calls the real adoption validator and fails if
it accepts one. A rehearsal cannot be promoted to an install by editing a
number: acceptance requires public npm and an immutable Action identity, and a
packed local artifact is neither. A test also proves the guard itself works, by
handing it a validator that accepts everything and checking it refuses.

`docs/adoption/verified-repair-study.md` records what each study measures and
who records it, the draft recruitment message, the intended cohort, the draft
consent text, and the scheduling dependency. The consent text states what is
recorded, that a quote, screenshot or repository name is published only with
specific consent for that item, and that withdrawing removes the answers while
the ledger keeps the fact that an attempt happened — because dropping
unsuccessful attempts would make the results describe only the people who
succeeded.

The 14 to 20 October window is recorded as a dependency rather than assumed.
Reserving it means contacting people, which needs authorization this phase does
not have.

7 added tests, wired into `test:release-contracts`. All four named test files
pass together: 36 tests.
