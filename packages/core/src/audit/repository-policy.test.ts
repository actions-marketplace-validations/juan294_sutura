import { describe, expect, it } from 'vitest';

import type { AuditVerdict, RaceResult } from '../domain.js';
import { InMemoryExecutor } from '../executor/memory.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import {
  enforceRepositoryPolicy,
  type RepositoryPolicyGateObservation,
} from './repository-policy.js';

const APPROVED: AuditVerdict = {
  approved: true,
  checks: [{ name: 'deleted-test', passed: true }],
  reasoning: 'APPROVED: the patch repairs the diagnosed cause.',
};

const WINNER: RaceResult = {
  candidate: { id: 'candidate-1', rationale: 'repair', diff: 'diff' },
  imageId: 'candidate-image',
  nodeId: 'node-001',
  exitCode: 0,
  held: true,
};

function harness(script: (cmd: string, parent: string) => { exitCode: number; maxRssKb?: number }) {
  const observed: RepositoryPolicyGateObservation[] = [];
  const executor = new InMemoryExecutor((cmd, parent) => {
    const { exitCode, maxRssKb } = script(cmd, parent);
    return {
      exitCode,
      stdout: '',
      stderr: '',
      truncated: false,
      metrics: { elapsedTimeSec: 1, ...(maxRssKb === undefined ? {} : { maxRssKb }) },
    };
  });
  return {
    executor,
    observed,
    observe: (observation: RepositoryPolicyGateObservation) => { observed.push(observation); },
  };
}

describe('repository policy gate', () => {
  it('leaves a refused verdict untouched and runs no command', async () => {
    const { executor, observe } = harness(() => ({ exitCode: 0 }));
    const refused: AuditVerdict = { approved: false, checks: [], reasoning: 'REFUSED: nope' };

    const verdict = await enforceRepositoryPolicy(
      {
        executor,
        baselineImageId: 'baseline',
        policy: { ...createDefaultRepositoryPolicy(), requiredCommands: ['pnpm lint'] },
        observe,
      },
      WINNER,
      refused,
    );

    expect(verdict).toBe(refused);
    expect(executor.calls).toHaveLength(0);
  });

  it('pairs each required command on the baseline and the candidate image', async () => {
    const { executor, observed, observe } = harness(() => ({ exitCode: 0 }));

    const verdict = await enforceRepositoryPolicy(
      {
        executor,
        baselineImageId: 'baseline',
        policy: { ...createDefaultRepositoryPolicy(), requiredCommands: ['pnpm lint', 'pnpm build'] },
        observe,
      },
      WINNER,
      APPROVED,
    );

    expect(verdict.approved).toBe(true);
    expect(observed.map(({ attempt, parentImageId, note }) => [attempt, parentImageId, note]))
      .toEqual([
        [2, 'baseline', 'Required command 1 baseline'],
        [3, 'candidate-image', 'Required command 1 candidate'],
        [4, 'baseline', 'Required command 2 baseline'],
        [5, 'candidate-image', 'Required command 2 candidate'],
      ]);
    expect(verdict.checks.at(-1)).toEqual({
      name: 'policy-required-command',
      passed: true,
      evidence: 'Passed 2 repository policy commands',
    });
  });

  it('refuses when a required command fails on the candidate image', async () => {
    const { executor, observe } = harness((_cmd, parent) => ({
      exitCode: parent === 'candidate-image' ? 7 : 0,
    }));

    const verdict = await enforceRepositoryPolicy(
      {
        executor,
        baselineImageId: 'baseline',
        policy: { ...createDefaultRepositoryPolicy(), requiredCommands: ['pnpm lint'] },
        observe,
      },
      WINNER,
      APPROVED,
    );

    expect(verdict.approved).toBe(false);
    expect(verdict.reasoning)
      .toBe('REFUSED: repository policy failed (required command 1 exited 7)');
    expect(verdict.checks).toContainEqual({
      name: 'policy-required-command',
      passed: false,
      evidence: 'required command 1 exited 7',
    });
  });

  it('refuses when a paired resource threshold is exceeded', async () => {
    const { executor, observe } = harness((_cmd, parent) => ({
      exitCode: 0,
      maxRssKb: parent === 'candidate-image' ? 4_000 : 1_000,
    }));

    const verdict = await enforceRepositoryPolicy(
      {
        executor,
        baselineImageId: 'baseline',
        policy: {
          ...createDefaultRepositoryPolicy(),
          requiredCommands: ['pnpm lint'],
          resourceLimits: { maxRssPercent: 50 },
        },
        observe,
      },
      WINNER,
      APPROVED,
    );

    expect(verdict.approved).toBe(false);
    expect(verdict.reasoning).toContain('REFUSED: repository policy failed');
    expect(verdict.checks).toContainEqual(expect.objectContaining({
      name: 'policy-resource-limit',
      passed: false,
    }));
  });
});
