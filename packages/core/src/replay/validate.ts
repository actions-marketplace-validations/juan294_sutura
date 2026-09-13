import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { DEFAULT_REPAIR_BUDGET_LIMITS } from '../engine/repair-budget.js';
import { DEFAULT_SEARCH_LIMITS } from '../engine/search.js';
import {
  REPLAY_BUNDLE_SCHEMA_VERSION,
  type RecordedBody,
  type ReplayBoundary,
  type ReplayBundle,
  type ReplayOverflowBoundary,
} from './bundle.js';

const SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const RUN_ID = /^[1-9]\d*$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const OUTCOMES = new Set(['fixed', 'flaky-no-patch', 'refused', 'gave-up', 'infra-stop']);
const HTTP_BOUNDARIES = new Set(['nebius', 'tavily', 'contree']);
const REPLAY_BOUNDARIES = new Set(['github', 'repository', 'executor', ...HTTP_BOUNDARIES]);
const REQUIRED_REPLAY_BOUNDARIES = new Set(['github', 'repository', 'executor', 'nebius', 'contree']);
const OVERFLOW_BOUNDARIES = new Set([...REPLAY_BOUNDARIES, 'http', 'configuration']);
const GITHUB_METHODS = new Set([
  'getWorkflowRun', 'listPullRequestsForCommit', 'getPullRequest',
  'listJobsForWorkflowRun', 'downloadJobLogs', 'listIssueComments',
  'listCommitComments', 'createRef', 'deleteRef', 'createIssueComment',
  'createCommitComment', 'updateIssueComment', 'updateCommitComment',
  'getRefSha', 'getCommitParents', 'getCommitSha', 'createPullRequest',
  'listCheckRunsForRef', 'createCheckRun', 'updateCheckRun',
]);
const REPOSITORY_METHODS = new Set([
  'checkoutHead', 'readPolicyAtSha', 'readSourceExcerpts', 'publishFix', 'freezeSource',
]);
const EXECUTOR_METHODS = new Set([
  'importImage', 'snapshot', 'run', 'runMany', 'operationCapacity', 'cancel',
]);

export class ReplayValidationError extends Error {
  constructor(path: string, detail: string) {
    super(`${path} ${detail}`);
    this.name = 'ReplayValidationError';
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReplayValidationError(path, 'must be an object');
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new ReplayValidationError(path, `must be an array with at most ${maximum} entries`);
  }
  return value;
}

function string(value: unknown, path: string, maximum = 2_000_000): string {
  if (typeof value !== 'string' || value.length > maximum) {
    throw new ReplayValidationError(path, 'must be a bounded string');
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ReplayValidationError(path, 'must be boolean');
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ReplayValidationError(path, 'must be a positive integer');
  }
  return value as number;
}

function integer(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) throw new ReplayValidationError(path, 'must be an integer');
  return value as number;
}

function nonnegativeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ReplayValidationError(path, 'must be a finite nonnegative number');
  }
  return value;
}

function nullableString(value: unknown, path: string): void {
  if (value !== null) string(value, path);
}

function stringRecord(value: unknown, path: string): Record<string, string> {
  const record = object(value, path);
  for (const [key, item] of Object.entries(record)) string(item, `${path}.${key}`);
  return record as Record<string, string>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).toSorted();
  const expected = [...keys].toSorted();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function byteMetadata(record: Record<string, unknown>, path: string): void {
  const bytes = nonnegativeNumber(record.bytes, `${path}.bytes`);
  if (!Number.isSafeInteger(bytes)) throw new ReplayValidationError(`${path}.bytes`, 'must be an integer');
  if (!SHA256.test(string(record.sha256, `${path}.sha256`))) {
    throw new ReplayValidationError(`${path}.sha256`, 'must be SHA-256');
  }
}

function body(value: unknown, path: string): RecordedBody {
  if (value === null || typeof value === 'string') return value;
  const record = object(value, path);
  if (record.raw === true) {
    if (!exactKeys(record, ['raw', 'encoding', 'data', 'bytes', 'sha256']) ||
        record.encoding !== 'base64' || typeof record.data !== 'string') {
      throw new ReplayValidationError(path, 'must be a raw base64 body');
    }
    byteMetadata(record, path);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(record.data)) {
      throw new ReplayValidationError(`${path}.data`, 'must be canonical base64');
    }
    const bytes = Buffer.from(record.data, 'base64');
    if (bytes.byteLength !== record.bytes) {
      throw new ReplayValidationError(`${path}.bytes`, 'does not match decoded base64 bytes');
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== record.sha256) {
      throw new ReplayValidationError(`${path}.sha256`, 'does not match decoded base64 bytes');
    }
    return record as unknown as RecordedBody;
  }
  for (const marker of ['truncated', 'binary', 'stream'] as const) {
    if (record[marker] === true && exactKeys(record, [marker, 'bytes', 'sha256'])) {
      byteMetadata(record, path);
      return record as unknown as RecordedBody;
    }
  }
  throw new ReplayValidationError(path, 'must be a recorded body');
}

function validateRecordedError(value: unknown, path: string): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!Object.hasOwn(record, 'error')) return false;
  if (!exactKeys(record, ['error'])) {
    throw new ReplayValidationError(`${path}.error`, 'must be the only result field');
  }
  const error = object(record.error, `${path}.error`);
  const allowed = new Set(['message', 'name', 'status']);
  const unknown = Object.keys(error).find((key) => !allowed.has(key));
  if (unknown) throw new ReplayValidationError(`${path}.error.${unknown}`, 'is unknown');
  string(error.message, `${path}.error.message`);
  string(error.name, `${path}.error.name`);
  if (Object.hasOwn(error, 'status') &&
      (typeof error.status !== 'number' || !Number.isFinite(error.status))) {
    throw new ReplayValidationError(`${path}.error.status`, 'must be a finite number');
  }
  return true;
}

function validateRunResult(value: unknown, path: string): void {
  const result = object(value, path);
  string(result.imageId, `${path}.imageId`);
  integer(result.exitCode, `${path}.exitCode`);
  string(result.stdout, `${path}.stdout`);
  string(result.stderr, `${path}.stderr`);
  boolean(result.truncated, `${path}.truncated`);
  const metrics = object(result.metrics, `${path}.metrics`);
  for (const [key, metric] of Object.entries(metrics)) nonnegativeNumber(metric, `${path}.metrics.${key}`);
  if (result.operation !== undefined) {
    const operation = object(result.operation, `${path}.operation`);
    string(operation.operationId, `${path}.operation.operationId`);
    if (!new Set(['succeeded', 'failed', 'cancelled']).has(operation.terminal as string)) {
      throw new ReplayValidationError(`${path}.operation.terminal`, 'is unknown');
    }
    boolean(operation.cancellationRequested, `${path}.operation.cancellationRequested`);
  }
}

function validateExecutorResult(method: string, value: unknown, path: string): void {
  if (validateRecordedError(value, path)) return;
  if (method === 'importImage' || method === 'snapshot') {
    string(value, path);
  } else if (method === 'run') {
    validateRunResult(value, path);
  } else if (method === 'runMany') {
    array(value, path, 10_000).forEach((item, index) => validateRunResult(item, `${path}[${index}]`));
  } else if (method === 'operationCapacity') {
    const capacity = object(value, path);
    for (const key of ['limit', 'active', 'available']) nonnegativeNumber(capacity[key], `${path}.${key}`);
  } else if (method === 'cancel') {
    const cancellation = object(value, path);
    string(cancellation.operationId, `${path}.operationId`);
    boolean(cancellation.requested, `${path}.requested`);
    if (cancellation.terminal !== undefined &&
        !new Set(['succeeded', 'failed', 'cancelled']).has(cancellation.terminal as string)) {
      throw new ReplayValidationError(`${path}.terminal`, 'is unknown');
    }
  }
}

function validateWorkflowRun(value: unknown, path: string): void {
  const run = object(value, path);
  positiveInteger(run.id, `${path}.id`);
  if (!SHA.test(string(run.headSha, `${path}.headSha`))) throw new ReplayValidationError(`${path}.headSha`, 'must be SHA');
  if (!REPOSITORY.test(string(run.repository, `${path}.repository`))) throw new ReplayValidationError(`${path}.repository`, 'must use owner/repo');
  string(run.event, `${path}.event`);
  nullableString(run.conclusion, `${path}.conclusion`);
  if (run.headBranch !== undefined) nullableString(run.headBranch, `${path}.headBranch`);
  array(run.pullRequests, `${path}.pullRequests`, 10_000).forEach((item, index) => {
    positiveInteger(object(item, `${path}.pullRequests[${index}]`).number, `${path}.pullRequests[${index}].number`);
  });
}

function validateGitHubResult(method: string, value: unknown, path: string): void {
  if (validateRecordedError(value, path)) return;
  if (method === 'getWorkflowRun') {
    validateWorkflowRun(value, path);
  } else if (method === 'listPullRequestsForCommit') {
    array(value, path, 10_000).forEach((item, index) => positiveInteger(object(item, `${path}[${index}]`).number, `${path}[${index}].number`));
  } else if (method === 'getPullRequest') {
    const pull = object(value, path);
    positiveInteger(pull.number, `${path}.number`);
    for (const key of ['headSha', 'headRef', 'baseSha', 'baseRef']) string(pull[key], `${path}.${key}`);
    nullableString(pull.headRepo, `${path}.headRepo`);
  } else if (method === 'listJobsForWorkflowRun') {
    array(value, path, 10_000).forEach((item, index) => {
      const jobPath = `${path}[${index}]`;
      const job = object(item, jobPath);
      positiveInteger(job.id, `${jobPath}.id`);
      string(job.name, `${jobPath}.name`);
      nullableString(job.conclusion, `${jobPath}.conclusion`);
      array(job.steps, `${jobPath}.steps`, 10_000).forEach((stepValue, stepIndex) => {
        const stepPath = `${jobPath}.steps[${stepIndex}]`;
        const step = object(stepValue, stepPath);
        string(step.name, `${stepPath}.name`);
        nullableString(step.conclusion, `${stepPath}.conclusion`);
        nullableString(step.startedAt, `${stepPath}.startedAt`);
        nullableString(step.completedAt, `${stepPath}.completedAt`);
      });
    });
  } else if (method === 'downloadJobLogs' || method === 'getRefSha' || method === 'getCommitSha') {
    string(value, path);
  } else if (method === 'listIssueComments' || method === 'listCommitComments') {
    array(value, path, 10_000).forEach((item, index) => {
      const commentPath = `${path}[${index}]`;
      const comment = object(item, commentPath);
      positiveInteger(comment.id, `${commentPath}.id`);
      nullableString(comment.body, `${commentPath}.body`);
      nullableString(comment.authorLogin, `${commentPath}.authorLogin`);
    });
  } else if (method === 'getCommitParents') {
    array(value, path, 10_000).forEach((sha, index) => {
      if (!SHA.test(string(sha, `${path}[${index}]`))) throw new ReplayValidationError(`${path}[${index}]`, 'must be SHA');
    });
  } else if (method === 'listCheckRunsForRef') {
    array(value, path, 10_000).forEach((item, index) => {
      const checkPath = `${path}[${index}]`;
      const check = object(item, checkPath);
      positiveInteger(check.id, `${checkPath}.id`);
      for (const key of ['headSha', 'name', 'status']) string(check[key], `${checkPath}.${key}`);
      nullableString(check.externalId, `${checkPath}.externalId`);
      nullableString(check.conclusion, `${checkPath}.conclusion`);
    });
  } else if (method === 'createIssueComment' || method === 'createCommitComment' || method === 'createCheckRun') {
    positiveInteger(object(value, path).id, `${path}.id`);
  } else if (method === 'createPullRequest') {
    const pull = object(value, path);
    positiveInteger(pull.number, `${path}.number`);
    string(pull.url, `${path}.url`);
  } else if (value !== null) {
    throw new ReplayValidationError(path, `must be null for ${method}`);
  }
}

function validateRepositoryResult(method: string, value: unknown, path: string): void {
  if (validateRecordedError(value, path)) return;
  if (method === 'freezeSource') {
    const frozen = object(value, path);
    if (Object.keys(frozen).some(key => key !== 'sourceDir' && key !== 'snapshotSha256') ||
        !/^checkout-[1-9]\d*$/u.test(string(frozen.sourceDir, `${path}.sourceDir`)) ||
        !/^[a-f0-9]{64}$/u.test(string(frozen.snapshotSha256, `${path}.snapshotSha256`))) {
      throw new ReplayValidationError(path, 'must contain an exact recorded frozen source identity');
    }
  } else if (method === 'readPolicyAtSha') {
    if (value !== null) string(value, path);
  } else if (method === 'checkoutHead') {
    const checkout = object(value, path);
    if (!/^checkout-[1-9]\d*$/u.test(string(checkout.checkoutId, `${path}.checkoutId`))) {
      throw new ReplayValidationError(`${path}.checkoutId`, 'must be a logical checkout id');
    }
    const snapshot = object(checkout.snapshot, `${path}.snapshot`);
    array(snapshot.runtimeEvidencePaths, `${path}.snapshot.runtimeEvidencePaths`, 10_000)
      .forEach((item, index) => string(item, `${path}.snapshot.runtimeEvidencePaths[${index}]`));
    array(snapshot.files, `${path}.snapshot.files`, 10_000).forEach((item, index) => {
      const filePath = `${path}.snapshot.files[${index}]`;
      const file = object(item, filePath);
      string(file.path, `${filePath}.path`);
      string(file.content, `${filePath}.content`);
    });
  } else if (method === 'readSourceExcerpts') {
    array(value, path, 10_000).forEach((item, index) => {
      const excerptPath = `${path}[${index}]`;
      const excerpt = object(item, excerptPath);
      string(excerpt.path, `${excerptPath}.path`);
      positiveInteger(excerpt.startLine, `${excerptPath}.startLine`);
      string(excerpt.content, `${excerptPath}.content`);
      boolean(excerpt.truncated, `${excerptPath}.truncated`);
      if (excerpt.boundaryComplete !== undefined) boolean(excerpt.boundaryComplete, `${excerptPath}.boundaryComplete`);
    });
  } else if (value !== null) {
    throw new ReplayValidationError(path, 'must be null for publishFix');
  }
}

function sequenceRecords(
  value: unknown,
  path: string,
  maximum: number,
  methods: ReadonlySet<string>,
  validateResult: (method: string, value: unknown, path: string) => void,
): Array<Record<string, unknown>> {
  return array(value, path, maximum).map((item, index) => {
    const recordPath = `${path}[${index}]`;
    const record = object(item, recordPath);
    positiveInteger(record.sequence, `${recordPath}.sequence`);
    const method = string(record.method, `${recordPath}.method`);
    if (!methods.has(method)) throw new ReplayValidationError(`${recordPath}.method`, 'is unknown');
    array(record.args, `${recordPath}.args`, 10_000);
    if (!Object.hasOwn(record, 'result')) throw new ReplayValidationError(`${recordPath}.result`, 'is required');
    validateResult(method, record.result, `${recordPath}.${method}.result`);
    return record;
  });
}

function assertSequenceDomain(
  records: readonly Record<string, unknown>[],
  domain: string,
  complete: boolean,
): void {
  const sequences = records.map(({ sequence }) => sequence as number).toSorted((left, right) => left - right);
  if (new Set(sequences).size !== sequences.length) {
    throw new ReplayValidationError(`bundle.${domain}`, `contains a duplicate ${domain} sequence`);
  }
  if (complete && sequences.some((sequence, index) => sequence !== index + 1)) {
    throw new ReplayValidationError(`bundle.${domain}`, 'sequence is incomplete');
  }
}

function isIncompleteMarker(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (['truncated', 'binary', 'stream'].some((marker) =>
    record[marker] === true && exactKeys(record, [marker, 'bytes', 'sha256']))) return true;
  return Object.values(record).some((item) => isIncompleteMarker(item, seen));
}

function boundedPositiveNumber(
  value: unknown,
  path: string,
  maximum: number,
  integerRequired: boolean,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new ReplayValidationError(path, `must be greater than 0 and at most ${maximum}`);
  }
  if (integerRequired && !Number.isSafeInteger(value)) {
    throw new ReplayValidationError(path, 'must be an integer');
  }
  return value;
}

function validateRepairBudgets(value: unknown, path: string): void {
  const budgets = object(value, path);
  const limits = Object.entries(DEFAULT_REPAIR_BUDGET_LIMITS) as Array<
    [keyof typeof DEFAULT_REPAIR_BUDGET_LIMITS, number]
  >;
  const allowed = new Set(limits.map(([key]) => key));
  const unknown = Object.keys(budgets).find((key) => !allowed.has(key as keyof typeof DEFAULT_REPAIR_BUDGET_LIMITS));
  if (unknown) throw new ReplayValidationError(`${path}.${unknown}`, 'is unknown');
  for (const [key, maximum] of limits) {
    if (budgets[key] === undefined) continue;
    boundedPositiveNumber(
      budgets[key],
      `${path}.${key}`,
      maximum,
      key !== 'inferenceCostUsd',
    );
  }
}

function validateSearch(value: unknown, path: string): void {
  const search = object(value, path);
  const keys = ['initialBranches', 'beamWidth', 'maximumDepth', 'maximumTotalBranches'] as const;
  const unknown = Object.keys(search).find((key) => !keys.includes(key as typeof keys[number]));
  if (unknown) throw new ReplayValidationError(`${path}.${unknown}`, 'is unknown');
  for (const key of keys) {
    const maximum = key === 'maximumDepth'
      ? DEFAULT_SEARCH_LIMITS.maximumDepth
      : DEFAULT_SEARCH_LIMITS.maximumTotalBranches;
    boundedPositiveNumber(search[key], `${path}.${key}`, maximum, true);
  }
  const maximumTotalBranches = search.maximumTotalBranches as number;
  for (const key of ['initialBranches', 'beamWidth'] as const) {
    if ((search[key] as number) > maximumTotalBranches) {
      throw new ReplayValidationError(`${path}.${key}`, 'must not exceed maximumTotalBranches');
    }
  }
}

export function parseReplayBundle(value: unknown): ReplayBundle {
  const bundle = object(value, 'bundle');
  if (bundle.schemaVersion !== REPLAY_BUNDLE_SCHEMA_VERSION) throw new ReplayValidationError('bundle.schemaVersion', 'is unsupported');
  if (!RUN_ID.test(string(bundle.runId, 'bundle.runId'))) throw new ReplayValidationError('bundle.runId', 'must be a positive decimal id');
  if (!REPOSITORY.test(string(bundle.repo, 'bundle.repo'))) throw new ReplayValidationError('bundle.repo', 'must use owner/repo format');
  if (!SHA.test(string(bundle.actionSha, 'bundle.actionSha'))) throw new ReplayValidationError('bundle.actionSha', 'must be an exact lowercase SHA');
  const capturedAt = string(bundle.capturedAt, 'bundle.capturedAt');
  if (!capturedAt.endsWith('Z') || !Number.isFinite(Date.parse(capturedAt))) throw new ReplayValidationError('bundle.capturedAt', 'must be an ISO UTC timestamp');

  const github = sequenceRecords(bundle.github, 'bundle.github', 256, GITHUB_METHODS, validateGitHubResult);
  const repository = sequenceRecords(bundle.repository, 'bundle.repository', 256, REPOSITORY_METHODS, validateRepositoryResult);
  const executor = sequenceRecords(bundle.executor, 'bundle.executor', 512, EXECUTOR_METHODS, validateExecutorResult);
  const http = array(bundle.http, 'bundle.http', 512).map((item, index) => {
    const exchangePath = `bundle.http[${index}]`;
    const exchange = object(item, exchangePath);
    positiveInteger(exchange.sequence, `${exchangePath}.sequence`);
    if (!HTTP_BOUNDARIES.has(exchange.boundary as string)) throw new ReplayValidationError(`${exchangePath}.boundary`, 'is unknown');
    const request = object(exchange.request, `${exchangePath}.request`);
    string(request.method, `${exchangePath}.request.method`);
    string(request.url, `${exchangePath}.request.url`);
    stringRecord(request.headers, `${exchangePath}.request.headers`);
    body(request.body, `${exchangePath}.request.body`);
    const response = object(exchange.response, `${exchangePath}.response`);
    if (Object.hasOwn(response, 'transportError')) {
      if (!exactKeys(response, ['transportError'])) throw new ReplayValidationError(`${exchangePath}.response`, 'has conflicting transport fields');
      string(response.transportError, `${exchangePath}.response.transportError`);
    } else {
      const status = nonnegativeNumber(response.status, `${exchangePath}.response.status`);
      if (!Number.isSafeInteger(status) || status > 599) throw new ReplayValidationError(`${exchangePath}.response.status`, 'must be an HTTP status');
      stringRecord(response.headers, `${exchangePath}.response.headers`);
      body(response.body, `${exchangePath}.response.body`);
    }
    nonnegativeNumber(exchange.latencyMs, `${exchangePath}.latencyMs`);
    return exchange;
  });

  const config = object(bundle.configuration, 'bundle.configuration');
  positiveInteger(config.triageN, 'bundle.configuration.triageN');
  positiveInteger(config.raceK, 'bundle.configuration.raceK');
  positiveInteger(config.maxOps, 'bundle.configuration.maxOps');
  string(config.routingProfileId, 'bundle.configuration.routingProfileId');
  const models = object(config.models, 'bundle.configuration.models');
  for (const tier of ['nano', 'super', 'ultra']) string(models[tier], `bundle.configuration.models.${tier}`);
  if (config.runtimeId !== undefined && config.runtimeId !== 'node' && config.runtimeId !== 'python') {
    throw new ReplayValidationError('bundle.configuration.runtimeId', 'is unknown');
  }
  if (
    config.sourceReferenceOrder !== undefined &&
    config.sourceReferenceOrder !== 'first' &&
    config.sourceReferenceOrder !== 'latest'
  ) {
    throw new ReplayValidationError('bundle.configuration.sourceReferenceOrder', 'is unknown');
  }
  if (
    config.repairVerificationScope !== undefined &&
    config.repairVerificationScope !== 'full' &&
    config.repairVerificationScope !== 'failing-workspace'
  ) {
    throw new ReplayValidationError('bundle.configuration.repairVerificationScope', 'is unknown');
  }
  if (config.imageRef !== undefined) string(config.imageRef, 'bundle.configuration.imageRef');
  if (config.repairBudgets !== undefined) {
    validateRepairBudgets(config.repairBudgets, 'bundle.configuration.repairBudgets');
  }
  if (config.search !== undefined) {
    validateSearch(config.search, 'bundle.configuration.search');
  }

  const completeness = object(bundle.completeness, 'bundle.completeness');
  const complete = boolean(completeness.complete, 'bundle.completeness.complete');
  const overflowed = array(completeness.overflowedBoundaries, 'bundle.completeness.overflowedBoundaries', 8) as ReplayOverflowBoundary[];
  const pending = array(completeness.pendingBoundaries, 'bundle.completeness.pendingBoundaries', 6) as ReplayBoundary[];
  if (overflowed.some((item) => !OVERFLOW_BOUNDARIES.has(item))) throw new ReplayValidationError('bundle.completeness.overflowedBoundaries', 'contains an unknown boundary');
  if (pending.some((item) => !REPLAY_BOUNDARIES.has(item))) throw new ReplayValidationError('bundle.completeness.pendingBoundaries', 'contains an unknown boundary');
  if (complete && (overflowed.length > 0 || pending.length > 0)) throw new ReplayValidationError('bundle.completeness', 'is internally inconsistent');

  if (complete) {
    const completed = new Set<ReplayBoundary>([
      ...(github.length > 0 ? ['github' as const] : []),
      ...(repository.length > 0 ? ['repository' as const] : []),
      ...(executor.length > 0 ? ['executor' as const] : []),
      ...http.map(({ boundary }) => boundary as ReplayBoundary),
    ]);
    const missing = [...REQUIRED_REPLAY_BOUNDARIES]
      .filter((boundary) => !completed.has(boundary as ReplayBoundary));
    if (missing.length > 0) throw new ReplayValidationError('bundle.completeness', `is missing completed ${missing.join(', ')} streams`);
    const replayedEvidence = {
      github,
      repository,
      executor,
      http: http.filter(({ boundary }) => boundary !== 'contree'),
    };
    if (isIncompleteMarker(replayedEvidence)) throw new ReplayValidationError('bundle.completeness', 'contains truncated or unreplayable body evidence');
  }
  assertSequenceDomain([...github, ...repository], 'port', complete);
  assertSequenceDomain(http, 'http', complete);
  assertSequenceDomain(executor, 'executor', complete);
  if (bundle.outcome !== undefined && !OUTCOMES.has(bundle.outcome as string)) throw new ReplayValidationError('bundle.outcome', 'is unknown');
  if (complete && bundle.outcome === undefined) throw new ReplayValidationError('bundle.outcome', 'is required for a complete bundle');
  return value as ReplayBundle;
}
