# Sutura branch-local completion limit notes

## Deviations

### Phase 2 replay fixture

- Plan said: In `2026-09-04-sutura-completion-limit-branch-local`, every non-third Super reply applies a patch in the run `33836899254` replay.
- Found: The archived depth-1 decisions retain patched `search-001` and `search-002`, mark `search-003` completion-limit, and mark `search-004` ordinary failed with no patch.
- Chose: Keep branch 4's replacement valid but make its executor apply operation fail, while successful branches return distinct diffs.
- Why: This reproduces the archived decision sequence exactly before proving the fixed search continues to depth 2 through patched parents only.
