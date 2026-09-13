/// <reference types="node" />

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, readdir, readFile, readlink, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

import pLimit, { type LimitFunction } from 'p-limit';

import { shellQuote } from '../engine/shell.js';
import { isSensitiveRepositoryPath } from '../security/repository-path.js';
import {
  SNAPSHOT_CWD,
  type Executor,
  type CancellationResult,
  type ImageId,
  type OperationCapacity,
  type OperationCompletion,
  type OperationTerminal,
  type RunMetrics,
  type RunOptions,
  type RunResult,
  type SnapshotOptions,
  type SnapshotProfile,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.tokenfactory.nebius.com/sandboxes/v1/';
const DEFAULT_MAX_OPS = 40;
const DEFAULT_POLL_INTERVAL_MS = 500;
const MAX_POLL_INTERVAL_MS = 5_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_CANCEL_TIMEOUT_MS = 5_000;
const SNAPSHOT_PATH = '/tmp/sutura-snapshot.tar';
const SNAPSHOT_MANIFEST_PATH = '/tmp/sutura-repository-overlay.manifest';
const DEPENDENCY_MANIFEST_PATH = '/tmp/sutura-dependency-inputs.manifest';
const MAX_DEPENDENCY_CONTROL_BYTES = 1 * 1_024 * 1_024;
const MAX_DEPENDENCY_INPUT_FILE_BYTES = 32 * 1_024 * 1_024;
const LOCAL_DEPENDENCY_LIFECYCLE_SCRIPTS = new Set([
  'preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly',
]);
const MAX_PROCESS_STDERR_BYTES = 64 * 1_024;
const MAX_SNAPSHOT_FILES = 10_000;
const MAX_SNAPSHOT_SOURCE_BYTES = 256 * 1_024 * 1_024;
const MAX_SNAPSHOT_ARCHIVE_BYTES = 300 * 1_024 * 1_024;

interface StreamResponse {
  value?: unknown;
  encoding?: unknown;
  truncated?: unknown;
}

interface InstanceResources {
  cost?: unknown;
  elapsed_time?: unknown;
  max_rss?: unknown;
  system_cpu_time?: unknown;
  user_cpu_time?: unknown;
}

interface InstanceResultResponse {
  state?: {
    exit_code?: unknown;
  };
  stdout?: StreamResponse;
  stderr?: StreamResponse;
  resources?: InstanceResources;
}

interface OperationResponse {
  status?: unknown;
  error?: unknown;
  result_image_uuid?: unknown;
  metadata?: {
    result?: InstanceResultResponse | null;
  };
  result?: {
    image?: unknown;
  };
}

interface FileUploadResponse {
  uuid?: unknown;
}

interface SpawnBody {
  image: ImageId;
  command: string;
  shell: true;
  networking: { enabled: boolean };
  env?: Readonly<Record<string, string>>;
  timeout?: number;
  cwd?: string;
  files?: Record<
    string,
    { uuid: string; uid: number; gid: number; mode: string }
  >;
}

export interface ContreeExecutorConfig {
  token: string;
  project: string;
  baseUrl?: string;
  maxOps?: number;
  fetch?: typeof globalThis.fetch;
  pollIntervalMs?: number;
  operationTimeoutMs?: number;
  cancelTimeoutMs?: number;
}

export class ContreeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'ContreeError';
  }
}

export class ContreeExecutor implements Executor {
  readonly completions: OperationCompletion[] = [];
  private readonly baseUrl: URL;
  private readonly fetch: typeof globalThis.fetch;
  private readonly instanceLimit: LimitFunction;
  private readonly pollIntervalMs: number;
  private readonly operationTimeoutMs: number;
  private readonly cancelTimeoutMs: number;
  private readonly operationLimit: number;
  private readonly operations = new Map<string, {
    operationUrl?: string;
    cancellationRequested: boolean;
    started: boolean;
    terminal?: OperationTerminal;
  }>();

  constructor(private readonly config: ContreeExecutorConfig) {
    if (!config.token.trim()) throw new ContreeError('ConTree token is required');
    if (!config.project.trim()) {
      throw new ContreeError('ConTree project is required');
    }

    const maxOps = config.maxOps ?? DEFAULT_MAX_OPS;
    if (!Number.isSafeInteger(maxOps) || maxOps <= 0) {
      throw new ContreeError('ConTree maxOps must be a positive integer');
    }

    this.baseUrl = new URL(ensureTrailingSlash(config.baseUrl ?? DEFAULT_BASE_URL));
    this.fetch = config.fetch ?? globalThis.fetch;
    this.instanceLimit = pLimit(maxOps);
    this.operationLimit = maxOps;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.operationTimeoutMs =
      config.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
    this.cancelTimeoutMs = config.cancelTimeoutMs ?? DEFAULT_CANCEL_TIMEOUT_MS;
  }

  async importImage(ref: string): Promise<ImageId> {
    const response = await this.request('images/import', {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify({ registry: { url: registryUrl(ref) } }),
    });
    const operation = await this.poll(this.operationLocation(response));
    return operationImageId(operation);
  }

  async snapshot(
    dir: string,
    base: ImageId,
    options: SnapshotOptions,
  ): Promise<ImageId> {
    assertSnapshotOptions(options);
    const archive = await createSnapshotArchive(dir, options);
    let fileId: string;
    let manifestFileId: string | undefined;
    try {
      const body = Readable.toWeb(createReadStream(archive.path));
      const upload = await this.requestJson<FileUploadResponse>('files', {
        method: 'POST',
        headers: this.headers('application/octet-stream'),
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });
      fileId = requiredString(upload.uuid, 'file upload uuid');
      const manifestBody = Readable.toWeb(createReadStream(archive.manifestPath));
      const manifestUpload = await this.requestJson<FileUploadResponse>('files', {
        method: 'POST',
        headers: this.headers('application/octet-stream'),
        body: manifestBody,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });
      manifestFileId = requiredString(manifestUpload.uuid, 'manifest upload uuid');
    } finally {
      await archive.cleanup();
    }

    const result = await this.instanceLimit(() =>
      this.spawn({
        image: base,
        command: snapshotCommand(options),
        shell: true,
        networking: { enabled: false },
        files: {
          [SNAPSHOT_PATH]: {
            uuid: fileId,
            uid: 0,
            gid: 0,
            mode: '0600',
          },
          ...(manifestFileId
            ? {
                [options.profile === 'repository'
                  ? SNAPSHOT_MANIFEST_PATH
                  : DEPENDENCY_MANIFEST_PATH]: {
                  uuid: manifestFileId,
                  uid: 0,
                  gid: 0,
                  mode: '0600',
                },
              }
            : {}),
        },
      }),
    );
    if (result.exitCode !== 0) {
      throw new ContreeError(
        `ConTree snapshot extraction failed with exit code ${result.exitCode}: ${result.stderr}`,
      );
    }
    return result.imageId;
  }

  async run(
    parent: ImageId,
    cmd: string,
    opts: RunOptions = {},
  ): Promise<RunResult> {
    const body: SpawnBody = {
      image: parent,
      command: cmd,
      shell: true,
      networking: { enabled: opts.network === 'enabled' },
    };
    if (opts.env !== undefined) body.env = opts.env;
    if (opts.timeoutSec !== undefined) body.timeout = opts.timeoutSec;
    if (opts.cwd !== undefined) body.cwd = opts.cwd;

    const operationId = opts.operationId;
    if (operationId && this.operations.has(operationId)) {
      throw new ContreeError(`ConTree operation ID already exists: ${operationId}`);
    }
    if (operationId) {
      this.operations.set(operationId, { cancellationRequested: false, started: false });
    }
    return this.instanceLimit(() => this.spawn(body, operationId));
  }

  async runMany(
    parent: ImageId,
    cmds: string[],
    opts?: RunOptions,
  ): Promise<RunResult[]> {
    return Promise.all(cmds.map((cmd) => this.run(parent, cmd, opts)));
  }

  operationCapacity(): OperationCapacity {
    const active = this.instanceLimit.activeCount + this.instanceLimit.pendingCount;
    return { limit: this.operationLimit, active, available: Math.max(0, this.operationLimit - active) };
  }

  async cancel(operationId: string): Promise<CancellationResult> {
    const operation = this.operations.get(operationId);
    if (!operation || operation.terminal) {
      return {
        operationId,
        requested: false,
        ...(operation?.terminal === undefined ? {} : { terminal: operation.terminal }),
      };
    }
    if (operation.cancellationRequested) return { operationId, requested: false };
    operation.cancellationRequested = true;
    if (!operation.started) {
      operation.terminal = 'cancelled';
      this.completions.push({ operationId, terminal: 'cancelled', cancellationRequested: true });
      return { operationId, requested: true, terminal: 'cancelled' };
    }
    try {
      if (operation.operationUrl) await this.cancelRemote(operation.operationUrl);
    } catch (error) {
      operation.cancellationRequested = false;
      throw error;
    }
    return { operationId, requested: true };
  }

  private async spawn(body: SpawnBody, operationId?: string): Promise<RunResult> {
    const tracked = operationId === undefined ? undefined : this.operations.get(operationId);
    if (tracked?.terminal === 'cancelled') {
      throw new ContreeError(`ConTree operation ${operationId} was cancelled before it started`);
    }
    if (tracked) tracked.started = true;
    const response = await this.request('instances', {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(body),
    });
    const operationUrl = this.resolveOperationLocation(this.operationLocation(response));
    if (tracked) tracked.operationUrl = operationUrl;
    if (tracked?.cancellationRequested) {
      try {
        await this.cancelRemote(operationUrl);
      } catch {
        tracked.cancellationRequested = false;
      }
    }
    let operation: OperationResponse;
    try {
      operation = await this.poll(operationUrl);
    } catch (error) {
      if (tracked && operationId && !tracked.terminal) {
        tracked.terminal = error instanceof ContreeError && /ended with CANCELLED/u.test(error.message)
          ? 'cancelled'
          : 'failed';
        this.completions.push({ operationId, terminal: tracked.terminal, cancellationRequested: tracked.cancellationRequested });
      }
      throw error;
    }
    const result = operation.metadata?.result;
    if (!result) {
      throw new ContreeError(
        'ConTree operation succeeded without metadata.result',
      );
    }

    const runResult = {
      imageId: operationImageId(operation),
      exitCode: requiredNumber(result.state?.exit_code, 'exit code'),
      stdout: decodeStream(result.stdout, 'stdout'),
      stderr: decodeStream(result.stderr, 'stderr'),
      truncated:
        result.stdout?.truncated === true || result.stderr?.truncated === true,
      metrics: mapMetrics(result.resources),
    };
    if (tracked && operationId) {
      tracked.terminal = runResult.exitCode === 0 ? 'succeeded' : 'failed';
      const completion = { operationId, terminal: tracked.terminal, cancellationRequested: tracked.cancellationRequested } satisfies OperationCompletion;
      this.completions.push(completion);
      return { ...runResult, operation: completion };
    }
    return runResult;
  }

  private async poll(location: string): Promise<OperationResponse> {
    const operationUrl = this.resolveOperationLocation(location);
    const deadline = Date.now() + this.operationTimeoutMs;
    let pollIntervalMs = this.pollIntervalMs;

    try {
      while (Date.now() < deadline) {
        const remainingMs = Math.max(1, deadline - Date.now());
        const operation = await this.requestJson<OperationResponse>(
          operationUrl,
          {
            method: 'GET',
            headers: this.headers(),
          },
          remainingMs,
        );

        if (operation.status === 'SUCCESS') return operation;
        if (operation.status === 'FAILED' || operation.status === 'CANCELLED') {
          const detail =
            typeof operation.error === 'string' && operation.error
              ? `: ${operation.error}`
              : '';
          throw new ContreeError(
            `ConTree operation ended with ${String(operation.status)}${detail}`,
          );
        }

        const sleepRemainingMs = Math.max(0, deadline - Date.now());
        if (sleepRemainingMs === 0) break;
        await delay(Math.min(pollIntervalMs, sleepRemainingMs));
        pollIntervalMs = Math.min(pollIntervalMs * 2, MAX_POLL_INTERVAL_MS);
      }
    } catch (error) {
      if (!(error instanceof RequestTimeoutError)) throw error;
    }

    return this.throwOperationTimeout(operationUrl);
  }

  private async cancelRemote(operationUrl: string): Promise<void> {
    await this.withTimeout(this.cancelTimeoutMs, async (signal) => {
      const response = await this.fetch(operationUrl, {
        method: 'DELETE',
        headers: this.headers(),
        signal,
      });
      if (!response.ok && response.status !== 409) {
        await this.throwResponseError(response, 'cancel operation');
      }
    });
  }

  private async throwOperationTimeout(operationUrl: string): Promise<never> {
    let cancellation = '';
    try {
      await this.cancelRemote(operationUrl);
    } catch (error) {
      cancellation = `; cancellation attempt failed: ${errorMessage(error)}`;
    }
    throw new ContreeError(
      `ConTree operation timed out after ${this.operationTimeoutMs}ms${cancellation}`,
    );
  }

  private async request(
    path: string,
    init: RequestInit,
    timeoutMs = this.operationTimeoutMs,
  ): Promise<Response> {
    return this.consumeRequest(path, init, async (response) => response, timeoutMs);
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit,
    timeoutMs = this.operationTimeoutMs,
  ): Promise<T> {
    return this.consumeRequest(
      path,
      init,
      async (response) => (await response.json()) as T,
      timeoutMs,
    );
  }

  private async consumeRequest<T>(
    path: string,
    init: RequestInit,
    consume: (response: Response) => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    const url = isAbsoluteUrl(path) ? path : new URL(path, this.baseUrl).toString();
    return this.withTimeout(timeoutMs, async (signal) => {
      const response = await this.fetch(url, { ...init, signal });
      if (!response.ok) {
        await this.throwResponseError(response, `${init.method} ${url}`);
      }
      return consume(response);
    });
  }

  private async withTimeout<T>(
    timeoutMs: number,
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutError = new RequestTimeoutError(timeoutMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort(timeoutError);
        reject(timeoutError);
      }, timeoutMs);
    });
    try {
      return await Promise.race([action(controller.signal), timeout]);
    } catch (error) {
      if (controller.signal.aborted) {
        throw timeoutError;
      }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async throwResponseError(
    response: Response,
    action: string,
  ): Promise<never> {
    const body = await response.text();
    throw new ContreeError(
      `ConTree ${action} failed with HTTP ${response.status}: ${body}`,
      response.status,
      body,
    );
  }

  private operationLocation(response: Response): string {
    const location = response.headers.get('location');
    if (!location) {
      throw new ContreeError('ConTree response omitted the Location header');
    }
    return location;
  }

  private resolveOperationLocation(location: string): string {
    if (isAbsoluteUrl(location)) {
      const operationUrl = new URL(location);
      if (operationUrl.origin !== this.baseUrl.origin) {
        throw new ContreeError(
          'ConTree operation Location must use the configured origin',
        );
      }
      return operationUrl.toString();
    }

    const expectedPrefix = this.baseUrl.pathname.replace(/\/v1\/$/, '');
    if (location.startsWith(`${expectedPrefix}/v1/`)) {
      return new URL(location, this.baseUrl.origin).toString();
    }
    if (location.startsWith('/v1/')) {
      return new URL(`${expectedPrefix}${location}`, this.baseUrl.origin).toString();
    }
    return new URL(location.replace(/^\//, ''), this.baseUrl).toString();
  }

  private headers(contentType?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.token}`,
      Project: this.config.project,
    };
    if (contentType) headers['Content-Type'] = contentType;
    return headers;
  }

  private jsonHeaders(): Record<string, string> {
    return this.headers('application/json');
  }
}

class RequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`request timed out after ${timeoutMs}ms`);
    this.name = 'RequestTimeoutError';
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//u.test(value);
}

function registryUrl(ref: string): string {
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(ref)) return ref;

  const firstSegment = ref.split('/')[0] ?? '';
  const hasRegistry =
    ref.includes('/') &&
    (firstSegment === 'localhost' || /[.:]/u.test(firstSegment));
  if (hasRegistry) return `docker://${ref}`;
  if (ref.includes('/')) return `docker://docker.io/${ref}`;
  return `docker://docker.io/library/${ref}`;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ContreeError(`ConTree response omitted ${label}`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ContreeError(`ConTree response omitted ${label}`);
  }
  return value;
}

function operationImageId(operation: OperationResponse): ImageId {
  if (
    typeof operation.result_image_uuid === 'string' &&
    operation.result_image_uuid.length > 0
  ) {
    return operation.result_image_uuid;
  }
  return requiredString(operation.result?.image, 'result image uuid');
}

function decodeStream(stream: StreamResponse | undefined, label: string): string {
  if (!stream) return '';
  if (typeof stream.value !== 'string') {
    throw new ContreeError(`ConTree response omitted ${label} value`);
  }
  const value = stream.value;
  if (stream.encoding === 'ascii') return value;
  if (stream.encoding === 'base64') return Buffer.from(value, 'base64').toString('utf8');
  throw new ContreeError(`ConTree ${label} has unsupported encoding`);
}

function mapMetrics(resources: InstanceResources | undefined): RunMetrics {
  if (!resources) return {};
  const metrics: RunMetrics = {};
  if (typeof resources.cost === 'number') metrics.cost = resources.cost;
  if (typeof resources.elapsed_time === 'number') {
    metrics.elapsedTimeSec = resources.elapsed_time;
  }
  if (typeof resources.max_rss === 'number') metrics.maxRssKb = resources.max_rss;
  if (typeof resources.system_cpu_time === 'number') {
    metrics.systemCpuTimeSec = resources.system_cpu_time;
  }
  if (typeof resources.user_cpu_time === 'number') {
    metrics.userCpuTimeSec = resources.user_cpu_time;
  }
  return metrics;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertSnapshotOptions(options: SnapshotOptions): void {
  if (
    options.profile !== 'dependency-inputs' &&
    options.profile !== 'repository'
  ) {
    throw new ContreeError('ConTree snapshot profile is unknown');
  }
  const validPair =
    (options.profile === 'dependency-inputs' && options.mode === 'replace') ||
    (options.profile === 'repository' && options.mode === 'overlay');
  if (!validPair) {
    throw new ContreeError('ConTree snapshot profile and mode are incompatible');
  }
  if (options.includePaths !== undefined) {
    if (
      options.profile !== 'dependency-inputs' ||
      !Array.isArray(options.includePaths) ||
      options.includePaths.length === 0 ||
      options.includePaths.length > 16 ||
      new Set(options.includePaths).size !== options.includePaths.length
    ) {
      throw new ContreeError('ConTree snapshot approved path set is invalid');
    }
    for (const path of options.includePaths) validateSnapshotPath(path);
  }
}

interface SnapshotCommandPaths {
  cwd: string;
  snapshotPath: string;
  manifestPath: string;
  dependencyManifestPath: string;
}

const DEFAULT_SNAPSHOT_COMMAND_PATHS: SnapshotCommandPaths = {
  cwd: SNAPSHOT_CWD,
  snapshotPath: SNAPSHOT_PATH,
  manifestPath: SNAPSHOT_MANIFEST_PATH,
  dependencyManifestPath: DEPENDENCY_MANIFEST_PATH,
};

function snapshotCommand(
  options: SnapshotOptions,
  paths: SnapshotCommandPaths = DEFAULT_SNAPSHOT_COMMAND_PATHS,
): string {
  if (options.mode === 'replace') {
    return `rm -rf ${shellQuote(paths.cwd)} && mkdir -p ${shellQuote(paths.cwd)} && tar -xf ${shellQuote(paths.snapshotPath)} -C ${shellQuote(paths.cwd)}`;
  }
  const validateMember = [
    'sutura_root="$1"',
    'sutura_dependency_manifest="$2"',
    'sutura_member="$3"',
    'sutura_destination="$sutura_root/$sutura_member"',
    'sutura_parent="$(dirname "$sutura_destination")"',
    'while [ "$sutura_parent" != "$sutura_root" ]; do if [ -L "$sutura_parent" ]; then echo "ConTree snapshot refuses symlink parent: $sutura_parent" >&2; exit 65; fi; sutura_parent="$(dirname "$sutura_parent")"; done',
    'if [ -L "$sutura_destination" ]; then echo "ConTree snapshot refuses symlink destination: $sutura_destination" >&2; exit 65; fi',
    'if [ -e "$sutura_destination" ] && ! tr \'\\000\' \'\\n\' < "$sutura_dependency_manifest" | grep -Fqx -- "$sutura_member"; then echo "ConTree snapshot refuses preparation path collision: $sutura_member" >&2; exit 65; fi',
  ].join('; ');
  return [
    `if [ -L ${shellQuote(paths.cwd)} ]; then echo "ConTree snapshot refuses symlink parent: ${paths.cwd}" >&2; exit 65; fi`,
    `mkdir -p ${shellQuote(paths.cwd)}`,
    `xargs -0 -n 1 sh -c ${shellQuote(validateMember)} sh ${shellQuote(paths.cwd)} ${shellQuote(paths.dependencyManifestPath)} < ${shellQuote(paths.manifestPath)}`,
    `tar -xf ${shellQuote(paths.snapshotPath)} -C ${shellQuote(paths.cwd)}`,
  ].join(' && ');
}

export function buildSnapshotCommandForTest(
  options: SnapshotOptions,
  paths: SnapshotCommandPaths,
): string {
  return snapshotCommand(options, paths);
}

function isInstalledDependencyPath(path: string): boolean {
  const segments = path.split('/');
  return (
    segments.includes('node_modules') ||
    segments.includes('.pnpm') ||
    path === '.pnp.cjs' ||
    path === '.pnp.loader.mjs' ||
    path.startsWith('.yarn/cache/') ||
    path.startsWith('.yarn/unplugged/') ||
    path.startsWith('.yarn/install-state.gz')
  );
}

function isDependencyInputPath(
  path: string,
  workspacePatterns: readonly string[],
  localDependencyDirectories: readonly string[] = [],
): boolean {
  if (isSensitiveRepositoryPath(path, { includeDependencies: true })) return false;
  const segments = path.split('/');
  const basename = segments.at(-1) ?? '';
  if (segments.some((segment) => ['node_modules', '.git', 'dist', 'build', '.next'].includes(segment))) {
    return false;
  }
  if (localDependencyDirectories.some((directory) =>
    path === directory || path.startsWith(`${directory}/`))) {
    return true;
  }
  if (path === 'package.json') return true;
  if (segments.length === 1 && [
    'pyproject.toml',
    'uv.lock',
    'poetry.lock',
    'requirements.txt',
    'requirements-dev.txt',
  ].includes(basename)) return true;
  if (basename === 'package.json') {
    const packageDir = path.slice(0, -'/package.json'.length);
    return workspacePatterns.some((pattern) => workspacePatternMatches(pattern, packageDir));
  }
  return segments.length === 1 && [
    'package-lock.json',
    'npm-shrinkwrap.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'yarn.lock',
    '.yarnrc.yml',
  ].includes(basename);
}

function workspacePatternMatches(pattern: string, directory: string): boolean {
  if (
    !pattern ||
    pattern.startsWith('/') ||
    pattern.includes('\\') ||
    pattern.startsWith('!') ||
    /[{}[\]]/u.test(pattern) ||
    pattern.split('/').some(
      (segment) =>
        segment === '..' ||
        (segment.includes('*') && segment !== '*' && segment !== '**'),
    )
  ) {
    throw new ContreeError(`ConTree dependency snapshot refuses unsafe workspace pattern: ${pattern}`);
  }
  const expression = pattern
    .split('/')
    .map((segment) => {
      if (segment === '**') return '.+';
      if (segment === '*') return '[^/]+';
      return segment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    })
    .join('/');
  return new RegExp(`^${expression}$`, 'u').test(directory);
}

async function dependencyWorkspacePatterns(dir: string): Promise<string[]> {
  const patterns: string[] = [];
  try {
    const packageMetadata = await stat(join(dir, 'package.json'));
    if (packageMetadata.size > MAX_DEPENDENCY_CONTROL_BYTES) {
      throw new ContreeError('ConTree dependency snapshot package.json is too large');
    }
    const packageJson = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
      workspaces?: unknown;
    };
    const workspaces = Array.isArray(packageJson.workspaces)
      ? packageJson.workspaces
      : typeof packageJson.workspaces === 'object' && packageJson.workspaces !== null
        ? (packageJson.workspaces as { packages?: unknown }).packages
        : [];
    if (Array.isArray(workspaces)) {
      patterns.push(...workspaces.filter((value): value is string => typeof value === 'string'));
    }
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    if (error instanceof SyntaxError) {
      throw new ContreeError('ConTree dependency snapshot refuses invalid package.json');
    }
  }
  try {
    const workspaceMetadata = await stat(join(dir, 'pnpm-workspace.yaml'));
    if (workspaceMetadata.size > MAX_DEPENDENCY_CONTROL_BYTES) {
      throw new ContreeError('ConTree dependency snapshot workspace file is too large');
    }
    const workspace = await readFile(join(dir, 'pnpm-workspace.yaml'), 'utf8');
    let packagesIndent: number | undefined;
    for (const line of workspace.split(/\r?\n/u)) {
      const packages = /^(?<indent>\s*)packages:\s*(?:#.*)?$/u.exec(line);
      if (packages?.groups?.indent !== undefined) {
        packagesIndent = packages.groups.indent.length;
        continue;
      }
      if (packagesIndent === undefined) continue;
      const indentation = /^\s*/u.exec(line)?.[0].length ?? 0;
      if (line.trim() && indentation <= packagesIndent) {
        packagesIndent = undefined;
        continue;
      }
      const match = /^\s*-\s*['"]?(?<pattern>[^'"#]+?)['"]?\s*(?:#.*)?$/u.exec(line);
      if (match?.groups?.pattern) patterns.push(match.groups.pattern.trim());
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const unique = [...new Set(patterns)];
  for (const pattern of unique) workspacePatternMatches(pattern, '');
  return unique;
}

async function localDependencyDirectories(dir: string): Promise<string[]> {
  let packageJson: Record<string, unknown>;
  try {
    const metadata = await stat(join(dir, 'package.json'));
    if (metadata.size > MAX_DEPENDENCY_CONTROL_BYTES) {
      throw new ContreeError('ConTree dependency snapshot package.json is too large');
    }
    packageJson = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    if (error instanceof SyntaxError) {
      throw new ContreeError('ConTree dependency snapshot refuses invalid package.json');
    }
    throw error;
  }
  const directories = new Set<string>();
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const values = packageJson[section];
    if (typeof values !== 'object' || values === null || Array.isArray(values)) continue;
    for (const specification of Object.values(values)) {
      if (typeof specification !== 'string' || !specification.startsWith('file:')) continue;
      const path = specification.slice('file:'.length);
      if (!/^vendor\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u.test(path)) {
        throw new ContreeError(`ConTree dependency snapshot refuses unsafe local dependency: ${specification}`);
      }
      directories.add(path);
    }
  }
  const root = await realpath(dir);
  for (const directory of directories) {
    const absolute = join(root, directory);
    let metadata;
    try {
      metadata = await lstat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ContreeError(`ConTree local dependency does not exist: ${directory}`);
      }
      throw error;
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new ContreeError(`ConTree local dependency must be a regular directory: ${directory}`);
    }
    const canonical = await realpath(absolute);
    if (!canonical.startsWith(`${root}${sep}`)) {
      throw new ContreeError(`ConTree local dependency escapes the repository: ${directory}`);
    }
    const manifestPath = join(canonical, 'package.json');
    let manifestMetadata;
    try {
      manifestMetadata = await stat(manifestPath);
    } catch {
      throw new ContreeError(`ConTree local dependency package.json is invalid: ${directory}`);
    }
    if (!manifestMetadata.isFile() || manifestMetadata.size > MAX_DEPENDENCY_CONTROL_BYTES) {
      throw new ContreeError(`ConTree local dependency package.json is invalid: ${directory}`);
    }
    let manifest: { scripts?: unknown };
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { scripts?: unknown };
    } catch {
      throw new ContreeError(`ConTree local dependency package.json is invalid: ${directory}`);
    }
    if (typeof manifest.scripts === 'object' && manifest.scripts !== null &&
        Object.keys(manifest.scripts).some((name) => LOCAL_DEPENDENCY_LIFECYCLE_SCRIPTS.has(name))) {
      throw new ContreeError(`ConTree local dependency lifecycle scripts are unsupported: ${directory}`);
    }
  }
  return [...directories].sort();
}

function validateSnapshotPath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /[\0\r\n]/u.test(path) ||
    path.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new ContreeError(`ConTree snapshot refuses unsafe archive path: ${path}`);
  }
}

function includeSnapshotPath(
  path: string,
  profile: SnapshotProfile,
  workspacePatterns: readonly string[],
  localDirectories: readonly string[] = [],
): boolean {
  validateSnapshotPath(path);
  if (profile === 'repository') {
    if (isInstalledDependencyPath(path)) {
      throw new ContreeError(
        `ConTree repository overlay refuses installed dependency path: ${path}`,
      );
    }
    return !isSensitiveRepositoryPath(path);
  }
  return isDependencyInputPath(path, workspacePatterns, localDirectories);
}

async function listNonGitFiles(
  dir: string,
  profile: SnapshotProfile,
): Promise<string[]> {
  const root = await realpath(dir);
  const workspacePatterns = profile === 'dependency-inputs'
    ? await dependencyWorkspacePatterns(root)
    : [];
  const localDirectories = profile === 'dependency-inputs'
    ? await localDependencyDirectories(root)
    : [];
  const files: string[] = [];
  const directories = [''];
  let directoryIndex = 0;
  let sourceBytes = 0;
  while (directoryIndex < directories.length) {
    const directory = directories[directoryIndex] as string;
    directoryIndex += 1;
    const entries = await readdir(join(root, directory), { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      validateSnapshotPath(path);
      if (entry.name.toLowerCase() === '.npmrc') {
        throw new ContreeError(
          'ConTree dependency preparation refuses repository .npmrc credentials',
        );
      }
      if (isInstalledDependencyPath(path)) {
        continue;
      }
      if (isSensitiveRepositoryPath(path, { includeDependencies: true })) continue;
      const absolute = join(root, path);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) {
        if (profile === 'dependency-inputs') {
          throw new ContreeError(
            `ConTree dependency snapshot refuses symlink: ${path}`,
          );
        }
        const link = await readlink(absolute);
        if (isAbsolute(link)) {
          throw new ContreeError(
            `ConTree snapshot refuses absolute symlink: ${path}`,
          );
        }
        const lexicalTarget = resolve(dirname(absolute), link);
        const lexicalRelative = relative(root, lexicalTarget).split(sep).join('/');
        if (
          lexicalRelative.startsWith('../') ||
          lexicalRelative === '..' ||
          isSensitiveRepositoryPath(lexicalRelative, { includeDependencies: true })
        ) {
          throw new ContreeError(
            `ConTree snapshot refuses escaping or sensitive symlink: ${path}`,
          );
        }
        let canonicalTarget: string;
        try {
          canonicalTarget = await realpath(absolute);
        } catch {
          throw new ContreeError(
            `ConTree snapshot refuses dangling or cyclic symlink: ${path}`,
          );
        }
        const canonicalRelative = relative(root, canonicalTarget).split(sep).join('/');
        if (
          canonicalRelative.startsWith('../') ||
          canonicalRelative === '..' ||
          isSensitiveRepositoryPath(canonicalRelative, { includeDependencies: true })
        ) {
          throw new ContreeError(
            `ConTree snapshot refuses escaping or sensitive symlink: ${path}`,
          );
        }
        const targetMetadata = await lstat(canonicalTarget);
        if (!targetMetadata.isFile() && !targetMetadata.isDirectory()) {
          throw new ContreeError(
            `ConTree snapshot refuses symlink to non-regular entry: ${path}`,
          );
        }
        if (files.length >= MAX_SNAPSHOT_FILES) {
          throw new ContreeError(
            `ConTree snapshot exceeds ${MAX_SNAPSHOT_FILES} files`,
          );
        }
        if (includeSnapshotPath(path, profile, workspacePatterns, localDirectories)) files.push(path);
      } else if (metadata.isDirectory()) {
        directories.push(path);
      } else if (metadata.isFile()) {
        if (!includeSnapshotPath(path, profile, workspacePatterns, localDirectories)) continue;
        if (files.length >= MAX_SNAPSHOT_FILES) {
          throw new ContreeError(
            `ConTree snapshot exceeds ${MAX_SNAPSHOT_FILES} files`,
          );
        }
        sourceBytes += metadata.size;
        if (sourceBytes > MAX_SNAPSHOT_SOURCE_BYTES) {
          throw new ContreeError(
            `ConTree snapshot exceeds ${MAX_SNAPSHOT_SOURCE_BYTES} source bytes`,
          );
        }
        files.push(path);
      } else {
        throw new ContreeError(
          `ConTree snapshot refuses non-regular entry: ${path}`,
        );
      }
    }
  }
  return files;
}

export async function listSnapshotFiles(
  dir: string,
  profile: SnapshotProfile,
): Promise<string[]> {
  if (profile === 'dependency-inputs') await assertNoNpmrc(dir);
  const workspacePatterns = profile === 'dependency-inputs'
    ? await dependencyWorkspacePatterns(dir)
    : [];
  const localDirectories = profile === 'dependency-inputs'
    ? await localDependencyDirectories(dir)
    : [];
  try {
    const listed = await runProcess('git', [
      '-C',
      dir,
      'ls-files',
      '-co',
      '--exclude-standard',
      '-z',
    ]);
    const deleted = await runProcess('git', [
      '-C',
      dir,
      'ls-files',
      '--deleted',
      '-z',
    ]);
    const deletedPaths = new Set(
      deleted.stdout.toString('utf8').split('\0').filter(Boolean),
    );
    const listedFiles = listed.stdout
      .toString('utf8')
      .split('\0')
      .filter((path) => path.length > 0 && !deletedPaths.has(path));
    if (listedFiles.some((path) => path.split('/').at(-1)?.toLowerCase() === '.npmrc')) {
      throw new ContreeError(
        'ConTree dependency preparation refuses repository .npmrc credentials',
      );
    }
    const files = listedFiles.filter((path) =>
      includeSnapshotPath(path, profile, workspacePatterns, localDirectories));
    await validateSnapshotFiles(dir, files, profile);
    return files;
  } catch (error) {
    if (error instanceof Error && /not a git repository/iu.test(error.message)) {
      return listNonGitFiles(dir, profile);
    }
    throw error;
  }
}

async function listApprovedDependencyFiles(
  dir: string,
  approvedPaths: readonly string[],
): Promise<string[]> {
  const root = await realpath(dir);
  const files = [...approvedPaths].sort();
  for (const path of files) {
    validateSnapshotPath(path);
    if (!isDependencyInputPath(path, [])) {
      throw new ContreeError(`ConTree dependency snapshot refuses unapproved input kind: ${path}`);
    }
    const absolute = join(root, path);
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) {
      throw new ContreeError(`ConTree dependency snapshot refuses symlink: ${path}`);
    }
    const canonical = await realpath(absolute);
    if (canonical !== root && !canonical.startsWith(`${root}${sep}`)) {
      throw new ContreeError(`ConTree dependency snapshot refuses escaping path: ${path}`);
    }
    if (!metadata.isFile()) {
      throw new ContreeError(`ConTree dependency snapshot requires a regular file: ${path}`);
    }
  }
  await validateSnapshotFiles(root, files, 'dependency-inputs');
  return files;
}

async function validateSnapshotFiles(
  dir: string,
  files: readonly string[],
  profile: SnapshotProfile,
): Promise<void> {
  if (files.length > MAX_SNAPSHOT_FILES) {
    throw new ContreeError(
      `ConTree snapshot exceeds ${MAX_SNAPSHOT_FILES} files`,
    );
  }
  let sourceBytes = 0;
  const root = await realpath(dir);
  for (const path of files) {
    const metadata = await lstat(join(dir, path));
    if (metadata.isSymbolicLink()) {
      if (profile === 'dependency-inputs') {
        throw new ContreeError(`ConTree dependency snapshot refuses symlink: ${path}`);
      }
      const link = await readlink(join(root, path));
      if (isAbsolute(link)) {
        throw new ContreeError(`ConTree snapshot refuses absolute symlink: ${path}`);
      }
      let target: string;
      try {
        target = await realpath(join(root, path));
      } catch {
        throw new ContreeError(`ConTree snapshot refuses dangling or cyclic symlink: ${path}`);
      }
      const targetPath = relative(root, target).split(sep).join('/');
      if (
        targetPath === '..' ||
        targetPath.startsWith('../') ||
        isSensitiveRepositoryPath(targetPath, { includeDependencies: true })
      ) {
        throw new ContreeError(`ConTree snapshot refuses escaping or sensitive symlink: ${path}`);
      }
      continue;
    }
    if (!metadata.isFile()) continue;
    sourceBytes += metadata.size;
    if (sourceBytes > MAX_SNAPSHOT_SOURCE_BYTES) {
      throw new ContreeError(
        `ConTree snapshot exceeds ${MAX_SNAPSHOT_SOURCE_BYTES} source bytes`,
      );
    }
  }
}

interface SnapshotArchive {
  path: string;
  manifestPath: string;
  cleanup(): Promise<void>;
}

async function createSnapshotArchive(
  dir: string,
  options: SnapshotOptions,
): Promise<SnapshotArchive> {
  const files = options.includePaths === undefined
    ? await listSnapshotFiles(dir, options.profile)
    : await listApprovedDependencyFiles(dir, options.includePaths);
  if (options.profile === 'dependency-inputs') {
    await rejectRegistryCredentials(dir, files);
  }
  const input = Buffer.from(files.map((path) => `${path}\0`).join(''));
  const archiveDir = await mkdtemp(join(tmpdir(), 'sutura-contree-'));
  const archivePath = join(archiveDir, 'snapshot.tar');
  const manifestPath = join(archiveDir, 'manifest.bin');
  try {
    await writeFile(manifestPath, input);
    await runProcess(
      'tar',
      ['-cf', archivePath, '--no-recursion', '--null', '-T', '-'],
      dir,
      input,
      { ...process.env, COPYFILE_DISABLE: '1' },
    );
    const archive = await stat(archivePath);
    if (archive.size > MAX_SNAPSHOT_ARCHIVE_BYTES) {
      throw new ContreeError(
        `ConTree snapshot archive exceeds ${MAX_SNAPSHOT_ARCHIVE_BYTES} bytes`,
      );
    }
    return {
      path: archivePath,
      manifestPath,
      cleanup: () => rm(archiveDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(archiveDir, { recursive: true, force: true });
    throw error;
  }
}

async function assertNoNpmrc(dir: string): Promise<void> {
  const root = await realpath(dir);
  const directories = [''];
  for (let index = 0; index < directories.length; index += 1) {
    const directory = directories[index] as string;
    const entries = await readdir(join(root, directory), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.toLowerCase() === '.npmrc') {
        throw new ContreeError(
          'ConTree dependency preparation refuses repository .npmrc credentials',
        );
      }
      if (
        entry.isDirectory() &&
        !['.git', 'node_modules', '.pnpm', 'dist', 'build', '.next'].includes(entry.name)
      ) {
        directories.push(directory ? `${directory}/${entry.name}` : entry.name);
      }
    }
  }
}

async function rejectRegistryCredentials(
  dir: string,
  files: readonly string[],
): Promise<void> {
  for (const path of files) {
    const metadata = await stat(join(dir, path));
    if (metadata.size > MAX_DEPENDENCY_INPUT_FILE_BYTES) {
      throw new ContreeError(
        `ConTree dependency preparation refuses oversized input file: ${path}`,
      );
    }
    const content = await readFile(join(dir, path), 'utf8');
    if (
      /https?:\/\/[^/\s@]+@/iu.test(content) ||
      /(?:npmAuthToken|npmAuthIdent|_authToken)\s*[:=]/iu.test(content)
    ) {
      throw new ContreeError(
        `ConTree dependency preparation refuses embedded registry credentials in ${path}`,
      );
    }
  }
}

async function runProcess(
  command: string,
  args: string[],
  cwd?: string,
  input?: Buffer,
  env?: NodeJS.ProcessEnv,
): Promise<{ stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...(cwd ? { cwd } : {}),
      ...(env ? { env } : {}),
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stderrBytes = 0;
    let stderrTruncated = false;

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      const remaining = MAX_PROCESS_STDERR_BYTES - stderrBytes;
      if (remaining <= 0) {
        stderrTruncated = true;
        return;
      }
      const kept = chunk.subarray(0, remaining);
      stderr.push(kept);
      stderrBytes += kept.length;
      if (kept.length < chunk.length) stderrTruncated = true;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const result = {
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(
          stderrTruncated
            ? [...stderr, Buffer.from('\n[stderr truncated]\n')]
            : stderr,
        ),
      };
      if (code === 0) resolve(result);
      else {
        reject(
          new ContreeError(
            `${command} failed with exit code ${String(code)}: ${result.stderr.toString('utf8')}`,
          ),
        );
      }
    });
    child.stdin.end(input);
  });
}
