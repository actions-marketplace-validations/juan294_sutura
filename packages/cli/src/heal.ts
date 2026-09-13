import { constants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';

import {
  ContreeExecutor,
  auditOnly,
  TavilyClient,
  createTokenFactoryClient,
  healCase,
  isSensitiveRepositoryPath,
  loadConfig,
  loadRepositoryPolicy,
  MAX_POLICY_BYTES,
  readRepairSourceContext,
  selectBoundedSourceWindow,
  SourceWindowError,
  detectRuntimeAtPath,
  validateCounterfactualAlternatives,
  type VerificationMode,
  type CaseFile,
  type AuditFile,
  type CounterfactualAlternative,
  type ConfigEnvironment,
  type CostLedger,
  type Diagnosis,
  type Executor,
  type HealLlm,
  type AuditOnlyLlm,
  type RepairSourceContext,
  type RepairBudgetLimits,
  type SearchLimits,
  type RepositorySourceExcerpt,
  type RepositoryPolicy,
  type SourceReadLimits,
  type SourceReference,
  type TavilySearch,
  type RuntimeId,
} from '@sutura/core';

import type { AuditArguments, HealArguments } from './args.js';

const MAX_SOURCE_SCAN_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024;
export const MAX_AUDIT_LOG_BYTES = 20_000;
export const MAX_AUDIT_DIFF_BYTES = 1024 * 1024;
const PACKAGE_NAME = /^@?[a-z0-9][\w./-]*$/iu;
const PACKAGE_VERSION = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u;

export interface HealRuntime {
  evidenceMode?: VerificationMode;
  executor: Executor;
  llm: HealLlm;
  cost: CostLedger;
  triageN: number;
  raceK: number;
  repairBudgets?: RepairBudgetLimits;
  search?: SearchLimits;
  tavily?: TavilySearch;
  imageRef?: string;
  runtimeId?: RuntimeId;
}

export interface AuditRuntime {
  llm: AuditOnlyLlm;
  cost: CostLedger;
}

export class CliConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliConfigError';
  }
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function safeRelativePath(path: string): boolean {
  if (
    !path ||
    path.length > 240 ||
    path.includes('\\') ||
    path.startsWith('/') ||
    !/^[A-Za-z0-9_@./-]+$/u.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    return false;
  }
  return !isSensitiveRepositoryPath(path);
}

async function hasSymlinkComponent(root: string, path: string): Promise<boolean> {
  let current = root;
  for (const segment of path.split('/')) {
    current = resolve(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) return true;
    } catch {
      return true;
    }
  }
  return false;
}

async function readLineWindow(
  path: string,
  targetLine: number | undefined,
  limits: Readonly<SourceReadLimits>,
): Promise<{
  startLine: number;
  content: string;
  truncated: boolean;
  boundaryComplete: true;
}> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const chunks: Buffer[] = [];
  let scannedBytes = 0;
  let fileSize = 0;
  try {
    fileSize = (await handle.stat()).size;
    const desiredEndLine = Math.max(targetLine ?? 1, 1) +
      Math.ceil(limits.maxLinesPerFile / 2);
    const scanLimit = Math.min(
      MAX_SOURCE_SCAN_BYTES,
      limits.maxBytesPerFile * limits.maxLinesPerFile * 4,
      fileSize,
    );
    let newlineCount = 0;
    const buffer = Buffer.alloc(4_096);
    while (scannedBytes < scanLimit && newlineCount < desiredEndLine) {
      const available = Math.min(buffer.length, scanLimit - scannedBytes);
      const { bytesRead } = await handle.read(buffer, 0, available, scannedBytes);
      if (bytesRead === 0) break;
      const chunk = Buffer.from(buffer.subarray(0, bytesRead));
      chunks.push(chunk);
      scannedBytes += bytesRead;
      for (const byte of chunk) if (byte === 0x0a) newlineCount += 1;
    }
  } finally {
    await handle.close();
  }

  try {
    return selectBoundedSourceWindow({
      scanned: Buffer.concat(chunks).toString('utf8'),
      scannedBytes,
      fileSize,
      ...(targetLine === undefined ? {} : { requestedLine: targetLine }),
      limits,
    });
  } catch (error) {
    if (error instanceof SourceWindowError) {
      throw new CliConfigError('Referenced source line exceeds the bounded scan limit');
    }
    throw error;
  }
}

async function readBoundedSource(
  root: string,
  reference: SourceReference,
  limits: Readonly<SourceReadLimits>,
): Promise<RepositorySourceExcerpt | null> {
  const { path } = reference;
  if (!safeRelativePath(path)) return null;
  if (await hasSymlinkComponent(root, path)) return null;
  const requested = resolve(root, path);
  let canonical: string;
  try {
    canonical = await realpath(requested);
  } catch {
    return null;
  }
  if (!isInside(root, canonical)) return null;

  try {
    return { path, ...(await readLineWindow(canonical, reference.line, limits)) };
  } catch {
    return null;
  }
}

export async function readLocalSourceContext(
  caseDir: string,
  log: string,
  _diagnosis: Diagnosis,
  policy?: RepositoryPolicy,
  runtimeId: RuntimeId = 'node',
  competingClasses: readonly Diagnosis['class'][] = [],
): Promise<RepairSourceContext> {
  const root = await realpath(caseDir);
  return readRepairSourceContext(
    {
      async readSourceExcerpts(
        checkoutDir: string,
        references: readonly SourceReference[],
        limits: Readonly<SourceReadLimits>,
      ): Promise<RepositorySourceExcerpt[]> {
        if (checkoutDir !== root) throw new CliConfigError('Source checkout changed during heal');
        const excerpts = await Promise.all(
          references.map((reference) => readBoundedSource(root, reference, limits)),
        );
        return excerpts.filter((source): source is RepositorySourceExcerpt => source !== null);
      },
    },
    root,
    log,
    _diagnosis,
    policy,
    runtimeId,
    'first',
    competingClasses,
  );
}

async function readLocalPolicy(caseDir: string): Promise<string | null> {
  const policyPath = resolve(caseDir, '.sutura.json');
  let metadata;
  try {
    metadata = await lstat(policyPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    throw new CliConfigError('Repository policy must not be a symlink');
  }
  const canonical = await realpath(policyPath);
  if (!isInside(caseDir, canonical)) {
    throw new CliConfigError('Repository policy escapes the case directory');
  }
  const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const file = await handle.stat();
    if (!file.isFile()) throw new CliConfigError('Repository policy must be a file');
    if (file.size > MAX_POLICY_BYTES) {
      throw new CliConfigError(`Repository policy exceeds ${MAX_POLICY_BYTES} bytes`);
    }
    const bytes = Buffer.alloc(file.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== file.size || bytesRead > MAX_POLICY_BYTES) {
      throw new CliConfigError('Repository policy changed during bounded read');
    }
    return bytes.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function canonicalCaseDirectory(caseDir: string): Promise<string> {
  const canonical = await realpath(caseDir);
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) throw new CliConfigError('--case-dir must name a directory');
  return canonical;
}

async function readAuditEvidence(path: string, maximumBytes: number): Promise<string> {
  const metadata = await lstat(path).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    throw new CliConfigError('Audit evidence must be a regular non-symlink file');
  }
  if (metadata.size > maximumBytes) {
    throw new CliConfigError(`Audit evidence exceeds ${maximumBytes} bytes`);
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.size !== metadata.size || current.size > maximumBytes) {
      throw new CliConfigError('Audit evidence changed during bounded read');
    }
    const bytes = Buffer.alloc(current.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== current.size || bytesRead > maximumBytes) {
      throw new CliConfigError('Audit evidence changed during bounded read');
    }
    const content = bytes.subarray(0, bytesRead);
    if (content.includes(0)) throw new CliConfigError('Audit evidence must be UTF-8 text');
    return content.toString('utf8');
  } finally {
    await handle.close();
  }
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | null> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_MANIFEST_BYTES) return null;
    const value: unknown = JSON.parse(await handle.readFile('utf8'));
    return typeof value === 'object' && value !== null
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

export async function readDependencyHints(caseDir: string): Promise<string[]> {
  const root = await realpath(caseDir);
  const manifest = await readJsonObject(resolve(root, 'package.json'));
  if (!manifest) return [];
  const dependencies = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .flatMap((field) => {
      const entries = manifest[field];
      return typeof entries === 'object' && entries !== null
        ? Object.entries(entries as Record<string, unknown>)
        : [];
    });
  const hints = new Set<string>();
  for (const [name, specifier] of dependencies) {
    if (!PACKAGE_NAME.test(name) || typeof specifier !== 'string') continue;
    if (specifier.startsWith('file:')) {
      const relativeDependency = specifier.slice('file:'.length);
      const manifestPath = `${relativeDependency}/package.json`;
      if (
        !safeRelativePath(manifestPath) ||
        await hasSymlinkComponent(root, manifestPath)
      ) {
        continue;
      }
      const canonicalManifest = await realpath(resolve(root, manifestPath)).catch(() => null);
      if (!canonicalManifest || !isInside(root, canonicalManifest)) continue;
      const dependencyManifest = await readJsonObject(canonicalManifest);
      if (
        dependencyManifest?.name === name &&
        typeof dependencyManifest.version === 'string' &&
        PACKAGE_VERSION.test(dependencyManifest.version)
      ) {
        hints.add(`${name}@${dependencyManifest.version}`);
      }
      continue;
    }
    if (PACKAGE_VERSION.test(specifier)) {
      hints.add(`${name}@${specifier}`);
    }
  }
  return [...hints].slice(0, 25);
}

export const MAX_ALTERNATIVES_FILE_BYTES = 256 * 1024;

/**
 * Reads and validates a counterfactual alternative set. The set is refused
 * whole on any defect, so a malformed file can never reach the gate stack as a
 * partial set.
 */
export async function readCounterfactualAlternatives(
  path: string,
): Promise<CounterfactualAlternative[]> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new CliConfigError(`${path} must be a regular file`);
    }
    if (metadata.size > MAX_ALTERNATIVES_FILE_BYTES) {
      throw new CliConfigError(
        `${path} exceeds ${MAX_ALTERNATIVES_FILE_BYTES} bytes`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await handle.readFile('utf8'));
    } catch (error) {
      throw new CliConfigError(
        `${path} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new CliConfigError(`${path} must be an object with an alternatives array`);
    }
    try {
      return validateCounterfactualAlternatives(
        (parsed as { alternatives?: unknown }).alternatives,
      );
    } catch (error) {
      throw new CliConfigError(
        `${path} is not a valid alternative set: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } finally {
    await handle?.close();
  }
}

export async function healWithRuntime(
  request: HealArguments,
  runtime: HealRuntime,
): Promise<CaseFile> {
  const caseDir = await canonicalCaseDirectory(request.caseDir);
  const loadedPolicy = loadRepositoryPolicy(await readLocalPolicy(caseDir));
  const dependencyHints = await readDependencyHints(caseDir);
  const counterfactuals = request.alternativesFile === undefined
    ? undefined
    : await readCounterfactualAlternatives(request.alternativesFile);
  const caseName = basename(caseDir).replace(/[^A-Za-z0-9_.-]+/gu, '-') || 'case';
  return healCase({
    evidenceMode: runtime.evidenceMode ?? 'local',
    runId: `local-${caseName}`,
    repo: `local/${caseName}`,
    caseDir,
    executor: runtime.executor,
    llm: runtime.llm,
    cost: runtime.cost,
    triageN: runtime.triageN,
    raceK: runtime.raceK,
    ...(runtime.repairBudgets === undefined ? {} : { repairBudgets: runtime.repairBudgets }),
    ...(runtime.search === undefined ? {} : { search: runtime.search }),
    readSourceContext: (log, diagnosis, selectedRuntime, competingClasses) => readLocalSourceContext(
      caseDir,
      log,
      diagnosis,
      loadedPolicy.policy,
      selectedRuntime?.id ?? 'node',
      competingClasses,
    ),
    policy: loadedPolicy.policy,
    policyEvidence: {
      baseRef: 'local',
      baseSha: 'local',
      policySha: loadedPolicy.sha,
    },
    ...(runtime.tavily ? { tavily: runtime.tavily } : {}),
    ...(runtime.imageRef ? { imageRef: runtime.imageRef } : {}),
    ...(runtime.runtimeId ? { runtimeId: runtime.runtimeId } : {}),
    ...(dependencyHints.length === 0 ? {} : { dependencyHints }),
    ...(request.candidateDiff === undefined ? {} : { candidateDiff: request.candidateDiff }),
    ...(request.failingCommand === undefined ? {} : { failureCommand: request.failingCommand }),
    ...(counterfactuals === undefined ? {} : { counterfactuals }),
  });
}

export async function detectLocalRuntimeId(
  caseDirectory: string,
  configuredRuntime?: RuntimeId,
): Promise<RuntimeId> {
  const caseDir = await canonicalCaseDirectory(caseDirectory);
  const loadedPolicy = loadRepositoryPolicy(await readLocalPolicy(caseDir));
  if (
    configuredRuntime !== undefined &&
    loadedPolicy.policy.runtime !== undefined &&
    configuredRuntime !== loadedPolicy.policy.runtime
  ) {
    throw new CliConfigError('Configured runtime conflicts with repository policy runtime');
  }
  return (await detectRuntimeAtPath(
    caseDir,
    'pnpm test',
    configuredRuntime ?? loadedPolicy.policy.runtime,
  )).id;
}

export function runtimeFromEnvironment(
  request: HealArguments,
  environment: ConfigEnvironment = process.env,
): HealRuntime {
  const config = loadConfig({
    ...environment,
    ...(request.routingProfile === undefined
      ? {}
      : { SUTURA_ROUTING_PROFILE: request.routingProfile }),
    ...(request.runtime === undefined ? {} : { SUTURA_RUNTIME: request.runtime }),
  });
  if (!config.contreeToken) throw new CliConfigError('CONTREE_TOKEN is required');
  if (!config.contreeProject) throw new CliConfigError('CONTREE_PROJECT is required');
  if (request.tavilyEnabled && !config.tavilyApiKey) {
    throw new CliConfigError('TAVILY_API_KEY is required unless --no-tavily is set');
  }
  const llm = createTokenFactoryClient({
    apiKey: config.nebiusApiKey,
    models: config.models,
    routingProfileId: config.routingProfileId,
  });
  return {
    evidenceMode: 'live',
    executor: new ContreeExecutor({
      token: config.contreeToken,
      project: config.contreeProject,
      maxOps: config.maxOps,
    }),
    llm,
    cost: llm.ledger,
    triageN: config.triageN,
    raceK: config.raceK,
    repairBudgets: config.repairBudgets,
    search: config.search,
    ...(config.runtimeId === undefined ? {} : { runtimeId: config.runtimeId }),
    ...(request.tavilyEnabled ? { tavily: new TavilyClient(config.tavilyApiKey) } : {}),
  };
}

export async function healFromEnvironment(request: HealArguments): Promise<CaseFile> {
  return healWithRuntime(request, runtimeFromEnvironment(request));
}

export async function auditWithRuntime(
  request: AuditArguments,
  runtime: AuditRuntime,
): Promise<AuditFile> {
  const caseDir = await canonicalCaseDirectory(request.caseDir);
  const loadedPolicy = loadRepositoryPolicy(await readLocalPolicy(caseDir));
  const [candidateDiff, beforeLog, afterLog] = await Promise.all([
    readAuditEvidence(request.candidateDiff, Math.min(MAX_AUDIT_DIFF_BYTES, loadedPolicy.policy.maxDiffBytes)),
    readAuditEvidence(request.beforeLog, MAX_AUDIT_LOG_BYTES),
    readAuditEvidence(request.afterLog, MAX_AUDIT_LOG_BYTES),
  ]);
  return auditOnly({
    llm: runtime.llm,
    cost: runtime.cost,
    candidateDiff,
    beforeLog,
    afterLog,
    policy: loadedPolicy.policy,
    policyEvidence: { baseRef: 'local', baseSha: 'local', policySha: loadedPolicy.sha },
  });
}

export function auditRuntimeFromEnvironment(
  environment: ConfigEnvironment = process.env,
): AuditRuntime {
  const config = loadConfig(environment);
  const llm = createTokenFactoryClient({
    apiKey: config.nebiusApiKey,
    models: config.models,
    routingProfileId: config.routingProfileId,
  });
  return { llm, cost: llm.ledger };
}

export async function auditFromEnvironment(request: AuditArguments): Promise<AuditFile> {
  return auditWithRuntime(request, auditRuntimeFromEnvironment());
}
