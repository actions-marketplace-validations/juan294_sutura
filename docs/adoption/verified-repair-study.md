# Verified repair study — prepared material

**Nothing here has been sent.** No participant has been contacted, no session
has been scheduled, and no calendar has been reserved. Sending any message in
this document, or reserving any session, needs explicit authorization first.

This is the material for two small studies:

1. **Installation trials.** Three developers install Sutura in a repository
   they know and Sutura's builders do not.
2. **Review studies.** Five people read verification evidence: a comprehension
   task, then a paired exercise comparing ordinary CI evidence with Sutura's.

Both are small usability studies. Neither is statistical proof of adoption or
market demand, and this document does not claim either.

## What is measured

| Study | Measure | Recorded by |
| --- | --- | --- |
| Installation | Time to first valid result, every setup failure, unclear instruction and manual intervention, and the outcome class (repair, refusal, flake) | `scripts/adoption-study.mjs` |
| Installation | Every invited person and how their attempt ended, whether or not it succeeded | `scripts/review-study.mjs` attempt ledger |
| Comprehension | The first unaided answer, before any hint: verdict, why, what ran, next safe action; and the time it took | `scripts/review-study.mjs` |
| Paired review | The decision under each condition, whether it was correct against assessor-only truth, elapsed time, help given and stated confidence | `scripts/review-study.mjs` |

The comprehension target is that four of five people correctly read the
verdict, the reason and the next action within sixty seconds. It is reported as
a count over five people, not as a rate.

The paired exercise answers a different question: does Sutura's evidence change
the decision a reviewer reaches? Correctness is reported before speed. A slower
but more accurate decision is not worse, and no universal time saving is
claimed.

## Task material

The four comprehension tasks and both paired packs are frozen in
`scripts/review-tasks.mjs`. `participantPack()` returns the questions with
every assessor field removed, and refuses to return material that still carries
an answer; `assessorSheet()` holds the correct decisions and hashes them. The
two paired packs share no defect, so nobody decides the same defect twice, and
each pairs one boundary-arithmetic defect with one missing-guard defect so the
two conditions face comparable difficulty.

Sutura's verdict is never displayed in the ordinary-CI arm. Condition order is
counterbalanced across participants, and an unbalanced assignment is refused
rather than reported with a caveat.

## Recruitment message (draft, unsent)

> Subject: 30 minutes to try a CI repair tool on a repo you know
>
> I am building Sutura, an open-source tool that checks whether an AI-generated
> CI fix actually fixed the problem. I am looking for three people to install it
> in a repository they maintain and know well, and five people to spend fifteen
> minutes reading its output and telling me whether it makes sense.
>
> What it involves: for the install, about thirty minutes, following public
> setup instructions on a repository of your choice. For the review, about
> fifteen minutes reading four saved results and answering four short questions
> about each.
>
> What I record: how long the setup took, every step that failed or was unclear,
> and the outcome. For the review, your answers and how long they took. I do not
> record your screen, and nothing identifying you is published. Pseudonymous
> participant ids are used throughout.
>
> What I do not do: I will not publish a quote, a screenshot or your repository
> name without asking you specifically about that item first. You can stop at any
> point and I will keep the record of the attempt, marked as withdrawn, without
> your data.
>
> If you are interested, reply and I will send the consent text and a link to
> pick a time.

## Intended cohort

Three installers: maintainers of public JavaScript, TypeScript or Python
repositories with a working CI pipeline, none of whom has contributed to
Sutura. At least one JavaScript or TypeScript and at least one Python
repository, which the exact-three contract already requires. Five reviewers:
the three installers plus two independent people who review code regularly and
have not seen Sutura's output before.

## Consent text (draft, unsent)

> **What this is.** A short usability study of Sutura, an open-source tool that
> verifies AI-generated CI repairs. It is run by the tool's author.
>
> **What you will do.** Either install the tool in a repository you maintain
> (about 30 minutes), or read four saved verification results and answer four
> short questions about each (about 15 minutes), or both.
>
> **What is recorded.** For an install: the time to a first valid result, each
> step that failed or was unclear, any manual intervention, and the public URLs
> of the runs produced. For a review: your written answers, how long each took,
> any help you were given, and your stated confidence. You are identified by a
> pseudonymous id such as `participant-1a2b3c4d`. Your name, contact details and
> employer are not recorded in the study data and are not stored in the public
> repository.
>
> **What is published.** Aggregate counts and the pseudonymous records. A direct
> quote, a screenshot or the name of your repository is published **only** if you
> agree to that specific item after seeing it.
>
> **Withdrawing.** You can stop at any time, before or after the session. The
> ledger keeps the fact that an attempt happened and how it ended, because
> dropping unsuccessful attempts would make the results describe only the people
> who succeeded. Your answers and measurements are removed on request.
>
> **Risks.** Installing the tool runs a GitHub Action in your repository and
> creates public workflow runs. It never merges anything. You choose the
> repository, and you can use a fork.
>
> By replying "I consent" you confirm you have read this and agree to take part.

## Scheduling dependency

The sessions this material is written for were planned for **14–20 October
2026**. Reserving those slots means contacting participants, so it needs
explicit authorization. Until that authorization is given, this document
records the dependency rather than assuming anyone is available, and the
measured installs remain phase 11 and 12 work.

## Rehearsal, and what it is not

A rehearsal runs the same instructions against a locally packed artifact so the
material can be checked before anyone else follows it.
`buildRehearsalRecord()` labels one, and `assertRehearsalIsNotAdoption()` runs
the adoption validator against it and fails if it is accepted. A rehearsal
therefore cannot be counted toward the three installs by editing a number: the
acceptance contract requires public npm and an immutable Action identity, and a
packed local artifact is neither.

## External-agent patch sources

Two packs in `scripts/review-tasks.mjs` name the same clean source, the same
failing command and the same allowed scope, so two independent agents are asked
an identical question and the verifier sees only their bytes. Each carries a
correct and a deceptive control, so the verifier can be calibrated whether or
not either agent succeeds. No hidden expectation is in either pack. A renamed
copy of one hand-authored patch is not two independent sources, and would not
satisfy this.
