/// <reference types="node" />

import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  capturedDogfoodReplayBundle,
  successfulCapturedHttp,
} from '../__fixtures__/captured/live-dogfood-replay.test-helper.js';
import {
  ContreeError,
  ContreeExecutor,
  buildSnapshotCommandForTest,
} from './contree.js';

const REPOSITORY_OVERLAY = {
  profile: 'repository',
  mode: 'overlay',
} as const;

const DEPENDENCY_REPLACE = {
  profile: 'dependency-inputs',
  mode: 'replace',
} as const;

const execFileAsync = promisify(execFile);

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'),
  );
}

async function capturedImportImageExchanges(): Promise<Array<{
  request: { method: string; url: string };
  response: { status: number; headers: Record<string, string>; body: string };
}>> {
  const bundle = await capturedDogfoodReplayBundle();
  return successfulCapturedHttp(bundle, 'contree')
    .filter(({ sequence }) => sequence <= 16)
    .map(({ request, response }) => {
      if (typeof response.status !== 'number' || typeof response.body !== 'string') {
        throw new Error('Captured ConTree response body is unavailable');
      }
      return {
        request,
        response: { status: response.status, headers: response.headers ?? {}, body: response.body },
      };
    });
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function neverClosingResponse(status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"status":"EXECUTING"}'));
    },
  });
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function config(fetch: typeof globalThis.fetch, overrides = {}) {
  return {
    token: 'iam-token',
    project: 'project-id',
    fetch,
    pollIntervalMs: 0,
    operationTimeoutMs: 1_000,
    ...overrides,
  };
}

async function listTar(buffer: Uint8Array): Promise<string[]> {
  const child = spawn('tar', ['-tf', '-']);
  const output: Buffer[] = [];
  const errors: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
  child.stdin.end(buffer);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (exitCode !== 0) {
    throw new Error(Buffer.concat(errors).toString('utf8'));
  }

  return Buffer.concat(output).toString('utf8').trim().split('\n');
}

async function readTarEntry(
  buffer: Uint8Array,
  entry: string,
): Promise<string> {
  const child = spawn('tar', ['-xOf', '-', entry]);
  const output: Buffer[] = [];
  const errors: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
  child.stdin.end(buffer);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (exitCode !== 0) {
    throw new Error(Buffer.concat(errors).toString('utf8'));
  }
  return Buffer.concat(output).toString('utf8');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ContreeExecutor', () => {
  it('accepts the captured workflow 33321172589 image-import operation shapes', async () => {
    const exchanges = await capturedImportImageExchanges();
    let index = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const exchange = exchanges[index++];
      if (!exchange) throw new Error('Captured ConTree exchanges are exhausted');
      expect(String(input)).toBe(exchange.request.url);
      expect(init?.method ?? 'GET').toBe(exchange.request.method);
      return new Response(exchange.response.body, {
        status: exchange.response.status,
        headers: exchange.response.headers,
      });
    });
    const executor = new ContreeExecutor(config(fetch, {
      pollIntervalMs: 0,
      operationTimeoutMs: 5_000,
    }));

    await expect(executor.importImage('node:22')).resolves.toBe(
      'd507f8b4-bfc3-3d23-9f96-f310bff17c9b',
    );
    expect(index).toBe(exchanges.length);
  });

  it.each([
    ['token', { token: ' ' }, /token is required/u],
    ['project', { project: ' ' }, /project is required/u],
    ['zero maxOps', { maxOps: 0 }, /positive integer/u],
    ['fractional maxOps', { maxOps: 1.5 }, /positive integer/u],
  ])('rejects invalid synthetic configuration: %s', (_label, override, message) => {
    expect(() => new ContreeExecutor(config(vi.fn<typeof globalThis.fetch>(), override)))
      .toThrow(message);
  });

  it('rejects a duplicate caller operation ID', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.method === 'POST') {
        return jsonResponse({}, 201, { Location: '/sandboxes/v1/operations/one' });
      }
      await gate;
      return jsonResponse(await fixture('operation-success.json'));
    });
    const executor = new ContreeExecutor(config(fetch));
    const first = executor.run('parent', 'first', { operationId: 'duplicate' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await expect(executor.run('parent', 'second', { operationId: 'duplicate' }))
      .rejects.toThrow(/operation ID already exists/u);
    release();
    await first;
  });

  it.each([
    ['missing metadata result', { status: 'SUCCESS', result_image_uuid: 'image' }, /metadata\.result/u],
    ['missing image', {
      status: 'SUCCESS', metadata: { result: { state: { exit_code: 0 } } },
    }, /result image uuid/u],
    ['missing exit code', {
      status: 'SUCCESS', result_image_uuid: 'image', metadata: { result: { state: {} } },
    }, /exit code/u],
    ['invalid stdout value', {
      status: 'SUCCESS', result_image_uuid: 'image', metadata: { result: {
        state: { exit_code: 0 }, stdout: { value: 1, encoding: 'ascii' },
      } },
    }, /stdout value/u],
    ['unsupported stdout encoding', {
      status: 'SUCCESS', result_image_uuid: 'image', metadata: { result: {
        state: { exit_code: 0 }, stdout: { value: 'x', encoding: 'utf16' },
      } },
    }, /stdout has unsupported encoding/u],
    ['invalid stderr value', {
      status: 'SUCCESS', result_image_uuid: 'image', metadata: { result: {
        state: { exit_code: 0 }, stderr: { value: 1, encoding: 'ascii' },
      } },
    }, /stderr value/u],
    ['unsupported stderr encoding', {
      status: 'SUCCESS', result_image_uuid: 'image', metadata: { result: {
        state: { exit_code: 0 }, stderr: { value: 'x', encoding: 'utf16' },
      } },
    }, /stderr has unsupported encoding/u],
  ] as const)('rejects synthetic operation shape: %s', async (_label, operation, message) => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 201, {
        Location: '/sandboxes/v1/operations/shape',
      }))
      .mockResolvedValueOnce(jsonResponse(operation));
    await expect(new ContreeExecutor(config(fetch)).run('parent', 'true'))
      .rejects.toThrow(message);
  });

  it('rejects missing and cross-origin operation locations', async () => {
    const missing = new ContreeExecutor(config(
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({}, 201)),
    ));
    await expect(missing.run('parent', 'true')).rejects.toThrow(/Location header/u);

    const foreign = new ContreeExecutor(config(
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({}, 201, {
        Location: 'https://attacker.example/operations/one',
      })),
    ));
    await expect(foreign.run('parent', 'true')).rejects.toThrow(/configured origin/u);
  });

  it.each(['FAILED', 'CANCELLED'] as const)(
    'rejects a terminal %s operation with bounded detail',
    async (status) => {
      const fetch = vi.fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse({}, 201, {
          Location: '/sandboxes/v1/operations/terminal',
        }))
        .mockResolvedValueOnce(jsonResponse({ status, error: 'synthetic detail' }));
      await expect(new ContreeExecutor(config(fetch)).run('parent', 'true'))
        .rejects.toThrow(new RegExp(`${status}: synthetic detail`, 'u'));
    },
  );
  it('maps run options to the documented request and decodes the result fixture', async () => {
    const pending = await fixture('operation-pending.json');
    const success = await fixture('operation-success.json');
    const responses = [
      jsonResponse({ uuid: 'operation-1' }, 201, {
        Location: '/sandboxes/v1/operations/operation-1',
      }),
      jsonResponse(pending),
      jsonResponse(success),
    ];
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      const response = responses.shift();
      if (!response) throw new Error('unexpected request');
      return response;
    });
    const executor = new ContreeExecutor(config(fetch));

    const result = await executor.run('image-parent', 'echo $GREETING', {
      cwd: '/repo',
      env: { GREETING: 'hello' },
      timeoutSec: 15,
    });

    expect(fetch).toHaveBeenCalledTimes(3);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://api.tokenfactory.nebius.com/sandboxes/v1/instances',
    );
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer iam-token',
        Project: 'project-id',
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      image: 'image-parent',
      command: 'echo $GREETING',
      shell: true,
      env: { GREETING: 'hello' },
      timeout: 15,
      cwd: '/repo',
      networking: { enabled: false },
    });
    expect(result).toEqual({
      imageId: 'image-child',
      exitCode: 0,
      stdout: 'hello\n',
      stderr: 'warning\n',
      truncated: true,
      metrics: {
        cost: 0.0025,
        elapsedTimeSec: 1.25,
        maxRssKb: 4096,
        systemCpuTimeSec: 0.1,
        userCpuTimeSec: 0.2,
      },
    });
  });

  it('enables networking only when the caller selects the explicit policy', async () => {
    const success = await fixture('operation-success.json');
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ uuid: 'operation-1' }, 201, {
          Location: '/sandboxes/v1/operations/operation-1',
        }),
      )
      .mockResolvedValueOnce(jsonResponse(success));

    await new ContreeExecutor(config(fetch)).run('parent', 'install', {
      network: 'enabled',
    });

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      networking: { enabled: true },
    });
  });

  it('imports a registry image through an asynchronous operation', async () => {
    const success = await fixture('image-import-success.json');
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ uuid: 'import-operation' }, 201, {
          Location: '/v1/operations/import-operation',
        }),
      )
      .mockResolvedValueOnce(jsonResponse(success));
    const executor = new ContreeExecutor(config(fetch));

    await expect(executor.importImage('node:22-slim')).resolves.toBe(
      'image-imported',
    );

    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://api.tokenfactory.nebius.com/sandboxes/v1/images/import',
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      registry: { url: 'docker://docker.io/library/node:22-slim' },
    });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      'https://api.tokenfactory.nebius.com/sandboxes/v1/operations/import-operation',
    );
  });

  it('surfaces the response body for non-success status codes', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('project is not authorized', { status: 403 }));
    const executor = new ContreeExecutor(config(fetch));

    await expect(executor.run('parent', 'true')).rejects.toEqual(
      expect.objectContaining<Partial<ContreeError>>({
        name: 'ContreeError',
        status: 403,
        body: 'project is not authorized',
      }),
    );
  });

  it('cancels the operation when polling reaches the client timeout', async () => {
    vi.useFakeTimers();
    const pending = await fixture('operation-pending.json');
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.method === 'POST') {
        return jsonResponse({ uuid: 'operation-1' }, 201, {
          Location: '/sandboxes/v1/operations/operation-1',
        });
      }
      if (init?.method === 'DELETE') {
        return new Response(null, { status: 202 });
      }
      return jsonResponse(pending);
    });
    const executor = new ContreeExecutor(
      config(fetch, { pollIntervalMs: 10, operationTimeoutMs: 15 }),
    );

    const run = executor.run('parent', 'sleep forever');
    const rejection = expect(run).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(30);

    await rejection;
    expect(fetch).toHaveBeenCalledWith(
      'https://api.tokenfactory.nebius.com/sandboxes/v1/operations/operation-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('aborts a hung poll and separately bounds a hung cancellation request', async () => {
    vi.useFakeTimers();
    let pollAborted = false;
    let cancellationSignal: AbortSignal | null | undefined;
    const waitForAbort = (signal: AbortSignal | null | undefined) =>
      new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          pollAborted = true;
          reject(signal.reason);
        });
      });
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.method === 'POST') {
        return jsonResponse({ uuid: 'operation-1' }, 201, {
          Location: '/sandboxes/v1/operations/operation-1',
        });
      }
      if (init?.method === 'DELETE') {
        cancellationSignal = init.signal;
        return neverClosingResponse(500);
      }
      return waitForAbort(init?.signal);
    });
    const executor = new ContreeExecutor(
      config(fetch, {
        pollIntervalMs: 0,
        operationTimeoutMs: 20,
        cancelTimeoutMs: 10,
      }),
    );

    const run = executor.run('parent', 'hang');
    const rejection = expect(run).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(20);
    expect(pollAborted).toBe(true);

    await vi.advanceTimersByTimeAsync(10);
    await rejection;
    expect(cancellationSignal?.aborted).toBe(true);
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(
      true,
    );
  });

  it('keeps the deadline active while consuming a stalled poll JSON body', async () => {
    vi.useFakeTimers();
    let pollSignal: AbortSignal | null | undefined;
    let cancelled = false;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.method === 'POST') {
        return jsonResponse({ uuid: 'operation-1' }, 201, {
          Location: '/sandboxes/v1/operations/operation-1',
        });
      }
      if (init?.method === 'DELETE') {
        cancelled = true;
        return new Response(null, { status: 202 });
      }
      pollSignal = init?.signal;
      return neverClosingResponse();
    });
    const executor = new ContreeExecutor(
      config(fetch, { operationTimeoutMs: 20, cancelTimeoutMs: 10 }),
    );

    const run = executor.run('parent', 'hang-on-json');
    const rejection = expect(run).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(20);

    expect(pollSignal?.aborted).toBe(true);
    expect(cancelled).toBe(true);
    await rejection;
  });

  it('bounds a stalled non-success response body before cancelling', async () => {
    vi.useFakeTimers();
    let errorSignal: AbortSignal | null | undefined;
    let cancelled = false;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.method === 'POST') {
        return jsonResponse({ uuid: 'operation-1' }, 201, {
          Location: '/sandboxes/v1/operations/operation-1',
        });
      }
      if (init?.method === 'DELETE') {
        cancelled = true;
        return new Response(null, { status: 202 });
      }
      errorSignal = init?.signal;
      return neverClosingResponse(500);
    });
    const executor = new ContreeExecutor(
      config(fetch, { operationTimeoutMs: 20, cancelTimeoutMs: 10 }),
    );

    const run = executor.run('parent', 'hang-on-error-text');
    const rejection = expect(run).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(20);

    expect(errorSignal?.aborted).toBe(true);
    expect(cancelled).toBe(true);
    await rejection;
  });

  it('backs off between non-terminal operation polls', async () => {
    vi.useFakeTimers();
    const pending = await fixture('operation-pending.json');
    const success = await fixture('operation-success.json');
    const responses = [
      jsonResponse({ uuid: 'operation-1' }, 201, {
        Location: '/sandboxes/v1/operations/operation-1',
      }),
      jsonResponse(pending),
      jsonResponse(pending),
      jsonResponse(success),
    ];
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      const response = responses.shift();
      if (!response) throw new Error('unexpected request');
      return response;
    });
    const executor = new ContreeExecutor(
      config(fetch, { pollIntervalMs: 10, operationTimeoutMs: 100 }),
    );

    const run = executor.run('parent', 'true');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(fetch).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(10);
    expect(fetch).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(10);
    await expect(run).resolves.toEqual(expect.objectContaining({ exitCode: 0 }));
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('recomputes the remaining deadline after a slow poll response', async () => {
    vi.useFakeTimers();
    const pending = await fixture('operation-pending.json');
    let cancelled = false;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.method === 'POST') {
        return jsonResponse({ uuid: 'operation-1' }, 201, {
          Location: '/sandboxes/v1/operations/operation-1',
        });
      }
      if (init?.method === 'DELETE') {
        cancelled = true;
        return new Response(null, { status: 202 });
      }
      return new Promise<Response>((resolve) => {
        setTimeout(() => resolve(jsonResponse(pending)), 8);
      });
    });
    const executor = new ContreeExecutor(
      config(fetch, { pollIntervalMs: 10, operationTimeoutMs: 15 }),
    );

    const run = executor.run('parent', 'true');
    const rejection = expect(run).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(15);

    expect(cancelled).toBe(true);
    await rejection;
  });

  it('limits all concurrent instance operations to maxOps', async () => {
    let operation = 0;
    let inFlight = 0;
    let highWater = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      if (init?.method === 'POST') {
        operation += 1;
        inFlight += 1;
        highWater = Math.max(highWater, inFlight);
        return jsonResponse({ uuid: `operation-${operation}` }, 201, {
          Location: `/sandboxes/v1/operations/operation-${operation}`,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      const id = String(url).split('/').at(-1);
      return jsonResponse({
        uuid: id,
        kind: 'instance',
        status: 'SUCCESS',
        result_image_uuid: `image-${id}`,
        metadata: {
          result: {
            state: { exit_code: 0 },
            stdout: { value: '', encoding: 'ascii', truncated: false },
            stderr: { value: '', encoding: 'ascii', truncated: false },
            resources: {},
          },
        },
      });
    });
    const executor = new ContreeExecutor(config(fetch, { maxOps: 2 }));

    const results = await executor.runMany(
      'parent',
      Array.from({ length: 5 }, (_, index) => `command-${index}`),
      { cwd: '/workspace' },
    );

    expect(results).toHaveLength(5);
    expect(highWater).toBe(2);
    const requestBodies = fetch.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)) as { cwd?: string });
    expect(requestBodies.every(({ cwd }) => cwd === '/workspace')).toBe(true);
  });

  it('exposes cancellation by stable caller ID and resolves a completion race once', async () => {
    let cancelled = false;
    const pending = await fixture('operation-pending.json');
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.method === 'POST') {
        return jsonResponse({ uuid: 'operation-1' }, 201, { Location: '/sandboxes/v1/operations/operation-1' });
      }
      if (init?.method === 'DELETE') {
        cancelled = true;
        return new Response(null, { status: 202 });
      }
      return cancelled ? jsonResponse({ status: 'CANCELLED' }) : jsonResponse(pending);
    });
    const executor = new ContreeExecutor(config(fetch, { maxOps: 2, pollIntervalMs: 0 }));
    const run = executor.run('parent', 'slow', { operationId: 'search-001' });
    await vi.waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === 'GET')).toBe(true));
    expect(executor.operationCapacity()).toEqual({ limit: 2, active: 1, available: 1 });
    await expect(executor.cancel('search-001')).resolves.toEqual({ operationId: 'search-001', requested: true });
    await expect(run).rejects.toThrow(/cancelled/i);
    await expect(executor.cancel('search-001')).resolves.toEqual({ operationId: 'search-001', requested: false, terminal: 'cancelled' });
    expect(executor.completions).toEqual([{ operationId: 'search-001', terminal: 'cancelled', cancellationRequested: true }]);
    expect(executor.operationCapacity()).toEqual({ limit: 2, active: 0, available: 2 });
  });

  it('does not fabricate cancellation state for an unknown operation', async () => {
    const executor = new ContreeExecutor(config(vi.fn<typeof globalThis.fetch>()));
    await expect(executor.cancel('missing')).resolves.toEqual({ operationId: 'missing', requested: false });
    expect(executor.completions).toEqual([]);
  });

  it('does not record cancelled when the cancellation request fails', async () => {
    const pending = await fixture('operation-pending.json');
    const success = await fixture('operation-success.json');
    let polls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.method === 'POST') {
        return jsonResponse({ uuid: 'operation-1' }, 201, { Location: '/sandboxes/v1/operations/operation-1' });
      }
      if (init?.method === 'DELETE') return new Response('cannot cancel', { status: 500 });
      polls += 1;
      if (polls === 1) return jsonResponse(pending);
      await gate;
      return jsonResponse(success);
    });
    const executor = new ContreeExecutor(config(fetch, { pollIntervalMs: 0 }));
    const run = executor.run('parent', 'slow', { operationId: 'search-001' });
    await vi.waitFor(() => expect(polls).toBeGreaterThan(0));
    await expect(executor.cancel('search-001')).rejects.toThrow(/HTTP 500/u);
    expect(executor.completions).toEqual([]);
    release();
    await expect(run).resolves.toMatchObject({
      operation: { operationId: 'search-001', terminal: 'succeeded', cancellationRequested: false },
    });
  });

  it('cancels a queued operation without starting replacement provider work', async () => {
    const success = await fixture('operation-success.json');
    let posts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.method === 'POST') {
        posts += 1;
        return jsonResponse({ uuid: `operation-${posts}` }, 201, {
          Location: `/sandboxes/v1/operations/operation-${posts}`,
        });
      }
      await gate;
      return jsonResponse(success);
    });
    const executor = new ContreeExecutor(config(fetch, { maxOps: 1 }));
    const first = executor.run('parent', 'first', { operationId: 'search-001' });
    const queued = executor.run('parent', 'queued', { operationId: 'search-002' });
    await vi.waitFor(() => expect(posts).toBe(1));
    await expect(executor.cancel('search-002')).resolves.toEqual({
      operationId: 'search-002', requested: true, terminal: 'cancelled',
    });
    release();
    await expect(first).resolves.toMatchObject({ exitCode: 0 });
    await expect(queued).rejects.toThrow(/cancelled before it started/u);
    expect(posts).toBe(1);
    expect(executor.completions.filter(({ operationId }) => operationId === 'search-002')).toEqual([
      { operationId: 'search-002', terminal: 'cancelled', cancellationRequested: true },
    ]);
  });

  it('uploads the current safe worktree and replaces the destination snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-snapshot-'));
    try {
      await execFileAsync('git', ['init', '--quiet', dir]);
      await execFileAsync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
      await execFileAsync('git', ['-C', dir, 'config', 'user.name', 'Test User']);
      await writeFile(join(dir, '.gitignore'), 'ignored.txt\n');
      await writeFile(join(dir, 'included.txt'), 'original');
      await writeFile(join(dir, 'deleted.txt'), 'remove me');
      await writeFile(join(dir, 'ignored.txt'), 'ignore me');
      await writeFile(join(dir, '.env'), 'TOKEN=secret');
      await writeFile(join(dir, 'private.pem'), 'secret key');
      await execFileAsync('git', [
        '-C',
        dir,
        'add',
        '-f',
        '.gitignore',
        'included.txt',
        'deleted.txt',
        '.env',
        'private.pem',
      ]);
      await execFileAsync('git', ['-C', dir, 'commit', '--quiet', '-m', 'baseline']);
      await writeFile(join(dir, 'included.txt'), 'modified');
      await writeFile(join(dir, 'untracked.txt'), 'new file');
      await rm(join(dir, 'deleted.txt'));
      if (process.platform === 'darwin') {
        await execFileAsync('xattr', [
          '-w',
          'com.apple.ResourceFork',
          'metadata',
          join(dir, 'included.txt'),
        ]);
      }

      let uploaded: Uint8Array | undefined;
      const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
        if (String(url).endsWith('/files')) {
          expect(init?.body).toBeInstanceOf(ReadableStream);
          const body = new Uint8Array(await new Response(init?.body).arrayBuffer());
          uploaded ??= body;
          return jsonResponse({ uuid: 'file-uuid', sha256: 'abc', size: 123 }, 201);
        }
        if (String(url).endsWith('/instances')) {
          const body = JSON.parse(String(init?.body));
          expect(body).toMatchObject({
            image: 'base-image',
            command: expect.stringMatching(/refuses symlink parent[\s\S]*tar -xf/),
            networking: { enabled: false },
            files: {
              '/tmp/sutura-snapshot.tar': {
                uuid: 'file-uuid',
                uid: 0,
                gid: 0,
                mode: '0600',
              },
            },
          });
          expect(body.command).toContain("if [ -L '/workspace' ]");
          expect(body.command).toContain('refuses preparation path collision');
          expect(body.command).not.toContain('rm -rf /workspace');
          return jsonResponse({ uuid: 'snapshot-operation' }, 201, {
            Location: '/sandboxes/v1/operations/snapshot-operation',
          });
        }
        return jsonResponse({
          uuid: 'snapshot-operation',
          kind: 'instance',
          status: 'SUCCESS',
          result_image_uuid: 'snapshot-image',
          metadata: {
            result: {
              state: { exit_code: 0 },
              stdout: { value: '', encoding: 'ascii', truncated: false },
              stderr: { value: '', encoding: 'ascii', truncated: false },
              resources: {},
            },
          },
        });
      });
      const executor = new ContreeExecutor(config(fetch));

      await expect(executor.snapshot(dir, 'base-image', REPOSITORY_OVERLAY)).resolves.toBe(
        'snapshot-image',
      );
      expect(uploaded).toBeDefined();
      const entries = await listTar(uploaded ?? new Uint8Array());
      expect(entries).toContain('included.txt');
      expect(entries).toContain('untracked.txt');
      expect(entries).toContain('.gitignore');
      expect(entries).not.toContain('deleted.txt');
      expect(entries).not.toContain('ignored.txt');
      expect(entries).not.toContain('.env');
      expect(entries).not.toContain('private.pem');
      expect(entries.every((entry) => !entry.includes('node_modules'))).toBe(
        true,
      );
      expect(
        entries.every((entry) =>
          entry.split('/').every((segment) => !segment.startsWith('._')),
        ),
      ).toBe(true);
      const archiveText = Buffer.from(
        uploaded ?? new Uint8Array(),
      ).toString('latin1');
      expect(archiveText).not.toMatch(/(?:^|[/\0])\._[^/\0]+/u);
      expect(await readTarEntry(uploaded ?? new Uint8Array(), 'included.txt')).toBe(
        'modified',
      );
      expect(await readTarEntry(uploaded ?? new Uint8Array(), 'untracked.txt')).toBe(
        'new file',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uploads only dependency manifests before network-enabled preparation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-contree-placebo-'));
    try {
      await writeFile(join(dir, 'package.json'), JSON.stringify({
        scripts: { test: 'vitest run' },
        dependencies: {
          chalk: 'file:vendor/chalk-v5',
          execa: 'file:vendor/execa-v6',
          got: 'file:vendor/got-v12',
          'node-fetch': 'file:vendor/node-fetch-v3',
        },
      }));
      await writeFile(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
      await mkdir(join(dir, 'packages', 'core'), { recursive: true });
      await writeFile(join(dir, 'packages', 'core', 'package.json'), '{"name":"core"}\n');
      await mkdir(join(dir, 'fixtures', 'untrusted'), { recursive: true });
      await writeFile(join(dir, 'fixtures', 'untrusted', 'package.json'), '{"name":"fixture"}\n');
      for (const dependency of ['chalk-v5', 'execa-v6', 'got-v12', 'node-fetch-v3']) {
        await mkdir(join(dir, 'vendor', dependency), { recursive: true });
        await writeFile(
          join(dir, 'vendor', dependency, 'package.json'),
          `${JSON.stringify({
            name: dependency,
            version: '1.0.0',
            ...(dependency === 'chalk-v5' ? { scripts: { test: 'node --test' } } : {}),
          })}\n`,
        );
        await writeFile(join(dir, 'vendor', dependency, 'index.js'), 'export const fixture = true;\n');
      }
      await writeFile(join(dir, '.env'), 'TOKEN=never-upload\n');
      await mkdir(join(dir, 'node_modules', 'vitest'), { recursive: true });
      await writeFile(join(dir, 'node_modules', 'vitest', 'index.js'), 'export const test = true;\n');

      let uploaded: Uint8Array | undefined;
      const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
        if (String(url).endsWith('/files')) {
          const body = new Uint8Array(await new Response(init?.body).arrayBuffer());
          uploaded ??= body;
          return jsonResponse({ uuid: 'file-uuid' }, 201);
        }
        if (String(url).endsWith('/instances')) {
          return jsonResponse({ uuid: 'snapshot-operation' }, 201, {
            Location: '/sandboxes/v1/operations/snapshot-operation',
          });
        }
        return jsonResponse({
          status: 'SUCCESS',
          result_image_uuid: 'snapshot-image',
          metadata: {
            result: {
              state: { exit_code: 0 },
              stdout: { value: '', encoding: 'ascii' },
              stderr: { value: '', encoding: 'ascii' },
              resources: {},
            },
          },
        });
      });

      await expect(new ContreeExecutor(config(fetch)).snapshot(
        dir,
        'base-image',
        DEPENDENCY_REPLACE,
      ))
        .resolves.toBe('snapshot-image');
      const entries = await listTar(uploaded ?? new Uint8Array());
      expect(entries).toContain('package.json');
      expect(entries).toContain('pnpm-workspace.yaml');
      expect(entries).toContain('packages/core/package.json');
      for (const dependency of ['chalk-v5', 'execa-v6', 'got-v12', 'node-fetch-v3']) {
        expect(entries).toContain(`vendor/${dependency}/package.json`);
        expect(entries).toContain(`vendor/${dependency}/index.js`);
      }
      expect(entries).not.toContain('fixtures/untrusted/package.json');
      expect(entries).not.toContain('node_modules/vitest/index.js');
      expect(entries).not.toContain('.env');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uploads only the runtime-approved Python dependency inputs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-contree-python-inputs-'));
    try {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "safe"\n');
      await writeFile(join(dir, 'uv.lock'), 'version = 1\n');
      await writeFile(join(dir, 'requirements-dev.txt'), 'unvalidated==1\n');
      await writeFile(join(dir, 'package.json'), '{"name":"unvalidated"}\n');
      await writeFile(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
      await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages: ["packages/*"]\n');
      await writeFile(join(dir, 'unapproved.txt'), 'must not upload\n');

      let uploaded: Uint8Array | undefined;
      const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
        if (String(url).endsWith('/files')) {
          const body = new Uint8Array(await new Response(init?.body).arrayBuffer());
          uploaded ??= body;
          return jsonResponse({ uuid: 'file-uuid' }, 201);
        }
        if (String(url).endsWith('/instances')) {
          return jsonResponse({ uuid: 'snapshot-operation' }, 201, {
            Location: '/sandboxes/v1/operations/snapshot-operation',
          });
        }
        return jsonResponse({
          status: 'SUCCESS',
          result_image_uuid: 'snapshot-image',
          metadata: {
            result: {
              state: { exit_code: 0 },
              stdout: { value: '', encoding: 'ascii' },
              stderr: { value: '', encoding: 'ascii' },
              resources: {},
            },
          },
        });
      });

      await expect(new ContreeExecutor(config(fetch)).snapshot(
        dir,
        'base-image',
        {
          ...DEPENDENCY_REPLACE,
          includePaths: ['pyproject.toml', 'uv.lock'],
        },
      )).resolves.toBe('snapshot-image');

      expect((await listTar(uploaded ?? new Uint8Array())).sort()).toEqual([
        'pyproject.toml',
        'uv.lock',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects registry credentials before uploading dependency inputs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-contree-credentials-'));
    const fetch = vi.fn<typeof globalThis.fetch>();
    try {
      await writeFile(
        join(dir, 'package.json'),
        '{"resolved":"https://token@example.test/package.tgz"}\n',
      );

      await expect(new ContreeExecutor(config(fetch)).snapshot(
        dir,
        'base-image',
        DEPENDENCY_REPLACE,
      )).rejects.toThrow(/embedded registry credentials/u);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects an ignored npmrc before uploading dependency inputs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-contree-npmrc-'));
    const fetch = vi.fn<typeof globalThis.fetch>();
    try {
      await execFileAsync('git', ['init', '--quiet', dir]);
      await writeFile(join(dir, '.gitignore'), '.npmrc\n');
      await writeFile(join(dir, '.npmrc'), '//registry.example.test/:_authToken=secret\n');
      await writeFile(join(dir, 'package.json'), '{"name":"fixture"}\n');

      await expect(new ContreeExecutor(config(fetch)).snapshot(
        dir,
        'base-image',
        DEPENDENCY_REPLACE,
      )).rejects.toThrow(/repository \.npmrc credentials/u);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects installed dependency paths from a repository overlay', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-contree-real-placebo-'));
    try {
      await execFileAsync('git', ['init', '--quiet', dir]);
      await mkdir(join(dir, 'node_modules', 'unsafe'), { recursive: true });
      await writeFile(join(dir, 'node_modules', 'unsafe', 'index.js'), 'unsafe\n');
      await execFileAsync('git', [
        '-C',
        dir,
        'add',
        '-f',
        'node_modules/unsafe/index.js',
      ]);
      const fetch = vi.fn<typeof globalThis.fetch>();

      await expect(new ContreeExecutor(config(fetch)).snapshot(
        dir,
        'base-image',
        REPOSITORY_OVERLAY,
      )).rejects.toThrow(/installed dependency path/u);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects oversized and symlinked non-git snapshots before upload', async () => {
    const oversized = await mkdtemp(join(tmpdir(), 'sutura-contree-oversized-'));
    const gitOversized = await mkdtemp(join(tmpdir(), 'sutura-contree-git-oversized-'));
    const linked = await mkdtemp(join(tmpdir(), 'sutura-contree-linked-'));
    const outside = await mkdtemp(join(tmpdir(), 'sutura-contree-outside-'));
    const fetch = vi.fn<typeof globalThis.fetch>();
    try {
      await writeFile(join(oversized, 'huge.bin'), '');
      await truncate(join(oversized, 'huge.bin'), 256 * 1_024 * 1_024 + 1);
      await execFileAsync('git', ['init', '--quiet'], { cwd: gitOversized });
      await writeFile(join(gitOversized, 'huge.bin'), '');
      await truncate(join(gitOversized, 'huge.bin'), 256 * 1_024 * 1_024 + 1);
      await writeFile(join(outside, 'source.js'), 'export const value = 1;\n');
      await symlink(relative(linked, join(outside, 'source.js')), join(linked, 'source.js'));

      const executor = new ContreeExecutor(config(fetch));
      await expect(executor.snapshot(oversized, 'base-image', REPOSITORY_OVERLAY)).rejects.toThrow(/source bytes/);
      await expect(executor.snapshot(gitOversized, 'base-image', REPOSITORY_OVERLAY)).rejects.toThrow(/source bytes/);
      await expect(executor.snapshot(linked, 'base-image', REPOSITORY_OVERLAY)).rejects.toThrow(/escaping or sensitive symlink/);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await rm(oversized, { recursive: true, force: true });
      await rm(gitOversized, { recursive: true, force: true });
      await rm(linked, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects absolute, dangling, cyclic, and sensitive non-git symlinks', async () => {
    const absolute = await mkdtemp(join(tmpdir(), 'sutura-contree-absolute-'));
    const dangling = await mkdtemp(join(tmpdir(), 'sutura-contree-dangling-'));
    const cyclic = await mkdtemp(join(tmpdir(), 'sutura-contree-cyclic-'));
    const sensitive = await mkdtemp(join(tmpdir(), 'sutura-contree-sensitive-'));
    const outside = await mkdtemp(join(tmpdir(), 'sutura-contree-target-'));
    const fetch = vi.fn<typeof globalThis.fetch>();
    try {
      const outsideFile = join(outside, 'outside.js');
      await writeFile(outsideFile, 'export const outside = true;\n');
      await symlink(outsideFile, join(absolute, 'absolute.js'));
      await symlink('missing.js', join(dangling, 'dangling.js'));
      await symlink('b.js', join(cyclic, 'a.js'));
      await symlink('a.js', join(cyclic, 'b.js'));
      await writeFile(join(sensitive, '.env'), 'TOKEN=secret\n');
      await symlink('.env', join(sensitive, 'config.js'));

      const executor = new ContreeExecutor(config(fetch));
      await expect(executor.snapshot(absolute, 'base-image', REPOSITORY_OVERLAY)).rejects.toThrow(/absolute symlink/);
      await expect(executor.snapshot(dangling, 'base-image', REPOSITORY_OVERLAY)).rejects.toThrow(/dangling or cyclic symlink/);
      await expect(executor.snapshot(cyclic, 'base-image', REPOSITORY_OVERLAY)).rejects.toThrow(/dangling or cyclic symlink/);
      await expect(executor.snapshot(sensitive, 'base-image', REPOSITORY_OVERLAY)).rejects.toThrow(/escaping or sensitive symlink/);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await rm(absolute, { recursive: true, force: true });
      await rm(dangling, { recursive: true, force: true });
      await rm(cyclic, { recursive: true, force: true });
      await rm(sensitive, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects tracked escaping and dependency-input symlinks before upload', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'sutura-contree-git-link-'));
    const dependency = await mkdtemp(join(tmpdir(), 'sutura-contree-dep-link-'));
    const outside = await mkdtemp(join(tmpdir(), 'sutura-contree-git-outside-'));
    const fetch = vi.fn<typeof globalThis.fetch>();
    try {
      await writeFile(join(outside, 'outside.js'), 'secret\n');
      await execFileAsync('git', ['init', '--quiet', repository]);
      await symlink(relative(repository, join(outside, 'outside.js')), join(repository, 'source.js'));
      await execFileAsync('git', ['-C', repository, 'add', 'source.js']);

      await execFileAsync('git', ['init', '--quiet', dependency]);
      await writeFile(join(dependency, 'package.json'), '{"name":"root"}\n');
      await writeFile(join(dependency, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
      await mkdir(join(dependency, 'packages', 'core'), { recursive: true });
      await symlink('../../package.json', join(dependency, 'packages', 'core', 'package.json'));
      await execFileAsync('git', ['-C', dependency, 'add', '.']);

      const executor = new ContreeExecutor(config(fetch));
      await expect(executor.snapshot(repository, 'base', REPOSITORY_OVERLAY))
        .rejects.toThrow(/escaping or sensitive symlink/u);
      await expect(executor.snapshot(dependency, 'base', DEPENDENCY_REPLACE))
        .rejects.toThrow(/dependency snapshot refuses symlink/u);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await rm(repository, { recursive: true, force: true });
      await rm(dependency, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects unknown snapshot profiles and invalid profile-mode pairs before upload', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const executor = new ContreeExecutor(config(fetch));

    await expect(executor.snapshot('.', 'base', {
      profile: 'unknown',
      mode: 'replace',
    } as never)).rejects.toThrow(/snapshot profile/u);
    await expect(executor.snapshot('.', 'base', {
      profile: 'repository',
      mode: 'replace',
    })).rejects.toThrow(/snapshot profile.*mode/u);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid approved dependency path sets before filesystem access', async () => {
    const executor = new ContreeExecutor(config(vi.fn<typeof globalThis.fetch>()));
    const invalidSets = [
      [],
      ['package.json', 'package.json'],
      Array.from({ length: 17 }, (_, index) => `file-${index}.json`),
    ];
    for (const includePaths of invalidSets) {
      await expect(executor.snapshot('.', 'base', {
        ...DEPENDENCY_REPLACE,
        includePaths,
      })).rejects.toThrow(/approved path set is invalid/u);
    }
    await expect(executor.snapshot('.', 'base', {
      ...DEPENDENCY_REPLACE,
      includePaths: ['../package.json'],
    })).rejects.toThrow(/unsafe archive path/u);
  });

  it('rejects unapproved and non-regular approved dependency inputs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-contree-approved-'));
    const executor = new ContreeExecutor(config(vi.fn<typeof globalThis.fetch>()));
    try {
      await writeFile(join(dir, 'source.ts'), 'export {}\n');
      await mkdir(join(dir, 'package.json'));
      await expect(executor.snapshot(dir, 'base', {
        ...DEPENDENCY_REPLACE,
        includePaths: ['source.ts'],
      })).rejects.toThrow(/unapproved input kind/u);
      await expect(executor.snapshot(dir, 'base', {
        ...DEPENDENCY_REPLACE,
        includePaths: ['package.json'],
      })).rejects.toThrow(/requires a regular file/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid, oversized, and unsafe workspace controls', async () => {
    const invalid = await mkdtemp(join(tmpdir(), 'sutura-contree-invalid-workspace-'));
    const oversized = await mkdtemp(join(tmpdir(), 'sutura-contree-large-workspace-'));
    const unsafe = await mkdtemp(join(tmpdir(), 'sutura-contree-unsafe-workspace-'));
    const executor = new ContreeExecutor(config(vi.fn<typeof globalThis.fetch>()));
    try {
      await writeFile(join(invalid, 'package.json'), '{');
      await expect(executor.snapshot(invalid, 'base', DEPENDENCY_REPLACE))
        .rejects.toThrow(/invalid package\.json/u);

      await writeFile(join(oversized, 'package.json'), '{}');
      await writeFile(join(oversized, 'pnpm-workspace.yaml'), 'x'.repeat(1_048_577));
      await expect(executor.snapshot(oversized, 'base', DEPENDENCY_REPLACE))
        .rejects.toThrow(/workspace file is too large/u);

      await writeFile(join(unsafe, 'package.json'), JSON.stringify({ workspaces: ['../outside'] }));
      await expect(executor.snapshot(unsafe, 'base', DEPENDENCY_REPLACE))
        .rejects.toThrow(/unsafe workspace pattern/u);
    } finally {
      await rm(invalid, { recursive: true, force: true });
      await rm(oversized, { recursive: true, force: true });
      await rm(unsafe, { recursive: true, force: true });
    }
  });

  it('rejects unsafe or executable vendored local dependencies before upload', async () => {
    const unsafe = await mkdtemp(join(tmpdir(), 'sutura-contree-unsafe-local-'));
    const scripted = await mkdtemp(join(tmpdir(), 'sutura-contree-scripted-local-'));
    const executor = new ContreeExecutor(config(vi.fn<typeof globalThis.fetch>()));
    try {
      await writeFile(join(unsafe, 'package.json'), JSON.stringify({
        dependencies: { fixture: 'file:../outside' },
      }));
      await expect(executor.snapshot(unsafe, 'base', DEPENDENCY_REPLACE))
        .rejects.toThrow(/unsafe local dependency/u);

      await mkdir(join(scripted, 'vendor', 'fixture'), { recursive: true });
      await writeFile(join(scripted, 'package.json'), JSON.stringify({
        dependencies: { fixture: 'file:vendor/fixture' },
      }));
      await writeFile(join(scripted, 'vendor', 'fixture', 'package.json'), JSON.stringify({
        name: 'fixture', version: '1.0.0', scripts: { install: 'node install.js' },
      }));
      await expect(executor.snapshot(scripted, 'base', DEPENDENCY_REPLACE))
        .rejects.toThrow(/lifecycle scripts are unsupported/u);
    } finally {
      await rm(unsafe, { recursive: true, force: true });
      await rm(scripted, { recursive: true, force: true });
    }
  });

  it('rejects .npmrc in repository snapshots for git and non-git paths', async () => {
    const tracked = await mkdtemp(join(tmpdir(), 'sutura-contree-tracked-npmrc-'));
    const plain = await mkdtemp(join(tmpdir(), 'sutura-contree-plain-npmrc-'));
    const executor = new ContreeExecutor(config(vi.fn<typeof globalThis.fetch>()));
    try {
      await execFileAsync('git', ['init', '--quiet', tracked]);
      await writeFile(join(tracked, '.npmrc'), '_authToken=secret\n');
      await execFileAsync('git', ['-C', tracked, 'add', '-f', '.npmrc']);
      await writeFile(join(plain, '.npmrc'), '_authToken=secret\n');
      await expect(executor.snapshot(tracked, 'base', REPOSITORY_OVERLAY))
        .rejects.toThrow(/repository \.npmrc credentials/u);
      await expect(executor.snapshot(plain, 'base', REPOSITORY_OVERLAY))
        .rejects.toThrow(/repository \.npmrc credentials/u);
    } finally {
      await rm(tracked, { recursive: true, force: true });
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe('repository overlay shell contract', () => {
  async function overlayFixture(): Promise<{
    root: string;
    archive: string;
    manifest: string;
    dependencyManifest: string;
  }> {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-overlay-contract-'));
    const root = join(directory, 'workspace');
    const source = join(directory, 'source');
    const archive = join(directory, 'overlay.tar');
    const manifest = join(directory, 'overlay.manifest');
    const dependencyManifest = join(directory, 'dependency.manifest');
    await mkdir(join(root, 'node_modules', 'dependency'), { recursive: true });
    await mkdir(join(source, 'src'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{"name":"old"}\n');
    await writeFile(join(root, 'node_modules', 'dependency', 'output.js'), 'prepared\n');
    await writeFile(join(source, 'package.json'), '{"name":"new"}\n');
    await writeFile(join(source, 'src', 'index.ts'), 'export const ready = true;\n');
    await execFileAsync('tar', ['-cf', archive, 'package.json', 'src/index.ts'], {
      cwd: source,
    });
    await writeFile(manifest, Buffer.from('package.json\0src/index.ts\0'));
    await writeFile(dependencyManifest, Buffer.from('package.json\0'));
    return { root, archive, manifest, dependencyManifest };
  }

  function overlayCommand(paths: Awaited<ReturnType<typeof overlayFixture>>): string {
    return buildSnapshotCommandForTest(REPOSITORY_OVERLAY, {
      cwd: paths.root,
      snapshotPath: paths.archive,
      manifestPath: paths.manifest,
      dependencyManifestPath: paths.dependencyManifest,
    });
  }

  it('preserves prepared dependencies while applying a valid source overlay', async () => {
    const fixture = await overlayFixture();
    try {
      await execFileAsync('sh', ['-c', overlayCommand(fixture)]);

      expect(await readFile(join(fixture.root, 'package.json'), 'utf8'))
        .toBe('{"name":"new"}\n');
      expect(await readFile(join(fixture.root, 'src', 'index.ts'), 'utf8'))
        .toBe('export const ready = true;\n');
      expect(await readFile(
        join(fixture.root, 'node_modules', 'dependency', 'output.js'),
        'utf8',
      )).toBe('prepared\n');
    } finally {
      await rm(dirname(fixture.root), { recursive: true, force: true });
    }
  });

  it.each(['symlink-parent', 'symlink-destination', 'collision'] as const)(
    'refuses %s before archive extraction',
    async (scenario) => {
      const fixture = await overlayFixture();
      const outside = join(dirname(fixture.root), 'outside');
      await mkdir(outside);
      if (scenario === 'symlink-parent') {
        await symlink(outside, join(fixture.root, 'src'));
      } else {
        await mkdir(join(fixture.root, 'src'));
        if (scenario === 'symlink-destination') {
          await writeFile(join(outside, 'index.ts'), 'outside\n');
          await symlink(join(outside, 'index.ts'), join(fixture.root, 'src', 'index.ts'));
        } else {
          await writeFile(join(fixture.root, 'src', 'index.ts'), 'prepared collision\n');
        }
      }
      try {
        const error = await execFileAsync('sh', ['-c', overlayCommand(fixture)])
          .catch((cause: unknown) => cause) as { stderr?: string };

        expect(error.stderr).toMatch(/refuses (?:symlink|preparation path collision)/u);
        expect(await readFile(join(fixture.root, 'package.json'), 'utf8'))
          .toBe('{"name":"old"}\n');
      } finally {
        await rm(dirname(fixture.root), { recursive: true, force: true });
      }
    },
  );
});
