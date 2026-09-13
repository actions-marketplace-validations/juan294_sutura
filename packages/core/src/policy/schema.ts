import { parseVerificationPolicy, type VerificationPolicy } from '../challenges/contracts.js';

export interface ResourceLimits {
  elapsedTimePercent?: number;
  maxRssPercent?: number;
}

export interface RepositoryPolicy {
  version: 1;
  verification?: VerificationPolicy;
  runtime?: 'node' | 'python';
  allowedPaths: string[];
  protectedPaths: string[];
  deniedReadPaths: string[];
  maxDiffBytes: number;
  maxChangedFiles: number;
  requiredCommands: string[];
  resourceLimits: ResourceLimits;
}

export class PolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyValidationError';
  }
}

const POLICY_KEYS = new Set([
  'version',
  'verification',
  'runtime',
  'allowedPaths',
  'protectedPaths',
  'deniedReadPaths',
  'maxDiffBytes',
  'maxChangedFiles',
  'requiredCommands',
  'resourceLimits',
]);
const RESOURCE_KEYS = new Set(['elapsedTimePercent', 'maxRssPercent']);
const MAX_GLOBS = 64;
const MAX_COMMANDS = 20;
const MAX_PATH_LENGTH = 240;
const MAX_COMMAND_LENGTH = 200;
const MAX_POLICY_LIMIT = 100_000_000;
const MAX_RESOURCE_PERCENT = 10_000;

export const DEFAULT_REPOSITORY_POLICY = Object.freeze({
  version: 1,
  allowedPaths: Object.freeze(['**']),
  protectedPaths: Object.freeze(['.sutura.json', '**/.sutura-controller/**', '**/.sutura-evaluator/**', '**/hidden/**', '**/.sutura/challenges/**']),
  deniedReadPaths: Object.freeze([]),
  maxDiffBytes: 65_536,
  maxChangedFiles: 8,
  requiredCommands: Object.freeze([]),
  resourceLimits: Object.freeze({}),
});

function objectRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PolicyValidationError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  name: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new PolicyValidationError(`${name} has unknown key: ${unknown}`);
}

export function validatePolicyGlob(glob: string): string {
  if (
    glob.length === 0 ||
    glob.length > MAX_PATH_LENGTH ||
    !/^[\x20-\x7e]+$/u.test(glob) ||
    glob.startsWith('/') ||
    /[\\{}()[\]!]/u.test(glob)
  ) {
    throw new PolicyValidationError(`Invalid policy glob: ${glob}`);
  }
  const segments = glob.split('/');
  if (
    segments.some((segment) =>
      segment === '' ||
      segment === '.' ||
      segment === '..' ||
      (segment.includes('**') && segment !== '**'))
  ) {
    throw new PolicyValidationError(`Invalid policy glob: ${glob}`);
  }
  return glob;
}

function stringArray(
  value: unknown,
  name: string,
  fallback: readonly string[],
  maximum: number,
  validate: (entry: string) => string,
): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.length > maximum) {
    throw new PolicyValidationError(`${name} must be an array with at most ${maximum} entries`);
  }
  const entries = value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new PolicyValidationError(`${name} entries must be strings`);
    }
    return validate(entry);
  });
  return [...new Set(entries)];
}

function positiveInteger(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > MAX_POLICY_LIMIT) {
    throw new PolicyValidationError(`${name} must be a positive bounded integer`);
  }
  return value as number;
}

function resourcePercentage(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_RESOURCE_PERCENT
  ) {
    throw new PolicyValidationError(`${name} must be a bounded non-negative percentage`);
  }
  return value;
}

function requiredCommand(command: string): string {
  if (
    command.length === 0 ||
    command.length > MAX_COMMAND_LENGTH ||
    command.trim() !== command ||
    !/^[A-Za-z0-9@%_./:=+,\- ]+$/u.test(command) ||
    /\s{2,}/u.test(command)
  ) {
    throw new PolicyValidationError(`Unsafe required command: ${command}`);
  }
  return command;
}

export function parseRepositoryPolicy(content: string): RepositoryPolicy {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new PolicyValidationError(
      `Repository policy is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const value = objectRecord(parsed, 'Repository policy');
  rejectUnknownKeys(value, POLICY_KEYS, 'Repository policy');
  if (value.version !== 1) {
    throw new PolicyValidationError('Unsupported policy version; expected version 1');
  }
  if (value.runtime !== undefined && value.runtime !== 'node' && value.runtime !== 'python') {
    throw new PolicyValidationError('runtime must be "node" or "python"');
  }

  const protectedPaths = stringArray(
    value.protectedPaths,
    'protectedPaths',
    DEFAULT_REPOSITORY_POLICY.protectedPaths,
    MAX_GLOBS,
    validatePolicyGlob,
  );
  for (const path of [...DEFAULT_REPOSITORY_POLICY.protectedPaths].reverse()) {
    if (!protectedPaths.includes(path)) protectedPaths.unshift(path);
  }

  const resourceValue = value.resourceLimits === undefined
    ? {}
    : objectRecord(value.resourceLimits, 'resourceLimits');
  rejectUnknownKeys(resourceValue, RESOURCE_KEYS, 'resourceLimits');
  const elapsedTimePercent = resourcePercentage(
    resourceValue.elapsedTimePercent,
    'resourceLimits.elapsedTimePercent',
  );
  const maxRssPercent = resourcePercentage(
    resourceValue.maxRssPercent,
    'resourceLimits.maxRssPercent',
  );

  const requiredCommands = stringArray(
    value.requiredCommands,
    'requiredCommands',
    DEFAULT_REPOSITORY_POLICY.requiredCommands,
    MAX_COMMANDS,
    requiredCommand,
  );
  if (
    requiredCommands.length === 0 &&
    (elapsedTimePercent !== undefined || maxRssPercent !== undefined)
  ) {
    throw new PolicyValidationError(
      'resourceLimits requires at least one required command',
    );
  }

  return {
    version: 1,
    ...(value.verification === undefined ? {} : { verification: parseVerificationPolicy(value.verification) }),
    ...(value.runtime === undefined ? {} : { runtime: value.runtime }),
    allowedPaths: stringArray(
      value.allowedPaths,
      'allowedPaths',
      DEFAULT_REPOSITORY_POLICY.allowedPaths,
      MAX_GLOBS,
      validatePolicyGlob,
    ),
    protectedPaths,
    deniedReadPaths: stringArray(
      value.deniedReadPaths,
      'deniedReadPaths',
      DEFAULT_REPOSITORY_POLICY.deniedReadPaths,
      MAX_GLOBS,
      validatePolicyGlob,
    ),
    maxDiffBytes: positiveInteger(
      value.maxDiffBytes,
      'maxDiffBytes',
      DEFAULT_REPOSITORY_POLICY.maxDiffBytes,
    ),
    maxChangedFiles: positiveInteger(
      value.maxChangedFiles,
      'maxChangedFiles',
      DEFAULT_REPOSITORY_POLICY.maxChangedFiles,
    ),
    requiredCommands,
    resourceLimits: {
      ...(elapsedTimePercent === undefined ? {} : { elapsedTimePercent }),
      ...(maxRssPercent === undefined ? {} : { maxRssPercent }),
    },
  };
}
