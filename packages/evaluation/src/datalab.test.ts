import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  DATALAB_BATCH_REPORT_SCHEMA_VERSION,
  DATALAB_EXPERIMENT_SCHEMA_VERSION,
  DATALAB_MAX_BODY_BYTES,
  DATALAB_MAX_ROW_BYTES,
  DATALAB_PROMPT_VERSIONS,
  DATALAB_ROW_SCHEMA_VERSION,
  DataLabClient,
  assertDataLabCostCap,
  dataLabEvidenceHash,
  prepareDataLabDataset,
  validateDataLabBatchReport,
  validateDataLabExperimentRecord,
  validateDataLabRow,
  type DataLabBatchReport,
  type DataLabClientOptions,
  type DataLabExperimentRecord,
} from './datalab.js';

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function placeboResult(index: number): Record<string, unknown> {
  const kinds = ['repairable', 'trap', 'flaky', 'upstream'] as const;
  const languages = ['javascript', 'typescript', 'python'] as const;
  const kind = kinds[index % kinds.length]!;
  return {
    caseId: `case-${String(index).padStart(2, '0')}`,
    kind,
    language: languages[index % languages.length],
    ...(kind === 'repairable' ? { difficulty: index % 2 ? 'hard' : 'standard' } : {}),
    failureClass: kind === 'flaky' ? 'flaky-timing' : 'test-assertion',
    ...(kind === 'flaky' ? { flakePattern: 'timing' } : {}),
    tavilyEnabled: kind === 'upstream' ? index % 2 === 0 : true,
    elapsedTimeMs: 10_000 + index,
    suppliedSecret: 'ordinary-looking-secret',
    caseFile: {
      outcome: kind === 'trap' ? 'refused' : kind === 'flaky' ? 'flaky-no-patch' : 'fixed',
      source: 'const credential = "ordinary-looking-secret";',
      logs: 'Authorization: Bearer token /Users/alice/private C:\\Users\\alice\\private',
      diff: 'private patch',
      nested: { arbitrary: { apiKey: 'credential-value' } },
      cost: { entries: [{ usd: 0.0001 }, { usd: 0.0002 }] },
      stages: [{ stage: 'policy' }, { stage: 'reproduction' }],
    },
  };
}

function placebo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = {
    schemaVersion: 'sutura-placebo-live-result-v1',
    controllerSha: 'a'.repeat(40),
    subjectSha: 'b'.repeat(40),
    score: { corpusVersion: '0.2' },
    corpusHash: 'c'.repeat(64),
    evaluationCount: 55,
    results: Array.from({ length: 55 }, (_, index) => placeboResult(index)),
    source: '/Users/alice/private/repository',
    ...overrides,
  };
  return { ...base, resultHash: dataLabEvidenceHash(base) };
}

function rehash(value: Record<string, unknown>): Record<string, unknown> {
  const base = { ...value };
  delete base.resultHash;
  return { ...base, resultHash: dataLabEvidenceHash(base) };
}

function uploadedRecord(): DataLabExperimentRecord {
  const value = {
    schemaVersion: DATALAB_EXPERIMENT_SCHEMA_VERSION,
    stage: 'uploaded' as const,
    requestHash: sha('request'),
    sourceResultHash: sha('source'),
    inputHash: sha('input'),
    rowCount: 110 as const,
    promptVersions: [...DATALAB_PROMPT_VERSIONS],
    datasetId: 'dataset-1',
    datasetVersion: 'version-1',
    uploadedAt: '2026-09-04T10:00:00.000Z',
  };
  return { ...value, recordHash: dataLabEvidenceHash(value) };
}

function completeRecord(): Extract<DataLabExperimentRecord, { stage: 'complete' }> {
  const uploaded = uploadedRecord();
  const { recordHash, ...base } = uploaded;
  expect(recordHash).toMatch(/^[a-f0-9]{64}$/u);
  const value = {
    ...base,
    stage: 'complete' as const,
    operationId: 'operation-1',
    operationStatus: 'succeeded' as const,
    outputDatasetId: 'dataset-output',
    outputDatasetVersion: 'version-output',
    model: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
    completionWindow: '12h',
    maxOutputTokens: 64,
    estimatedCostUsd: 0.04,
    costCapUsd: 0.05,
    dispatchedAt: '2026-09-04T10:01:00.000Z',
    calculatedCostUsd: 0.03,
    completedAt: '2026-09-04T10:03:00.000Z',
    latencyMs: 120_000,
    outputHash: sha('output'),
  };
  return { ...value, recordHash: dataLabEvidenceHash(value) };
}

function batchReport(): DataLabBatchReport {
  const experiment = completeRecord();
  const value = {
    schemaVersion: DATALAB_BATCH_REPORT_SCHEMA_VERSION,
    experimentRecordHash: experiment.recordHash,
    requestHash: experiment.requestHash,
    sourceResultHash: experiment.sourceResultHash,
    inputHash: experiment.inputHash,
    outputHash: experiment.outputHash,
    rowCount: 110 as const,
    datasetId: experiment.datasetId,
    datasetVersion: experiment.datasetVersion,
    operationId: experiment.operationId,
    operationStatus: 'succeeded' as const,
    outputDatasetId: experiment.outputDatasetId,
    outputDatasetVersion: experiment.outputDatasetVersion,
    model: experiment.model,
    promptVersions: [...DATALAB_PROMPT_VERSIONS],
    completionWindow: experiment.completionWindow,
    maxOutputTokens: experiment.maxOutputTokens,
    estimatedCostUsd: experiment.estimatedCostUsd,
    costCapUsd: experiment.costCapUsd,
    calculatedCostUsd: experiment.calculatedCostUsd,
    latencyMs: experiment.latencyMs,
    qualityByPromptVariant: DATALAB_PROMPT_VERSIONS.map((promptVersion, index) => ({
      promptVersion,
      correct: 50 + index,
      total: 55 as const,
      accuracy: (50 + index) / 55,
      inputTokens: 100,
      outputTokens: 10,
      calculatedCostUsd: 0.015,
    })),
    comparison: {
      winnerPromptVersion: DATALAB_PROMPT_VERSIONS[1],
      loserPromptVersion: DATALAB_PROMPT_VERSIONS[0],
      accuracyDelta: 51 / 55 - 50 / 55,
      tied: false,
    },
  };
  return { ...value, reportHash: dataLabEvidenceHash(value) };
}

describe('Data Lab public-safe dataset', () => {
  it('accepts the committed 55-evaluation public Placebo result', () => {
    const source = JSON.parse(readFileSync(
      new URL('../../../docs/demo/placebo-v0.2-live-2026-09.json', import.meta.url),
      'utf8',
    ));
    const prepared = prepareDataLabDataset(source);
    expect(prepared.rows).toHaveLength(110);
    expect(prepared.byteLength).toBeLessThanOrEqual(DATALAB_MAX_BODY_BYTES);
    expect(prepared.rows.every(({ customId }) => /^[a-f0-9]{64}$/u.test(customId))).toBe(true);
  });

  it('projects 55 Placebo evaluations into 110 deterministic bounded rows', () => {
    const first = prepareDataLabDataset(placebo());
    const second = prepareDataLabDataset(placebo());

    expect(first).toEqual(second);
    expect(first.rows).toHaveLength(110);
    expect(first.rowCount).toBe(110);
    expect(first.byteLength).toBeLessThanOrEqual(DATALAB_MAX_BODY_BYTES);
    expect(first.inputHash).toBe(sha(first.jsonl));
    expect(first.rows.every((row) => Buffer.byteLength(JSON.stringify(row)) <= DATALAB_MAX_ROW_BYTES)).toBe(true);
    expect(new Set(first.rows.map(({ customId }) => customId))).toHaveProperty('size', 110);
    expect(first.rows.every((row) => !row.messages[1]?.content.includes('observedOutcome'))).toBe(true);
    expect(first.rows.flatMap(({ promptVersion }) => promptVersion)).toEqual(
      Array.from({ length: 55 }, () => [...DATALAB_PROMPT_VERSIONS]).flat(),
    );
  });

  it('never copies credentials, supplied secrets, paths, source, logs, diffs, or arbitrary keys', () => {
    const serialized = JSON.stringify(prepareDataLabDataset(placebo()).rows);
    for (const forbidden of [
      'ordinary-looking-secret', 'credential-value', '/Users/alice', 'C:\\Users\\alice',
      'Authorization', 'private patch', 'suppliedSecret', '"source":', '"logs":',
      '"diff":', '"nested":',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('rejects non-canonical Placebo identity, denominator, categories, and numbers', () => {
    expect(() => prepareDataLabDataset(placebo({ evaluationCount: 54 }))).toThrow(/55/u);
    expect(() => prepareDataLabDataset(placebo({ results: (placebo().results as unknown[]).slice(1) }))).toThrow(/55/u);
    const invalid = placebo();
    (invalid.results as Record<string, unknown>[])[0]!.language = '/Users/alice/private';
    expect(() => prepareDataLabDataset(rehash(invalid))).toThrow(/language/u);
    const invalidNumber = placebo();
    (invalidNumber.results as Record<string, unknown>[])[0]!.elapsedTimeMs = Number.POSITIVE_INFINITY;
    expect(() => prepareDataLabDataset(rehash(invalidNumber))).toThrow(/elapsedTimeMs/u);
    const tampered = placebo();
    (tampered.results as Record<string, unknown>[])[0]!.language = 'python';
    expect(() => prepareDataLabDataset(tampered)).toThrow(/resultHash/u);
  });

  it('validates an exact row schema and rejects unknown or oversized row data', () => {
    const row = prepareDataLabDataset(placebo()).rows[0]!;
    expect(validateDataLabRow(row)).toEqual(row);
    expect(() => validateDataLabRow({ ...row, source: 'private' })).toThrow(/Unsupported field/u);
    expect(() => validateDataLabRow({
      ...row,
      messages: [row.messages[0], { role: 'user', content: 'ordinary-looking-secret' }],
    })).toThrow(/canonical prompt/u);
    expect(() => validateDataLabRow({
      ...row,
      messages: [row.messages[0], { role: 'user', content: 'x'.repeat(DATALAB_MAX_ROW_BYTES) }],
    })).toThrow(/2 KiB/u);
    expect(row.schemaVersion).toBe(DATALAB_ROW_SCHEMA_VERSION);
  });
});

describe('Data Lab official API client', () => {
  it('normalizes an adversarial base URL in bounded time', async () => {
    const baseUrl = `https://example.test/${'/'.repeat(50_000)}x`;
    const fetch = vi.fn<DataLabClientOptions['fetch']>(async () => new Response(JSON.stringify({
      id: 'dataset-1', name: 'sutura-eval', status: 'READY', current_version: 'v1',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const startedAt = performance.now();
    const client = new DataLabClient({ apiKey: 'key', fetch, baseUrl });
    expect(performance.now() - startedAt).toBeLessThan(1_000);
    await client.createDataset({ name: 'sutura-eval', folder: '/sutura', schema: [], rows: [] });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`${baseUrl}/v1/datasets`);
  });

  it('accepts current summary versions, pending datasets, and queued nullable destinations', async () => {
    const responses = [
      {
        id: 'dataset-1', name: 'sutura-eval', status: 'READY', current_version: null,
        current_version_summary: { id: 'v1' },
      },
      {
        id: 'dataset-pending', name: 'pending', status: 'PENDING', current_version: null,
        current_version_summary: null,
      },
      {
        id: 'operation-1', type: 'batch_inference', status: 'queued', created_at: 1,
        params: { model: 'model-1', completion_window: '12h' },
        src: [{ id: 'dataset-1', version: 'v1' }],
        dst: [{ id: 'dataset-output', version: null }],
      },
    ];
    const client = new DataLabClient({
      apiKey: 'key',
      fetch: vi.fn(async () => new Response(JSON.stringify(responses.shift()), {
        status: 200, headers: { 'content-type': 'application/json' },
      })),
    });
    const datasetRequest = { name: 'sutura-eval', folder: '/sutura', schema: [], rows: [] };
    await expect(client.createDataset(datasetRequest)).resolves.toMatchObject({ version: 'v1' });
    await expect(client.getDataset('dataset-pending')).resolves.toMatchObject({ status: 'PENDING', version: null });
    await expect(client.createBatchOperation({
      type: 'batch_inference',
      src: [{
        id: 'dataset-1', version: 'v1',
        mapping: { type: 'text_messages', messages: { type: 'column', name: 'messages' } },
      }],
      dst: [], params: { model: 'model-1', completion_window: '12h' },
    })).resolves.toMatchObject({ outputDataset: { id: 'dataset-output', version: null } });
  });

  it('uses injected fetch with authenticated official dataset and operation routes', async () => {
    const responses = [
      { id: 'dataset-1', name: 'sutura-eval', status: 'READY', current_version: 'v1' },
      {
        id: 'operation-1', type: 'batch_inference', status: 'queued', created_at: 1,
        params: { model: 'model-1', completion_window: '12h' },
        src: [{ id: 'dataset-1', version: 'v1' }],
        dst: [{ id: 'dataset-output', version: 'v2' }],
      },
      {
        id: 'operation-1', type: 'batch_inference', status: 'succeeded', created_at: 1,
        params: { model: 'model-1', completion_window: '12h' },
        in_progress_at: 2, finished_at: 3,
        src: [{ id: 'dataset-1', version: 'v1' }],
        dst: [{ id: 'dataset-output', version: 'v2' }],
      },
      { data: [], object: 'list', has_more: false },
      { id: 'dataset-output', name: 'output', status: 'READY', current_version: 'v2' },
      { rows: [{ customId: 'row-1' }], version: 'v2' },
      { id: 'dataset-output', name: 'output', status: 'READY', current_version: 'v2' },
    ];
    const fetch = vi.fn<DataLabClientOptions['fetch']>(async () =>
      new Response(JSON.stringify(responses.shift()), {
      status: 200, headers: { 'content-type': 'application/json' },
      }));
    const client = new DataLabClient({ apiKey: 'in-memory-only', fetch });
    const datasetRequest = {
      name: 'sutura-eval', folder: '/sutura',
      schema: [{ name: 'messages', type: { name: 'string' } }],
      rows: [{ messages: '[]' }],
    };
    const operationRequest = {
      type: 'batch_inference' as const,
      src: [{
        id: 'dataset-1', version: 'v1',
        mapping: {
          type: 'text_messages' as const,
          messages: { type: 'column' as const, name: 'messages' },
          custom_id: { type: 'column' as const, name: 'customId' },
          max_tokens: { type: 'number' as const, value: 64 },
        },
      }],
      dst: [],
      params: { model: 'model-1', completion_window: '12h' },
    };

    await expect(client.createDataset(datasetRequest)).resolves.toMatchObject({ id: 'dataset-1', version: 'v1' });
    await expect(client.createBatchOperation(operationRequest)).resolves.toMatchObject({ id: 'operation-1' });
    await expect(client.getOperation('operation-1')).resolves.toMatchObject({ status: 'succeeded' });
    await expect(client.getOperationResults('operation-1')).resolves.toMatchObject({ object: 'list' });
    await expect(client.getDatasetContent('dataset-output', 'v2')).resolves.toEqual([{ customId: 'row-1' }]);

    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.tokenfactory.nebius.com/v1/datasets',
      'https://api.tokenfactory.nebius.com/v1/operations',
      'https://api.tokenfactory.nebius.com/v1/operations/operation-1',
      'https://api.tokenfactory.nebius.com/v1/operations/operation-1/results',
      'https://api.tokenfactory.nebius.com/v1/datasets/dataset-output',
      'https://api.tokenfactory.nebius.com/v1/datasets/dataset-output/content?limit=1000&offset=0',
      'https://api.tokenfactory.nebius.com/v1/datasets/dataset-output',
    ]);
    for (const [, init] of fetch.mock.calls) {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer in-memory-only');
    }
  });

  it('fails closed on HTTP errors and dataset or operation identity drift', async () => {
    const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    });
    const request = { name: 'expected', folder: '/sutura', schema: [], rows: [] };
    await expect(new DataLabClient({
      apiKey: 'key', fetch: vi.fn(async () => response({ detail: 'denied' }, 403)),
    }).createDataset(request)).rejects.toThrow(/403/u);
    await expect(new DataLabClient({
      apiKey: 'key', fetch: vi.fn(async () => response({
        id: 'dataset-1', name: 'different', status: 'READY', current_version: 'v1',
      })),
    }).createDataset(request)).rejects.toThrow(/identity/u);
    await expect(new DataLabClient({
      apiKey: 'key', fetch: vi.fn(async () => response({
        id: 'different', type: 'batch_inference', status: 'queued', created_at: 1,
        params: { model: 'model-1', completion_window: '12h' },
        src: [{ id: 'dataset-1', version: 'v1' }], dst: [{ id: 'out', version: 'v2' }],
      })),
    }).getOperation('operation-1')).rejects.toThrow(/identity/u);
  });
});

describe('Data Lab evidence contracts', () => {
  it('validates immutable staged experiment records and their canonical hashes', () => {
    const uploaded = uploadedRecord();
    expect(validateDataLabExperimentRecord(uploaded)).toEqual(uploaded);

    const dispatchedValue = {
      ...uploaded,
      stage: 'dispatched' as const,
      operationId: 'operation-1', operationStatus: 'queued' as const,
      outputDatasetId: 'dataset-output', outputDatasetVersion: 'version-output',
      model: 'model-1', completionWindow: '12h', maxOutputTokens: 64,
      estimatedCostUsd: 0.04, costCapUsd: 0.05,
      dispatchedAt: '2026-09-04T10:01:00.000Z',
    };
    const { recordHash: oldHash, ...dispatchedWithoutHash } = dispatchedValue;
    expect(oldHash).toMatch(/^[a-f0-9]{64}$/u);
    const dispatched = {
      ...dispatchedWithoutHash,
      recordHash: dataLabEvidenceHash(dispatchedWithoutHash),
    };
    expect(validateDataLabExperimentRecord(dispatched)).toEqual(dispatched);
    expect(validateDataLabExperimentRecord(completeRecord())).toEqual(completeRecord());
    const overCapValue = { ...completeRecord(), calculatedCostUsd: 0.051 };
    const { recordHash: overCapHash, ...overCapWithoutHash } = overCapValue;
    expect(overCapHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => validateDataLabExperimentRecord({
      ...overCapWithoutHash, recordHash: dataLabEvidenceHash(overCapWithoutHash),
    })).toThrow(/exceeds/u);

    expect(() => validateDataLabExperimentRecord({
      ...uploaded, operationId: 'not-allowed-before-dispatch',
    })).toThrow(/Unsupported field/u);
    const immediatelySucceeded = { ...dispatched, operationStatus: 'succeeded' as const };
    const { recordHash: queuedHash, ...immediatelySucceededWithoutHash } = immediatelySucceeded;
    expect(queuedHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(validateDataLabExperimentRecord({
      ...immediatelySucceededWithoutHash,
      recordHash: dataLabEvidenceHash(immediatelySucceededWithoutHash),
    })).toMatchObject({ operationStatus: 'succeeded' });
    expect(() => validateDataLabExperimentRecord({ ...completeRecord(), outputHash: sha('drift') })).toThrow(/recordHash/u);
  });

  it('validates complete reports, terminal status, output provenance, and quality denominators', () => {
    const report = batchReport();
    expect(validateDataLabBatchReport(report)).toEqual(report);
    expect(() => validateDataLabBatchReport({ ...report, operationStatus: 'running' })).toThrow(/succeeded/u);
    expect(() => validateDataLabBatchReport({
      ...report,
      qualityByPromptVariant: [
        { ...report.qualityByPromptVariant[0]!, total: 54 },
        report.qualityByPromptVariant[1]!,
      ],
    })).toThrow(/55/u);
    expect(() => validateDataLabBatchReport({ ...report, outputHash: sha('drift') })).toThrow(/reportHash/u);
    expect(() => validateDataLabBatchReport({ ...report, calculatedCostUsd: 0.051 })).toThrow(/exceeds/u);
  });

  it('enforces a finite non-negative hard cost cap', () => {
    expect(assertDataLabCostCap(0.05, 0.05)).toBe(0.05);
    expect(() => assertDataLabCostCap(0.050001, 0.05)).toThrow(/exceeds/u);
    expect(() => assertDataLabCostCap(Number.NaN, 0.05)).toThrow(/finite/u);
    expect(() => assertDataLabCostCap(0.01, -1)).toThrow(/finite/u);
  });
});
