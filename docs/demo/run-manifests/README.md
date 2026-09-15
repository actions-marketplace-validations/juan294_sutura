# Paid run manifests

Each manifest binds one measurement to its candidate, configuration, subjects and finite caps. Authorization is separate and specific to that manifest. Historical runs do not authorize a new run or leave a reusable balance.

## Current result

[Stage 3 v8](development-validation-v8-evidence.md) is the current clean
development/validation measurement. Exact candidate
`042af3aada158347db6006e30a4a0e6e7c65e420` completed 80/80 cases for USD
6.431018 in recorded inference and sandbox cost. It repaired 33/42 repairable
cases (78.6%) with zero false approvals. Hidden repair preservation passed 4/8
with four not run, so the preservation gate did not pass. The held-out 20-case
split remains sealed.

The sanitized evidence binds the result to its manifest, corpus, split,
configuration, and candidate hashes without publishing private operational
state. It does not replace or rewrite any historical manifest.

## Staged ladder and historical records

| Stage | Manifest | Status |
| --- | --- | --- |
| 1 | `preflight-contract-v1` | Historical provider/image contract evidence; not a quality measurement. |
| 2 | `development-smoke-v1` | Historical six-control smoke passed, including a live two-file transaction. Later defects prevent treating it as current quality evidence. |
| 3 | `development-validation-v1` | Stopped after a false approval; cumulative restart accounting was subsequently fixed. Retain the original manifests, costs and failed evidence. |
| 3 | `development-validation-v2` | Superseded, unexecuted request for the earlier candidate. |
| 3 | `development-validation-v3` | Cap and push approved; candidate failed final CI guard coverage. Prerequisite canary passed; zero cases dispatched. Superseded case request. |
| 3 | `development-validation-v4` | Replacement after test-only coverage correction. Same total allowance requested; pending replacement-manifest approval. |
| 3 | `development-validation-v8` | Current clean result: 80/80 completed on candidate `042af3a`; USD 6.431018 recorded; 33/42 repairs; zero false approvals. Sanitized evidence is tracked; the operational manifest remains private. |
| 4 | Not prepared | Held-out 20 require a separate cap and frozen configuration after Stage 3 is read. |
| Release | `release-v0.3.0-benchmark` | Complete: 51/51 cases, 55/55 evaluations on candidate `c94eee20…`; USD 4.11234948 recorded (inference USD 0.15101, sandbox USD 3.96133948); zero false approvals. Sanitized evidence: `sutura-v0.3.0-release-benchmark-evidence.md`. |

Each stage gates the next. Stop dependent jobs after a failed control or incomplete run. Paid Data Lab comparisons and other roadmap experiments need their own concrete requests; Stage 3 does not authorize them. The completed Stage 3 result does not authorize or establish acceptance for Stage 4.

Historical JSON identities remain unchanged. Read each manifest's own candidate, corpus, split, configuration, image and dated model prices. Do not rewrite old evidence to match the current candidate. A declared registry digest does not attest a provider image; executed evidence records the actual immutable executor baseline separately.

## Historical local manifest checks

From the repository root, validate the historical v4 request without contacting a provider:

```bash
node --input-type=module -e "
import { manifestMaximumUsd, validateRunManifest } from './scripts/verified-program-evidence.mjs';
import { readFileSync } from 'node:fs';
const m = JSON.parse(readFileSync('docs/demo/run-manifests/development-validation-v4.json', 'utf8'));
console.log(validateRunManifest(m).manifestHash, manifestMaximumUsd(m));
"
```

The validator prices the maximum listed model with equal input/output token allowances and takes the smaller result or inference cap. This calculation is not a provider invoice ceiling: actual input context, sandbox charges and controller reservations have separate semantics. The readiness request records these limits explicitly. Unknown sandbox units remain unknown; never convert them to USD or zero without billing evidence.

## Historical v4 dispatch instructions

The exact candidate, remote checks, credential-presence checks, commands and stop procedure in [v4 readiness](development-validation-v4-readiness.md) are retained only as historical instructions for that superseded request. They do not authorize a new dispatch. Push authorization and paid-run authorization are separate. Check secrets by presence only; never print their values. A future run must keep the push freeze enabled until every dispatched job is terminal or its cancellation and billing are reconciled.

## Cumulative controller accounting

The Placebo CLI requires `--run-manifest` for both `run` and `streak`. Before the first authorized dispatch, initialize its account once with `init-spend`, using the same `--run-manifest`, `--cap-usd` and `--initial-reserve-usd` arguments intended for the run. Initialization is local bookkeeping, not spending authorization. Never initialize a historical manifest with a zero balance: the pre-fix v1 history remains closed and over budget.

The account lives under `sutura-manifest-spend/` in the Git common directory. All worktrees of this clone share it. It is separate from the replaceable case ledger, and exclusive creation refuses a second initialization. Each dispatch binds the manifest hash, exact candidate, listed subject and cumulative cap. Both inference and reported sandbox cost count, including repeated cases after a result-ledger reset. A changed hash or cap under the same manifest id is refused. A separate clone is not a continuation controller: transfer and verify the original account before any authorized continuation there.

Before dispatch the controller durably records a pending reservation and the unique controller id used in the GitHub run title. Concurrent controllers are locked out. Completion records the actual cost; a crash, failed workflow, unknown cost or invalid artifact leaves the reservation pending and blocks further spending. An unexpectedly expensive case can exceed the historical maximum reserve. This closes restart resets; it does not impose a provider-side hard billing limit within an already running case.

For recovery, first prove the original controller process has exited and find the exact GitHub run using the pending controller id. Wait for terminal state and retrieve its validated artifact and cost, or establish provider billing if no complete artifact exists. Preserve a copy of the account and case ledger. Only reconcile a pending entry against that exact run and measured cost; never clear it as zero merely because dispatch or download failed. Remove a stale lock only after proving no controller owns it. There is no automatic recovery command: unresolved billing keeps the run blocked. Account files are private local operational state and must not be deleted as worktree cleanup.
