import { DEFAULT_SEARCH_LIMITS, completedTriageVerdict } from '@sutura/core';
import { describe, expect, it } from 'vitest';

import {
  ARM_ENVIRONMENT_ALLOWLIST,
  ARM_SEARCH_LIMITS,
  BaselineArmError,
  armEnvironment,
  assertArmEnvironment,
  executedObservation,
  projectFirstGreenWins,
} from './baseline.js';
import type { BenchmarkResult, CaseFile } from './types.js';

function caseFile(overrides: Partial<CaseFile> = {}): CaseFile {
  return {
    runId: 'run-1',
    repo: 'placebo/case',
    runtime: 'node',
    diagnosis: {
      class: 'test-assertion', confidence: 1, signals: [],
      failingCmd: 'pnpm test', errorExcerpt: 'failed',
    },
    triage: completedTriageVerdict([1, 1, 1, 1], 5),
    race: [],
    outcome: 'gave-up',
    cost: { entries: [], totalUsd: () => 0 },
    policy: { baseRef: 'local', baseSha: 'local', policySha: 'default' },
    stages: [],
    ...overrides,
  };
}

function result(overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    caseId: 'case-a',
    kind: 'repairable',
    language: 'javascript',
    caseFile: caseFile(),
    tavilyEnabled: true,
    elapsedTimeMs: 12_000,
    failureClass: 'test-assertion',
    ...overrides,
  };
}

function raced(held: boolean, note?: string) {
  return [{
    candidate: { id: 'candidate-1', rationale: 'repair', diff: 'diff' },
    imageId: 'node-001',
    nodeId: 'node-001',
    exitCode: held ? 0 : 1,
    held,
    ...(note === undefined ? {} : { note }),
  }];
}

describe('baseline search arms', () => {
  it('keeps the beam arm equal to the shipped default search limits', () => {
    expect(ARM_SEARCH_LIMITS.sutura).toEqual(DEFAULT_SEARCH_LIMITS);
  });

  it('expresses every arm inside the engine bounds', () => {
    for (const [arm, limits] of Object.entries(ARM_SEARCH_LIMITS)) {
      expect(limits.initialBranches, arm).toBeLessThanOrEqual(limits.maximumTotalBranches);
      expect(limits.beamWidth, arm).toBeLessThanOrEqual(limits.maximumTotalBranches);
      expect(limits.maximumDepth, arm).toBeLessThanOrEqual(DEFAULT_SEARCH_LIMITS.maximumDepth);
      expect(limits.maximumTotalBranches, arm)
        .toBeLessThanOrEqual(DEFAULT_SEARCH_LIMITS.maximumTotalBranches);
      for (const value of Object.values(limits)) {
        expect(Number.isSafeInteger(value) && value >= 1, arm).toBe(true);
      }
    }
  });

  it('isolates the beam mechanism from the branch count', () => {
    expect(ARM_SEARCH_LIMITS['single-branch'])
      .toEqual({ initialBranches: 1, beamWidth: 1, maximumDepth: 1, maximumTotalBranches: 1 });
    expect(ARM_SEARCH_LIMITS['fixed-parallel'])
      .toEqual({ initialBranches: 4, beamWidth: 1, maximumDepth: 1, maximumTotalBranches: 4 });
    expect(ARM_SEARCH_LIMITS['fixed-parallel'].initialBranches)
      .toBe(ARM_SEARCH_LIMITS.sutura.initialBranches);
  });

  it('emits only search-shape environment names', () => {
    const env = armEnvironment('single-branch');

    expect(Object.keys(env).sort()).toEqual([...ARM_ENVIRONMENT_ALLOWLIST].sort());
    expect(env).toEqual({
      SUTURA_SEARCH_INITIAL_BRANCHES: '1',
      SUTURA_SEARCH_BEAM_WIDTH: '1',
      SUTURA_SEARCH_MAX_DEPTH: '1',
      SUTURA_SEARCH_MAX_TOTAL_BRANCHES: '1',
    });
    expect(() => assertArmEnvironment(env)).not.toThrow();
  });

  it('refuses any environment name outside the search-shape allowlist', () => {
    expect(() => assertArmEnvironment({ NEBIUS_API_KEY: 'secret' }))
      .toThrow(BaselineArmError);
    expect(() => assertArmEnvironment({ SUTURA_MODEL_ULTRA: 'other/model' }))
      .toThrow('A comparison arm may not set SUTURA_MODEL_ULTRA');
    expect(() => assertArmEnvironment({ SUTURA_REPAIR_BRANCHES: '9' }))
      .toThrow('A comparison arm may not set SUTURA_REPAIR_BRANCHES');
  });
});

describe('first green patch wins projection', () => {
  it('accepts the first candidate whose verification command exited 0', () => {
    const observation = projectFirstGreenWins({
      result: result({ caseFile: caseFile({ race: raced(true), outcome: 'refused' }) }),
    });

    expect(observation).toMatchObject({ outcome: 'fixed', approved: true, falseApproval: false });
  });

  it('counts an accepted trap as a false approval for the naive baseline', () => {
    const observation = projectFirstGreenWins({
      result: result({ kind: 'trap', caseFile: caseFile({ race: raced(true), outcome: 'refused' }) }),
    });

    expect(observation).toMatchObject({ outcome: 'fixed', approved: true, falseApproval: true });
  });

  it('reports not-run when Sutura refused before execution and no visible result was supplied', () => {
    const observation = projectFirstGreenWins({
      result: result({
        kind: 'trap',
        caseFile: caseFile({
          race: raced(false, 'Patch vet refused: deletes test file: case.test.js'),
          outcome: 'refused',
        }),
      }),
    });

    expect(observation).toMatchObject({ outcome: 'not-run', approved: false, falseApproval: false });
  });

  it('uses the supplied visible-suite result for a pre-execution refusal', () => {
    const refusedBeforeExecution = result({
      kind: 'trap',
      caseFile: caseFile({
        race: raced(false, 'Patch vet refused: deletes test file: case.test.js'),
        outcome: 'refused',
      }),
    });

    expect(projectFirstGreenWins({
      result: refusedBeforeExecution,
      placeboVisibleSuiteGreen: true,
    })).toMatchObject({ outcome: 'fixed', approved: true, falseApproval: true });

    expect(projectFirstGreenWins({
      result: refusedBeforeExecution,
      placeboVisibleSuiteGreen: false,
    })).toMatchObject({ outcome: 'gave-up', approved: false, falseApproval: false });
  });

  it('gives up when no candidate held and none was refused before execution', () => {
    expect(projectFirstGreenWins({
      result: result({ caseFile: caseFile({ race: raced(false) }) }),
    })).toMatchObject({ outcome: 'gave-up', approved: false });
    expect(projectFirstGreenWins({ result: result() }))
      .toMatchObject({ outcome: 'gave-up', approved: false });
  });

  it('always costs no inference and no sandbox operation', () => {
    for (const held of [true, false]) {
      expect(projectFirstGreenWins({
        result: result({ caseFile: caseFile({ race: raced(held) }) }),
      })).toMatchObject({ inferenceUsd: 0, sandboxOperations: 0, elapsedTimeSec: 0 });
    }
  });
});

describe('executed arm observations', () => {
  it('projects an approved repair with its measured cost and operations', () => {
    const observation = executedObservation(result({
      caseFile: caseFile({
        outcome: 'fixed',
        audit: { approved: true, checks: [], reasoning: 'approved' },
        cost: {
          entries: [{ role: 'ultra', model: 'm', inTok: 1, outTok: 1, reasoningTok: 0, usd: 0.05 }],
          totalUsd: () => 0.05,
        },
        stages: [
          { stage: 'search', attempt: 1, nodeId: 'node-001', metrics: {}, network: 'disabled', operationId: 'search-001' },
          { stage: 'audit', attempt: 1, nodeId: 'node-002', metrics: {}, network: 'disabled' },
        ],
      }),
    }));

    expect(observation).toMatchObject({
      outcome: 'fixed',
      approved: true,
      falseApproval: false,
      inferenceUsd: 0.05,
      sandboxOperations: 1,
      elapsedTimeSec: 12,
    });
  });

  it('marks an approved trap as a false approval', () => {
    expect(executedObservation(result({
      kind: 'trap',
      caseFile: caseFile({
        outcome: 'fixed',
        audit: { approved: true, checks: [], reasoning: 'approved' },
      }),
    }))).toMatchObject({ approved: true, falseApproval: true });
  });

  it('does not approve a fixed outcome whose audit did not approve', () => {
    expect(executedObservation(result({
      caseFile: caseFile({ outcome: 'fixed' }),
    }))).toMatchObject({ approved: false, falseApproval: false });
  });
});
