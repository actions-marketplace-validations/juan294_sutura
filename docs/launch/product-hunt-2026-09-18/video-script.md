# Sutura launch video: 75-second narrated screen capture

Target: 60-90 s for the Product Hunt listing (YouTube link), reusable as the
opening of the Devpost cut. Narration is about 180 words, which lands near
75 s at a natural pace. Every claim below is visible on screen in the shot it
accompanies; nothing states a number that is not on the page being shown.

Footage: one live `javascript-repair` run on the Case Lab
(https://sutura-case-lab.vercel.app/), the demo repository's GitHub Actions
run, the result page, and the evidence pull request. The recorded reference
run is `cl-1789656182513-67dad051` (demo run 35235441536, PR
juan294/sutura-demo#42).

## Shot list and narration

| Time      | On screen                                                                                          | Narration                                                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00-0:08 | A red GitHub Actions run. Cut to a diff that deletes the failing test; the check turns green.      | A green check is not proof of a fix. An AI agent can delete the test, weaken the assertion, or patch the wrong file, and the badge still turns green.                                          |
| 0:08-0:14 | Case Lab home. Cursor selects the javascript-repair case and clicks Run.                           | Sutura is a GitHub Action that verifies the repair instead of trusting the result. Here is a real failure on a public demo repository.                                                         |
| 0:14-0:26 | GitHub Actions run in progress: reproduction step, then repeated runs, then the sandbox log lines. | First it reproduces the failure in an isolated sandbox with the network disabled. It runs it more than once, so a flaky test is never patched as if it were broken.                             |
| 0:26-0:38 | Candidate search step; the green-wash rejection line; the trusted test passing on a clean branch.  | Then it searches bounded repair candidates. Any candidate that removes a test, weakens a check, or relaxes a rule is rejected mechanically. The winner is rerun on a clean branch.              |
| 0:38-0:54 | Result page: the three audit rows. Nemotron approved, GPT-6 Astra approved, TypeSafe Jev approved. | Finally, an adversarial audit. NVIDIA Nemotron on Nebius asks whether the patch fixed the diagnosed failure. GPT-6 Astra asks again, independently. So does TypeSafe Jev. Each can only veto.    |
| 0:54-1:06 | The evidence pull request: diff, reproduction count, audit verdicts, cost line.                    | Only then does Sutura open a pull request, with the reproduction, the rejected shortcuts, and every audit verdict attached. It never merges. A human does.                                      |
| 1:06-1:15 | Case Lab result URL, GitHub repo, "Open source, MIT". End card: Sutura wordmark and tagline.       | Try it now on the Case Lab, no account needed. Sutura: verified self-healing CI. It proves the fix, not just the green.                                                                          |

## Narration only (paste into ElevenLabs)

A green check is not proof of a fix. An AI agent can delete the test, weaken
the assertion, or patch the wrong file, and the badge still turns green.

Sutura is a GitHub Action that verifies the repair instead of trusting the
result. Here is a real failure on a public demo repository.

First it reproduces the failure in an isolated sandbox with the network
disabled. It runs it more than once, so a flaky test is never patched as if it
were broken.

Then it searches bounded repair candidates. Any candidate that removes a test,
weakens a check, or relaxes a rule is rejected mechanically. The winner is
rerun on a clean branch.

Finally, an adversarial audit. NVIDIA Nemotron on Nebius asks whether the
patch fixed the diagnosed failure. GPT-6 Astra asks again, independently. So
does TypeSafe Jev. Each can only veto.

Only then does Sutura open a pull request, with the reproduction, the rejected
shortcuts, and every audit verdict attached. It never merges. A human does.

Try it now on the Case Lab, no account needed. Sutura: verified self-healing
CI. It proves the fix, not just the green.

## Voice notes for ElevenLabs

- Calm, technical, unhurried; a narrator explaining, not selling.
- Keep the paragraph breaks as short pauses (about 0.6 s); they align with the
  cuts in the shot list.
- Slight emphasis on "not proof", "only veto", "never merges", and the final
  "proves the fix, not just the green".
- Read "CI" as two letters, "Nemotron" as NEM-oh-tron, "Jev" to rhyme with
  "rev", "Astra" as AS-tra.
- Export at 44.1 kHz WAV or 192 kbps MP3; a run of 70-80 s is the target. If
  it comes in over 85 s, drop the sentence "Here is a real failure on a public
  demo repository."

## Assembly

1. Record the screen capture at 1920x1080 following the shot list; the run
   itself takes about 100 s, so the middle shots are trimmed to the listed
   durations.
2. `ffmpeg -i capture.mp4 -i narration.mp3 -c:v copy -c:a aac -shortest
   sutura-launch.mp4`, after aligning cuts to the narration's paragraph pauses.
3. Upload to YouTube from Juan's account; add the link under "Video / Loom" in
   the Product Hunt edit view (https://www.producthunt.com/posts/sutura/edit).
