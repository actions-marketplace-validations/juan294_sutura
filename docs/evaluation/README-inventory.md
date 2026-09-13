# Evaluation inventory v1

The frozen 100-case inventory the phase 6 quality evaluation refers to.
Rebuild it with:

```bash
node packages/evaluation/scripts/inventory.mjs --out docs/evaluation/inventory-v1.json
```

| Field | Value |
| --- | --- |
| Cases | 100 (60 development, 20 validation, 20 held out) |
| Root families | 94 |
| Corpus revision | Placebo v0.2 |
| Split hash | `49fb4609a602e609a6f31596522a4b229b3fc56ba670ce6a29d764905364a683` |
| Inventory hash | `e743598733bbd024ee66ebe9715619ae6061ec91a22f3570c44dfcf957c35272` |

Splits are frozen by root family, so a synthetic mutation can never land in a
different split from the case it derives from. The inventory hash moves when
any fixture content or the corpus revision changes, so a published held-out
number always names the exact corpus it was measured on.

38 corpus cases were added on 2026-09-06 to complete the inventory: 37 of them plus one more, because `repair-dogfood-arithmetic` is a corpus fixture that the benchmark manifest deliberately excludes. Each is
one distinct root defect with its own family, generated from
`packages/placebo/scripts/inventory-cases.mjs` by
`packages/placebo/scripts/generate-inventory-cases.mjs`. Every one carries
`evaluationRevision: inventory-v1`, so the frozen v0.2 default corpus selection
and its committed `corpusHash` are unchanged: only a run that opts into
versioned cases sees them.

The added defects, by language: 19 Python, 16 JavaScript, 3 TypeScript. By
kind: 26 repairable, 8 traps, 3 flakes, 1 upstream migration. They cover
mutable default arguments, integer division, suffix stripping, sort keys,
exclusive ranges, async gather ordering, decimal money arithmetic,
deduplication order, timezone-aware comparison, regex anchoring, lookup
defaults, resource release, internal list aliasing, numeric sort comparators,
shallow-copy mutation, settled-result handling, zero-based months, parse radix,
strict equality, regex `lastIndex`, JSON clone type loss, map key identity,
optional index access, discriminated-union narrowing, percentage rounding
preservation, a config-and-consumer two-file transaction, and an upstream
separator release. The traps cover tautological assertions, expected-failure
markers, widened numeric tolerance, a patched subject under test, non-null
assertions, empty catch blocks, loosened precision and a narrowed input set.

Every added case is validated by the corpus self-check: the clean fixture is
green, the break patch is red, reversing the break restores green, and each
trap's fake fix passes the visible suite while failing its hidden checks.

## Split composition

| Split | Cases | Families | Kinds | Languages |
| --- | --- | --- | --- | --- |
| Development | 60 | 55 | 33 repairable, 16 trap, 7 flaky, 4 upstream | 34 JS, 22 Python, 4 TS |
| Validation | 20 | 19 | 9 repairable, 7 trap, 3 flaky, 1 upstream | 13 JS, 4 Python, 3 TS |
| Held out | 20 | 20 | 8 repairable, 8 trap, 3 flaky, 1 upstream | 16 JS, 3 Python, 1 TS |

## Family leakage audit

No root family appears in more than one split. This is enforced rather than
inspected: `freezeSplitByRootFamily` assigns a family as a unit, the inventory
test asserts no family spans two splits, and the dataset validator refuses an
export where one does. The held-out split holds 20 families for 20 cases, so no
held-out case shares a family with any other held-out case either.

One defect was found and fixed while auditing this. The freeze filled
development, then validation, then held out, taking families in alphabetical
order. That produced a held-out split of 15 families made almost entirely of
traps and upstream migrations, with a single Python case: it measured the end
of the alphabet rather than the corpus. Families are now taken largest first
and each goes to whichever split would still be furthest from full, measured
against its own share. The split hash changed with that fix, which is the point
of publishing it.

## Known limits

- **Benchmark familiarity.** Every case is synthetic and written for this
  benchmark, so no model has seen these exact files. That removes contamination
  and introduces a different limit: the defects are chosen by one author, and
  common defect shapes are over-represented relative to real repositories.
- **Language balance.** The held-out split is 16 JavaScript, 3 Python and 1
  TypeScript. Per-language held-out numbers are too small to compare; only the
  overall held-out number should be read as an estimate.
- **Upstream migrations.** One upstream case is held out. That is enough to
  check the path is exercised and not enough to estimate a rate.
- **Size.** 20 held-out cases give wide intervals. Reported as a proportion
  with a Wilson interval, not as a point estimate.
- **Single use.** The held-out split is opened once. If a fix follows held-out
  inspection, the set becomes development and replacement families are needed
  before any unseen-performance claim.
