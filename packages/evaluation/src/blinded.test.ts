import { describe, expect, it } from 'vitest';

import {
  assertNoForbiddenMetadata,
  blindExecutedRecord,
  BlindingError,
  FORBIDDEN_BLINDED_KEYS,
  freezeSplitByRootFamily,
  type ExecutedRecord,
  type SplitCase,
} from './blinded.js';

function record(overrides: Partial<ExecutedRecord> = {}): ExecutedRecord {
  return {
    recordId: 'repair-off-by-one-1',
    failureExcerpt: 'expected 3 to be 2',
    candidateDiff: 'diff --git a/page-count.js b/page-count.js\n',
    publicContracts: [{ contractId: 'page-count-ceiling', excerpt: '{"expected":2}' }],
    observations: [{ command: 'pnpm test', exitCode: 1, output: 'FAIL' }],
    changedPaths: ['page-count.js'],
    ...overrides,
  };
}

function families(spec: Array<[string, number]>): SplitCase[] {
  return spec.flatMap(([rootFamily, size]) =>
    Array.from({ length: size }, (_value, index) => ({
      caseId: `${rootFamily}-${String(index).padStart(2, '0')}`,
      rootFamily,
    })));
}

describe('blinded evaluation records', () => {
  it('keeps the candidate diff, which this evaluator is meant to judge', () => {
    const blinded = blindExecutedRecord(record());

    expect(blinded.candidateDiff).toContain('diff --git');
    expect(blinded.failureExcerpt).toBe('expected 3 to be 2');
    expect(blinded.publicContracts).toHaveLength(1);
  });

  it.each(FORBIDDEN_BLINDED_KEYS)('drops the answer-bearing field %s', (key) => {
    const blinded = blindExecutedRecord(record({ [key]: 'leaked' }));

    expect(Object.keys(blinded)).not.toContain(key);
    expect(JSON.stringify(blinded)).not.toContain('leaked');
  });

  it('drops label-bearing paths from the changed-path list', () => {
    const blinded = blindExecutedRecord(record({
      changedPaths: [
        'page-count.js', 'hidden/test_secret.py', 'expected-output.json',
        'truth/answers.json', 'fake-fix.diff', 'labels.csv',
      ],
    }));

    expect(blinded.changedPaths).toEqual(['page-count.js']);
  });

  it('records a source hash over the unredacted record', () => {
    const first = blindExecutedRecord(record());
    const second = blindExecutedRecord(record({ verdict: 'refused' }));

    expect(first.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(second.sourceHash).not.toBe(first.sourceHash);
    expect(second.recordId).toBe(first.recordId);
  });

  it('refuses a record with no identifier', () => {
    expect(() => blindExecutedRecord(record({ recordId: '  ' }))).toThrow(BlindingError);
  });

  it('detects a forbidden key nested anywhere in a prompt-bound structure', () => {
    expect(() => assertNoForbiddenMetadata({ a: { b: [{ verdict: 'approved' }] } }))
      .toThrow(/a\.b\[0\]\.verdict would leak the answer/u);
    expect(() => assertNoForbiddenMetadata({ safe: [1, 2, 'three'] })).not.toThrow();
  });
});

describe('frozen evaluation split', () => {
  const spec: Array<[string, number]> = [
    ['alpha', 60], ['beta', 20], ['gamma', 20],
  ];
  const counts = { development: 60, validation: 20, heldOut: 20 };

  it('assigns every case and reports the requested counts', () => {
    const frozen = freezeSplitByRootFamily(families(spec), counts);

    expect(frozen.assignments).toHaveLength(100);
    expect(frozen.counts).toEqual({ development: 60, validation: 20, 'held-out': 20 });
    expect(frozen.splitHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('never splits a root family across two splits', () => {
    const frozen = freezeSplitByRootFamily(
      families([['alpha', 30], ['beta', 30], ['gamma', 20], ['delta', 20]]), counts,
    );

    const byFamily = new Map<string, Set<string>>();
    for (const { rootFamily, split } of frozen.assignments) {
      byFamily.set(rootFamily, (byFamily.get(rootFamily) ?? new Set()).add(split));
    }
    for (const splits of byFamily.values()) expect(splits.size).toBe(1);
  });

  it('is deterministic for the same corpus regardless of input order', () => {
    const cases = families(spec);
    const forward = freezeSplitByRootFamily(cases, counts);
    const reversed = freezeSplitByRootFamily([...cases].toReversed(), counts);

    expect(reversed.splitHash).toBe(forward.splitHash);
    expect(reversed.assignments).toEqual(forward.assignments);
  });

  it('changes the split hash when the corpus changes', () => {
    const base = freezeSplitByRootFamily(families(spec), counts);
    const renamed = families(spec);
    renamed[0] = { ...renamed[0]!, caseId: 'alpha-renamed' };
    const regrouped = freezeSplitByRootFamily(
      families([['alpha', 60], ['beta', 20], ['delta', 20]]), counts,
    );

    expect(freezeSplitByRootFamily(renamed, counts).splitHash).not.toBe(base.splitHash);
    expect(regrouped.splitHash).not.toBe(base.splitHash);
  });

  it('refuses a corpus that does not match the requested split sizes', () => {
    expect(() => freezeSplitByRootFamily(families([['alpha', 99]]), counts))
      .toThrow(/expects 100 cases but received 99/u);
  });

  it('refuses duplicate case identifiers', () => {
    const duplicated = families([['alpha', 99]]);
    duplicated.push({ ...duplicated[0]! });

    expect(() => freezeSplitByRootFamily(duplicated, counts)).toThrow(/must be distinct/u);
  });

  it('refuses a family too large for any remaining split', () => {
    expect(() => freezeSplitByRootFamily(families([['alpha', 61], ['beta', 39]]), counts))
      .toThrow(/does not fit any remaining split/u);
  });
});

describe('leak sentinels', () => {
  const sentinels: Array<[string, Record<string, unknown>]> = [
    ['case kind', { kind: 'trap' }],
    ['expected outcome', { expectedOutcome: 'refused' }],
    ['final verdict', { verdict: 'approved' }],
    ['hidden verdict', { hiddenVerification: { result: 'failed' } }],
    ['adjudicator recommendation', { adjudicatorRecommendation: 'reject' }],
    ['agent provenance', { agentName: 'other-agent', agentId: 'a-1' }],
    ['label', { label: 'breaks-contract' }],
    ['split', { split: 'held-out' }],
  ];

  it.each(sentinels)('removes an injected %s from the model-facing record', (_name, injected) => {
    const blinded = blindExecutedRecord({
      recordId: 'case-a',
      failureExcerpt: 'expected 3, received 2',
      candidateDiff: '--- a/page.js\n+++ b/page.js\n@@ -1 +1 @@\n-a\n+b\n',
      publicContracts: [],
      observations: [],
      changedPaths: ['page.js'],
      ...injected,
    });

    for (const key of Object.keys(injected)) {
      expect(Object.hasOwn(blinded, key)).toBe(false);
    }
    expect(() => assertNoForbiddenMetadata(blinded)).not.toThrow();
  });

  it('rejects a sentinel nested inside an observation rather than only at the top', () => {
    expect(() => assertNoForbiddenMetadata({
      observations: [{ command: 'pnpm test', exitCode: 0, output: 'ok', hiddenTests: ['x'] }],
    })).toThrow(/leak/u);
  });

  it('drops an answer-bearing filename while keeping the joinable record id', () => {
    const blinded = blindExecutedRecord({
      recordId: 'case-a',
      failureExcerpt: 'failed',
      candidateDiff: 'diff',
      publicContracts: [],
      observations: [],
      changedPaths: ['page.js', 'hidden/answers.test.js', 'fake-fix.diff', 'expected-output.json'],
    });

    expect(blinded.changedPaths).toEqual(['page.js']);
    // The join key survives, so scoring still finds this record.
    expect(blinded.recordId).toBe('case-a');
    expect(blinded.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});

describe('split composition', () => {
  /** Ten families named a… through j…, two cases each. */
  const alphabetical = Array.from({ length: 10 }, (_unused, index) => {
    const family = String.fromCharCode(97 + index);
    return [
      { caseId: `${family}-1`, rootFamily: `family-${family}` },
      { caseId: `${family}-2`, rootFamily: `family-${family}` },
    ];
  }).flat();

  it('does not hand the last split whatever sorts last', () => {
    const frozen = freezeSplitByRootFamily(alphabetical, {
      development: 12, validation: 4, heldOut: 4,
    });
    const heldOut = frozen.assignments.filter(({ split }) => split === 'held-out');
    const lastAlphabetically = new Set(['family-i', 'family-j']);

    expect(frozen.counts).toEqual({ development: 12, validation: 4, 'held-out': 4 });
    // A fill-in-order freeze would put exactly the last two families here.
    expect(heldOut.every(({ rootFamily }) => lastAlphabetically.has(rootFamily))).toBe(false);
  });

  it('gives every split families from across the corpus, not one end of it', () => {
    const mixed = [
      ...Array.from({ length: 4 }, (_unused, index) => ({ caseId: `big-a-${index}`, rootFamily: 'big-a' })),
      ...Array.from({ length: 4 }, (_unused, index) => ({ caseId: `big-b-${index}`, rootFamily: 'big-b' })),
      ...Array.from({ length: 12 }, (_unused, index) =>
        ({ caseId: `small-${index}`, rootFamily: `small-${index}` })),
    ];
    const frozen = freezeSplitByRootFamily(mixed, { development: 12, validation: 4, heldOut: 4 });
    const families = (split: string) => new Set(frozen.assignments
      .filter((item) => item.split === split).map(({ rootFamily }) => rootFamily));

    expect(frozen.counts).toEqual({ development: 12, validation: 4, 'held-out': 4 });
    for (const split of ['development', 'validation', 'held-out'] as const) {
      expect(families(split).size).toBeGreaterThan(0);
    }
    // A large family is never divided across splits, whatever else happens.
    expect([...families('development')].filter((name) => name.startsWith('big')).length
      + [...families('validation')].filter((name) => name.startsWith('big')).length
      + [...families('held-out')].filter((name) => name.startsWith('big')).length).toBe(2);
  });

  it('stays reproducible and keeps every family whole', () => {
    const first = freezeSplitByRootFamily(alphabetical, { development: 12, validation: 4, heldOut: 4 });
    const second = freezeSplitByRootFamily([...alphabetical].reverse(), {
      development: 12, validation: 4, heldOut: 4,
    });

    expect(second.splitHash).toBe(first.splitHash);
    const byFamily = new Map<string, string>();
    for (const { rootFamily, split } of first.assignments) {
      if (byFamily.has(rootFamily)) expect(byFamily.get(rootFamily)).toBe(split);
      byFamily.set(rootFamily, split);
    }
  });
});
