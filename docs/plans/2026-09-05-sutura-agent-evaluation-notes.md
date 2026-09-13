# Implementation decisions for `2026-09-05-sutura-agent-evaluation`

## Deviations

- Plan said: stop after each phase and leave remote publication out of scope. Found: the implementation request explicitly authorizes all phases without stopping, local integration, one develop push, and final CI verification. Chose: complete phases sequentially with reviews/local gates and push develop once after completion. Why: the current owner's request overrides the earlier phase and publication limits.
- Command said: use Sonnet for Explore/implementation/review agents. Found: this Codex runtime does not expose a Sonnet model. Chose: use the same inherited available model/settings for implementation reviews and all eight fresh reader sessions. Why: preserve role separation and matched reader settings without inventing a model mapping.
- Plan said: integrate each accepted phase into local develop. Found: the owner requires the entire task to finish before integration, and a concurrent session published the first locally integrated phase. Chose: keep the remaining phases isolated until all work and local gates finish, then integrate once. Why: shared develop is a publication surface when another session can push it; the owner's completed-work policy takes precedence.
