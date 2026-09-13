# Stage 3 v2 readiness

**Superseded as a current candidate request on September 8.** Further runtime verification, source binding and evidence changes are being integrated. This historical manifest remains unchanged and unauthorised; do not dispatch it to measure the new implementation. The replacement request will bind the final checked candidate.

Prepared 2026-09-08. **Authorization is USD 0. No jobs have been dispatched under this manifest.** The proposed cumulative cap is USD 10.00 for inference plus sandbox charges across every attempt. Approval of v1 does not authorize v2.

The [manifest](development-validation-v2.json) requests 80 development and validation cases, one repetition, concurrency one, on candidate `1fe31761e6f0a01a15189b4d7b85b7a10d6b8238`. Its subject list is identical, including order, to v1. No held-out paid evaluation was dispatched. The standard offline test suite includes local fixture tests. Stage 4 remains a separate decision after this run is read.

Manifest hash: `f06231fa612d71008d2d8149dcc898aff0c7e7ad4dd9c8a2b5b4c92345d7db8a`.

## Price and time

Current per-million-token prices were checked on 2026-09-08 against the [official Nebius model catalog](https://tokenfactory.nebius.com/model-catalog.md), linked from its [pricing application](https://tokenfactory.nebius.com/organization/prices). Prices are unchanged from v1.

| Model | Input USD / million | Output USD / million |
| --- | --- | --- |
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | 0.06 | 0.24 |
| `nvidia/nemotron-3-super-120b-a12b` | 0.30 | 0.90 |
| `nvidia/Nemotron-3-Ultra-550b-a55b` | 1.00 | 3.00 |

The validator's unclamped pricing formula is `80 × 1 × 10 × 4096 × (1 + 3) / 1,000,000 = USD 13.1072`; `manifestMaximumUsd` clamps it to USD 10.00. This is the validator's inference allowance calculation, not a confirmed whole-run invoice maximum. It assumes an input allowance equal to the output allowance. Sandbox billing is separate, and raw sandbox units have no confirmed dollar conversion in this manifest. The controller must enforce the approved cumulative total with its reserve and fail closed on unresolved costs.

The last 72-case attempt cost USD 4.9652 according to [v1 evidence](development-validation-v1-evidence.md). Linear extrapolation is USD 5.52 for 80 cases. This is an estimate from a defective candidate, not a quote or a repair-rate prediction. Runtime planning allowance is about 4.5 hours on a quiet provider; the manifest's declared elapsed-time cap remains 48,000 seconds (13 hours 20 minutes). Actual cost and duration can differ.

## Before a paid dispatch

1. Obtain explicit authorization for this manifest and its cumulative USD 10.00 proposed cap, or regenerate the manifest and hash if the chosen cap changes.
2. Use unified controller and subject candidate `1fe31761e6f0a01a15189b4d7b85b7a10d6b8238`. This includes cumulative accounting. All package directories are unchanged from `aca43608504ce6a272b3856138aba875bb8732e6`; the manifest binds the newer exact commit rather than pretending the earlier candidate contains the controller fix.
3. Verify the existing dogfood cleanliness, remote identity, CI, provider-contract and image-contract checks on this exact candidate. A separately authorized push must make `origin/develop` equal this candidate and pass its required checks before dispatch. Local integration of the later manifest documentation commit does not change the measured candidate. Do not waive the exact remote gate or force-push to satisfy it.
4. Use a clean detached worktree at the candidate, with this finalized manifest supplied by absolute path from the documentation checkout. Preserve prior result ledgers and artifacts; arrange a fresh result ledger for this measurement without resetting or deleting any cumulative account. Recheck provider availability and prices, confirm credentials by presence only, and enable the push freeze before dispatch through the Placebo live controller.
5. Bind the approved manifest hash to its durable cumulative accounting record before the first paid operation. All retries and restarts retain earlier spend and reservations. Stop on infrastructure failure, false approval, or exhaustion of the cap. Report each stop before a restart decision.
6. After all jobs are terminal or explicitly cancelled, reconcile actual costs, preserve evidence and disable the push freeze. Report quality only if the run yields a clean, complete measurement on the named candidate.

## Commands after explicit authorization

These commands are prepared for review and have not been run. The proposed initial per-dispatch reserve is USD 0.50, raised to the highest observed case cost by the cumulative account. It is a scheduling reserve, not a provider-side hard billing limit. An unexpectedly expensive in-flight case can exceed its reserve.

Run setup from the root of the integrated documentation checkout after the separately authorized exact-candidate push and required checks. The manifest resides outside the clean candidate worktree so its documentation commit does not alter `HEAD`.

```bash
export SUTURA_STAGE3_MANIFEST="$(pwd)/docs/demo/run-manifests/development-validation-v2.json"
git worktree add --detach ../sutura-stage3-v2 1fe31761e6f0a01a15189b4d7b85b7a10d6b8238
cd ../sutura-stage3-v2
pnpm install --frozen-lockfile
pnpm run build
pnpm run placebo:live init-spend --run-manifest "$SUTURA_STAGE3_MANIFEST" --cap-usd 10 --initial-reserve-usd 0.50
pnpm run push-freeze on --reason development-validation-v2
pnpm run placebo:live gate --controller-sha 1fe31761e6f0a01a15189b4d7b85b7a10d6b8238 --subject-sha 1fe31761e6f0a01a15189b4d7b85b7a10d6b8238
pnpm run placebo:live streak --controller-sha 1fe31761e6f0a01a15189b4d7b85b7a10d6b8238 --subject-sha 1fe31761e6f0a01a15189b4d7b85b7a10d6b8238 --run-manifest "$SUTURA_STAGE3_MANIFEST" --cap-usd 10 --initial-reserve-usd 0.50 --authorize
```

Run `init-spend` exactly once. It refuses an existing account; never remove the account to retry. Resolve any gate failure before dispatch. After all jobs are terminal or explicitly cancelled and costs reconciled, run `pnpm run push-freeze off`. A restart requires an explicit decision and uses the existing cumulative account.

The prior v1 attempt history remains separate and immutable. A fresh manifest is a fresh measurement request, not retroactive approval of the earlier overrun. This preparation makes no publication, release, recruitment, independent-review or Stage 4 authorization claim.

## Local verification

The existing `validateRunManifest` accepts the saved file; its recomputed hash equals the stored hash, and `manifestMaximumUsd` equals `pricedMaximumUsd` (USD 10.00). The subject array matches v1 exactly and contains 80 unique entries. All non-candidate identity fields and caps match v1. The exact candidate resolves in local Git. No paid operation was needed for these checks.
