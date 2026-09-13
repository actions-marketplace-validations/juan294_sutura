import { prepareQualityExperiment, scoreQualityOutputs, freezeQualitySelection, executeQualityStep } from './datalab-quality-experiment.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as core from '../packages/evaluation/dist/index.js';
import { contentHash } from './evidence-contract.mjs';

function source(split = 'validation') {
  const executed = { recordId: 'case-a', failureExcerpt: 'expected 3 received 2', candidateDiff: '-floor\n+ceil', publicContracts: [], observations: [{ command: 'test', exitCode: 0, output: 'passed' }], changedPaths: ['page.js'] };
  const entries = [{ customId: 'case-a', record: core.blindExecutedRecord(executed), split, rootFamily: 'pagination', provenance: { source: 'local fixture', license: 'MIT', revision: 'v1' }, scoringKey: { truth: 'preserves-contract', oracleRevision: 'private-oracle-v1' } }];
  const manifest = { schemaVersion: 'sutura-verified-program-manifest-v1', identity: { candidateCommit: 'a'.repeat(40), imageDigest: 'b'.repeat(64), corpusHash: 'c'.repeat(64), splitHash: 'd'.repeat(64), configHash: 'e'.repeat(64) }, models: [{ modelId: 'verified-model', inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.2, priceAsOf: '2026-09-08' }], caps: { subjects: 1, repetitions: 1, modelTurnsPerSubject: 2, maxOutputTokens: 512, sandboxOperations: 1, elapsedTimeSec: 43200, inferenceUsd: 1, rawSandboxUnits: 1, concurrency: 1 }, mode: 'live', subjects: ['case-a'], stopPolicy: 'One batch; no relaunch. Retain terminal errors.' };
  if (split === 'held-out') { entries[0].rootFamily = 'held-family'; entries[0].customId = 'case-held'; manifest.subjects = ['case-held']; }
  return { entries, sources: { [entries[0].customId]: JSON.stringify(executed) }, manifest, split };
}
function output(request, overrides = {}) {
  return { customId: request.customId, response: { body: { model: 'verified-model', choices: [{ message: { content: JSON.stringify({ label: 'preserves-contract', confidence: 0.9, citedEvidence: [] }) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } } }, ...overrides };
}

test('v2 prepare binds private sources and caps while only uploading blinded prompt rows', () => {
  const prepared = prepareQualityExperiment(source(), core);
  assert.equal(prepared.request.upload.rows.length, 2);
  assert.doesNotMatch(JSON.stringify(prepared.request.upload), /private-oracle|scoringKey|rootFamily|preserves-contract.*oracle/u);
  assert.equal(prepared.request.sidecarHash, contentHash(prepared.sidecar));
  assert.ok(prepared.request.maximumCostUsd <= 1);
  const changed = source(); changed.sources['case-a'] += ' ';
  assert.throws(() => prepareQualityExperiment(changed, core), /source/u);
  const altered = source(); altered.entries[0].record.candidateDiff = 'tampered';
  assert.throws(() => prepareQualityExperiment(altered, core), /source|blinded/u);
  const over = source(); over.manifest.caps.inferenceUsd = 0.000001;
  assert.throws(() => prepareQualityExperiment(over, core), /cap/u);
});

test('heldout requires validation-selected frozen prompt and prepares exactly one arm', () => {
  assert.throws(() => prepareQualityExperiment(source('held-out'), core), /selection/u);
  const validation = prepareQualityExperiment(source(), core);
  const report = scoreQualityOutputs(validation.request.upload.rows.map((row) => output(row)), validation.request, validation.sidecar, core);
  const terminal = { ...report, terminalStatus: 'succeeded' };
  delete terminal.reportHash; terminal.reportHash = contentHash(terminal);
  const selection = freezeQualitySelection(terminal, validation.request);
  const held = prepareQualityExperiment({ ...source('held-out'), selection }, core);
  assert.equal(held.request.upload.rows.length, 1);
  assert.equal(held.request.variants[0], selection.variant);
  assert.throws(() => freezeQualitySelection(report, { ...validation.request, split: 'development' }), /validation/u);
  const changed = source('held-out'); changed.manifest.identity.configHash = 'f'.repeat(64);
  assert.throws(() => prepareQualityExperiment({ ...changed, selection }, core), /identity/u);
});

test('partial outputs preserve missing/error costs and prevent selection', () => {
  const { request, sidecar } = prepareQualityExperiment(source(), core);
  const report = scoreQualityOutputs([output(request.upload.rows[0])], request, sidecar, core);
  assert.equal(report.missingOutputs, 1);
  assert.equal(report.unknownCost, 1);
  assert.equal(report.totalCostUsd, null);
  assert.throws(() => freezeQualitySelection(report, request), /complete/u);
  const failed = output(request.upload.rows[0], { error: { message: 'failed' } });
  const failureReport = scoreQualityOutputs([failed], request, sidecar, core);
  assert.equal(failureReport.errors.length, 1);
  assert.ok(failureReport.knownCostUsd > 0);
  assert.equal(failureReport.scores[request.variants[0]].scored, 0);
});

test('scoring rejects changed private keys, unknown/duplicate IDs and model drift', () => {
  const { request, sidecar } = prepareQualityExperiment(source(), core);
  const row = output(request.upload.rows[0]);
  assert.throws(() => scoreQualityOutputs([row, row], request, sidecar, core), /duplicate/u);
  assert.throws(() => scoreQualityOutputs([{ ...row, customId: 'other' }], request, sidecar, core), /unknown/u);
  const changed = structuredClone(sidecar); changed.entries[0].scoringKey.truth = 'breaks-contract';
  assert.throws(() => scoreQualityOutputs([row], request, changed, core), /sidecar/u);
  row.response.body.model = 'other-model';
  const report = scoreQualityOutputs([row], request, sidecar, core);
  assert.equal(report.errors[0].reason, 'model-mismatch');
  assert.equal(report.unknownCost, 2);
  assert.equal(report.knownCostUsd, 0);
  delete row.response.body.model;
  const missingIdentity = scoreQualityOutputs([row], request, sidecar, core);
  assert.equal(missingIdentity.errors[0].reason, 'missing-model-identity');
  assert.equal(missingIdentity.unknownCost, 2);
  assert.equal(report.scores[request.variants[0]].scored, 0);
});

test('filesystem flow persists dispatch intent and recovery never redispatches', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-quality-'));
  try {
    const prepared = prepareQualityExperiment(source(), core);
    let uploads = 0; let dispatches = 0; let loseResponse = true;
    const operation = { id: 'job-1', status: 'succeeded', sourceDataset: { id: 'data-1', version: 'v1' }, outputDataset: { id: 'out-1', version: 'v2' }, model: 'verified-model', completionWindow: '12h', createdAt: Date.parse('2026-09-08T00:00:00Z') / 1000, completedAt: Date.parse('2026-09-08T00:01:00Z') / 1000 };
    const client = {
      createDataset: async (value) => { uploads++; return { id: 'data-1', name: value.name, version: 'v1', status: 'READY' }; },
      getDataset: async () => ({ id: 'data-1', name: prepared.request.upload.name, version: 'v1', status: 'READY' }),
      getDatasetContent: async (id) => id === 'data-1' ? prepared.request.upload.rows : prepared.request.upload.rows.map((row) => output(row)),
      createBatchOperation: async () => { dispatches++; if (loseResponse) throw new Error('response lost'); return operation; },
      getOperation: async () => operation,
    };
    const run = (step, extra = {}) => executeQualityStep({ step, directory, core, client, dispatchRegistryDirectory: join(directory, 'registry'), now: () => '2026-09-08T00:00:00Z', ...extra });
    await run('prepare', { prepared });
    await assert.rejects(run('upload'), /authorization/u);
    await run('upload', { authorization: 'DATA-LAB-UPLOAD-APPROVED', requestHash: prepared.request.requestHash });
    await assert.rejects(run('run-batch', { authorization: 'BATCH-INFERENCE-SPEND-APPROVED', requestHash: prepared.request.requestHash }), /response lost/u);
    await assert.rejects(run('run-batch', { authorization: 'BATCH-INFERENCE-SPEND-APPROVED', requestHash: prepared.request.requestHash }), /recover|intent/u);
    loseResponse = false;
    await run('recover-batch', { operationId: 'job-1' });
    const report = await run('finalize');
    assert.equal(report.totalCostUsd > 0, true);
    assert.equal(uploads, 1); assert.equal(dispatches, 1);
    assert.deepEqual(await run('finalize'), report);
    assert.equal(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).stage, 'complete');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a copied experiment cannot reset the manifest dispatch reservation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-quality-copy-'));
  try {
    const prepared = prepareQualityExperiment(source(), core);
    const registry = join(directory, 'registry');
    let calls = 0;
    const client = {
      createDataset: async (request) => ({ id: 'data', name: request.name, version: 'v1', status: 'READY' }),
      getDatasetContent: async () => prepared.request.upload.rows,
      createBatchOperation: async () => { calls++; throw new Error('ambiguous dispatch'); },
    };
    for (const suffix of ['first', 'second']) {
      const run = (step, extra = {}) => executeQualityStep({ step, directory: join(directory, suffix), dispatchRegistryDirectory: registry, core, client, ...extra });
      await run('prepare', { prepared });
      await run('upload', { authorization: 'DATA-LAB-UPLOAD-APPROVED', requestHash: prepared.request.requestHash });
      await assert.rejects(run('run-batch', { authorization: 'BATCH-INFERENCE-SPEND-APPROVED', requestHash: prepared.request.requestHash }), suffix === 'first' ? /ambiguous/u : /Manifest dispatch intent/u);
    }
    assert.equal(calls, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('terminal success with missing completion timing stays unknown and cannot select a prompt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-quality-time-'));
  try {
    const prepared = prepareQualityExperiment(source(), core);
    const operation = { id: 'job', status: 'succeeded', sourceDataset: { id: 'data', version: 'v1' }, outputDataset: { id: 'out', version: 'v2' }, model: 'verified-model', completionWindow: '12h', createdAt: Date.parse('2026-09-08T00:00:00Z') / 1000, completedAt: null };
    const client = {
      createDataset: async (value) => ({ id: 'data', name: value.name, version: 'v1', status: 'READY' }),
      getDatasetContent: async (id) => id === 'data' ? prepared.request.upload.rows : prepared.request.upload.rows.map((row) => output(row)),
      createBatchOperation: async () => operation,
      getOperation: async () => operation,
    };
    const run = (step, extra = {}) => executeQualityStep({ step, directory, core, client, dispatchRegistryDirectory: join(directory, 'registry'), now: () => '2026-09-08T00:00:00Z', ...extra });
    await run('prepare', { prepared });
    await run('upload', { authorization: 'DATA-LAB-UPLOAD-APPROVED', requestHash: prepared.request.requestHash });
    await run('run-batch', { authorization: 'BATCH-INFERENCE-SPEND-APPROVED', requestHash: prepared.request.requestHash });
    const report = await run('finalize');
    assert.equal(report.elapsedTimeMs, null);
    assert.ok(report.errors.some((error) => error.reason === 'missing-completion-time'));
    assert.throws(() => freezeQualitySelection(report, prepared.request), /complete/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
