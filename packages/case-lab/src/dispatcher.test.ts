import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CASE_LAB_WORKFLOW_FILE,
  CaseLabConfigurationError,
  FORBIDDEN_DISPATCHER_ENV,
  caseLabEnvironment,
  createCaseLabHandler,
  liveRequestId,
  type CaseLabHttpRequest,
} from './dispatcher.js';
import { GitHubDispatchError, type GitHubDispatchClient, type WorkflowRunSummary } from './github.js';
import { CASE_LAB_LIMITS } from './limits.js';

const RELEASE = { version: '0.2.0', actionSha: 'a943ded4c734aed75c5c63f2b2dd63a2f44556c2' };
const NOW = new Date('2026-09-04T12:30:00.000Z');
const TOKEN = 'github_pat_TESTTOKENVALUE0123456789';
const REQUEST_ID = `cl-${NOW.getTime()}-abcdef01`;

function run(overrides: Partial<WorkflowRunSummary> = {}): WorkflowRunSummary {
  return {
    id: 1,
    displayTitle: 'Case Lab cl-1788198872643-48b5c5d4 flaky-failure',
    status: 'completed',
    conclusion: 'success',
    createdAt: '2026-09-04T09:00:00.000Z',
    htmlUrl: 'https://github.com/juan294/sutura-demo/actions/runs/1',
    ...overrides,
  };
}

interface FakeGitHub extends GitHubDispatchClient {
  listed: number;
  dispatched: Array<{ workflowFile: string; ref: string; inputs: Record<string, string> }>;
}

function fakeGitHub(runs: WorkflowRunSummary[] | Error): FakeGitHub {
  const client: FakeGitHub = {
    listed: 0,
    dispatched: [],
    async listWorkflowRuns() {
      client.listed += 1;
      if (runs instanceof Error) throw runs;
      return runs;
    },
    async dispatchWorkflow(workflowFile, ref, inputs) {
      client.dispatched.push({ workflowFile, ref, inputs: { ...inputs } });
    },
  };
  return client;
}

function environment(enabled = true, extra: Record<string, string> = {}) {
  return caseLabEnvironment({ CASE_LAB_GITHUB_TOKEN: TOKEN, CASE_LAB_ENABLED: enabled ? 'true' : 'false', ...extra }, RELEASE);
}

function post(body: string, overrides: Partial<CaseLabHttpRequest> = {}): CaseLabHttpRequest {
  return { method: 'POST', path: '/api/dispatch', contentType: 'application/json', body, ...overrides };
}

function handlerWith(github: GitHubDispatchClient, enabled = true, extra: Record<string, string> = {}) {
  return createCaseLabHandler(environment(enabled, extra), { github, now: () => NOW, randomId: () => 'abcdef01' });
}

describe('caseLabEnvironment', () => {
  it('requires the dispatcher token', () => {
    expect(() => caseLabEnvironment({}, RELEASE)).toThrow(CaseLabConfigurationError);
    expect(() => caseLabEnvironment({}, RELEASE)).toThrow('CASE_LAB_GITHUB_TOKEN must be set');
    expect(() => caseLabEnvironment({ CASE_LAB_GITHUB_TOKEN: '   ' }, RELEASE)).toThrow('CASE_LAB_GITHUB_TOKEN must be set');
  });

  it('refuses to start when any provider or GitHub secret is configured', () => {
    expect([...FORBIDDEN_DISPATCHER_ENV]).toEqual([
      'NEBIUS_API_KEY', 'CONTREE_TOKEN', 'CONTREE_PROJECT', 'TAVILY_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN',
    ]);
    for (const name of FORBIDDEN_DISPATCHER_ENV) {
      expect(() => caseLabEnvironment({ CASE_LAB_GITHUB_TOKEN: TOKEN, [name]: 'x' }, RELEASE))
        .toThrow(`${name} must not be configured on the Case Lab dispatcher`);
      expect(() => caseLabEnvironment({ CASE_LAB_GITHUB_TOKEN: TOKEN, [name]: '' }, RELEASE))
        .toThrow(`${name} must not be configured on the Case Lab dispatcher`);
    }
  });

  it('enables only on the literal string true', () => {
    for (const value of ['TRUE', '1', 'yes', 'on', ' true', undefined]) {
      expect(caseLabEnvironment({ CASE_LAB_GITHUB_TOKEN: TOKEN, CASE_LAB_ENABLED: value }, RELEASE).enabled).toBe(false);
    }
    expect(environment(true).enabled).toBe(true);
  });

  it('validates the release identity and the site origin', () => {
    expect(() => caseLabEnvironment({ CASE_LAB_GITHUB_TOKEN: TOKEN }, { version: '0.2.0', actionSha: 'abc' }))
      .toThrow('release.json must name a version and an exact 40-character actionSha');
    expect(() => environment(true, { CASE_LAB_SITE_ORIGIN: 'http://example.com' }))
      .toThrow('CASE_LAB_SITE_ORIGIN must be an https origin without a path');
    expect(() => environment(true, { CASE_LAB_SITE_ORIGIN: 'https://example.com/path' }))
      .toThrow('CASE_LAB_SITE_ORIGIN must be an https origin without a path');
    expect(environment(true, { CASE_LAB_SITE_ORIGIN: 'https://sutura-case-lab.vercel.app' }).siteOrigin)
      .toBe('https://sutura-case-lab.vercel.app');
  });
});

describe('createCaseLabHandler', () => {
  it('dispatches a valid request with exactly two inputs and a bounded request id', async () => {
    const github = fakeGitHub([run()]);
    const response = await handlerWith(github)(post('{"caseId":"flaky-failure"}'));
    expect(response.status).toBe(202);
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(response.body).toEqual({
      requestId: REQUEST_ID,
      caseId: 'flaky-failure',
      mode: 'live',
      resultPath: `/result/?id=${REQUEST_ID}`,
      runsListUrl: 'https://github.com/juan294/sutura-demo/actions/workflows/case-lab.yml',
    });
    expect(github.listed).toBe(1);
    expect(github.dispatched).toEqual([{
      workflowFile: CASE_LAB_WORKFLOW_FILE,
      ref: 'main',
      inputs: { 'case-id': 'flaky-failure', 'request-id': REQUEST_ID },
    }]);
  });

  it('rejects an invalid body before any GitHub call', async () => {
    const github = fakeGitHub([]);
    const handler = handlerWith(github);
    for (const body of ['{"caseId":"x"}', '{"caseId":"flaky-failure","repo":"a/b"}', 'nope', '[]', '']) {
      const response = await handler(post(body));
      expect(response.status).toBe(400);
      expect(typeof response.body.error).toBe('string');
    }
    expect(github.listed).toBe(0);
    expect(github.dispatched).toEqual([]);
  });

  it('refuses when disabled without dispatching', async () => {
    const github = fakeGitHub([]);
    const response = await handlerWith(github, false)(post('{"caseId":"flaky-failure"}'));
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'disabled', retryAfterSeconds: 3_600, caseId: 'flaky-failure' });
    expect(response.headers['Retry-After']).toBe('3600');
    expect(github.dispatched).toEqual([]);
  });

  it('refuses on concurrency, hourly throttle, and daily spend stop', async () => {
    const active = fakeGitHub([run({ status: 'in_progress', conclusion: null, createdAt: '2026-09-04T12:00:00.000Z' })]);
    const concurrency = await handlerWith(active)(post('{"caseId":"javascript-repair"}'));
    expect(concurrency.status).toBe(429);
    expect(concurrency.body.error).toBe('concurrency');
    expect(active.dispatched).toEqual([]);

    const hourly = fakeGitHub(Array.from({ length: CASE_LAB_LIMITS.maxRunsPerHour }, (_, index) =>
      run({ id: index + 1, createdAt: `2026-09-04T12:0${index}:00.000Z` })));
    const throttled = await handlerWith(hourly)(post('{"caseId":"javascript-repair"}'));
    expect(throttled.status).toBe(429);
    expect(throttled.body.error).toBe('hourly-throttle');
    expect(throttled.headers['Retry-After']).toBe('900');
    expect(hourly.dispatched).toEqual([]);

    const daily = fakeGitHub(Array.from({ length: CASE_LAB_LIMITS.maxRunsPerDay }, (_, index) =>
      run({ id: index + 1, createdAt: `2026-09-04T0${index}:00:00.000Z` })));
    const stopped = await handlerWith(daily)(post('{"caseId":"javascript-repair"}'));
    expect(stopped.status).toBe(429);
    expect(stopped.body.error).toBe('daily-spend-stop');
    expect(daily.dispatched).toEqual([]);
  });

  it('serializes concurrent requests so both cannot pass the concurrency limit', async () => {
    const dispatched: WorkflowRunSummary[] = [];
    const github: GitHubDispatchClient = {
      async listWorkflowRuns() {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return dispatched;
      },
      async dispatchWorkflow(_file, _ref, inputs) {
        dispatched.push(run({ id: dispatched.length + 1, status: 'queued', conclusion: null,
          createdAt: NOW.toISOString(), displayTitle: `Case Lab ${inputs['request-id']} ${inputs['case-id']}` }));
      },
    };
    const handler = handlerWith(github);
    const [first, second] = await Promise.all([
      handler(post('{"caseId":"javascript-repair"}')),
      handler(post('{"caseId":"flaky-failure"}')),
    ]);
    expect([first.status, second.status].sort()).toEqual([202, 429]);
    expect(dispatched).toHaveLength(1);
  });

  it('ignores runs from the previous UTC day for the daily stop but counts them for nothing else', async () => {
    const github = fakeGitHub(Array.from({ length: 20 }, (_, index) =>
      run({ id: index + 1, createdAt: '2026-09-03T23:00:00.000Z' })));
    const response = await handlerWith(github)(post('{"caseId":"javascript-repair"}'));
    expect(response.status).toBe(202);
  });

  it('fails closed when run accounting is unavailable', async () => {
    const github = fakeGitHub(new GitHubDispatchError('list-runs', 502));
    const response = await handlerWith(github)(post('{"caseId":"javascript-repair"}'));
    expect(response.status).toBe(502);
    expect(response.body.error).toBe('run accounting is unavailable; no run was started');
    expect(github.dispatched).toEqual([]);
  });

  it('reports a failed dispatch without claiming a run', async () => {
    const github = fakeGitHub([]);
    github.dispatchWorkflow = async () => { throw new GitHubDispatchError('dispatch', 422); };
    const response = await handlerWith(github)(post('{"caseId":"javascript-repair"}'));
    expect(response.status).toBe(502);
    expect(response.body.error).toBe('dispatch failed; no run was started');
  });

  it('answers method, content-type, and route errors without touching GitHub', async () => {
    const github = fakeGitHub([]);
    const handler = handlerWith(github, true, { CASE_LAB_SITE_ORIGIN: 'https://sutura-case-lab.vercel.app' });
    expect((await handler(post('{}', { method: 'GET' }))).status).toBe(405);
    expect((await handler(post('{}', { contentType: 'text/plain' }))).status).toBe(415);
    expect((await handler(post('{}', { path: '/api/other' }))).status).toBe(404);
    const preflight = await handler(post('', { method: 'OPTIONS' }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers['Access-Control-Allow-Origin']).toBe('https://sutura-case-lab.vercel.app');
    expect(preflight.headers['Access-Control-Allow-Methods']).toBe('POST');
    const health = await handler({ method: 'GET', path: '/api/health', contentType: undefined, body: '' });
    expect(health.status).toBe(200);
    expect(health.body).toEqual({
      enabled: true,
      limits: CASE_LAB_LIMITS,
      release: RELEASE,
      demoRepository: 'juan294/sutura-demo',
      workflow: 'case-lab.yml',
    });
    expect(github.listed).toBe(0);
  });

  it('omits CORS headers when no site origin is configured', async () => {
    const response = await handlerWith(fakeGitHub([]))({ method: 'GET', path: '/api/health', contentType: undefined, body: '' });
    expect(response.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('builds request ids from the clock and eight hex characters', () => {
    expect(liveRequestId(NOW, () => 'abcdef01')).toBe(REQUEST_ID);
    expect(REQUEST_ID).toMatch(/^cl-[0-9]{13}-[a-f0-9]{8}$/u);
    expect(() => liveRequestId(NOW, () => 'xyz')).toThrow('randomId must return 8 lowercase hex characters');
  });
});

describe('Vercel adapters', () => {
  it('import only the shared adapter module, the dispatcher modules, release.json, and node modules', () => {
    for (const file of ['_handler.js', 'dispatch.js', 'health.js']) {
      const source = readFileSync(resolve(import.meta.dirname, '../api', file), 'utf8');
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/gu)].map((match) => match[1]);
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        expect(['../dist/dispatcher.js', '../dist/github.js', '../release.json', './_handler.js'].includes(specifier ?? '') || specifier?.startsWith('node:')).toBe(true);
      }
      expect(source).not.toMatch(/NEBIUS|CONTREE|TAVILY/u);
    }
  });
});
