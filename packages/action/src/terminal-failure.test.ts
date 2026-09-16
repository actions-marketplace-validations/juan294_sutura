import { describe, expect, it } from 'vitest';

import { ReplayRecorder } from '@sutura/core';

import { createTerminalFailureEvidence } from './terminal-failure.js';
import { resolveActionIdentity } from './terminal-failure.js';

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
      result: { headSha: 'b'.repeat(40), pullRequests: [{ number: 114 }] },
    });
    replay.recordGitHub({ method: 'createCheckRun', args: [], result: { id: 91 } });
    replay.recordHttp({
      boundary: 'nebius',
      request: { method: 'POST', url: 'https://example.test/chat', headers: {}, body: null },
      response: { status: 200, headers: {}, body: '{}' }, latencyMs: 1,
    });
    replay.recordExecutor({
      method: 'run', args: ['image', 'test'],
      result: {
        imageId: 'image-2', exitCode: 1, stdout: '', stderr: 'failed', truncated: false,
        metrics: { cost: 0.125 },
        operation: { operationId: 'op-1', terminal: 'failed', cancellationRequested: false },
      },
    });
    replay.recordRuntimeDetection({
      runtime: 'node', evidenceSource: 'root',
      evidencePaths: ['package.json', 'package-lock.json'], visitedEntries: 2,
    });
    const evidence = createTerminalFailureEvidence(new TypeError('invalid provider response'), {
      actionRunId: '88', targetRunId: '77', repository: 'owner/repo',
      actionSha: SHA, actionShaSource: 'runner-action-path',
      replay: replay.finish('infra-stop'),
    });

    expect(evidence).toMatchObject({
      schemaVersion: 'sutura-terminal-failure-v2',
      outcome: 'infra-stop',
      errorClass: 'TypeError',
      costStatus: 'unavailable',
      observedCosts: { inferenceUsd: null, sandboxUsd: 0.125 },
      fixtureIdentity: {
        repository: 'owner/repo', targetRunId: '77', fixtureCommit: 'b'.repeat(40),
        pullRequestNumber: 114,
      },
      packageIdentity: {
        name: 'sutura', version: '0.3.1', actionSha: SHA,
        actionShaSource: 'runner-action-path',
      },
      actionRunId: '88',
      operationIds: ['op-1'],
      execution: {
        claimState: 'claimed', providerInvocations: 1, sandboxOperations: 1,
        searchStarted: null, terminalCommentState: 'not-recorded',
      },
      runtimeDetection: {
        runtime: 'node', evidenceSource: 'root',
        evidenceCount: 2, visitedEntries: 2,
      },
      failure: { code: 'type-error', stage: 'unknown', class: 'TypeError' },
    });
  });

  it('resolves the executed action commit from the runner action checkout path', () => {
    expect(resolveActionIdentity({
      GITHUB_ACTION_REPOSITORY: 'juan294/sutura',
      GITHUB_ACTION_PATH: `/home/runner/work/_actions/juan294/sutura/${SHA}`,
      GITHUB_SHA: 'b'.repeat(40),
    })).toEqual({ sha: SHA, source: 'runner-action-path' });
  });

  it('does not misreport the consumer workflow commit as the action commit', () => {
    expect(resolveActionIdentity({
      GITHUB_ACTION_REPOSITORY: 'juan294/sutura',
      GITHUB_ACTION_PATH: '/home/runner/work/_actions/juan294/sutura/develop',
      GITHUB_SHA: 'b'.repeat(40),
    })).toEqual({ sha: null, source: 'unavailable' });
  });

  it('uses the workflow commit only for Sutura self-hosting', () => {
    expect(resolveActionIdentity({
      GITHUB_REPOSITORY: 'juan294/sutura',
      GITHUB_SHA: SHA,
    })).toEqual({ sha: SHA, source: 'self-repository' });
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
      execution: {
        claimState: 'not-observed', providerInvocations: null,
        sandboxOperations: null, searchStarted: null,
        terminalCommentState: 'not-recorded',
      },
    });
  });
});
