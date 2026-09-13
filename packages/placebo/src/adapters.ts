import { spawn } from 'node:child_process';

import {
  MAX_STAGE_EVIDENCE_ENTRIES,
  completedTriageVerdict,
} from '@sutura/core';

import { assertArmEnvironment } from './baseline.js';
import type { Adapter, AdapterContext, CaseFile } from './types.js';

interface ExecutionResult { stdout: string; stderr: string; exitCode: number; failure?: string }
export interface ExecuteOptions {
  timeoutMs: number;
  maxOutputBytes: number;
  env?: Readonly<Record<string, string>>;
}
export type Execute = (command: string, args: string[], options: ExecuteOptions) => Promise<ExecutionResult>;

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const OUTCOMES = new Set(['fixed', 'flaky-no-patch', 'refused', 'gave-up', 'infra-stop']);
const FAILURE_CLASSES = new Set(['typecheck', 'lint', 'build', 'test-assertion', 'test-bug', 'flaky-timing', 'dep-upstream-breaking', 'env-config', 'infra']);

function runtimeFor(context?: AdapterContext): 'node' | 'python' {
  return context?.language === 'python' ? 'python' : 'node';
}

function failureCaseFile(reason: string, runtime: 'node' | 'python' = 'node'): CaseFile {
  return {
    runId: 'placebo-adapter-failure', repo: 'placebo/adapter',
    runtime,
    diagnosis: { class: 'infra', confidence: 1, signals: ['adapter-failure'], failingCmd: 'adapter', errorExcerpt: reason.slice(0, 2_000) },
    triage: completedTriageVerdict([1], 1), race: [], outcome: 'gave-up',
    cost: { entries: [], totalUsd: () => 0 },
    policy: { baseRef: 'local', baseSha: 'local', policySha: 'unavailable' },
    stages: [{
      stage: 'policy', attempt: 1, nodeId: 'node-001', metrics: {}, network: 'disabled',
      note: 'Adapter stopped before provider execution',
    }],
  };
}

function executeProcess(command: string, args: string[], options: ExecuteOptions): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let failure: string | undefined;
    const child = spawn(command, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(options.env === undefined ? {} : { env: { ...process.env, ...options.env } }),
    });
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, ...(failure ? { failure } : {}) });
    };
    const collect = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > options.maxOutputBytes) {
        failure = `adapter output limit exceeded (${options.maxOutputBytes} bytes)`;
        child.kill('SIGKILL');
        return;
      }
      if (target === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk));
    child.once('error', (error) => {
      failure = `adapter spawn failed: ${error.message}`;
      finish(1);
    });
    child.once('close', (exitCode) => finish(exitCode ?? 1));
    const timer = setTimeout(() => {
      failure = `adapter timed out after ${options.timeoutMs} ms`;
      child.kill('SIGKILL');
    }, options.timeoutMs);
    timer.unref();
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function validDiagnosis(value: unknown): boolean {
  const diagnosis = record(value);
  if (!diagnosis || !FAILURE_CLASSES.has(String(diagnosis.class)) || typeof diagnosis.confidence !== 'number' ||
      !Array.isArray(diagnosis.signals) || !diagnosis.signals.every((signal) => typeof signal === 'string') ||
      typeof diagnosis.failingCmd !== 'string' || typeof diagnosis.errorExcerpt !== 'string') return false;
  if (diagnosis.grounding === undefined) return true;
  const grounding = record(diagnosis.grounding);
  return Boolean(grounding && typeof grounding.query === 'string' && typeof grounding.skipped === 'boolean' &&
    Array.isArray(grounding.citations) && grounding.citations.every((citation) => {
      const item = record(citation);
      return item && typeof item.title === 'string' && typeof item.url === 'string' && typeof item.snippet === 'string';
    }));
}

function validTriage(value: unknown): boolean {
  const triage = record(value);
  if (!triage || !['real', 'flaky', 'intermittent', 'not-run'].includes(String(triage.status)) ||
      !Number.isSafeInteger(triage.reproduced) || !Number.isSafeInteger(triage.of) ||
      Number(triage.reproduced) < 0 || Number(triage.reproduced) > Number(triage.of)) return false;
  if (!Number.isSafeInteger(triage.attemptsUsed) || !Number.isSafeInteger(triage.maximumAttempts) ||
      triage.attemptsUsed !== triage.of || Number(triage.maximumAttempts) < Number(triage.attemptsUsed) ||
      typeof triage.reproductionProbability !== 'number' ||
      typeof triage.confidenceLower !== 'number' || typeof triage.confidenceUpper !== 'number' ||
      triage.methodVersion !== 'sprt-p20-p80-a05-b05-v1' ||
      !['failure-boundary', 'pass-boundary', 'maximum-attempts', 'not-run'].includes(String(triage.stopReason))) return false;
  if (triage.status === 'not-run') return triage.reproduced === 0 && triage.of === 0 && triage.stopReason === 'not-run';
  if (Number(triage.of) <= 0) return false;
  if (triage.status === 'real') return triage.reproduced === triage.of;
  if (triage.status === 'flaky') return triage.reproduced === 0;
  return Number(triage.reproduced) > 0 && Number(triage.reproduced) < Number(triage.of);
}

function validAudit(value: unknown): boolean {
  const audit = record(value);
  return Boolean(audit && typeof audit.approved === 'boolean' && typeof audit.reasoning === 'string' &&
    Array.isArray(audit.checks) && audit.checks.every((check) => {
      const item = record(check);
      return item && typeof item.name === 'string' && typeof item.passed === 'boolean' &&
        (item.evidence === undefined || typeof item.evidence === 'string');
    }));
}

function validRace(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => {
    const result = record(entry);
    const candidate = record(result?.candidate);
    return result && candidate && typeof candidate.id === 'string' && typeof candidate.rationale === 'string' &&
      typeof candidate.diff === 'string' && typeof result.imageId === 'string' &&
      typeof result.nodeId === 'string' && result.imageId === result.nodeId &&
      typeof result.exitCode === 'number' && typeof result.held === 'boolean';
  });
}

const COUNTERFACTUAL_GATES = new Set([
  'patch-policy', 'verification', 'mechanical', 'suite-rerun', 'adjudication', 'repository-policy',
]);

function validCounterfactualCost(value: unknown): boolean {
  const cost = record(value);
  return Boolean(cost && ['inferenceUsd', 'sandboxOperations', 'elapsedTimeSec'].every((key) =>
    typeof cost[key] === 'number' && Number.isFinite(cost[key]) && Number(cost[key]) >= 0));
}

function validCounterfactual(value: unknown): boolean {
  const evidence = record(value);
  if (!evidence || !Array.isArray(evidence.alternatives)) return false;
  if (evidence.acceptedCandidateId !== undefined &&
      typeof evidence.acceptedCandidateId !== 'string') return false;
  if (!validCounterfactualCost(evidence.cost)) return false;
  return evidence.alternatives.every((entry) => {
    const item = record(entry);
    if (!item) return false;
    if (item.rejectedBy !== undefined) {
      const rejectedBy = record(item.rejectedBy);
      if (!rejectedBy || !COUNTERFACTUAL_GATES.has(String(rejectedBy.gate)) ||
          typeof rejectedBy.rule !== 'string' || rejectedBy.rule.length > 240 ||
          typeof rejectedBy.evidence !== 'string' || rejectedBy.evidence.length > 2_000) return false;
    }
    return typeof item.id === 'string' && item.id.length <= 240 &&
      (item.intent === 'plausible' || item.intent === 'shortcut') &&
      typeof item.rationale === 'string' && item.rationale.length <= 240 &&
      /^[a-f0-9]{64}$/u.test(String(item.diffHash)) &&
      typeof item.nodeId === 'string' && item.nodeId.length <= 240 &&
      typeof item.approved === 'boolean' &&
      Number.isSafeInteger(item.testExitCode) &&
      typeof item.reasoning === 'string' && item.reasoning.length <= 4_000 &&
      validAudit({ approved: item.approved, checks: item.checks, reasoning: item.reasoning }) &&
      validCounterfactualCost(item.cost);
  });
}

function validPolicyEvidence(value: unknown): boolean {
  const policy = record(value);
  return Boolean(policy &&
    ['baseRef', 'baseSha', 'policySha'].every((key) =>
      typeof policy[key] === 'string' && (policy[key] as string).length <= 240,
    ));
}

function validStages(value: unknown): boolean {
  return Array.isArray(value) &&
    value.length <= MAX_STAGE_EVIDENCE_ENTRIES &&
    value.every((entry) => {
    const stage = record(entry);
    const metrics = record(stage?.metrics);
    return Boolean(stage && metrics &&
      ['policy', 'preparation', 'reproduction', 'triage', 'candidate', 'search', 'audit']
        .includes(String(stage.stage)) &&
      Number.isSafeInteger(stage.attempt) && Number(stage.attempt) >= 0 &&
      /^node-\d{3}$/u.test(String(stage.nodeId)) &&
      (stage.parentNodeId === undefined || /^node-\d{3}$/u.test(String(stage.parentNodeId))) &&
      (stage.exitCode === undefined || Number.isSafeInteger(stage.exitCode)) &&
      (stage.network === 'disabled' || stage.network === 'enabled') &&
      (stage.note === undefined || (typeof stage.note === 'string' && stage.note.length <= 240)) &&
      Object.values(metrics).every((metric) =>
        typeof metric === 'number' && Number.isFinite(metric) && metric >= 0,
      ));
  });
}

function validCost(value: unknown): boolean {
  const cost = record(value);
  return Boolean(cost && Array.isArray(cost.entries) && cost.entries.every((entry) => {
    const item = record(entry);
    return item && ['nano', 'super', 'ultra'].includes(String(item.role)) && typeof item.model === 'string' &&
      ['inTok', 'outTok', 'reasoningTok'].every((key) =>
        Number.isSafeInteger(item[key]) && Number(item[key]) >= 0) &&
      typeof item.usd === 'number' && Number.isFinite(item.usd) && item.usd >= 0;
  }));
}

function parseCaseFile(result: ExecutionResult, runtime: 'node' | 'python'): CaseFile {
  if (result.failure) return failureCaseFile(result.failure, runtime);
  if (result.exitCode !== 0) return failureCaseFile(result.stderr.trim() || `adapter exited ${result.exitCode}`, runtime);
  try {
    const value = record(JSON.parse(result.stdout));
    const audit = value?.audit;
    const cost = record(value?.cost);
    if (!value || typeof value.runId !== 'string' || typeof value.repo !== 'string' ||
        !validDiagnosis(value.diagnosis) || !validTriage(value.triage) || !validRace(value.race) ||
        !OUTCOMES.has(String(value.outcome)) || !validCost(value.cost) ||
        value.runtime !== runtime ||
        !validPolicyEvidence(value.policy) || !validStages(value.stages) ||
        (audit !== undefined && !validAudit(audit)) ||
        (value.counterfactual !== undefined && !validCounterfactual(value.counterfactual))) {
      throw new Error('does not match Sutura CaseFile');
    }
    if (!cost) throw new Error('does not match Sutura CaseFile cost');
    const entries = cost.entries as CaseFile['cost']['entries'];
    return {
      ...(value as unknown as CaseFile),
      cost: { entries, totalUsd: () => entries.reduce((total, entry) => total + entry.usd, 0) },
    };
  } catch (error) {
    return failureCaseFile(`invalid adapter JSON: ${error instanceof Error ? error.message : String(error)}`, runtime);
  }
}

export interface CliAdapterOptions {
  command: string;
  args?: string[];
  tavilyEnabled?: boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
  execute?: Execute;
  /**
   * Extra environment for the adapter process. Only the comparison arm's
   * search-shape names are permitted, so an arm can never change a model, a
   * budget, or a provider.
   */
  env?: Readonly<Record<string, string>>;
}

export class CliAdapter implements Adapter {
  readonly name: string;
  protected readonly command: string;
  protected readonly args: string[];
  protected readonly tavilyEnabled: boolean;
  protected readonly timeoutMs: number;
  protected readonly maxOutputBytes: number;
  protected readonly execute: Execute;
  protected readonly env: Readonly<Record<string, string>> | undefined;

  constructor(options: CliAdapterOptions) {
    this.command = options.command;
    this.args = options.args ?? [];
    this.tavilyEnabled = options.tavilyEnabled ?? true;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.execute = options.execute ?? executeProcess;
    if (options.env !== undefined) assertArmEnvironment(options.env);
    this.env = options.env;
    this.name = `cli:${this.command}`;
  }

  protected commandArgs(caseDir: string, context?: AdapterContext): string[] {
    return [
      ...this.args, '--case-dir', caseDir,
      ...(context?.candidateDiff ? ['--candidate-diff', context.candidateDiff] : []),
      ...(context?.alternativesFile ? ['--alternatives-file', context.alternativesFile] : []),
      ...(context?.failingCommand ? ['--failing-command', context.failingCommand] : []),
      ...(!this.tavilyEnabled ? ['--no-tavily'] : []),
    ];
  }

  async heal(caseDir: string, context?: AdapterContext): Promise<CaseFile> {
    try {
      const result = await this.execute(this.command, this.commandArgs(caseDir, context), {
        timeoutMs: this.timeoutMs, maxOutputBytes: this.maxOutputBytes,
        ...(this.env === undefined ? {} : { env: this.env }),
      });
      return parseCaseFile(result, runtimeFor(context));
    } catch (error) {
      return failureCaseFile(`adapter execution failed: ${error instanceof Error ? error.message : String(error)}`, runtimeFor(context));
    }
  }

  withTavily(enabled: boolean): Adapter {
    return new CliAdapter({
      command: this.command, args: this.args, tavilyEnabled: enabled, timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes, execute: this.execute,
      ...(this.env === undefined ? {} : { env: this.env }),
    });
  }
}

export interface SuturaAdapterOptions extends Omit<CliAdapterOptions, 'command' | 'args'> { command?: string }

export class SuturaAdapter extends CliAdapter {
  override readonly name = 'sutura';
  constructor(options: SuturaAdapterOptions = {}) {
    super({ command: options.command ?? 'sutura', args: ['heal', '--format', 'json'], ...options });
  }
  protected override commandArgs(caseDir: string, context?: AdapterContext): string[] {
    return [
      'heal', '--case-dir', caseDir, '--format', 'json',
      ...(context?.language === undefined ? [] : ['--runtime', runtimeFor(context)]),
      ...(context?.candidateDiff ? ['--candidate-diff', context.candidateDiff] : []),
      ...(context?.alternativesFile ? ['--alternatives-file', context.alternativesFile] : []),
      ...(context?.failingCommand ? ['--failing-command', context.failingCommand] : []),
      ...(!this.tavilyEnabled ? ['--no-tavily'] : []),
    ];
  }
  override withTavily(enabled: boolean): Adapter {
    return new SuturaAdapter({
      command: this.command, tavilyEnabled: enabled, timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes, execute: this.execute,
      ...(this.env === undefined ? {} : { env: this.env }),
    });
  }
}

function controlCaseFile(
  outcome: CaseFile['outcome'],
  approved: boolean | undefined,
  tavilyEnabled: boolean,
  runtime: 'node' | 'python',
): CaseFile {
  return {
    runId: 'placebo-control', repo: 'placebo/control',
    runtime,
    diagnosis: {
      class: 'test-assertion', confidence: 1, signals: ['scripted-control'], failingCmd: 'pnpm test', errorExcerpt: 'scripted',
      ...(tavilyEnabled ? { grounding: { query: 'scripted release', skipped: false, citations: [{ title: 'Release', url: 'https://example.test/release', snippet: 'Scripted control citation' }] } } : {}),
    },
    triage: outcome === 'flaky-no-patch'
      ? completedTriageVerdict([1, 0, 1, 0, 0], 5)
      : completedTriageVerdict([1, 1, 1, 1], 5),
    race: [], ...(approved === undefined ? {} : { audit: { approved, checks: [], reasoning: approved ? 'approved' : 'refused' } }),
    outcome, cost: { entries: [], totalUsd: () => 0 },
    policy: { baseRef: 'local', baseSha: 'local', policySha: 'default' },
    stages: [{
      stage: 'policy', attempt: 1, nodeId: 'node-001', metrics: {}, network: 'disabled',
      note: 'Scripted control policy',
    }],
  };
}

export class DummyAdapter implements Adapter {
  readonly name = 'dummy';
  constructor(private readonly tavilyEnabled = true) {}
  async heal(_caseDir: string, context?: AdapterContext): Promise<CaseFile> {
    return controlCaseFile('fixed', true, this.tavilyEnabled, runtimeFor(context));
  }
  withTavily(enabled: boolean): Adapter { return new DummyAdapter(enabled); }
}

export class RefuseAllAdapter implements Adapter {
  readonly name = 'refuse-all';
  async heal(_caseDir: string, context?: AdapterContext): Promise<CaseFile> {
    return controlCaseFile('refused', false, false, runtimeFor(context));
  }
  withTavily(): Adapter { return this; }
}
