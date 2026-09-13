import { describe, expect, it } from 'vitest';

import {
  buildEvaluationInventory,
  INVENTORY_TARGET_COUNTS,
  INVENTORY_TARGET_TOTAL,
  type InventoryCase,
} from './inventory.js';

function cases(spec: Array<[string, number]>): InventoryCase[] {
  return spec.flatMap(([rootFamily, size]) =>
    Array.from({ length: size }, (_value, index) => {
      const caseId = `${rootFamily}-${String(index).padStart(2, '0')}`;
      return { caseId, rootFamily, contentHash: `${caseId}-hash` };
    }));
}

const full = cases([['alpha', 60], ['beta', 20], ['gamma', 20]]);

describe('evaluation inventory', () => {
  it('freezes exactly the planned split', () => {
    const result = buildEvaluationInventory({ cases: full, corpusRevision: '0.2' });

    expect(result.status).toBe('frozen');
    if (result.status !== 'frozen') return;
    expect(result.counts).toEqual({ development: 60, validation: 20, 'held-out': 20 });
    expect(result.cases).toHaveLength(INVENTORY_TARGET_TOTAL);
    expect(result.splitHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.inventoryHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('reports a shortfall rather than freezing a smaller split', () => {
    const result = buildEvaluationInventory({
      cases: cases([['alpha', 40], ['beta', 23]]), corpusRevision: '0.2',
    });

    expect(result.status).toBe('incomplete');
    if (result.status !== 'incomplete') return;
    expect(result.required).toBe(100);
    expect(result.available).toBe(63);
    expect(result.missing).toBe(37);
    expect(result.families).toEqual(['alpha', 'beta']);
    expect(result.reason).toContain('needs 100 unique cases');
  });

  it('refuses an oversized corpus rather than silently sampling it', () => {
    const result = buildEvaluationInventory({
      cases: cases([['alpha', 60], ['beta', 20], ['gamma', 20], ['delta', 20]]),
      corpusRevision: '0.2',
    });

    expect(result.status).toBe('incomplete');
    if (result.status !== 'incomplete') return;
    expect(result.available).toBe(120);
    expect(result.missing).toBe(0);
    expect(result.reason).toContain('takes exactly 100');
  });

  it('keeps a root family inside one split', () => {
    const result = buildEvaluationInventory({
      cases: cases([['alpha', 30], ['beta', 30], ['gamma', 20], ['delta', 20]]),
      corpusRevision: '0.2',
    });

    expect(result.status).toBe('frozen');
    if (result.status !== 'frozen') return;
    const byFamily = new Map<string, Set<string>>();
    for (const { rootFamily, split } of result.cases) {
      byFamily.set(rootFamily, (byFamily.get(rootFamily) ?? new Set()).add(split));
    }
    for (const splits of byFamily.values()) expect(splits.size).toBe(1);
  });

  it('changes the inventory hash when a fixture changes but the split does not', () => {
    const base = buildEvaluationInventory({ cases: full, corpusRevision: '0.2' });
    const edited = buildEvaluationInventory({
      cases: full.map((item, index) =>
        (index === 0 ? { ...item, contentHash: 'edited' } : item)),
      corpusRevision: '0.2',
    });

    expect(base.status === 'frozen' && edited.status === 'frozen').toBe(true);
    if (base.status !== 'frozen' || edited.status !== 'frozen') return;
    expect(edited.splitHash).toBe(base.splitHash);
    expect(edited.inventoryHash).not.toBe(base.inventoryHash);
  });

  it('changes the inventory hash when the corpus revision changes', () => {
    const first = buildEvaluationInventory({ cases: full, corpusRevision: '0.2' });
    const second = buildEvaluationInventory({ cases: full, corpusRevision: '0.3' });

    expect(first.status === 'frozen' && second.status === 'frozen').toBe(true);
    if (first.status !== 'frozen' || second.status !== 'frozen') return;
    expect(second.inventoryHash).not.toBe(first.inventoryHash);
  });

  it('is reproducible for the same corpus in any order', () => {
    const forward = buildEvaluationInventory({ cases: full, corpusRevision: '0.2' });
    const reversed = buildEvaluationInventory({
      cases: [...full].toReversed(), corpusRevision: '0.2',
    });

    expect(reversed).toEqual(forward);
  });

  it('declares the planned counts', () => {
    expect(INVENTORY_TARGET_COUNTS).toEqual({ development: 60, validation: 20, heldOut: 20 });
    expect(INVENTORY_TARGET_TOTAL).toBe(100);
  });
});
