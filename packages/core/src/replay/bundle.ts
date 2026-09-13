import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import type { CaseFile } from '../domain.js';
import type { SearchLimits } from '../config.js';
import type { RepairBudgetOverrides } from '../engine/repair-budget.js';
import type { Executor } from '../executor/types.js';
import type { ModelTier } from '../llm/cost.js';
import type { RepositoryPort } from '../orchestrate.js';
import type { RuntimeId } from '../runtime/types.js';
import type { RepairVerificationScope } from '../heal.js';
import type { SourceReferenceOrder } from '../orchestrate.js';
import { redactExternalText } from '../security/external-text.js';

export const REPLAY_BUNDLE_SCHEMA_VERSION = 'sutura-replay-v1' as const;

const MAX_BODY_BYTES = 1 * 1_024 * 1_024;
const MAX_HTTP_EXCHANGES = 512;
const MAX_PORT_CALLS = 256;
const MAX_EXECUTOR_CALLS = 512;
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
]);

export interface TruncatedBody {
  truncated: true;
  bytes: number;
  sha256: string;
}

export interface BinaryBody {
  binary: true;
  bytes: number;
  sha256: string;
}

export interface StreamBody {
  stream: true;
  bytes: number;
  sha256: string;
}

export interface RawBody {
  raw: true;
  encoding: 'base64';
  data: string;
  bytes: number;
  sha256: string;
}

export type RecordedBody =
  | string
  | null
  | TruncatedBody
  | BinaryBody
  | StreamBody
  | RawBody;

export type RecordedHttpBoundary = 'nebius' | 'tavily' | 'contree';
export type ReplayBoundary =
  | 'github'
  | 'repository'
  | 'executor'
  | RecordedHttpBoundary;
export type ReplayOverflowBoundary = ReplayBoundary | 'http' | 'configuration';

export interface RecordedHttpExchange {
  boundary: RecordedHttpBoundary;
  sequence: number;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: RecordedBody;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    body: RecordedBody;
  } | { transportError: string };
  latencyMs: number;
}

export interface RecordedErrorDetails {
  message: string;
  name: string;
  status?: number;
}

export interface RecordedError {
  error: RecordedErrorDetails;
}

export interface RecordedGitHubCall {
  sequence: number;
  method: string;
  args: unknown[];
  result: unknown | RecordedError;
}

export interface RecordedRepositoryCall {
  sequence: number;
  method: keyof RepositoryPort;
  args: unknown[];
  result: unknown | RecordedError;
}

export interface RecordedExecutorCall {
  sequence: number;
  method: keyof Executor;
  args: unknown[];
  result: unknown | RecordedError;
}

export interface ReplayOrchestrationConfig {
  triageN: number;
  raceK: number;
  repairBudgets?: RepairBudgetOverrides;
  search?: SearchLimits;
  runtimeId?: RuntimeId;
  imageRef?: string;
  models: Readonly<Record<ModelTier, string>>;
  routingProfileId: string;
  maxOps: number;
  sourceReferenceOrder?: SourceReferenceOrder;
  repairVerificationScope?: RepairVerificationScope;
}

export interface ReplayBundle {
  schemaVersion: typeof REPLAY_BUNDLE_SCHEMA_VERSION;
  runId: string;
  repo: string;
  actionSha: string;
  capturedAt: string;
  github: RecordedGitHubCall[];
  repository: RecordedRepositoryCall[];
  executor: RecordedExecutorCall[];
  http: RecordedHttpExchange[];
  configuration: ReplayOrchestrationConfig;
  completeness: {
    complete: boolean;
    overflowedBoundaries: ReplayOverflowBoundary[];
    pendingBoundaries: ReplayBoundary[];
  };
  outcome?: CaseFile['outcome'];
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function boundedText(value: string): string | TruncatedBody {
  const bytes = Buffer.byteLength(value, 'utf8');
  return bytes <= MAX_BODY_BYTES
    ? value
    : { truncated: true, bytes, sha256: sha256(value) };
}

export function binaryBody(
  value: Uint8Array,
  kind: 'binary' | 'stream' = 'binary',
): BinaryBody | StreamBody {
  const metadata = { bytes: value.byteLength, sha256: sha256(value) };
  return kind === 'stream'
    ? { stream: true, ...metadata }
    : { binary: true, ...metadata };
}

export function rawBody(value: Uint8Array): RawBody | TruncatedBody {
  const metadata = { bytes: value.byteLength, sha256: sha256(value) };
  return value.byteLength <= MAX_BODY_BYTES
    ? {
        raw: true,
        encoding: 'base64',
        data: Buffer.from(value).toString('base64'),
        ...metadata,
      }
    : { truncated: true, ...metadata };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redactString(value: string, secrets: readonly string[]): string | TruncatedBody {
  const bounded = boundedText(value);
  if (typeof bounded !== 'string') return bounded;
  let redacted = redactExternalText(bounded).text;
  for (const secret of secrets) {
    if (secret) redacted = redacted.replaceAll(secret, '[redacted secret]');
  }
  return redacted;
}

function redactScalar(value: string, secrets: readonly string[]): string {
  const redacted = redactString(value, secrets);
  return typeof redacted === 'string' ? redacted : '[truncated]';
}

function redactHeaders(
  headers: Readonly<Record<string, string>>,
  secrets: readonly string[],
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (SENSITIVE_HEADERS.has(name)) continue;
    safe[name] = redactScalar(String(rawValue), secrets);
  }
  return safe;
}

interface SafeJsonValue {
  value: unknown;
  lossy: boolean;
}

function normalizedString(
  value: string,
  secrets: readonly string[],
  checkoutPaths: ReadonlyMap<string, string>,
): string | TruncatedBody {
  let normalized = value;
  for (const [checkoutDir, recordedPath] of checkoutPaths) {
    if (normalized === checkoutDir) {
      normalized = recordedPath;
      break;
    }
    if (normalized.startsWith(`${checkoutDir}/`)) {
      normalized = `${recordedPath}${normalized.slice(checkoutDir.length)}`;
      break;
    }
  }
  return redactString(normalized, secrets);
}

function safeJsonValue(
  value: unknown,
  secrets: readonly string[],
  checkoutPaths: ReadonlyMap<string, string> = new Map(),
  seen = new WeakSet<object>(),
  depth = 0,
): SafeJsonValue {
  if (typeof value === 'string') {
    const sanitized = normalizedString(value, secrets, checkoutPaths);
    return { value: sanitized, lossy: typeof sanitized !== 'string' };
  }
  if (value === null || typeof value === 'boolean') return { value, lossy: false };
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { value, lossy: false }
      : { value: String(value), lossy: true };
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return {
      value: normalizedString(String(value), secrets, checkoutPaths),
      lossy: true,
    };
  }
  // Optional call arguments are represented as null in the replay JSON. This
  // matches JSON array semantics and does not discard a supplied value.
  if (value === undefined) return { value: null, lossy: false };
  if (depth >= 32) return { value: '[maximum replay depth]', lossy: true };
  if (value instanceof Error) {
    return {
      value: { error: redactString(value.message, secrets) },
      lossy: true,
    };
  }
  if (value instanceof Date) {
    try {
      return { value: value.toISOString(), lossy: false };
    } catch (error) {
      return {
        value: { error: redactString(errorMessage(error), secrets) },
        lossy: true,
      };
    }
  }
  if (typeof value !== 'object') return { value: String(value), lossy: true };
  if (seen.has(value)) return { value: '[circular]', lossy: true };
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      let lossy = value.length > 10_000;
      const sanitized = value.slice(0, 10_000).map((item) => {
        const result = safeJsonValue(item, secrets, checkoutPaths, seen, depth + 1);
        lossy ||= result.lossy;
        return result.value;
      });
      return { value: sanitized, lossy };
    }
    const sourceEntries = Object.entries(value);
    const prototype = Object.getPrototypeOf(value) as unknown;
    let lossy = sourceEntries.length > 10_000;
    lossy ||= prototype !== Object.prototype && prototype !== null;
    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of sourceEntries.slice(0, 10_000)) {
      const safeKeyValue = normalizedString(key, secrets, checkoutPaths);
      let safeKey = typeof safeKeyValue === 'string'
        ? safeKeyValue
        : `[truncated key ${safeKeyValue.sha256}]`;
      lossy ||= typeof safeKeyValue !== 'string';
      if (Object.hasOwn(sanitized, safeKey)) {
        lossy = true;
        const base = safeKey;
        let collision = 2;
        do {
          safeKey = `${base} [collision ${collision}]`;
          collision += 1;
        } while (Object.hasOwn(sanitized, safeKey));
      }
      const result = safeJsonValue(item, secrets, checkoutPaths, seen, depth + 1);
      lossy ||= result.lossy;
      sanitized[safeKey] = result.value;
    }
    return { value: sanitized, lossy };
  } catch (error) {
    return {
      value: { error: redactString(errorMessage(error), secrets) },
      lossy: true,
    };
  } finally {
    seen.delete(value);
  }
}

function redactBody(body: RecordedBody, secrets: readonly string[]): RecordedBody {
  if (typeof body === 'string') return redactString(body, secrets);
  if (body === null || !('raw' in body)) return body;
  let bytes = Buffer.from(body.data, 'base64');
  let byteString = bytes.toString('latin1');
  for (const secret of secrets) {
    if (!secret) continue;
    byteString = byteString.replaceAll(
      Buffer.from(secret, 'utf8').toString('latin1'),
      '[redacted secret]',
    );
  }
  bytes = Buffer.from(byteString, 'latin1');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const redacted = redactString(text, secrets);
    return typeof redacted === 'string'
      ? rawBody(new TextEncoder().encode(redacted))
      : redacted;
  } catch {
    return { truncated: true, bytes: bytes.byteLength, sha256: sha256(bytes) };
  }
}

function isTruncatedBody(value: object): value is TruncatedBody {
  const candidate = value as Partial<TruncatedBody>;
  const keys = Object.keys(value).toSorted();
  return keys.length === 3 && keys[0] === 'bytes' && keys[1] === 'sha256' &&
    keys[2] === 'truncated' && candidate.truncated === true &&
    typeof candidate.bytes === 'number' && Number.isSafeInteger(candidate.bytes) &&
    candidate.bytes >= 0 && typeof candidate.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(candidate.sha256);
}

function containsTruncation(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (isTruncatedBody(value)) return true;
  try {
    return Object.values(value).some((item) => containsTruncation(item, seen));
  } catch {
    return true;
  }
}

export function redactBundle(
  bundle: ReplayBundle,
  secrets: readonly string[] = [],
): ReplayBundle {
  return safeJsonValue(bundle, secrets).value as ReplayBundle;
}

export class ReplayRecorder {
  private readonly http: RecordedHttpExchange[] = [];
  private readonly github: RecordedGitHubCall[] = [];
  private readonly repository: RecordedRepositoryCall[] = [];
  private readonly executor: RecordedExecutorCall[] = [];
  private readonly configuration: ReplayOrchestrationConfig;
  private readonly checkoutPaths = new Map<string, string>();
  private readonly overflowedBoundaries = new Set<ReplayOverflowBoundary>();
  private readonly pending = {
    http: new Set<number>(),
    ports: new Set<number>(),
    executor: new Set<number>(),
  };
  private readonly pendingHttpBoundaries = new Map<number, RecordedHttpBoundary>();
  private readonly pendingPortBoundaries = new Map<number, 'github' | 'repository'>();
  private httpSequence = 0;
  private portSequence = 0;
  private executorSequence = 0;

  readonly runId: string;
  readonly repo: string;
  readonly actionSha: string;

  constructor(
    runId: string,
    repo: string,
    actionSha: string,
    configuration: ReplayOrchestrationConfig,
    private readonly secrets: readonly string[] = [],
  ) {
    const safeConfig = safeJsonValue(
      configuration,
      this.secrets,
    );
    this.configuration = safeConfig.value as ReplayOrchestrationConfig;
    if (safeConfig.lossy) this.markOverflow('configuration');
    this.runId = redactScalar(runId, this.secrets);
    this.repo = redactScalar(repo, this.secrets);
    this.actionSha = redactScalar(actionSha, this.secrets);
  }

  reserveHttpSequence(boundary: RecordedHttpBoundary): number | null {
    const sequence = this.reserveSequence('http', MAX_HTTP_EXCHANGES);
    if (sequence !== null) this.pendingHttpBoundaries.set(sequence, boundary);
    return sequence;
  }

  reservePortSequence(boundary: 'github' | 'repository' = 'github'): number | null {
    const sequence = this.reserveSequence('ports', MAX_PORT_CALLS, boundary);
    if (sequence !== null) this.pendingPortBoundaries.set(sequence, boundary);
    return sequence;
  }

  reserveExecutorSequence(): number | null {
    return this.reserveSequence('executor', MAX_EXECUTOR_CALLS);
  }

  private reserveSequence(
    boundary: 'http' | 'ports' | 'executor',
    maximum: number,
    overflowBoundary: ReplayOverflowBoundary = boundary === 'ports'
      ? 'github'
      : boundary,
  ): number | null {
    const sequence = boundary === 'http'
      ? ++this.httpSequence
      : boundary === 'ports'
        ? ++this.portSequence
        : ++this.executorSequence;
    if (sequence > maximum) {
      this.markOverflow(overflowBoundary);
      return null;
    }
    this.pending[boundary].add(sequence);
    return sequence;
  }

  markOverflow(boundary: ReplayOverflowBoundary): void {
    this.overflowedBoundaries.add(boundary);
  }

  registerCheckoutPath(checkoutDir: string): string {
    const existing = this.checkoutPaths.get(checkoutDir);
    if (existing) return existing;
    const recordedPath = `checkout-${new Set(this.checkoutPaths.values()).size + 1}`;
    this.checkoutPaths.set(checkoutDir, recordedPath);
    return recordedPath;
  }

  registerCheckoutAlias(aliasDir: string, checkoutDir: string): void {
    this.checkoutPaths.set(aliasDir, this.registerCheckoutPath(checkoutDir));
  }

  private safeValue(value: unknown, boundary: ReplayOverflowBoundary): unknown {
    const result = safeJsonValue(value, this.secrets, this.checkoutPaths);
    if (result.lossy) this.markOverflow(boundary);
    return result.value;
  }

  recordHttp(
    exchange: Omit<RecordedHttpExchange, 'sequence'>,
    reservedSequence?: number | null,
  ): void {
    const sequence = reservedSequence === undefined
      ? this.reserveHttpSequence(exchange.boundary)
      : reservedSequence;
    if (sequence === null) return;
    try {
      const response = 'transportError' in exchange.response
        ? { transportError: redactScalar(exchange.response.transportError, this.secrets) }
        : {
            status: exchange.response.status,
            headers: redactHeaders(exchange.response.headers, this.secrets),
            body: redactBody(exchange.response.body, this.secrets),
          };
      const recorded = {
        boundary: exchange.boundary,
        sequence,
        request: {
          method: exchange.request.method,
          url: redactScalar(exchange.request.url, this.secrets),
          headers: redactHeaders(exchange.request.headers, this.secrets),
          body: redactBody(exchange.request.body, this.secrets),
        },
        response: response as RecordedHttpExchange['response'],
        latencyMs: Number.isFinite(exchange.latencyMs)
          ? Math.max(0, exchange.latencyMs)
          : 0,
      } satisfies RecordedHttpExchange;
      this.http.push(recorded);
      if (containsTruncation(recorded)) this.markOverflow('http');
    } catch {
      this.markOverflow('http');
    } finally {
      this.pending.http.delete(sequence);
      this.pendingHttpBoundaries.delete(sequence);
    }
  }

  recordGitHub(
    call: Omit<RecordedGitHubCall, 'sequence'>,
    reservedSequence?: number | null,
  ): void {
    this.recordPort('github', call, reservedSequence);
  }

  recordRepository(
    call: Omit<RecordedRepositoryCall, 'sequence'>,
    reservedSequence?: number | null,
  ): void {
    this.recordPort('repository', call, reservedSequence);
  }

  recordExecutor(
    call: Omit<RecordedExecutorCall, 'sequence'>,
    reservedSequence?: number | null,
  ): void {
    const sequence = reservedSequence === undefined
      ? this.reserveExecutorSequence()
      : reservedSequence;
    if (sequence === null) return;
    try {
      const recorded = {
        sequence,
        method: call.method,
        args: this.safeValue(call.args, 'executor') as unknown[],
        result: this.safeValue(call.result, 'executor'),
      };
      this.executor.push(recorded);
      if (containsTruncation(recorded)) this.markOverflow('executor');
    } catch {
      this.markOverflow('executor');
    } finally {
      this.pending.executor.delete(sequence);
    }
  }

  private recordPort(
    boundary: 'github',
    call: Omit<RecordedGitHubCall, 'sequence'>,
    reservedSequence?: number | null,
  ): void;
  private recordPort(
    boundary: 'repository',
    call: Omit<RecordedRepositoryCall, 'sequence'>,
    reservedSequence?: number | null,
  ): void;
  private recordPort(
    boundary: 'github' | 'repository',
    call: Omit<RecordedGitHubCall | RecordedRepositoryCall, 'sequence'>,
    reservedSequence?: number | null,
  ): void {
    const sequence = reservedSequence === undefined
      ? this.reservePortSequence(boundary)
      : reservedSequence;
    if (sequence === null) return;
    try {
      const recorded = {
        sequence,
        method: call.method,
        args: this.safeValue(call.args, boundary) as unknown[],
        result: this.safeValue(call.result, boundary),
      };
      if (boundary === 'github') {
        this.github.push(recorded as RecordedGitHubCall);
      } else {
        this.repository.push(recorded as RecordedRepositoryCall);
      }
      if (containsTruncation(recorded)) this.markOverflow(boundary);
    } catch {
      this.markOverflow(boundary);
    } finally {
      this.pending.ports.delete(sequence);
      this.pendingPortBoundaries.delete(sequence);
    }
  }

  finish(outcome: CaseFile['outcome']): ReplayBundle {
    const requiredBoundaries: readonly ReplayBoundary[] = [
      'github', 'repository', 'executor', 'nebius', 'contree',
    ];
    const completedBoundaries = new Set<ReplayBoundary>([
      ...(this.github.length > 0 ? ['github' as const] : []),
      ...(this.repository.length > 0 ? ['repository' as const] : []),
      ...(this.executor.length > 0 ? ['executor' as const] : []),
      ...this.http.map(({ boundary }) => boundary),
    ]);
    const unfinishedBoundaries = new Set<ReplayBoundary>([
      ...this.pendingHttpBoundaries.values(),
      ...this.pendingPortBoundaries.values(),
      ...(this.pending.executor.size > 0 ? ['executor' as const] : []),
    ]);
    const pendingBoundaries = requiredBoundaries.filter((boundary) =>
      !completedBoundaries.has(boundary) || unfinishedBoundaries.has(boundary),
    ).sort();
    const overflowedBoundaries = [...this.overflowedBoundaries].sort();
    const complete = overflowedBoundaries.length === 0 && pendingBoundaries.length === 0;
    const bundle: ReplayBundle = {
      schemaVersion: REPLAY_BUNDLE_SCHEMA_VERSION,
      runId: this.runId,
      repo: this.repo,
      actionSha: this.actionSha,
      capturedAt: new Date().toISOString(),
      github: this.github.toSorted((left, right) => left.sequence - right.sequence),
      repository: this.repository.toSorted((left, right) => left.sequence - right.sequence),
      executor: this.executor.toSorted((left, right) => left.sequence - right.sequence),
      http: this.http.toSorted((left, right) => left.sequence - right.sequence),
      configuration: this.configuration,
      completeness: {
        complete,
        overflowedBoundaries,
        pendingBoundaries,
      },
      outcome,
    };
    return bundle;
  }
}
