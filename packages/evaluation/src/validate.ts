import { isDeepStrictEqual } from 'node:util';

import { sanitizeTraceEvent, type TraceEvent } from '@sutura/core';

import { evaluationResultHash } from './manifest.js';
import {
  EVALUATION_SCHEMA_VERSION,
  type EvaluationCase,
  type EvaluationManifest,
} from './schema.js';

const COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const OUTCOMES = new Set(['fixed', 'flaky-no-patch', 'refused', 'gave-up', 'infra-stop']);
const TRACE_TYPES = new Set([
  'run-start', 'model-request', 'model-response', 'tool-request', 'tool-result',
  'sandbox-operation', 'search-decision', 'candidate-submitted', 'audit-result',
  'counterfactual-result', 'run-finish',
]);
const COUNTERFACTUAL_INTENTS = new Set(['plausible', 'shortcut']);
const TRACE_STAGES = new Set([
  'run', 'policy', 'preparation', 'reproduction', 'triage', 'candidate', 'search', 'audit',
]);
const BASE_TRACE_KEYS = ['schemaVersion', 'runId', 'sequence', 'timestampMs', 'stage', 'type'];
const MODEL_KEYS = [
  'role', 'model', 'summary', 'inputTokens', 'outputTokens', 'reasoningTokens',
  'latencyMs', 'costUsd', 'requestId',
];
const EVENT_KEYS: Readonly<Record<string, readonly string[]>> = {
  'run-start': ['summary'],
  'model-request': [...MODEL_KEYS, 'promptHash', 'promptExcerpt'],
  'model-response': MODEL_KEYS,
  'tool-request': ['toolCallId', 'toolName', 'argumentSummary', 'childNodeId'],
  'tool-result': ['toolCallId', 'toolName', 'resultSummary', 'childNodeId'],
  'sandbox-operation': ['operation', 'resultSummary', 'childNodeId'],
  'search-decision': ['summary', 'childNodeId', 'parentNodeId'],
  'candidate-submitted': ['candidateId', 'summary', 'childNodeId'],
  'audit-result': ['approved', 'summary', 'childNodeId'],
  'counterfactual-result': [
    'alternativeId', 'intent', 'approved', 'gate', 'rule', 'summary', 'childNodeId',
  ],
  'run-finish': ['outcome'],
};

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
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be non-empty`);
  return value;
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  return value;
}

function optionalString(value: unknown, name: string): void {
  if (value !== undefined) nonEmpty(value, name);
}

function nonNegativeNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  const number = nonNegativeNumber(value, name);
  if (!Number.isSafeInteger(number)) throw new Error(`${name} must be an integer`);
  return number;
}

function validateModelFields(event: Record<string, unknown>, name: string): void {
  if (!['system', 'user', 'assistant'].includes(String(event.role))) {
    throw new Error(`${name}.role is invalid`);
  }
  nonEmpty(event.model, `${name}.model`);
  stringValue(event.summary, `${name}.summary`);
  nonNegativeInteger(event.inputTokens, `${name}.inputTokens`);
  nonNegativeInteger(event.outputTokens, `${name}.outputTokens`);
  nonNegativeInteger(event.reasoningTokens, `${name}.reasoningTokens`);
  nonNegativeNumber(event.latencyMs, `${name}.latencyMs`);
  nonNegativeNumber(event.costUsd, `${name}.costUsd`);
  if (event.requestId !== null) nonEmpty(event.requestId, `${name}.requestId`);
}

function validateEventFields(event: Record<string, unknown>, name: string): void {
  const type = String(event.type);
  const specific = EVENT_KEYS[type];
  if (specific === undefined) throw new Error(`Unsupported trace event: ${type}`);
  const optional: string[] = specific.filter((key) => key === 'childNodeId' || key === 'parentNodeId');
  assertKeys(event, [...BASE_TRACE_KEYS, ...specific.filter((key) => !optional.includes(key))], optional);
  if (type === 'model-request' || type === 'model-response') {
    validateModelFields(event, name);
    if (type === 'model-request') {
      if (!SHA256.test(String(event.promptHash))) throw new Error(`${name}.promptHash must be SHA-256`);
      stringValue(event.promptExcerpt, `${name}.promptExcerpt`);
    }
    return;
  }
  if (type === 'run-start') stringValue(event.summary, `${name}.summary`);
  if (type === 'run-finish' && !OUTCOMES.has(String(event.outcome))) {
    throw new Error(`${name}.outcome is invalid`);
  }
  if (type === 'tool-request') {
    nonEmpty(event.toolCallId, `${name}.toolCallId`);
    nonEmpty(event.toolName, `${name}.toolName`);
    record(event.argumentSummary, `${name}.argumentSummary`);
  }
  if (type === 'tool-result') {
    nonEmpty(event.toolCallId, `${name}.toolCallId`);
    nonEmpty(event.toolName, `${name}.toolName`);
    stringValue(event.resultSummary, `${name}.resultSummary`);
  }
  if (type === 'sandbox-operation') {
    nonEmpty(event.operation, `${name}.operation`);
    stringValue(event.resultSummary, `${name}.resultSummary`);
  }
  if (type === 'search-decision') stringValue(event.summary, `${name}.summary`);
  if (type === 'candidate-submitted') {
    nonEmpty(event.candidateId, `${name}.candidateId`);
    stringValue(event.summary, `${name}.summary`);
  }
  if (type === 'audit-result') {
    if (typeof event.approved !== 'boolean') throw new Error(`${name}.approved must be boolean`);
    stringValue(event.summary, `${name}.summary`);
  }
  if (type === 'counterfactual-result') {
    nonEmpty(event.alternativeId, `${name}.alternativeId`);
    if (!COUNTERFACTUAL_INTENTS.has(String(event.intent))) {
      throw new Error(`${name}.intent is invalid`);
    }
    if (typeof event.approved !== 'boolean') throw new Error(`${name}.approved must be boolean`);
    const gate = stringValue(event.gate, `${name}.gate`);
    const rule = stringValue(event.rule, `${name}.rule`);
    if ((gate === '') !== (rule === '')) {
      throw new Error(`${name}.gate and ${name}.rule must both be set or both be empty`);
    }
    if (event.approved === (gate !== '')) {
      throw new Error(`${name}.gate must be empty exactly when the alternative is approved`);
    }
    stringValue(event.summary, `${name}.summary`);
  }
  optionalString(event.childNodeId, `${name}.childNodeId`);
  optionalString(event.parentNodeId, `${name}.parentNodeId`);
}

function traceEvents(value: unknown, runName: string): TraceEvent[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${runName}.trace must be non-empty`);
  let timestamp = -1;
  let runId: string | undefined;
  const pendingTools = new Map<string, string>();
  const completedTools = new Set<string>();
  const events = value.map((item, index) => {
    const name = `${runName}.trace[${index}]`;
    const event = record(item, name);
    if (event.schemaVersion !== 'sutura-trace-v1') throw new Error('Unsupported trace schema');
    if (event.sequence !== index + 1) throw new Error('Trace sequences must start at 1 and be monotonic');
    if (!Number.isSafeInteger(event.timestampMs) || (event.timestampMs as number) < 0 || (event.timestampMs as number) < timestamp) {
      throw new Error('Trace timestamps must be monotonic non-negative integers');
    }
    timestamp = event.timestampMs as number;
    if (!TRACE_TYPES.has(String(event.type))) throw new Error(`Unsupported trace event: ${String(event.type)}`);
    if (!TRACE_STAGES.has(String(event.stage))) throw new Error(`Unsupported trace stage: ${String(event.stage)}`);
    const currentRunId = nonEmpty(event.runId, `${name}.runId`);
    runId ??= currentRunId;
    if (currentRunId !== runId) throw new Error('Every trace event must use the same runId');
    validateEventFields(event, name);
    if (event.type === 'tool-request') {
      const callId = String(event.toolCallId);
      if (pendingTools.has(callId) || completedTools.has(callId)) throw new Error(`Duplicate tool call: ${callId}`);
      pendingTools.set(callId, String(event.toolName));
    }
    if (event.type === 'tool-result') {
      const callId = String(event.toolCallId);
      if (pendingTools.get(callId) !== event.toolName) throw new Error(`Unpaired tool result: ${callId}`);
      pendingTools.delete(callId);
      completedTools.add(callId);
    }
    const clone = structuredClone(event) as unknown as TraceEvent;
    if (!isDeepStrictEqual(sanitizeTraceEvent(clone), clone)) {
      throw new Error(`${name} contains unsafe or unbounded trace data`);
    }
    return clone;
  });
  if (events[0]?.type !== 'run-start' || events[0].stage !== 'run') {
    throw new Error(`${runName}.trace must start with run-start`);
  }
  if (events.at(-1)?.type !== 'run-finish' || events.at(-1)?.stage !== 'run') {
    throw new Error(`${runName}.trace must finish with run-finish`);
  }
  return events;
}

function evaluationCase(value: unknown, index: number): EvaluationCase {
  const item = record(value, `cases[${index}]`);
  assertKeys(item, ['caseId', 'outcome', 'trace']);
  const outcome = nonEmpty(item.outcome, `cases[${index}].outcome`);
  if (!OUTCOMES.has(outcome)) throw new Error(`Unsupported case outcome: ${outcome}`);
  const trace = traceEvents(item.trace, `cases[${index}]`);
  const finish = trace.at(-1);
  if (finish?.type !== 'run-finish' || finish.outcome !== outcome) {
    throw new Error(`cases[${index}].outcome must match its run-finish event`);
  }
  return {
    caseId: nonEmpty(item.caseId, `cases[${index}].caseId`),
    outcome: outcome as EvaluationCase['outcome'],
    trace,
  };
}

export function validateEvaluationManifest(value: unknown): EvaluationManifest {
  const input = record(value, 'manifest');
  assertKeys(input, [
    'schemaVersion', 'evaluationId', 'suturaCommit', 'corpusName', 'corpusVersion',
    'corpusHash', 'adapterVersion', 'modelCatalogSnapshot', 'routingProfile',
    'budgetProfile', 'cases', 'startedAt', 'completedAt', 'resultHash',
  ]);
  if (input.schemaVersion !== EVALUATION_SCHEMA_VERSION) throw new Error('Unsupported evaluation schema');
  if (!COMMIT.test(String(input.suturaCommit))) throw new Error('suturaCommit must be exact');
  if (!SHA256.test(String(input.corpusHash))) throw new Error('corpusHash must be SHA-256');
  if (!Array.isArray(input.modelCatalogSnapshot)) throw new Error('modelCatalogSnapshot must be an array');
  if (!Array.isArray(input.cases) || input.cases.length === 0) throw new Error('cases must be non-empty');
  const manifest: EvaluationManifest = {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    evaluationId: nonEmpty(input.evaluationId, 'evaluationId'),
    suturaCommit: String(input.suturaCommit),
    corpusName: nonEmpty(input.corpusName, 'corpusName'),
    corpusVersion: nonEmpty(input.corpusVersion, 'corpusVersion'),
    corpusHash: String(input.corpusHash),
    adapterVersion: nonEmpty(input.adapterVersion, 'adapterVersion'),
    modelCatalogSnapshot: input.modelCatalogSnapshot.map((item, index) =>
      nonEmpty(item, `modelCatalogSnapshot[${index}]`)),
    routingProfile: nonEmpty(input.routingProfile, 'routingProfile'),
    budgetProfile: nonEmpty(input.budgetProfile, 'budgetProfile'),
    cases: input.cases.map(evaluationCase),
    startedAt: nonEmpty(input.startedAt, 'startedAt'),
    completedAt: nonEmpty(input.completedAt, 'completedAt'),
    resultHash: nonEmpty(input.resultHash, 'resultHash'),
  };
  if (!SHA256.test(manifest.resultHash) || evaluationResultHash(manifest) !== manifest.resultHash) {
    throw new Error('Evaluation resultHash does not match normalized content');
  }
  return manifest;
}
