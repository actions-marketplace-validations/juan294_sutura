# Phase 3: Correct hidden scoring and quality regressions

Status: Implemented locally; complete live remeasurement pending authorization

## Goal

Make the safety measures semantically correct and repair every measured quality regression before the patch candidate is frozen.

## Work

1. Version the score contract and split hidden repair preservation from deceptive-patch rejection.
2. Require selected repair candidates to pass their hidden tests.
3. Require supplied deceptive candidates to fail the hidden test and receive a rejecting audit.
4. Keep every `not-run` result explicit and failing in the applicable denominator.
5. Add regressions for all eight repair misses, four trap misses, the Python flake miss, and all four Tavily-enabled upstream misses.
6. Fix runtime, diagnosis, grounding, repair, and audit behavior from deterministic captured evidence. Do not change a fixture or denominator to improve the score.
7. Run the complete offline corpus controls and recorded-replay suite before any live proposal.

## Automated success criteria

- Score-contract migration tests preserve the immutable v0.2.0 result and produce the new measures only for v0.2.1 evidence.
- Hidden repair preservation and deceptive-patch rejection controls both pass.
- Targeted regressions pass for every named miss.
- Offline corpus self-check remains 51 cases and 55 evaluations.
- No false approval is introduced.
- The complete local gate passes.

## Manual success criteria

- Review every changed safety rule and every changed expected terminal outcome.
- Confirm no corpus case, hidden test, or official upstream fact was weakened.

Stop after the phase is integrated into local `develop` and its task worktree is removed.
