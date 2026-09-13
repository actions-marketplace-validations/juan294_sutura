import { describe, expect, it } from 'vitest';

import { createGitHubDispatchClient, GitHubDispatchError, type FetchLike } from './github.js';

const TOKEN = 'github_pat_TESTTOKENVALUE0123456789';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(responder: (call: Call) => Response | Promise<Response>): { calls: Call[]; fetch: FetchLike } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      return responder(call);
    },
  };
}

const RUN = {
  id: 42,
  display_title: 'Case Lab cl-1788198872643-48b5c5d4 flaky-failure',
  status: 'in_progress',
  conclusion: null,
  created_at: '2026-09-04T12:00:00Z',
  html_url: 'https://github.com/juan294/sutura-demo/actions/runs/42',
};

describe('createGitHubDispatchClient', () => {
  it('lists runs with the exact URL, query, and headers', async () => {
    const { calls, fetch } = fakeFetch(() => new Response(JSON.stringify({ workflow_runs: [RUN] }), { status: 200 }));
    const client = createGitHubDispatchClient({ repository: 'juan294/sutura-demo', token: TOKEN, fetch });
    const runs = await client.listWorkflowRuns('case-lab.yml', { since: new Date('2026-09-03T12:00:00.000Z') });
    expect(runs).toEqual([{
      id: 42,
      displayTitle: 'Case Lab cl-1788198872643-48b5c5d4 flaky-failure',
      status: 'in_progress',
      conclusion: null,
      createdAt: '2026-09-04T12:00:00Z',
      htmlUrl: 'https://github.com/juan294/sutura-demo/actions/runs/42',
    }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/juan294/sutura-demo/actions/workflows/case-lab.yml/runs?per_page=100&created=%3E%3D2026-09-03T12%3A00%3A00.000Z',
    );
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.headers).toEqual({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'sutura-case-lab',
    });
  });

  it('dispatches with exactly the given ref and inputs', async () => {
    const { calls, fetch } = fakeFetch(() => new Response(null, { status: 204 }));
    const client = createGitHubDispatchClient({ repository: 'juan294/sutura-demo', token: TOKEN, fetch });
    await client.dispatchWorkflow('case-lab.yml', 'main', { 'case-id': 'flaky-failure', 'request-id': 'cl-1788198872643-48b5c5d4' });
    expect(calls[0]?.url).toBe('https://api.github.com/repos/juan294/sutura-demo/actions/workflows/case-lab.yml/dispatches');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe('{"ref":"main","inputs":{"case-id":"flaky-failure","request-id":"cl-1788198872643-48b5c5d4"}}');
  });

  it('maps failures to errors that never carry the token or the response body', async () => {
    const { fetch } = fakeFetch(() => new Response(`token owner ${TOKEN} secret body`, { status: 403 }));
    const client = createGitHubDispatchClient({ repository: 'juan294/sutura-demo', token: TOKEN, fetch });
    let caught: unknown;
    try {
      await client.dispatchWorkflow('case-lab.yml', 'main', {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GitHubDispatchError);
    const error = caught as GitHubDispatchError;
    expect(error.operation).toBe('dispatch');
    expect(error.status).toBe(403);
    expect(JSON.stringify({ ...error, message: error.message, stack: error.stack })).not.toContain(TOKEN);
    expect(error.message).not.toContain('secret body');
  });

  it('rejects malformed run listings and network failures without dispatching', async () => {
    for (const body of ['not json', '{"workflow_runs":"x"}', '{"workflow_runs":[{"id":"1"}]}']) {
      const { fetch } = fakeFetch(() => new Response(body, { status: 200 }));
      const client = createGitHubDispatchClient({ repository: 'juan294/sutura-demo', token: TOKEN, fetch });
      await expect(client.listWorkflowRuns('case-lab.yml', { since: new Date() })).rejects.toMatchObject({
        name: 'GitHubDispatchError', operation: 'list-runs', status: 'invalid-response',
      });
    }
    const failing = createGitHubDispatchClient({
      repository: 'juan294/sutura-demo', token: TOKEN,
      fetch: async () => { throw new TypeError('fetch failed'); },
    });
    await expect(failing.listWorkflowRuns('case-lab.yml', { since: new Date() })).rejects.toMatchObject({ status: 'network' });
  });

  it('aborts a request that exceeds the timeout', async () => {
    const client = createGitHubDispatchClient({
      repository: 'juan294/sutura-demo', token: TOKEN, timeoutMs: 20,
      fetch: (_url, init) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    });
    await expect(client.listWorkflowRuns('case-lab.yml', { since: new Date() })).rejects.toMatchObject({ status: 'timeout' });
  });

  it('refuses an invalid repository or token before any request', () => {
    expect(() => createGitHubDispatchClient({ repository: 'juan294', token: TOKEN })).toThrow('repository must be owner/name');
    expect(() => createGitHubDispatchClient({ repository: 'juan294/sutura-demo', token: '' })).toThrow('token must be a non-empty string');
  });
});
