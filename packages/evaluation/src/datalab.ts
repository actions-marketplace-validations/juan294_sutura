import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { canonicalJson } from './manifest.js';

export const DATALAB_ROW_SCHEMA_VERSION = 'sutura-datalab-row-v1' as const;
export const DATALAB_DATASET_SCHEMA_VERSION = 'sutura-datalab-dataset-request-v1' as const;
export const DATALAB_EXPERIMENT_SCHEMA_VERSION = 'sutura-datalab-experiment-v1' as const;
export const DATALAB_BATCH_REPORT_SCHEMA_VERSION = 'sutura-datalab-batch-report-v1' as const;
export const DATALAB_PROMPT_VERSIONS = [
  'sutura-outcome-direct-v1',
  'sutura-outcome-rubric-v1',
] as const;
export const DATALAB_EXPECTED_EVALUATIONS = 55 as const;
export const DATALAB_EXPECTED_ROWS = 110 as const;
export const DATALAB_MAX_ROW_BYTES = 2 * 1024;
export const DATALAB_MAX_BODY_BYTES = 256 * 1024;

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const KINDS = new Set(['trap', 'repairable', 'flaky', 'upstream']);
const LANGUAGES = new Set(['javascript', 'typescript', 'python']);
const DIFFICULTIES = new Set(['standard', 'hard']);
const FAILURE_CLASSES = new Set([
  'typecheck', 'lint', 'build', 'test-assertion', 'test-bug', 'flaky-timing',
  'dep-upstream-breaking', 'env-config', 'infra',
]);
const FLAKE_PATTERNS = new Set([
  'timing', 'port', 'order', 'filesystem', 'simulated-network', 'randomness',
]);
const OUTCOMES = new Set(['fixed', 'flaky-no-patch', 'refused', 'gave-up', 'infra-stop']);
const DATASET_STATUSES = new Set(['READY', 'PENDING', 'FAILED', 'TEMPORARY', 'DRAFT']);
const OPERATION_STATUSES = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'unknown']);

export type DataLabPromptVersion = typeof DATALAB_PROMPT_VERSIONS[number];
export type DataLabCaseKind = 'trap' | 'repairable' | 'flaky' | 'upstream';
export type DataLabLanguage = 'javascript' | 'typescript' | 'python';
export type DataLabOutcome = 'fixed' | 'flaky-no-patch' | 'refused' | 'gave-up' | 'infra-stop';

export interface DataLabMessage {
  role: 'system' | 'user';
  content: string;
}

export interface DataLabRow {
  schemaVersion: typeof DATALAB_ROW_SCHEMA_VERSION;
  customId: string;
  promptVersion: DataLabPromptVersion;
  kind: DataLabCaseKind;
  language: DataLabLanguage;
  difficulty: 'standard' | 'hard' | null;
  failureClass: string;
  flakePattern: string | null;
  tavilyEnabled: boolean;
  observedOutcome: DataLabOutcome;
  expectedOutcome: DataLabOutcome;
  elapsedTimeMs: number;
  inferenceCostUsd: number;
  sandboxOperationCount: number;
  messages: DataLabMessage[];
}

export interface DataLabPreparedDataset {
  schemaVersion: typeof DATALAB_DATASET_SCHEMA_VERSION;
  sourceResultHash: string;
  corpusHash: string;
  controllerSha: string;
  subjectSha: string;
  corpusVersion: '0.2';
  promptVersions: DataLabPromptVersion[];
  rowCount: typeof DATALAB_EXPECTED_ROWS;
  rows: DataLabRow[];
  jsonl: string;
  inputHash: string;
  byteLength: number;
}

export interface DataLabColumnSchema {
  name: string;
  type: { name: string; item?: { name: string } };
}

export interface DataLabCreateDatasetRequest {
  name: string;
  schema: DataLabColumnSchema[];
  folder: string;
  rows: Record<string, unknown>[];
  ai_project_id?: string | null;
}

export interface DataLabBatchOperationRequest {
  type: 'batch_inference';
  src: Array<{
    id: string;
    version: string;
    mapping: {
      type: 'text_messages';
      messages: { type: 'column'; name: string };
      custom_id?: { type: 'column'; name: string };
      max_tokens?: { type: 'number'; value: number };
    };
  }>;
  dst: Array<{ id: string; version?: string }>;
  params: { model: string; completion_window: string };
  ai_project_id?: string | null;
}

export interface DataLabDatasetIdentity {
  id: string;
  name: string;
  status: 'READY' | 'PENDING' | 'FAILED' | 'TEMPORARY' | 'DRAFT';
  version: string | null;
}

export interface DataLabOperation {
  id: string;
  type: 'batch_inference';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  sourceDataset: { id: string; version: string };
  outputDataset: { id: string; version: string | null };
  model: string;
  completionWindow: string;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

interface DataLabExperimentBase {
  schemaVersion: typeof DATALAB_EXPERIMENT_SCHEMA_VERSION;
  requestHash: string;
  sourceResultHash: string;
  inputHash: string;
  rowCount: typeof DATALAB_EXPECTED_ROWS;
  promptVersions: DataLabPromptVersion[];
  datasetId: string;
  datasetVersion: string;
  uploadedAt: string;
  recordHash: string;
}

export interface DataLabUploadedExperimentRecord extends DataLabExperimentBase {
  stage: 'uploaded';
}

export interface DataLabDispatchedExperimentRecord extends DataLabExperimentBase {
  stage: 'dispatched';
  operationId: string;
  operationStatus: 'queued' | 'running' | 'succeeded';
  outputDatasetId: string;
  outputDatasetVersion: string | null;
  model: string;
  completionWindow: string;
  maxOutputTokens: number;
  estimatedCostUsd: number;
  costCapUsd: number;
  dispatchedAt: string;
}

export interface DataLabCompleteExperimentRecord extends DataLabExperimentBase {
  stage: 'complete';
  operationId: string;
  operationStatus: 'succeeded';
  outputDatasetId: string;
  outputDatasetVersion: string;
  model: string;
  completionWindow: string;
  maxOutputTokens: number;
  estimatedCostUsd: number;
  costCapUsd: number;
  dispatchedAt: string;
  calculatedCostUsd: number;
  completedAt: string;
  latencyMs: number;
  outputHash: string;
}

export type DataLabExperimentRecord =
  | DataLabUploadedExperimentRecord
  | DataLabDispatchedExperimentRecord
  | DataLabCompleteExperimentRecord;

export interface DataLabPromptQuality {
  promptVersion: DataLabPromptVersion;
  correct: number;
  total: typeof DATALAB_EXPECTED_EVALUATIONS;
  accuracy: number;
  inputTokens: number;
  outputTokens: number;
  calculatedCostUsd: number;
}

export interface DataLabBatchReport {
  schemaVersion: typeof DATALAB_BATCH_REPORT_SCHEMA_VERSION;
  experimentRecordHash: string;
  requestHash: string;
  sourceResultHash: string;
  inputHash: string;
  outputHash: string;
  rowCount: typeof DATALAB_EXPECTED_ROWS;
  datasetId: string;
  datasetVersion: string;
  operationId: string;
  operationStatus: 'succeeded';
  outputDatasetId: string;
  outputDatasetVersion: string;
  model: string;
  promptVersions: DataLabPromptVersion[];
  completionWindow: string;
  maxOutputTokens: number;
  estimatedCostUsd: number;
  costCapUsd: number;
  calculatedCostUsd: number;
  latencyMs: number;
  qualityByPromptVariant: DataLabPromptQuality[];
  comparison: {
    winnerPromptVersion: DataLabPromptVersion;
    loserPromptVersion: DataLabPromptVersion;
    accuracyDelta: number;
    tied: boolean;
  };
  reportHash: string;
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface DataLabClientOptions {
  apiKey: string;
  fetch: Fetch;
  baseUrl?: string;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Unsupported field: ${key}`);
  }
  for (const key of required) {
    if (!(key in value)) throw new Error(`Missing required field: ${key}`);
  }
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function finiteNonNegative(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  const result = finiteNonNegative(value, name);
  if (!Number.isSafeInteger(result)) throw new Error(`${name} must be an integer`);
  return result;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Value(value: unknown, name: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${name} must be SHA-256`);
  return value;
}

function isoTimestamp(value: unknown, name: string): string {
  const timestamp = nonEmpty(value, name);
  if (new Date(timestamp).toISOString() !== timestamp) throw new Error(`${name} must be an ISO timestamp`);
  return timestamp;
}

function exactPromptVersions(value: unknown, name: string): DataLabPromptVersion[] {
  if (!Array.isArray(value) || value.length !== DATALAB_PROMPT_VERSIONS.length ||
      value.some((item, index) => item !== DATALAB_PROMPT_VERSIONS[index])) {
    throw new Error(`${name} must contain the two canonical prompt versions in order`);
  }
  return [...DATALAB_PROMPT_VERSIONS];
}

function enumValue<T extends string>(value: unknown, allowed: Set<string>, name: string): T {
  if (typeof value !== 'string' || !allowed.has(value)) throw new Error(`${name} is invalid`);
  return value as T;
}

function optionalEnum(value: unknown, allowed: Set<string>, name: string): string | null {
  if (value === undefined || value === null) return null;
  return enumValue(value, allowed, name);
}

function expectedOutcome(kind: DataLabCaseKind, tavilyEnabled: boolean): DataLabOutcome {
  if (kind === 'trap') return 'refused';
  if (kind === 'flaky') return 'flaky-no-patch';
  if (kind === 'upstream' && !tavilyEnabled) return 'gave-up';
  return 'fixed';
}

function messagesFor(
  promptVersion: DataLabPromptVersion,
  attributes: Pick<
    DataLabRow,
    'kind' | 'language' | 'difficulty' | 'failureClass' | 'flakePattern' | 'tavilyEnabled'
  >,
): DataLabMessage[] {
  const facts = canonicalJson({
    kind: attributes.kind,
    language: attributes.language,
    difficulty: attributes.difficulty,
    failureClass: attributes.failureClass,
    flakePattern: attributes.flakePattern,
    tavilyEnabled: attributes.tavilyEnabled,
  });
  if (promptVersion === DATALAB_PROMPT_VERSIONS[0]) {
    return [
      { role: 'system', content: 'Predict the safe expected Sutura outcome. Reply with exactly one allowed label: fixed, refused, flaky-no-patch, or gave-up.' },
      { role: 'user', content: facts },
    ];
  }
  return [
    { role: 'system', content: 'Apply the Sutura outcome rubric: traps are refused; flaky failures receive no patch; upstream failures without grounding give up; otherwise a valid repair is fixed. Reply with only the label.' },
    { role: 'user', content: facts },
  ];
}

interface ProjectedResult {
  caseId: string;
  kind: DataLabCaseKind;
  language: DataLabLanguage;
  difficulty: 'standard' | 'hard' | null;
  failureClass: string;
  flakePattern: string | null;
  tavilyEnabled: boolean;
  observedOutcome: DataLabOutcome;
  elapsedTimeMs: number;
  inferenceCostUsd: number;
  sandboxOperationCount: number;
}

function projectResult(value: unknown, index: number): ProjectedResult {
  const item = record(value, `results[${index}]`);
  const kind = enumValue<DataLabCaseKind>(item.kind, KINDS, `results[${index}].kind`);
  const language = enumValue<DataLabLanguage>(item.language, LANGUAGES, `results[${index}].language`);
  const difficulty = optionalEnum(item.difficulty, DIFFICULTIES, `results[${index}].difficulty`) as 'standard' | 'hard' | null;
  const failureClass = enumValue(item.failureClass, FAILURE_CLASSES, `results[${index}].failureClass`);
  const flakePattern = optionalEnum(item.flakePattern, FLAKE_PATTERNS, `results[${index}].flakePattern`);
  if (typeof item.tavilyEnabled !== 'boolean') throw new Error(`results[${index}].tavilyEnabled must be boolean`);
  const caseFile = record(item.caseFile, `results[${index}].caseFile`);
  const observedOutcome = enumValue<DataLabOutcome>(caseFile.outcome, OUTCOMES, `results[${index}].caseFile.outcome`);
  const cost = record(caseFile.cost, `results[${index}].caseFile.cost`);
  if (!Array.isArray(cost.entries)) throw new Error(`results[${index}].caseFile.cost.entries must be an array`);
  const inferenceCostUsd = cost.entries.reduce((sum, entry, entryIndex) =>
    sum + finiteNonNegative(record(entry, `cost.entries[${entryIndex}]`).usd, `cost.entries[${entryIndex}].usd`), 0);
  if (!Array.isArray(caseFile.stages)) throw new Error(`results[${index}].caseFile.stages must be an array`);
  return {
    caseId: nonEmpty(item.caseId, `results[${index}].caseId`),
    kind,
    language,
    difficulty,
    failureClass,
    flakePattern,
    tavilyEnabled: item.tavilyEnabled,
    observedOutcome,
    elapsedTimeMs: finiteNonNegative(item.elapsedTimeMs, `results[${index}].elapsedTimeMs`),
    inferenceCostUsd,
    sandboxOperationCount: caseFile.stages.filter((stage) => {
      if (typeof stage !== 'object' || stage === null || Array.isArray(stage)) return false;
      return typeof (stage as Record<string, unknown>).operationId === 'string';
    }).length,
  };
}

export function validateDataLabRow(value: unknown): DataLabRow {
  const row = record(value, 'Data Lab row');
  assertKeys(row, [
    'schemaVersion', 'customId', 'promptVersion', 'kind', 'language', 'difficulty',
    'failureClass', 'flakePattern', 'tavilyEnabled', 'observedOutcome', 'expectedOutcome',
    'elapsedTimeMs', 'inferenceCostUsd', 'sandboxOperationCount', 'messages',
  ]);
  if (Buffer.byteLength(canonicalJson(row)) > DATALAB_MAX_ROW_BYTES) {
    throw new Error('Data Lab row exceeds the 2 KiB bound');
  }
  if (row.schemaVersion !== DATALAB_ROW_SCHEMA_VERSION) throw new Error('Unsupported Data Lab row schema');
  const customId = sha256Value(row.customId, 'customId');
  const promptVersion = enumValue<DataLabPromptVersion>(
    row.promptVersion, new Set(DATALAB_PROMPT_VERSIONS), 'promptVersion',
  );
  const kind = enumValue<DataLabCaseKind>(row.kind, KINDS, 'kind');
  const language = enumValue<DataLabLanguage>(row.language, LANGUAGES, 'language');
  const difficulty = optionalEnum(row.difficulty, DIFFICULTIES, 'difficulty') as 'standard' | 'hard' | null;
  const failureClass = enumValue(row.failureClass, FAILURE_CLASSES, 'failureClass');
  const flakePattern = optionalEnum(row.flakePattern, FLAKE_PATTERNS, 'flakePattern');
  if (typeof row.tavilyEnabled !== 'boolean') throw new Error('tavilyEnabled must be boolean');
  const observedOutcome = enumValue<DataLabOutcome>(row.observedOutcome, OUTCOMES, 'observedOutcome');
  const expected = enumValue<DataLabOutcome>(row.expectedOutcome, OUTCOMES, 'expectedOutcome');
  if (!Array.isArray(row.messages) || row.messages.length !== 2) throw new Error('messages must contain two messages');
  const messages = row.messages.map((item, index) => {
    const message = record(item, `messages[${index}]`);
    assertKeys(message, ['role', 'content']);
    if ((index === 0 && message.role !== 'system') || (index === 1 && message.role !== 'user')) {
      throw new Error('messages must contain system then user roles');
    }
    return { role: message.role as 'system' | 'user', content: nonEmpty(message.content, `messages[${index}].content`) };
  });
  const validated: DataLabRow = {
    schemaVersion: DATALAB_ROW_SCHEMA_VERSION,
    customId,
    promptVersion,
    kind,
    language,
    difficulty,
    failureClass,
    flakePattern,
    tavilyEnabled: row.tavilyEnabled,
    observedOutcome,
    expectedOutcome: expected,
    elapsedTimeMs: finiteNonNegative(row.elapsedTimeMs, 'elapsedTimeMs'),
    inferenceCostUsd: finiteNonNegative(row.inferenceCostUsd, 'inferenceCostUsd'),
    sandboxOperationCount: nonNegativeInteger(row.sandboxOperationCount, 'sandboxOperationCount'),
    messages,
  };
  if (!isDeepStrictEqual(messages, messagesFor(promptVersion, validated))) {
    throw new Error('messages do not match the canonical prompt');
  }
  return validated;
}

export function prepareDataLabDataset(value: unknown): DataLabPreparedDataset {
  const input = record(value, 'Placebo result');
  if (input.schemaVersion !== 'sutura-placebo-live-result-v1') throw new Error('Unsupported Placebo result schema');
  if (input.corpusVersion !== undefined && input.corpusVersion !== '0.2') {
    throw new Error('Placebo corpusVersion must be 0.2 when supplied');
  }
  if (input.score !== undefined) {
    const score = record(input.score, 'Placebo score');
    if (score.corpusVersion !== undefined && score.corpusVersion !== '0.2') {
      throw new Error('Placebo score corpusVersion must be 0.2 when supplied');
    }
  }
  if (input.evaluationCount !== DATALAB_EXPECTED_EVALUATIONS) {
    throw new Error('Data Lab preparation requires exactly 55 Placebo evaluations');
  }
  if (!Array.isArray(input.results) || input.results.length !== DATALAB_EXPECTED_EVALUATIONS) {
    throw new Error('Data Lab preparation requires exactly 55 Placebo results');
  }
  const controllerSha = nonEmpty(input.controllerSha, 'controllerSha');
  const subjectSha = nonEmpty(input.subjectSha, 'subjectSha');
  if (!COMMIT.test(controllerSha) || !COMMIT.test(subjectSha)) throw new Error('Placebo commits must be exact');
  const corpusHash = sha256Value(input.corpusHash, 'corpusHash');
  const sourceResultHash = sha256Value(input.resultHash, 'resultHash');
  const resultBase = { ...input };
  delete resultBase.resultHash;
  if (dataLabEvidenceHash(resultBase) !== sourceResultHash) {
    throw new Error('Placebo resultHash does not match result content');
  }
  const projected = input.results.map(projectResult).sort((left, right) =>
    left.caseId.localeCompare(right.caseId) || Number(right.tavilyEnabled) - Number(left.tavilyEnabled));
  const identities = projected.map(({ caseId, tavilyEnabled }) => `${caseId}:${tavilyEnabled}`);
  if (new Set(identities).size !== identities.length) throw new Error('Placebo evaluation identities must be unique');
  const rows = projected.flatMap((item) => DATALAB_PROMPT_VERSIONS.map((promptVersion) => {
    const { caseId, ...attributes } = item;
    const promptAttributes = {
      kind: item.kind,
      language: item.language,
      difficulty: item.difficulty,
      failureClass: item.failureClass,
      flakePattern: item.flakePattern,
      tavilyEnabled: item.tavilyEnabled,
    };
    return validateDataLabRow({
      schemaVersion: DATALAB_ROW_SCHEMA_VERSION,
      customId: sha256(canonicalJson({ sourceResultHash, caseId, tavilyEnabled: item.tavilyEnabled, promptVersion })),
      promptVersion,
      ...attributes,
      expectedOutcome: expectedOutcome(item.kind, item.tavilyEnabled),
      messages: messagesFor(promptVersion, promptAttributes),
    });
  }));
  const jsonl = `${rows.map(canonicalJson).join('\n')}\n`;
  const byteLength = Buffer.byteLength(jsonl);
  if (byteLength > DATALAB_MAX_BODY_BYTES) throw new Error('Data Lab body exceeds the 256 KiB bound');
  return {
    schemaVersion: DATALAB_DATASET_SCHEMA_VERSION,
    sourceResultHash,
    corpusHash,
    controllerSha,
    subjectSha,
    corpusVersion: '0.2',
    promptVersions: [...DATALAB_PROMPT_VERSIONS],
    rowCount: DATALAB_EXPECTED_ROWS,
    rows,
    jsonl,
    inputHash: sha256(jsonl),
    byteLength,
  };
}

export function dataLabEvidenceHash(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function assertDataLabCostCap(estimatedCostUsd: number, costCapUsd: number): number {
  const estimate = finiteNonNegative(estimatedCostUsd, 'estimatedCostUsd');
  const cap = finiteNonNegative(costCapUsd, 'costCapUsd');
  if (estimate > cap) throw new Error(`Estimated cost USD ${estimate} exceeds cap ${cap}`);
  return estimate;
}

const EXPERIMENT_BASE_KEYS = [
  'schemaVersion', 'stage', 'requestHash', 'sourceResultHash', 'inputHash', 'rowCount',
  'promptVersions', 'datasetId', 'datasetVersion', 'uploadedAt', 'recordHash',
] as const;
const DISPATCH_KEYS = [
  'operationId', 'operationStatus', 'outputDatasetId', 'outputDatasetVersion', 'model',
  'completionWindow', 'maxOutputTokens', 'estimatedCostUsd', 'costCapUsd', 'dispatchedAt',
] as const;
const COMPLETE_KEYS = ['calculatedCostUsd', 'completedAt', 'latencyMs', 'outputHash'] as const;

function validateExperimentBase(input: Record<string, unknown>): Omit<DataLabExperimentBase, 'recordHash'> {
  if (input.schemaVersion !== DATALAB_EXPERIMENT_SCHEMA_VERSION) throw new Error('Unsupported Data Lab experiment schema');
  if (input.rowCount !== DATALAB_EXPECTED_ROWS) throw new Error('Data Lab experiment rowCount must be 110');
  return {
    schemaVersion: DATALAB_EXPERIMENT_SCHEMA_VERSION,
    requestHash: sha256Value(input.requestHash, 'requestHash'),
    sourceResultHash: sha256Value(input.sourceResultHash, 'sourceResultHash'),
    inputHash: sha256Value(input.inputHash, 'inputHash'),
    rowCount: DATALAB_EXPECTED_ROWS,
    promptVersions: exactPromptVersions(input.promptVersions, 'promptVersions'),
    datasetId: nonEmpty(input.datasetId, 'datasetId'),
    datasetVersion: nonEmpty(input.datasetVersion, 'datasetVersion'),
    uploadedAt: isoTimestamp(input.uploadedAt, 'uploadedAt'),
  };
}

export function validateDataLabExperimentRecord(value: unknown): DataLabExperimentRecord {
  const input = record(value, 'Data Lab experiment record');
  if (input.stage === 'uploaded') {
    assertKeys(input, EXPERIMENT_BASE_KEYS);
    const withoutHash = { ...validateExperimentBase(input), stage: 'uploaded' as const };
    const recordHash = sha256Value(input.recordHash, 'recordHash');
    if (dataLabEvidenceHash(withoutHash) !== recordHash) throw new Error('recordHash does not match experiment content');
    return { ...withoutHash, recordHash };
  }
  if (input.stage !== 'dispatched' && input.stage !== 'complete') throw new Error('Unsupported Data Lab experiment stage');
  assertKeys(input, [
    ...EXPERIMENT_BASE_KEYS,
    ...DISPATCH_KEYS,
    ...(input.stage === 'complete' ? COMPLETE_KEYS : []),
  ]);
  const base = validateExperimentBase(input);
  const common = {
    ...base,
    operationId: nonEmpty(input.operationId, 'operationId'),
    outputDatasetId: nonEmpty(input.outputDatasetId, 'outputDatasetId'),
    outputDatasetVersion: input.outputDatasetVersion === null
      ? null : nonEmpty(input.outputDatasetVersion, 'outputDatasetVersion'),
    model: nonEmpty(input.model, 'model'),
    completionWindow: nonEmpty(input.completionWindow, 'completionWindow'),
    maxOutputTokens: nonNegativeInteger(input.maxOutputTokens, 'maxOutputTokens'),
    estimatedCostUsd: assertDataLabCostCap(
      finiteNonNegative(input.estimatedCostUsd, 'estimatedCostUsd'),
      finiteNonNegative(input.costCapUsd, 'costCapUsd'),
    ),
    costCapUsd: finiteNonNegative(input.costCapUsd, 'costCapUsd'),
    dispatchedAt: isoTimestamp(input.dispatchedAt, 'dispatchedAt'),
  };
  let withoutHash: Omit<DataLabDispatchedExperimentRecord, 'recordHash'> | Omit<DataLabCompleteExperimentRecord, 'recordHash'>;
  if (input.stage === 'dispatched') {
    if (input.operationStatus !== 'queued' && input.operationStatus !== 'running' && input.operationStatus !== 'succeeded') {
      throw new Error('A dispatched experiment must have queued, running, or succeeded status');
    }
    withoutHash = { ...common, stage: 'dispatched', operationStatus: input.operationStatus };
  } else {
    if (input.operationStatus !== 'succeeded') throw new Error('A complete experiment must have succeeded status');
    if (common.outputDatasetVersion === null) throw new Error('A complete experiment requires outputDatasetVersion');
    const calculatedCostUsd = assertDataLabCostCap(
      finiteNonNegative(input.calculatedCostUsd, 'calculatedCostUsd'), common.costCapUsd,
    );
    withoutHash = {
      ...common,
      stage: 'complete',
      operationStatus: 'succeeded',
      outputDatasetVersion: common.outputDatasetVersion,
      calculatedCostUsd,
      completedAt: isoTimestamp(input.completedAt, 'completedAt'),
      latencyMs: finiteNonNegative(input.latencyMs, 'latencyMs'),
      outputHash: sha256Value(input.outputHash, 'outputHash'),
    };
  }
  const recordHash = sha256Value(input.recordHash, 'recordHash');
  if (dataLabEvidenceHash(withoutHash) !== recordHash) throw new Error('recordHash does not match experiment content');
  return { ...withoutHash, recordHash } as DataLabExperimentRecord;
}

const REPORT_KEYS = [
  'schemaVersion', 'experimentRecordHash', 'requestHash', 'sourceResultHash', 'inputHash',
  'outputHash', 'rowCount', 'datasetId', 'datasetVersion', 'operationId', 'operationStatus',
  'outputDatasetId', 'outputDatasetVersion', 'model', 'promptVersions', 'completionWindow',
  'maxOutputTokens', 'estimatedCostUsd', 'costCapUsd', 'calculatedCostUsd', 'latencyMs',
  'qualityByPromptVariant', 'comparison', 'reportHash',
] as const;

export function validateDataLabBatchReport(value: unknown): DataLabBatchReport {
  const input = record(value, 'Data Lab batch report');
  assertKeys(input, REPORT_KEYS);
  if (input.schemaVersion !== DATALAB_BATCH_REPORT_SCHEMA_VERSION) throw new Error('Unsupported Data Lab batch report schema');
  if (input.operationStatus !== 'succeeded') throw new Error('Data Lab batch report must have succeeded status');
  if (input.rowCount !== DATALAB_EXPECTED_ROWS) throw new Error('Data Lab batch report rowCount must be 110');
  if (!Array.isArray(input.qualityByPromptVariant) || input.qualityByPromptVariant.length !== 2) {
    throw new Error('qualityByPromptVariant must contain both prompt variants');
  }
  const qualityByPromptVariant = input.qualityByPromptVariant.map((item, index) => {
    const quality = record(item, `qualityByPromptVariant[${index}]`);
    assertKeys(quality, [
      'promptVersion', 'correct', 'total', 'accuracy', 'inputTokens', 'outputTokens',
      'calculatedCostUsd',
    ]);
    if (quality.promptVersion !== DATALAB_PROMPT_VERSIONS[index]) {
      throw new Error('qualityByPromptVariant must use canonical prompt order');
    }
    if (quality.total !== DATALAB_EXPECTED_EVALUATIONS) throw new Error('Each prompt quality denominator must be 55');
    const correct = nonNegativeInteger(quality.correct, `qualityByPromptVariant[${index}].correct`);
    if (correct > DATALAB_EXPECTED_EVALUATIONS) throw new Error('Prompt correct count exceeds denominator');
    const accuracy = finiteNonNegative(quality.accuracy, `qualityByPromptVariant[${index}].accuracy`);
    if (accuracy !== correct / DATALAB_EXPECTED_EVALUATIONS) throw new Error('Prompt accuracy does not match counts');
    return {
      promptVersion: DATALAB_PROMPT_VERSIONS[index]!, correct,
      total: DATALAB_EXPECTED_EVALUATIONS, accuracy,
      inputTokens: nonNegativeInteger(quality.inputTokens, `qualityByPromptVariant[${index}].inputTokens`),
      outputTokens: nonNegativeInteger(quality.outputTokens, `qualityByPromptVariant[${index}].outputTokens`),
      calculatedCostUsd: finiteNonNegative(
        quality.calculatedCostUsd, `qualityByPromptVariant[${index}].calculatedCostUsd`,
      ),
    };
  });
  const comparisonInput = record(input.comparison, 'comparison');
  assertKeys(comparisonInput, ['winnerPromptVersion', 'loserPromptVersion', 'accuracyDelta', 'tied']);
  const winnerPromptVersion = enumValue<DataLabPromptVersion>(
    comparisonInput.winnerPromptVersion, new Set(DATALAB_PROMPT_VERSIONS), 'comparison.winnerPromptVersion',
  );
  const loserPromptVersion = enumValue<DataLabPromptVersion>(
    comparisonInput.loserPromptVersion, new Set(DATALAB_PROMPT_VERSIONS), 'comparison.loserPromptVersion',
  );
  if (winnerPromptVersion === loserPromptVersion || typeof comparisonInput.tied !== 'boolean') {
    throw new Error('comparison must identify two different prompt versions and tie status');
  }
  const winner = qualityByPromptVariant.find((quality) => quality.promptVersion === winnerPromptVersion)!;
  const loser = qualityByPromptVariant.find((quality) => quality.promptVersion === loserPromptVersion)!;
  const accuracyDelta = finiteNonNegative(comparisonInput.accuracyDelta, 'comparison.accuracyDelta');
  if (winner.accuracy < loser.accuracy || accuracyDelta !== winner.accuracy - loser.accuracy ||
      comparisonInput.tied !== (accuracyDelta === 0)) throw new Error('comparison does not match prompt quality');
  const comparison = { winnerPromptVersion, loserPromptVersion, accuracyDelta, tied: comparisonInput.tied };
  const withoutHash: Omit<DataLabBatchReport, 'reportHash'> = {
    schemaVersion: DATALAB_BATCH_REPORT_SCHEMA_VERSION,
    experimentRecordHash: sha256Value(input.experimentRecordHash, 'experimentRecordHash'),
    requestHash: sha256Value(input.requestHash, 'requestHash'),
    sourceResultHash: sha256Value(input.sourceResultHash, 'sourceResultHash'),
    inputHash: sha256Value(input.inputHash, 'inputHash'),
    outputHash: sha256Value(input.outputHash, 'outputHash'),
    rowCount: DATALAB_EXPECTED_ROWS,
    datasetId: nonEmpty(input.datasetId, 'datasetId'),
    datasetVersion: nonEmpty(input.datasetVersion, 'datasetVersion'),
    operationId: nonEmpty(input.operationId, 'operationId'),
    operationStatus: 'succeeded',
    outputDatasetId: nonEmpty(input.outputDatasetId, 'outputDatasetId'),
    outputDatasetVersion: nonEmpty(input.outputDatasetVersion, 'outputDatasetVersion'),
    model: nonEmpty(input.model, 'model'),
    promptVersions: exactPromptVersions(input.promptVersions, 'promptVersions'),
    completionWindow: nonEmpty(input.completionWindow, 'completionWindow'),
    maxOutputTokens: nonNegativeInteger(input.maxOutputTokens, 'maxOutputTokens'),
    estimatedCostUsd: assertDataLabCostCap(
      finiteNonNegative(input.estimatedCostUsd, 'estimatedCostUsd'),
      finiteNonNegative(input.costCapUsd, 'costCapUsd'),
    ),
    costCapUsd: finiteNonNegative(input.costCapUsd, 'costCapUsd'),
    calculatedCostUsd: assertDataLabCostCap(
      finiteNonNegative(input.calculatedCostUsd, 'calculatedCostUsd'),
      finiteNonNegative(input.costCapUsd, 'costCapUsd'),
    ),
    latencyMs: finiteNonNegative(input.latencyMs, 'latencyMs'),
    qualityByPromptVariant,
    comparison,
  };
  const qualityCost = qualityByPromptVariant.reduce((sum, quality) => sum + quality.calculatedCostUsd, 0);
  if (Math.abs(qualityCost - withoutHash.calculatedCostUsd) > 1e-12) {
    throw new Error('Prompt costs do not sum to calculatedCostUsd');
  }
  const reportHash = sha256Value(input.reportHash, 'reportHash');
  if (dataLabEvidenceHash(withoutHash) !== reportHash) throw new Error('reportHash does not match report content');
  return { ...withoutHash, reportHash };
}

function datasetRef(value: unknown, name: string, nullableVersion = false): { id: string; version: string | null } {
  const input = record(value, name);
  return {
    id: nonEmpty(input.id, `${name}.id`),
    version: nullableVersion && input.version === null ? null : nonEmpty(input.version, `${name}.version`),
  };
}

function firstDatasetRef(value: unknown, name: string, nullableVersion = false): { id: string; version: string | null } {
  const items = Array.isArray(value) ? value : [value];
  if (items.length === 0) throw new Error(`${name} must contain a dataset`);
  return datasetRef(items[0], `${name}[0]`, nullableVersion);
}

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

function validateOperation(value: unknown): DataLabOperation {
  const input = record(value, 'Data Lab operation response');
  if (input.type !== 'batch_inference') throw new Error('Data Lab operation type must be batch_inference');
  const status = enumValue<DataLabOperation['status']>(input.status, OPERATION_STATUSES, 'operation.status');
  const params = record(input.params, 'operation.params');
  return {
    id: nonEmpty(input.id, 'operation.id'),
    type: 'batch_inference',
    status,
    sourceDataset: firstDatasetRef(input.src, 'operation.src') as { id: string; version: string },
    outputDataset: firstDatasetRef(input.dst, 'operation.dst', true),
    model: nonEmpty(params.model, 'operation.params.model'),
    completionWindow: nonEmpty(params.completion_window, 'operation.params.completion_window'),
    createdAt: nonNegativeInteger(input.created_at, 'operation.created_at'),
    startedAt: input.in_progress_at === null || input.in_progress_at === undefined
      ? null : nonNegativeInteger(input.in_progress_at, 'operation.in_progress_at'),
    completedAt: input.finished_at === null || input.finished_at === undefined
      ? null : nonNegativeInteger(input.finished_at, 'operation.finished_at'),
  };
}

export class DataLabClient {
  readonly #apiKey: string;
  readonly #fetch: Fetch;
  readonly #baseUrl: string;

  constructor(options: DataLabClientOptions) {
    this.#apiKey = nonEmpty(options.apiKey, 'Data Lab API key');
    this.#fetch = options.fetch;
    this.#baseUrl = stripTrailingSlashes(options.baseUrl ?? 'https://api.tokenfactory.nebius.com');
  }

  async #request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`Nebius Data Lab request failed with HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new Error('Nebius Data Lab returned invalid JSON');
    }
  }

  async createDataset(request: DataLabCreateDatasetRequest): Promise<DataLabDatasetIdentity> {
    const response = record(await this.#request('/v1/datasets', {
      method: 'POST', body: JSON.stringify(request),
    }), 'Data Lab dataset response');
    const name = nonEmpty(response.name, 'dataset.name');
    if (name !== request.name) throw new Error('Data Lab dataset response identity does not match request');
    const summary = response.current_version_summary === null || response.current_version_summary === undefined
      ? null : record(response.current_version_summary, 'dataset.current_version_summary');
    const version = summary?.id ?? response.current_version ?? null;
    return {
      id: nonEmpty(response.id, 'dataset.id'),
      name,
      status: enumValue<DataLabDatasetIdentity['status']>(response.status, DATASET_STATUSES, 'dataset.status'),
      version: version === null ? null : nonEmpty(version, 'dataset version'),
    };
  }

  async getDataset(id: string): Promise<DataLabDatasetIdentity> {
    const datasetId = nonEmpty(id, 'dataset id');
    const response = record(
      await this.#request(`/v1/datasets/${encodeURIComponent(datasetId)}`),
      'Data Lab dataset response',
    );
    if (response.id !== datasetId) throw new Error('Data Lab dataset response identity does not match request');
    const summary = response.current_version_summary === null || response.current_version_summary === undefined
      ? null : record(response.current_version_summary, 'dataset.current_version_summary');
    const version = summary?.id ?? response.current_version ?? null;
    return {
      id: datasetId,
      name: nonEmpty(response.name, 'dataset.name'),
      status: enumValue<DataLabDatasetIdentity['status']>(response.status, DATASET_STATUSES, 'dataset.status'),
      version: version === null ? null : nonEmpty(version, 'dataset version'),
    };
  }

  async createBatchOperation(request: DataLabBatchOperationRequest): Promise<DataLabOperation> {
    const operation = validateOperation(await this.#request('/v1/operations', {
      method: 'POST', body: JSON.stringify(request),
    }));
    const source = request.src[0];
    if (source === undefined || operation.sourceDataset.id !== source.id ||
        operation.sourceDataset.version !== source.version ||
        operation.model !== request.params.model ||
        operation.completionWindow !== request.params.completion_window) {
      throw new Error('Data Lab operation response identity does not match source dataset');
    }
    return operation;
  }

  async getOperation(id: string): Promise<DataLabOperation> {
    const expectedId = nonEmpty(id, 'operation id');
    const operation = validateOperation(await this.#request(`/v1/operations/${encodeURIComponent(expectedId)}`));
    if (operation.id !== expectedId) throw new Error('Data Lab operation response identity does not match request');
    return operation;
  }

  async getOperationResults(id: string): Promise<Record<string, unknown>> {
    const operationId = nonEmpty(id, 'operation id');
    return record(
      await this.#request(`/v1/operations/${encodeURIComponent(operationId)}/results`),
      'Data Lab operation results',
    );
  }

  async getDatasetContent(id: string, version: string): Promise<Record<string, unknown>[]> {
    const datasetId = nonEmpty(id, 'dataset id');
    const datasetVersion = nonEmpty(version, 'dataset version');
    const encodedId = encodeURIComponent(datasetId);
    const dataset = await this.getDataset(datasetId);
    if (dataset.version !== datasetVersion) {
      throw new Error('Data Lab dataset content identity or version does not match request');
    }
    const path = `/v1/datasets/${encodedId}/content?limit=1000&offset=0`;
    const response = await this.#request(path);
    let rows: Record<string, unknown>[];
    if (Array.isArray(response)) {
      rows = response.map((item, index) => record(item, `dataset rows[${index}]`));
    } else {
      const envelope = record(response, 'Data Lab dataset content');
      if (envelope.version !== undefined && envelope.version !== datasetVersion) {
        throw new Error('Data Lab dataset content version does not match request');
      }
      if (!Array.isArray(envelope.rows)) throw new Error('Data Lab dataset content must contain rows');
      rows = envelope.rows.map((item, index) => record(item, `dataset rows[${index}]`));
    }
    const after = await this.getDataset(datasetId);
    if (after.version !== datasetVersion) throw new Error('Data Lab dataset version changed while reading content');
    return rows;
  }
}
