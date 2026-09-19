import { describe, expect, it } from 'vitest';

import { capturedJobLog } from './__fixtures__/captured/test-helper.js';
import { GitHubAdapter, GitHubAdapterError, type GitHubApi } from './github.js';

const SHA = 'a'.repeat(40);

function api(overrides: Partial<GitHubApi> = {}): GitHubApi {
  return {
    getWorkflowRun: async () => ({
      id: 77,
      headSha: SHA,
      repository: 'owner/repo',
      event: 'pull_request',
      conclusion: 'failure',
      pullRequests: [{ number: 9 }],
    }),
    listPullRequestsForCommit: async () => [],
    getPullRequest: async () => ({
      number: 9,
      headSha: SHA,
      headRef: 'feature',
      headRepo: 'owner/repo',
      baseSha: SHA,
      baseRef: 'develop',
    }),
    listJobsForWorkflowRun: async () => [{
      id: 5,
      name: 'checks',
      conclusion: 'failure',
      steps: [
        { name: 'Install', conclusion: 'success', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:10Z' },
        { name: 'Test', conclusion: 'failure', startedAt: '2026-01-01T00:00:11Z', completedAt: '2026-01-01T00:00:20Z' },
      ],
    }],
    downloadJobLogs: async () => [
      '2026-01-01T00:00:05Z install',
      ...Array.from({ length: 205 }, (_, index) => `2026-01-01T00:00:12Z test-${index}`),
    ].join('\n'),
    listIssueComments: async () => [],
    listCommitComments: async () => [],
    createRef: async () => undefined,
    deleteRef: async () => undefined,
    createIssueComment: async () => ({ id: 44 }),
    createCommitComment: async () => ({ id: 44 }),
    updateIssueComment: async () => undefined,
    updateCommitComment: async () => undefined,
    getRefSha: async () => SHA,
    getCommitParents: async () => [SHA],
    getCommitSha: async () => SHA,
    createPullRequest: async () => ({ number: 10, url: 'https://example.test/pr/10' }),
    listCheckRunsForRef: async () => [],
    createCheckRun: async () => ({ id: 55 }),
    updateCheckRun: async () => undefined,
    ...overrides,
  };
}

describe('GitHubAdapter', () => {
  it('returns the exact PR head and last 200 lines for each failed step', async () => {
    const adapter = new GitHubAdapter(api(), { owner: 'owner', repo: 'repo', runId: '77' });

    const run = await adapter.getFailingRun('77');

    expect(run).toMatchObject({
      runId: '77',
      repo: 'owner/repo',
      prNumber: 9,
      headSha: SHA,
      headRef: 'feature',
      baseSha: SHA,
      baseRef: 'develop',
    });
    expect(run.failedSteps).toHaveLength(1);
    expect(run.failedSteps[0]?.log.split('\n')).toHaveLength(200);
    expect(run.failedSteps[0]?.log).not.toContain('install');
    expect(run.failedSteps[0]?.log).toContain('test-204');
  });

  it('retains the failed-step command group when the log exceeds the line limit', async () => {
    const adapter = new GitHubAdapter(api({
      listJobsForWorkflowRun: async () => [{
        id: 5,
        name: 'checks',
        conclusion: 'failure',
        steps: [{
          name: 'Run pnpm run test',
          conclusion: 'failure',
          startedAt: '2026-01-01T00:00:11Z',
          completedAt: '2026-01-01T00:00:20Z',
        }],
      }],
      downloadJobLogs: async () => [
        '2026-01-01T00:00:11.100Z ##[group]Run pnpm run test',
        ...Array.from(
          { length: 205 },
          (_, index) => `2026-01-01T00:00:12Z test-${index}`,
        ),
      ].join('\n'),
    }), { owner: 'owner', repo: 'repo', runId: '77' });

    const run = await adapter.getFailingRun('77');

    expect(run.failedSteps[0]?.log.split('\n')).toHaveLength(200);
    expect(run.failedSteps[0]?.log).toContain('##[group]Run pnpm run test');
    expect(run.failedSteps[0]?.log).toContain('test-204');
  });

  it('keeps the full completion second and trims a shared-second prior step', async () => {
    const adapter = new GitHubAdapter(api({
      listJobsForWorkflowRun: async () => [{
        id: 5,
        name: 'checks',
        conclusion: 'failure',
        steps: [{
          name: 'Run pnpm run test',
          conclusion: 'failure',
          startedAt: '2026-01-01T00:00:11Z',
          completedAt: '2026-01-01T00:00:20Z',
        }],
      }],
      downloadJobLogs: async () => [
        '2026-01-01T00:00:11.001Z eslint prior-step noise',
        '2026-01-01T00:00:11.100Z ##[group]Run pnpm run test',
        '2026-01-01T00:00:20.999Z src/value.ts:1 expected 2 to be 3',
        '2026-01-01T00:00:21.000Z post-step noise',
      ].join('\n'),
    }), { owner: 'owner', repo: 'repo', runId: '77' });

    const run = await adapter.getFailingRun('77');

    expect(run.failedSteps[0]?.log).toContain('src/value.ts:1');
    expect(run.failedSteps[0]?.log).not.toContain('eslint prior-step noise');
    expect(run.failedSteps[0]?.log).not.toContain('post-step noise');
  });

  it('uses the commit-associated PR fallback and rejects fork PRs', async () => {
    const fallback = api({
      getWorkflowRun: async () => ({ id: 77, headSha: SHA, repository: 'owner/repo', event: 'pull_request', conclusion: 'failure', pullRequests: [] }),
      listPullRequestsForCommit: async () => [{ number: 12 }],
      getPullRequest: async () => ({ number: 12, headSha: SHA, headRef: 'fork-feature', headRepo: 'fork/repo', baseSha: SHA, baseRef: 'develop' }),
    });
    const adapter = new GitHubAdapter(fallback, { owner: 'owner', repo: 'repo', runId: '77' });

    await expect(adapter.getFailingRun('77')).rejects.toThrowError(/fork pull requests/i);
  });

  it('allows an explicit workflow dispatch through the exact-SHA PR fallback', async () => {
    let fallbackSha = '';
    const dispatched = api({
      getWorkflowRun: async () => ({
        id: 77,
        headSha: SHA,
        repository: 'owner/repo',
        event: 'workflow_dispatch',
        conclusion: 'failure',
        pullRequests: [],
      }),
      listPullRequestsForCommit: async (sha) => {
        fallbackSha = sha;
        return [{ number: 12 }];
      },
      getPullRequest: async () => ({
        number: 12,
        headSha: SHA,
        headRef: 'demo/break-me',
        headRepo: 'owner/repo',
        baseSha: SHA,
        baseRef: 'develop',
      }),
    });
    const adapter = new GitHubAdapter(dispatched, {
      owner: 'owner',
      repo: 'repo',
      runId: '77',
    });

    await expect(adapter.getFailingRun('77')).resolves.toMatchObject({
      prNumber: 12,
      headSha: SHA,
      headRef: 'demo/break-me',
    });
    expect(fallbackSha).toBe(SHA);
    await expect(adapter.claimAttempt(12, '<!-- marker -->')).resolves.toEqual({
      kind: 'pull-request',
      commentId: 44,
      checkRunId: 55,
      headSha: SHA,
    });
  });

  it.each(['push', 'schedule', 'workflow_dispatch'])('repairs a failed %s run from its exact branch', async (event) => {
    const calls: string[] = [];
    const direct = api({
      getWorkflowRun: async () => ({
        id: 77,
        headSha: SHA,
        repository: 'owner/repo',
        event,
        conclusion: 'failure',
        headBranch: 'develop',
        pullRequests: [],
      }),
      listCommitComments: async () => {
        calls.push('commit-comments');
        return [];
      },
      createRef: async (ref) => { calls.push(`ref:${ref}`); },
      createCommitComment: async (_sha, body) => {
        calls.push(`commit-comment:${body}`);
        return { id: 44 };
      },
      deleteRef: async (ref) => { calls.push(`delete:${ref}`); },
      updateCommitComment: async (id, body) => { calls.push(`update:${id}:${body}`); },
    });
    const adapter = new GitHubAdapter(direct, {
      owner: 'owner',
      repo: 'repo',
      runId: '77',
    });

    await expect(adapter.getFailingRun('77')).resolves.toMatchObject({
      runId: '77',
      repo: 'owner/repo',
      headSha: SHA,
      headRef: 'develop',
    });
    await expect(adapter.claimAttempt(undefined, '<!-- marker -->')).resolves.toEqual({
      kind: 'commit',
      commentId: 44,
      checkRunId: 55,
      headSha: SHA,
    });
    await expect(adapter.updateAttempt(
      { kind: 'commit', commentId: 44, checkRunId: 55, headSha: SHA },
      'report',
    )).resolves.toBeUndefined();
    expect(calls).toEqual([
      'ref:refs/tags/sutura-attempt-77',
      'commit-comments',
      'commit-comment:<!-- marker -->\n<!-- sutura-check-run:55 -->\nSutura claimed this failed run and is starting analysis.',
      'delete:tags/sutura-attempt-77',
      'update:44:report',
    ]);
  });

  it('fails closed when a direct run has no valid head branch', async () => {
    const direct = api({
      getWorkflowRun: async () => ({
        id: 77,
        headSha: SHA,
        repository: 'owner/repo',
        event: 'push',
        conclusion: 'failure',
        headBranch: null,
        pullRequests: [],
      }),
    });
    const adapter = new GitHubAdapter(direct, {
      owner: 'owner',
      repo: 'repo',
      runId: '77',
    });

    await expect(adapter.getFailingRun('77')).rejects.toThrowError(/head branch/i);
  });

  it('fails closed when a direct run branch advances beyond the failing SHA', async () => {
    const direct = api({
      getWorkflowRun: async () => ({
        id: 77,
        headSha: SHA,
        repository: 'owner/repo',
        event: 'push',
        conclusion: 'failure',
        headBranch: 'develop',
        pullRequests: [],
      }),
      getRefSha: async () => 'b'.repeat(40),
    });
    const adapter = new GitHubAdapter(direct, {
      owner: 'owner',
      repo: 'repo',
      runId: '77',
    });

    await expect(adapter.getFailingRun('77')).rejects.toThrowError(/no longer matches/i);
  });

  it('claims once with an atomic ref before creating the marker comment', async () => {
    const calls: string[] = [];
    const adapter = new GitHubAdapter(api({
      createRef: async (ref) => { calls.push(`ref:${ref}`); },
      createIssueComment: async (_issue, body) => { calls.push(`comment:${body}`); return { id: 44 }; },
      deleteRef: async (ref) => { calls.push(`delete:${ref}`); },
    }), { owner: 'owner', repo: 'repo', runId: '77' });

    await expect(adapter.claimAttempt(9, '<!-- marker -->')).resolves.toEqual({
      kind: 'pull-request',
      commentId: 44,
      checkRunId: 55,
      headSha: SHA,
    });
    expect(calls).toEqual([
      'ref:refs/tags/sutura-attempt-77',
      'comment:<!-- marker -->\n<!-- sutura-check-run:55 -->\nSutura claimed this failed run and is starting analysis.',
      'delete:tags/sutura-attempt-77',
    ]);
  });

  it('releases the atomic ref if marker comment creation fails after check creation', async () => {
    let deleted = false;
    const adapter = new GitHubAdapter(api({
      createIssueComment: async () => { throw new Error('comment failed'); },
      deleteRef: async () => { deleted = true; },
    }), { owner: 'owner', repo: 'repo', runId: '77' });

    await expect(adapter.claimAttempt(9, '<!-- marker -->')).rejects.toThrow(/comment failed/);
    expect(deleted).toBe(true);
  });

  it('returns null when the atomic claim already exists', async () => {
    const duplicate = Object.assign(new Error('Reference already exists'), { status: 422 });
    const adapter = new GitHubAdapter(api({ createRef: async () => { throw duplicate; } }), { owner: 'owner', repo: 'repo', runId: '77' });

    await expect(adapter.claimAttempt(9, '<!-- marker -->')).resolves.toBeNull();
  });

  it('ignores an untrusted comment that spoofs the idempotency marker', async () => {
    let claimed = false;
    const adapter = new GitHubAdapter(api({
      listIssueComments: async () => [{ id: 1, body: '<!-- marker -->', authorLogin: 'attacker' }],
      createRef: async () => { claimed = true; },
    }), { owner: 'owner', repo: 'repo', runId: '77' });

    await expect(adapter.claimAttempt(9, '<!-- marker -->')).resolves.toEqual({
      kind: 'pull-request',
      commentId: 44,
      checkRunId: 55,
      headSha: SHA,
    });
    expect(claimed).toBe(true);
  });

  it('recovers an in-progress check independently when the marker comment exists', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const commentUpdates: string[] = [];
    const adapter = new GitHubAdapter(api({
      listIssueComments: async () => [{ id: 44, body: '<!-- marker -->', authorLogin: 'github-actions[bot]' }],
      listCheckRunsForRef: async () => [{ id: 91, headSha: SHA, externalId: 'sutura:owner/repo:workflow-run:77', name: 'Sutura repair audit', status: 'in_progress', conclusion: null }],
      updateCheckRun: async (input) => { updates.push(input); },
      updateIssueComment: async (_id, body) => { commentUpdates.push(body); },
    }), { owner: 'owner', repo: 'repo', runId: '77' });

    await expect(adapter.claimAttempt(9, '<!-- marker -->')).resolves.toBeNull();
    await adapter.completeUnexpectedFailure('redelivery recovered an incomplete attempt');
    expect(updates).toEqual([expect.objectContaining({
      checkRunId: 91, status: 'completed', conclusion: 'action_required',
    })]);
    expect(commentUpdates).toEqual([expect.stringContaining('Sutura stopped unexpectedly')]);
  });

  it('does not rerun work when an existing check has no marker comment', async () => {
    let createdComments = 0;
    const adapter = new GitHubAdapter(api({
      listCheckRunsForRef: async () => [{ id: 91, headSha: SHA, externalId: 'sutura:owner/repo:workflow-run:77', name: 'Sutura repair audit', status: 'in_progress', conclusion: null }],
      createIssueComment: async () => { createdComments += 1; return { id: 44 }; },
    }), { owner: 'owner', repo: 'repo', runId: '77' });

    await expect(adapter.claimAttempt(9, '<!-- marker -->')).resolves.toBeNull();
    expect(createdComments).toBe(1);
  });

  it('refreshes checks after acquiring the atomic claim', async () => {
    let createChecks = 0;
    let lockAcquired = false;
    const adapter = new GitHubAdapter(api({
      createRef: async () => { lockAcquired = true; },
      listCheckRunsForRef: async () => lockAcquired
        ? [{ id: 91, headSha: SHA, externalId: 'sutura:owner/repo:workflow-run:77', name: 'Sutura repair audit', status: 'in_progress', conclusion: null }]
        : [],
      createCheckRun: async () => { createChecks += 1; return { id: 92 }; },
    }), { owner: 'owner', repo: 'repo', runId: '77' });

    await expect(adapter.claimAttempt(9, '<!-- marker -->')).resolves.toBeNull();
    expect(createChecks).toBe(0);
  });

  it('fails closed on an ambiguous associated-PR fallback', async () => {
    const adapter = new GitHubAdapter(api({
      getWorkflowRun: async () => ({ id: 77, headSha: SHA, repository: 'owner/repo', event: 'pull_request', conclusion: 'failure', pullRequests: [] }),
      listPullRequestsForCommit: async () => [{ number: 1 }, { number: 2 }],
    }), { owner: 'owner', repo: 'repo', runId: '77' });

    await expect(adapter.getFailingRun('77')).rejects.toThrowError(GitHubAdapterError);
  });

  it('links uploaded artifacts to the current Sutura action run', async () => {
    expect(capturedJobLog('33239848825')).toContain('Hook timed out in 10000ms');
    const artifact = { uploadArtifact: async () => ({ id: 321 }) };
    const adapter = new GitHubAdapter(api(), {
      owner: 'owner',
      repo: 'repo',
      runId: '77',
      actionRunId: '88',
      artifact,
    });

    await expect(adapter.uploadCaseFile('case.html', '<html></html>')).resolves.toEqual({
      url: 'https://github.com/owner/repo/actions/runs/88/artifacts/321',
    });
  });

  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects an artifact upload with a %s id', async (_case, id) => {
    const adapter = new GitHubAdapter(api(), {
      owner: 'owner',
      repo: 'repo',
      runId: '77',
      actionRunId: '88',
      artifact: { uploadArtifact: async () => id === undefined ? {} : { id } },
    });

    await expect(adapter.uploadCaseFile('case.html', '<html></html>')).rejects.toThrow(
      'Artifact upload did not return an id',
    );
  });

  it.each(['', '0', '../88'])('rejects invalid Action run id %j', async (actionRunId) => {
    const adapter = new GitHubAdapter(api(), {
      owner: 'owner',
      repo: 'repo',
      runId: '77',
      actionRunId,
      artifact: { uploadArtifact: async () => ({ id: 321 }) },
    });

    await expect(adapter.uploadCaseFile('case.html', '<html></html>')).rejects.toThrow(
      'Action run id is invalid',
    );
  });

  it('rejects an unsafe integer Action run id', async () => {
    const adapter = new GitHubAdapter(api(), {
      owner: 'owner',
      repo: 'repo',
      runId: '77',
      actionRunId: '9007199254740992',
      artifact: { uploadArtifact: async () => ({ id: 321 }) },
    });

    await expect(adapter.uploadCaseFile('case.html', '<html></html>')).rejects.toThrow(
      'Action run id is invalid',
    );
  });
});
