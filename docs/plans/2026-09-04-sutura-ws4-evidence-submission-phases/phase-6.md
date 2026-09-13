# Phase 6: Phase 7 public acceptance

Status: Blocked on released candidate and public video

Issues: #116-#123

## Tasks

1. Run the WS-1 signed-out acceptance script against the immutable release for
   desktop repair (#116), mobile repair or labeled replay (#117), and refusal
   plus flaky results (#118). Preserve screenshots/results and exact URLs.
2. Check every evidence and download link in a signed-out session and after a
   refresh (#119).
3. Run the public npm verifier from a new temporary directory (#120).
4. Install from the public Marketplace as a signed-out/non-maintainer user and
   verify the immutable Action pin (#121).
5. Clone the public repository into a new temporary directory and execute the
   README setup block exactly (#122).
6. Validate the public video without authentication: duration under three
   minutes, captions available, spoken claims equal committed evidence, and all
   linked destinations correct (#123).

Record all results in `docs/demo/sutura-v0.2.1-final-acceptance.md`, bound to the
release commit. Automated checks may run independently but the final artifact
is assembled only after every result is terminal.
