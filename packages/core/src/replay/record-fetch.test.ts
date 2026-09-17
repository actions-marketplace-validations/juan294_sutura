import { describe, expect, it, vi } from 'vitest';

import { ReplayRecorder } from './bundle.js';
import {
  recordingContreeFetch,
  recordingNebiusFetch,
  recordingTavilyFetch,
  recordingTypeSafeFetch,
} from './record-fetch.js';

const CONFIG = {
  triageN: 1, raceK: 1,
  models: { nano: 'nano', super: 'super', ultra: 'ultra' },
  routingProfileId: 'test', maxOps: 1,
} as const;

const headers = {
  get(name: string): string | null {
    return name.toLowerCase() === 'content-type' ? 'application/json' : null;
  },
};

describe('recording transport adapters', () => {
  it.each(['nebius', 'tavily'] as const)(
    'records byte-exact successful %s JSON without reserialization',
    async (boundary) => {
      const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
      const source = '{\n  "answer": 42\n}\n';
      const innerResponse = new Response(source, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      const arrayBuffer = vi.spyOn(innerResponse, 'arrayBuffer');
      const response = boundary === 'nebius'
        ? await recordingNebiusFetch(recorder, vi.fn(async () => innerResponse))(
            'https://example.test/nebius', { method: 'POST', headers: {}, body: '{}' },
          )
        : await recordingTavilyFetch(recorder, vi.fn(async () => innerResponse))(
            'https://example.test/tavily', { method: 'POST', headers: {}, body: '{}' },
          );

      await expect(response.json()).resolves.toEqual({ answer: 42 });
      expect(arrayBuffer).toHaveBeenCalledOnce();
      expect(innerResponse.bodyUsed).toBe(true);
      expect(recorder.finish('fixed').http[0]?.response).toMatchObject({
        body: {
          raw: true,
          encoding: 'base64',
          data: Buffer.from(source).toString('base64'),
        },
      });
    },
  );

  it('returns decoded text but stores non-UTF-8 evidence hash-only and incomplete', async () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const bytes = new Uint8Array([
      0xff,
      ...Buffer.from('Authorization: Bearer raw-secret', 'utf8'),
    ]);
    const innerResponse = new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
    const arrayBuffer = vi.spyOn(innerResponse, 'arrayBuffer');
    const response = await recordingNebiusFetch(recorder, vi.fn(async () => innerResponse))(
      'https://example.test/nebius', { method: 'POST', headers: {}, body: '{}' },
    );

    await expect(response.text()).resolves.toContain('Authorization: Bearer raw-secret');
    await expect(response.json()).rejects.toBeInstanceOf(TypeError);
    expect(arrayBuffer).toHaveBeenCalledOnce();
    const bundle = recorder.finish('fixed');
    expect(bundle.http[0]?.response).toMatchObject({
      body: {
        truncated: true,
        bytes: bytes.byteLength,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(JSON.stringify(bundle)).not.toContain('raw-secret');
    expect(bundle.completeness.overflowedBoundaries).toContain('http');
  });

  it('preserves response consumption and sequences exchanges across boundaries', async () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const nebius = recordingNebiusFetch(recorder, vi.fn(async () => new Response(
      '{"answer":42}', { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    const tavily = recordingTavilyFetch(recorder, vi.fn(async () => new Response(
      '{"results":[]}', { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    const contree = recordingContreeFetch(recorder, vi.fn(async () => new Response(
      JSON.stringify({ status: 'SUCCESS' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));

    const nebiusResponse = await nebius('https://example.test/nebius', {
      method: 'POST', headers: {}, body: '{}',
    });
    expect(await nebiusResponse.json()).toEqual({ answer: 42 });

    const tavilyResponse = await tavily('https://example.test/tavily', {
      method: 'POST', headers: {}, body: '{}',
    });
    expect(await tavilyResponse.json()).toEqual({ results: [] });

    const contreeResponse = await contree('https://example.test/contree', {
      method: 'GET', headers: { Authorization: 'Bearer test' },
    });
    expect(await contreeResponse.json()).toEqual({ status: 'SUCCESS' });

    expect(recorder.finish('fixed').http.map(({ boundary, sequence }) => ({ boundary, sequence })))
      .toEqual([
        { boundary: 'nebius', sequence: 1 },
        { boundary: 'tavily', sequence: 2 },
        { boundary: 'contree', sequence: 3 },
      ]);
  });

  it('reserves a typesafe sequence and strips the Authorization header from the recorded exchange', async () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const wrapped = recordingTypeSafeFetch(recorder, vi.fn(async () => new Response(
      '{"decision":"approved"}', { status: 200, headers: { 'content-type': 'application/json' } },
    )));

    const response = await wrapped('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: 'Bearer typesafe-secret' },
      body: '{}',
    });
    await expect(response.json()).resolves.toEqual({ decision: 'approved' });

    const bundle = recorder.finish('fixed');
    expect(bundle.http).toEqual([expect.objectContaining({ boundary: 'typesafe', sequence: 1 })]);
    expect(bundle.http[0]?.request.headers).not.toHaveProperty('authorization');
    expect(JSON.stringify(bundle)).not.toContain('typesafe-secret');
  });

  it('records a transport error and rethrows the same rejection', async () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const failure = new Error('socket closed');
    const wrapped = recordingNebiusFetch(recorder, vi.fn(async () => {
      throw failure;
    }));

    await expect(wrapped('https://example.test/nebius', {
      method: 'POST', headers: {}, body: '{}',
    })).rejects.toBe(failure);
    expect(recorder.finish('infra-stop').http[0]?.response).toEqual({
      transportError: 'socket closed',
    });
  });

  it('records a Tavily non-2xx response even when its body is not consumed', async () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const wrapped = recordingTavilyFetch(recorder, vi.fn(async () => new Response(
      '{"error":"rate limited"}',
      { status: 429, headers: { 'content-type': 'application/json' } },
    )));

    const response = await wrapped('https://example.test/tavily', {
      method: 'POST', headers: {}, body: '{}',
    });

    expect(response.status).toBe(429);
    expect(recorder.finish('gave-up').http[0]).toMatchObject({
      boundary: 'tavily',
      response: {
        status: 429,
        body: {
          raw: true,
          encoding: 'base64',
          data: Buffer.from('{"error":"rate limited"}').toString('base64'),
        },
      },
    });
  });

  it.each(['nebius', 'tavily'] as const)(
    'records raw %s response bytes when JSON parsing fails',
    async (boundary) => {
      const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
      const innerResponse = new Response('{not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      const response = boundary === 'nebius'
        ? await recordingNebiusFetch(recorder, vi.fn(async () => innerResponse))(
            'https://example.test/nebius', { method: 'POST', headers: {}, body: '{}' },
          )
        : await recordingTavilyFetch(recorder, vi.fn(async () => innerResponse))(
            'https://example.test/tavily', { method: 'POST', headers: {}, body: '{}' },
          );

      await expect(response.json()).rejects.toBeInstanceOf(SyntaxError);
      expect(recorder.finish('infra-stop').http[0]?.response).toMatchObject({
        status: 200,
        body: {
          raw: true,
          encoding: 'base64',
          data: Buffer.from('{not-json').toString('base64'),
        },
      });
    },
  );

  it('redacts secrets from raw invalid-JSON response bytes', async () => {
    const recorder = new ReplayRecorder(
      '77001', 'acme/widget', 'a'.repeat(40), CONFIG, ['nb-secret'],
    );
    const wrapped = recordingNebiusFetch(recorder, vi.fn(async () => new Response(
      'nb-secret {not-json',
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));

    const response = await wrapped('https://example.test/nebius', {
      method: 'POST', headers: {}, body: '{}',
    });
    await expect(response.json()).rejects.toBeInstanceOf(SyntaxError);

    const bundle = recorder.finish('infra-stop');
    const recorded = bundle.http[0]?.response;
    expect(JSON.stringify(bundle)).not.toContain('nb-secret');
    expect(recorded).toMatchObject({ body: { raw: true, encoding: 'base64' } });
    if (recorded && 'status' in recorded && recorded.body && typeof recorded.body !== 'string'
      && 'raw' in recorded.body) {
      expect(Buffer.from(recorded.body.data, 'base64').toString('utf8'))
        .toContain('[redacted secret]');
    }
  });

  it('keeps non-UTF-8 invalid-JSON response bytes replayable', async () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const wrapped = recordingNebiusFetch(recorder, vi.fn(async () => new Response(
      new Uint8Array([0xff]),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));

    const response = await wrapped('https://example.test/nebius', {
      method: 'POST', headers: {}, body: '{}',
    });
    await expect(response.json()).rejects.toBeInstanceOf(SyntaxError);

    expect(recorder.finish('infra-stop').http[0]?.response).toMatchObject({
      body: {
        truncated: true,
        bytes: 1,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
  });

  it.each(['nebius', 'tavily'] as const)(
    'bounds an over-limit %s response without changing its JSON result',
    async (boundary) => {
      const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
      const source = JSON.stringify({ value: 'x'.repeat(1_048_576) });
      const innerResponse = new Response(source, {
        status: 200, headers: { 'content-type': 'application/json' },
      });
      const response = boundary === 'nebius'
        ? await recordingNebiusFetch(recorder, vi.fn(async () => innerResponse))(
            'https://example.test/nebius', { method: 'POST', headers: {}, body: '{}' },
          )
        : await recordingTavilyFetch(recorder, vi.fn(async () => innerResponse))(
            'https://example.test/tavily', { method: 'POST', headers: {}, body: '{}' },
          );

      await expect(response.json()).resolves.toEqual({ value: 'x'.repeat(1_048_576) });
      const bundle = recorder.finish('fixed');
      expect(bundle.http[0]?.response).toMatchObject({
        body: { truncated: true, bytes: Buffer.byteLength(source) },
      });
      expect(bundle.completeness.overflowedBoundaries).toContain('http');
    },
  );

  it('cancels an unfinished ConTree request capture and rethrows promptly', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        // Intentionally never resolves or enqueues.
        return new Promise<void>(() => undefined);
      },
      cancel() {
        cancelled = true;
      },
    });
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const failure = new Error('transport rejected');
    const wrapped = recordingContreeFetch(recorder, vi.fn(async () => {
      throw failure;
    }));

    await expect(wrapped('https://example.test/contree', {
      method: 'POST', body: stream, duplex: 'half',
    })).rejects.toBe(failure);
    await Promise.resolve();

    expect(cancelled).toBe(true);
    expect(recorder.finish('infra-stop')).toMatchObject({
      http: [{ request: { body: null }, response: { transportError: 'transport rejected' } }],
      completeness: { complete: false, overflowedBoundaries: ['http'] },
    });
  });

  it('records a ConTree request body before rethrowing a fetch rejection', async () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const failure = new Error('socket closed');
    const wrapped = recordingContreeFetch(recorder, vi.fn(async () => {
      throw failure;
    }));

    await expect(wrapped('https://example.test/contree', {
      method: 'POST', body: 'request-payload',
    })).rejects.toBe(failure);
    expect(recorder.finish('infra-stop').http[0]).toMatchObject({
      request: { body: 'request-payload' },
      response: { transportError: 'socket closed' },
    });
  });

  it('marks a failed ConTree request-body capture incomplete', async () => {
    class BrokenBlob extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> {
        return Promise.reject(new Error('blob unavailable'));
      }
    }
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const wrapped = recordingContreeFetch(
      recorder,
      vi.fn(async () => new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json' },
      })),
    );

    await expect(wrapped('https://example.test/contree', {
      method: 'POST', body: new BrokenBlob(['request-payload']),
    })).resolves.toBeInstanceOf(Response);
    expect(recorder.finish('fixed').completeness).toMatchObject({
      complete: false,
      overflowedBoundaries: ['http'],
    });
  });

  it('returns the ConTree response when replay body capture fails', async () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const response = new Response('{"ok":true}', {
      headers: { 'content-type': 'application/json' },
    });
    Object.defineProperty(response, 'clone', {
      value: () => { throw new Error('clone unavailable'); },
    });
    const wrapped = recordingContreeFetch(recorder, vi.fn(async () => response));

    await expect(wrapped('https://example.test/contree')).resolves.toBe(response);
  });

  it('keeps HTTP invocation sequence when responses finish out of order', async () => {
    let resolveFirst: ((response: {
      ok: boolean; status: number; headers: typeof headers;
      json(): Promise<unknown>; text(): Promise<string>;
    }) => void) | undefined;
    let resolveSecond: typeof resolveFirst;
    const inner = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const wrapped = recordingNebiusFetch(recorder, inner);
    const response = (id: number) => new Response(JSON.stringify({ id }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });

    const first = wrapped('https://example.test/1', { method: 'POST', headers: {}, body: '{}' });
    const second = wrapped('https://example.test/2', { method: 'POST', headers: {}, body: '{}' });
    resolveSecond?.(response(2));
    await (await second).json();
    resolveFirst?.(response(1));
    await (await first).json();

    expect(recorder.finish('fixed').http.map(({ sequence, request }) => ({
      sequence, url: request.url,
    }))).toEqual([
      { sequence: 1, url: 'https://example.test/1' },
      { sequence: 2, url: 'https://example.test/2' },
    ]);
  });
});
