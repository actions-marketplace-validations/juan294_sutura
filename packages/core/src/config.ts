import {
  DEFAULT_REPAIR_BUDGET_LIMITS,
  repairBudgetLimits,
  type RepairBudgetLimits,
} from './engine/repair-budget.js';
import { DEFAULT_SEARCH_LIMITS } from './engine/search.js';
import { DEFAULT_ROUTING_PROFILE_ID, DEVELOPMENT_ROUTING_PROFILE_ID } from './llm/router.js';
import type { RuntimeId } from './runtime/types.js';

export const DEFAULT_MODELS = {
  nano: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
  super: 'nvidia/nemotron-3-super-120b-a12b',
  ultra: 'nvidia/Nemotron-3-Ultra-550b-a55b',
} as const;

export const TOKEN_FACTORY_BASE_URL = 'https://api.tokenfactory.nebius.com/v1/';

export const MAX_TRIAGE_RUNS = 20;
export const MAX_RACE_CANDIDATES = 10;
export const MAX_STAGE_EVIDENCE_ENTRIES = 100;

export interface Config {
  nebiusApiKey: string;
  tavilyApiKey?: string;
  contreeToken?: string;
  contreeProject?: string;
  triageN: number;
  raceK: number;
  models: Record<keyof typeof DEFAULT_MODELS, string>;
  routingProfileId: string;
  maxOps: number;
  repairBudgets: RepairBudgetLimits;
  search: SearchLimits;
  runtimeId?: RuntimeId;
}

export interface SearchLimits {
  initialBranches: number;
  beamWidth: number;
  maximumDepth: number;
  maximumTotalBranches: number;
}

export type ConfigEnvironment = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function required(env: ConfigEnvironment, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new ConfigError(`Missing required environment variable: ${name}`);
  }

  return value;
}

function optional(env: ConfigEnvironment, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function verifiedSuperModel(env: ConfigEnvironment): string {
  const configured = optional(env, 'SUTURA_MODEL_SUPER');
  if (configured !== undefined && configured !== DEFAULT_MODELS.super) {
    throw new ConfigError(
      `SUTURA_MODEL_SUPER must be ${DEFAULT_MODELS.super} until another exact verified provider contract ships`,
    );
  }
  return DEFAULT_MODELS.super;
}

function positiveInteger(
  env: ConfigEnvironment,
  name: string,
  fallback: number,
): number {
  const value = optional(env, name);
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive integer`);
  }

  return parsed;
}

function boundedPositiveInteger(
  env: ConfigEnvironment,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const value = positiveInteger(env, name, fallback);
  if (value > maximum) {
    throw new ConfigError(`${name} must be at most ${maximum}`);
  }
  return value;
}

function boundedPositiveNumber(
  env: ConfigEnvironment,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const value = optional(env, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
    throw new ConfigError(`${name} must be greater than 0 and at most ${maximum}`);
  }
  return parsed;
}

export function loadConfig(env: ConfigEnvironment): Config {
  const routingProfileId = optional(env, 'SUTURA_ROUTING_PROFILE') ?? DEFAULT_ROUTING_PROFILE_ID;
  if (routingProfileId !== DEFAULT_ROUTING_PROFILE_ID && routingProfileId !== DEVELOPMENT_ROUTING_PROFILE_ID) {
    throw new ConfigError(
      `SUTURA_ROUTING_PROFILE must be ${DEFAULT_ROUTING_PROFILE_ID} or ${DEVELOPMENT_ROUTING_PROFILE_ID}`,
    );
  }
  const config: Config = {
    nebiusApiKey: required(env, 'NEBIUS_API_KEY'),
    triageN: boundedPositiveInteger(
      env,
      'SUTURA_TRIAGE_N',
      5,
      MAX_TRIAGE_RUNS,
    ),
    raceK: boundedPositiveInteger(
      env,
      'SUTURA_RACE_K',
      3,
      MAX_RACE_CANDIDATES,
    ),
    models: {
      nano: optional(env, 'SUTURA_MODEL_NANO') ?? DEFAULT_MODELS.nano,
      super: verifiedSuperModel(env),
      ultra: optional(env, 'SUTURA_MODEL_ULTRA') ?? DEFAULT_MODELS.ultra,
    },
    routingProfileId,
    maxOps: positiveInteger(env, 'SUTURA_MAX_OPS', 40),
    repairBudgets: repairBudgetLimits({
      modelTurns: boundedPositiveInteger(
        env, 'SUTURA_REPAIR_MODEL_TURNS',
        DEFAULT_REPAIR_BUDGET_LIMITS.modelTurns,
        DEFAULT_REPAIR_BUDGET_LIMITS.modelTurns,
      ),
      toolCalls: boundedPositiveInteger(
        env, 'SUTURA_REPAIR_TOOL_CALLS',
        DEFAULT_REPAIR_BUDGET_LIMITS.toolCalls,
        DEFAULT_REPAIR_BUDGET_LIMITS.toolCalls,
      ),
      branches: boundedPositiveInteger(
        env, 'SUTURA_REPAIR_BRANCHES',
        DEFAULT_REPAIR_BUDGET_LIMITS.branches,
        DEFAULT_REPAIR_BUDGET_LIMITS.branches,
      ),
      sandboxOperations: boundedPositiveInteger(
        env, 'SUTURA_REPAIR_SANDBOX_OPERATIONS',
        DEFAULT_REPAIR_BUDGET_LIMITS.sandboxOperations,
        DEFAULT_REPAIR_BUDGET_LIMITS.sandboxOperations,
      ),
      elapsedTimeSec: boundedPositiveInteger(
        env, 'SUTURA_REPAIR_ELAPSED_TIME_SEC',
        DEFAULT_REPAIR_BUDGET_LIMITS.elapsedTimeSec,
        DEFAULT_REPAIR_BUDGET_LIMITS.elapsedTimeSec,
      ),
      inferenceCostUsd: boundedPositiveNumber(
        env, 'SUTURA_REPAIR_INFERENCE_COST_USD',
        DEFAULT_REPAIR_BUDGET_LIMITS.inferenceCostUsd,
        DEFAULT_REPAIR_BUDGET_LIMITS.inferenceCostUsd,
      ),
      diffBytes: boundedPositiveInteger(
        env, 'SUTURA_REPAIR_DIFF_BYTES',
        DEFAULT_REPAIR_BUDGET_LIMITS.diffBytes,
        DEFAULT_REPAIR_BUDGET_LIMITS.diffBytes,
      ),
    }),
    search: {
      initialBranches: boundedPositiveInteger(env, 'SUTURA_SEARCH_INITIAL_BRANCHES', DEFAULT_SEARCH_LIMITS.initialBranches, DEFAULT_SEARCH_LIMITS.maximumTotalBranches),
      beamWidth: boundedPositiveInteger(env, 'SUTURA_SEARCH_BEAM_WIDTH', DEFAULT_SEARCH_LIMITS.beamWidth, DEFAULT_SEARCH_LIMITS.maximumTotalBranches),
      maximumDepth: boundedPositiveInteger(env, 'SUTURA_SEARCH_MAX_DEPTH', DEFAULT_SEARCH_LIMITS.maximumDepth, DEFAULT_SEARCH_LIMITS.maximumDepth),
      maximumTotalBranches: boundedPositiveInteger(env, 'SUTURA_SEARCH_MAX_TOTAL_BRANCHES', DEFAULT_SEARCH_LIMITS.maximumTotalBranches, DEFAULT_SEARCH_LIMITS.maximumTotalBranches),
    },
  };

  const runtime = optional(env, 'SUTURA_RUNTIME');
  if (runtime !== undefined && runtime !== 'auto' && runtime !== 'node' && runtime !== 'python') {
    throw new ConfigError('SUTURA_RUNTIME must be auto, node, or python');
  }
  if (runtime === 'node' || runtime === 'python') config.runtimeId = runtime;

  const tavilyApiKey = optional(env, 'TAVILY_API_KEY');
  if (tavilyApiKey !== undefined) {
    config.tavilyApiKey = tavilyApiKey;
  }

  const contreeToken = optional(env, 'CONTREE_TOKEN');
  if (contreeToken !== undefined) {
    config.contreeToken = contreeToken;
  }

  const contreeProject = optional(env, 'CONTREE_PROJECT');
  if (contreeProject !== undefined) {
    config.contreeProject = contreeProject;
  }

  if (config.search.initialBranches > config.search.maximumTotalBranches) {
    throw new ConfigError('SUTURA_SEARCH_INITIAL_BRANCHES must not exceed SUTURA_SEARCH_MAX_TOTAL_BRANCHES');
  }
  if (config.search.beamWidth > config.search.maximumTotalBranches) {
    throw new ConfigError('SUTURA_SEARCH_BEAM_WIDTH must not exceed SUTURA_SEARCH_MAX_TOTAL_BRANCHES');
  }

  return config;
}
