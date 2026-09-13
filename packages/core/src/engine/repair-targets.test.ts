import { describe, expect, it } from 'vitest';

import { createDefaultRepositoryPolicy } from '../policy/load.js';
import {
  MAX_REPAIR_PAIR_TARGETS,
  MAX_REPAIR_TARGET_FILES,
  modelRepairSlots,
  repairTargetFileCap,
  selectRepairTargetSets,
  type RepairTargetSource,
} from './repair-targets.js';

const policy = createDefaultRepositoryPolicy();

function source(
  path: string,
  content: string,
  overrides: Partial<RepairTargetSource> = {},
): RepairTargetSource {
  return {
    path,
    startLine: 1,
    endLine: content.split('\n').length,
    content,
    editable: true,
    ...overrides,
  };
}

const consumer = source('src/consumer.js', "import { total } from './totals.js';\nexport const run = () => total(1);\n");
const producer = source('src/totals.js', 'export const total = (value) => value + 1;\n');
const unrelated = source('src/unrelated.js', 'export const other = () => 1;\n');

function kinds(sets: ReturnType<typeof selectRepairTargetSets>): string[] {
  return sets.map(({ kind }) => kind);
}

describe('repair target sets', () => {
  it('offers every editable source alone and pairs a resolved import relationship', () => {
    const sets = selectRepairTargetSets({
      sources: [consumer, producer], runtimeId: 'node', policy,
    });

    expect(kinds(sets)).toEqual(['single', 'single', 'related-source']);
    const pair = sets.at(-1)!;
    expect(pair.slots.map(({ path }) => path)).toEqual(['src/consumer.js', 'src/totals.js']);
    expect(pair.slots.map(({ slotId }) => slotId)).toEqual(['slot-1', 'slot-2']);
    expect(pair.relationship)
      .toEqual({ specifier: './totals.js', from: 'src/consumer.js', to: 'src/totals.js' });
  });

  it('binds each slot to its exact path, range and content hash', () => {
    const [single] = selectRepairTargetSets({ sources: [producer], runtimeId: 'node', policy });
    const moved = selectRepairTargetSets({
      sources: [{ ...producer, content: 'export const total = (value) => value + 2;\n' }],
      runtimeId: 'node',
      policy,
    })[0]!;

    expect(single!.slots[0]).toMatchObject({
      path: 'src/totals.js', startLine: 1, endLine: 2,
    });
    expect(single!.slots[0]!.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(moved.slots[0]!.contentSha256).not.toBe(single!.slots[0]!.contentSha256);
    expect(moved.setId).not.toBe(single!.setId);
  });

  it('is stable for the same sources and distinguishes the pair from its singles', () => {
    const first = selectRepairTargetSets({ sources: [consumer, producer], runtimeId: 'node', policy });
    const second = selectRepairTargetSets({ sources: [consumer, producer], runtimeId: 'node', policy });

    expect(first.map(({ setId }) => setId)).toEqual(second.map(({ setId }) => setId));
    expect(new Set(first.map(({ setId }) => setId)).size).toBe(first.length);
  });

  it('offers no pair for unrelated sources', () => {
    const sets = selectRepairTargetSets({
      sources: [consumer, unrelated], runtimeId: 'node', policy,
    });

    expect(kinds(sets)).toEqual(['single', 'single']);
  });

  it('offers no pair when the import resolves ambiguously', () => {
    const ambiguous = source('src/consumer.js', "import { total } from './totals';\nexport const run = () => total(1);\n");
    const sets = selectRepairTargetSets({
      sources: [
        ambiguous,
        source('src/totals.js', 'export const total = 1;\n'),
        source('src/totals.ts', 'export const total = 1;\n'),
      ],
      runtimeId: 'node',
      policy,
    });

    expect(kinds(sets)).toEqual(['single', 'single', 'single']);
  });

  it('never pairs a source that is not editable', () => {
    const sets = selectRepairTargetSets({
      sources: [consumer, { ...producer, editable: false }], runtimeId: 'node', policy,
    });

    expect(kinds(sets)).toEqual(['single']);
    expect(sets[0]!.slots[0]!.path).toBe('src/consumer.js');
  });

  it('pairs the root Node manifest with its matching lockfile', () => {
    const sets = selectRepairTargetSets({
      sources: [
        source('package.json', '{"dependencies":{"left-pad":"1.0.0"}}\n'),
        source('pnpm-lock.yaml', "lockfileVersion: '9.0'\n"),
      ],
      runtimeId: 'node',
      policy,
    });

    const pair = sets.at(-1)!;
    expect(kinds(sets)).toEqual(['single', 'single', 'manifest-lockfile']);
    expect(pair.slots.map(({ path }) => path)).toEqual(['package.json', 'pnpm-lock.yaml']);
    expect(pair.relationship).toBeUndefined();
    expect(pair.slots.map(({ generated }) => generated)).toEqual([false, true]);
    expect(modelRepairSlots(pair).map(({ path }) => path)).toEqual(['package.json']);
  });

  it('offers every slot of a related source pair for completion', () => {
    const [pair] = selectRepairTargetSets({
      sources: [consumer, producer], runtimeId: 'node', policy,
    }).filter(({ kind }) => kind === 'related-source');

    expect(pair!.slots.every(({ generated }) => !generated)).toBe(true);
    expect(modelRepairSlots(pair!)).toHaveLength(2);
  });

  it('does not pair a nested manifest, a lone manifest, or a non-Node runtime', () => {
    const nested = [
      source('packages/app/package.json', '{"dependencies":{}}\n'),
      source('packages/app/pnpm-lock.yaml', "lockfileVersion: '9.0'\n"),
    ];
    const lone = [source('package.json', '{"dependencies":{}}\n')];
    const python = [
      source('package.json', '{"dependencies":{}}\n'),
      source('pnpm-lock.yaml', "lockfileVersion: '9.0'\n"),
    ];

    expect(kinds(selectRepairTargetSets({ sources: nested, runtimeId: 'node', policy })))
      .toEqual(['single', 'single']);
    expect(kinds(selectRepairTargetSets({ sources: lone, runtimeId: 'node', policy })))
      .toEqual(['single']);
    expect(kinds(selectRepairTargetSets({ sources: python, runtimeId: 'python', policy })))
      .toEqual(['single', 'single']);
  });

  it('bounds pair candidates and never offers a duplicate pair', () => {
    const hub = source('src/hub.js', [
      "import { a } from './a.js';",
      "import { b } from './b.js';",
      "import { c } from './c.js';",
      'export const run = () => a + b + c;',
      '',
    ].join('\n'));
    const sets = selectRepairTargetSets({
      sources: [
        hub,
        source('src/a.js', 'export const a = 1;\n'),
        source('src/b.js', 'export const b = 2;\n'),
        source('src/c.js', 'export const c = 3;\n'),
      ],
      runtimeId: 'node',
      policy,
    });

    const pairs = sets.filter(({ kind }) => kind !== 'single');
    expect(pairs).toHaveLength(MAX_REPAIR_PAIR_TARGETS);
    expect(new Set(pairs.map(({ setId }) => setId)).size).toBe(pairs.length);
    for (const pair of pairs) {
      expect(pair.slots).toHaveLength(MAX_REPAIR_TARGET_FILES);
      expect(pair.slots[0]!.path).toBe('src/hub.js');
    }
  });

  it('takes the stricter of the transaction cap and the repository policy', () => {
    const strict = { ...policy, maxChangedFiles: 1 };

    expect(repairTargetFileCap(policy)).toBe(MAX_REPAIR_TARGET_FILES);
    expect(repairTargetFileCap({ ...policy, maxChangedFiles: 8 })).toBe(MAX_REPAIR_TARGET_FILES);
    expect(repairTargetFileCap(strict)).toBe(1);
    expect(kinds(selectRepairTargetSets({
      sources: [consumer, producer], runtimeId: 'node', policy: strict,
    }))).toEqual(['single', 'single']);
  });

  it('refuses a manifest pair the repository policy protects', () => {
    const sets = selectRepairTargetSets({
      sources: [
        source('package.json', '{"dependencies":{}}\n'),
        source('pnpm-lock.yaml', "lockfileVersion: '9.0'\n"),
      ],
      runtimeId: 'node',
      policy: { ...policy, protectedPaths: [...policy.protectedPaths, 'pnpm-lock.yaml'] },
    });

    expect(kinds(sets)).toEqual(['single', 'single']);
  });
});
