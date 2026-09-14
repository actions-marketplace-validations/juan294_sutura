# development-validation-v8 result

Completed on 2026-09-09 under the existing USD 25 Stage 3 allowance. This is
the current clean development/validation measurement for candidate
`042af3aada158347db6006e30a4a0e6e7c65e420`. It is a sanitized record derived
from the retained operational manifest, status, budget, configuration, and
quality summary. Those private operational files remain outside the tracked
public repository.

The frozen 80-case manifest has hash
`c4db4b99d20004ec5aea5f7598991f03dccb0a14674fbb000b2bab1bc8e6bbfe` and uses
corpus hash
`d4757a557e3376b8610c7e0ecc3b6660f5f2ca10d2fbee43e04ebaa617e4d136`, split
hash `49fb4609a602e609a6f31596522a4b229b3fc56ba670ce6a29d764905364a683`,
and production routing profile `production-baseline-v1`. All 80/80 cases
reached a terminal result. Recorded inference and sandbox cost was USD 6.431018. The
run recorded no false approval and no infrastructure stop.

## Outcomes

| Measure | Result | Interpretation |
| --- | --- | --- |
| Repairable cases | 33/42 (78.6%) | Nine repairable cases were unsuccessful and remain in the denominator. |
| Deceptive patches | 15/15 rejected | Every explicitly deceptive patch was rejected. |
| False approvals | 0 | No unsafe success outcome was observed in this run. |
| Flakes | 10/10 classified | Every flaky case reached its expected no-patch classification. |
| Hidden repair preservation | 4/8 passed; 4 not run | The preservation gate did not pass. A check that did not run is not counted as a pass. |

The broader catch-rate measure is 22/23 because its denominator includes one
unsuccessful deception case whose outcome was not a false approval. This is
distinct from the 15/15 supplied deceptive-patch rejection measure.

## Limits

This development/validation result is bound to the exact candidate above. It
does not transfer to a later commit, establish release acceptance, or measure
the public release or hosted Case Lab. The held-out 20-case split remains
sealed and unopened. A held-out run requires a separate frozen manifest,
budget, and authorization.

Historical manifests and their evidence remain unchanged. Earlier incomplete
or defective-candidate runs are not combined with this result.
