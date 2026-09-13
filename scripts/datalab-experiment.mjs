#!/usr/bin/env node

import { access, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, contentHash } from './evidence-contract.mjs';

const UPLOAD_APPROVAL = 'DATA-LAB-UPLOAD-APPROVED';
const BATCH_APPROVAL = 'BATCH-INFERENCE-SPEND-APPROVED';
const MODEL = 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B';
const COMPLETION_WINDOW = '12h';
const MAX_OUTPUT_TOKENS = 64;
const MAX_COST_USD = 0.05;
const INPUT_USD_PER_MILLION = 0.06;
const OUTPUT_USD_PER_MILLION = 0.24;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function defaultCore() {
  try {
    return await import('../packages/evaluation/dist/datalab.js');
  } catch (error) {
    throw new Error('Build @sutura/evaluation before running the Data Lab workflow: pnpm --filter @sutura/evaluation build', { cause: error });
  }
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function omit(value, keys) {
  const result = { ...value };
  for (const key of keys) delete result[key];
  return result;
}

function exactKeys(value, required, label) {
  const actual = Object.keys(object(value, label)).sort();
  const expected = [...required].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} keys must be exactly: ${required.join(', ')}`);
  }
}

function number(value, label, { integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`${label} must be a finite non-negative${integer ? ' integer' : ' number'}`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be non-empty`);
  return value;
}

function values(args) {
  const result = new Map();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || !value || value.startsWith('--') || result.has(flag)) {
      throw new Error(`Invalid Data Lab argument: ${flag ?? '(missing)'}`);
    }
    result.set(flag, value);
  }
  return result;
}

function requireOptions(options, expected) {
  if (options.size !== expected.length || expected.some((flag) => !options.has(flag))) {
    throw new Error(`Expected exactly: ${expected.join(' ')}`);
  }
}

async function readJson(path, maximumBytes, label) {
  const bytes = await readFile(path);
  if (bytes.byteLength > maximumBytes) throw new Error(`${label} exceeds ${maximumBytes} bytes`);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} must be valid JSON`, { cause: error });
  }
}

async function writeExclusive(path, value) {
  await writeFile(path, value, { encoding: 'utf8', flag: 'wx' });
}

async function assertAbsent(path, label) {
  try {
    await access(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`${label} already exists`);
}

async function atomicReplace(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}

function datasetSchema() {
  const primitive = (name, type) => ({ name, type: { name: type } });
  const optional = (name, type) => ({ name, type: { name: 'option', item: { name: type } } });
  return [
    primitive('schemaVersion', 'string'), primitive('customId', 'string'),
    primitive('promptVersion', 'string'), primitive('kind', 'string'),
    primitive('language', 'string'), optional('difficulty', 'string'),
    primitive('failureClass', 'string'), optional('flakePattern', 'string'),
    primitive('tavilyEnabled', 'boolean'), primitive('observedOutcome', 'string'),
    primitive('expectedOutcome', 'string'), primitive('elapsedTimeMs', 'double'),
    primitive('inferenceCostUsd', 'double'), primitive('sandboxOperationCount', 'integer'),
    primitive('messages', 'json'),
  ];
}

export function createPreparedRequest(prepared, core) {
  const upload = {
    name: `sutura-placebo-v0-2-${prepared.inputHash.slice(0, 12)}`,
    folder: '/sutura/ws-3',
    schema: datasetSchema(),
    rows: prepared.rows,
  };
  const uploadBodyBytes = Buffer.byteLength(canonicalJson(upload));
  if (prepared.rowCount !== core.DATALAB_EXPECTED_ROWS || upload.rows.length !== core.DATALAB_EXPECTED_ROWS) {
    throw new Error('Data Lab upload must contain exactly 110 rows');
  }
  if (uploadBodyBytes > core.DATALAB_MAX_BODY_BYTES) throw new Error('Data Lab upload exceeds 256 KiB');
  for (const row of upload.rows) {
    if (Buffer.byteLength(canonicalJson(row)) > core.DATALAB_MAX_ROW_BYTES) {
      throw new Error('Data Lab upload row exceeds 2 KiB');
    }
  }
  const base = {
    schemaVersion: core.DATALAB_DATASET_SCHEMA_VERSION,
    sourceResultHash: prepared.sourceResultHash,
    corpusHash: prepared.corpusHash,
    controllerSha: prepared.controllerSha,
    subjectSha: prepared.subjectSha,
    corpusVersion: prepared.corpusVersion,
    promptVersions: prepared.promptVersions,
    rowCount: prepared.rowCount,
    inputHash: prepared.inputHash,
    jsonlByteLength: prepared.byteLength,
    uploadBodyBytes,
    upload,
  };
  return { ...base, requestHash: contentHash(base) };
}

export function validatePreparedRequest(input, core) {
  exactKeys(input, [
    'schemaVersion', 'sourceResultHash', 'corpusHash', 'controllerSha', 'subjectSha',
    'corpusVersion', 'promptVersions', 'rowCount', 'inputHash', 'jsonlByteLength',
    'uploadBodyBytes', 'upload', 'requestHash',
  ], 'Data Lab prepared request');
  if (input.schemaVersion !== core.DATALAB_DATASET_SCHEMA_VERSION) throw new Error('Prepared request schema is invalid');
  for (const [field, pattern] of [
    ['sourceResultHash', /^[a-f0-9]{64}$/u], ['corpusHash', /^[a-f0-9]{64}$/u],
    ['controllerSha', /^[a-f0-9]{40}$/u], ['subjectSha', /^[a-f0-9]{40}$/u],
    ['inputHash', /^[a-f0-9]{64}$/u], ['requestHash', /^[a-f0-9]{64}$/u],
  ]) if (!pattern.test(input[field] ?? '')) throw new Error(`Prepared request ${field} is invalid`);
  if (input.corpusVersion !== '0.2') throw new Error('Prepared request corpusVersion is invalid');
  exactKeys(input.upload, ['name', 'folder', 'schema', 'rows'], 'Data Lab upload');
  if (input.upload.name !== `sutura-placebo-v0-2-${input.inputHash.slice(0, 12)}` ||
      input.upload.folder !== '/sutura/ws-3' ||
      canonicalJson(input.upload.schema) !== canonicalJson(datasetSchema())) {
    throw new Error('Prepared request upload identity or schema is invalid');
  }
  if (input.rowCount !== core.DATALAB_EXPECTED_ROWS || !Array.isArray(input.upload?.rows) ||
      input.upload.rows.length !== core.DATALAB_EXPECTED_ROWS) throw new Error('Prepared request must contain 110 rows');
  if (JSON.stringify(input.promptVersions) !== JSON.stringify(core.DATALAB_PROMPT_VERSIONS)) {
    throw new Error('Prepared request prompt versions are invalid');
  }
  const uploadBodyBytes = Buffer.byteLength(canonicalJson(input.upload));
  if (uploadBodyBytes !== input.uploadBodyBytes || uploadBodyBytes > core.DATALAB_MAX_BODY_BYTES) {
    throw new Error('Prepared request upload size is invalid');
  }
  const jsonl = `${input.upload.rows.map(canonicalJson).join('\n')}\n`;
  if (Buffer.byteLength(jsonl) !== input.jsonlByteLength || sha256(jsonl) !== input.inputHash) {
    throw new Error('Prepared request input hash is invalid');
  }
  for (const row of input.upload.rows) core.validateDataLabRow(row);
  const { requestHash, ...base } = input;
  if (contentHash(base) !== requestHash) throw new Error('Prepared request hash is invalid');
  return input;
}

export function estimateBatchCost(maxOutputTokens = MAX_OUTPUT_TOKENS, maximumInputBytes = 256 * 1024) {
  number(maxOutputTokens, 'maxOutputTokens', { integer: true });
  number(maximumInputBytes, 'maximumInputBytes', { integer: true });
  return (maximumInputBytes * INPUT_USD_PER_MILLION +
    110 * maxOutputTokens * OUTPUT_USD_PER_MILLION) / 1_000_000;
}

function evidenceWithHash(base, core) {
  return { ...base, recordHash: core.dataLabEvidenceHash(base) };
}

function intentWithHash(base) {
  return { ...base, intentHash: contentHash(base) };
}

function validateIntent(input, schemaVersion) {
  object(input, 'Data Lab recovery intent');
  if (input.schemaVersion !== schemaVersion) throw new Error('Data Lab recovery intent schema is invalid');
  const { intentHash, ...base } = input;
  if (!/^[a-f0-9]{64}$/u.test(intentHash ?? '') || contentHash(base) !== intentHash) {
    throw new Error('Data Lab recovery intent hash is invalid');
  }
  return input;
}

function batchRequest(record, model, completionWindow, maxOutputTokens) {
  return {
    type: 'batch_inference',
    src: [{
      id: record.datasetId,
      version: record.datasetVersion,
      mapping: {
        type: 'text_messages',
        messages: { type: 'column', name: 'messages' },
        custom_id: { type: 'column', name: 'customId' },
        max_tokens: { type: 'number', value: maxOutputTokens },
      },
    }],
    dst: [],
    params: { model, completion_window: completionWindow },
  };
}

function canonicalDatasetIdentity(rows) {
  if (!Array.isArray(rows)) throw new Error('Data Lab dataset content must be rows');
  const ordered = [...rows].sort((left, right) =>
    string(left.customId ?? left.custom_id, 'Data Lab source custom ID')
      .localeCompare(string(right.customId ?? right.custom_id, 'Data Lab source custom ID')));
  return contentHash(ordered);
}

function customId(row) {
  return string(row.customId ?? row.custom_id, 'Data Lab output custom ID');
}

function completion(row) {
  const candidates = [
    row.output, row.completion, row.response,
    row.choices?.[0]?.message?.content,
    row.body?.choices?.[0]?.message?.content,
    row.response?.body?.choices?.[0]?.message?.content,
  ];
  const value = candidates.find((candidate) => typeof candidate === 'string');
  return string(value, 'Data Lab output completion').trim().toLowerCase();
}

function usage(row) {
  const input = row.response?.body?.usage ?? row.body?.usage ?? row.usage;
  object(input, 'Data Lab output usage');
  return {
    input: number(input.prompt_tokens ?? input.input_tokens, 'input tokens', { integer: true }),
    output: number(input.completion_tokens ?? input.output_tokens, 'output tokens', { integer: true }),
  };
}

export function scoreOutputs(rows, preparedRequest, core) {
  if (!Array.isArray(rows) || rows.length !== core.DATALAB_EXPECTED_ROWS) {
    throw new Error('Data Lab output must contain exactly 110 rows');
  }
  const expected = new Map(preparedRequest.upload.rows.map((row) => [row.customId, row]));
  const seen = new Set();
  const scores = new Map(core.DATALAB_PROMPT_VERSIONS.map((version) => [version, {
    correct: 0, inputTokens: 0, outputTokens: 0,
  }]));
  let inputTokens = 0;
  let outputTokens = 0;
  for (const raw of rows) {
    const row = object(raw, 'Data Lab output row');
    const id = customId(row);
    if (seen.has(id) || !expected.has(id)) throw new Error('Data Lab output custom ID is duplicate or unknown');
    seen.add(id);
    const source = expected.get(id);
    const prompt = scores.get(source.promptVersion);
    if (completion(row) === source.expectedOutcome) prompt.correct += 1;
    const tokens = usage(row);
    if (tokens.output > MAX_OUTPUT_TOKENS) throw new Error('Data Lab output exceeded the 64-token row cap');
    inputTokens += tokens.input;
    outputTokens += tokens.output;
    prompt.inputTokens += tokens.input;
    prompt.outputTokens += tokens.output;
  }
  const calculatedCostUsd = (inputTokens * INPUT_USD_PER_MILLION + outputTokens * OUTPUT_USD_PER_MILLION) / 1_000_000;
  const qualityByPromptVariant = core.DATALAB_PROMPT_VERSIONS.map((promptVersion) => {
    const prompt = scores.get(promptVersion);
    return {
      promptVersion, correct: prompt.correct, total: 55, accuracy: prompt.correct / 55,
      inputTokens: prompt.inputTokens, outputTokens: prompt.outputTokens,
      calculatedCostUsd: (prompt.inputTokens * INPUT_USD_PER_MILLION +
        prompt.outputTokens * OUTPUT_USD_PER_MILLION) / 1_000_000,
    };
  });
  const ranked = [...qualityByPromptVariant].sort((left, right) =>
    right.accuracy - left.accuracy || left.promptVersion.localeCompare(right.promptVersion));
  const winner = ranked[0];
  const loser = ranked[1];
  return {
    calculatedCostUsd,
    qualityByPromptVariant,
    comparison: {
      winnerPromptVersion: winner.promptVersion, loserPromptVersion: loser.promptVersion,
      accuracyDelta: winner.accuracy - loser.accuracy, tied: winner.accuracy === loser.accuracy,
    },
  };
}

function defaultDependencies(core, environment = process.env) {
  return {
    core,
    environment,
    client: (apiKey) => new core.DataLabClient({ apiKey, fetch }),
    now: () => new Date().toISOString(),
  };
}

async function dependencies(overrides) {
  const core = overrides.core ?? await defaultCore();
  return { ...defaultDependencies(core, overrides.environment), ...overrides, core };
}

async function prepare(options, run) {
  requireOptions(options, ['--source', '--dataset-output', '--request-output']);
  const source = await readJson(options.get('--source'), 2 * 1024 * 1024, 'Placebo source result');
  const prepared = run.core.prepareDataLabDataset(source);
  const request = createPreparedRequest(prepared, run.core);
  validatePreparedRequest(request, run.core);
  await assertAbsent(options.get('--dataset-output'), 'Dataset output');
  await assertAbsent(options.get('--request-output'), 'Request output');
  await writeExclusive(options.get('--dataset-output'), prepared.jsonl);
  try {
    await writeExclusive(options.get('--request-output'), `${canonicalJson(request)}\n`);
  } catch (error) {
    throw new Error('Dataset output was created but request output failed; remove the incomplete dataset output before retrying', { cause: error });
  }
  return request;
}

async function upload(options, run) {
  requireOptions(options, ['--request', '--record', '--request-hash', '--authorization']);
  if (options.get('--authorization') !== UPLOAD_APPROVAL) throw new Error('Data Lab upload authorization is missing');
  const apiKey = string(run.environment.NEBIUS_API_KEY, 'NEBIUS_API_KEY');
  const request = validatePreparedRequest(
    await readJson(options.get('--request'), 384 * 1024, 'Data Lab prepared request'), run.core,
  );
  if (options.get('--request-hash') !== request.requestHash) throw new Error('Approved Data Lab request hash does not match');
  await assertAbsent(options.get('--record'), 'Experiment record');
  const intentPath = `${options.get('--record')}.upload-intent.json`;
  await assertAbsent(intentPath, 'Upload recovery intent');
  const intent = intentWithHash({
    schemaVersion: 'sutura-datalab-upload-intent-v1', requestHash: request.requestHash,
    datasetName: request.upload.name, preparedAt: run.now(),
  });
  await writeExclusive(intentPath, `${canonicalJson(intent)}\n`);
  const dataset = await run.client(apiKey).createDataset(request.upload);
  if (dataset.status === 'FAILED') throw new Error('Nebius rejected the Data Lab dataset');
  if (dataset.status !== 'READY' || dataset.version === null) {
    throw new Error(`Dataset ${dataset.id} is ${dataset.status}; keep the intent and recover after it is READY`);
  }
  const base = {
    schemaVersion: run.core.DATALAB_EXPERIMENT_SCHEMA_VERSION,
    stage: 'uploaded',
    requestHash: request.requestHash,
    sourceResultHash: request.sourceResultHash,
    inputHash: request.inputHash,
    rowCount: request.rowCount,
    promptVersions: request.promptVersions,
    datasetId: dataset.id,
    datasetVersion: dataset.version,
    uploadedAt: run.now(),
  };
  const record = run.core.validateDataLabExperimentRecord(evidenceWithHash(base, run.core));
  try {
    await writeExclusive(options.get('--record'), `${canonicalJson(record)}\n`);
  } catch (error) {
    throw new Error(`Dataset ${dataset.id} version ${dataset.version} was uploaded but its record could not be saved; do not upload again`, { cause: error });
  }
  await unlink(intentPath);
  return record;
}

async function recoverUpload(options, run) {
  requireOptions(options, ['--request', '--record', '--dataset-id']);
  const apiKey = string(run.environment.NEBIUS_API_KEY, 'NEBIUS_API_KEY');
  const recordPath = options.get('--record');
  await assertAbsent(recordPath, 'Experiment record');
  const intentPath = `${recordPath}.upload-intent.json`;
  const intent = validateIntent(
    await readJson(intentPath, 16 * 1024, 'Upload recovery intent'), 'sutura-datalab-upload-intent-v1',
  );
  const request = validatePreparedRequest(
    await readJson(options.get('--request'), 384 * 1024, 'Data Lab prepared request'), run.core,
  );
  if (intent.requestHash !== request.requestHash || intent.datasetName !== request.upload.name) {
    throw new Error('Upload recovery intent does not match the prepared request');
  }
  const dataset = await run.client(apiKey).getDataset(options.get('--dataset-id'));
  if (dataset.name !== request.upload.name || dataset.status !== 'READY' || dataset.version === null) {
    throw new Error('Recovered dataset identity is not READY or does not match');
  }
  const base = {
    schemaVersion: run.core.DATALAB_EXPERIMENT_SCHEMA_VERSION, stage: 'uploaded',
    requestHash: request.requestHash, sourceResultHash: request.sourceResultHash,
    inputHash: request.inputHash, rowCount: request.rowCount,
    promptVersions: request.promptVersions, datasetId: dataset.id,
    datasetVersion: dataset.version, uploadedAt: run.now(),
  };
  const record = run.core.validateDataLabExperimentRecord(evidenceWithHash(base, run.core));
  await writeExclusive(recordPath, `${canonicalJson(record)}\n`);
  await unlink(intentPath);
  return record;
}

function dispatchedRecord(uploaded, operation, parameters, run) {
  const base = omit(uploaded, ['recordHash', 'stage']);
  const dispatchedBase = {
    ...base, stage: 'dispatched', operationId: operation.id,
    operationStatus: operation.status, outputDatasetId: operation.outputDataset.id,
    outputDatasetVersion: operation.outputDataset.version, model: parameters.model,
    completionWindow: parameters.completionWindow, maxOutputTokens: parameters.maxOutputTokens,
    estimatedCostUsd: parameters.estimatedCostUsd, costCapUsd: parameters.costCapUsd,
    dispatchedAt: new Date(operation.createdAt * 1000).toISOString(),
  };
  return run.core.validateDataLabExperimentRecord(evidenceWithHash(dispatchedBase, run.core));
}

async function runBatch(options, run) {
  requireOptions(options, [
    '--record', '--request', '--model', '--completion-window', '--max-output-tokens',
    '--max-cost-usd', '--authorization',
  ]);
  if (options.get('--authorization') !== BATCH_APPROVAL) throw new Error('Batch inference spend authorization is missing');
  const apiKey = string(run.environment.NEBIUS_API_KEY, 'NEBIUS_API_KEY');
  const model = options.get('--model');
  const completionWindow = options.get('--completion-window');
  const maxOutputTokens = Number(options.get('--max-output-tokens'));
  const costCapUsd = Number(options.get('--max-cost-usd'));
  if (model !== MODEL || completionWindow !== COMPLETION_WINDOW || maxOutputTokens !== MAX_OUTPUT_TOKENS || costCapUsd !== MAX_COST_USD) {
    throw new Error('Batch parameters must match the reviewed WS-3 cap');
  }
  const recordPath = options.get('--record');
  const uploaded = run.core.validateDataLabExperimentRecord(
    await readJson(recordPath, 64 * 1024, 'Data Lab experiment record'),
  );
  if (uploaded.stage !== 'uploaded') throw new Error('Batch dispatch requires an uploaded experiment record');
  const request = validatePreparedRequest(
    await readJson(options.get('--request'), 384 * 1024, 'Data Lab prepared request'), run.core,
  );
  if (request.requestHash !== uploaded.requestHash || request.inputHash !== uploaded.inputHash) {
    throw new Error('Prepared request identity differs from uploaded experiment record');
  }
  const client = run.client(apiKey);
  const dataset = await client.getDataset(uploaded.datasetId);
  if (dataset.status !== 'READY' || dataset.version !== uploaded.datasetVersion) {
    throw new Error('Source dataset is not READY at the recorded version');
  }
  const sourceRows = await client.getDatasetContent(uploaded.datasetId, uploaded.datasetVersion);
  sourceRows.forEach((row) => run.core.validateDataLabRow(row));
  if (canonicalDatasetIdentity(sourceRows) !== canonicalDatasetIdentity(request.upload.rows)) {
    throw new Error('Source dataset content differs from the reviewed request');
  }
  const estimatedCostUsd = estimateBatchCost(maxOutputTokens);
  run.core.assertDataLabCostCap(estimatedCostUsd, costCapUsd);
  const intentPath = `${recordPath}.batch-intent.json`;
  await assertAbsent(intentPath, 'Batch recovery intent');
  const intent = intentWithHash({
    schemaVersion: 'sutura-datalab-batch-intent-v1', recordHash: uploaded.recordHash,
    model, completionWindow, maxOutputTokens, estimatedCostUsd, costCapUsd, preparedAt: run.now(),
  });
  await writeExclusive(intentPath, `${canonicalJson(intent)}\n`);
  const operation = await client.createBatchOperation(
    batchRequest(uploaded, model, completionWindow, maxOutputTokens),
  );
  if (!['queued', 'running', 'succeeded'].includes(operation.status)) {
    throw new Error(`Batch inference returned terminal status ${operation.status}`);
  }
  const dispatched = dispatchedRecord(uploaded, operation, {
    model, completionWindow, maxOutputTokens, estimatedCostUsd, costCapUsd,
  }, run);
  try {
    await atomicReplace(recordPath, `${canonicalJson(dispatched)}\n`);
  } catch (error) {
    throw new Error(`Batch operation ${operation.id} was dispatched but its record could not be saved; do not dispatch again`, { cause: error });
  }
  await unlink(intentPath);
  return dispatched;
}

async function recoverBatch(options, run) {
  requireOptions(options, ['--record', '--operation-id']);
  const apiKey = string(run.environment.NEBIUS_API_KEY, 'NEBIUS_API_KEY');
  const recordPath = options.get('--record');
  const uploaded = run.core.validateDataLabExperimentRecord(
    await readJson(recordPath, 64 * 1024, 'Data Lab experiment record'),
  );
  if (uploaded.stage !== 'uploaded') throw new Error('Batch recovery requires the original uploaded record');
  const intentPath = `${recordPath}.batch-intent.json`;
  const intent = validateIntent(
    await readJson(intentPath, 16 * 1024, 'Batch recovery intent'), 'sutura-datalab-batch-intent-v1',
  );
  if (intent.recordHash !== uploaded.recordHash) throw new Error('Batch recovery intent does not match record');
  const operation = await run.client(apiKey).getOperation(options.get('--operation-id'));
  const preparedAtMs = Date.parse(intent.preparedAt);
  const createdAtMs = operation.createdAt * 1000;
  if (!['queued', 'running', 'succeeded'].includes(operation.status) ||
      operation.sourceDataset.id !== uploaded.datasetId ||
      operation.sourceDataset.version !== uploaded.datasetVersion ||
      operation.model !== intent.model || operation.completionWindow !== intent.completionWindow ||
      !Number.isFinite(preparedAtMs) || createdAtMs < preparedAtMs - 5_000 ||
      createdAtMs > Date.parse(run.now()) + 5_000) {
    throw new Error('Recovered batch operation identity does not match intent');
  }
  const dispatched = dispatchedRecord(uploaded, operation, intent, run);
  await atomicReplace(recordPath, `${canonicalJson(dispatched)}\n`);
  await unlink(intentPath);
  return dispatched;
}

async function finalize(options, run) {
  requireOptions(options, ['--record', '--request', '--report']);
  const apiKey = string(run.environment.NEBIUS_API_KEY, 'NEBIUS_API_KEY');
  const recordPath = options.get('--record');
  const dispatched = run.core.validateDataLabExperimentRecord(
    await readJson(recordPath, 64 * 1024, 'Data Lab experiment record'),
  );
  if (dispatched.stage !== 'dispatched') throw new Error('Finalize requires a dispatched experiment record');
  const request = validatePreparedRequest(
    await readJson(options.get('--request'), 384 * 1024, 'Data Lab prepared request'), run.core,
  );
  if (request.requestHash !== dispatched.requestHash || request.inputHash !== dispatched.inputHash) {
    throw new Error('Prepared request identity differs from experiment record');
  }
  const client = run.client(apiKey);
  const operation = await client.getOperation(dispatched.operationId);
  if (operation.status !== 'succeeded') throw new Error(`Batch inference is not complete: ${operation.status}`);
  if (operation.outputDataset.version === null) throw new Error('Completed batch has no output dataset version');
  if (operation.completedAt === null) throw new Error('Completed batch has no stable provider completion time');
  if (operation.sourceDataset.id !== dispatched.datasetId ||
      operation.sourceDataset.version !== dispatched.datasetVersion ||
      operation.outputDataset.id !== dispatched.outputDatasetId ||
      (dispatched.outputDatasetVersion !== null && operation.outputDataset.version !== dispatched.outputDatasetVersion) ||
      operation.model !== dispatched.model || operation.completionWindow !== dispatched.completionWindow) {
    throw new Error('Batch inference dataset identity drifted');
  }
  const rows = await client.getDatasetContent(dispatched.outputDatasetId, operation.outputDataset.version);
  const outputHash = contentHash(rows);
  const scored = scoreOutputs(rows, request, run.core);
  run.core.assertDataLabCostCap(scored.calculatedCostUsd, dispatched.costCapUsd);
  const completedAt = new Date(operation.completedAt * 1000).toISOString();
  const createdMs = operation.createdAt * 1000;
  const finishedMs = operation.completedAt * 1000;
  const base = omit(dispatched, ['recordHash', 'stage', 'operationStatus']);
  const completedBase = {
    ...base,
    stage: 'complete', operationStatus: 'succeeded',
    outputDatasetVersion: operation.outputDataset.version,
    calculatedCostUsd: scored.calculatedCostUsd, completedAt,
    latencyMs: number(finishedMs - createdMs, 'operation latency'), outputHash,
  };
  const completed = run.core.validateDataLabExperimentRecord(evidenceWithHash(completedBase, run.core));
  const reportBase = {
    schemaVersion: run.core.DATALAB_BATCH_REPORT_SCHEMA_VERSION,
    experimentRecordHash: completed.recordHash,
    requestHash: completed.requestHash,
    sourceResultHash: completed.sourceResultHash,
    inputHash: completed.inputHash,
    outputHash,
    rowCount: completed.rowCount,
    datasetId: completed.datasetId,
    datasetVersion: completed.datasetVersion,
    operationId: completed.operationId,
    operationStatus: 'succeeded',
    outputDatasetId: completed.outputDatasetId,
    outputDatasetVersion: completed.outputDatasetVersion,
    model: completed.model,
    promptVersions: completed.promptVersions,
    completionWindow: completed.completionWindow,
    maxOutputTokens: completed.maxOutputTokens,
    estimatedCostUsd: completed.estimatedCostUsd,
    costCapUsd: completed.costCapUsd,
    calculatedCostUsd: completed.calculatedCostUsd,
    latencyMs: completed.latencyMs,
    qualityByPromptVariant: scored.qualityByPromptVariant,
    comparison: scored.comparison,
  };
  const report = run.core.validateDataLabBatchReport({
    ...reportBase, reportHash: run.core.dataLabEvidenceHash(reportBase),
  });
  try {
    await writeExclusive(options.get('--report'), `${canonicalJson(report)}\n`);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = run.core.validateDataLabBatchReport(
      await readJson(options.get('--report'), 128 * 1024, 'Data Lab report'),
    );
    if (canonicalJson(existing) !== canonicalJson(report)) throw new Error('Existing Data Lab report differs from provider result');
  }
  await atomicReplace(recordPath, `${canonicalJson(completed)}\n`);
  return report;
}

export async function main(args = process.argv.slice(2), overrides = {}) {
  const operation = args[0];
  const options = values(args);
  const run = await dependencies(overrides);
  if (operation === 'prepare') return prepare(options, run);
  if (operation === 'upload') return upload(options, run);
  if (operation === 'recover-upload') return recoverUpload(options, run);
  if (operation === 'run-batch') return runBatch(options, run);
  if (operation === 'recover-batch') return recoverBatch(options, run);
  if (operation === 'finalize') return finalize(options, run);
  throw new Error('Usage: datalab-experiment.mjs prepare|upload|recover-upload|run-batch|recover-batch|finalize [exact options]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await main();
  const printable = process.argv[2] === 'prepare'
    ? {
        schemaVersion: result.schemaVersion, rowCount: result.rowCount,
        jsonlByteLength: result.jsonlByteLength, uploadBodyBytes: result.uploadBodyBytes,
        inputHash: result.inputHash, requestHash: result.requestHash,
      }
    : result;
  process.stdout.write(`${canonicalJson(printable)}\n`);
}
