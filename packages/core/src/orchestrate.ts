import { freezeRepositorySource } from './replay/source-snapshot.js';
import type { FrozenVerificationSource } from './heal.js';
import { VerificationExecutionRecorder } from './verification/execution-record.js';
import type { VerificationMode } from './verification/types.js';
import { Buffer } from 'node:buffer';

import { classifyMechanically } from './diagnose/classify.js';
import type { TavilySearch } from './diagnose/tavily.js';
import type { RepairBudgetOverrides } from './engine/repair-budget.js';
import type { SearchLimits } from './config.js';
import type {
  CaseFile,
  CostLedger,
  Diagnosis,
  FailureClass,
  PolicyEvidence,
} from './domain.js';
import {
  REPAIR_FULL_REPLACEMENT_MAX_CODE_POINTS,
  type RepairSourceContext,
} from './engine/repair.js';
import { findSelectedCandidate } from './engine/candidate-identity.js';
import { sourceDependencyGroups } from './engine/source-context.js';
import {
  SNAPSHOT_CWD,
  type Executor,
} from './executor/types.js';
import {
  AllowlistedExecutor,
  StageLedger,
  noReproductionCaseFile,
  prepareSandbox,
  preparationFailureCaseFile,
  repairFailure,
  sandboxTargetCommand,
  type HealLlm,
} from './heal.js';
import type { RepairVerificationScope } from './heal.js';
import { TraceRecorder } from './trace/recorder.js';
import { loadRepositoryPolicy } from './policy/load.js';
import { policyAllowsSourceRead } from './policy/evaluate.js';
import type { RepositoryPolicy } from './policy/schema.js';
import {
  containsExternalTextRedaction,
  redactExternalText,
} from './security/external-text.js';

export { SUTURA_SANDBOX_ENV } from './heal.js';
import { renderCaseFile } from './report/casefile.js';
import { renderComment } from './report/markdown.js';
import { isSensitiveRepositoryPath } from './security/repository-path.js';
import { detectRuntimeAtPath } from './runtime/detect.js';
import type { RuntimeId } from './runtime/types.js';
import type { ReplayRecorder } from './replay/bundle.js';

const FAILED_STEP_LINES = 200;
const MAX_SOURCE_FILES = 8;
const MAX_LATEST_ROOT_SOURCE_FILES = 4;
const MAX_SOURCE_LINES = 120;
const MAX_DEPENDENCY_CANDIDATE_PROBES_PER_DEPTH = 192;
const ANSI_CSI_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/gu;
const SOURCE_PATH_PATTERN = /(?:^|[\s("'`])(?<path>(?:\.\/)?(?:[A-Za-z0-9_@.-]+\/)*[A-Za-z0-9_@.-]+\.(?:json|[cm]?[jt]sx?|pyi?|ini|txt|ya?ml|toml))(?![A-Za-z0-9_.-])(?:(?:\(|:)(?<line>\d+))?/g;
const WORKSPACE_LOG_LINE_PATTERN = /(?:^|[\t\n \]])(?<workspace>(?:apps|packages)\/(?:[A-Za-z0-9_@.-]+\/)*[A-Za-z0-9_@.-]+)\s+[A-Za-z0-9_:@./-]+:\s*(?<message>[^\r\n]{0,2000})/g;
const GITHUB_WORKSPACE_PREFIX_PATTERN = /(^|[\s("'`])(?:(?:file:\/\/)?\/home\/runner\/work|(?:file:\/\/)?\/__w)\/([A-Za-z0-9_.-]+)\/\2\//gm;
const NODE_FALLBACK_SOURCE_PATHS: Readonly<Partial<Record<FailureClass, readonly string[]>>> = {
  typecheck: ['tsconfig.json', 'package.json'],
  lint: ['eslint.config.js', 'package.json'],
  build: ['package.json', 'tsconfig.json', 'pnpm-lock.yaml'],
  'dep-upstream-breaking': [
    'package.json',
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
  ],
  'env-config': ['package.json', 'tsconfig.json'],
};
const PYTHON_FALLBACK_SOURCE_PATHS: Readonly<Partial<Record<FailureClass, readonly string[]>>> = {
  typecheck: ['pyproject.toml'],
  lint: ['ruff.toml', 'pyproject.toml'],
  build: ['pyproject.toml', 'uv.lock', 'requirements.txt'],
  'dep-upstream-breaking': ['pyproject.toml', 'uv.lock', 'requirements.txt'],
  'env-config': ['pyproject.toml', 'pytest.ini'],
};
const FIX_COMMIT_MESSAGE = [
  'fix: repair CI failure with Sutura',
  '',
  'Co-Authored-By: Sutura <sutura@users.noreply.github.com>',
].join('\n');

export interface FailedStepLog {
  jobName: string;
  stepName: string;
  log: string;
}

export interface FailingWorkflowRun {
  runId: string;
  repo: string;
  prNumber?: number;
  headSha: string;
  headRef: string;
  baseSha: string;
  baseRef: string;
  failedSteps: FailedStepLog[];
}

export interface AttemptTarget {
  kind: 'pull-request' | 'commit';
  commentId: number;
  checkRunId: number;
  headSha: string;
}

export interface CompleteCheckInput {
  caseFile: CaseFile;
  artifactUrl: string;
  checkoutDir: string;
}

export interface CreateFixPullRequestInput {
  baseRef: string;
  branch: string;
  body: string;
  headSha: string;
  title: string;
}

export interface GitHubOrchestrationPort {
  getFailingRun(runId: string): Promise<FailingWorkflowRun>;
  /** Atomically persists marker and returns its comment id, or null if claimed. */
  claimAttempt(prNumber: number | undefined, marker: string): Promise<AttemptTarget | null>;
  updateAttempt(target: AttemptTarget, body: string): Promise<void>;
  createFixPullRequest(
    input: CreateFixPullRequestInput,
  ): Promise<{ number: number; url: string }>;
  uploadCaseFile(name: string, html: string): Promise<{ url: string }>;
  uploadReplayBundle(name: string, json: string): Promise<{ url: string }>;
  completeCheck(target: AttemptTarget, input: CompleteCheckInput): Promise<void>;
}

export interface PublishFixInput {
  branch: string;
  checkoutDir: string;
  diff: string;
  headSha: string;
  message: string;
}

export interface SourceReference {
  path: string;
  line?: number;
}

export type SourceReferenceOrder = 'first' | 'latest';

export interface SourceReadLimits {
  maxFiles: number;
  maxLinesPerFile: number;
  maxCharactersPerFile: number;
  maxBytesPerFile: number;
}

export interface RepositorySourceExcerpt {
  path: string;
  startLine: number;
  content: string;
  truncated: boolean;
  boundaryComplete?: boolean;
}

export const REPAIR_SOURCE_LIMITS: Readonly<SourceReadLimits> = Object.freeze({
  maxFiles: MAX_SOURCE_FILES,
  maxLinesPerFile: MAX_SOURCE_LINES,
  maxCharactersPerFile: REPAIR_FULL_REPLACEMENT_MAX_CODE_POINTS,
  maxBytesPerFile: REPAIR_FULL_REPLACEMENT_MAX_CODE_POINTS,
});

export interface RepositoryPort {
  /** Replays recorded source provenance without reading unrecorded files. */
  freezeSource?(checkoutDir: string): Promise<FrozenVerificationSource>;
  checkoutHead(
    repo: string,
    sha: string,
    headRef?: string,
    prNumber?: number,
  ): Promise<string>;
  /** Reads only `.sutura.json` from the exact verified commit without following symlinks. */
  readPolicyAtSha(repo: string, sha: string): Promise<string | null>;
  /**
   * Reads bounded excerpts without following symlinks. Every path component
   * must resolve inside the real checkoutDir. The implementation must stop
   * reading at limits instead of loading a whole file and truncating later.
   */
  readSourceExcerpts(
    checkoutDir: string,
    references: readonly SourceReference[],
    limits: Readonly<SourceReadLimits>,
  ): Promise<RepositorySourceExcerpt[]>;
  publishFix(input: PublishFixInput): Promise<void>;
}

export type OrchestratorLlm = HealLlm;

export interface OrchestrationContext {
  evidenceMode?: VerificationMode;
  runId: string;
  github: GitHubOrchestrationPort;
  repository: RepositoryPort;
  executor: Executor;
  llm: OrchestratorLlm;
  cost: CostLedger;
  triageN: number;
  raceK: number;
  repairBudgets?: RepairBudgetOverrides;
  search?: SearchLimits;
  tavily?: TavilySearch;
  imageRef?: string;
  runtimeId?: RuntimeId;
  lockfileDiff?: string;
  replay?: ReplayRecorder;
  sourceReferenceOrder?: SourceReferenceOrder;
  repairVerificationScope?: RepairVerificationScope;
}

export class AlreadyAttemptedError extends Error {
  constructor(runId: string) {
    super(`Sutura already attempted workflow run ${runId}`);
    this.name = 'AlreadyAttemptedError';
  }
}

export class OrchestrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestrationError';
  }
}

function validateRun(run: FailingWorkflowRun, expectedRunId: string): void {
  if (run.runId !== expectedRunId) {
    throw new OrchestrationError('GitHub returned a different workflow run id');
  }
  if (!/^[1-9]\d*$/.test(run.runId)) {
    throw new OrchestrationError('Workflow run id must be a positive decimal id');
  }
  if (
    !run.repo.trim() ||
    (run.prNumber !== undefined &&
      (!Number.isSafeInteger(run.prNumber) || run.prNumber <= 0))
  ) {
    throw new OrchestrationError('Failing workflow run has invalid repository metadata');
  }
  if (!/^[0-9a-f]{40}$/i.test(run.headSha)) {
    throw new OrchestrationError('Failing workflow run has an invalid head SHA');
  }
  if (!/^[0-9a-f]{40}$/i.test(run.baseSha)) {
    throw new OrchestrationError('Failing workflow run has an invalid base SHA');
  }
  if (!run.headRef.trim() || !run.baseRef.trim()) {
    throw new OrchestrationError('Failing workflow run has an empty head or base ref');
  }
  if (run.failedSteps.length === 0) {
    throw new OrchestrationError('Failing workflow run has no failed-step logs');
  }
}

export function attemptMarker(runId: string): string {
  const encoded = Buffer.from(runId, 'utf8').toString('base64url');
  return `<!-- sutura-run:${encoded} -->`;
}

export function collectFailedLogs(steps: readonly FailedStepLog[]): string {
  return steps
    .map(({ jobName, stepName, log }) => {
      let start = 0;
      let lines = log.endsWith('\n') ? 0 : 1;
      for (let index = log.length - 1; index >= 0; index -= 1) {
        if (log[index] === '\n' && ++lines > FAILED_STEP_LINES) {
          start = index + 1;
          break;
        }
      }
      const tail = log.slice(start);
      return `[${jobName} / ${stepName}]\n${tail}`;
    })
    .join('\n\n');
}

function safeSourcePath(path: string): string | null {
  const normalized = path.replace(/^\.\//, '');
  const segments = normalized.split('/');
  if (
    normalized.length === 0 ||
    normalized.length > 240 ||
    normalized.includes('\\') ||
    normalized.includes('//') ||
    !/^[A-Za-z0-9_@./-]+$/.test(normalized) ||
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..',
    ) ||
    isSensitiveRepositoryPath(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function extractSourceReferences(
  log: string,
  order: SourceReferenceOrder = 'first',
): SourceReference[] {
  const normalizedLog = log
    .replace(ANSI_CSI_PATTERN, '')
    .replaceAll('file:///workspace/', '')
    .replaceAll('/workspace/', '')
    .replace(GITHUB_WORKSPACE_PREFIX_PATTERN, '$1');
  const references = new Map<string, SourceReference>();
  const workspacePaths = new Set<string>();
  const isWorkspaceQualified = (path: string): boolean => {
    for (const workspacePath of workspacePaths) {
      if (workspacePath === path || workspacePath.endsWith(`/${path}`)) return true;
    }
    return false;
  };
  const remember = (path: string, lineValue: number): void => {
    const line = Number.isSafeInteger(lineValue) && lineValue > 0
      ? lineValue
      : undefined;
    const existing = references.get(path);
    if (existing) {
      if (existing.line === undefined && line !== undefined) {
        references.set(path, { path, line });
      }
    } else {
      if (references.size >= MAX_SOURCE_FILES) {
        if (order === 'first') return;
        const oldest = references.keys().next().value as string | undefined;
        if (oldest !== undefined) references.delete(oldest);
      }
      references.set(path, line === undefined ? { path } : { path, line });
    }
  };

  for (const match of normalizedLog.matchAll(WORKSPACE_LOG_LINE_PATTERN)) {
    const workspace = safeSourcePath(match.groups?.workspace ?? '');
    if (!workspace) continue;
    for (const sourceMatch of (match.groups?.message ?? '').matchAll(SOURCE_PATH_PATTERN)) {
      const relativePath = safeSourcePath(sourceMatch.groups?.path ?? '');
      const path = relativePath === null
        ? null
        : /^(?:apps|packages)\//u.test(relativePath)
          ? relativePath
          : safeSourcePath(`${workspace}/${relativePath}`);
      if (path) remember(path, Number(sourceMatch.groups?.line));
      if (path) workspacePaths.add(path);
    }
  }

  for (const match of normalizedLog.matchAll(SOURCE_PATH_PATTERN)) {
    const path = safeSourcePath(match.groups?.path ?? '');
    if (!path) continue;
    if (isWorkspaceQualified(path)) continue;
    remember(path, Number(match.groups?.line));
  }

  return [...references.values()];
}

export async function readRepairSourceContext(
  repository: Pick<RepositoryPort, 'readSourceExcerpts'>,
  checkoutDir: string,
  log: string,
  diagnosis?: Pick<Diagnosis, 'class'>,
  policy?: RepositoryPolicy,
  runtimeId: RuntimeId = 'node',
  sourceReferenceOrder: SourceReferenceOrder = 'first',
  competingClasses: readonly FailureClass[] = [],
): Promise<RepairSourceContext> {
  const extractedReferences = extractSourceReferences(log, sourceReferenceOrder).filter((reference) =>
    policy === undefined || policyAllowsSourceRead(reference.path, policy),
  );
  const references = sourceReferenceOrder === 'latest'
    ? [
        ...extractedReferences.filter(({ line }) => line !== undefined).toReversed(),
        ...extractedReferences.filter(({ line }) => line === undefined).toReversed(),
      ].slice(0, MAX_LATEST_ROOT_SOURCE_FILES)
    : extractedReferences;
  const fallbackPaths = runtimeId === 'python'
    ? PYTHON_FALLBACK_SOURCE_PATHS
    : NODE_FALLBACK_SOURCE_PATHS;
  const fallbackClasses = [...new Set([...(diagnosis ? [diagnosis.class] : []), ...competingClasses])];
  for (const path of fallbackClasses.flatMap((failureClass) => fallbackPaths[failureClass] ?? [])) {
    if (
      references.length < REPAIR_SOURCE_LIMITS.maxFiles &&
      (policy === undefined || policyAllowsSourceRead(path, policy)) &&
      !references.some((reference) => reference.path === path)
    ) {
      references.push({ path });
    }
  }
  if (references.length === 0) return { sources: [] };
  const accepted = new Map<string, RepairSourceContext['sources'][number]>();
  const validateSources = (
    requestedReferences: readonly SourceReference[],
    sources: readonly RepositorySourceExcerpt[],
  ): RepairSourceContext['sources'] => {
    if (sources.length > REPAIR_SOURCE_LIMITS.maxFiles) {
      throw new OrchestrationError('Repository source port exceeded the file limit');
    }
    if (sources.length > requestedReferences.length) {
      throw new OrchestrationError('Repository source port returned an unsafe or unbounded excerpt');
    }
    const requested = new Map(requestedReferences.map((reference) => [reference.path, reference]));
    const returned = new Set<string>();
    return sources.flatMap((source) => {
      const path = safeSourcePath(source.path);
      const reference = path ? requested.get(path) : undefined;
      const lineCount = source.content === ''
        ? 0
        : source.content.split(/\r?\n/).length - (/\r?\n$/u.test(source.content) ? 1 : 0);
      if (
        !path ||
        !reference ||
        returned.has(path) ||
        !Number.isSafeInteger(source.startLine) ||
        source.startLine <= 0 ||
        typeof source.truncated !== 'boolean' ||
        (source.boundaryComplete !== undefined && source.boundaryComplete !== true) ||
        lineCount > REPAIR_SOURCE_LIMITS.maxLinesPerFile ||
        source.content.length > REPAIR_SOURCE_LIMITS.maxCharactersPerFile ||
        Buffer.byteLength(source.content, 'utf8') >
          REPAIR_SOURCE_LIMITS.maxBytesPerFile
      ) {
        throw new OrchestrationError(
          'Repository source port returned an unsafe or unbounded excerpt',
        );
      }
      returned.add(path);
      if (
        containsExternalTextRedaction(source.content) ||
        redactExternalText(source.content).count > 0
      ) return [];
      return [{
        path,
        startLine: source.startLine,
        content: source.content,
        truncated: source.truncated,
        ...(source.boundaryComplete === undefined ? {} : { boundaryComplete: source.boundaryComplete }),
      }];
    });
  };

  const roots = validateSources(
    references,
    await repository.readSourceExcerpts(checkoutDir, references, REPAIR_SOURCE_LIMITS),
  );
  for (const source of roots) accepted.set(source.path, source);
  let frontier = roots;
  for (let depth = 0; depth < 2 && frontier.length > 0 && accepted.size < REPAIR_SOURCE_LIMITS.maxFiles; depth += 1) {
    const next: RepairSourceContext['sources'] = [];
    const groups = sourceDependencyGroups(frontier, runtimeId, new Set(accepted.keys()));
    const resolved = new Map<string, RepairSourceContext['sources'][number] | null>();
    let candidateProbes = 0;
    for (let groupStart = 0; groupStart < groups.length;) {
      const remainingFiles = REPAIR_SOURCE_LIMITS.maxFiles - accepted.size - next.length;
      if (remainingFiles < 1) break;
      const window = groups.slice(groupStart, groupStart + remainingFiles);
      groupStart += window.length;
      const candidatesByGroup = window.map((group) => group.candidates.filter((path) =>
        policy === undefined || policyAllowsSourceRead(path, policy),
      ));
      const candidates = [...new Set(candidatesByGroup.flat())]
        .filter((path) => !resolved.has(path))
        .slice(0, MAX_DEPENDENCY_CANDIDATE_PROBES_PER_DEPTH - candidateProbes);
      candidateProbes += candidates.length;
      for (let start = 0; start < candidates.length; start += REPAIR_SOURCE_LIMITS.maxFiles) {
        const batch = candidates.slice(start, start + REPAIR_SOURCE_LIMITS.maxFiles).map((path) => ({ path }));
        for (const { path } of batch) resolved.set(path, null);
        for (const source of validateSources(
          batch,
          await repository.readSourceExcerpts(checkoutDir, batch, REPAIR_SOURCE_LIMITS),
        )) resolved.set(source.path, source);
      }
      for (const groupCandidates of candidatesByGroup) {
        if (!groupCandidates.every((path) => resolved.has(path))) continue;
        const matches = groupCandidates.flatMap((path) => resolved.get(path) ?? []);
        if (matches.length !== 1) continue;
        const match = matches[0]!;
        if (!accepted.has(match.path) && !next.some(({ path }) => path === match.path)) next.push(match);
      }
    }
    for (const source of next) accepted.set(source.path, source);
    frontier = next;
  }
  return {
    sources: [...accepted.values()],
  };
}

async function prepareReport(
  github: GitHubOrchestrationPort,
  run: FailingWorkflowRun,
  caseFile: CaseFile,
  marker: string,
): Promise<{ body: string; artifactUrl: string }> {
  const artifactName = `sutura-case-file-${run.runId}.html`;
  const artifact = await github.uploadCaseFile(
    artifactName,
    renderCaseFile(caseFile),
  );
  const body = `${marker}\n${renderComment(caseFile, artifact.url)}`;
  return { body, artifactUrl: artifact.url };
}

async function uploadReplay(
  github: GitHubOrchestrationPort,
  run: FailingWorkflowRun,
  caseFile: CaseFile,
  replay?: ReplayRecorder,
): Promise<void> {
  if (replay) {
    try {
      await github.uploadReplayBundle(
        `sutura-replay-${run.runId}.json`,
        JSON.stringify(replay.finish(caseFile.outcome)),
      );
    } catch {
      console.warn('Sutura could not upload the replay bundle.');
    }
  }
}

async function publishReport(
  github: GitHubOrchestrationPort,
  run: FailingWorkflowRun,
  caseFile: CaseFile,
  marker: string,
  target: AttemptTarget,
  checkoutDir: string,
  replay?: ReplayRecorder,
): Promise<void> {
  const report = await prepareReport(github, run, caseFile, marker);
  await github.updateAttempt(target, report.body);
  await github.completeCheck(target, { caseFile, artifactUrl: report.artifactUrl, checkoutDir });
  await uploadReplay(github, run, caseFile, replay);
}

export function resolveAuditedCandidate(
  caseFile: Pick<CaseFile, 'race' | 'selectedCandidate'>,
): CaseFile['race'][number] {
  const selected = caseFile.selectedCandidate;
  if (selected === undefined) {
    throw new OrchestrationError('Fixed case file does not identify its audited candidate');
  }
  const winner = findSelectedCandidate(caseFile.race, selected);
  if (winner === null) {
    throw new OrchestrationError('Fixed case file audited candidate identity is ambiguous');
  }
  return winner;
}

export async function orchestrate(ctx: OrchestrationContext): Promise<CaseFile> {
  const run = await ctx.github.getFailingRun(ctx.runId);
  validateRun(run, ctx.runId);
  const loadedPolicy = loadRepositoryPolicy(
    await ctx.repository.readPolicyAtSha(run.repo, run.baseSha),
  );
  const policyEvidence: PolicyEvidence = {
    baseRef: run.baseRef,
    baseSha: run.baseSha,
    policySha: loadedPolicy.sha,
  };
  const traceRecorder = new TraceRecorder(run.runId);
  traceRecorder.record({
    type: 'run-start', stage: 'run', summary: 'Sutura repair run started',
  });
  const stageLedger = new StageLedger(traceRecorder);
  stageLedger.record({
    stage: 'policy',
    attempt: 1,
    network: 'disabled',
    note: 'Repository policy validated before provider execution',
  });
  const marker = attemptMarker(run.runId);
  const failedLog = collectFailedLogs(run.failedSteps);
  const mechanical = classifyMechanically(failedLog);
  if (mechanical.failingCmd === 'unknown') {
    throw new OrchestrationError(
      'Failed-step logs do not contain an observed failing command',
    );
  }
  const target = await ctx.github.claimAttempt(run.prNumber, marker);
  if (target === null) {
    throw new AlreadyAttemptedError(run.runId);
  }

  const checkoutDir = await ctx.repository.checkoutHead(
    run.repo,
    run.headSha,
    run.headRef,
    run.prNumber,
  );
  if (
    ctx.runtimeId !== undefined &&
    loadedPolicy.policy.runtime !== undefined &&
    ctx.runtimeId !== loadedPolicy.policy.runtime
  ) {
    throw new OrchestrationError('Configured runtime conflicts with repository policy runtime');
  }
  const runtime = await detectRuntimeAtPath(
    checkoutDir,
    mechanical.failingCmd,
    ctx.runtimeId ?? loadedPolicy.policy.runtime,
    failedLog,
  );
  if (runtime.id === 'python' && ctx.imageRef !== undefined && ctx.imageRef !== runtime.imageRef) {
    throw new OrchestrationError('Python runtime image must use the verified exact digest');
  }
  const executionRecorder = loadedPolicy.policy.verification?.mode === 'required'
    ? new VerificationExecutionRecorder({ executor: ctx.executor, llm: ctx.llm, mode: ctx.evidenceMode ?? 'local' }) : undefined;
  const executor = new AllowlistedExecutor(executionRecorder?.executor ?? ctx.executor);
  const baseImage = await executor.importImage(
    ctx.imageRef ?? runtime.imageRef,
  );
  stageLedger.record({
    stage: 'preparation',
    attempt: 0,
    network: 'disabled',
    imageId: baseImage,
    note: 'Base image imported',
  });
  const setup = await prepareSandbox(
    executor,
    checkoutDir,
    baseImage,
    mechanical.failingCmd,
    stageLedger,
    runtime,
    (loadedPolicy.policy.verification?.contracts.length ?? 0) > 0
      ? () => freezeRepositorySource(ctx.repository, checkoutDir, ctx.replay)
      : false,
  );
  if (!setup.ok) {
    const caseFile = preparationFailureCaseFile(
      {
        runId: run.runId,
        repo: run.repo,
        cost: ctx.cost,
        policyEvidence,
        stageLedger,
        traceRecorder,
        runtime,
      },
      setup.command,
      setup.result,
    );
    await publishReport(ctx.github, run, caseFile, marker, target, checkoutDir, ctx.replay);
    return caseFile;
  }
  try {
  const reproduction = await executor.run(
    setup.imageId,
    sandboxTargetCommand(mechanical.failingCmd, runtime),
    { cwd: SNAPSHOT_CWD },
  );
  stageLedger.record({
    stage: 'reproduction',
    attempt: 1,
    network: 'disabled',
    result: reproduction,
    parentImageId: setup.imageId,
    note: 'Observed failing command reproduction',
  });

  if (reproduction.exitCode === 0) {
    const caseFile = noReproductionCaseFile(
      {
        runId: run.runId,
        repo: run.repo,
        cost: ctx.cost,
        policyEvidence,
        stageLedger,
        traceRecorder,
        runtime,
      },
      mechanical,
    );
    await publishReport(ctx.github, run, caseFile, marker, target, checkoutDir, ctx.replay);
    return caseFile;
  }

  const caseFile = await repairFailure({
    ...(executionRecorder === undefined ? {} : { executionRecorder }),
    evidenceMode: ctx.evidenceMode ?? 'local',
    runId: run.runId,
    repo: run.repo,
    failedLog,
    failingImage: setup.imageId,
    executor,
    llm: ctx.llm,
    cost: ctx.cost,
    triageN: ctx.triageN,
    raceK: ctx.raceK,
    ...(ctx.repairBudgets === undefined ? {} : { repairBudgets: ctx.repairBudgets }),
    ...(ctx.search === undefined ? {} : { search: ctx.search }),
    sourceIdentity: { kind: 'git', sourceSha: run.headSha, policyBaseSha: run.baseSha, snapshotSha256: setup.snapshotSha256 ?? null },
    readSourceContext: (_log, diagnosis, _runtime, competingClasses) => readRepairSourceContext(
      ctx.repository,
      setup.sourceDir ?? checkoutDir,
      failedLog,
      diagnosis,
      loadedPolicy.policy,
      runtime.id,
      ctx.sourceReferenceOrder,
      competingClasses,
    ),
    policy: loadedPolicy.policy,
    policyEvidence,
    stageLedger,
    traceRecorder,
    runtime,
    ...(ctx.repairVerificationScope === undefined
      ? {}
      : { repairVerificationScope: ctx.repairVerificationScope }),
    ...(ctx.tavily ? { tavily: ctx.tavily } : {}),
    ...(ctx.lockfileDiff === undefined
      ? {}
      : { lockfileDiff: ctx.lockfileDiff }),
  });
  if (caseFile.outcome !== 'fixed') {
    await publishReport(ctx.github, run, caseFile, marker, target, checkoutDir, ctx.replay);
    return caseFile;
  }

  const winner = resolveAuditedCandidate(caseFile);
  const branch = `sutura/fix-${run.runId}`;
  const report = await prepareReport(ctx.github, run, caseFile, marker);
  await ctx.repository.publishFix({
    branch,
    checkoutDir,
    diff: winner.candidate.diff,
    headSha: run.headSha,
    message: FIX_COMMIT_MESSAGE,
  });
  await ctx.github.createFixPullRequest({
    baseRef: run.headRef,
    branch,
    body: report.body,
    headSha: run.headSha,
    title: 'fix: repair CI failure with Sutura',
  });
  await ctx.github.updateAttempt(target, report.body);
  await ctx.github.completeCheck(target, {
    caseFile,
    artifactUrl: report.artifactUrl,
    checkoutDir,
  });
  await uploadReplay(ctx.github, run, caseFile, ctx.replay);
  return caseFile;
  } finally { await setup.cleanup?.(); }
}
