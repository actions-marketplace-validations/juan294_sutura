import { createHash } from 'node:crypto';

import {
  freezeSplitByRootFamily,
  type EvaluationSplit,
  type SplitCase,
  type SplitCounts,
} from './blinded.js';

export const INVENTORY_SCHEMA_VERSION = 'sutura-evaluation-inventory-v1' as const;

/** The split the plan freezes before any live evaluation. */
export const INVENTORY_TARGET_COUNTS: SplitCounts = Object.freeze({
  development: 60,
  validation: 20,
  heldOut: 20,
});

export const INVENTORY_TARGET_TOTAL =
  INVENTORY_TARGET_COUNTS.development +
  INVENTORY_TARGET_COUNTS.validation +
  INVENTORY_TARGET_COUNTS.heldOut;

export interface InventoryCase extends SplitCase {
  /** Exact content hash of the case directory, so a changed fixture is visible. */
  contentHash: string;
}

export interface EvaluationInventory {
  schemaVersion: typeof INVENTORY_SCHEMA_VERSION;
  corpusRevision: string;
  counts: Record<EvaluationSplit, number>;
  splitHash: string;
  /** Identifies the exact case contents the split was frozen over. */
  inventoryHash: string;
  cases: Array<{
    caseId: string;
    rootFamily: string;
    split: EvaluationSplit;
    contentHash: string;
  }>;
}

export interface InventoryShortfall {
  status: 'incomplete';
  required: number;
  available: number;
  missing: number;
  /** Families already present, so an author can see what is not yet covered. */
  families: string[];
  reason: string;
}

export type InventoryResult =
  | ({ status: 'frozen' } & EvaluationInventory)
  | InventoryShortfall;

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Freezes the evaluation inventory, or reports exactly how far short the corpus
 * falls.
 *
 * A short corpus is a shortfall, never a smaller split. Quietly freezing 63
 * cases as if they were the planned 100 would make every later held-out number
 * describe a different experiment from the one that was registered, so this
 * refuses and says what is missing instead.
 */
export function buildEvaluationInventory(input: {
  cases: readonly InventoryCase[];
  corpusRevision: string;
  counts?: SplitCounts;
}): InventoryResult {
  const counts = input.counts ?? INVENTORY_TARGET_COUNTS;
  const required = counts.development + counts.validation + counts.heldOut;
  const families = [...new Set(input.cases.map(({ rootFamily }) => rootFamily))].toSorted();

  if (input.cases.length !== required) {
    return {
      status: 'incomplete',
      required,
      available: input.cases.length,
      missing: Math.max(0, required - input.cases.length),
      families,
      reason: input.cases.length < required
        ? `The inventory needs ${required} unique cases and the corpus supplies ${input.cases.length}`
        : `The inventory takes exactly ${required} cases and the corpus supplies ${input.cases.length}`,
    };
  }

  const frozen = freezeSplitByRootFamily(
    input.cases.map(({ caseId, rootFamily }) => ({ caseId, rootFamily })),
    counts,
  );
  const contentByCase = new Map(input.cases.map(({ caseId, contentHash }) => [caseId, contentHash]));
  const cases = frozen.assignments.map(({ caseId, rootFamily, split }) => ({
    caseId,
    rootFamily,
    split,
    contentHash: contentByCase.get(caseId)!,
  }));
  return {
    status: 'frozen',
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    corpusRevision: input.corpusRevision,
    counts: frozen.counts,
    splitHash: frozen.splitHash,
    inventoryHash: digest(JSON.stringify({
      corpusRevision: input.corpusRevision,
      splitHash: frozen.splitHash,
      cases,
    })),
    cases,
  };
}
