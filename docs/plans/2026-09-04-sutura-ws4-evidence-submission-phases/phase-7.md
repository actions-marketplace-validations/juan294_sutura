# Phase 7: Devpost submission and public evidence index

Status: Blocked on complete public evidence and Devpost authorization

Issues: #124-#127 and #58

## Before authorization

1. Create `docs/demo/sutura-v0.2.1-evidence-index.md` with all eleven required
   identities, exact release SHA, terminal state, and direct public evidence.
2. Generate and validate `sutura-v0.2.1-release-evidence-input.json` and
   `sutura-v0.2.1-release-evidence.json`; require `complete: true` and
   `ready: true`.
3. Create `docs/demo/sutura-v0.2.1-submission-backup.md` containing final text,
   image identities and hashes, public video URL, evidence-index URL, release
   identity, and generation timestamp.
4. Run the submission contract, release contracts, signed-out link checks, and
   a manual diff between source copy and backup.
5. Record the literal browser action and final project URL in G8 and request
   authorization.

## After authorization

1. Update from the backup and inspect every required preview field (#124).
2. Verify the significant-work section against git history (#125).
3. Verify the feedback section against the committed report (#126).
4. Submit once, record the public submission URL and timestamp, and hash the
   final backup (#127).
5. Make the evidence index terminal and release-bound, update the roadmap
   header, phase table, and evidence register, then close #58.

Any mismatch stops before submission. A post-submit mutation needs a new
authorization because it changes public state.
