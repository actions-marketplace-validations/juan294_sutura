import { createHash } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { REPLAY_BUNDLE_SCHEMA_VERSION, type RawBody, type ReplayBundle } from './bundle.js';
import { createCompleteReplayBundleForTest } from './complete-bundle.test-helper.js';
import { parseReplayBundle } from './validate.js';

const PARTIAL = {
  schemaVersion: REPLAY_BUNDLE_SCHEMA_VERSION,
  runId: '33239848825',
  repo: 'juan294/sutura',
  actionSha: 'a'.repeat(40),
  capturedAt: '2026-08-30T00:00:00.000Z',
  github: [], repository: [], executor: [], http: [],
  configuration: {
    triageN: 2, raceK: 3,
    models: { nano: 'nano', super: 'super', ultra: 'ultra' },
    routingProfileId: 'production', maxOps: 40,
  },
  completeness: {
    complete: false,
    overflowedBoundaries: [],
    pendingBoundaries: ['github', 'repository', 'executor', 'nebius', 'tavily', 'contree'],
  },
} satisfies ReplayBundle;

function clone(bundle: ReplayBundle): ReplayBundle {
  return structuredClone(bundle);
}

describe('parseReplayBundle', () => {
  let complete: ReplayBundle;

  beforeAll(async () => {
    complete = await createCompleteReplayBundleForTest();
  });

  it('accepts valid partial and complete bundles', () => {
    expect(parseReplayBundle(PARTIAL)).toEqual(PARTIAL);
    expect(parseReplayBundle(complete)).toEqual(complete);
  });

  it('accepts bounded selected runtime evidence and rejects unsafe paths', () => {
    const value = clone(PARTIAL);
    value.runtimeDetection = {
      runtime: 'python', evidenceSource: 'bounded-scan',
      evidencePaths: ['services/worker/tests/test_widget.py'], visitedEntries: 42,
    };
    expect(parseReplayBundle(value)).toEqual(value);

    value.runtimeDetection.evidencePaths = ['../outside.py'];
    expect(() => parseReplayBundle(value)).toThrow(/safe relative repository path/iu);
  });

  it('rejects a complete bundle without an outcome', () => {
    const value = clone(complete);
    delete value.outcome;
    expect(() => parseReplayBundle(value)).toThrow(/outcome/u);
  });

  it.each(['github', 'repository', 'executor', 'nebius', 'contree'] as const)(
    'rejects a complete bundle without the %s stream',
    (boundary) => {
      const value = clone(complete);
      if (boundary === 'github' || boundary === 'repository' || boundary === 'executor') {
        value[boundary] = [];
      } else {
        value.http = value.http.filter((exchange) => exchange.boundary !== boundary);
      }
      expect(() => parseReplayBundle(value)).toThrow(new RegExp(boundary, 'u'));
    },
  );

  it('accepts a complete bundle when optional Tavily grounding did not run', () => {
    const value = clone(complete);
    value.http = value.http.filter((exchange) => exchange.boundary !== 'tavily');
    expect(parseReplayBundle(value)).toEqual(value);
  });

  it('accepts a complete bundle when the optional GPT-6 Astra second opinion did not run', () => {
    const value = clone(complete);
    value.http = value.http.filter((exchange) => exchange.boundary !== 'openai');
    expect(parseReplayBundle(value)).toEqual(value);
  });

  it('accepts an openai HTTP exchange', () => {
    const value = clone(PARTIAL);
    value.http = [{
      boundary: 'openai', sequence: 1,
      request: { method: 'POST', url: 'https://api.openai.com/v1/chat/completions', headers: {}, body: '{}' },
      response: { status: 200, headers: {}, body: '{}' },
      latencyMs: 12,
    }];
    expect(parseReplayBundle(value)).toEqual(value);
  });

  it('rejects duplicate sequences in each recorder reservation domain', () => {
    const ports = clone(complete);
    ports.repository[0]!.sequence = ports.github[0]!.sequence;
    expect(() => parseReplayBundle(ports)).toThrow(/duplicate.*port.*sequence/iu);

    const http = clone(complete);
    http.http[1]!.sequence = http.http[0]!.sequence;
    expect(() => parseReplayBundle(http)).toThrow(/duplicate.*http.*sequence/iu);

    const executor = clone(complete);
    executor.executor[1]!.sequence = executor.executor[0]!.sequence;
    expect(() => parseReplayBundle(executor)).toThrow(/duplicate.*executor.*sequence/iu);
  });

  it('rejects unknown GitHub and repository methods', () => {
    const github = clone(complete);
    github.github[0]!.method = 'unknown';
    expect(() => parseReplayBundle(github)).toThrow(/github.*method/iu);

    const repository = clone(complete);
    repository.repository[0]!.method = 'unknown' as 'readPolicyAtSha';
    expect(() => parseReplayBundle(repository)).toThrow(/repository.*method/iu);
  });

  it('rejects malformed method-specific results', () => {
    const github = clone(complete);
    github.github.find(({ method }) => method === 'getWorkflowRun')!.result = null;
    expect(() => parseReplayBundle(github)).toThrow(/getWorkflowRun.*result/iu);

    const repository = clone(complete);
    repository.repository.find(({ method }) => method === 'checkoutHead')!.result = '/tmp/live';
    expect(() => parseReplayBundle(repository)).toThrow(/checkoutHead.*result/iu);

    const executor = clone(complete);
    executor.executor.find(({ method }) => method === 'run')!.result = { exitCode: 'one' };
    expect(() => parseReplayBundle(executor)).toThrow(/executor.*result/iu);
  });

  it('accepts structured recorded errors with an optional numeric status', () => {
    const value = clone(PARTIAL);
    value.github = [{
      sequence: 1,
      method: 'createRef',
      args: ['refs/tags/attempt', 'a'.repeat(40)],
      result: {
        error: { message: 'Reference already exists', name: 'HttpError', status: 422 },
      },
    }];

    expect(parseReplayBundle(value)).toEqual(value);
  });

  it.each([
    [{ error: 'legacy string' }, /error/iu],
    [{ error: { message: 'failed' } }, /name/iu],
    [{ error: { message: 42, name: 'Error' } }, /message/iu],
    [{ error: { message: 'failed', name: 'Error', status: '422' } }, /status/iu],
    [{ error: { message: 'failed', name: 'Error', status: Number.NaN } }, /status/iu],
    [{ error: { message: 'failed', name: 'Error', status: undefined } }, /status/iu],
    [{ error: { message: 'failed', name: 'Error', extra: true } }, /error/iu],
  ])('rejects malformed structured recorded errors', (result, expected) => {
    const value = clone(PARTIAL);
    value.github = [{
      sequence: 1,
      method: 'createRef',
      args: ['refs/tags/attempt', 'a'.repeat(40)],
      result,
    }];

    expect(() => parseReplayBundle(value)).toThrow(expected);
  });

  it('rejects exact truncation markers in a complete bundle', () => {
    const value = clone(complete);
    value.http.find((exchange) => exchange.boundary === 'nebius')!.response = {
      status: 200,
      headers: {},
      body: { truncated: true, bytes: 9, sha256: 'b'.repeat(64) },
    };
    expect(() => parseReplayBundle(value)).toThrow(/truncated/iu);
  });

  it('accepts hash-only ConTree transport bodies because replay uses logical executor calls', () => {
    const value = clone(complete);
    const contree = value.http.find((exchange) => exchange.boundary === 'contree')!;
    contree.request.body = {
      stream: true,
      bytes: 60_334_080,
      sha256: 'b'.repeat(64),
    };

    expect(parseReplayBundle(value)).toEqual(value);
  });

  it('rejects an unknown recorded-body shape', () => {
    const value = clone(PARTIAL);
    value.http = [{
      boundary: 'nebius', sequence: 1,
      request: {
        method: 'POST', url: 'https://example.test', headers: {},
        body: { unexpected: true } as never,
      },
      response: { status: 200, headers: {}, body: '{}' },
      latencyMs: 0,
    }];
    expect(() => parseReplayBundle(value)).toThrow(/must be a recorded body/u);
  });

  it('verifies raw body base64, byte count, and SHA-256', () => {
    const validBytes = Buffer.from('{"ok":true}', 'utf8');
    const valid: RawBody = {
      raw: true,
      encoding: 'base64',
      data: validBytes.toString('base64'),
      bytes: validBytes.byteLength,
      sha256: createHash('sha256').update(validBytes).digest('hex'),
    };
    const request = (body: RawBody): ReplayBundle => ({
      ...clone(PARTIAL),
      http: [{
        boundary: 'nebius',
        sequence: 1,
        request: { method: 'POST', url: 'https://example.test', headers: {}, body },
        response: { status: 200, headers: {}, body: '{}' },
        latencyMs: 0,
      }],
    });

    expect(parseReplayBundle(request(valid))).toBeDefined();
    expect(() => parseReplayBundle(request({ ...valid, data: 'AA=A' }))).toThrow(/base64/iu);
    expect(() => parseReplayBundle(request({ ...valid, bytes: valid.bytes + 1 }))).toThrow(/bytes/iu);
    expect(() => parseReplayBundle(request({ ...valid, sha256: '0'.repeat(64) }))).toThrow(/sha256/iu);
  });

  it('accepts bounded repair-budget overrides and a complete search structure', () => {
    const value = clone(PARTIAL);
    value.configuration.repairBudgets = {
      modelTurns: 4,
      inferenceCostUsd: 0.1,
      secondOpinionUsd: 0.15,
      diffBytes: 1_024,
    };
    value.configuration.search = {
      initialBranches: 2,
      beamWidth: 1,
      maximumDepth: 3,
      maximumTotalBranches: 6,
    };

    expect(parseReplayBundle(value)).toEqual(value);
  });

  it('accepts known source-reference ordering and rejects an unknown value', () => {
    const value = clone(PARTIAL);
    value.configuration.sourceReferenceOrder = 'latest';
    expect(parseReplayBundle(value)).toEqual(value);

    value.configuration.sourceReferenceOrder = 'future' as never;
    expect(() => parseReplayBundle(value)).toThrow(/sourceReferenceOrder/iu);
  });

  it('accepts known repair verification scopes and rejects an unknown value', () => {
    const value = clone(PARTIAL);
    value.configuration.repairVerificationScope = 'failing-workspace';
    expect(parseReplayBundle(value)).toEqual(value);

    value.configuration.repairVerificationScope = 'future' as never;
    expect(() => parseReplayBundle(value)).toThrow(/repairVerificationScope/iu);
  });

  it.each([
    ['repairBudgets', 'string'],
    ['search', 42],
  ])('rejects a non-object %s configuration', (field, malformed) => {
    const value = clone(PARTIAL);
    (value.configuration as unknown as Record<string, unknown>)[field] = malformed;

    expect(() => parseReplayBundle(value)).toThrow(new RegExp(field, 'u'));
  });

  it.each([
    ['modelTurns', '4'],
    ['toolCalls', 25],
    ['branches', 0],
    ['sandboxOperations', 1.5],
    ['elapsedTimeSec', 601],
    ['inferenceCostUsd', 0.251],
    ['secondOpinionUsd', 0.301],
    ['diffBytes', 65_537],
  ])('rejects malformed repairBudgets.%s', (field, malformed) => {
    const value = clone(PARTIAL);
    value.configuration.repairBudgets = {
      [field]: malformed,
    } as never;

    expect(() => parseReplayBundle(value)).toThrow(new RegExp(`repairBudgets.${field}`, 'u'));
  });

  it.each([
    ['initialBranches', '2'],
    ['beamWidth', 0],
    ['maximumDepth', 5],
    ['maximumTotalBranches', 13],
  ])('rejects malformed search.%s', (field, malformed) => {
    const value = clone(PARTIAL);
    value.configuration.search = {
      initialBranches: 2,
      beamWidth: 1,
      maximumDepth: 3,
      maximumTotalBranches: 6,
      [field]: malformed,
    } as never;

    expect(() => parseReplayBundle(value)).toThrow(new RegExp(`search.${field}`, 'u'));
  });

  it('rejects missing, unknown, and cross-field-invalid search fields', () => {
    const missing = clone(PARTIAL);
    missing.configuration.search = {
      initialBranches: 2,
      beamWidth: 1,
      maximumTotalBranches: 6,
    } as never;
    expect(() => parseReplayBundle(missing)).toThrow(/search.maximumDepth/u);

    const unknown = clone(PARTIAL);
    unknown.configuration.search = {
      initialBranches: 2,
      beamWidth: 1,
      maximumDepth: 3,
      maximumTotalBranches: 6,
      extra: 1,
    } as never;
    expect(() => parseReplayBundle(unknown)).toThrow(/search.extra/u);

    const crossField = clone(PARTIAL);
    crossField.configuration.search = {
      initialBranches: 7,
      beamWidth: 1,
      maximumDepth: 3,
      maximumTotalBranches: 6,
    };
    expect(() => parseReplayBundle(crossField)).toThrow(/search.initialBranches/u);
  });

  it('rejects unknown schema versions and malformed records', () => {
    expect(() => parseReplayBundle({ ...PARTIAL, schemaVersion: 'future' }))
      .toThrow(/schemaVersion/u);
    expect(() => parseReplayBundle({ ...PARTIAL, github: [{ sequence: 0 }] }))
      .toThrow(/github/u);
  });
});
