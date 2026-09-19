# Product Hunt listing: Sutura, 2026-09-18

Every figure below comes from a committed evidence file or a live health
endpoint read on 2026-09-17. The Astra-usage commit counts from the phase file
could not be verified from git (no commit carries an Astra attribution), so
they are not printed.

## Name

Sutura

## Tagline (58 characters)

Verified self-healing CI: proves the fix, not just the green

## Links

- Website: https://sutura-case-lab.vercel.app/
- Repository: https://github.com/juan294/sutura
- npm: https://www.npmjs.com/package/sutura

## Topics

Developer Tools, GitHub, Artificial Intelligence, Open Source

## Description

AI agents make CI pass. A green check does not prove the failure was fixed: an
agent can delete a test, weaken an assertion, relax a compiler rule, or patch
the wrong file and still turn the badge green.

Sutura is a GitHub Action and CLI that verifies the repair instead of trusting
the result. On a red run it:

1. Reproduces the failure in an isolated sandbox, with network disabled.
2. Runs it repeatedly to separate flaky failures from persistent ones, and
   refuses to patch a flake.
3. Searches bounded repair candidates in sandboxed branches.
4. Rejects green-wash mechanically: deleted or skipped tests, weakened
   assertions, loosened types, relaxed lint or config.
5. Reruns the winner on a clean branch and puts it through an adversarial
   audit by NVIDIA Nemotron, with a GPT-6 Astra second opinion and a
   TypeSafe Jev calibrated audit that can each only veto, never approve.
6. Opens an evidence-backed pull request for a human to review. It never
   auto-merges.

Try it without an account on the Case Lab: five fixed cases with labeled
results, and live repairs against the public demo repository (24 per day).
Open source, MIT, built for the Nebius x NVIDIA Global AI Hackathon.

## First comment (Maker)

Hi Product Hunt, Juan here. A few honest notes before you click around.

What runs where. The repair model is NVIDIA Nemotron on Nebius Token Factory,
which is the hackathon this was built for. GPT-6 Astra sits in the audit gate
as a second opinion: it re-runs the same adversarial question and can only
reject a repair, never approve one. A third voice, TypeSafe's Jev, answers the
same question as a typed choice with a calibrated probability and confidence,
and it can only veto too. All three are visible as rows in every result.

What the Case Lab is. Five fixed cases you can read right now, each with a
deterministic replay. Live runs against the public demo repository are capped
at 4 per hour and 24 per day; when the cap is hit you still get the recorded
result. Today's live smoke result, with all three audit voices on the record:
https://sutura-case-lab.vercel.app/result/?id=cl-1789656182513-67dad051

What the numbers are. The v0.3.1 release benchmark ran all 51 Placebo cases
on the release commit: zero false approvals, 17 of 19 green-wash traps
refused, 10 of 18 repairable failures fixed, 10 of 10 flaky cases correctly
left unpatched, USD 3.77 total. Two provider infrastructure stops happened
during the run and are disclosed. The evidence files and every workflow URL:
https://github.com/juan294/sutura/blob/develop/docs/demo/sutura-v0.3.1-release-benchmark-evidence.md

What the GPT-6 Astra Challenge was like. Astra went into the product, not
just the workflow: it is the second auditor on every repair, wired in this
week and running live on the public demo. Its job is to disagree with
Nemotron when Nemotron is wrong, and the evidence shows when it does.

Ask me anything about the verification gates, the benchmark, or why it
refuses to auto-merge.

## GPT-6 Astra Challenge answer

Entered in the scheduling dialog under "What became possible in your product
with Astra that was not practical before?" (770 of 1000 characters):

An independent second auditor on every CI repair. Sutura's runtime model is
NVIDIA Nemotron; before Astra, the adversarial audit that decides whether a
patch really fixed the failure or just made the badge green had a single
voice, so a wrong approval had nothing to catch it. Astra now re-runs the same
audit question from a different provider and can only veto, never approve, so
two independent models must agree before a repair reaches a human. That
veto-only shape is what made a second opinion safe to ship: it cannot widen
acceptance, only narrow it. It runs live on the public demo today, and every
result shows Astra's row next to Nemotron's. Astra was also the coding model
this project started with, which is why it was the natural first choice for
the audit.

## Schedule

Scheduled on 2026-09-17 for 2026-09-18, 00:01 PT (09:01 CEST). Product Hunt
confirmed "Successfully Scheduled!" and the pre-launch dashboard shows
"Launch status: Scheduled". The GPT-6 Astra Challenge opt-in was selected;
Product Hunt added the "OpenAI Day" launch tag on top of the three chosen
tags. The repository link was first stored as plain http because the link
field prefixes bare hosts; it was corrected to https in the edit view and
saved ("All changes saved successfully").

## Launch URL

- Launch page: https://www.producthunt.com/products/sutura?launch=sutura
  (also reachable as https://www.producthunt.com/posts/sutura)
- Pre-launch dashboard (owner only):
  https://www.producthunt.com/products/sutura/sutura/prelaunch
- Edit view (owner only): https://www.producthunt.com/posts/sutura/edit
