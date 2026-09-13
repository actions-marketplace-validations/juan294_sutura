import { describe, expect, it } from 'vitest';

import { compareSearchNodes, searchScore } from './search-score.js';
import type { SearchNode } from './search.js';

function node(overrides: Partial<SearchNode>): SearchNode {
  return {
    id: 'node-002', parentId: 'node-001', depth: 1, imageId: 'image',
    cumulativeDiff: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n',
    errorFingerprint: 'failure', testEvidence: { commandId: 'diagnosed', imageId: 'image', exitCode: 1, output: 'failure' },
    policyEvidence: { valid: true, violations: [], changedFiles: ['a.ts'], diffBytes: 80 },
    stageEvidence: [], transcriptReference: 'branch-2', ...overrides,
  };
}

describe('deterministic search score', () => {
  it('orders pass, failure count, diff size, resources, then node id', () => {
    const passing = node({ id: 'node-004', testEvidence: { commandId: 'diagnosed', imageId: 'image', exitCode: 0, output: '' }, errorFingerprint: '' });
    const fewerFailures = node({ id: 'node-003', testEvidence: { commandId: 'diagnosed', imageId: 'image', exitCode: 1, output: 'one\ntwo' } });
    const smaller = node({ id: 'node-002', cumulativeDiff: '+x\n', policyEvidence: { valid: true, violations: [], changedFiles: ['a.ts'], diffBytes: 3 } });
    const tie = node({ id: 'node-001', cumulativeDiff: '+x\n', policyEvidence: { valid: true, violations: [], changedFiles: ['a.ts'], diffBytes: 3 } });
    const unpatched = node({
      id: 'node-000', cumulativeDiff: '',
      policyEvidence: { valid: true, violations: [], changedFiles: [], diffBytes: 0 },
    });
    const denied = node({
      id: 'node-005',
      policyEvidence: { valid: false, violations: ['protected'], changedFiles: ['a.ts'], diffBytes: 80 },
    });
    expect([unpatched, denied, fewerFailures, passing, smaller, tie].sort(compareSearchNodes).map(({ id }) => id)).toEqual([
      'node-004', 'node-001', 'node-002', 'node-003', 'node-000', 'node-005',
    ]);
    expect(searchScore(passing).passing).toBe(0);
    expect(searchScore(unpatched).unpatched).toBe(1);
    expect(searchScore(node({})).unpatched).toBe(0);
  });

  it('prunes invalid or policy-denied nodes before scoring', () => {
    const denied = node({ policyEvidence: { valid: false, violations: ['protected'], changedFiles: ['a.ts'], diffBytes: 80 } });
    expect(searchScore(denied).pruned).toBe(1);
    expect(compareSearchNodes(node({}), denied)).toBeLessThan(0);
  });
});
