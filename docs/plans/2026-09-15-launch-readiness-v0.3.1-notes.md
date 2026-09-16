# `2026-09-15-launch-readiness-v0.3.1` — Notes

## Deviations

### Phase 2: replay of the recorded `gave-up` bundle now diverges (pre-authorized)

- **Plan said** (`docs/plans/2026-09-15-launch-readiness-v0.3.1.md`, Success
  Criteria): "Replay of the committed bundle
  `packages/case-lab/src/__fixtures__/live-34977342282-javascript-repair-gave-up.json`
  still reproduces `gave-up` (it is recorded evidence; the fix changes
  behaviour of *new* runs only, and the named test stays green because the
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
  Patching that would require pairing a new LLM request with the *old*
  recorded LLM response (captured for a different prompt in the original
  live run), which would fabricate a search trace that never happened.
  Asserting the mismatch error instead requires no bundle edits at all and
  keeps the recorded bundle as honest historical evidence of the pre-fix bug.
