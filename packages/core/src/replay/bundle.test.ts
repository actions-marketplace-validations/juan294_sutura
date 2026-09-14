import { describe, expect, it } from 'vitest';

import {
  REPLAY_BUNDLE_SCHEMA_VERSION,
  ReplayRecorder,
} from './bundle.js';

const CONFIG = {
  triageN: 5,
  raceK: 3,
  models: { nano: 'nano', super: 'super', ultra: 'ultra' },
  routingProfileId: 'production-baseline-v1',
  maxOps: 40,
} as const;

describe('ReplayRecorder', () => {
  it('bounds bodies, strips sensitive headers, and redacts injected secrets', () => {
    const recorder = new ReplayRecorder(
      '77001',
      'acme/widget',
      'a'.repeat(40),
      CONFIG,
      ['nb-secret'],
    );
    recorder.recordHttp({
      boundary: 'nebius',
      request: {
        method: 'POST',
        url: 'https://example.test/chat',
        headers: {
          Authorization: 'Bearer nb-secret',
          'Content-Type': 'application/json',
          Cookie: 'session=nb-secret',
          'X-Api-Key': 'nb-secret',
        },
        body: `Authorization: Bearer nb-secret\n${'x'.repeat(1_048_576)}`,
      },
      response: {
        status: 200,
        headers: {
          'Set-Cookie': 'session=nb-secret',
          'Content-Type': 'application/json',
        },
        body: '{"token":"nb-secret"}',
      },
      latencyMs: 4,
    });

    const bundle = recorder.finish('fixed');
    const serialized = JSON.stringify(bundle);

    expect(bundle.schemaVersion).toBe(REPLAY_BUNDLE_SCHEMA_VERSION);
    expect(bundle.http[0]?.request.headers).toEqual({
      'content-type': 'application/json',
    });
    expect(bundle.http[0]?.response).toMatchObject({
      headers: { 'content-type': 'application/json' },
    });
    expect(bundle.http[0]?.request.body).toMatchObject({
      truncated: true,
      bytes: expect.any(Number),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(serialized).not.toContain('nb-secret');
    expect(serialized).not.toContain('Authorization: Bearer nb-secret');
    expect(bundle.completeness).toMatchObject({
      complete: false,
      overflowedBoundaries: ['http'],
      pendingBoundaries: ['contree', 'executor', 'github', 'repository'],
    });
  });

  it('finishes complete without an optional Tavily exchange', () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    recorder.recordGitHub({ method: 'getWorkflowRun', args: [], result: null });
    recorder.recordRepository({ method: 'readPolicyAtSha', args: [], result: null });
    recorder.recordExecutor({ method: 'run', args: [], result: null });
    for (const boundary of ['nebius', 'contree'] as const) {
      recorder.recordHttp({
        boundary,
        request: { method: 'POST', url: 'https://example.test', headers: {}, body: null },
        response: { status: 200, headers: {}, body: '{}' },
        latencyMs: 0,
      });
    }

    expect(recorder.finish('fixed').completeness).toEqual({
      complete: true,
      overflowedBoundaries: [],
      pendingBoundaries: [],
    });
  });

  it('enforces call bounds without throwing', () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);

    expect(() => {
      for (let index = 0; index < 600; index += 1) {
        recorder.recordHttp({
          boundary: 'tavily',
          request: { method: 'GET', url: `https://example.test/${index}`, headers: {}, body: null },
          response: { status: 200, headers: {}, body: '' },
          latencyMs: 0,
        });
      }
      for (let index = 0; index < 200; index += 1) {
        recorder.recordGitHub({ method: 'getWorkflowRun', args: [index], result: index });
        recorder.recordRepository({ method: 'checkoutHead', args: [index], result: index });
      }
    }).not.toThrow();

    const bundle = recorder.finish('gave-up');
    expect(bundle.http).toHaveLength(512);
    expect(bundle.github.length + bundle.repository.length).toBe(256);
    expect(bundle.http.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: 512 }, (_, index) => index + 1),
    );
    expect([...bundle.github, ...bundle.repository]
      .map(({ sequence }) => sequence)
      .sort((left, right) => left - right)).toEqual(
      Array.from({ length: 256 }, (_, index) => index + 1),
    );
    expect(bundle.completeness).toEqual({
      complete: false,
      overflowedBoundaries: ['github', 'http', 'repository'],
      pendingBoundaries: ['contree', 'executor', 'nebius'],
    });
  });

  it('captures deterministic orchestration configuration and executor calls', () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), {
      triageN: 5,
      raceK: 3,
      repairBudgets: {
        modelTurns: 8,
        toolCalls: 24,
        branches: 12,
        sandboxOperations: 32,
        elapsedTimeSec: 600,
        inferenceCostUsd: 0.25,
        diffBytes: 65_536,
      },
      search: {
        initialBranches: 4,
        beamWidth: 2,
        maximumDepth: 4,
        maximumTotalBranches: 12,
      },
      runtimeId: 'node',
      imageRef: 'node@sha256:abc',
      models: { nano: 'nano', super: 'super', ultra: 'ultra' },
      routingProfileId: 'production-baseline-v1',
      maxOps: 40,
    });
    recorder.recordExecutor({ method: 'importImage', args: ['node:22'], result: 'image-1' });
    recorder.recordRuntimeDetection({
      runtime: 'node', evidenceSource: 'root',
      evidencePaths: ['package.json'], visitedEntries: 1,
    });

    expect(recorder.finish('fixed')).toMatchObject({
      configuration: {
        triageN: 5,
        raceK: 3,
        runtimeId: 'node',
        imageRef: 'node@sha256:abc',
        models: { nano: 'nano', super: 'super', ultra: 'ultra' },
        routingProfileId: 'production-baseline-v1',
        maxOps: 40,
      },
      executor: [{ sequence: 1, method: 'importImage', args: ['node:22'], result: 'image-1' }],
      runtimeDetection: {
        runtime: 'node', evidenceSource: 'root',
        evidencePaths: ['package.json'], visitedEntries: 1,
      },
    });
  });

  it('marks a reserved but unfinished call as incomplete', () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);

    recorder.reserveHttpSequence('nebius');

    expect(recorder.finish('infra-stop').completeness).toEqual({
      complete: false,
      overflowedBoundaries: [],
      pendingBoundaries: ['contree', 'executor', 'github', 'nebius', 'repository'],
    });
  });

  it('is complete after all required boundaries complete a record', () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    recorder.recordGitHub({ method: 'getWorkflowRun', args: [], result: {} });
    recorder.recordRepository({ method: 'readPolicyAtSha', args: [], result: null });
    recorder.recordExecutor({ method: 'operationCapacity', args: [], result: { limit: 1 } });
    for (const boundary of ['nebius', 'tavily', 'contree'] as const) {
      recorder.recordHttp({
        boundary,
        request: { method: 'GET', url: `https://example.test/${boundary}`, headers: {}, body: null },
        response: { status: 200, headers: {}, body: '' },
        latencyMs: 0,
      });
    }

    expect(recorder.finish('fixed').completeness).toEqual({
      complete: true,
      overflowedBoundaries: [],
      pendingBoundaries: [],
    });
  });

  it('sanitizes object keys and marks structural JSON loss incomplete', () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let depth = 0; depth < 34; depth += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    const many = Object.fromEntries(
      Array.from({ length: 10_001 }, (_, index) => [`key-${index}`, index]),
    );
    const collidingKeys = {
      'Authorization: Bearer first-secret': 1,
      'Authorization: Bearer second-secret': 2,
    };

    recorder.recordGitHub({ method: 'getWorkflowRun', args: [deep], result: {} });
    recorder.recordRepository({ method: 'readPolicyAtSha', args: [], result: many });
    recorder.recordExecutor({
      method: 'run',
      args: [
        collidingKeys,
        circular,
        'x'.repeat(1_048_577),
        Symbol('Authorization: Bearer symbol-secret'),
      ],
      result: {},
    });

    const bundle = recorder.finish('infra-stop');
    const serialized = JSON.stringify(bundle);
    const recordedKeys = Object.keys(bundle.executor[0]?.args[0] as object);
    expect(recordedKeys).toHaveLength(2);
    expect(new Set(recordedKeys).size).toBe(2);
    expect(recordedKeys).toEqual([
      'Authorization: [redacted credential]',
      'Authorization: [redacted credential] [collision 2]',
    ]);
    expect(Object.values(bundle.executor[0]?.args[0] as object)).toEqual([1, 2]);
    expect(serialized).not.toContain('first-secret');
    expect(serialized).not.toContain('second-secret');
    expect(serialized).not.toContain('symbol-secret');
    expect(bundle.completeness.overflowedBoundaries).toEqual([
      'executor', 'github', 'repository',
    ]);
    expect(bundle.completeness.complete).toBe(false);
  });

  it('sanitizes recorder metadata and configuration at capture time', () => {
    const recorder = new ReplayRecorder(
      'Authorization: Bearer run-secret',
      'acme/config-secret',
      'injected-secret',
      {
        ...CONFIG,
        routingProfileId: 'Authorization: Bearer route-secret',
      },
      ['config-secret', 'injected-secret'],
    );

    const bundle = recorder.finish('fixed');
    expect(JSON.stringify(bundle)).not.toMatch(/(?:run|config|injected|route)-secret/u);
    expect(bundle).toMatchObject({
      runId: 'Authorization: [redacted credential]',
      repo: 'acme/[redacted secret]',
      actionSha: '[redacted secret]',
      configuration: { routingProfileId: 'Authorization: [redacted credential]' },
    });
  });

  it.each([786_433, 1_048_576])(
    'does not deep-redact or corrupt a %i-byte RawBody at finish',
    (size) => {
      const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
      const bytes = new Uint8Array(size).fill(0x78);
      recorder.recordHttp({
        boundary: 'nebius',
        request: { method: 'POST', url: 'https://example.test', headers: {}, body: null },
        response: {
          status: 200,
          headers: {},
          body: {
            raw: true,
            encoding: 'base64',
            data: Buffer.from(bytes).toString('base64'),
            bytes: bytes.byteLength,
            sha256: '0'.repeat(64),
          },
        },
        latencyMs: 0,
      });

      expect(recorder.finish('fixed').http[0]?.response).toMatchObject({
        body: {
          raw: true,
          encoding: 'base64',
          data: Buffer.from(bytes).toString('base64'),
          bytes: size,
        },
      });
    },
  );
});
