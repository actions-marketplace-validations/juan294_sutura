import { describe, expect, it, vi } from 'vitest';

import { adaptiveSearch, type SearchExpansion } from './search.js';

function expansion(diff: string, exitCode: number, error = 'still failing'): SearchExpansion {
  return {
    imageId: `image-${diff}`, cumulativeDiff: diff,
    testEvidence: { commandId: 'diagnosed', imageId: `image-${diff}`, exitCode, output: error },
    policyEvidence: { valid: true, violations: [], changedFiles: ['a.ts'], diffBytes: diff.length },
    stageEvidence: [], transcriptReference: `trace-${diff}`,
    ...(exitCode === 0 ? { candidate: { id: diff, rationale: 'passes', diff } } : {}),
  };
}

function completionLimitExpansion(): SearchExpansion {
  return {
    ...expansion('', 1, 'completion-limit: Repair proposal reached the provider completion-token limit'),
    policyEvidence: { valid: true, violations: [], changedFiles: [], diffBytes: 0 },
    terminalReason: 'completion-limit',
  };
}

describe('adaptiveSearch', () => {
  it('uses stable lineage and deterministically expands the best beam', async () => {
    const expand = vi.fn(async ({ depth, branch }: { depth: number; branch: number }) =>
      expansion(`diff-${depth}-${branch}`, depth === 2 && branch === 1 ? 0 : 1, `failure-${branch}`),
    );
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 3, beamWidth: 1, maximumDepth: 2,
      maximumTotalBranches: 5, availableBranches: () => 10, expand,
    });
    expect(result.nodes.map(({ id, parentId }) => [id, parentId])).toEqual([
      ['search-001', undefined], ['search-002', undefined], ['search-003', undefined],
      ['search-004', 'search-001'],
    ]);
    expect(result.candidates.map(({ id }) => id)).toEqual(['search-004']);
  });

  it('prunes repeated diff/error states and respects operation and branch capacity', async () => {
    const expand = vi.fn(async () => expansion('same-diff', 1, 'same failure'));
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 4, beamWidth: 2, maximumDepth: 4,
      maximumTotalBranches: 12, availableBranches: () => 2, expand,
    });
    expect(expand).toHaveBeenCalledTimes(3);
    expect(result.nodes.filter(({ terminalReason }) => terminalReason === 'repeated-state')).toHaveLength(2);
    expect(result.terminalReason).toBe('frontier-exhausted');
  });

  it('keeps patched failures in the beam ahead of a branch that produced no patch', async () => {
    const expand = vi.fn(async ({ depth, branch, parent }: {
      depth: number;
      branch: number;
      parent: { id: string } | undefined;
    }) => {
      if (depth !== 1) return expansion(`depth-2-${parent?.id}`, 1, `depth-2-${parent?.id}`);
      if (branch !== 3) return expansion(`diff-${branch}`, 1, `e${branch}`);
      return {
        ...expansion('', 1, 'invalid: Repair proposal must be valid JSON'),
        policyEvidence: { valid: true, violations: [], changedFiles: [], diffBytes: 0 },
        terminalReason: 'failed' as const,
      };
    });
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 4, beamWidth: 2, maximumDepth: 2,
      maximumTotalBranches: 12, availableBranches: () => 12, expand,
    });
    const depthTwoNodes = result.nodes.filter(({ depth }) => depth === 2);
    const patchedParentIds = new Set(['search-001', 'search-002', 'search-004']);
    expect(depthTwoNodes).toHaveLength(2);
    expect(depthTwoNodes.every(({ parentId }) => parentId !== undefined && patchedParentIds.has(parentId))).toBe(true);
    expect(depthTwoNodes.map(({ parentId }) => parentId)).not.toContain('search-003');
  });

  it('still prunes repeated generic failed states', async () => {
    const expand = vi.fn(async () => ({
      ...expansion('same-failed-diff', 1, 'same failed output'),
      terminalReason: 'failed' as const,
    }));
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 2, beamWidth: 1, maximumDepth: 2,
      maximumTotalBranches: 3, availableBranches: () => 3, expand,
    });
    expect(expand).toHaveBeenCalledTimes(3);
    expect(result.nodes.map(({ terminalReason }) => terminalReason)).toEqual([
      'failed', 'repeated-state', 'repeated-state',
    ]);
  });

  it('does not expand policy failures', async () => {
    const expand = vi.fn(async () => ({
      ...expansion('denied', 1),
      policyEvidence: { valid: false, violations: ['protected'], changedFiles: ['a.ts'], diffBytes: 6 },
    }));
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 1, beamWidth: 1, maximumDepth: 4,
      maximumTotalBranches: 12, availableBranches: () => 10, expand,
    });
    expect(expand).toHaveBeenCalledTimes(1);
    expect(result.nodes[0]?.terminalReason).toBe('policy');
  });

  it('reauthorizes every expansion from the current capacity snapshot', async () => {
    let available = 2;
    const expand = vi.fn(async () => {
      available = 0;
      return expansion('first', 1);
    });
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 2, beamWidth: 1, maximumDepth: 2,
      maximumTotalBranches: 4, availableBranches: () => available,
      concurrencyCapacity: () => 1, expand,
    });
    expect(expand).toHaveBeenCalledOnce();
    expect(result.terminalReason).toBe('operation-capacity');
  });

  it('shrinks the next batch when current capacity drops below concurrency', async () => {
    let available = 4;
    const expand = vi.fn(async ({ branch }: { branch: number }) => {
      if (branch === 2) available = 1;
      if (branch === 3) available = 0;
      return expansion(`branch-${branch}`, 1, `failure-${branch}`);
    });
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 4, beamWidth: 1, maximumDepth: 1,
      maximumTotalBranches: 4, availableBranches: () => available,
      concurrencyCapacity: () => 2, expand,
    });
    expect(expand.mock.calls.map(([{ branch }]) => branch)).toEqual([1, 2, 3]);
    expect(result.nodes).toHaveLength(3);
  });

  it('schedules every authorized parent in bounded concurrency batches', async () => {
    const expand = vi.fn(async ({ nodeId }: { nodeId: string }) => expansion(nodeId, 1));
    await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 4, beamWidth: 2, maximumDepth: 1,
      maximumTotalBranches: 4, availableBranches: () => 4,
      concurrencyCapacity: () => 2, expand,
    });
    expect(expand).toHaveBeenCalledTimes(4);
  });

  it('cancels unfinished siblings and preserves their terminal node', async () => {
    const cancel = vi.fn(async (nodeId: string) => { void nodeId; });
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 2, beamWidth: 2, maximumDepth: 1,
      maximumTotalBranches: 2, availableBranches: () => 2,
      concurrencyCapacity: () => 2, cancel,
      expand: async ({ branch, signal }) => {
        if (branch === 1) return expansion('winner', 0);
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        return { ...expansion('cancelled', 1), terminalReason: 'cancelled' };
      },
    });
    expect(cancel).toHaveBeenCalledWith('search-002');
    expect(result.candidates.map(({ id }) => id)).toEqual(['search-001']);
    expect(result.nodes[1]?.terminalReason).toBe('cancelled');
  });

  it('continues past one completion limit while applied proposals outnumber it', async () => {
    const cancel = vi.fn(async (nodeId: string) => { void nodeId; });
    let releaseDepthOne!: () => void;
    let markCompletionSettled!: () => void;
    const depthOnePending = new Promise<void>((resolve) => { releaseDepthOne = resolve; });
    const completionSettled = new Promise<void>((resolve) => { markCompletionSettled = resolve; });
    const pendingSignals: AbortSignal[] = [];
    const expand = vi.fn(async ({ depth, branch, parent, signal }: {
      depth: number;
      branch: number;
      parent: { id: string } | undefined;
      signal: AbortSignal;
    }) => {
      if (depth !== 1) return expansion(`depth-2-${parent?.id}`, 1, `depth-2-${parent?.id}`);
      if (branch === 3) {
        markCompletionSettled();
        return completionLimitExpansion();
      }
      pendingSignals.push(signal);
      await depthOnePending;
      return expansion(`diff-${branch}`, 1, `e${branch}`);
    });
    const resultPromise = adaptiveSearch({
      baselineImageId: 'base', initialBranches: 4, beamWidth: 2, maximumDepth: 2,
      maximumTotalBranches: 8, availableBranches: () => 8,
      concurrencyCapacity: () => 4, cancel, expand,
    });
    await completionSettled;
    await Promise.resolve();
    expect(cancel).not.toHaveBeenCalled();
    expect(pendingSignals).toHaveLength(3);
    expect(pendingSignals.every(({ aborted }) => !aborted)).toBe(true);
    releaseDepthOne();
    const result = await resultPromise;
    expect(cancel).not.toHaveBeenCalled();
    expect(pendingSignals.every(({ aborted }) => !aborted)).toBe(true);
    expect(expand).toHaveBeenCalledTimes(6);
    expect(result.nodes.filter(({ depth, policyEvidence }) =>
      depth === 1 && policyEvidence.changedFiles.length > 0,
    ).map(({ id, terminalReason }) => [id, terminalReason])).toEqual([
      ['search-001', undefined], ['search-002', undefined], ['search-004', undefined],
    ]);
    const depthTwoNodes = result.nodes.filter(({ depth }) => depth === 2);
    const patchedParentIds = new Set(['search-001', 'search-002', 'search-004']);
    expect(depthTwoNodes).toHaveLength(2);
    expect(depthTwoNodes.every(({ parentId }) => parentId !== undefined && patchedParentIds.has(parentId))).toBe(true);
    expect(result.terminalReason).toBe('frontier-exhausted');
    expect(result.nodes[2]?.terminalReason).toBe('completion-limit');
  });

  it('stops the run when completion limits outnumber applied proposals', async () => {
    const expand = vi.fn(async () => completionLimitExpansion());
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 2, beamWidth: 2, maximumDepth: 3,
      maximumTotalBranches: 6, availableBranches: () => 6,
      concurrencyCapacity: () => 2, expand,
    });
    expect(expand).toHaveBeenCalledTimes(2);
    expect(result.terminalReason).toBe('completion-limit');
    expect(result.nodes.every(({ terminalReason }) => terminalReason === 'completion-limit')).toBe(true);
  });

  it('one completion limit in a batch of one stops the run', async () => {
    const expand = vi.fn(async () => completionLimitExpansion());
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 4, beamWidth: 2, maximumDepth: 4,
      maximumTotalBranches: 12, availableBranches: () => 4,
      concurrencyCapacity: () => 1, expand,
    });
    expect(expand).toHaveBeenCalledOnce();
    expect(result.terminalReason).toBe('completion-limit');
  });

  it('never expands a completion-limit node', async () => {
    const expand = vi.fn(async ({ depth, branch, parent }: {
      depth: number;
      branch: number;
      parent: { id: string } | undefined;
    }) => {
      if (depth !== 1) return expansion(`depth-2-${parent?.id}`, 1, 'depth-2');
      if (branch === 1) return expansion('diff-1', 1, 'e1');
      return completionLimitExpansion();
    });
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 2, beamWidth: 2, maximumDepth: 2,
      maximumTotalBranches: 6, availableBranches: () => 6,
      concurrencyCapacity: () => 2, expand,
    });
    expect(expand).toHaveBeenCalledTimes(3);
    const depthTwoNodes = result.nodes.filter(({ depth }) => depth === 2);
    expect(depthTwoNodes).toHaveLength(1);
    expect(depthTwoNodes[0]?.parentId).toBe('search-001');
  });

  it('keeps a passing candidate when its batch also reaches a completion limit', async () => {
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 2, beamWidth: 2, maximumDepth: 2,
      maximumTotalBranches: 4, availableBranches: () => 2,
      concurrencyCapacity: () => 2, cancel: async () => undefined,
      expand: async ({ branch }) => branch === 1
        ? { ...expansion('limited', 1), terminalReason: 'completion-limit' }
        : expansion('winner', 0),
    });
    expect(result.terminalReason).toBe('candidate-found');
    expect(result.candidates.map(({ id }) => id)).toEqual(['search-002']);
    expect(result.nodes.map(({ terminalReason }) => terminalReason)).toEqual([
      'completion-limit', 'passed',
    ]);
  });

  it('collects all passing children that complete in the same expansion batch', async () => {
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 2, beamWidth: 2, maximumDepth: 1,
      maximumTotalBranches: 2, availableBranches: () => 2,
      concurrencyCapacity: () => 2, cancel: async () => undefined,
      expand: async ({ branch }) => expansion(`winner-${branch}`, 0),
    });
    expect(result.candidates.map(({ id }) => id)).toEqual(['search-001', 'search-002']);
  });
});

describe('verified admission', () => {
  const options = (
    admit?: (input: { nodeId: string; expansion: SearchExpansion }) =>
      Promise<{ accepted: boolean; reason?: string }>,
  ) => ({
    baselineImageId: 'base' as never,
    initialBranches: 3,
    maximumDepth: 1,
    availableBranches: () => 3,
    concurrencyCapacity: () => 3,
    ...(admit === undefined ? {} : { admit }),
  });

  /** Branch 1 is green but wrong; branch 2 is green and correct. */
  const expandTwo = (results: readonly string[]) =>
    async ({ branch }: { branch: number }) => expansion(results[branch - 1] ?? 'x', 0);

  it('admits a green branch on the visible suite when no verifier is supplied', async () => {
    const result = await adaptiveSearch({
      ...options(), expand: expandTwo(['floor-only', 'ceil', 'third']),
    });

    expect(result.terminalReason).toBe('candidate-found');
    expect(result.candidates).not.toHaveLength(0);
  });

  it('does not cancel siblings at the first visible green', async () => {
    const cancel = vi.fn(async () => {});
    const result = await adaptiveSearch({
      ...options(async ({ expansion: item }) =>
        ({ accepted: item.cumulativeDiff === 'ceil', reason: 'challenge refused the patch' })),
      cancel,
      expand: expandTwo(['floor-only', 'ceil', 'third']),
    });

    const refused = result.nodes.find(({ cumulativeDiff }) => cumulativeDiff === 'floor-only');
    expect(refused?.terminalReason).toBe('verification-refused');
    expect(refused?.verificationReason).toBe('challenge refused the patch');
    expect(result.candidates.map(({ cumulativeDiff }) => cumulativeDiff)).toEqual(['ceil']);
    expect(result.terminalReason).toBe('candidate-found');
  });

  it('keeps a refused provisional patch out of the accepted candidates', async () => {
    const result = await adaptiveSearch({
      ...options(async () => ({ accepted: false, reason: 'no qualified challenge' })),
      expand: expandTwo(['floor-only', 'also-wrong', 'third']),
    });

    expect(result.candidates).toEqual([]);
    expect(result.terminalReason).not.toBe('candidate-found');
    for (const node of result.nodes) {
      expect(node.terminalReason).toBe('verification-refused');
      expect(node.verificationReason).toBe('no qualified challenge');
    }
  });

  it('never verifies a branch whose visible suite did not pass', async () => {
    const admit = vi.fn(async () => ({ accepted: true }));
    await adaptiveSearch({
      ...options(admit), expand: async () => expansion('red', 1),
    });

    expect(admit).not.toHaveBeenCalled();
  });

  it('never verifies a branch the repository policy already refused', async () => {
    const admit = vi.fn(async () => ({ accepted: true }));
    await adaptiveSearch({
      ...options(admit),
      expand: async () => ({
        ...expansion('green', 0),
        policyEvidence: { valid: false, violations: ['denied'], changedFiles: ['a.ts'], diffBytes: 5 },
      }),
    });

    expect(admit).not.toHaveBeenCalled();
  });
});
