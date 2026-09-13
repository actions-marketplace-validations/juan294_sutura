import {
  DEFAULT_ROUTING_PROFILE_ID,
  DEFAULT_REPAIR_BUDGET_LIMITS,
  DEFAULT_SEARCH_LIMITS,
  MAX_TRIAGE_RUNS,
} from '@sutura/core';

export type InputReader = (name: string) => string;

export interface ActionConfiguration {
  mode?: 'verify';
  githubToken: string;
  runId: string;
  triageN: number;
  requireFixed: boolean;
  captureReplay: boolean;
  environment: Readonly<Record<string, string>>;
}

function runtimeInput(value: string): 'node' | 'python' | undefined {
  const runtime = value.trim() || 'auto';
  if (runtime === 'auto') return undefined;
  if (runtime !== 'node' && runtime !== 'python') {
    throw new ActionInputError('runtime must be auto, node, or python');
  }
  return runtime;
}

export class ActionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionInputError';
  }
}

function required(read: InputReader, name: string): string {
  const value = read(name).trim();
  if (!value) throw new ActionInputError(`Missing required action input: ${name}`);
  return value;
}

function boundedInteger(
  value: string,
  fallback: number,
  maximum: number,
  name: string,
): number {
  if (!value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new ActionInputError(`${name} must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

function optional(
  environment: Record<string, string>,
  read: InputReader,
  input: string,
  variable: string,
): void {
  const value = read(input).trim();
  if (value) environment[variable] = value;
}

function boundedNumber(value: string, fallback: number, maximum: number, name: string): number {
  if (!value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
    throw new ActionInputError(`${name} must be greater than 0 and at most ${maximum}`);
  }
  return parsed;
}

function booleanInput(value: string, fallback: boolean, name: string): boolean {
  const normalized = value.trim();
  if (!normalized) return fallback;
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new ActionInputError(`${name} must be true or false`);
}

export function mapActionInputs(read: InputReader): ActionConfiguration {
  const mode = read('mode').trim() || 'heal';
  if (mode !== 'heal' && mode !== 'verify') {
    throw new ActionInputError('mode must be heal or verify');
  }
  const runId = required(read, 'run-id');
  if (!/^[1-9]\d*$/.test(runId)) {
    throw new ActionInputError('run-id must be a positive decimal id');
  }
  const triageN = boundedInteger(read('triage-n'), 5, MAX_TRIAGE_RUNS, 'triage-n');
  const environment: Record<string, string> = {
    NEBIUS_API_KEY: required(read, 'nebius-api-key'),
    CONTREE_TOKEN: required(read, 'contree-token'),
    CONTREE_PROJECT: required(read, 'contree-project'),
    SUTURA_TRIAGE_N: String(triageN),
    SUTURA_ROUTING_PROFILE: read('routing-profile').trim() || DEFAULT_ROUTING_PROFILE_ID,
    SUTURA_REPAIR_MODEL_TURNS: String(boundedInteger(read('repair-model-turns'), DEFAULT_REPAIR_BUDGET_LIMITS.modelTurns, DEFAULT_REPAIR_BUDGET_LIMITS.modelTurns, 'repair-model-turns')),
    SUTURA_REPAIR_TOOL_CALLS: String(boundedInteger(read('repair-tool-calls'), DEFAULT_REPAIR_BUDGET_LIMITS.toolCalls, DEFAULT_REPAIR_BUDGET_LIMITS.toolCalls, 'repair-tool-calls')),
    SUTURA_REPAIR_BRANCHES: String(boundedInteger(read('repair-branches'), DEFAULT_REPAIR_BUDGET_LIMITS.branches, DEFAULT_REPAIR_BUDGET_LIMITS.branches, 'repair-branches')),
    SUTURA_REPAIR_SANDBOX_OPERATIONS: String(boundedInteger(read('repair-sandbox-operations'), DEFAULT_REPAIR_BUDGET_LIMITS.sandboxOperations, DEFAULT_REPAIR_BUDGET_LIMITS.sandboxOperations, 'repair-sandbox-operations')),
    SUTURA_REPAIR_ELAPSED_TIME_SEC: String(boundedInteger(read('repair-elapsed-time-sec'), DEFAULT_REPAIR_BUDGET_LIMITS.elapsedTimeSec, DEFAULT_REPAIR_BUDGET_LIMITS.elapsedTimeSec, 'repair-elapsed-time-sec')),
    SUTURA_REPAIR_INFERENCE_COST_USD: String(boundedNumber(read('repair-inference-cost-usd'), DEFAULT_REPAIR_BUDGET_LIMITS.inferenceCostUsd, DEFAULT_REPAIR_BUDGET_LIMITS.inferenceCostUsd, 'repair-inference-cost-usd')),
    SUTURA_REPAIR_DIFF_BYTES: String(boundedInteger(read('repair-diff-bytes'), DEFAULT_REPAIR_BUDGET_LIMITS.diffBytes, DEFAULT_REPAIR_BUDGET_LIMITS.diffBytes, 'repair-diff-bytes')),
    SUTURA_SEARCH_INITIAL_BRANCHES: String(boundedInteger(read('search-initial-branches'), DEFAULT_SEARCH_LIMITS.initialBranches, DEFAULT_SEARCH_LIMITS.maximumTotalBranches, 'search-initial-branches')),
    SUTURA_SEARCH_BEAM_WIDTH: String(boundedInteger(read('search-beam-width'), DEFAULT_SEARCH_LIMITS.beamWidth, DEFAULT_SEARCH_LIMITS.maximumTotalBranches, 'search-beam-width')),
    SUTURA_SEARCH_MAX_DEPTH: String(boundedInteger(read('search-max-depth'), DEFAULT_SEARCH_LIMITS.maximumDepth, DEFAULT_SEARCH_LIMITS.maximumDepth, 'search-max-depth')),
    SUTURA_SEARCH_MAX_TOTAL_BRANCHES: String(boundedInteger(read('search-max-total-branches'), DEFAULT_SEARCH_LIMITS.maximumTotalBranches, DEFAULT_SEARCH_LIMITS.maximumTotalBranches, 'search-max-total-branches')),
  };
  optional(environment, read, 'tavily-api-key', 'TAVILY_API_KEY');
  optional(environment, read, 'model-nano', 'SUTURA_MODEL_NANO');
  optional(environment, read, 'model-super', 'SUTURA_MODEL_SUPER');
  optional(environment, read, 'model-ultra', 'SUTURA_MODEL_ULTRA');
  const runtime = runtimeInput(read('runtime'));
  if (runtime !== undefined) environment.SUTURA_RUNTIME = runtime;

  return {
    ...(mode === 'verify' ? { mode: 'verify' as const } : {}),
    githubToken: required(read, 'github-token'),
    runId,
    triageN,
    requireFixed: booleanInput(read('require-fixed'), false, 'require-fixed'),
    captureReplay: booleanInput(read('capture-replay'), false, 'capture-replay'),
    environment,
  };
}
