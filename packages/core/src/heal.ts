import { VerificationExecutionRecorder } from './verification/execution-record.js';
import { GeneratedVerificationRecorder } from './verification/generated-record.js';
import type { VerificationMode } from './verification/types.js';
import { snapshotSelectedSource, readBoundedRegularFile, MAX_SNAPSHOT_FILE_BYTES } from './verification/source.js';
import { listSnapshotFiles } from './executor/contree.js';
import { join } from 'node:path';
import { parseRuntimeCandidateEvidence, type RuntimeCandidateEvidence } from './verification/runtime-evidence.js';
import { challengeSubjectRecords } from './challenges/runner.js';
import { canonicalJson } from './replay/canonical-json.js';
import { evaluateRuntimeCandidate, type RuntimeCandidateResult } from './verification/runtime.js';
import { prepareRuntimeChallenges, type PreparedRuntimeChallenges } from './challenges/runtime.js';
import { runMechanicalChecks } from './audit/mechanical.js';
import { budgetedRecoveryPorts, reserveRecoveryAudit, withinRecoveryDeadline } from './diagnose/hypotheses-budget.js';
import { recoverDiagnosis, recoverySourceClasses, type DiagnosisRecoveryEvidence } from './diagnose/hypotheses.js';
import { authorizeRepairCandidate, type RepairAuthorizationContext, type ControllerBaselineBinding } from './engine/repair-authorization.js';
import { classify, classifyMechanically } from './diagnose/classify.js';
import {
  ground,
  promoteUpstreamDependencyDiagnosis,
  type TavilySearch,
} from './diagnose/tavily.js';
import type {
  Candidate,
  CaseFile,
  CostLedger,
  Diagnosis,
  FailureClass,
  PolicyEvidence,
  RaceResult,
  SearchEvidence,
  StageEvidence,
  StageName,
} from './domain.js';
import { MAX_STAGE_EVIDENCE_ENTRIES } from './config.js';
import { vetPatch } from './engine/patch-rules.js';
import { parseUnifiedDiff } from './diff/unified.js';
import { repairTargetFileCap } from './engine/repair-targets.js';
import {
  race,
  selectWinner,
  type RepairLlm,
  type RepairSourceContext,
} from './engine/repair.js';
import {
  controlledRepairAttemptReservationUsd,
  recoveryRepairReservationUsd,
  prepareControlledRepairProposalTemplate,
  RepairProposalPreparationError,
  runControlledRepairAttempt,
  REPAIR_ATTEMPT_COSTS,
  type ControlledRepairAttemptContext,
  type ControlledRepairProposalTemplate,
} from './engine/repair-attempt.js';
import { validateCandidateDiff } from './engine/candidate-validation.js';
import { candidateIdentity } from './engine/candidate-identity.js';
import { diffFingerprint } from './engine/fingerprint.js';
import {
  RepairBudget,
  BudgetExceededError,
  repairBudgetLimits,
  type RepairBudgetOverrides,
} from './engine/repair-budget.js';
import { adaptiveSearch, DEFAULT_SEARCH_LIMITS, type SearchNode } from './engine/search.js';
import type { SearchLimits } from './config.js';
import {
  sandboxExecutableCommand,
  sandboxTargetCommand,
} from './engine/sandbox-command.js';
import { shellQuote } from './engine/shell.js';
import { triage } from './engine/triage.js';
import { notRunTriageVerdict } from './engine/triage.js';
import {
  SNAPSHOT_CWD,
  type Executor,
  type CancellationResult,
  type ImageId,
  type OperationCapacity,
  type OperationTerminal,
  type RunOptions,
  type RunResult,
  type SnapshotOptions,
} from './executor/types.js';
import type { AuditLlm } from './audit/audit.js';
import type { DiagnosisLlm } from './diagnose/classify.js';
import type { CapacitySnapshot } from './llm/types.js';
import type { ChatMessage, ChatOptions, TierLlm } from './llm/types.js';
import type { ModelTier } from './llm/cost.js';
import { createHash } from 'node:crypto';
import { evaluateCounterfactuals } from './counterfactual/evaluate.js';
import type {
  CounterfactualAlternative,
  CounterfactualEvidence,
} from './counterfactual/types.js';
import {
  evaluatePatchPolicy,
  filterPolicyDeniedText,
} from './policy/evaluate.js';
import { createDefaultRepositoryPolicy } from './policy/load.js';
import type { RepositoryPolicy } from './policy/schema.js';
import { boundedTail } from './text/bounded-tail.js';
import { TraceRecorder } from './trace/recorder.js';
import { detectRuntimeAtPath } from './runtime/detect.js';
import { NODE_IMAGE_REF, NODE_RUNTIME, nodePreparationCommand } from './runtime/node.js';
import type { RuntimeAdapter, RuntimeId } from './runtime/types.js';

export const SUTURA_DEFAULT_IMAGE_REF = NODE_IMAGE_REF;
/**
 * The command Sutura reproduces when no failing command was observed. The
 * Action always passes the command extracted from the CI log; the CLI and the
 * benchmark pass one explicitly or fall back here per runtime.
 */
export function defaultFailureCommand(runtimeId: RuntimeId | undefined): string {
  return runtimeId === 'python' ? 'python -m unittest' : 'pnpm test';
}
const DEPENDENCY_INSTALL_COMMAND = /(?:^|(?:&&|;|\|\|)\s*)(?:(?:corepack\s+)?pnpm\s+(?:install|i)\b|npm\s+(?:ci|install|i)\b|(?:corepack\s+)?yarn\s+(?:install\b|--immutable\b))/iu;

export const SUTURA_SANDBOX_ENV = Object.freeze({
  CI: 'true',
  NODE_ENV: 'test',
});

export type HealLlm = DiagnosisLlm & RepairLlm & AuditLlm;
export type RepairVerificationScope = 'full' | 'failing-workspace';

export interface RepairFailureContext {
  runId: string;
  repo: string;
  failedLog: string;
  failingImage: ImageId;
  executor: Executor;
  llm: HealLlm;
  cost: CostLedger;
  triageN: number;
  raceK: number;
  repairBudgets?: RepairBudgetOverrides;
  search?: SearchLimits;
  tavily?: TavilySearch;
  lockfileDiff?: string;
  dependencyHints?: readonly string[];
  candidateDiff?: string;
  counterfactuals?: readonly CounterfactualAlternative[];
  policy?: RepositoryPolicy;
  policyEvidence?: PolicyEvidence;
  stageLedger?: StageLedger;
  traceRecorder?: TraceRecorder;
  runtime?: RuntimeAdapter;
  repairVerificationScope?: RepairVerificationScope;
  /** Trusted checkout identity; sandbox initialization commits are never source provenance. */
  sourceIdentity?: Pick<Extract<ControllerBaselineBinding, { kind: 'git' }>, 'kind' | 'sourceSha' | 'policyBaseSha' | 'snapshotSha256'>
    | Pick<Extract<ControllerBaselineBinding, { kind: 'local-snapshot' }>, 'kind' | 'sourceSha' | 'policyBaseSha' | 'snapshotSha256'>;
  recovery?: DiagnosisRecoveryEvidence;
  preparedChallenges?: PreparedRuntimeChallenges;
  verificationRuns?: RuntimeCandidateEvidence[];
  evidenceMode?: VerificationMode;
  generatedVerification?: GeneratedVerificationRecorder;
  executionRecorder?: VerificationExecutionRecorder;
  readSourceContext(
    log: string,
    diagnosis: Diagnosis,
    runtime?: RuntimeAdapter,
    competingClasses?: readonly FailureClass[],
  ): Promise<RepairSourceContext>;
}

export interface HealCaseContext extends Omit<
  RepairFailureContext,
  'failedLog' | 'failingImage'
> {
  caseDir: string;
  imageRef?: string;
  failureCommand?: string;
  runtimeId?: RuntimeId;
}

export class HealCaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HealCaseError';
  }
}

interface StageRecord {
  stage: StageName;
  attempt: number;
  network: StageEvidence['network'];
  result?: RunResult;
  imageId?: ImageId;
  parentImageId?: ImageId;
  note?: string;
  operation?: {
    operationId: string;
    terminal?: OperationTerminal;
    cancellationRequested: boolean;
  };
}

function publicMetrics(metrics: RunResult['metrics'] | undefined): RunResult['metrics'] {
  if (!metrics) return {};
  return Object.fromEntries(
    Object.entries(metrics).filter(([, value]) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0,
    ),
  );
}

export class StageLedger {
  private readonly evidence: StageEvidence[] = [];
  private readonly imageNodes = new Map<ImageId, string>();

  constructor(private readonly trace?: TraceRecorder) {}

  record(input: StageRecord): string {
    if (this.evidence.length >= MAX_STAGE_EVIDENCE_ENTRIES) {
      throw new HealCaseError('Stage evidence exceeds the bounded entry count');
    }
    const nodeId = `node-${String(this.evidence.length + 1).padStart(3, '0')}`;
    const imageId = input.result?.imageId ?? input.imageId;
    const parentNodeId = input.parentImageId === undefined
      ? undefined
      : this.imageNodes.get(input.parentImageId);
    if (imageId !== undefined) this.imageNodes.set(imageId, nodeId);
    const note = input.note
      ?.replace(/[\u0000-\u001f\u007f]/gu, ' ')
      .slice(0, 240);
    const operation = input.result?.operation ?? input.operation;
    this.evidence.push({
      stage: input.stage,
      attempt: input.attempt,
      nodeId,
      ...(parentNodeId === undefined ? {} : { parentNodeId }),
      ...(input.result === undefined ? {} : { exitCode: input.result.exitCode }),
      ...(operation === undefined ? {} : {
        operationId: operation.operationId,
        ...(operation.terminal === undefined ? {} : { operationTerminal: operation.terminal }),
        cancellationRequested: operation.cancellationRequested,
      }),
      metrics: publicMetrics(input.result?.metrics),
      network: input.network,
      ...(note === undefined || note === '' ? {} : { note }),
    });
    if (imageId !== undefined || input.result !== undefined || operation !== undefined) {
      this.trace?.record({
        type: 'sandbox-operation',
        stage: input.stage,
        operation: operation?.operationId ?? input.stage,
        resultSummary: note ?? `Sandbox ${input.stage} operation`,
        childNodeId: nodeId,
      });
    }
    return nodeId;
  }

  entries(): StageEvidence[] {
    return this.evidence.map((entry) => ({
      ...entry,
      metrics: { ...entry.metrics },
    }));
  }
}

function ensureTraceStarted(trace: TraceRecorder): void {
  if (trace.events().length === 0) {
    trace.record({ type: 'run-start', stage: 'run', summary: 'Sutura repair run started' });
  }
}

export function tracedLlm(llm: HealLlm, trace: TraceRecorder): HealLlm {
  const delegate = llm as TierLlm<ModelTier>;
  return {
    capacitySnapshot: () => delegate.capacitySnapshot?.(),
    modelId: (tier: ModelTier) => delegate.modelId?.(tier) ?? tier,
    modelQuote: (tier: ModelTier, messages: readonly ChatMessage[], options?: ChatOptions) => {
      const quote = delegate.modelQuote?.(tier, messages, options);
      if (quote === undefined) throw new Error('Model routing quote is unavailable');
      return quote;
    },
    async chat(tier: ModelTier, messages: readonly ChatMessage[], options?: ChatOptions) {
      const model = options?.quotedRoute?.modelId ?? delegate.modelQuote?.(tier, messages, options)?.modelId ??
        delegate.modelId?.(tier) ?? tier;
      const serializedPrompt = JSON.stringify(messages);
      const systemPrompt = messages.find(({ role }) => role === 'system');
      const promptExcerpt = typeof systemPrompt?.content === 'string'
        ? systemPrompt.content.slice(0, 160)
        : '[no public system prompt]';
      trace.record({
        type: 'model-request',
        stage: tier === 'nano' ? 'triage' : tier === 'ultra' ? 'audit' : 'candidate',
        role: 'user',
        model,
        summary: `Model request with ${messages.length} messages and ${Buffer.byteLength(serializedPrompt, 'utf8')} bytes`,
        promptHash: createHash('sha256').update(serializedPrompt).digest('hex'),
        promptExcerpt,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        latencyMs: 0,
        costUsd: 0,
        requestId: null,
      });
      const reply = await delegate.chat(tier, messages, options);
      const usage = reply.usage ?? { inTok: 0, outTok: 0, reasoningTok: 0 };
      trace.record({
        type: 'model-response',
        stage: tier === 'nano' ? 'triage' : tier === 'ultra' ? 'audit' : 'candidate',
        role: 'assistant',
        model: reply.model ?? model,
        summary: tier === 'super'
          ? `Structured repair response ${createHash('sha256').update(reply.text).digest('hex')} (${Buffer.byteLength(reply.text, 'utf8')} bytes)`
          : reply.text,
        inputTokens: usage.inTok,
        outputTokens: usage.outTok,
        reasoningTokens: usage.reasoningTok,
        latencyMs: reply.latencyMs ?? 0,
        costUsd: reply.usd ?? 0,
        requestId: reply.requestId ?? reply.capacity?.requestId ?? null,
      });
      return reply;
    },
  } as HealLlm;
}

function publicSearchEvidence(nodes: readonly SearchNode[]): SearchEvidence[] {
  return nodes.map((node) => ({
    nodeId: node.id,
    ...(node.parentId === undefined ? {} : { parentNodeId: node.parentId }),
    depth: node.depth,
    errorFingerprint: node.errorFingerprint,
    transcriptReference: node.transcriptReference,
    ...(node.terminalReason === undefined ? {} : { terminalReason: node.terminalReason }),
    testExitCode: node.testEvidence.exitCode,
    policyValid: node.policyEvidence.valid,
    changedFiles: node.policyEvidence.changedFiles.length,
    diffBytes: node.policyEvidence.diffBytes,
  }));
}

function providerCapacityAvailable(capacity: CapacitySnapshot | undefined): number {
  if (!capacity) return Number.MAX_SAFE_INTEGER;
  if (capacity.retryAfterSec !== null && capacity.retryAfterSec > 0) return 0;
  if (capacity.remainingRequests === 0 || capacity.remainingTokens === 0) return 0;
  return capacity.remainingRequests ?? Number.MAX_SAFE_INTEGER;
}

function policyFor(ctx: Pick<RepairFailureContext, 'policy'>): RepositoryPolicy {
  return ctx.policy ?? createDefaultRepositoryPolicy();
}

function policyEvidenceFor(
  ctx: Pick<RepairFailureContext, 'policyEvidence'>,
): PolicyEvidence {
  return ctx.policyEvidence ?? {
    baseRef: 'local',
    baseSha: 'local',
    policySha: 'default',
  };
}

function sandboxOptions(opts?: RunOptions): RunOptions {
  return {
    ...opts,
    env: SUTURA_SANDBOX_ENV,
    network: 'disabled',
  };
}

export class AllowlistedExecutor implements Executor {
  constructor(private readonly delegate: Executor) {}

  importImage(ref: string): Promise<ImageId> {
    return this.delegate.importImage(ref);
  }

  snapshot(
    dir: string,
    base: ImageId,
    options: SnapshotOptions,
  ): Promise<ImageId> {
    return this.delegate.snapshot(dir, base, options);
  }

  run(parent: ImageId, cmd: string, opts?: RunOptions): Promise<RunResult> {
    return this.delegate.run(parent, cmd, sandboxOptions(opts));
  }

  runMany(parent: ImageId, cmds: string[], opts?: RunOptions): Promise<RunResult[]> {
    return this.delegate.runMany(parent, cmds, sandboxOptions(opts));
  }

  operationCapacity(): OperationCapacity {
    return this.delegate.operationCapacity();
  }

  cancel(operationId: string): Promise<CancellationResult> {
    return this.delegate.cancel(operationId);
  }

  prepareDependencies(parent: ImageId, command = sandboxPreparationCommand()): Promise<RunResult> {
    return this.delegate.run(parent, command, {
      ...sandboxOptions({ cwd: SNAPSHOT_CWD }),
      network: 'enabled',
    });
  }
}

function noReproductionDiagnosis(mechanical: Diagnosis): Diagnosis {
  return {
    ...mechanical,
    class: 'infra',
    confidence: 1,
    signals: [...mechanical.signals, 'reproduction:passed'],
    errorExcerpt: 'The failing command passed in a clean sandbox reproduction.',
  };
}

export function noReproductionCaseFile(
  ctx: Pick<
    HealCaseContext,
    'runId' | 'repo' | 'cost' | 'policyEvidence' | 'stageLedger' | 'traceRecorder' | 'runtime'
  >,
  mechanical: Diagnosis,
): CaseFile {
  return makeCaseFile(
    ctx,
    noReproductionDiagnosis(mechanical),
    notRunTriageVerdict(),
    [],
    'infra-stop',
  );
}

export function preparationFailureCaseFile(
  ctx: Pick<
    HealCaseContext,
    'runId' | 'repo' | 'cost' | 'policyEvidence' | 'stageLedger' | 'traceRecorder' | 'runtime'
  >,
  command: string,
  result: RunResult,
): CaseFile {
  const excerpt = boundedTail(
    [result.stdout, result.stderr].filter(Boolean).join('\n'),
    { maxLines: 20, maxCharacters: 2_000, maxBytes: 2_000 },
  ).trim();
  return makeCaseFile(
    ctx,
    {
      class: 'infra',
      confidence: 1,
      signals: ['sandbox-preparation:failed'],
      failingCmd: command,
      errorExcerpt: excerpt || 'Sandbox dependency preparation failed.',
    },
    notRunTriageVerdict(),
    [],
    'infra-stop',
  );
}

export function sandboxPreparationCommand(): string {
  return nodePreparationCommand();
}

const DEPENDENCY_SNAPSHOT = Object.freeze({
  profile: 'dependency-inputs' as const,
  mode: 'replace' as const,
});
const REPOSITORY_SNAPSHOT = Object.freeze({
  profile: 'repository' as const,
  mode: 'overlay' as const,
});

interface SandboxRepositoryInitializationPaths {
  manifestPath: string;
  templatePath: string;
}

const DEFAULT_REPOSITORY_INITIALIZATION_PATHS = {
  manifestPath: '/tmp/sutura-repository-overlay.manifest',
  templatePath: '/tmp/sutura-empty-git-template',
} satisfies SandboxRepositoryInitializationPaths;

function sandboxRepositoryInitializationCommand(
  paths: SandboxRepositoryInitializationPaths = DEFAULT_REPOSITORY_INITIALIZATION_PATHS,
  runtime: RuntimeAdapter = NODE_RUNTIME,
): string {
  const commands = [
    `mkdir -p ${shellQuote(paths.templatePath)}`,
    `git init --quiet --template=${shellQuote(paths.templatePath)}`,
    'git config core.hooksPath /dev/null',
    'git config user.email sutura@users.noreply.github.com',
    'git config user.name Sutura',
    `git --literal-pathspecs add --pathspec-from-file=${shellQuote(paths.manifestPath)} --pathspec-file-nul`,
    'git -c core.hooksPath=/dev/null commit --quiet --no-verify -m "chore: initialize Sutura sandbox baseline"',
    ...(runtime.id === 'node' ? ['if [ -f pnpm-lock.yaml ]; then corepack pnpm rebuild; elif [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then npm rebuild; elif [ -f yarn.lock ]; then sutura_yarn_version="$(corepack yarn --version)"; case "$sutura_yarn_version" in 0.*|1.*) npm rebuild ;; 2.*|3.*|4.*) corepack yarn rebuild ;; *) echo "unsupported Yarn version: $sutura_yarn_version" >&2; exit 69 ;; esac; else true; fi'] : []),
  ];
  return `sh -lc ${shellQuote(commands.join(' && '))}`;
}

const INITIALIZE_REPOSITORY_COMMAND = sandboxRepositoryInitializationCommand();

export function buildSandboxRepositoryInitializationCommandForTest(
  paths: SandboxRepositoryInitializationPaths,
): string {
  return sandboxRepositoryInitializationCommand(paths);
}

export type SandboxSetupResult =
  | { ok: true; imageId: ImageId; snapshotSha256?: string; sourceDir?: string; cleanup?: () => Promise<void> }
  | { ok: false; command: string; result: RunResult };

export interface FrozenVerificationSource {
  dir: string;
  snapshotSha256: string;
  cleanup(): Promise<void>;
}

export async function freezeSandboxSource(dir: string): Promise<FrozenVerificationSource> {
  const files = (await listSnapshotFiles(dir, 'repository')).sort();
  const frozen = await snapshotSelectedSource(dir, files, async () => {
    const current = (await listSnapshotFiles(dir, 'repository')).sort();
    if (canonicalJson(current) !== canonicalJson(files)) throw new HealCaseError('Source manifest changed during freezing');
  });
  return frozen;
}

export async function prepareSandbox(
  executor: AllowlistedExecutor,
  dir: string,
  baseImage: ImageId,
  observedCommand: string,
  stages?: StageLedger,
  runtime: RuntimeAdapter = NODE_RUNTIME,
  freezeSource: boolean | (() => Promise<FrozenVerificationSource>) = false,
): Promise<SandboxSetupResult> {
  if (!freezeSource) return prepareSandboxFromSource(executor, dir, baseImage, observedCommand, stages, runtime);
  const frozen = await (typeof freezeSource === 'function' ? freezeSource() : freezeSandboxSource(dir));
  try {
    const setup = await prepareSandboxFromSource(executor, frozen.dir, baseImage, observedCommand, stages, runtime);
    if (!setup.ok) { await frozen.cleanup(); return setup; }
    return { ...setup, snapshotSha256: frozen.snapshotSha256, sourceDir: frozen.dir, cleanup: frozen.cleanup };
  } catch (error) {
    await frozen.cleanup();
    throw error;
  }
}

async function prepareSandboxFromSource(
  executor: AllowlistedExecutor, dir: string, baseImage: ImageId, observedCommand: string,
  stages: StageLedger | undefined, runtime: RuntimeAdapter,
): Promise<SandboxSetupResult> {
  let dependencyPreparation;
  try {
    dependencyPreparation = await runtime.dependencyInputs(dir);
  } catch (error) {
    return {
      ok: false,
      command: runtime.preparationCommand,
      result: {
        imageId: baseImage,
        exitCode: 69,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        truncated: false,
        metrics: {},
      },
    };
  }
  const dependencyImage = await executor.snapshot(
    dir,
    baseImage,
    runtime.id === 'node'
      ? DEPENDENCY_SNAPSHOT
      : { ...DEPENDENCY_SNAPSHOT, includePaths: dependencyPreparation.paths },
  );
  stages?.record({
    stage: 'preparation',
    attempt: 1,
    network: 'disabled',
    imageId: dependencyImage,
    parentImageId: baseImage,
    note: 'Dependency inputs snapshot created',
  });
  const preparationCommand = runtime.id === 'node'
    ? dependencyPreparation.command
    : `sh -lc ${shellQuote(dependencyPreparation.command)}`;
  const preparation = await executor.prepareDependencies(dependencyImage, preparationCommand);
  stages?.record({
    stage: 'preparation',
    attempt: 2,
    network: 'enabled',
    result: preparation,
    parentImageId: dependencyImage,
    note: `${runtime.id} dependencies prepared without repository hooks`,
  });
  if (preparation.exitCode !== 0) {
    return {
      ok: false,
      command: DEPENDENCY_INSTALL_COMMAND.test(observedCommand)
        ? observedCommand
        : preparationCommand,
      result: preparation,
    };
  }
  const sourceImage = await executor.snapshot(
    dir,
    preparation.imageId,
    REPOSITORY_SNAPSHOT,
  );
  stages?.record({
    stage: 'preparation',
    attempt: 3,
    network: 'disabled',
    imageId: sourceImage,
    parentImageId: preparation.imageId,
    note: 'Repository source overlay created',
  });
  const initialized = await executor.run(
    sourceImage,
    runtime.id === 'node'
      ? INITIALIZE_REPOSITORY_COMMAND
      : sandboxRepositoryInitializationCommand(DEFAULT_REPOSITORY_INITIALIZATION_PATHS, runtime),
    { cwd: SNAPSHOT_CWD },
  );
  stages?.record({
    stage: 'preparation',
    attempt: 4,
    network: 'disabled',
    result: initialized,
    parentImageId: sourceImage,
    note: 'Hook-disabled Git baseline initialized',
  });
  if (initialized.exitCode !== 0) {
    return { ok: false, command: INITIALIZE_REPOSITORY_COMMAND, result: initialized };
  }
  return { ok: true, imageId: initialized.imageId };
}

export { sandboxExecutableCommand, sandboxTargetCommand };

const PNPM_RECURSIVE_TEST_COMMAND = /^pnpm\s+(?:-r|--recursive)\s+test$/u;
const PNPM_WORKSPACE_TEST_FAILURE = /\b(packages\/[A-Za-z0-9_@./-]+)\s+test:.*(?:\bFAIL\b|AssertionError|\bfailed\b)/iu;

export function repairVerificationCommand(
  diagnosis: Diagnosis,
  failedLog = diagnosis.errorExcerpt,
  scope: RepairVerificationScope = 'failing-workspace',
): string {
  const command = diagnosis.failingCmd.trim();
  if (scope === 'full' || !PNPM_RECURSIVE_TEST_COMMAND.test(command)) return command;
  const workspaces = new Set(
    failedLog
      .split(/\r?\n/u)
      .flatMap((line) => line.match(PNPM_WORKSPACE_TEST_FAILURE)?.[1] ?? []),
  );
  if (workspaces.size !== 1) return command;
  const workspace = [...workspaces][0]!;
  if (workspace.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    return command;
  }
  return `pnpm --filter ./${workspace} test`;
}

function withGrounding(
  diagnosis: Diagnosis,
  grounding: Awaited<ReturnType<typeof ground>>,
): Diagnosis {
  return { ...diagnosis, grounding };
}

function vettedRaceResult(
  candidate: Candidate,
  violations: readonly string[],
  nodeId: string,
): RaceResult {
  return {
    candidate,
    imageId: nodeId,
    nodeId,
    exitCode: 1,
    held: false,
    note: `Patch vet refused: ${violations.join('; ')}`,
  };
}

function makeCaseFile(
  ctx: Pick<
    RepairFailureContext,
    | 'runId'
    | 'repo'
    | 'cost'
    | 'policyEvidence'
    | 'stageLedger'
    | 'traceRecorder'
    | 'runtime'
    | 'recovery'
    | 'verificationRuns'
  >,
  diagnosis: Diagnosis,
  triageVerdict: CaseFile['triage'],
  raceResults: RaceResult[],
  outcome: CaseFile['outcome'],
  auditVerdict?: CaseFile['audit'],
  search?: SearchEvidence[],
  selectedCandidate?: Candidate,
  counterfactual?: CounterfactualEvidence,
): CaseFile {
  const trace = ctx.traceRecorder;
  if (auditVerdict !== undefined) {
    trace?.record({
      type: 'audit-result',
      stage: 'audit',
      approved: auditVerdict.approved,
      summary: auditVerdict.reasoning,
      ...(raceResults[0]?.nodeId === undefined ? {} : { childNodeId: raceResults[0].nodeId }),
    });
  }
  if (trace !== undefined && trace.events().at(-1)?.type !== 'run-finish') {
    trace.record({ type: 'run-finish', stage: 'run', outcome });
  }
  return {
    runId: ctx.runId,
    repo: ctx.repo,
    runtime: (ctx.runtime ?? NODE_RUNTIME).id,
    diagnosis,
    triage: triageVerdict,
    race: raceResults.map((result) => ({
      ...result,
      imageId: result.nodeId,
    })),
    ...(auditVerdict ? { audit: auditVerdict } : {}),
    ...(selectedCandidate === undefined ? {} : {
      selectedCandidate: candidateIdentity(selectedCandidate),
    }),
    outcome,
    ...(ctx.recovery === undefined ? {} : { recovery: ctx.recovery }),
    ...(ctx.verificationRuns === undefined ? {} : { verificationRuns: ctx.verificationRuns }),
    cost: ctx.cost,
    policy: policyEvidenceFor(ctx),
    stages: ctx.stageLedger?.entries() ?? [],
    ...(search === undefined ? {} : { search }),
    ...(counterfactual === undefined ? {} : { counterfactual }),
    ...(trace === undefined ? {} : { trace: trace.events() }),
  };
}

/**
 * Every gate a candidate must pass before it is raced, whoever wrote it.
 *
 * The transaction file cap is applied here rather than only in the repair
 * tools, because a supplied patch never passes through them. Without it a
 * supplied candidate could change more files than a generated one is allowed
 * to, which is how trap-two-file-third-path was approved live on 2026-09-07.
 */
export function policyVerdictForTest(
  candidate: Candidate,
  diagnosis: Diagnosis,
  policy: RepositoryPolicy,
): ReturnType<typeof vetPatch> {
  return policyVerdict(candidate, diagnosis, policy);
}

function policyVerdict(
  candidate: Candidate,
  diagnosis: Diagnosis,
  policy: RepositoryPolicy,
): ReturnType<typeof vetPatch> {
  const builtIn = vetPatch(candidate.diff, diagnosis);
  if (!builtIn.ok) return builtIn;
  const repositoryVerdict = evaluatePatchPolicy(candidate.diff, policy);
  if (!repositoryVerdict.ok) return repositoryVerdict;
  const parsed = parseUnifiedDiff(candidate.diff);
  const changedFiles = [...new Set(parsed.files.flatMap(({ oldPath, newPath }) =>
    [oldPath, newPath].filter((path): path is string => path !== null)))];
  const cap = repairTargetFileCap(policy);
  if (changedFiles.length > cap) {
    return {
      ok: false,
      violations: [
        `changes ${changedFiles.length} files; the repair transaction permits at most ${cap}`,
      ],
    };
  }
  return repositoryVerdict;
}

async function counterfactualEvidence(
  ctx: RepairFailureContext,
  ledger: StageLedger,
  diagnosis: Diagnosis,
  providerLog: string,
  verificationCommand: string,
  acceptedCandidateId?: string,
): Promise<CounterfactualEvidence | undefined> {
  const alternatives = ctx.counterfactuals;
  if (alternatives === undefined || alternatives.length === 0) return undefined;
  const policy = policyFor(ctx);
  return evaluateCounterfactuals({
    executor: ctx.executor,
    llm: ctx.llm,
    baselineImageId: ctx.failingImage,
    diagnosis,
    policy,
    runtime: ctx.runtime ?? NODE_RUNTIME,
    beforeLog: providerLog,
    verificationCommand,
    diffBytesLimit: policy.maxDiffBytes,
    alternatives,
    ...(ctx.preparedChallenges === undefined ? {} : { prepared: ctx.preparedChallenges }),
    ...(acceptedCandidateId === undefined ? {} : { acceptedCandidateId }),
    cost: ctx.cost,
    ledger,
    ...(ctx.traceRecorder === undefined ? {} : { trace: ctx.traceRecorder }),
  });
}

export async function repairFailure(ctx: RepairFailureContext): Promise<CaseFile> {
  const policy = policyFor(ctx);
  const generated = policy.verification?.mode === 'required' ? new GeneratedVerificationRecorder({
    executor: ctx.executor, llm: ctx.llm, baselineImageId: ctx.failingImage, policy,
    policySha256: /^[a-f0-9]{64}$/u.test(ctx.policyEvidence?.policySha ?? '') ? ctx.policyEvidence!.policySha : createHash('sha256').update(canonicalJson(policy)).digest('hex'),
    mode: ctx.evidenceMode ?? 'local',
    ...(ctx.executionRecorder === undefined ? {} : { executionRecorder: ctx.executionRecorder }),
    ...(ctx.sourceIdentity === undefined ? {} : { sourceIdentity: ctx.sourceIdentity }),
  }) : undefined;
  if (generated) ctx = { ...ctx, executor: generated.executor, llm: generated.llm, generatedVerification: generated };
  const configuredBudgets = repairBudgetLimits(ctx.repairBudgets);
  const budget = new RepairBudget({
    ...configuredBudgets,
    diffBytes: Math.min(configuredBudgets.diffBytes, policy.maxDiffBytes),
  });
  const trace = ctx.traceRecorder ?? new TraceRecorder(ctx.runId);
  const ledger = ctx.stageLedger ?? new StageLedger(trace);
  const fullContext = {
    ...ctx, policy, llm: tracedLlm(ctx.llm, trace),
    stageLedger: ledger, traceRecorder: trace,
  };
  const charged = budgetedRecoveryPorts({ budget, llm: fullContext.llm, executor: ctx.executor, operationIdPrefix: `repair-${ctx.runId}-initial` });
  const progress: { diagnosis?: Diagnosis; triage?: CaseFile['triage'] } = {};
  try {
    const file = await repairFailureWithinBudget(fullContext, budget, charged, progress);
    return generated?.attach(file) ?? file;
  } catch (error) {
    if (!(error instanceof BudgetExceededError)) throw error;
    ensureTraceStarted(trace);
    ledger.record({ stage: 'search', attempt: 1, network: 'disabled', note: `Budget abstention: ${error.message}` });
    const file = makeCaseFile(fullContext, progress.diagnosis ?? classifyMechanically(ctx.failedLog),
      progress.triage ?? notRunTriageVerdict(), [], 'gave-up');
    return generated?.attach(file) ?? file;
  }
}

async function repairFailureWithinBudget(
  ctx: RepairFailureContext,
  budget: RepairBudget,
  charged: { executor: Executor; llm: HealLlm },
  progress: { diagnosis?: Diagnosis; triage?: CaseFile['triage'] },
): Promise<CaseFile> {
  const policy = policyFor(ctx);
  const trace = ctx.traceRecorder ?? new TraceRecorder(ctx.runId);
  ensureTraceStarted(trace);
  const ledger = ctx.stageLedger ?? new StageLedger(trace);
  const fullContext: RepairFailureContext = {
    ...ctx,
    policy,
    llm: ctx.llm,
    stageLedger: ledger,
    traceRecorder: trace,
  };
  const providerLog = filterPolicyDeniedText(ctx.failedLog, policy);
  const chargedContext = { ...fullContext, ...charged };
  let diagnosis = await classify(charged.llm, providerLog);
  progress.diagnosis = diagnosis;
  diagnosis = promoteUpstreamDependencyDiagnosis(diagnosis, ctx.dependencyHints);
  diagnosis = withGrounding(
    diagnosis,
    await withinRecoveryDeadline(budget.remainingElapsedTimeSec(), undefined, () => ground(
      ctx.tavily ?? { search: async () => [] },
      diagnosis,
      {
        tavilyEnabled: ctx.tavily !== undefined,
        ...(ctx.lockfileDiff === undefined ? {} : { lockfileDiff: ctx.lockfileDiff }),
        ...(ctx.dependencyHints === undefined
          ? {}
          : { dependencyHints: ctx.dependencyHints }),
      },
    )),
  );
  ledger.record({
    stage: 'search',
    attempt: 1,
    network: 'disabled',
    note: diagnosis.grounding?.skipped === false
      ? `Grounding returned ${diagnosis.grounding.citations.length} citations`
      : 'Grounding skipped',
  });
  const runtime = ctx.runtime ?? NODE_RUNTIME;
  const executableCommand = sandboxExecutableCommand(diagnosis.failingCmd, runtime);
  const verificationCommand = sandboxExecutableCommand(
    repairVerificationCommand(
      diagnosis,
      providerLog,
      ctx.repairVerificationScope ?? 'failing-workspace',
    ),
    runtime,
  );

  const triageVerdict = await triage(
    charged.executor,
    ctx.failingImage,
    executableCommand,
    ctx.triageN,
    (result, attempt) => ledger.record({
      stage: 'triage',
      attempt,
      network: 'disabled',
      result,
      parentImageId: ctx.failingImage,
      note: 'Reproduction probe',
    }),
  );
  progress.diagnosis = diagnosis;
  progress.triage = triageVerdict;
  if (triageVerdict.status !== 'real') {
    return makeCaseFile(fullContext, diagnosis, triageVerdict, [], 'flaky-no-patch');
  }
  if (
    diagnosis.class === 'dep-upstream-breaking' &&
    (diagnosis.grounding?.skipped !== false || diagnosis.grounding.citations.length === 0)
  ) {
    return makeCaseFile(fullContext, diagnosis, triageVerdict, [], 'gave-up');
  }

  const recordVerification = (candidate: Candidate, prepared: PreparedRuntimeChallenges, result: RuntimeCandidateResult) => {
    const evidence = parseRuntimeCandidateEvidence({schemaVersion:'sutura-runtime-candidate-v1',candidateId:candidate.id,
      diffHash:createHash('sha256').update(candidate.diff).digest('hex'),setHash:prepared.set?.setHash??null,
      verification:result.verification,subjects:result.challenges===null?[]:challengeSubjectRecords(result.challenges)});
    (fullContext.verificationRuns ??= []).push(evidence);
    fullContext.generatedVerification?.record(candidate, prepared, result);
  };
  const prepareChallenges = async (sources: RepairSourceContext['sources']) => {
    const prepared = await prepareRuntimeChallenges({
      ...charged, policy, baselineImage: ctx.failingImage,
      policyBaseSha: ctx.sourceIdentity?.policyBaseSha ?? null,
      policyHash: /^[a-f0-9]{64}$/u.test(ctx.policyEvidence?.policySha ?? '') ? ctx.policyEvidence!.policySha : createHash('sha256').update(canonicalJson(policy)).digest('hex'),
      baselineSnapshotHash: ctx.sourceIdentity?.snapshotSha256 ?? '',
      failureExcerpt: providerLog,
      baselineSources: sources.map(({ path, startLine, content }) => ({ path, startLine, content })),
      observe: (result, parentImageId) => { ledger.record({ stage: 'audit', attempt: 1, network: 'disabled', result, parentImageId, note: 'Frozen baseline challenge' }); },
    });
    fullContext.generatedVerification?.prepare(prepared);
    fullContext.preparedChallenges = prepared;
    chargedContext.preparedChallenges = prepared;
    return prepared;
  };
  const suppliedCandidate = ctx.candidateDiff === undefined
    ? undefined
    : {
        id: 'supplied-candidate',
        rationale: 'Candidate supplied by the benchmark adapter contract.',
        diff: ctx.candidateDiff,
      };
  if (!suppliedCandidate) {
    const sourceContext = await withinRecoveryDeadline(
      budget.remainingElapsedTimeSec(), undefined, () => ctx.readSourceContext(
        ctx.failedLog, diagnosis, runtime, recoverySourceClasses(diagnosis, providerLog),
      ),
    );
    trace.record({
      type: 'search-decision', stage: 'search',
      summary: `Bounded source closure accepted ${sourceContext.sources.length} file${sourceContext.sources.length === 1 ? '' : 's'}`,
    });
    let candidateAttempt = 0;
    const trustedCommands = Object.fromEntries([
      ['diagnosed', verificationCommand],
      ...policy.requiredCommands.map((command, index) => [
        `policy-${index + 1}`,
        sandboxExecutableCommand(command, runtime),
      ]),
    ]);
    const searchLimits = ctx.search ?? {
      ...DEFAULT_SEARCH_LIMITS,
      initialBranches: Math.min(ctx.raceK, DEFAULT_SEARCH_LIMITS.initialBranches),
    };
    // Non-Git fixtures still bind grants to the immutable baseline image and exact sources.
    const baseline: ControllerBaselineBinding = {
      ...(ctx.sourceIdentity ?? {
        kind: 'local-snapshot' as const, sourceSha: null, policyBaseSha: null,
        snapshotSha256: null,
      }),
      baselineImageId: ctx.failingImage,
      policySha256: /^[a-f0-9]{64}$/u.test(ctx.policyEvidence?.policySha ?? '')
        ? ctx.policyEvidence!.policySha
        : createHash('sha256').update(canonicalJson(policy)).digest('hex'),
    };
    let repairReservationUsd: number;
    try {
      repairReservationUsd = recoveryRepairReservationUsd({
        llm: fullContext.llm, diagnosis, policy, sourceContext, budget,
        runtimeId: (ctx.runtime ?? NODE_RUNTIME).id,
      });
    } catch (error) {
      const kind = error instanceof RepairProposalPreparationError ? error.failureKind : 'provider';
      ledger.record({ stage: 'search', attempt: ++candidateAttempt, network: 'disabled',
        note: `${kind} abstention: a bounded repair source and provider price quote are required` });
      return makeCaseFile(fullContext, diagnosis, triageVerdict, [], 'gave-up', undefined, []);
    }
    const recovery = await recoverDiagnosis({
      initialDiagnosis: diagnosis, failedLog: providerLog, sourceContext, baseline,
      policy, executor: ctx.executor, llm: fullContext.llm, budget,
      trustedCommand: executableCommand,
      operationIdPrefix: `repair-${ctx.runId}-recovery`,
      repairReservationUsd,
      observe: ({ result, parentImageId, note }) => {
        ledger.record({
          stage: 'search', attempt: ++candidateAttempt, network: 'disabled',
          ...(result === undefined ? {} : { result }), parentImageId, note,
        });
      },
    });
    fullContext.recovery = recovery.evidence;
    try {
      const targets: Array<{
        hypothesisId: string;
        diagnosis: Diagnosis;
        authorization?: RepairAuthorizationContext;
        template: ControlledRepairProposalTemplate;
        index: number;
      }> = [];
      for (const attempt of recovery.attempts) {
        try {
          const template = prepareControlledRepairProposalTemplate({
            diagnosis: attempt.diagnosis, policy, sourceContext,
            runtimeId: (ctx.runtime ?? NODE_RUNTIME).id,
            ...(attempt.authorization === undefined ? {} : { authorization: attempt.authorization }),
          });
          for (let index = 0; index < template.targetCount; index++) {
            targets.push({ ...attempt, template, index });
          }
        } catch (error) {
          ledger.record({
            stage: 'search', attempt: ++candidateAttempt, network: 'disabled',
            note: `${error instanceof RepairProposalPreparationError ? error.failureKind : 'policy'} failure: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      }
      if (targets.length === 0 || recovery.audit === undefined) {
        return makeCaseFile(fullContext, diagnosis, triageVerdict, [], 'gave-up', undefined, []);
      }
      const prepared = await prepareChallenges(sourceContext.sources);
      const verified = new Map<string, RuntimeCandidateResult>();
      let firstAuditAvailable = true;
      const attemptContexts = new Map<string, ControlledRepairAttemptContext>();
      const nodeTargets = new Map<string, number>();
      const attemptContext = (
        parent: SearchNode | undefined,
        targetIndex: number,
        repeatedProposal = false,
      ): ControlledRepairAttemptContext => {
        const key = `${parent?.id ?? 'baseline'}:${targetIndex}${repeatedProposal ? ':repeat' : ''}`;
        const existing = attemptContexts.get(key);
        if (existing !== undefined) return existing;
        const feedback = parent === undefined ? undefined : {
          candidateDiff: parent.cumulativeDiff,
          testOutput: parent.testEvidence.output,
          errorFingerprint: parent.errorFingerprint,
          ...(repeatedProposal ? { repeatedProposal: true as const } : {}),
        };
        const target = targets[targetIndex]!;
        const prepared = {
          llm: fullContext.llm,
          executor: ctx.executor,
          initialImageId: ctx.failingImage,
          diagnosis: target.diagnosis,
          policy,
          budget,
          trustedCommands,
          sourceContext,
          runtimeId: (ctx.runtime ?? NODE_RUNTIME).id,
          ...(target.authorization === undefined ? {} : { authorization: target.authorization }),
          proposalTemplate: target.template,
          proposalContract: target.template.contract(feedback, target.index),
          ...(feedback === undefined ? {} : { feedback }),
        };
        attemptContexts.set(key, prepared);
        return prepared;
      };
      const childTargetIndex = (parent: SearchNode): number => {
        const parentTarget = nodeTargets.get(parent.id) ?? 0;
        return parent.cumulativeDiff === '' && targets.length > 1
          ? (parentTarget + 1) % targets.length
          : parentTarget;
      };
      const targetIndexes = (parent: SearchNode | undefined): number[] => {
        if (parent !== undefined) return [childTargetIndex(parent)];
        return Array.from({ length: targets.length }, (_value, index) => index);
      };
      const inferenceCapacity = (parents: readonly (SearchNode | undefined)[]): number => {
        const remainingUsd = budget.limits.inferenceCostUsd - budget.snapshot().inferenceCostUsd;
        try {
          const uniqueContexts = new Map<string, ControlledRepairAttemptContext>();
          for (const parent of parents.length > 0 ? parents : [undefined]) {
            for (const targetIndex of targetIndexes(parent)) {
              const key = `${parent?.id ?? 'baseline'}:${targetIndex}`;
              uniqueContexts.set(key, attemptContext(parent, targetIndex));
            }
          }
          const reservationUsd = Math.max(
            ...[...uniqueContexts.values()].map((context) =>
              controlledRepairAttemptReservationUsd(context),
            ),
          );
          return Math.max(0, Math.floor(remainingUsd / reservationUsd));
        } catch {
          return 0;
        }
      };
      const initialBranchCapacity = Math.min(
        Math.floor((budget.limits.modelTurns - budget.snapshot().modelTurns) / REPAIR_ATTEMPT_COSTS.modelTurns),
        Math.floor((budget.limits.toolCalls - budget.snapshot().toolCalls) / REPAIR_ATTEMPT_COSTS.toolCalls),
        Math.floor((budget.limits.sandboxOperations - budget.snapshot().sandboxOperations) / REPAIR_ATTEMPT_COSTS.sandboxOperations),
        inferenceCapacity([undefined]),
      );
      const reachableTargetCapacity = Math.min(
        budget.limits.branches,
        searchLimits.maximumTotalBranches,
        initialBranchCapacity,
      );
      if (reachableTargetCapacity === 0) {
        ledger.record({ stage: 'search', attempt: 1, network: 'disabled',
          note: 'No complete controller-owned repair attempt fits the configured budgets' });
        return makeCaseFile(fullContext, diagnosis, triageVerdict, [], 'gave-up', undefined, []);
      }
      if (reachableTargetCapacity < targets.length) {
        const available = targets.length;
        targets.sort((left, right) => Number(right.authorization !== undefined) - Number(left.authorization !== undefined));
        targets.splice(reachableTargetCapacity);
        // Cached contracts were priced before admission; rebuild target-index associations after pruning.
        attemptContexts.clear();
        ledger.record({ stage: 'search', attempt: 1, network: 'disabled',
          note: `Admitted ${targets.length} of ${available} controller-owned repair targets within the shared budget; validated recovery targets take priority` });
      }
      let providerCapacity: CapacitySnapshot | undefined = fullContext.llm.capacitySnapshot?.();
      const activeOperations = new Map<string, string>();
      const lastOperations = new Map<string, string>();
      const availableBranches = (
        parents: readonly (SearchNode | undefined)[] = [],
      ): number => {
        const snapshot = budget.snapshot();
        if (
          providerCapacityAvailable(providerCapacity) < 1 ||
          ctx.executor.operationCapacity().available < 1
        ) return 0;
        return Math.min(
          budget.limits.branches - snapshot.branches,
          Math.floor((budget.limits.sandboxOperations - snapshot.sandboxOperations) / REPAIR_ATTEMPT_COSTS.sandboxOperations),
          Math.floor((budget.limits.modelTurns - snapshot.modelTurns) / REPAIR_ATTEMPT_COSTS.modelTurns),
          Math.floor((budget.limits.toolCalls - snapshot.toolCalls) / REPAIR_ATTEMPT_COSTS.toolCalls),
          inferenceCapacity(parents),
          budget.remainingElapsedTimeSec() > 0 ? Number.MAX_SAFE_INTEGER : 0,
        );
      };
      const result = await adaptiveSearch({
        baselineImageId: ctx.failingImage,
        initialBranches: Math.min(
          Math.max(searchLimits.initialBranches, targets.length),
          budget.limits.branches,
          searchLimits.maximumTotalBranches,
          initialBranchCapacity,
        ),
        beamWidth: searchLimits.beamWidth,
        maximumDepth: searchLimits.maximumDepth,
        maximumTotalBranches: Math.min(searchLimits.maximumTotalBranches, budget.limits.branches),
        availableBranches,
        concurrencyCapacity: () => ctx.search === undefined
          ? 1
          : Math.max(1, Math.min(
            providerCapacityAvailable(providerCapacity),
            ctx.executor.operationCapacity().available,
          )),
        admit: async ({ nodeId, expansion }) => {
          const candidate = expansion.candidate;
          if (candidate === undefined) return { accepted: false };
          const target = targets[nodeTargets.get(nodeId) ?? 0]!;
          let ports;
          try {
            ports = firstAuditAvailable ? recovery.audit! : reserveRecoveryAudit({
              budget, llm: fullContext.llm, executor: ctx.executor, policy,
              operationIdPrefix: `repair-${ctx.runId}-${nodeId}`,
            });
            firstAuditAvailable = false;
            const result = await evaluateRuntimeCandidate({
              ...ports, prepared, policy, baselineImage: ctx.failingImage,
              winner: {candidate, imageId: expansion.imageId, nodeId,
                held: true, exitCode: expansion.testEvidence.exitCode},
              diagnosis: target.diagnosis, beforeLog: providerLog, suiteCommand: verificationCommand,
              ...(target.authorization === undefined ? {} : {authorization: target.authorization}),
              runtime,
              observe: (result, parentImageId, note) => { ledger.record({stage: 'audit', attempt: ++candidateAttempt, network: 'disabled', result, parentImageId, note}); },
            });
            verified.set(nodeId, result);
            recordVerification(candidate, prepared, result);
            ledger.record({stage: 'search', attempt: ++candidateAttempt, network: 'disabled', note: `Provisional candidate ${nodeId}: ${result.verification.status} at ${result.verification.blockingGate ?? 'complete'}`});
            return {accepted: result.verdict.approved, reason: result.verdict.reasoning};
          } catch(error) {
            if (!(error instanceof BudgetExceededError)) throw error;
            return {accepted:false, reason:'budget-exhausted'};
          } finally { ports?.finish(); }
        },
        cancel: async (nodeId) => {
          const activeOperation = activeOperations.get(nodeId);
          if (!activeOperation) {
            ledger.record({
              stage: 'search', attempt: ++candidateAttempt, network: 'disabled',
              note: `Cancellation requested for ${nodeId} before a sandbox operation started`,
            });
            return;
          }
          const cancellation = await ctx.executor.cancel(activeOperation);
          ledger.record({
            stage: 'search', attempt: ++candidateAttempt, network: 'disabled',
            operation: {
              operationId: activeOperation,
              ...(cancellation.terminal === undefined ? {} : { terminal: cancellation.terminal }),
              cancellationRequested: cancellation.requested,
            },
            note: `Cancellation ${cancellation.requested ? 'requested' : 'observed'} for ${nodeId}`,
          });
        },
        onDecision: ({ summary, nodeId, parentNodeId }) => trace.record({
          type: 'search-decision',
          stage: 'search',
          summary,
          ...(nodeId === undefined ? {} : { childNodeId: nodeId }),
          ...(parentNodeId === undefined ? {} : { parentNodeId }),
        }),
        expand: async ({ parent, parentImageId, branch, nodeId, operationId, signal }) => {
          const before = ledger.entries().length;
          const targetIndex = parent === undefined
            ? (branch - 1) % targets.length
            : childTargetIndex(parent);
          nodeTargets.set(nodeId, targetIndex);
          const runAttempt = async (
            context: ControlledRepairAttemptContext,
            operationIdPrefix: string,
          ) => {
            try {
              return await runControlledRepairAttempt({
                ...context,
                branchId: nodeId,
                operationIdPrefix,
                signal,
                trace,
                onOperationStart: (activeOperationId) => {
                  activeOperations.set(nodeId, activeOperationId);
                  lastOperations.set(nodeId, activeOperationId);
                },
                observeCapacity: (capacity) => { providerCapacity = capacity; },
                observe: ({ result, imageId, parentImageId, note }) => ledger.record({
                  stage: 'search',
                  attempt: ++candidateAttempt,
                  network: 'disabled',
                  ...(result === undefined ? {} : { result }),
                  ...(imageId === undefined ? {} : { imageId }),
                  parentImageId,
                  note,
                }),
              });
            } finally {
              activeOperations.delete(nodeId);
            }
          };
          let agent = await runAttempt(attemptContext(parent, targetIndex), operationId);
          if (
            !signal.aborted &&
            parent !== undefined &&
            (agent.status === 'submitted' || agent.status === 'checkpoint') &&
            diffFingerprint(agent.candidate.diff) === diffFingerprint(parent.cumulativeDiff) &&
            availableBranches([parent]) >= 1
          ) {
            ledger.record({
              stage: 'search', attempt: ++candidateAttempt, network: 'disabled',
              note: `Identical proposal for ${nodeId}; requesting an alternative`,
            });
            agent = await runAttempt(
              attemptContext(parent, targetIndex, true),
              `${operationId}-alt`,
            );
          }
          if (signal.aborted) {
            const lastOperation = lastOperations.get(nodeId);
            if (lastOperation !== undefined) {
              const completion = await ctx.executor.cancel(lastOperation);
              ledger.record({
                stage: 'search', attempt: ++candidateAttempt, network: 'disabled',
                operation: {
                  operationId: lastOperation,
                  ...(completion.terminal === undefined ? {} : { terminal: completion.terminal }),
                  cancellationRequested: true,
                },
                note: `Cancellation terminal evidence for ${nodeId}`,
              });
            }
            const inheritedDiff = parent?.cumulativeDiff ?? '';
            return {
              imageId: parentImageId,
              cumulativeDiff: inheritedDiff,
              testEvidence: {
                commandId: 'diagnosed', imageId: parentImageId, exitCode: 1,
                output: 'Repair branch was cancelled',
              },
              policyEvidence: { valid: true, violations: [], changedFiles: [], diffBytes: Buffer.byteLength(inheritedDiff, 'utf8') },
              stageEvidence: ledger.entries().slice(before), transcriptReference: nodeId,
              terminalReason: 'cancelled',
            };
          }
          if (agent.status === 'submitted' || agent.status === 'checkpoint') {
            const target = targets[targetIndex]!;
            if (target.authorization !== undefined) {
              await authorizeRepairCandidate(
                target.authorization.session, target.authorization.baseline, agent.candidate.diff,
              );
            }
            const validation = validateCandidateDiff(
              agent.candidate.diff, target.diagnosis, policy, budget.limits.diffBytes,
              target.authorization,
            );
            return {
              imageId: agent.imageId,
              cumulativeDiff: agent.candidate.diff,
              testEvidence: agent.test,
              policyEvidence: {
                valid: validation.ok,
                violations: validation.violations,
                changedFiles: validation.changedFiles,
                diffBytes: validation.diffBytes,
              },
              stageEvidence: ledger.entries().slice(before),
              transcriptReference: nodeId,
              ...(agent.test.metrics === undefined ? {} : { metrics: agent.test.metrics }),
              ...(agent.status === 'submitted' ? { candidate: agent.candidate } : {}),
            };
          }
          ledger.record({
            stage: 'search', attempt: ++candidateAttempt, network: 'disabled',
            parentImageId, note: `${agent.failureKind} failure: ${agent.reason}`,
          });
          const inheritedDiff = parent?.cumulativeDiff ?? '';
          return {
            imageId: parentImageId,
            cumulativeDiff: inheritedDiff,
            testEvidence: {
              commandId: 'diagnosed', imageId: parentImageId, exitCode: 1,
              output: `${agent.failureKind}: ${agent.reason}`,
            },
            policyEvidence: { valid: true, violations: [], changedFiles: [], diffBytes: Buffer.byteLength(inheritedDiff, 'utf8') },
            stageEvidence: ledger.entries().slice(before), transcriptReference: nodeId,
            terminalReason: agent.failureKind === 'completion-limit' ? 'completion-limit' : 'failed',
          };
        },
      });
      const searchEvidence = publicSearchEvidence(result.nodes);
      if (result.candidates.length === 0) {
        recovery.audit.finish();
        return makeCaseFile(
          fullContext, diagnosis, triageVerdict, [], [...verified.values()].some(item => item.verification.status === 'failed') ? 'refused' : 'gave-up', [...verified.values()].at(-1)?.verdict, searchEvidence, undefined,
          await counterfactualEvidence(chargedContext, ledger, diagnosis, providerLog, verificationCommand),
        );
      }
      const raceResults: RaceResult[] = result.candidates.map((node) => ({
        candidate: node.candidate!, imageId: node.imageId, nodeId: node.id,
        exitCode: node.testEvidence.exitCode, held: true,
        note: `Adaptive search passed at depth ${node.depth}`,
      }));
      const winner = raceResults[0]!;
      const auditVerdict = verified.get(winner.nodeId!)!.verdict;
      recovery.audit.finish();
      const outcome = auditVerdict.approved ? 'fixed' as const : 'refused' as const;
      return makeCaseFile(
        fullContext,
        diagnosis,
        triageVerdict,
        raceResults,
        outcome,
        auditVerdict,
        searchEvidence,
        winner.candidate,
        await counterfactualEvidence(
          chargedContext, ledger, diagnosis, providerLog, verificationCommand, winner.candidate.id,
        ),
      );
    } finally {
      recovery.audit?.finish();
    }
  }

  const suppliedAudit = reserveRecoveryAudit({budget, llm: fullContext.llm, executor: ctx.executor, policy});
  try {
  const sources = policy.verification?.contracts.length
    ? (await ctx.readSourceContext(ctx.failedLog, diagnosis, runtime)).sources : [];
  const prepared = await prepareChallenges(sources);
  const candidates = [suppliedCandidate];

  if (suppliedCandidate) {
    const verdict = policyVerdict(suppliedCandidate, diagnosis, policy);
    if (!verdict.ok) {
      const evidence = `Patch vet refused: ${verdict.violations.join('; ')}`;
      const nodeId = ledger.record({
        stage: 'candidate',
        attempt: 1,
        network: 'disabled',
        note: `Candidate refused before execution: ${verdict.violations.join('; ')}`,
      });
      return makeCaseFile(
        fullContext,
        diagnosis,
        triageVerdict,
        [vettedRaceResult(suppliedCandidate, verdict.violations, nodeId)],
        'refused',
        {
          approved: false,
          checks: [
            ...runMechanicalChecks(suppliedCandidate.diff),
            { name: 'llm-adjudication', passed: false, evidence: `Not run: ${evidence}` },
          ],
          reasoning: `REFUSED: ${evidence}`,
        },
        undefined,
        undefined,
        await counterfactualEvidence(
          chargedContext, ledger, diagnosis, providerLog, verificationCommand,
        ),
      );
    }
  }

  const approvedCandidates: Candidate[] = [];
  const refusedCandidates = new Map<string, RaceResult>();
  for (const candidate of candidates) {
    const verdict = policyVerdict(candidate, diagnosis, policy);
    if (verdict.ok) {
      approvedCandidates.push(candidate);
    } else {
      const nodeId = ledger.record({
        stage: 'candidate',
        attempt: refusedCandidates.size + 1,
        network: 'disabled',
        note: `Candidate refused before execution: ${verdict.violations.join('; ')}`,
      });
      refusedCandidates.set(
        candidate.id,
        vettedRaceResult(candidate, verdict.violations, nodeId),
      );
    }
  }

  const raced = await race(
    charged.executor,
    ctx.failingImage,
    approvedCandidates,
    verificationCommand,
    (result, attempt) => ledger.record({
      stage: 'candidate',
      attempt,
      network: 'disabled',
      result,
      parentImageId: ctx.failingImage,
      note: 'Candidate verification race',
    }),
  );
  const racedById = new Map(raced.map((result) => [result.candidate.id, result]));
  // race() enforces one result per approved candidate; every other candidate
  // is inserted in refusedCandidates above.
  const raceResults = candidates.map((candidate) =>
    (racedById.get(candidate.id) ?? refusedCandidates.get(candidate.id))!,
  );
  const winner = selectWinner(raceResults);
  if (!winner) {
    if (refusedCandidates.size > 0) {
      const evidence = raceResults
        .flatMap((result) => result.note ? [result.note] : [])
        .join('; ');
      return makeCaseFile(
        fullContext,
        diagnosis,
        triageVerdict,
        raceResults,
        'refused',
        {
          approved: false,
          checks: [{
            name: 'llm-adjudication',
            passed: false,
            evidence: 'Not run: repository or built-in policy refused all candidates',
          }],
          reasoning: `REFUSED: ${evidence}`,
        },
        undefined,
        undefined,
        await counterfactualEvidence(
          chargedContext, ledger, diagnosis, providerLog, verificationCommand,
        ),
      );
    }
    return makeCaseFile(
      fullContext, diagnosis, triageVerdict, raceResults, 'gave-up', undefined, undefined, undefined,
      await counterfactualEvidence(chargedContext, ledger, diagnosis, providerLog, verificationCommand),
    );
  }

  const suppliedVerification = await evaluateRuntimeCandidate({
    ...suppliedAudit, winner, prepared, policy, baselineImage: ctx.failingImage,
    diagnosis, beforeLog: providerLog, suiteCommand: verificationCommand, runtime,
    observe: (result, parentImageId, note) => { ledger.record({stage:'audit',attempt:1,network:'disabled',result,parentImageId,note}); },
  });
  recordVerification(winner.candidate, prepared, suppliedVerification);
  const auditVerdict = suppliedVerification.verdict;
  return makeCaseFile(
    fullContext,
    diagnosis,
    triageVerdict,
    raceResults,
    auditVerdict.approved ? 'fixed' : 'refused',
    auditVerdict,
    undefined,
    winner.candidate,
    await counterfactualEvidence(
      chargedContext, ledger, diagnosis, providerLog, verificationCommand, winner.candidate.id,
    ),
  );
  } finally { suppliedAudit.finish(); }
}

function failureLog(command: string, result: RunResult): string {
  return boundedTail(
    [`Run ${command}`, result.stdout, result.stderr].filter(Boolean).join('\n'),
    { maxLines: 200, maxCharacters: 20_000, maxBytes: 20_000 },
  );
}

export async function healCase(ctx: HealCaseContext): Promise<CaseFile> {
  if (ctx.policy?.verification?.mode === 'required' && ctx.executionRecorder === undefined) {
    const executionRecorder = new VerificationExecutionRecorder({ executor: ctx.executor, llm: ctx.llm, mode: ctx.evidenceMode ?? 'local' });
    ctx = { ...ctx, executionRecorder, executor: executionRecorder.executor, llm: executionRecorder.llm };
  }
  if (!ctx.runId.trim() || !ctx.repo.trim() || !ctx.caseDir.trim()) {
    throw new HealCaseError('runId, repo, and caseDir must be non-empty');
  }
  const command = ctx.failureCommand ?? defaultFailureCommand(ctx.runtimeId ?? ctx.policy?.runtime);
  if (!command.trim()) throw new HealCaseError('failureCommand must be non-empty');

  const trace = ctx.traceRecorder ?? new TraceRecorder(ctx.runId);
  ensureTraceStarted(trace);
  const ledger = ctx.stageLedger ?? new StageLedger(trace);
  const fullContext: HealCaseContext = {
    ...ctx,
    stageLedger: ledger,
    traceRecorder: trace,
  };
  ledger.record({
    stage: 'policy',
    attempt: 1,
    network: 'disabled',
    note: 'Repository policy validated before provider execution',
  });
  const configuredRuntime = ctx.runtimeId ?? ctx.policy?.runtime;
  if (ctx.runtimeId !== undefined && ctx.policy?.runtime !== undefined && ctx.runtimeId !== ctx.policy.runtime) {
    throw new HealCaseError('Configured runtime conflicts with repository policy runtime');
  }
  const runtime = await detectRuntimeAtPath(ctx.caseDir, command, configuredRuntime);
  fullContext.runtime = runtime;
  if (runtime.id === 'python' && ctx.imageRef !== undefined && ctx.imageRef !== runtime.imageRef) {
    throw new HealCaseError('Python runtime image must use the verified exact digest');
  }
  const executor = new AllowlistedExecutor(ctx.executor);
  const baseImage = await executor.importImage(ctx.imageRef ?? runtime.imageRef);
  ledger.record({
    stage: 'preparation',
    attempt: 0,
    network: 'disabled',
    imageId: baseImage,
    note: 'Base image imported',
  });
  const setup = await prepareSandbox(
    executor,
    ctx.caseDir,
    baseImage,
    command,
    ledger,
    runtime,
    (ctx.policy?.verification?.contracts.length ?? 0) > 0,
  );
  if (!setup.ok) {
    return preparationFailureCaseFile(fullContext, setup.command, setup.result);
  }
  try {
  const reproduction = await executor.run(
    setup.imageId,
    sandboxTargetCommand(command, runtime),
    { cwd: SNAPSHOT_CWD },
  );
  ledger.record({
    stage: 'reproduction',
    attempt: 1,
    network: 'disabled',
    result: reproduction,
    parentImageId: setup.imageId,
    note: 'Observed failing command reproduction',
  });
  const failedLog = failureLog(command, reproduction);
  if (reproduction.exitCode === 0) {
    const mechanical = classifyMechanically(failedLog);
    return noReproductionCaseFile(fullContext, mechanical);
  }

  return await repairFailure({
    ...(ctx.executionRecorder === undefined ? {} : { executionRecorder: ctx.executionRecorder }),
    evidenceMode: ctx.evidenceMode ?? 'local',
    runId: ctx.runId,
    repo: ctx.repo,
    failedLog,
    failingImage: setup.imageId,
    executor,
    llm: fullContext.llm,
    cost: ctx.cost,
    triageN: ctx.triageN,
    raceK: ctx.raceK,
    readSourceContext: async (...args) => {
      const context = await ctx.readSourceContext(...args);
      if (setup.sourceDir === undefined) return context;
      return { ...context, sources: await Promise.all(context.sources.map(async source => {
        const content = (await readBoundedRegularFile(join(setup.sourceDir!, source.path), MAX_SNAPSHOT_FILE_BYTES)).toString('utf8');
        const lines = source.content.split('\n').length;
        return { ...source, content: content.split('\n').slice(source.startLine - 1, source.startLine - 1 + lines).join('\n') };
      })) };
    },
    ...(setup.snapshotSha256 === undefined ? (ctx.sourceIdentity === undefined ? {} : { sourceIdentity: ctx.sourceIdentity }) : {
      sourceIdentity: { ...(ctx.sourceIdentity ?? { kind: 'local-snapshot' as const, sourceSha: null, policyBaseSha: null }), snapshotSha256: setup.snapshotSha256 },
    }),
    ...(ctx.tavily ? { tavily: ctx.tavily } : {}),
    ...(ctx.lockfileDiff === undefined ? {} : { lockfileDiff: ctx.lockfileDiff }),
    ...(ctx.dependencyHints === undefined ? {} : { dependencyHints: ctx.dependencyHints }),
    ...(ctx.candidateDiff === undefined ? {} : { candidateDiff: ctx.candidateDiff }),
    ...(ctx.counterfactuals === undefined ? {} : { counterfactuals: ctx.counterfactuals }),
    ...(ctx.policy === undefined ? {} : { policy: ctx.policy }),
    ...(ctx.policyEvidence === undefined ? {} : { policyEvidence: ctx.policyEvidence }),
    ...(ctx.repairBudgets === undefined ? {} : { repairBudgets: ctx.repairBudgets }),
    ...(ctx.search === undefined ? {} : { search: ctx.search }),
    stageLedger: ledger,
    traceRecorder: trace,
    runtime,
  });
  } finally { await setup.cleanup?.(); }
}
