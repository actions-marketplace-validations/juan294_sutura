/**
 * The inventory script against the real corpus.
 *
 * This is what makes the published split reproducible: the same corpus must
 * freeze the same split and the same hashes, and a corpus that does not supply
 * exactly the registered case count must freeze nothing at all.
 */
import { expect, test } from 'vitest';

import { buildEvaluationInventory } from '@sutura/evaluation';

import { buildCorpusInventory, corpusInventoryCases } from './inventory.mjs';

const expectEqual = (actual, expected, message) => { expect(actual, message).toBe(expected); };
const expectDeepEqual = (actual, expected, message) => { expect(actual, message).toEqual(expected); };
const expectNotEqual = (actual, expected, message) => { expect(actual, message).not.toBe(expected); };
const expectMatch = (actual, pattern, message) => { expect(actual, message).toMatch(pattern); };
const expectOk = (actual, message) => { expect(actual, message).toBeTruthy(); };


test('the corpus supplies exactly the registered inventory', async () => {
  const cases = await corpusInventoryCases();

  expectEqual(cases.length, 100);
  expectEqual(new Set(cases.map(({ caseId }) => caseId)).size, 100);
  for (const item of cases) {
    expectMatch(item.contentHash, /^[a-f0-9]{64}$/u);
    expectOk(item.rootFamily.length > 0, `${item.caseId} has no root family`);
  }
});

test('the split freezes reproducibly and keeps a family in one split', async () => {
  const first = await buildCorpusInventory();
  const second = await buildCorpusInventory();

  expectEqual(first.status, 'frozen');
  expectEqual(first.splitHash, second.splitHash);
  expectEqual(first.inventoryHash, second.inventoryHash);
  expectDeepEqual(first.counts, { development: 60, validation: 20, 'held-out': 20 });

  const splitByFamily = new Map();
  for (const { rootFamily, split } of first.cases) {
    if (splitByFamily.has(rootFamily)) {
      expectEqual(splitByFamily.get(rootFamily), split, `${rootFamily} spans two splits`);
    }
    splitByFamily.set(rootFamily, split);
  }
});

test('a short corpus freezes nothing rather than a smaller split', async () => {
  const cases = (await corpusInventoryCases()).slice(0, 99);
  const result = buildEvaluationInventory({ cases, corpusRevision: '0.2' });

  expectEqual(result.status, 'incomplete');
  expectEqual(result.missing, 1);
  expectEqual(result.splitHash, undefined);
});

test('a changed fixture changes the inventory hash', async () => {
  const cases = await corpusInventoryCases();
  const edited = cases.map((item, index) =>
    (index === 0 ? { ...item, contentHash: 'f'.repeat(64) } : item));

  expectNotEqual(
    buildEvaluationInventory({ cases: edited, corpusRevision: '0.2' }).inventoryHash,
    buildEvaluationInventory({ cases, corpusRevision: '0.2' }).inventoryHash,
  );
});
