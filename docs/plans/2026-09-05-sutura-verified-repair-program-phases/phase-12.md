# Phase 12 — Real maintainer trials and evidence-backed product fixes

Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on accepted phase 11 pilot. Sequential, not batch eligible.

## Outcome and source

Obtain real independent installation and review evidence, fix observed product failures, and verify the fixes before final freeze. Scope is the already-approved workflow; new unrelated features require a separate plan. Read `docs/adoption/verified-repair-study.md:1` (created in phase 9) and phase 9's implemented scripts/rubrics, public pilot manifest, `scripts/adoption-study.mjs:1`, `review-study.mjs:1`, and Marketplace/evidence validators. Own study records, consented aggregates and focused fixes in the actual affected modules with their tests. Core fixes follow the same isolated implementation and bundle rules.

## Trial execution

Reuse any scoped scheduling authorization and reserved cohort from phase 9. For remaining outreach, use the prepared messages, concrete recipients, task pack and actual public version to request explicit authorization; do not send unsolicited messages based solely on plan approval. Human participation and consent cannot be manufactured with agents. Schedule three independent unfamiliar-repository installs and five human review sessions. Capture all attempts, including unsuccessful installs and withdrawals, before selecting three validated install records. Keep contact details and raw private material outside public repo; sanitize only consented evidence.

Install tasks cover Node/TS and Python, repair/refusal/flake outcomes, npm and immutable Action paths. At least one participant uses the external verifier on an existing patch rather than only observing the showcase. Review sessions measure verdict, rejecting reason, executed evidence and next action before hints. Preserve actual elapsed time and assistance. Do not let a builder narrate the answer before scoring comprehension.

```text
for consentedParticipant in authorizedCohort:
    record attempt before task
    observe public artifact installation or first unaided review
    append raw answer, timing, interventions, terminal outcome
    obtain explicit consent for each public quote/artifact
issues = classifyObservedProductFailures(allAttempts)
for scopedIssue in issues:
    reproduce with redacted fixture
    implement minimal fix; independent review; simplify; local gates
    revalidate affected release/provider/public paths under their authorization
report all attempts and fixes, separating pilot from final artifact identities
```

Complete phase 9’s counterbalanced paired review exercise using the frozen matched task packs: ordinary CI/diff evidence versus Sutura evidence. Record correct accept/refuse/abstain decisions, elapsed review time, assistance and assigned order. Report individual paired differences and sample/order limitations, separately from comprehension. Do not promise a numeric time-saving claim from estimates or infer benefit from comprehension alone; invalid pairing must be rerun or labeled incomplete. Report sample size and familiarity. Small feedback cohorts do not establish market fit.

All material setup/verification/UX defects discovered in this scope must be resolved and retested before final freeze. Preserve a separate rerun record when the same person repeats after a fix; do not count them as a new independent participant. If the four-of-five unaided comprehension target misses, revise copy/layout based on actual misunderstandings and rerun the declared review cohort with repeat status or fresh participants. Participant scarcity leaves adoption incomplete; never replace it with simulated success.

## Automated success criteria

- [ ] Existing validator accepts three genuine public-install records bound to real artifacts and required language/classification mix; ledger reconciles every attempted session.
- [ ] Review scorer reproduces first unaided results from records; assistance, missing answers and failed sessions cannot vanish.
- [x] Public export checks reject secrets/private contacts/unconsented quotes and broken release/source hashes.
- [ ] Every code fix has a named reproduction, targeted regression, independent review, standard sequential gates and bundle parity when applicable.
- [ ] Any changed behavior invalidates and reruns dependent phase 10/11 evidence according to the parent's identity rules. Do not reuse pilot results as exact-final acceptance.

## Manual success criteria and stop

Three valid independent installs and five real review sessions completed; publish counts, failures, interventions, findings, consented quotations and measured outcomes. Reviewer verifies the value statement against what developers actually achieved. Retain pilot evidence with its original identity; the final package's current install/critical behavior checks are required in phase 13, without falsely claiming every earlier human used that final version. Stop after recording fixes and remaining empirical target misses honestly.

## Progress record — September 6

Not started, and not completable by an agent. This phase requires three independent developers installing Sutura in unfamiliar repositories and five people reviewing verification evidence. The phase text states it directly: human participation and consent cannot be manufactured with agents. It also depends on an accepted phase 11 public pilot. No participant was contacted and no message was sent.

## Progress record — September 6

Every measured criterion here needs real consenting participants, which phase 9
prepared and nobody has been asked to join. **No participant was contacted and
no session was held.**

The public export check is built, because it can be written before there is
anything to export and must exist before there is. `scripts/study-export.mjs`
refuses an export carrying anything shaped like a credential, a private contact
detail such as an email address, a phone number or a social profile, at any
depth rather than only at the top level. It refuses a quote unless the
participant consented to that exact quote, matched by hash: consent to take
part is not consent to be quoted, and consent to one quote is not consent to a
longer version of it. It refuses a real name in place of a pseudonymous
participant id, a participant appearing twice, and a release or source identity
that is not an exact commit. 6 tests, wired into `test:release-contracts`.

Still blocked, and not claimed: everything that needs a genuine session.
