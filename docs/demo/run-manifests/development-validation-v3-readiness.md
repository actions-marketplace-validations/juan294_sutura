# Stage 3 v3 readiness

Prepared September 8, 2026; historical candidate request. **Juan approved USD 25 and the exact candidate push. Zero Stage 3 cases were dispatched.** The candidate failed the final CI guard coverage gate; its separately recorded prerequisite canary passed. The [v4 replacement request](development-validation-v4-readiness.md) preserves that evidence and asks to carry the same total allowance forward. Do not execute the superseded v3 case request.

The [manifest](development-validation-v3.json) binds candidate `ba408402f7ceaae0d291fca300280326f7cd2241`: complete shared runtime verification, canonical executed evidence, source binding, read-only external verification, and cumulative manifest accounting. Its 80 development/validation subjects retain the exact v2 order. The held-out paid evaluation remains unopened and needs a separate decision after Stage 3 is read.

Manifest hash: `9e9a8285bc119fb45b30e477ce2d03d2cd565102305cb588a0698b9f52f5f59e`.

## Frozen configuration

The [saved configuration](development-validation-v3-config.json) has byte SHA-256 `bc55e44f2e755db0d69269e443b40ee384162885b2dd121daec96bfb1b887b2a`. It records the actual default controller settings, fixed `production-baseline-v1` routing, declared runtime references, fixture-selected runtime/contract mode, Tavily enabled and counterfactuals disabled. The development adaptive profile is available locally but is not selected for this measurement.

The candidate workflow invokes the CLI with these defaults. Before dispatch, verify the effective environment and arguments against this file. A changed model, setting, image/corpus/split identity or selected subject requires a new manifest hash; do not change the configuration after reading held-out results.

Node's declared registry digest was rechecked through a read-only registry lookup on September 8. Python retains its previously verified runtime contract. These are preflight declarations: ConTree's actual immutable baseline ID is recorded separately in evidence v2, and a registry lookup is not OCI attestation of a provider image. Recheck the provider/image canaries on the exact candidate before paid measurement.

## Price and time

The [official Nebius model catalog](https://tokenfactory.nebius.com/model-catalog.md) was checked again on September 8. Per-million-token input/output prices remain Nano USD 0.06/0.24, Super USD 0.30/0.90, Ultra USD 1.00/3.00. These are dated inference estimates, not confirmed sandbox billing rates.

The existing manifest validator calculates `80 × 1 × 8 × 4096 × (1 + 3) / 1,000,000`, approximately **USD 10.48576**. That formula assumes an input allowance equal to the output allowance. It is not a whole-run invoice ceiling. The unchanged runtime repair budget is at most USD 0.25 inference per subject, so 80 subjects have a USD 20 repair-inference envelope. The proposed USD 25 cumulative cap allows additional headroom without raising any per-subject default. Raw sandbox units and other unconfirmed charges remain unknown; the remaining USD 5 is headroom, not a sandbox cost estimate.

The earlier USD 5.52 and 4.5-hour extrapolations came from a defective, reduced verification path. They are not estimates for this new path. The manifest retains a 48,000-second elapsed-time limit and one case at a time. Actual workflow setup, queue time and provider latency must be recorded. If a cap or a known-danger control stops the run before 80 subjects complete, report a stopped run, not a clean repair rate.

The initial USD 0.50 per-dispatch reserve is a scheduling reserve, not a provider-side hard billing limit. It rises to the highest observed case cost. Unknown dispatch costs remain pending, and restarts preserve earlier spend and reservations. An unexpectedly expensive in-flight case can exceed its reservation; reconciliation must never invent zero or reset an account.

## Before paid execution

1. Obtain explicit authorization for this manifest's cumulative USD 25 cap, or regenerate it if the selected cap changes.
2. Obtain separate authorization to push the exact candidate. Require `origin/develop`, controller SHA and subject SHA to equal `ba408402f7ceaae0d291fca300280326f7cd2241` with required remote checks passing. Do not force-push or waive the remote identity gate. The later local documentation commit does not change the measured candidate.
3. Verify configuration, prices, provider availability, credential presence and current image contracts. Use an isolated clean candidate worktree and the finalized manifest from outside it.
4. Initialize the durable cumulative account once. Retain all prior ledgers. Enable the push freeze, dispatch through the existing controller and observe every job to terminal or confirmed cancellation.
5. Stop on false approval, infrastructure stop, cap exhaustion or unresolved billing. Read and reconcile every stop before an explicit restart decision. Disable the freeze only after terminal reconciliation.

## Prepared commands

These commands have not been run. Run them only after the authorizations and remote gates above, from the final documentation checkout.

```bash
export SUTURA_STAGE3_MANIFEST="$(pwd)/docs/demo/run-manifests/development-validation-v3.json"
git worktree add --detach ../sutura-stage3-v3 ba408402f7ceaae0d291fca300280326f7cd2241
cd ../sutura-stage3-v3
pnpm install --frozen-lockfile
pnpm run build
pnpm run placebo:live init-spend --run-manifest "$SUTURA_STAGE3_MANIFEST" --cap-usd 25 --initial-reserve-usd 0.50
pnpm run push-freeze on --reason development-validation-v3
pnpm run placebo:live gate --controller-sha ba408402f7ceaae0d291fca300280326f7cd2241 --subject-sha ba408402f7ceaae0d291fca300280326f7cd2241
pnpm run placebo:live streak --controller-sha ba408402f7ceaae0d291fca300280326f7cd2241 --subject-sha ba408402f7ceaae0d291fca300280326f7cd2241 --run-manifest "$SUTURA_STAGE3_MANIFEST" --cap-usd 25 --initial-reserve-usd 0.50 --authorize
```

Do not remove the account to rerun `init-spend`. After terminal reconciliation, use `pnpm run push-freeze off`. Publication, Stage 4, recruitment and the independent reviewer remain separately gated.

## Local verification

The [roadmap completion record](../../plans/2026-09-05-sutura-verified-repair-program.md#local-completion--september-8-2026) records the passing local gates and the full-CI fixture failure followed by corrected recovery-suite reruns. Packed CLI/Action installation passed on candidate `ba408402f7ceaae0d291fca300280326f7cd2241`. The saved manifest hash, configuration byte hash, price calculation, candidate existence and unchanged 80-subject order were checked locally. These checks do not establish live provider behavior or a repair rate.
