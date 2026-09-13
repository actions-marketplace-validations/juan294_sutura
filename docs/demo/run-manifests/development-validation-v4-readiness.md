# Stage 3 v4 replacement request

Prepared September 8, 2026. This requests applying the **existing USD 25 total allowance** to the replacement candidate. **No additional budget is requested.** Authorization for this replacement manifest is pending. No Stage 3 cases have run.

The [manifest](development-validation-v4.json) binds candidate `8657553608b04f5882eda7517068ad80f7d04aae`, manifest hash `50bd1213edf47d15259bc395c3f22e122b1b8f5827642128f17d415f4ae42558`. The [saved configuration](development-validation-v4-config.json) retains byte hash `bc55e44f2e755db0d69269e443b40ee384162885b2dd121daec96bfb1b887b2a`. All 80 subjects, their order, models, runtime settings and manifest caps are identical to v3. The paid held-out evaluation remains unopened.

## Why the identity changed

Juan approved v3's USD 25 cap and its candidate push. Candidate `ba408402f7ceaae0d291fca300280326f7cd2241` passed all workspace tests, package installation and CodeQL, but [CI failed](https://github.com/juan294/sutura/actions/runs/34232499198) at the final guard coverage check: 620/632 guards exercised. Source helpers had moved into core while some negative tests remained in CLI, outside the core/Action guard coverage collection.

The replacement adds two core test files and appends the existing guard check to `ci:local`. Production source and the committed Action bundle are unchanged. Sixteen new tests pass, core coverage tests pass 1,748 with 9 credential-gated skips, Action coverage tests pass 150, and guard coverage passes **632/632**. Types, lint, build, bundle parity and the pre-push checks passed. The corrected candidate is already pushed to `origin/develop`; later local documentation commits do not change it.

The [replacement CI](https://github.com/juan294/sutura/actions/runs/34235526650) and [CodeQL](https://github.com/juan294/sutura/actions/runs/34235526596) must be successful before any paid case. Runtime equivalence does not permit rewriting the original manifest or old artifact identities. The original v3 account and evidence remain intact.

## Cumulative allowance and retained preflight

The [first candidate's canary](https://github.com/juan294/sutura/actions/runs/34232636503) passed. It used 393 input tokens, 28 output tokens and zero reasoning tokens, giving an inference estimate of USD 0.0001431 at the saved Super prices. Its single Python proof operation succeeded, but the artifact does not report confirmed sandbox dollar billing. That amount remains unknown, not zero.

Retain **USD 1 for all prerequisite canaries**, including the completed first-candidate canary and one required exact-candidate refresh. Limit the replacement case controller to **USD 24**, so the combined allocation remains USD 25. The USD 1 is a reservation, not a claim of measured spend. Do not release it into the case budget while billing remains unconfirmed. The v3 case account has zero entries and no pending dispatch; retain it as a closed candidate record, never run it in parallel or reset it. Initialize v4 only once after approval and preserve the same common-directory accounting through every continuation.

The saved token formula is unchanged at approximately USD 10.48576; it assumes equal input/output allowances and is not an invoice ceiling. Unchanged per-subject repair inference budgets aggregate to USD 20 for 80 subjects. The historical USD 5.52/4.5-hour extrapolation does not estimate the expanded verification path. Raw sandbox units remain separately bounded and unconverted. Dated prices and the runtime-identity limitations are recorded in [v3 readiness](development-validation-v3-readiness.md).

## Execution gate and bounded continuation

1. Obtain the decision to apply the existing total USD 25 allowance to this replacement manifest. This does not authorize Stage 4, other experiments, publication or outreach.
2. Require remote develop, controller and subject to equal `8657553608b04f5882eda7517068ad80f7d04aae`, with successful exact-candidate push CI. Check the remote head immediately before enabling the shared push freeze.
3. Run one exact-candidate provider/image canary on frozen develop within the retained USD 1 prerequisite allocation: one workflow dispatch, 10-minute workflow timeout, bounded inference, one 120-second sandbox proof operation. No automatic workflow rerun. Preserve its artifacts and stop on failure or unresolved dispatch state. Earlier canary artifacts cannot be relabeled with the new SHA.
4. Recheck the saved configuration, credential presence, prices and runtime contracts. Initialize the v4 case account once with USD 24 cap and USD 0.50 scheduling reserve. Run the existing gate and controller from an isolated clean candidate checkout, using this finalized manifest from outside it.
5. Stop on false approval, infrastructure stop, cumulative cap exhaustion or unresolved cost. Reconcile every dispatched job before a restart decision. Never clear unknown cost as zero or delete the durable account. Disable the push freeze only after terminal reconciliation.

Prepared case commands, to run only after approval and successful preflight:

```bash
export SUTURA_STAGE3_MANIFEST="$(pwd)/docs/demo/run-manifests/development-validation-v4.json"
git worktree add --detach ../sutura-stage3-v4 8657553608b04f5882eda7517068ad80f7d04aae
cd ../sutura-stage3-v4
pnpm install --frozen-lockfile
pnpm run build
pnpm run placebo:live init-spend --run-manifest "$SUTURA_STAGE3_MANIFEST" --cap-usd 24 --initial-reserve-usd 0.50
pnpm run placebo:live gate --controller-sha 8657553608b04f5882eda7517068ad80f7d04aae --subject-sha 8657553608b04f5882eda7517068ad80f7d04aae
pnpm run placebo:live streak --controller-sha 8657553608b04f5882eda7517068ad80f7d04aae --subject-sha 8657553608b04f5882eda7517068ad80f7d04aae --run-manifest "$SUTURA_STAGE3_MANIFEST" --cap-usd 24 --initial-reserve-usd 0.50 --authorize
```
