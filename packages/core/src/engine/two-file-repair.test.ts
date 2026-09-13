import { describe, expect, it } from 'vitest';

import { createDefaultRepositoryPolicy } from '../policy/load.js';
import type { Diagnosis } from '../domain.js';
import { prepareControlledRepairProposalTemplate } from './repair-attempt.js';
import type { RepairSourceContext } from './repair.js';

const policy = createDefaultRepositoryPolicy();
const diagnosis: Diagnosis = {
  class: 'test-assertion',
  confidence: 1,
  signals: [],
  failingCmd: 'pnpm test',
  errorExcerpt: 'total is not a function',
};

const consumerBody = "import { total } from './totals.js';\nexport const run = () => total(1);\n";
const producerBody = 'export const total = (value) => value + 1;\n';

function context(sources: RepairSourceContext['sources']): RepairSourceContext {
  return { sources };
}

const pairSources = context([
  { path: 'src/consumer.js', startLine: 1, content: consumerBody, truncated: false },
  { path: 'src/totals.js', startLine: 1, content: producerBody, truncated: false },
]);

function template(sourceContext = pairSources, runtimeId: 'node' | 'python' = 'node') {
  return prepareControlledRepairProposalTemplate({ diagnosis, policy, sourceContext, runtimeId });
}

function pairContract() {
  const prepared = template();
  for (let index = 0; index < prepared.targetCount; index += 1) {
    const contract = prepared.contract(undefined, index);
    if (contract.slots.length === 2) return contract;
  }
  throw new Error('expected a two-slot contract');
}

function reply(entries: Array<{ slot: string; replacement: string }>): string {
  return JSON.stringify({ replacements: entries });
}

describe('two-file repair transactions', () => {
  it('offers a two-slot contract that names slots, never paths or ranges', () => {
    const contract = pairContract();

    expect(contract.kind).toBe('related-source');
    expect(contract.slots.map(({ slotId }) => slotId)).toEqual(['slot-1', 'slot-2']);
    expect(contract.generatedPaths).toEqual([]);
    const schema = contract.schema as {
      properties: { replacements: { items: { properties: { slot: { enum: string[] } } } } };
    };
    expect(schema.properties.replacements.items.properties.slot.enum)
      .toEqual(['slot-1', 'slot-2']);
    const system = String(contract.messages[0]!.content);
    expect(system).toContain('cannot add, drop or repeat a slot');
    const user = JSON.parse(String(contract.messages[1]!.content)) as {
      selectedSlots: Array<{ slotId: string; path: string }>;
      slotRelationship: { specifier: string };
    };
    expect(user.selectedSlots.map(({ slotId }) => slotId)).toEqual(['slot-1', 'slot-2']);
    expect(user.slotRelationship.specifier).toBe('./totals.js');
  });

  it('keeps the single-target contract for an unpaired source', () => {
    const single = template(context([
      { path: 'src/only.js', startLine: 1, content: 'export const only = 1;\n', truncated: false },
    ])).contract(undefined, 0);

    expect(single.kind).toBe('single');
    expect(single.slots).toHaveLength(1);
    expect(JSON.parse(String(single.messages[1]!.content))).toHaveProperty('selectedTarget');
    expect((single.schema as { properties: Record<string, unknown> }).properties)
      .toHaveProperty('replacement');
  });

  it('builds one diff covering both slots', async () => {
    const { anchoredEditsDiff } = await import('./repair.js');
    const contract = pairContract();
    const diff = anchoredEditsDiff(contract.slots.map((slot) => ({
      path: slot.path,
      startLine: slot.startLine,
      endLine: slot.endLine,
      new: slot.path.endsWith('consumer.js')
        ? "import { total } from './totals.js';\nexport const run = () => total(1, 0);\n"
        : 'export const total = (value, base) => value + base + 1;\n',
    })), pairSources);

    expect(diff).toContain('diff --git a/src/consumer.js b/src/consumer.js');
    expect(diff).toContain('diff --git a/src/totals.js b/src/totals.js');
  });

  it.each([
    ['drops a slot', reply([{ slot: 'slot-1', replacement: 'export const a = 1;\n' }])],
    ['repeats a slot', reply([
      { slot: 'slot-1', replacement: 'export const a = 1;\n' },
      { slot: 'slot-1', replacement: 'export const b = 2;\n' },
    ])],
    ['names an unknown slot', reply([
      { slot: 'slot-1', replacement: 'export const a = 1;\n' },
      { slot: 'slot-9', replacement: 'export const b = 2;\n' },
    ])],
    ['adds a third slot', reply([
      { slot: 'slot-1', replacement: 'export const a = 1;\n' },
      { slot: 'slot-2', replacement: 'export const b = 2;\n' },
      { slot: 'slot-2', replacement: 'export const c = 3;\n' },
    ])],
    ['uses the single-target shape', JSON.stringify({ replacement: 'export const a = 1;\n' })],
    ['adds a field to a replacement', JSON.stringify({
      replacements: [
        { slot: 'slot-1', replacement: 'a', path: 'src/consumer.js' },
        { slot: 'slot-2', replacement: 'b' },
      ],
    })],
  ])('refuses a reply that %s', async (_name, text) => {
    const contract = pairContract();
    const { parseControlledRepairProposalForTest } = await import('./repair-attempt.js');

    expect(() => parseControlledRepairProposalForTest(text, contract.slots)).toThrow();
  });

  it('accepts exactly one replacement per slot in slot order', async () => {
    const contract = pairContract();
    const { parseControlledRepairProposalForTest } = await import('./repair-attempt.js');

    const parsed = parseControlledRepairProposalForTest(reply([
      { slot: 'slot-2', replacement: 'second' },
      { slot: 'slot-1', replacement: 'first' },
    ]), contract.slots);

    expect(parsed).toEqual([
      { slotId: 'slot-1', replacement: 'first' },
      { slotId: 'slot-2', replacement: 'second' },
    ]);
  });

  it('offers no pair when the repository policy caps changed files at one', () => {
    const capped = prepareControlledRepairProposalTemplate({
      diagnosis, policy: { ...policy, maxChangedFiles: 1 }, sourceContext: pairSources, runtimeId: 'node',
    });

    for (let index = 0; index < capped.targetCount; index += 1) {
      expect(capped.contract(undefined, index).slots).toHaveLength(1);
    }
  });

  it('refuses a target index outside the bounded target sets', () => {
    const prepared = template();

    expect(() => prepared.contract(undefined, prepared.targetCount)).toThrow(/outside the bounded/u);
    expect(() => prepared.contract(undefined, -1)).toThrow(/outside the bounded/u);
  });
});
