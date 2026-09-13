import { describe, expect, it } from 'vitest';

import {
  ARENA_CATALOG_SCHEMA_VERSION,
  ArenaSelectionError,
  catalogFromCorpus,
  createArenaCatalog,
  selectStratified,
  stratumKey,
  validateArenaCatalog,
  validateArenaSelection,
  type ArenaCatalog,
  type ArenaCatalogEntry,
} from './selection.js';
import { discoverBenchmarkCases } from './corpus.js';

const CAPTURED_AT = '2026-09-04T00:00:00.000Z';

function entry(id: string, overrides: Partial<ArenaCatalogEntry> = {}): ArenaCatalogEntry {
  return {
    id,
    source: 'swe-bench-verified',
    repository: 'acme/widgets',
    language: 'python',
    failureClass: 'test-assertion',
    difficulty: 'standard',
    ...overrides,
  };
}

function catalog(entries: ArenaCatalogEntry[]): ArenaCatalog {
  return createArenaCatalog(entries, CAPTURED_AT);
}

function mixedCatalog(): ArenaCatalog {
  return catalog([
    ...Array.from({ length: 12 }, (_value, index) => entry(`py-assert-${index}`)),
    ...Array.from({ length: 8 }, (_value, index) =>
      entry(`js-type-${index}`, { language: 'javascript', failureClass: 'typecheck' })),
    ...Array.from({ length: 5 }, (_value, index) =>
      entry(`ts-build-${index}`, { language: 'typescript', failureClass: 'build', source: 'swe-rebench' })),
  ]);
}

describe('Arena catalog', () => {
  it('projects the committed corpus into a catalog with one entry per benchmark case', async () => {
    const cases = await discoverBenchmarkCases();
    const projected = await catalogFromCorpus(CAPTURED_AT, cases);

    expect(projected.schemaVersion).toBe(ARENA_CATALOG_SCHEMA_VERSION);
    expect(projected.entries).toHaveLength(cases.length);
    for (const item of projected.entries) {
      const source = cases.find(({ id }) => id === item.id)!;
      expect(item.language).toBe(source.metadata.language);
      expect(item.failureClass).toBe(source.metadata.class);
      expect(item.difficulty).toBe(source.metadata.difficulty ?? 'standard');
      expect(item.source).toBe('placebo');
    }
    expect(validateArenaCatalog(projected)).toEqual(projected);
  });

  it('refuses duplicates, unknown enums, a malformed repository, and a wrong hash', () => {
    expect(() => catalog([entry('a'), entry('a')])).toThrow('repeats entry a');
    expect(() => catalog([entry('a', { source: 'made-up' as ArenaCatalogEntry['source'] })]))
      .toThrow('unsupported source');
    expect(() => catalog([entry('a', { language: 'rust' as ArenaCatalogEntry['language'] })]))
      .toThrow('unsupported language');
    expect(() => catalog([entry('a', { failureClass: 'vibes' as ArenaCatalogEntry['failureClass'] })]))
      .toThrow('unsupported failure class');
    expect(() => catalog([entry('a', { repository: 'not-a-repo' })]))
      .toThrow('repository must use owner/name format');
    expect(() => catalog([entry('a b')])).toThrow('entry id is malformed');
    expect(() => catalog([])).toThrow('at least one entry');

    const tampered = { ...mixedCatalog(), catalogHash: 'f'.repeat(64) };
    expect(() => validateArenaCatalog(tampered)).toThrow('catalog hash does not match');
  });
});

describe('stratified selection', () => {
  it('is deterministic for a seed and different across seeds', () => {
    const source = mixedCatalog();
    const targets = { size: 10, strata: [], seed: 'arena-2026-09' };

    const first = selectStratified(source, targets, 'sel-1');
    const second = selectStratified(source, targets, 'sel-1');
    expect(second).toEqual(first);

    const other = selectStratified(source, { ...targets, seed: 'different' }, 'sel-1');
    expect(other.cases.map(({ id }) => id)).not.toEqual(first.cases.map(({ id }) => id));
    expect(other.cases).toHaveLength(10);
  });

  it('is independent of catalog order', () => {
    const source = mixedCatalog();
    const reversed = createArenaCatalog([...source.entries].reverse(), CAPTURED_AT);
    const targets = { size: 9, strata: [], seed: 'order' };

    expect(selectStratified(reversed, targets, 'sel-1').resultHash)
      .toBe(selectStratified(source, targets, 'sel-1').resultHash);
  });

  it('fills every declared stratum floor and records the reason', () => {
    const manifest = selectStratified(mixedCatalog(), {
      size: 12,
      strata: [
        { key: 'typescript:build', minimum: 5 },
        { key: 'javascript:typecheck', minimum: 4 },
      ],
      seed: 'floors',
    }, 'sel-floors');

    const byStratum = new Map(manifest.strata.map((item) => [item.key, item] as const));
    expect(byStratum.get('typescript:build')?.selected).toBeGreaterThanOrEqual(5);
    expect(byStratum.get('javascript:typecheck')?.selected).toBeGreaterThanOrEqual(4);
    expect(manifest.cases).toHaveLength(12);
    expect(manifest.cases.every(({ inclusionReason }) => inclusionReason.length > 0)).toBe(true);
    expect(manifest.cases.some(({ inclusionReason }) =>
      inclusionReason === 'stratum floor: typescript:build')).toBe(true);
    expect(manifest.cases.some(({ inclusionReason }) =>
      inclusionReason.startsWith('proportional fill:'))).toBe(true);
  });

  it('records language, failure class, repository, difficulty, and inclusion reason for every case', () => {
    const manifest = selectStratified(mixedCatalog(), {
      size: 6, strata: [], seed: 'fields',
    }, 'sel-fields');

    for (const item of manifest.cases) {
      expect(item.language).toBeTruthy();
      expect(item.failureClass).toBeTruthy();
      expect(item.repository).toMatch(/^[^/]+\/[^/]+$/u);
      expect(['standard', 'hard']).toContain(item.difficulty);
      expect(item.inclusionReason).toBeTruthy();
      expect(item.stratum).toBe(stratumKey(item));
    }
  });

  it('accounts every selected case in exactly one stratum', () => {
    const manifest = selectStratified(mixedCatalog(), {
      size: 15, strata: [], seed: 'accounting',
    }, 'sel-accounting');

    expect(manifest.strata.reduce((total, { selected }) => total + selected, 0))
      .toBe(manifest.cases.length);
    expect(manifest.strata.reduce((total, { available }) => total + available, 0))
      .toBe(mixedCatalog().entries.length);
  });

  it('refuses a stratum the catalog cannot satisfy, naming the shortfall', () => {
    expect(() => selectStratified(mixedCatalog(), {
      size: 20, strata: [{ key: 'typescript:build', minimum: 9 }], seed: 'short',
    }, 'sel-short')).toThrow('Stratum typescript:build needs 9 cases but the catalog holds 5');
  });

  it('refuses floors above the size, a size above the catalog, and a repeated stratum', () => {
    expect(() => selectStratified(mixedCatalog(), {
      size: 4,
      strata: [{ key: 'python:test-assertion', minimum: 3 }, { key: 'javascript:typecheck', minimum: 3 }],
      seed: 's',
    }, 'sel-1')).toThrow('Declared stratum floors total 6, above the selection size 4');

    expect(() => selectStratified(mixedCatalog(), { size: 100, strata: [], seed: 's' }, 'sel-1'))
      .toThrow('the selection asks for 100');

    expect(() => selectStratified(mixedCatalog(), {
      size: 4,
      strata: [{ key: 'python:test-assertion', minimum: 1 }, { key: 'python:test-assertion', minimum: 2 }],
      seed: 's',
    }, 'sel-1')).toThrow(ArenaSelectionError);
  });

  it('refuses a hand-edited selection manifest', () => {
    const source = mixedCatalog();
    const manifest = selectStratified(source, { size: 6, strata: [], seed: 'edit' }, 'sel-edit');

    expect(validateArenaSelection(manifest, source)).toEqual(manifest);
    expect(() => validateArenaSelection({
      ...manifest,
      cases: manifest.cases.slice(0, 5),
    }, source)).toThrow('result hash mismatch');
    expect(() => validateArenaSelection(manifest, catalog([entry('only-one')])))
      .toThrow('catalog hash does not match');
  });
});
