import { describe, expect, it } from 'vitest';

import { ReplayRecorder } from '@sutura/core';

import { createTerminalFailureEvidence } from './terminal-failure.js';

const SHA = 'a'.repeat(40);

describe('terminal failure evidence', () => {
  it('keeps exact identities, observed sandbox cost, and unavailable total cost distinct', () => {
    const replay = new ReplayRecorder('77', 'owner/repo', SHA, {
      triageN: 1,
      raceK: 1,
      models: { nano: 'nano', super: 'super', ultra: 'ultra' },
      routingProfileId: 'test',
      maxOps: 1,
    });
    replay.recordGitHub({
      method: 'getWorkflowRun', args: [77],
      result: { headSha: 'b'.repeat(40) },
    });
    replay.recordExecutor({
      method: 'run', args: ['image', 'test'],
      result: {
        imageId: 'image-2', exitCode: 1, stdout: '', stderr: 'failed', truncated: false,
        metrics: { cost: 0.125 },
        operation: { operationId: 'op-1', terminal: 'failed', cancellationRequested: false },
      },
    });
    const evidence = createTerminalFailureEvidence(new TypeError('invalid provider response'), {
      actionRunId: '88', targetRunId: '77', repository: 'owner/repo', actionSha: SHA,
      replay: replay.finish('infra-stop'),
    });

    expect(evidence).toMatchObject({
      schemaVersion: 'sutura-terminal-failure-v1',
      outcome: 'infra-stop',
      errorClass: 'TypeError',
      costStatus: 'unavailable',
      observedCosts: { inferenceUsd: null, sandboxUsd: 0.125 },
      fixtureIdentity: { repository: 'owner/repo', targetRunId: '77', fixtureCommit: 'b'.repeat(40) },
      packageIdentity: { name: 'sutura', version: '0.2.1', actionSha: SHA },
      actionRunId: '88',
      operationIds: ['op-1'],
    });
  });

  it('redacts credential text and never turns unavailable cost into zero', () => {
    const evidence = createTerminalFailureEvidence(
      new Error('Authorization: Bearer secret-token-value at /Users/juan/private/repository.ts'),
      { actionRunId: '88', targetRunId: '77', repository: 'owner/repo', actionSha: SHA },
    );
    expect(JSON.stringify(evidence)).not.toContain('secret-token-value');
    expect(JSON.stringify(evidence)).not.toContain('/Users/');
    expect(evidence).toMatchObject({
      costStatus: 'unavailable',
      observedCosts: { inferenceUsd: null, sandboxUsd: null },
      operationIds: [],
    });
  });
});
