# `2026-09-15-launch-readiness-v0.3.1` — Notes

## Deviations

### Phase 2: replay of the recorded `gave-up` bundle now diverges (pre-authorized)

- **Plan said** (`docs/plans/2026-09-15-launch-readiness-v0.3.1.md`, Success
  Criteria): "Replay of the committed bundle
  `packages/case-lab/src/__fixtures__/live-34977342282-javascript-repair-gave-up.json`
  still reproduces `gave-up` (it is recorded evidence; the fix changes
  behaviour of _new_ runs only, and the named test stays green because the
  recorded tool result is replayed, not recomputed — verify this explicitly
  in Phase 2; if the replay diverges, the fixture's test asserts the new
  mismatch message and the phase report explains why)."
- **Found:** the recorded bundle's own `gave-up` outcome was itself produced
  by the exact 16KB trusted-test-output refusal this phase fixes. Replaying
  the same recorded tool/LLM exchanges under the fixed code makes the search
  visit a different checkpoint node (`search-002` becomes `frontier` instead
  of `repeated-state`), so the report Sutura generates for the recorded
  GitHub `updateIssueComment` call (exchange 16) no longer matches the
  recorded expected argument, and `RecordedCallCursor` throws
  `ReplayMismatchError` before the test reaches its old success assertions.
- **Chose:** left the recorded bundle byte-for-byte untouched, and changed
  `src/replay.test.ts`'s `replays Case Lab live run 34977342282
(javascript-repair gave-up) from the real bundle` test — renamed to
  `detects that the fixed code's search diverges from the recorded gave-up
run` — to assert that replay rejects with `ReplayMismatchError` at
  sequence 16, path `$[1]`, with the real observed `expected`/`actual`
  checkpoint-lineage lines distinguishing the pre-fix (`search-002 …
repeated-state`) and post-fix (`search-002 … frontier`) reports.
- **Why:** the plan explicitly pre-authorized this exact path. It also
  avoids a worse alternative we considered and rejected: patching the
  bundle's self-generated GitHub report fields (exchanges 16/17) to match
  the new output. That looked reasonable at first (those two fields are
  Sutura's own derived text, not third-party ground truth), but doing so
  surfaced a further, deeper mismatch in the same recorded bundle — an
  outbound Nebius/LLM request mid-search (`bundle.http` sequence 88) whose
  content also depends on which checkpoint nodes the fixed code visits.
  Patching that would require pairing a new LLM request with the _old_
  recorded LLM response (captured for a different prompt in the original
  live run), which would fabricate a search trace that never happened.
  Asserting the mismatch error instead requires no bundle edits at all and
  keeps the recorded bundle as honest historical evidence of the pre-fix bug.

### Phase 4 Part A: `develop` had never been reconciled after the v0.3.0 squash

- **Plan said:** step 6 anticipated a post-squash reconcile ("as `79d510c`
  did") happening _after_ the v0.3.1 squash merge.
- **Found:** the equivalent reconcile after the _v0.3.0_ squash (`c94eee2`)
  was never done in the previous release cycle — `origin/develop` had no
  ancestor path to `c94eee2`, so the `develop → main` release PR (#144) was
  reported `CONFLICTING` by GitHub. All ~38 conflicting files were pure
  version-literal collisions (`develop`'s content was a verified strict
  superset of `main`'s, confirmed via `git log origin/main ^origin/develop`
  showing only the squash commit itself).
- **Chose:** created `chore: reconcile main after v0.3.0 squash` on `develop`
  using `git merge -s ours origin/main`, mirroring the `79d510c` parent order
  (`develop` tip first, `main`'s squash second) and preserving `develop`'s
  tree exactly (verified byte-identical via `git diff <before> <after>`).
- **Why:** this is the same reconciliation pattern the plan already names as
  precedent, just applied to the release before this one, which had silently
  skipped it. Doing it now (rather than editing PR #144's diff by hand)
  keeps history honest and unblocks every future `develop → main` PR too.

### Phase 4 Part A: flaky pre-push test given an explicit timeout

- **Found:** `packages/cli/src/verify-source.test.ts`'s "refuses a tracked
  symlink without copying external bytes" hit Vitest's 5s default timeout
  twice under this machine's heavy concurrent-session load (real symlink +
  git-subprocess I/O), with no code relationship to this branch's changes
  (passed standalone in 8.8s; the file wasn't touched by any phase).
- **Chose:** added an explicit `30_000`ms timeout to just that test.
- **Why:** `.claude/rules/ci-parity.md` already requires exactly this for any
  test doing real build/install/sandbox-shaped I/O; the test just hadn't been
  updated to follow it yet, and it was blocking every push attempt.

### Phase 4 Part B: blocked on Nebius/Nemotron provider drift, not this release

- **Plan said:** Part B (canaries → paid Placebo benchmark → Case Lab bump)
  follows the release tag, gated on the provider-contract canary passing
  within 24h.
- **Found:** the live "super" Nemotron model is emitting malformed diffs
  where newlines render as literal `n` characters (e.g.
  `{n  return left + right;n}`), causing
  `runSuperRepairProviderContractCanary` to fail with `gave-up: Repair
proposal patch was not accepted: unexpected canary patch`. Reproduced 4/4:
  twice in CI at the `v0.3.1` tag, twice locally — including once against
  the **unmodified `v0.3.0` commit (`c94eee2`)**, which passed this same
  canary as recently as 2026-09-15 and now fails identically. No code path
  that constructs `proposalDiff` (`repair-attempt.ts` → `parseProposal` →
  `anchoredEditsDiff`) was touched by Phases 1–4.
- **Chose (Juan, 2026-09-16):** ship v0.3.1 without the live benchmark for
  now. This leaves `ci.yml` red on `main` at `3fd99d8` (the
  `release:case-lab check` gate correctly refuses because the Case Lab still
  names `v0.3.0`), which means `publish.yml`'s "exact-head CI" check cannot
  be satisfied — **the GitHub release and npm publish of `sutura@0.3.1` are
  deferred, not completed.** The `v0.3.1` git tag exists and is pushed;
  nothing further in Part A or B has been attempted since this decision.
- **Why:** running the paid benchmark (cap USD 10) while the provider is
  emitting malformed diffs risks spending real money on repairs that fail
  for reasons unrelated to Sutura's own code, without a working live demo to
  show for it.
- **Unblocks when:** the provider-contract canary passes again (retry
  `gh workflow run provider-contract-canary.yml --ref v0.3.1 -R
juan294/sutura`, or run `node scripts/provider-contract-canary.mjs`
  locally with `NEBIUS_API_KEY` sourced from `.env`) — then resume at Part B
  step 1 (canaries) of `docs/plans/2026-09-15-launch-readiness-v0.3.1-phases/phase-4.md`.

### Addendum 2026-09-17: the v0.3.1 tag no longer exists; the cycle resumes with Jev

- **Notes said (above):** "The `v0.3.1` git tag exists and is pushed."
- **Found (verified 2026-09-17 04:30Z):** no `v0.3.1` tag locally or on origin, no
  GitHub release, npm at 0.3.0; `origin/main` holds the un-tagged squash `3fd99d8`.
  The tag was deleted after the 2026-09-16 decision; two canary runs still carry
  `headBranch: v0.3.1`.
- **Now:** the provider-contract canary passed on `develop` at 2026-09-17T03:32Z
  after `3397eac`, so Part B is unblocked. The release cycle resumes under
  `docs/plans/2026-09-17-typesafe-jev-calibrated-audit.md` Phase 4 with the TypeSafe
  Jev calibrated audit included, from a fresh `develop → main` squash.

### Addendum 2026-09-17: the red `ci.yml` on the release squashes was a shallow-checkout bug

- **Notes said (Part B):** `ci.yml` on `main` at `3fd99d8` was red because the Case
  Lab still named v0.3.0.
- **Found:** the failing step printed "no v* tag is reachable from origin/main".
  `actions/checkout` fetches one commit, so `merge-base --is-ancestor` could not see
  v0.3.0 at `c94eee2`; the check could only ever pass when the tag sat at HEAD. The
  same failure reproduced on the v0.3.1 squash `d1bc6da`.
- **Chose:** `newestReleaseTag` deepens a shallow clone (`git fetch --unshallow
origin main`) before testing ancestry, with a stubbed test; the release squash is
  re-cut after this fix lands on `develop`.
- **Why:** the release can only be tagged on a commit whose push-event CI run is
  green, and the gate must be able to pass before the tag exists.
