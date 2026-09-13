import { describe, expect, it, vi } from 'vitest';

import { ReplayRecorder, loadConfig } from '@sutura/core';

import { GitHubAdapter, type GitHubApi } from './github.js';
import { withFailureSafeCheck } from './failure-safe.js';
import { runAction } from './main.js';

const SHA = 'a'.repeat(40);
const REPLAY_CONFIG = {
  triageN: 1, raceK: 1,
  models: { nano: 'nano', super: 'super', ultra: 'ultra' },
  routingProfileId: 'test', maxOps: 1,
} as const;

describe('action check failure safety', () => {
  it('completes the same created check when orchestration throws', async () => {
    const checks: Array<{ id: number; headSha: string; externalId: string; name: string; status: string; conclusion: string | null }> = [];
    const updates: Array<Record<string, unknown>> = [];
    const api = {
      getWorkflowRun: async () => ({ id: 77, headSha: SHA, repository: 'owner/repo', event: 'pull_request', conclusion: 'failure', pullRequests: [{ number: 9 }] }),
      listCheckRunsForRef: async () => checks.map((check) => ({ ...check })),
      listIssueComments: async () => [],
      createRef: async () => undefined,
      deleteRef: async () => undefined,
      createCheckRun: async (input: { headSha: string; externalId: string; name: string }) => {
        checks.push({ id: 91, headSha: input.headSha, externalId: input.externalId, name: input.name, status: 'in_progress', conclusion: null });
        return { id: 91 };
      },
      createIssueComment: async () => ({ id: 44 }),
      updateCheckRun: async (input: Record<string, unknown>) => { updates.push(input); },
    } as unknown as GitHubApi;
    const adapter = new GitHubAdapter(api, { owner: 'owner', repo: 'repo', runId: '77' });
    let claimedCheckRunId: number | undefined;

    await expect(withFailureSafeCheck(
      adapter,
      async () => {
        claimedCheckRunId = (await adapter.claimAttempt(9, '<!-- marker -->'))?.checkRunId;
        throw new Error('artifact serialization failed');
      },
    )).rejects.toThrow('artifact serialization failed');

    expect(claimedCheckRunId).toBe(91);
    expect(updates).toEqual([expect.objectContaining({
      checkRunId: claimedCheckRunId,
      status: 'completed',
      conclusion: 'action_required',
    })]);
  });

  it('preserves the orchestration failure when terminal check completion also fails', async () => {
    const warnings: string[] = [];
    await expect(withFailureSafeCheck(
      { completeUnexpectedFailure: async () => { throw new Error('checks API unavailable'); } },
      async () => { throw new Error('provider failed'); },
      (message) => warnings.push(message),
    )).rejects.toThrow('provider failed');
    expect(warnings).toEqual([
      'Sutura could not complete its GitHub check after an unexpected failure.',
    ]);
  });

  it('uploads an infra-stop replay bundle when orchestration crashes', async () => {
    const uploads: Array<{ name: string; json: string }> = [];
    const recorder = new ReplayRecorder('77', 'owner/repo', SHA, REPLAY_CONFIG);

    await expect(withFailureSafeCheck(
      {
        completeUnexpectedFailure: async () => undefined,
        uploadReplayBundle: async (name, json) => {
          uploads.push({ name, json });
          return { url: 'https://example.test/replay' };
        },
      },
      async () => { throw new Error('provider failed'); },
      () => undefined,
      recorder,
      {
        actionRunId: '88', targetRunId: '77', repository: 'owner/repo', actionSha: SHA,
      },
    )).rejects.toThrow('provider failed');

    expect(uploads).toHaveLength(2);
    expect(uploads[0]?.name).toBe('sutura-terminal-failure-77.json');
    expect(JSON.parse(uploads[0]?.json ?? '{}')).toMatchObject({
      schemaVersion: 'sutura-terminal-failure-v1',
      outcome: 'infra-stop',
      costStatus: 'unavailable',
      fixtureIdentity: { repository: 'owner/repo', targetRunId: '77' },
    });
    expect(uploads[1]?.name).toBe('sutura-replay-77.json');
    expect(JSON.parse(uploads[1]?.json ?? '{}')).toMatchObject({
      schemaVersion: 'sutura-replay-v1',
      outcome: 'infra-stop',
    });
  });
});

describe('runAction input guards', () => {
  const action = {
    githubToken: 'github-test',
    runId: '77',
    triageN: 1,
    requireFixed: false,
    captureReplay: false,
    environment: {},
  } as const;

  it('reports missing ConTree configuration through the side-effect-free seam', async () => {
    const setFailed = vi.fn();

    await runAction({
      readAction: () => action,
      loadConfiguration: () => loadConfig({ NEBIUS_API_KEY: 'nebius-test' }),
      repository: () => ({ owner: 'acme', repo: 'widget' }),
      environment: { GITHUB_RUN_ID: '88' },
      setFailed,
    });

    expect(setFailed).toHaveBeenCalledWith(
      'ConTree token and project are required by the GitHub Action',
    );
  });

  it('reports a malformed action run id before creating an Octokit client', async () => {
    const setFailed = vi.fn();

    await runAction({
      readAction: () => action,
      loadConfiguration: () => loadConfig({
        NEBIUS_API_KEY: 'nebius-test',
        CONTREE_TOKEN: 'contree-test',
        CONTREE_PROJECT: 'project-test',
      }),
      repository: () => ({ owner: 'acme', repo: 'widget' }),
      environment: { GITHUB_RUN_ID: 'not-an-id' },
      setFailed,
    });

    expect(setFailed).toHaveBeenCalledWith('GITHUB_RUN_ID must be a positive decimal id');
  });
});

 it('dispatches verify mode without constructing repair orchestration',async()=>{
 const verify=vi.fn(async()=>({status:'refused' as const}));const setFailed=vi.fn();
 await runAction({readAction:()=>({mode:'verify',githubToken:'token',runId:'77',triageN:1,requireFixed:false,captureReplay:false,environment:{}}),loadConfiguration:()=>({contreeToken:'token',contreeProject:'project'} as never),repository:()=>({owner:'owner',repo:'repo'}),environment:{GITHUB_RUN_ID:'88'},readVerification:()=>({sourceSha:SHA,policyBaseSha:SHA,candidateDiff:'diff',failingCommandId:'diagnosed'}),verify,setFailed});
 expect(verify).toHaveBeenCalledOnce();expect(setFailed).toHaveBeenCalledWith('Sutura verification: refused');
 });
