/**
 * Freezes the evaluation inventory against the real Placebo corpus.
 *
 * The inventory is what every later held-out number refers to, so it is built
 * from the corpus on disk rather than from a list kept beside it. A corpus that
 * does not supply exactly the registered number of cases is reported as a
 * shortfall and nothing is frozen: freezing a smaller split as if it were the
 * registered one would make each later measurement describe a different
 * experiment from the one that was pre-registered.
 *
 *   node packages/evaluation/scripts/inventory.mjs [--out <file>]
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createCorpusManifest, discoverBenchmarkCases } from 'placebo';
import { buildEvaluationInventory } from '@sutura/evaluation';

export async function corpusInventoryCases() {
  const cases = await discoverBenchmarkCases(undefined, { includeVersionedCases: true });
  const manifest = await createCorpusManifest(cases);
  const contentByCase = new Map(manifest.cases.map(({ id, contentHash }) => [id, contentHash]));
  return manifest.cases.map(({ id, metadata }) => ({
    caseId: id,
    // A case without declared lineage is its own root family.
    rootFamily: metadata.lineage?.family ?? id,
    contentHash: contentByCase.get(id),
  }));
}

export async function buildCorpusInventory() {
  const cases = await corpusInventoryCases();
  return buildEvaluationInventory({ cases, corpusRevision: '0.2' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv.indexOf('--out');
  const inventory = await buildCorpusInventory();
  const text = `${JSON.stringify(inventory, null, 2)}\n`;
  if (out !== -1 && process.argv[out + 1]) await writeFile(process.argv[out + 1], text);
  if (inventory.status === 'frozen') {
    process.stdout.write(`frozen ${inventory.cases.length} cases \u00b7 split ${inventory.splitHash.slice(0, 12)} \u00b7 inventory ${inventory.inventoryHash.slice(0, 12)}\n`);
    for (const [split, count] of Object.entries(inventory.counts)) {
      process.stdout.write(`  ${split}: ${count}\n`);
    }
  } else {
    process.stdout.write(`${inventory.status}: ${inventory.reason}\n`);
    process.stdout.write(`  families: ${inventory.families.length}\n`);
    process.exitCode = 1;
  }
}
