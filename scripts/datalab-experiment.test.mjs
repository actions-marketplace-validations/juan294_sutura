import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import * as core from '../packages/evaluation/dist/datalab.js';
import { estimateBatchCost, main } from './datalab-experiment.mjs';

const SOURCE = resolve('docs/demo/placebo-v0.2-live-2026-09.json');
const MODEL = 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B';

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-datalab-'));
  return {
    directory,
    dataset: join(directory, 'dataset.jsonl'),
    request: join(directory, 'request.json'),
    record: join(directory, 'record.json'),
    report: join(directory, 'report.json'),
  };
}

async function prepare(paths) {
  return main([
    'prepare', '--source', SOURCE, '--dataset-output', paths.dataset,
    '--request-output', paths.request,
  ], { core });
}

test('prepare creates the deterministic bounded request from the real public Placebo result', async () => {
  const paths = await workspace();
  const secondPaths = await workspace();
  try {
    const request = await prepare(paths);
    const second = await prepare(secondPaths);
    assert.equal(request.rowCount, 110);
    assert.equal(request.upload.rows.length, 110);
    assert.ok(request.uploadBodyBytes <= 256 * 1024);
    assert.equal((await readFile(paths.dataset, 'utf8')).split('\n').filter(Boolean).length, 110);
    assert.doesNotMatch(JSON.stringify(request.upload), /Authorization:|\/Users\/|apiKey|suppliedSecret/u);
    assert.deepEqual(second, request);
    assert.equal(await readFile(secondPaths.dataset, 'utf8'), await readFile(paths.dataset, 'utf8'));
    assert.equal(await readFile(secondPaths.request, 'utf8'), await readFile(paths.request, 'utf8'));
    await assert.rejects(prepare(paths), /already exists/u);
  } finally {
    await rm(paths.directory, { recursive: true, force: true });
    await rm(secondPaths.directory, { recursive: true, force: true });
  }
});

test('upload and batch mutation require literal approvals and enforce the reviewed cost cap', async () => {
  const paths = await workspace();
  let datasetCalls = 0;
  let batchCalls = 0;
  let tamperSource = false;
  let prepared;
  const client = () => ({
    getDataset: async () => ({ id: 'dataset-1', version: 'version-1', name: 'dataset', status: 'READY' }),
    getDatasetContent: async () => tamperSource
      ? prepared.upload.rows.map((row, index) => index === 0 ? { ...row, elapsedTimeMs: row.elapsedTimeMs + 1 } : row)
      : prepared.upload.rows,
    createDataset: async () => {
      datasetCalls += 1;
      return { id: 'dataset-1', version: 'version-1', name: 'dataset', status: 'READY' };
    },
    createBatchOperation: async () => {
      batchCalls += 1;
      return {
        id: 'operation-1', status: 'queued',
        sourceDataset: { id: 'dataset-1', version: 'version-1' },
        outputDataset: { id: 'dataset-output', version: 'version-output' },
        createdAt: Date.parse('2026-09-04T10:01:00.000Z') / 1000,
      };
    },
  });
  try {
    prepared = await prepare(paths);
    await assert.rejects(main([
      'upload', '--request', paths.request, '--record', paths.record,
      '--request-hash', prepared.requestHash,
      '--authorization', 'NO',
    ], { core, environment: { NEBIUS_API_KEY: 'in-memory' }, client }), /authorization/u);
    assert.equal(datasetCalls, 0);
    const uploaded = await main([
      'upload', '--request', paths.request, '--record', paths.record,
      '--request-hash', prepared.requestHash,
      '--authorization', 'DATA-LAB-UPLOAD-APPROVED',
    ], { core, environment: { NEBIUS_API_KEY: 'in-memory' }, client, now: () => '2026-09-04T10:00:00.000Z' });
    assert.equal(uploaded.stage, 'uploaded');
    assert.equal(datasetCalls, 1);
    assert.doesNotMatch(await readFile(paths.record, 'utf8'), /in-memory/u);
    await assert.rejects(main([
      'upload', '--request', paths.request, '--record', paths.record,
      '--request-hash', prepared.requestHash,
      '--authorization', 'DATA-LAB-UPLOAD-APPROVED',
    ], { core, environment: { NEBIUS_API_KEY: 'in-memory' }, client }), /already exists/u);
    assert.equal(datasetCalls, 1);

    tamperSource = true;
    await assert.rejects(main([
      'run-batch', '--record', paths.record, '--request', paths.request, '--model', MODEL,
      '--completion-window', '12h', '--max-output-tokens', '64',
      '--max-cost-usd', '0.05', '--authorization', 'BATCH-INFERENCE-SPEND-APPROVED',
    ], { core, environment: { NEBIUS_API_KEY: 'in-memory' }, client }), /differs from the reviewed request/u);
    assert.equal(batchCalls, 0);
    tamperSource = false;
    await assert.rejects(main([
      'run-batch', '--record', paths.record, '--request', paths.request, '--model', MODEL,
      '--completion-window', '12h', '--max-output-tokens', '64',
      '--max-cost-usd', '0.06', '--authorization', 'BATCH-INFERENCE-SPEND-APPROVED',
    ], { core, environment: { NEBIUS_API_KEY: 'in-memory' }, client }), /reviewed WS-3 cap/u);
    assert.equal(batchCalls, 0);
    const dispatched = await main([
      'run-batch', '--record', paths.record, '--request', paths.request, '--model', MODEL,
      '--completion-window', '12h', '--max-output-tokens', '64',
      '--max-cost-usd', '0.05', '--authorization', 'BATCH-INFERENCE-SPEND-APPROVED',
    ], { core, environment: { NEBIUS_API_KEY: 'in-memory' }, client, now: () => '2026-09-04T10:01:00.000Z' });
    assert.equal(dispatched.stage, 'dispatched');
    assert.ok(dispatched.estimatedCostUsd <= 0.05);
    assert.equal(batchCalls, 1);
    assert.ok(estimateBatchCost(64) <= 0.05);
  } finally {
    await rm(paths.directory, { recursive: true, force: true });
  }
});

test('finalize binds provider identity, output hash, usage cost, and both 55-row quality denominators', async () => {
  const paths = await workspace();
  let prepared;
  const client = () => ({
    createDataset: async () => ({ id: 'dataset-1', version: 'version-1', name: 'dataset', status: 'READY' }),
    getDataset: async () => ({ id: 'dataset-1', version: 'version-1', name: 'dataset', status: 'READY' }),
    createBatchOperation: async () => ({
      id: 'operation-1', status: 'succeeded',
      sourceDataset: { id: 'dataset-1', version: 'version-1' },
      outputDataset: { id: 'dataset-output', version: 'version-output' },
      createdAt: 1_788_516_000,
    }),
    getOperation: async () => ({
      id: 'operation-1', status: 'succeeded', model: MODEL, completionWindow: '12h',
      sourceDataset: { id: 'dataset-1', version: 'version-1' },
      outputDataset: { id: 'dataset-output', version: 'version-output' },
      createdAt: 1_788_516_000, completedAt: 1_788_516_120,
    }),
    getDatasetContent: async (id) => id === 'dataset-1'
      ? prepared.upload.rows
      : prepared.upload.rows.map((row) => ({
        custom_id: row.customId,
        response: {
          body: {
            choices: [{ message: { content: row.expectedOutcome } }],
            usage: { prompt_tokens: 40, completion_tokens: 2 },
          },
        },
      })),
  });
  try {
    prepared = await prepare(paths);
    await main([
      'upload', '--request', paths.request, '--record', paths.record,
      '--request-hash', prepared.requestHash,
      '--authorization', 'DATA-LAB-UPLOAD-APPROVED',
    ], { core, environment: { NEBIUS_API_KEY: 'in-memory' }, client, now: () => '2026-09-04T10:00:00.000Z' });
    await main([
      'run-batch', '--record', paths.record, '--request', paths.request, '--model', MODEL,
      '--completion-window', '12h', '--max-output-tokens', '64',
      '--max-cost-usd', '0.05', '--authorization', 'BATCH-INFERENCE-SPEND-APPROVED',
    ], { core, environment: { NEBIUS_API_KEY: 'in-memory' }, client, now: () => '2026-09-04T10:01:00.000Z' });
    const report = await main([
      'finalize', '--record', paths.record, '--request', paths.request, '--report', paths.report,
    ], { core, environment: { NEBIUS_API_KEY: 'in-memory' }, client, now: () => '2026-09-04T10:03:00.000Z' });
    assert.equal(report.operationStatus, 'succeeded');
    assert.equal(report.costCapUsd, 0.05);
    assert.ok(report.calculatedCostUsd > 0 && report.calculatedCostUsd <= report.costCapUsd);
    assert.deepEqual(report.qualityByPromptVariant.map(({ correct, total }) => ({ correct, total })), [
      { correct: 55, total: 55 }, { correct: 55, total: 55 },
    ]);
    assert.equal(JSON.parse(await readFile(paths.record, 'utf8')).stage, 'complete');
    assert.deepEqual(JSON.parse(await readFile(paths.report, 'utf8')), report);

    const completeRecord = JSON.parse(await readFile(paths.record, 'utf8'));
    const dispatchedAgain = {
      ...completeRecord, stage: 'dispatched', operationStatus: 'succeeded',
    };
    for (const key of ['calculatedCostUsd', 'completedAt', 'latencyMs', 'outputHash', 'recordHash']) {
      delete dispatchedAgain[key];
    }
    dispatchedAgain.recordHash = core.dataLabEvidenceHash(dispatchedAgain);
    await writeFile(paths.record, `${JSON.stringify(dispatchedAgain)}\n`);
    const retried = await main([
      'finalize', '--record', paths.record, '--request', paths.request, '--report', paths.report,
    ], { core, environment: { NEBIUS_API_KEY: 'in-memory' }, client, now: () => '2026-09-04T11:03:00.000Z' });
    assert.deepEqual(retried, report);
  } finally {
    await rm(paths.directory, { recursive: true, force: true });
  }
});

test('mutation intents prevent duplicate upload or spend and support read-only recovery', async () => {
  const paths = await workspace();
  let batchCalls = 0;
  try {
    const prepared = await prepare(paths);
    await assert.rejects(main([
      'upload', '--request', paths.request, '--record', paths.record,
      '--request-hash', prepared.requestHash, '--authorization', 'DATA-LAB-UPLOAD-APPROVED',
    ], {
      core, environment: { NEBIUS_API_KEY: 'in-memory' },
      client: () => ({
        createDataset: async () => ({ id: 'dataset-pending', version: null, name: prepared.upload.name, status: 'PENDING' }),
      }),
      now: () => '2026-09-04T10:00:00.000Z',
    }), /recover after it is READY/u);
    assert.equal(JSON.parse(await readFile(`${paths.record}.upload-intent.json`, 'utf8')).requestHash, prepared.requestHash);

    const uploaded = await main([
      'recover-upload', '--request', paths.request, '--record', paths.record,
      '--dataset-id', 'dataset-pending',
    ], {
      core, environment: { NEBIUS_API_KEY: 'in-memory' },
      client: () => ({
        getDataset: async () => ({
          id: 'dataset-pending', version: 'version-1', name: prepared.upload.name, status: 'READY',
        }),
      }),
      now: () => '2026-09-04T10:01:00.000Z',
    });
    assert.equal(uploaded.stage, 'uploaded');

    const ambiguousClient = () => ({
      getDataset: async () => ({ id: 'dataset-pending', version: 'version-1', name: prepared.upload.name, status: 'READY' }),
      getDatasetContent: async () => prepared.upload.rows,
      createBatchOperation: async () => { batchCalls += 1; throw new Error('ambiguous network failure'); },
    });
    const batchArguments = [
      'run-batch', '--record', paths.record, '--request', paths.request, '--model', MODEL,
      '--completion-window', '12h', '--max-output-tokens', '64',
      '--max-cost-usd', '0.05', '--authorization', 'BATCH-INFERENCE-SPEND-APPROVED',
    ];
    await assert.rejects(main(batchArguments, {
      core, environment: { NEBIUS_API_KEY: 'in-memory' }, client: ambiguousClient,
      now: () => '2026-09-04T10:02:00.000Z',
    }), /ambiguous network failure/u);
    await assert.rejects(main(batchArguments, {
      core, environment: { NEBIUS_API_KEY: 'in-memory' }, client: ambiguousClient,
      now: () => '2026-09-04T10:02:00.000Z',
    }), /recovery intent already exists/u);
    assert.equal(batchCalls, 1);

    await assert.rejects(main([
      'recover-batch', '--record', paths.record, '--operation-id', 'operation-stale',
    ], {
      core, environment: { NEBIUS_API_KEY: 'in-memory' },
      client: () => ({
        getOperation: async () => ({
          id: 'operation-stale', status: 'queued', model: MODEL, completionWindow: '12h',
          sourceDataset: { id: 'dataset-pending', version: 'version-1' },
          outputDataset: { id: 'dataset-output', version: null },
          createdAt: Date.parse('2026-09-04T09:00:00.000Z') / 1000,
        }),
      }),
      now: () => '2026-09-04T10:03:00.000Z',
    }), /identity does not match intent/u);

    const dispatched = await main([
      'recover-batch', '--record', paths.record, '--operation-id', 'operation-1',
    ], {
      core, environment: { NEBIUS_API_KEY: 'in-memory' },
      client: () => ({
        getOperation: async () => ({
          id: 'operation-1', status: 'queued', model: MODEL, completionWindow: '12h',
          sourceDataset: { id: 'dataset-pending', version: 'version-1' },
          outputDataset: { id: 'dataset-output', version: null },
          createdAt: Date.parse('2026-09-04T10:02:01.000Z') / 1000,
        }),
      }),
      now: () => '2026-09-04T10:03:00.000Z',
    });
    assert.equal(dispatched.outputDatasetVersion, null);
  } finally {
    await rm(paths.directory, { recursive: true, force: true });
  }
});
