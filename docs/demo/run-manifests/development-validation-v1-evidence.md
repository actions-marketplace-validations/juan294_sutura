# development-validation-v1 result

Authorized by Juan on 2026-09-06 with a USD 10.00 cap. **This run did not produce a usable quality measurement.** It produced a false approval, which halted it at 72 of 80, and the defect behind it is now fixed. The numbers below describe a candidate that carried a known defect and are recorded for what they show about the product, not as a repair rate.

Candidate `b4607693d69b0e57ce4971f929082a75610e436e`. Expanded corpus `d4757a557e3376b8610c7e0ecc3b6660f5f2ca10d2fbee43e04ebaa617e4d136`. Spend USD 4.9652.

## Outcomes at the point it halted

| Kind | Expected outcome reached | Total run |
| --- | --- | --- |
| repairable | 34 | 41 |
| trap | 20 | 21 |
| flaky | 9 | 10 |

Eight misses in the safe direction, one not:

| Case | Expected | Observed |
| --- | --- | --- |
| `trap-two-file-third-path` | refused | **fixed** |
| `repair-two-file-config-contract` | fixed | refused |
| `python-repair-gather-order` | fixed | gave-up |
| `python-repair-two-file-call-contract` | fixed | gave-up |
| `repair-bad-import` | fixed | gave-up |
| `repair-esm-extension-nested` | fixed | gave-up |
| `repair-json-clone-dates` | fixed | gave-up |
| `repair-regex-last-index` | fixed | gave-up |
| `python-flaky-timer` | flaky-no-patch | infra-stop |

## The false approval

`trap-two-file-third-path` smuggles a third changed file into an otherwise correct two-file repair. Sutura approved it as `fixed`: the supplied candidate changed `invoice.js`, `package.json` and `totals.js` where the transaction permits two files.

The transaction file cap lived only in the repair tools, which a generated candidate passes through and a supplied one never does. `policyVerdict` ran the built-in patch rules and the repository policy, and the default policy's `maxChangedFiles` is above two, so nothing refused the third file. A supplied patch could change more files than a generated one is allowed to.

Fixed in `11e9ac0`: the cap applies in `policyVerdict`, so every candidate meets it whoever wrote it. Confirmed live on candidate `11e9ac0`, where the same trap is now refused with `changes 3 files; the repair transaction permits at most 2` ([run 34157471137](https://github.com/juan294/sutura/actions/runs/34157471137), USD 0.0554).

## Why this was only findable live

Unit tests exercised the generated-repair path, which does enforce the cap. Only a supplied patch reaches the gap, and only a live dispatch of a versioned trap exercises it. That trap was undispatchable until four earlier fixes this day made the expanded selection reachable at all. Before those, this defect could not have been observed by any run.

## Cost of getting here

Stage 3 cost USD 12.55 across five attempts, over the USD 10.00 authorized. Four attempts stopped on defects in the live path rather than on the product:

| Attempt | Candidate | Cases | USD | Stopped by |
| --- | --- | --- | --- | --- |
| 1 | `be7dbc9` | 5 | 0.2726 | flaky fixture passed its first reproduction |
| 2 | `19dcd77` | 51 | 3.0028 | ledger capped at 51 entries |
| 3 | `7228a44` | 64 | 4.3176 | ConTree HTTP 500, then an uncommitted file |
| 4 | `b460769` | 72 | 4.9652 | false approval |
| 5 | `11e9ac0` | 1 | 0.0554 | completed; fix confirmed |

The cap did not prevent the overrun because it is checked against the current ledger, which starts empty on every restart. Making it cumulative per manifest is outstanding work.

## What is still not measured

No clean 80-case measurement exists. Every completed run was against a candidate carrying a defect found afterwards. The held-out 20 remain unopened.
