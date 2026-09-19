import { describe, expect, it } from 'vitest';

import { GitHubAdapter } from '../github/adapter.js';
import type { GitHubApi } from '../github/types.js';
import { ReplayRecorder, type ReplayBundle } from './bundle.js';
import { recordingGitHubApi } from './record-github.js';
import { ReplayMismatchError } from './replay-fetch.js';
import { replayingGitHubApi } from './replay-github.js';

const BUNDLE = {
  github: [
    { sequence: 1, method: 'getRefSha', args: ['heads/main'], result: 'a'.repeat(40) },
    { sequence: 2, method: 'createIssueComment', args: [7, 'body'], result: { id: 91 } },
    { sequence: 3, method: 'updateIssueComment', args: [91, 'done'], result: null },
  ],
} as ReplayBundle;

describe('replayingGitHubApi', () => {
  it('returns recorded reads and records requested mutations', async () => {
    const replay = replayingGitHubApi(BUNDLE);

    await expect(replay.api.getRefSha('heads/main')).resolves.toBe('a'.repeat(40));
    await expect(replay.api.createIssueComment(7, 'body')).resolves.toEqual({ id: 91 });
    await expect(replay.api.updateIssueComment(91, 'done')).resolves.toBeUndefined();

    expect(replay.mutations).toEqual([
      { sequence: 2, method: 'createIssueComment', args: [7, 'body'] },
      { sequence: 3, method: 'updateIssueComment', args: [91, 'done'] },
    ]);
  });

  it('fails closed at the first different argument', async () => {
    const { api } = replayingGitHubApi(BUNDLE);

    await expect(api.getRefSha('heads/develop')).rejects.toEqual(
      expect.objectContaining<Partial<ReplayMismatchError>>({
        sequence: 1,
        path: '$[0]',
        expected: 'heads/main',
        actual: 'heads/develop',
      }),
    );
  });

  it('replays updateCheckRun without comparing checkout-derived annotations', async () => {
    // Live: one annotation from the checkout (Case Lab run 34977342282). Replay: none.
    const recorded = {
      checkRunId: 104408782102, status: 'completed' as const, conclusion: 'action_required' as const,
      detailsUrl: 'https://github.com/juan294/sutura-demo/actions/runs/34977342282/artifacts/10400296167',
      title: 'Sutura outcome: gave-up', summary: 'Outcome: gave-up',
      annotations: [{
        path: 'src/page-count.js', startLine: 6, endLine: 6, annotationLevel: 'warning' as const,
        title: 'Sutura: test-assertion', message: 'AssertionError: src/page-count.js:6 exact division must not add a page',
      }],
    };
    const bundle = {
      github: [{ sequence: 17, method: 'updateCheckRun', args: [recorded], result: null }],
    } as ReplayBundle;

    const replay = replayingGitHubApi(bundle);
    await expect(replay.api.updateCheckRun({ ...recorded, annotations: [] })).resolves.toBeUndefined();
    expect(replay.mutations).toEqual([{ sequence: 17, method: 'updateCheckRun', args: [{ ...recorded, annotations: [] }] }]);

    const drifted = replayingGitHubApi(bundle);
    await expect(drifted.api.updateCheckRun({ ...recorded, annotations: [], conclusion: 'neutral' })).rejects.toEqual(
      expect.objectContaining<Partial<ReplayMismatchError>>({
        sequence: 17,
        path: '$[0].conclusion',
        expected: 'action_required',
        actual: 'neutral',
      }),
    );
  });

  it('replays recorded errors without recording a mutation', async () => {
    const bundle = {
      ...BUNDLE,
      github: [{
        sequence: 4,
        method: 'getCommitSha',
        args: ['bad'],
        result: { error: { message: 'missing', name: 'NotFoundError', status: 404 } },
      }],
    } as ReplayBundle;
    const replay = replayingGitHubApi(bundle);

    await expect(replay.api.getCommitSha('bad')).rejects.toMatchObject({
      message: 'missing',
      name: 'NotFoundError',
      status: 404,
    });
    expect(replay.mutations).toEqual([]);
  });

  it('captures and replays a 422 claim as an idempotent no-op', async () => {
    const sha = 'a'.repeat(40);
    const duplicate = Object.assign(new Error('Reference already exists'), { status: 422 });
    const api = {
      getWorkflowRun: async () => ({
        id: 77,
        headSha: sha,
        repository: 'acme/widget',
        event: 'push',
        conclusion: 'failure',
        pullRequests: [],
      }),
      createRef: async () => { throw duplicate; },
      listCheckRunsForRef: async () => [],
    } as unknown as GitHubApi;
    const recorder = new ReplayRecorder('77', 'acme/widget', sha, {
      triageN: 1,
      raceK: 1,
      models: { nano: 'nano', super: 'super', ultra: 'ultra' },
      routingProfileId: 'test',
      maxOps: 1,
    });
    const captured = new GitHubAdapter(recordingGitHubApi(api, recorder), {
      owner: 'acme', repo: 'widget', runId: '77',
    });
    await expect(captured.claimAttempt(undefined, '<!-- marker -->')).resolves.toBeNull();

    const replay = replayingGitHubApi(recorder.finish('infra-stop'));
    const adapter = new GitHubAdapter(replay.api, {
      owner: 'acme', repo: 'widget', runId: '77',
    });

    await expect(adapter.claimAttempt(undefined, '<!-- marker -->')).resolves.toBeNull();
    expect(replay.mutations).toEqual([{ sequence: 2, method: 'createRef', args: [
      'refs/tags/sutura-attempt-77', sha,
    ] }]);
  });
});
