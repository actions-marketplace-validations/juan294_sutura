# WS-3 external-adoption recruitment kit

Use this kit only after Juan authorizes Gate C. Contact exactly three developers
who did not build Sutura, for one session each. Each participant chooses a public
GitHub repository they know and the Sutura builders do not. The three accepted
records together must cover JavaScript or TypeScript, Python, repair, refusal,
and flake classification.

## Recruitment text

Send this text individually:

> I am evaluating Sutura, an open-source GitHub Action that diagnoses failed CI,
> filters flaky failures, rejects unsafe shortcuts, and proposes reviewed repairs.
> Would you volunteer for one installation session in a repository you know but
> the Sutura builders do not? We will measure setup time, failures, unclear steps,
> manual interventions, and whether the result is useful. Provider calls may incur
> costs paid by the repository owner. Your session record is pseudonymous by
> default. We will quote or name you only if you separately approve the exact
> attribution. Participation is optional and you may stop at any time.

## Consent and privacy

Before starting, confirm that the participant voluntarily agrees to the session,
may stop at any time, and understands that the accepted evidence contains the
public repository URL, public target/Sutura Actions run URLs, public check-run URL, a pseudonymous participant ID,
timings, and reported setup observations. Do not record email addresses, account
handles, private repository data, provider keys, source code, logs, or local paths.

Attribution is a separate opt-in after the session. Keep `feedbackPermission`
false and both feedback fields null unless the participant approves the exact
quote and exact display name. Approval to participate is not approval to publish
attributable feedback.

## Session procedure

1. Copy `docs/adoption/ws-3-participant-record-template.json` outside the
   repository's tracked files. Assign a random pseudonym matching
   `participant-[a-f0-9]{8}`.
2. Record the UTC start instant immediately before setup. Record every setup
   failure, unclear instruction, and manual intervention as it occurs; empty
   arrays mean none occurred.
3. Install one explicit public release and independently capture its immutable
   Action commit:

   ```bash
   node scripts/test-public-install.mjs --release 0.2.1
   npx sutura@0.2.1 init
   npx sutura@0.2.1 doctor
   ```

4. Run the assigned repair, refusal, or flake case through the generated Action.
   Stop the timer only when the first valid result is visible. Record elapsed
   milliseconds and all three exact public evidence URLs: the failed target and
   Sutura workflow URLs ending in `/actions/runs/<number>`, and the completed
   **Sutura repair audit** check URL ending in `/runs/<number>`. The finalizer
   verifies the target/check identity and that the check title proves the recorded
   `fixed`, `refused`, or `flaky-no-patch` outcome.
5. Record installation, documentation, permission, and result-clarity defects.
   A blocking defect must be corrected and its resolution recorded before the
   session can count.
6. Review every free-text field for credentials, private paths, source, logs, and
   personal data, then set `publicReviewConfirmed` to true. The validator also
   rejects known credential and private-path patterns.
7. If the participant wants attribution, ask them to approve the exact quote and
   display name after seeing both. Otherwise leave both fields null.
8. Validate the unmodified repository template before use:

   ```bash
   node scripts/adoption-study.mjs validate-template --template docs/adoption/ws-3-participant-record-template.json
   ```

After all three sessions, place only the reviewed public-safe records in the
ignored `docs/adoption/records/` directory and create terminal evidence:

```bash
node scripts/adoption-study.mjs finalize --candidate "$(git rev-list -n 1 v0.2.1)" --records docs/adoption/records --output docs/adoption/sutura-external-adoption-evidence-v1.json
```

The finalizer refuses duplicate participants or repositories, incomplete language
or outcome coverage, mutable artifacts, missing measurements, invalid public evidence
URLs, unapproved attribution, and unresolved release-blocking defects.
