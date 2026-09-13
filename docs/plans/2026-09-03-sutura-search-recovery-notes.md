# Sutura adaptive search recovery implementation notes

## Deviations

- Plan said: the existing provider-contract canary assertions were sufficient after adding the proposal retry. Found: an invalid first canary response could be followed by a valid retry and make the canary appear successful. Chose: require the canary to observe exactly one provider response. Why: preserve the canary's fail-closed one-turn contract for `sutura-super-repair-v5`.
- Plan said: Phase 2 changed only the listed repair-attempt, Nebius, and canary files, while all existing tests remained green. Found: six serialized-provider replay tests supplied only one invalid response, one multi-target test returned byte-identical replacements, and two immutable v4 live bundles cannot exactly replay the v5 request contract or changed search order. Chose: update only the affected test harnesses, keep every captured and Placebo fixture unchanged, and pin the two historical bundles' exact intentional replay mismatches while retaining static assertions for their recorded outcomes. Why: exercise the bounded retry honestly and keep replay failures specific without falsifying historical evidence.
