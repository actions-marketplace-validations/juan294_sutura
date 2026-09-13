# Phase 5: Live 10/10 streak and the gave-up loop

Supersedes `docs/plans/2026-08-29-live-repair-reliability-phases/phase-5.md`.

## Goal

Ten consecutive `fixed` outcomes on the canonical single-assertion fixture,
on one unchanged `packages/` tree, each with a green repair PR — recorded in
the ledger and reflected as `dogfood: passed` in release evidence. Any
`gave-up` on the way is converted into a committed captured fixture and a
named replay test before the next candidate.

## Preconditions

- Phases 3a, 3b, 3c, and 4 are merged and pushed to `develop`;
  `guards:verify` is dynamic `N/N`; `ci:local` and exact-SHA push CI are green.
- Execution stops here until the user gives the one-time live-spend
  authorization for the canary and one reserved-headroom streak attempt.
- `docs/demo/thumbnail/` remains untracked and untouched.

## Implementation

1. Push the exact candidate `develop` SHA; wait for CI `success`
   (`gh run watch`).
2. Dispatch the canary workflow on that SHA:
   `gh workflow run provider-contract-canary.yml --ref develop`; wait; the
   `provider-contract-canary` artifact must exist and bind to the SHA.
3. `pnpm run dogfood gate` — all conditions PASS.
4. `pnpm run dogfood streak --sha <sha> --authorize --cap-usd 14
   --initial-reserve-usd 1.50`.
   When an already-started exact-SHA streak is resumed after the cap extension,
   keep that candidate immutable: before each remaining attempt, prove that
   total scratch-ledger spend plus the highest observed attempt cost is at most
   USD 14.00, then run `pnpm run dogfood run --sha <sha> --attempt <n>`.
   Stop on the first non-`fixed`. After 10/10, run the updated `streak` command
   with the same evidence SHA; it performs no dispatch and promotes the ledger.
5. On the first non-`fixed`:
   a. the script has stored `sutura-replay-<ci>.json` under
      `packages/action/src/__fixtures__/captured/<ci>/`; commit it with a
      manifest entry (`kind: 'dogfood-gave-up'`);
   b. write a test named `replays live run <suturaRunId>: <terminal class>`
      in the module that owns the terminal, loading the captured bundle
      through `replayBundle` and asserting the recorded outcome and the
      exact terminal message;
   c. if the bundle contains `contree` exchanges, also promote it to the
      ConTree captured fixture set and switch the pending ConTree guard tests
      from Phase 3b onto it (this closes the last `pending` boundary);
   d. diagnose from the replay locally — the fix must make the replay test
      pass with the recorded provider responses unchanged, or the test must
      assert a new provider request shape that the canary then proves live;
   e. run the complete local gate (`ci:fast`, `guards:verify`,
      `test:captured-fixtures`, `ci:local`, `/simplify`);
   f. push one candidate; return to step 1. The ledger keeps the failed
      entry; the streak restarts at attempt 1 on the new tree hash.
6. On streak completion: promote the scratch ledger to
   `docs/demo/dogfood-ledger.json`, regenerate the `.md`, and run the
   documented release-evidence status mode to show `dogfood: passed`; commit
   both canonical files once.
7. Preserve every remote `dogfood/streak-*` and `sutura/fix-*` branch.
8. Remove task-owned local worktrees; local `develop` equals
   `origin/develop`.

## Automated success criteria

- Ledger: 10 trailing entries with `outcome: 'fixed'`, one shared
  `packagesTreeHash`, ten distinct `ciRunId`/`suturaRunId`/`prUrl` values,
  and total Phase 5 ledger spend ≤ USD 14.00.
- For each entry: repair commit parent equals the dogfood SHA; the diff
  touches only `packages/core/src/dogfood-add.ts`; the repair PR CI run is
  `success`.
- `scripts/release-evidence.mjs` reports `dogfood: passed` for the final
  `develop` SHA.
- Every `gave-up` ledger entry has a committed captured bundle and a test
  whose name contains its `suturaRunId`; `test:captured-fixtures` and
  `guards:verify` pass with zero `pending` boundaries.
- At least one bundle from the streak contains `nebius`, `tavily` (if
  grounding ran), and `contree` exchanges, and `sutura replay --bundle` on it
  reproduces `fixed` offline with the same candidate diff hash.

## Manual success criteria

- The user authorizes the streak once before step 4 and is told the total
  cost and streak length at the end (or at the halt).
- The user confirms remote branch preservation is acceptable for public
  evidence.

## Exit evidence

Report: candidate `develop` SHA, CI run URL, canary run URL, and for each of
the ten attempts the dogfood SHA, intentional CI URL, Sutura run URL, repair
PR URL, repair commit SHA, repair PR CI URL, sandbox USD, inference USD; the
ledger `resultHash`; the number of gave-ups encountered and the replay test
name created for each.

## Execution notes

- Provider-contract canary run `33312570131` on candidate
  `5e70a8bf1093173acd6142078b3015c4a25183b5` reached Nebius and failed before
  inference with HTTP 422, `Invalid parameter: extra_body`.
- The plan and prior replay assertions used OpenAI SDK notation for
  `extra_body`. Sutura sends raw JSON with `fetch`, so the corrected v2 wire
  contract sends `chat_template_kwargs` at the top level and omits both
  `extra_body` and `reasoning_effort`. A regression test names the failed
  canary run.
- Provider-contract canary run `33314221139` on candidate
  `f6af25a2bd1de124e40786d98c79860658858466` accepted the corrected request,
  completed inference, and returned the canonical repair, but omitted the
  optional `completion_tokens_details` object. The corrected v3 contract
  accepts an omitted breakdown as zero reasoning tokens while it still fails
  on an explicit nonzero value or a returned `<think>` prefix. A regression
  test names this canary run.
- Provider-contract canary run `33315587765` on candidate
  `aa43711daa5e8209f3983f3a55474e69dc99bb44` produced the exact expected
  applied diff and passed the trusted test, but the provider's raw replacement
  used a newline form that was not byte-identical to the source fixture. The
  repair engine intentionally normalizes line endings and the final newline.
  The corrected v4 contract hashes the canonical applied replacement after
  the exact diff check. A semantically different repair still fails that
  exact diff check. A regression test names this canary run.
- A linked-worktree push of candidate `5e96c741345b8152563503dbbc6fc36391d98198`
  exposed repository-local `GIT_DIR` and `GIT_WORK_TREE` variables to the
  pre-push test process. The foreign-repository fixture in `checks.test.ts`
  then targeted Sutura's shared Git directory, set the fixture identity, and
  created fixture commit `a531f696` on the local candidate branch. The hook
  now clears only the variables reported by `git rev-parse --local-env-vars`
  before it runs tests; the fixture also clears those variables itself and
  uses per-command identity flags instead of persistent Git configuration. A
  regression test executes the real hook with sentinel values for every local
  Git variable.
- The first streak start on candidate `3a17bccdd51365265d39e2a5eade4ac4f4432042`
  stopped before dispatch and before provider spend because the command wrapper
  trimmed the final newline from the fixture blob returned by `git show`.
  `break.diff` therefore did not apply to the otherwise matching source. The
  dogfood runner now requests untrimmed Git text when it materializes the two
  fixture files, and the real-path regression test requires that option.
- Dogfood CI run `33321106629` on candidate
  `e197173762ae98639afdc46a47801ef72544c5a6` failed only at the intended test
  command, before Sutura and before provider spend. GitHub's job API names an
  unnamed run step `Run pnpm run test`, while the validator and its mock used
  `pnpm run test`. The validator now requires the exact live API name, and the
  former mock-only name is rejected.
- The same CI run had already triggered Sutura run `33321172589`. It completed
  as `gave-up` after seven search nodes. The run spent USD 0.825674 on ConTree
  and USD 0.013137 on inference, for USD 0.838811 total. No repair PR was
  created. The check-run identity, HTML artifact, and replay artifact all bind
  to CI run `33321106629` and dogfood commit
  `1951701b95fd559335af3d3a7502e271c02befa2`.
- That first real replay exposed three capture-contract defects. A repository
  policy that fixes `runtime: node` did not suppress the 500-path runtime scan;
  the checkout error fallback was not schema-valid; and completeness required
  a Tavily exchange even when grounding was not applicable. Replay now records
  a schema-valid logical checkout on capture failure, skips runtime discovery
  when the captured policy fixes it, and treats Tavily as optional. Hash-only
  ConTree upload bodies are accepted because deterministic replay uses the
  recorded logical Executor stream, not diagnostic ConTree HTTP bodies.
- The recovered complete fixture is
  `packages/action/src/__fixtures__/captured/33321106629/bundle.json`. The named
  test `replays live run 33321172589: source-limit gave-up with seven search
  nodes` reproduces the terminal offline. The raw artifact hash remains in the
  scratch ledger; the recovered replay fixture has its own manifest hash.
- Replay showed that the final failure path arrived after eight earlier Vitest
  reporter paths had filled the source limit. New Action captures record the
  `latest` source-reference strategy. It gives line-bearing recent failures
  priority and reserves four of the eight source slots for dependency closure,
  so `packages/core/src/dogfood-add.test.ts` reaches
  `packages/core/src/dogfood-add.ts`. Bundles without the strategy keep the
  legacy `first` rule and remain deterministic.
- The consolidated local gate found that `guards-3a.test.ts` and
  `guards-3b.test.ts` still hard-coded interim file-and-line inventories.
  Phase 3c already replaced those inventories with the run-time AST and v8
  `guards:verify` gate. Both obsolete tests were deleted as Phase 3c required;
  guard coverage is no longer invalidated by unrelated line movement.
- The original USD 10.00 authorization stopped candidate `a99e231` after six
  consecutive fixed entries. Total Phase 5 live spend was USD 9.153422, so the
  reserve correctly prevented attempt 7. On 2026-08-31, the user authorized
  completion under a new total Phase 5 cap of USD 14.00. The runner counts all
  scratch-ledger entries against that cap before each remaining dispatch.
- Candidate `a99e23199a80ae6ee51fe1680afb74188416160c` passed develop CI run
  `33328273318`, provider canary run `33328878512`, and all six dogfood gates.
  Ten consecutive live repairs were fixed on its unchanged packages tree.
  The streak cost USD 10.738999; total Phase 5 live spend was USD 13.450513.
  The ledger result hash is
  `42ddbff67eeb8f7ded9e59aa3da1ef91ec5c3733f0737260d0058e4a0e3dcd5f`,
  and release evidence reports `dogfood: passed`.

| Attempt | Dogfood SHA | CI | Sutura | PR | Repair commit | Repair CI | Sandbox USD | Inference USD |
| ---: | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 1 | `f694d2f849da9a4a5051742f005eed42d87f08f4` | `33328936605` | `33329038396` | `29` | `a8d95345efc6c9c6ae1c8b787c45c03499af56d1` | `33329236146` | 1.058764 | 0.025359 |
| 2 | `a9afdd80017489c18e5e8e400a7b0ce8e951f739` | `33329785241` | `33329903829` | `30` | `208172e723f108b47c5c072ae9e30fdf60495f5c` | `33330058748` | 1.037273 | 0.022742 |
| 3 | `ea9790f39418aa8fe296d1216c2c3db7cff91b61` | `33330650649` | `33330743263` | `31` | `3936a2f9f82b753a94ff731fbb78bb8a5c667561` | `33330892295` | 1.064426 | 0.027296 |
| 4 | `39f4d65ce43aa06944d8c643202db42d145dafa7` | `33331501530` | `33331587624` | `32` | `0c3817a12d8a5849872d350041e559f52b009bec` | `33331727181` | 1.039250 | 0.023734 |
| 5 | `f2efee4c26e02521d1a7394cc302a7dc3c1db1bd` | `33332287700` | `33332369139` | `33` | `cdc920958bc892d8e262a5b98fd1dad3f556dd24` | `33332507698` | 1.044618 | 0.025819 |
| 6 | `e9218d9d0435ecf71355667953d3041fc3fa6990` | `33332976946` | `33333076543` | `34` | `cbf12f7702b3703eb00151dddb88abde478b5e14` | `33333205967` | 1.049383 | 0.023244 |
| 7 | `3db606b5910ed336c588e0da373536ccd55f96ee` | `33358648166` | `33358764843` | `35` | `d5a53c68442cc962c4dfbf94c937c2e654371303` | `33358916002` | 1.053883 | 0.025032 |
| 8 | `1177466f344927c6a25c7952e7b4fdedaf36f23a` | `33359429381` | `33359560180` | `36` | `69854df34d53d8afea68d34e77cc00489112bbbf` | `33359745314` | 1.045351 | 0.023675 |
| 9 | `c1c0a074a09e541c859745b50e5452b759a258c8` | `33360533338` | `33360643739` | `37` | `4efc81d16b09eaa8453a43736d025fcc193eab9c` | `33360809830` | 1.046538 | 0.026701 |
| 10 | `0bda676826a5793d5c85c1bfd3bdf476eb5255c8` | `33361548920` | `33361668533` | `38` | `cb99824dc9de6d287f82c7f2c045aa8026ffa4e7` | `33361827072` | 1.050303 | 0.025608 |

- Every repair commit is the only child commit in its PR, has the matching
  dogfood SHA as its direct parent, changes only
  `packages/core/src/dogfood-add.ts`, and has a successful independent CI run.
- Three non-fixed candidates preceded the successful streak: two `gave-up`
  outcomes and one `refused` outcome. Their named replay tests are `replays
  live run 33321172589: source-limit gave-up with seven search nodes`, `replays
  live run 33323856253: recursive trusted test outlived the repaired
  workspace`, and `replays live run 33326031664: accepts null tool_calls with
  audit content`.
