#!/usr/bin/env node
/** Version-two blinded quality experiments. Legacy datalab-experiment.mjs is unchanged. */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalJson, contentHash, assertPublicEvidenceText } from './evidence-contract.mjs';
import { validateRunManifest } from './verified-program-evidence.mjs';

const SCHEMA = 'sutura-datalab-quality-experiment-v2';
const MAX_BYTES = 4 * 1024 * 1024;
const COMPLETION_WINDOW = '12h';
const hashRecord = (value, key) => ({ ...value, [key]: contentHash(value) });
function checkedHash(value, key, label) {
  const { [key]: hash, ...body } = value ?? {};
  if (!/^[a-f0-9]{64}$/u.test(hash ?? '') || contentHash(body) !== hash) throw new Error(`${label} hash mismatch`);
  return value;
}
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
function identity(manifest) { return { identity: manifest.identity, models: manifest.models }; }

export function prepareQualityExperiment(input, core) {
  const manifest = validateRunManifest(input.manifest);
  if (!['development', 'validation', 'held-out'].includes(input.split)) throw new Error('An explicit evaluation split is required');
  if (manifest.mode !== 'live' || manifest.models.length !== 1 || manifest.caps.repetitions !== 1 ||
      manifest.caps.maxOutputTokens !== core.QUALITY_MAX_OUTPUT_TOKENS || manifest.caps.elapsedTimeSec < 43200) {
    throw new Error('Quality manifest requires one live model, one repetition, 512 output tokens and a 12h completion cap');
  }
  if (!Number.isFinite(Date.parse(manifest.models[0].priceAsOf))) throw new Error('Model price date is invalid');
  // Never inspect an unrelated split merely because it shares an input file.
  if (!Array.isArray(input.entries) || input.entries.some((entry) => entry.split !== input.split)) {
    throw new Error('Input must contain only the explicitly selected split');
  }
  const dataset = core.validateEvaluationDataset(input.entries);
  if (!same([...manifest.subjects].sort(), dataset.entries.map(({ customId }) => customId).sort())) throw new Error('Manifest subjects differ from selected dataset');
  for (const entry of dataset.entries) {
    const source = input.sources?.[entry.customId];
    if (typeof source !== 'string') throw new Error(`Missing executed source for ${entry.customId}`);
    core.assertRecordMatchesSourceHash(entry, source);
    if (!same(core.blindExecutedRecord(JSON.parse(source)), entry.record)) throw new Error(`Blinded record differs from executed source for ${entry.customId}`);
    if (!['preserves-contract', 'breaks-contract', 'unknown'].includes(entry.scoringKey.truth)) throw new Error('Scoring truth must be independent known truth or unknown');
  }
  let variants = [...core.QUALITY_PROMPT_VARIANTS];
  if (input.split === 'held-out') {
    const selection = checkedHash(input.selection, 'selectionHash', 'Frozen selection');
    if (selection.schemaVersion !== SCHEMA || !core.QUALITY_PROMPT_VARIANTS.includes(selection.variant) ||
        !same(selection.experimentIdentity, identity(manifest))) throw new Error('Frozen selection identity differs from held-out manifest');
    if (dataset.entries.some(({ rootFamily, customId }) => selection.validationFamilies.includes(rootFamily) || selection.validationSubjects.includes(customId))) {
      throw new Error('Held-out subjects overlap the validation selection');
    }
    variants = [selection.variant];
  } else if (input.selection !== undefined) throw new Error('Selection is only used for held-out preparation');
  const requests = input.split === 'held-out'
    ? dataset.entries.map((entry) => ({ customId: `${entry.customId}.${variants[0]}`, ...core.buildQualityPrompt(variants[0], entry.record) }))
    : core.preparePairedBatch({ dataset, model: manifest.models[0].modelId, split: input.split }).requests;
  if (manifest.caps.modelTurnsPerSubject < variants.length || requests.length > 200) throw new Error('Batch exceeds model-turn or 200-row cap');
  const rows = requests.map(({ customId, messages }) => ({
    customId,
    // Data Lab's supported mapping has no response_format field. Put the same
    // closed output contract in each rubric; parse it strictly on return.
    messages: messages.map((message) => message.role === 'system'
      ? { ...message, content: `${message.content}\nReturn only JSON matching this schema: ${JSON.stringify(core.qualityResponseSchema())}` }
      : message),
  }));
  const prices = manifest.models[0];
  const maximumCostUsd = rows.reduce((sum, row) => sum + (
    Buffer.byteLength(JSON.stringify(row.messages)) * prices.inputPerMillionUsd +
    manifest.caps.maxOutputTokens * prices.outputPerMillionUsd
  ) / 1_000_000, 0);
  if (!Number.isFinite(maximumCostUsd) || maximumCostUsd > manifest.caps.inferenceUsd) throw new Error('Worst-case batch cost exceeds manifest cap');
  const sidecar = { schemaVersion: SCHEMA, entries: dataset.entries, sources: input.sources };
  const upload = {
    name: `sutura-quality-${contentHash({ manifest, rows }).slice(0, 20)}`,
    folder: '/sutura/quality-v2',
    schema: [{ name: 'customId', type: { name: 'string' } }, { name: 'messages', type: { name: 'json' } }],
    rows,
  };
  assertPublicEvidenceText(JSON.stringify(upload), 'Blinded upload');
  if (Buffer.byteLength(JSON.stringify(upload)) > MAX_BYTES) throw new Error('Blinded upload exceeds bounded size');
  const request = hashRecord({ schemaVersion: SCHEMA, manifest, split: input.split, variants, maximumCostUsd,
    sidecarHash: contentHash(sidecar), upload, ...(input.selection === undefined ? {} : { selection: input.selection }) }, 'requestHash');
  return { request, sidecar };
}

function validatePrepared(request, sidecar, core) {
  checkedHash(request, 'requestHash', 'Prepared request');
  if (contentHash(sidecar) !== request.sidecarHash) throw new Error('Private scoring sidecar hash mismatch');
  const rebuilt = prepareQualityExperiment({ ...sidecar, manifest: request.manifest, split: request.split, selection: request.selection }, core);
  if (!same(rebuilt.request, request)) throw new Error('Prepared request differs from its private source');
}

export function scoreQualityOutputs(rows, request, sidecar, core) {
  validatePrepared(request, sidecar, core);
  if (!Array.isArray(rows) || rows.length > request.upload.rows.length) throw new Error('Output rows exceed request bounds or contain duplicate IDs');
  const expected = new Set(request.upload.rows.map(({ customId }) => customId));
  const byId = new Map();
  const errors = [];
  const prices = request.manifest.models[0];
  for (const row of rows) {
    const id = row.customId ?? row.custom_id;
    if (!expected.has(id)) throw new Error('Output has unknown custom ID');
    if (byId.has(id)) throw new Error('Output has duplicate custom ID');
    const body = row.response?.body ?? row.body ?? row;
    const usage = body.usage ?? row.usage;
    let tokenUsage;
    if (usage !== undefined) {
      const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens;
      const outputTokens = usage?.completion_tokens ?? usage?.output_tokens;
      if (![inputTokens, outputTokens].every((value) => Number.isSafeInteger(value) && value >= 0)) {
        errors.push({ customId: id, reason: 'invalid-usage' });
      } else tokenUsage = { inputTokens, outputTokens };
    }
    const costUsd = tokenUsage === undefined || body.model !== prices.modelId ? null : (
      tokenUsage.inputTokens * prices.inputPerMillionUsd + tokenUsage.outputTokens * prices.outputPerMillionUsd
    ) / 1_000_000;
    let reason = row.error || body.error ? 'provider-error' : undefined;
    if (body.model !== prices.modelId) reason = body.model === undefined ? 'missing-model-identity' : 'model-mismatch';
    if (tokenUsage?.outputTokens > request.manifest.caps.maxOutputTokens) reason = 'output-cap-exceeded';
    const text = body.choices?.[0]?.message?.content ?? row.output ?? row.completion;
    let prediction;
    if (reason === undefined) {
      try { prediction = core.parseQualityPrediction(text); }
      catch { reason = 'invalid-prediction'; }
    }
    if (reason !== undefined) errors.push({ customId: id, reason });
    byId.set(id, { costUsd, ...(tokenUsage === undefined ? {} : { tokenUsage }), ...(prediction === undefined ? {} : { prediction, text }) });
  }
  const dataset = core.validateEvaluationDataset(sidecar.entries);
  const scores = {};
  for (const variant of request.variants) {
    const joined = core.joinBatchOutputs({ dataset, variant, outputs: [...byId].filter(([, value]) => value.text !== undefined).map(([customId, value]) => ({ customId, text: value.text })) });
    scores[variant] = core.scoreQualityPredictions(joined.map(({ customId, truth }) => ({
      recordId: customId, truth, ...(byId.get(`${customId}.${variant}`) ?? {}),
    })));
  }
  const knownCostUsd = Object.values(scores).reduce((sum, score) => sum + score.resources.knownCostUsd, 0);
  const unknownCost = Object.values(scores).reduce((sum, score) => sum + score.resources.unknownCost, 0);
  const overCap = knownCostUsd > request.manifest.caps.inferenceUsd;
  return hashRecord({ schemaVersion: SCHEMA, requestHash: request.requestHash, manifestHash: request.manifest.manifestHash,
    outputHash: contentHash(rows), scores, errors, missingOutputs: expected.size - byId.size,
    validationFamilies: [...new Set(sidecar.entries.map(({ rootFamily }) => rootFamily))],
    knownCostUsd, unknownCost, totalCostUsd: unknownCost === 0 ? knownCostUsd : null, overCap,
  }, 'reportHash');
}

export function freezeQualitySelection(report, request) {
  if (request.split !== 'validation') throw new Error('Prompt selection requires validation data');
  checkedHash(request, 'requestHash', 'Prepared request');
  checkedHash(report, 'reportHash', 'Validation report');
  if (report.requestHash !== request.requestHash || report.terminalStatus !== 'succeeded' || report.missingOutputs !== 0 ||
      report.errors.length !== 0 || report.unknownCost !== 0 || report.overCap || request.variants.length !== 2 ||
      Object.values(report.scores).some((score) => score.balancedAccuracy === null || score.unknownTruth !== 0)) {
    throw new Error('Selection requires complete, priced, successful validation evidence');
  }
  // Predeclared ordering: balanced accuracy, false approvals, lexical tie-break.
  const [variant] = [...request.variants].sort((left, right) =>
    report.scores[right].balancedAccuracy - report.scores[left].balancedAccuracy ||
    (report.scores[left].falseApprovalRate ?? 0) - (report.scores[right].falseApprovalRate ?? 0) || left.localeCompare(right));
  return hashRecord({ schemaVersion: SCHEMA, variant, validationReportHash: report.reportHash,
    experimentIdentity: identity(request.manifest), validationSubjects: request.manifest.subjects,
    // Family names stay outside every upload; retained only for split admission.
    validationFamilies: report.validationFamilies,
  }, 'selectionHash');
}

async function readJson(path) {
  const bytes = await readFile(path);
  if (bytes.length > MAX_BYTES * 4) throw new Error('Experiment file exceeds bounded size');
  return JSON.parse(bytes.toString('utf8'));
}
async function writeJson(path, value, replace = false) {
  // Preserve manifest key order: its existing validator hashes JSON.stringify.
  const text = `${JSON.stringify(value)}\n`;
  if (!replace) return writeFile(path, text, { flag: 'wx', mode: 0o600 });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}
function authorize(input, expected, request) {
  if (input.authorization !== expected || input.requestHash !== request.requestHash) throw new Error('Exact request authorization is missing');
}
function operationMatches(operation, state, request) {
  if (operation.sourceDataset.id !== state.datasetId || operation.sourceDataset.version !== state.datasetVersion ||
      operation.model !== request.manifest.models[0].modelId || operation.completionWindow !== COMPLETION_WINDOW) throw new Error('Recovered operation identity differs from prepared request');
}

/** One bounded step per invocation. Recovery only reads provider state. */
export async function executeQualityStep(input) {
  const { step, directory, core, client } = input;
  const now = input.now ?? (() => new Date().toISOString());
  const path = (name) => join(directory, `${name}.json`);
  if (step === 'prepare') {
    validatePrepared(input.prepared.request, input.prepared.sidecar, core);
    await mkdir(directory, { recursive: true });
    await writeJson(path('request'), input.prepared.request);
    await writeJson(path('private-scoring'), input.prepared.sidecar);
    await writeJson(path('state'), hashRecord({ stage: 'prepared', requestHash: input.prepared.request.requestHash }, 'stateHash'));
    return input.prepared.request;
  }
  const request = await readJson(path('request'));
  const sidecar = await readJson(path('private-scoring'));
  validatePrepared(request, sidecar, core);
  const state = checkedHash(await readJson(path('state')), 'stateHash', 'Experiment state');
  if (state.requestHash !== request.requestHash) throw new Error('State belongs to another request');
  const save = async (next) => writeJson(path('state'), hashRecord({ ...next, requestHash: request.requestHash }, 'stateHash'), true);
  if (step === 'upload' || step === 'recover-upload') {
    if (state.stage !== 'prepared') throw new Error('Upload requires prepared state');
    if (step === 'upload') {
      authorize(input, 'DATA-LAB-UPLOAD-APPROVED', request);
      try { await writeJson(path('upload-intent'), { requestHash: request.requestHash, preparedAt: now() }); }
      catch (error) { if (error.code === 'EEXIST') throw new Error('Upload intent exists; recover instead of uploading again'); throw error; }
    } else if ((await readJson(path('upload-intent'))).requestHash !== request.requestHash) throw new Error('Upload recovery intent differs');
    const dataset = step === 'upload' ? await client.createDataset(request.upload) : await client.getDataset(input.datasetId);
    if (dataset.name !== request.upload.name || dataset.status !== 'READY' || !dataset.version) throw new Error(`Dataset ${dataset.id} not ready; recover its upload`);
    if (!same(await client.getDatasetContent(dataset.id, dataset.version), request.upload.rows)) throw new Error('Uploaded source content differs from reviewed request');
    const next = { stage: 'uploaded', datasetId: dataset.id, datasetVersion: dataset.version };
    await save(next); await unlink(path('upload-intent')); return next;
  }
  if (step === 'run-batch' || step === 'recover-batch') {
    if (!input.dispatchRegistryDirectory) throw new Error('A durable dispatch registry is required');
    const registryPath = join(input.dispatchRegistryDirectory, `${request.manifest.manifestHash}.json`);
    if (state.stage !== 'uploaded') throw new Error('Batch requires uploaded state');
    let intent;
    if (step === 'run-batch') {
      authorize(input, 'BATCH-INFERENCE-SPEND-APPROVED', request);
      intent = { requestHash: request.requestHash, directory: resolve(directory), preparedAt: now() };
      await mkdir(input.dispatchRegistryDirectory, { recursive: true, mode: 0o700 });
      try { await writeJson(registryPath, intent); }
      catch (error) { if (error.code === 'EEXIST') throw new Error('Manifest dispatch intent already reserved; recover original experiment'); throw error; }
      try { await writeJson(path('batch-intent'), intent); }
      catch (error) { if (error.code === 'EEXIST') throw new Error('Batch intent exists; recover instead of dispatching again'); throw error; }
      if (!same(await client.getDatasetContent(state.datasetId, state.datasetVersion), request.upload.rows)) throw new Error('Source dataset content changed');
    } else {
      intent = await readJson(path('batch-intent'));
      if (intent.requestHash !== request.requestHash || !same(intent, await readJson(registryPath))) throw new Error('Batch recovery intent differs from durable manifest reservation');
    }
    const operation = step === 'run-batch' ? await client.createBatchOperation({
      type: 'batch_inference', src: [{ id: state.datasetId, version: state.datasetVersion,
        mapping: { type: 'text_messages', messages: { type: 'column', name: 'messages' }, custom_id: { type: 'column', name: 'customId' }, max_tokens: { type: 'number', value: request.manifest.caps.maxOutputTokens } } }],
      dst: [], params: { model: request.manifest.models[0].modelId, completion_window: COMPLETION_WINDOW },
    }) : await client.getOperation(input.operationId);
    operationMatches(operation, state, request);
    if (operation.createdAt * 1000 < Date.parse(intent.preparedAt) - 5000 || operation.createdAt * 1000 > Date.parse(now()) + 5000) throw new Error('Recovered operation predates dispatch intent');
    const next = { ...state, stage: 'dispatched', operationId: operation.id, outputDatasetId: operation.outputDataset.id };
    delete next.stateHash;
    await save(next); await unlink(path('batch-intent')); return next;
  }
  if (step === 'finalize') {
    if (state.stage === 'complete') {
      const report = checkedHash(await readJson(path('report')), 'reportHash', 'Completed report');
      if (report.reportHash !== state.reportHash || report.requestHash !== request.requestHash) throw new Error('Completed report differs from recorded identity');
      return report;
    }
    if (state.stage !== 'dispatched') throw new Error('Finalize requires dispatched state');
    const operation = await client.getOperation(state.operationId);
    operationMatches(operation, state, request);
    if (!['succeeded', 'failed', 'cancelled'].includes(operation.status)) throw new Error(`Batch is not terminal: ${operation.status}`);
    if (operation.outputDataset.id !== state.outputDatasetId) throw new Error('Output dataset identity changed');
    const rows = operation.outputDataset.version === null ? [] : await client.getDatasetContent(operation.outputDataset.id, operation.outputDataset.version);
    const report = scoreQualityOutputs(rows, request, sidecar, core);
    delete report.reportHash;
    let elapsedTimeMs = null;
    if (!Number.isFinite(operation.completedAt) || !Number.isFinite(operation.createdAt)) {
      report.errors.push({ reason: 'missing-completion-time' });
    } else if (operation.completedAt < operation.createdAt) {
      report.errors.push({ reason: 'invalid-completion-time' });
    } else {
      elapsedTimeMs = (operation.completedAt - operation.createdAt) * 1000;
      if (elapsedTimeMs > request.manifest.caps.elapsedTimeSec * 1000) report.errors.push({ reason: 'elapsed-cap-exceeded' });
    }
    const finalReport = hashRecord({ ...report, terminalStatus: operation.status, operationId: operation.id,
      completedAt: operation.completedAt, elapsedTimeMs, validationFamilies: [...new Set(sidecar.entries.map(({ rootFamily }) => rootFamily))],
    }, 'reportHash');
    await writeJson(path('private-outputs'), rows, true);
    await writeJson(path('report'), finalReport, true);
    const next = { ...state, stage: 'complete', reportHash: finalReport.reportHash }; delete next.stateHash; await save(next);
    return finalReport;
  }
  if (step === 'freeze-selection') {
    const report = await readJson(path('report'));
    if (state.stage !== 'complete' || state.reportHash !== report.reportHash) throw new Error('Selection requires the recorded complete report');
    const selection = freezeQualitySelection(report, request);
    await writeJson(path('selection'), selection); return selection;
  }
  throw new Error('Unknown quality experiment step');
}

export async function main(args = process.argv.slice(2), overrides = {}) {
  const [step, ...rest] = args;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!key?.startsWith('--') || !rest[i + 1] || Object.hasOwn(options, key)) throw new Error('Expected unique --option value arguments');
    options[key] = rest[i + 1];
  }
  const required = {
    prepare: ['--directory', '--input'],
    upload: ['--directory', '--authorization', '--request-hash'],
    'run-batch': ['--directory', '--authorization', '--request-hash'],
    'recover-upload': ['--directory', '--dataset-id'],
    'recover-batch': ['--directory', '--operation-id'],
    finalize: ['--directory'],
    'freeze-selection': ['--directory'],
  }[step];
  if (required === undefined || !same(Object.keys(options).sort(), [...required].sort())) {
    throw new Error(`Expected ${step} options: ${required?.join(' ') ?? 'known operation'}`);
  }
  if (!overrides.client && !['prepare', 'freeze-selection'].includes(step) && !process.env.NEBIUS_API_KEY?.trim()) {
    throw new Error('NEBIUS_API_KEY is required for provider steps');
  }
  const core = overrides.core ?? await import('../packages/evaluation/dist/index.js');
  const client = overrides.client ?? new core.DataLabClient({ apiKey: process.env.NEBIUS_API_KEY ?? 'unused-for-local-step', fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30000) }) });
  let prepared;
  if (step === 'prepare') prepared = prepareQualityExperiment(await readJson(options['--input']), core);
  const { stdout } = await promisify(execFile)('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return executeQualityStep({ step, directory: resolve(options['--directory']), core, client, prepared,
    dispatchRegistryDirectory: join(stdout.trim(), 'sutura-datalab-quality-dispatch'),
    authorization: options['--authorization'], requestHash: options['--request-hash'], datasetId: options['--dataset-id'], operationId: options['--operation-id'], ...overrides });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await main();
  process.stdout.write(`${canonicalJson({ schemaVersion: SCHEMA, requestHash: result.requestHash, reportHash: result.reportHash, selectionHash: result.selectionHash, stage: result.stage })}\n`);
}
