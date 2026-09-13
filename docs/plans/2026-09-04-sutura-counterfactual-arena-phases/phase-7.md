# Phase 7: Arena case selection manifest

Issues: #76 (stratified 100-case selection), #77 (language, failure class,
repository, difficulty, inclusion reason)

Depends on: nothing. `[batch-eligible]` with Phase 5.

## Goal

A deterministic, versioned, reproducible selection of software-engineering
cases, with every field the roadmap requires recorded per case, and a
stratification that is a pure function of a catalog snapshot.

## Step 1 - Catalog snapshot contract

`packages/placebo/src/selection.ts` (new).

```ts
export const ARENA_CATALOG_SCHEMA_VERSION = 'sutura-arena-catalog-v1' as const;

export type ArenaSource = 'swe-bench-verified' | 'swe-rebench' | 'placebo';

export interface ArenaCatalogEntry {
  id: string;                 // stable environment identifier
  source: ArenaSource;
  repository: string;         // owner/name
  language: FixtureLanguage;
  failureClass: FailureClass;
  difficulty: 'standard' | 'hard';
  environmentRef?: string;    // exact image or environment reference
}

export interface ArenaCatalog {
  schemaVersion: typeof ARENA_CATALOG_SCHEMA_VERSION;
  capturedAt: string;
  entries: ArenaCatalogEntry[];
  catalogHash: string;
}
```

The catalog is an input file. Producing it from Nebius is authorization gate G3
in the parent plan; until then the committed Placebo corpus is projected into a
catalog by `catalogFromCorpus()`, which lets the whole selection path be
validated end to end offline with real data.

`validateArenaCatalog` refuses a duplicate id, an unknown source, an unknown
language or failure class, a repository that is not `owner/name`, and a
`catalogHash` that does not re-derive.

## Step 2 - Stratification

```ts
export interface ArenaSelectionTargets {
  size: number;                                   // 100
  strata: Array<{ key: string; minimum: number }>; // language and failure class floors
  seed: string;                                    // recorded, not random
}

export function selectStratified(
  catalog: ArenaCatalog,
  targets: ArenaSelectionTargets,
): ArenaSelectionManifest;
```

Algorithm, fully deterministic:

1. Bucket entries by `${language}:${failureClass}`.
2. Fill every declared stratum to its `minimum`, taking entries in ascending
   order of `sha256(seed + id)` so the choice is reproducible and independent of
   catalog order.
3. Fill the remainder proportionally to bucket size, breaking ties by the same
   hash, then by `id`.
4. Refuse when the catalog cannot satisfy a declared minimum, naming the
   stratum and the shortfall. Never silently under-fill.
5. Refuse when `size` exceeds the catalog size.

## Step 3 - The selection manifest (#77)

```ts
export interface ArenaSelectionCase extends ArenaCatalogEntry {
  stratum: string;
  inclusionReason: string;   // 'stratum floor: javascript:test-assertion' or 'proportional fill: <stratum>'
}

export interface ArenaSelectionManifest {
  schemaVersion: 'sutura-arena-selection-v1';
  selectionId: string;
  catalogHash: string;
  capturedAt: string;
  targets: ArenaSelectionTargets;
  cases: ArenaSelectionCase[];      // sorted by id
  strata: Array<{ key: string; selected: number; available: number; minimum: number }>;
  resultHash: string;
}
```

Every case therefore records language, failure class, repository, difficulty,
and inclusion reason, which is exactly the #77 list. `resultHash` re-derives
from the canonical manifest.

`validateArenaSelection` refuses a manifest whose cases do not match a
re-selection from the same catalog, seed, and targets. That is the
reproducibility property the Phase 3 roadmap exit gate requires: the 100-case
comparison must be reproducible from a versioned manifest.

## Step 4 - CLI

`packages/placebo/src/cli.ts`:

```
placebo select --catalog <file> --size <n> --seed <text>
               [--minimum <stratum>=<n> ...] --output <file> [--force]
```

and, for the offline path,
`placebo select --catalog corpus` which projects the committed corpus.

## Step 5 - Committed artefacts

- `packages/placebo/arena/catalog-placebo-v0.2.json`: the corpus projection,
  generated and committed.
- `packages/placebo/arena/selection-placebo-v0.2.json`: a 51-case selection over
  that catalog with the same stratification code the 100-case selection will
  use, proving the tooling on real data.

The 100-case selection over SWE-bench Verified and SWE-rebench is produced only
after gate G3 supplies a real catalog. Until then this phase is complete in
tooling and blocked in data, and the issue comment says exactly that.

## Tests

`packages/placebo/src/selection.test.ts`:

- `catalogFromCorpus` produces one entry per benchmark case with the corpus
  language, failure class, and difficulty
- `validateArenaCatalog` refuses duplicates, unknown enums, a malformed
  repository, and a wrong hash
- `selectStratified` is deterministic: two runs with the same seed produce
  byte-identical manifests, and a different seed produces a different selection
  from the same catalog
- a declared minimum that the catalog cannot satisfy is refused with the
  stratum name and the shortfall
- every selected case carries a non-empty `inclusionReason`
- `strata` accounting sums to `cases.length`
- `validateArenaSelection` refuses a manifest with a hand-edited case list

## Success criteria

- [ ] All listed tests pass.
- [ ] The corpus catalog and a 51-case selection are committed and reproducible.
- [ ] No path under `packages/placebo/corpus` changed.
- [ ] Gate G3 recorded with its exact command and stop condition.
