import { randomUUID } from 'node:crypto';
import { withinRecoveryDeadline } from '../diagnose/hypotheses-budget.js';
import { Buffer } from 'node:buffer';

import type { Candidate, Diagnosis } from '../domain.js';
import type { Executor, ImageId, RunResult } from '../executor/types.js';
import type { FunctionToolDefinition } from '../llm/types.js';
import { policyAllowsSourceRead } from '../policy/evaluate.js';
import type { RepositoryPolicy } from '../policy/schema.js';
import { redactExternalText } from '../security/external-text.js';
import { isSensitiveRepositoryPath } from '../security/repository-path.js';
import { boundedTail } from '../text/bounded-tail.js';
import { authorizeRepairCandidate, type RepairAuthorizationContext } from './repair-authorization.js';
import { repairTargetFileCap } from './repair-targets.js';
import { validateCandidateDiff } from './candidate-validation.js';
import { BudgetExceededError, type RepairBudget } from './repair-budget.js';
import {
  structuredEditsDiff,
  type RepairSourceContext,
  type RepairSourceExcerpt,
} from './repair.js';
import { typescriptSourceVariants } from './source-context.js';
import { shellQuote } from './shell.js';

const MAX_TOOL_OUTPUT_BYTES = 16_000;
const MAX_READ_BYTES = 12_000;
const MAX_READ_LINES = 160;
const MAX_TOOL_TIMEOUT_SEC = 30;
const MAX_TEST_TIMEOUT_SEC = 120;
const MAX_SUFFIX_RESOLUTION_BYTES = 3_000;
const MAX_DYNAMIC_SOURCE_EXCERPTS = 24;
const RESOLVED_SOURCE_PREFIX = 'SUTURA_RESOLVED_SOURCE=';
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_@./ -]+$/u;
const SENSITIVE_SEARCH_GLOBS = [
  '.env', '**/.env', '.env.*', '**/.env.*', '.netrc', '**/.netrc',
  '.npmrc', '**/.npmrc', '.pypirc', '**/.pypirc', 'credentials.json',
  '**/credentials.json', 'id_rsa', '**/id_rsa', 'id_ed25519', '**/id_ed25519',
  '*.key', '**/*.key', '*.pem', '**/*.pem', '*.p12', '**/*.p12',
  '*.pfx', '**/*.pfx', 'node_modules/**', '**/node_modules/**',
] as const;

export const REPAIR_TOOL_DEFINITIONS: readonly FunctionToolDefinition[] = [
  ['read_file', 'Read one bounded repository file. Unique tracked monorepo suffixes and missing ESM .js source references can resolve safely; the result names the resolved path.', { path: { type: 'string' }, startLine: { type: 'integer' }, endLine: { type: 'integer' } }, ['path']],
  ['search_repo', 'Search tracked repository files for a literal string.', { query: { type: 'string' }, paths: { type: 'array', items: { type: 'string' } } }, ['query']],
  ['run_test', 'Run one trusted test command by identifier.', { commandId: { type: 'string' } }, ['commandId']],
  ['apply_patch', 'Apply a complete unified diff or structured edits.', { diff: { type: 'string' }, edits: { type: 'array', items: { type: 'object' } } }, []],
  ['inspect_diff', 'Inspect the cumulative diff and policy findings.', {}, []],
  ['submit_candidate', 'Submit the tested cumulative repair candidate.', { id: { type: 'string' }, rationale: { type: 'string' } }, ['id', 'rationale']],
].map(([name, description, properties, required]) => ({
  type: 'function' as const,
  function: {
    name: name as string,
    description: description as string,
    strict: true,
    parameters: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  },
}));

export type RepairToolFailureKind = 'invalid' | 'policy' | 'sandbox' | 'budget';

export interface RepairTestEvidence {
  commandId: string;
  imageId: ImageId;
  exitCode: number;
  output: string;
  metrics?: RunResult['metrics'];
}

export interface RepairToolState {
  editableImageId: ImageId;
  cumulativeDiff: string;
  latestTest?: RepairTestEvidence;
  lastNodeId?: string;
}

export interface RepairToolResult {
  ok: boolean;
  kind?: RepairToolFailureKind;
  message: string;
  submitted?: boolean;
  candidate?: Candidate;
  imageId?: ImageId;
  nodeId?: string;
  exitCode?: number;
}

interface ReadPathOutcome {
  result: RepairToolResult;
  resolvedPath?: string;
  editableContent?: string;
}

export interface RepairToolRuntimeOptions {
  executor: Executor;
  initialImageId: ImageId;
  diagnosis: Diagnosis;
  policy: RepositoryPolicy;
  budget: RepairBudget;
  trustedCommands: Readonly<Record<string, string>>;
  sourceContext: RepairSourceContext;
  authorization?: RepairAuthorizationContext;
  signal?: AbortSignal;
  operationIdPrefix?: string;
  onOperationStart?: (operationId: string) => void;
  observe?: (input: { result?: RunResult; imageId?: ImageId; parentImageId: ImageId; note: string }) => string;
}

function exactObject(value: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every((key) => allowed.includes(key)) ? record : null;
}

function safePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 240 || !SAFE_PATH.test(value)) return null;
  if (value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return value;
}

function bounded(value: string): string {
  const text = boundedTail(value, { maxLines: MAX_READ_LINES, maxCharacters: MAX_TOOL_OUTPUT_BYTES, maxBytes: MAX_TOOL_OUTPUT_BYTES });
  return redactExternalText(text).text;
}

function failure(kind: RepairToolFailureKind, message: string): RepairToolResult {
  return { ok: false, kind, message: bounded(message) };
}

function allowsSourceRead(path: string, policy: RepositoryPolicy): boolean {
  return !isSensitiveRepositoryPath(path) && policyAllowsSourceRead(path, policy);
}

function typescriptSourceFallbacks(path: string, policy: RepositoryPolicy): string[] {
  return typescriptSourceVariants(path).filter((candidate) => allowsSourceRead(candidate, policy));
}

function noSymlinksFor(path: string): string {
  return path.split('/').map((_, index, segments) =>
    `test ! -L ${shellQuote(segments.slice(0, index + 1).join('/'))}`,
  ).join(' && ');
}

export class RepairToolRuntime {
  private current: RepairToolState;
  private readonly sourceExcerpts: RepairSourceExcerpt[] = [];
  private operationIndex = 0;

  constructor(private readonly options: RepairToolRuntimeOptions) {
    this.current = { editableImageId: options.initialImageId, cumulativeDiff: '' };
    for (const source of options.sourceContext.sources) {
      if (redactExternalText(source.content).count === 0) this.upsertSourceExcerpt(source);
    }
  }

  state(): Readonly<RepairToolState> { return { ...this.current }; }

  private async run(
    command: string,
    parent = this.current.editableImageId,
    maximumTimeoutSec = MAX_TOOL_TIMEOUT_SEC,
  ): Promise<RunResult> {
    this.options.budget.reserveSandboxOperation();
    const timeoutSec = Math.min(
      maximumTimeoutSec,
      this.options.budget.remainingElapsedTimeSec(),
    );
    this.operationIndex += 1;
    const operationId = `${this.options.operationIdPrefix ?? `repair-${randomUUID()}`}-op-${String(this.operationIndex).padStart(3, '0')}`;
    this.options.onOperationStart?.(operationId);
    return withinRecoveryDeadline(timeoutSec, this.options.signal, () => this.options.executor.run(parent, command, {
      cwd: '/workspace', timeoutSec, operationId, network: 'disabled',
    }), async () => this.options.executor.cancel(operationId));
  }

  private observe(result: RunResult | undefined, parentImageId: ImageId, note: string, imageId?: ImageId): string | undefined {
    return this.options.observe?.({
      ...(result === undefined ? {} : { result }),
      ...(imageId === undefined ? {} : { imageId }),
      parentImageId,
      note,
    });
  }

  async execute(name: string, rawArguments: unknown): Promise<RepairToolResult> {
    try {
      switch (name) {
        case 'read_file': return await this.readFile(rawArguments);
        case 'search_repo': return await this.searchRepo(rawArguments);
        case 'run_test': return await this.runTest(rawArguments);
        case 'apply_patch': return await this.applyPatch(rawArguments);
        case 'inspect_diff': return await this.inspectDiff(rawArguments);
        case 'submit_candidate': return this.submitCandidate(rawArguments);
        default: return failure('invalid', `Unknown repair tool: ${name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failure(
        error instanceof BudgetExceededError
          ? 'budget'
          : error instanceof RangeError || error instanceof SyntaxError
            ? 'invalid'
            : 'sandbox',
        message,
      );
    }
  }

  private async readFile(value: unknown): Promise<RepairToolResult> {
    const args = exactObject(value, ['path', 'startLine', 'endLine']);
    const path = safePath(args?.path);
    if (!args || !path) return failure('invalid', 'read_file requires one valid repository-relative path');
    if (!allowsSourceRead(path, this.options.policy)) {
      return failure('policy', 'Repository policy denies this source read');
    }
    const start = args.startLine === undefined ? 1 : Number(args.startLine);
    const end = args.endLine === undefined ? start + MAX_READ_LINES - 1 : Number(args.endLine);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start >= MAX_READ_LINES) {
      return failure('invalid', `read_file line window must contain at most ${MAX_READ_LINES} lines`);
    }
    const direct = await this.readPath(path, start, end);
    if (direct.result.ok || !path.startsWith('src/')) return this.renderReadResult(path, start, direct);
    const resolvedPath = await this.resolveMonorepoSuffix(path);
    if (resolvedPath === undefined) return direct.result;
    const resolved = await this.readPath(resolvedPath, start, end);
    return this.renderReadResult(path, start, {
      result: resolved.result,
      resolvedPath: resolved.resolvedPath ?? resolvedPath,
      ...(resolved.editableContent === undefined ? {} : { editableContent: resolved.editableContent }),
    });
  }

  private renderReadResult(requestedPath: string, startLine: number, outcome: ReadPathOutcome): RepairToolResult {
    if (!outcome.result.ok) return outcome.result;
    const finalPath = outcome.resolvedPath ?? requestedPath;
    if (outcome.editableContent !== undefined) {
      this.upsertSourceExcerpt({
        path: finalPath,
        startLine,
        content: outcome.editableContent,
        truncated: true,
      });
    }
    return finalPath === requestedPath
      ? outcome.result
      : { ...outcome.result, message: `Sutura resolved source: ${finalPath}\n${outcome.result.message}` };
  }

  private upsertSourceExcerpt(source: RepairSourceExcerpt): void {
    const existing = this.sourceExcerpts.findIndex((candidate) =>
      candidate.path === source.path && candidate.startLine === source.startLine,
    );
    if (existing !== -1) this.sourceExcerpts.splice(existing, 1);
    this.sourceExcerpts.push(source);
    if (this.sourceExcerpts.length > MAX_DYNAMIC_SOURCE_EXCERPTS) this.sourceExcerpts.shift();
  }

  private invalidateSourceExcerpts(paths: readonly string[]): void {
    const changed = new Set(paths);
    for (let index = this.sourceExcerpts.length - 1; index >= 0; index -= 1) {
      if (changed.has(this.sourceExcerpts[index]!.path)) this.sourceExcerpts.splice(index, 1);
    }
  }

  private async readPath(path: string, start: number, end: number): Promise<ReadPathOutcome> {
    const noSymlinks = noSymlinksFor(path);
    const fallbackPaths = typescriptSourceFallbacks(path, this.options.policy);
    const fallbacks = fallbackPaths.map((fallback) =>
      `if test "$path" = "$requested" && test ! -e "$requested" && test ! -L "$requested"; then fallback=${shellQuote(fallback)}; if test -f "$fallback" && test ! -L "$fallback" && git ls-files --error-unmatch -- "$fallback" >/dev/null 2>&1; then path="$fallback"; resolved="$fallback"; fi; fi`,
    ).join('; ');
    const command = `requested=${shellQuote(path)}; path="$requested"; resolved=''; ${noSymlinks} && { ${fallbacks}${fallbacks ? '; ' : ''}test ! -L "$path" && test -f "$path" && test "$(wc -c < "$path")" -le ${MAX_READ_BYTES} && { LC_ALL=C grep -Iq . "$path" || test ! -s "$path"; } && { if test -n "$resolved"; then printf '${RESOLVED_SOURCE_PREFIX}%s\\n' "$resolved" >&2; fi; sed -n '${start},${end}p' "$path"; }; }`;
    const result = await this.run(command);
    this.observe(result, this.current.editableImageId, `read_file ${path}`);
    if (result.truncated || Buffer.byteLength(result.stdout, 'utf8') > MAX_READ_BYTES) {
      return { result: failure('sandbox', 'File output exceeded the bounded tool limit') };
    }
    if (result.exitCode !== 0) return { result: failure('sandbox', 'File is missing, binary, oversized, or symlinked') };
    const resolution = result.stderr.trim();
    const resolvedPath = fallbackPaths.find((candidate) => resolution === `${RESOLVED_SOURCE_PREFIX}${candidate}`);
    if (resolution && resolvedPath === undefined) return { result: failure('sandbox', 'File resolution metadata was invalid') };
    const redaction = redactExternalText(result.stdout);
    return {
      result: {
        ok: true,
        message: redaction.text,
        imageId: result.imageId,
        exitCode: result.exitCode,
      },
      ...(resolvedPath === undefined ? {} : { resolvedPath }),
      ...(redaction.count === 0 ? { editableContent: result.stdout } : {}),
    };
  }

  private async resolveMonorepoSuffix(path: string): Promise<string | undefined> {
    const suffixes = [path, ...typescriptSourceVariants(path)];
    const queries = suffixes.map((suffix, index) =>
      `git ls-files -- ${shellQuote(`:(glob)**/${suffix}`)} | head -n 3 | awk -v group=${index} '{ print group "\\t" $0 }'`,
    ).join('; ');
    const command = `${noSymlinksFor(path)} && test ! -e ${shellQuote(path)} && test ! -L ${shellQuote(path)} && { ${queries}; }`;
    const result = await this.run(command);
    this.observe(result, this.current.editableImageId, `resolve_file_suffix ${path}`);
    if (
      result.exitCode !== 0 ||
      result.truncated ||
      Buffer.byteLength(result.stdout, 'utf8') > MAX_SUFFIX_RESOLUTION_BYTES
    ) return undefined;
    const groups = suffixes.map(() => [] as string[]);
    for (const line of result.stdout.split(/\r?\n/u).filter(Boolean)) {
      const separator = line.indexOf('\t');
      const index = Number(line.slice(0, separator));
      if (separator < 1 || !Number.isSafeInteger(index) || index < 0 || index >= groups.length) return undefined;
      groups[index]?.push(line.slice(separator + 1));
    }
    for (const [index, candidates] of groups.entries()) {
      if (candidates.length > 1) return undefined;
      if (candidates.length === 0) continue;
      const suffix = suffixes[index];
      if (suffix === undefined) return undefined;
      const candidate = safePath(candidates[0]);
      if (
        candidate === null ||
        candidate === path ||
        !candidate.endsWith(`/${suffix}`) ||
        !allowsSourceRead(candidate, this.options.policy)
      ) return undefined;
      return candidate;
    }
    return undefined;
  }

  private async searchRepo(value: unknown): Promise<RepairToolResult> {
    const args = exactObject(value, ['query', 'paths']);
    if (!args || typeof args.query !== 'string' || !args.query || args.query.length > 256 || /[\r\n\0]/u.test(args.query)) {
      return failure('invalid', 'search_repo requires a bounded literal query');
    }
    const pathsValue = args.paths ?? ['.'];
    if (!Array.isArray(pathsValue) || pathsValue.length === 0 || pathsValue.length > 8) return failure('invalid', 'search_repo paths are invalid');
    const paths = pathsValue.map((path) => path === '.' ? '.' : safePath(path));
    if (paths.some((path) => path === null)) return failure('invalid', 'search_repo paths must be repository-relative');
    if ((paths as string[]).some((path) => !allowsSourceRead(path, this.options.policy))) {
      return failure('policy', 'Repository policy denies one search path');
    }
    const excluded = [...SENSITIVE_SEARCH_GLOBS, ...this.options.policy.deniedReadPaths]
      .map((glob) => shellQuote(`:(exclude,glob)${glob}`));
    const pathspecs = [...(paths as string[]).map(shellQuote), ...excluded].join(' ');
    const command = `results="$(mktemp /tmp/sutura-search.XXXXXX)"; git grep -F -n --max-count=40 -e ${shellQuote(args.query)} -- ${pathspecs} >"$results"; status=$?; head -c ${MAX_TOOL_OUTPUT_BYTES} "$results"; rm -f "$results"; test "$status" -le 1`;
    const result = await this.run(command);
    this.observe(result, this.current.editableImageId, 'search_repo literal query');
    if (result.truncated || Buffer.byteLength(result.stdout, 'utf8') > MAX_TOOL_OUTPUT_BYTES) {
      return failure('sandbox', 'Search output exceeded the bounded tool limit');
    }
    const filtered = result.stdout.split(/\r?\n/u).filter((line) => {
      const separator = line.indexOf(':');
      if (separator < 1) return false;
      const resultPath = line.slice(0, separator);
      return safePath(resultPath) !== null && allowsSourceRead(resultPath, this.options.policy);
    }).join('\n');
    return result.exitCode <= 1
      ? { ok: true, message: bounded(filtered || 'No matches'), imageId: result.imageId, exitCode: result.exitCode }
      : failure('sandbox', `Repository search failed with exit ${result.exitCode}`);
  }

  private async runTest(value: unknown): Promise<RepairToolResult> {
    const args = exactObject(value, ['commandId']);
    if (!args || typeof args.commandId !== 'string') return failure('invalid', 'run_test requires commandId');
    const command = this.options.trustedCommands[args.commandId];
    if (command === undefined) return failure('policy', 'run_test commandId is not trusted');
    const result = await this.run(command, this.current.editableImageId, MAX_TEST_TIMEOUT_SEC);
    const output = bounded([result.stdout, result.stderr].filter(Boolean).join('\n'));
    if (
      result.truncated ||
      Buffer.byteLength([result.stdout, result.stderr].filter(Boolean).join('\n'), 'utf8') > MAX_TOOL_OUTPUT_BYTES
    ) {
      return failure('sandbox', 'Test output exceeded the bounded tool limit');
    }
    this.current.latestTest = { commandId: args.commandId, imageId: result.imageId, exitCode: result.exitCode, output, metrics: result.metrics };
    this.observe(result, this.current.editableImageId, `run_test ${args.commandId}`);
    return { ok: true, message: output || `Test exited ${result.exitCode}`, imageId: result.imageId, exitCode: result.exitCode };
  }

  /**
   * Every diff this branch proposes or accumulates stays inside the repair
   * transaction's file cap, which is the stricter of the two-file bound and the
   * repository policy. A controller-generated artifact counts against it like
   * any other changed file.
   */
  private async validateDiff(diff: string): Promise<ReturnType<typeof validateCandidateDiff>> {
    const authorization = this.options.authorization;
    if (authorization !== undefined) {
      await authorizeRepairCandidate(authorization.session, authorization.baseline, diff);
    }
    const validation = validateCandidateDiff(
      diff, this.options.diagnosis, this.options.policy,
      this.options.budget.limits.diffBytes, authorization,
    );
    const cap = repairTargetFileCap(this.options.policy);
    if (validation.changedFiles.length <= cap) return validation;
    return {
      ...validation,
      ok: false,
      violations: [
        ...validation.violations,
        `changes ${validation.changedFiles.length} files; the repair transaction permits at most ${cap}`,
      ],
    };
  }

  private async applyPatch(value: unknown): Promise<RepairToolResult> {
    const args = exactObject(value, ['diff', 'edits']);
    if (!args || (typeof args.diff !== 'string' && args.edits === undefined) || (args.diff !== undefined && args.edits !== undefined)) {
      return failure('invalid', 'apply_patch requires exactly one of diff or edits');
    }
    let diff: string;
    try {
      diff = typeof args.diff === 'string'
        ? args.diff
        : structuredEditsDiff(args.edits, {
            sources: this.sourceExcerpts.toReversed(),
          });
    } catch (error) {
      return failure('invalid', error instanceof Error ? error.message : String(error));
    }
    const proposed = await this.validateDiff(diff);
    if (!proposed.ok) return failure('policy', proposed.violations.join('; '));
    const encoded = Buffer.from(diff, 'utf8').toString('base64');
    const command = `printf '%s' ${shellQuote(encoded)} | base64 --decode | git apply - && git diff --no-ext-diff --no-renames --binary HEAD --`;
    const parent = this.current.editableImageId;
    const result = await this.run(command, parent);
    if (result.exitCode !== 0) return failure('sandbox', bounded(result.stderr || 'Patch did not apply'));
    if (result.truncated) return failure('sandbox', 'Cumulative diff output was truncated');
    const cumulative = result.stdout;
    const validation = await this.validateDiff(cumulative);
    if (!validation.ok) return failure('policy', validation.violations.join('; '));
    this.options.budget.assertDiffBytes(validation.diffBytes);
    this.invalidateSourceExcerpts(proposed.changedFiles);
    const nodeId = this.observe(result, parent, 'apply_patch accepted');
    this.current = {
      editableImageId: result.imageId,
      cumulativeDiff: cumulative,
      ...(nodeId === undefined ? {} : { lastNodeId: nodeId }),
    };
    return {
      ok: true,
      message: bounded(`Patch accepted. ${validation.changedFiles.length} files, ${validation.diffBytes} bytes.`),
      imageId: result.imageId,
      ...(nodeId === undefined ? {} : { nodeId }),
      exitCode: 0,
    };
  }

  private async inspectDiff(value: unknown): Promise<RepairToolResult> {
    if (!exactObject(value, [])) return failure('invalid', 'inspect_diff accepts no arguments');
    const result = await this.run('git diff --no-ext-diff --no-renames --binary HEAD --');
    if (result.truncated || Buffer.byteLength(result.stdout, 'utf8') > MAX_TOOL_OUTPUT_BYTES) {
      return failure('sandbox', 'Diff inspection output exceeded the bounded tool limit');
    }
    const validation = await this.validateDiff(result.stdout);
    this.observe(result, this.current.editableImageId, 'inspect_diff');
    return {
      ok: result.exitCode === 0,
      ...(result.exitCode === 0 ? {} : { kind: 'sandbox' as const }),
      message: bounded(JSON.stringify({ diff: result.stdout, changedFiles: validation.changedFiles, bytes: validation.diffBytes, findings: validation.violations })),
      imageId: result.imageId,
      exitCode: result.exitCode,
    };
  }

  private submitCandidate(value: unknown): RepairToolResult {
    const args = exactObject(value, ['id', 'rationale']);
    if (!args || typeof args.id !== 'string' || !args.id.trim() || typeof args.rationale !== 'string' || !args.rationale.trim()) {
      return failure('invalid', 'submit_candidate requires non-empty id and rationale');
    }
    if (!this.current.cumulativeDiff) return failure('invalid', 'A non-empty cumulative diff is required');
    if (!this.current.latestTest || this.current.latestTest.exitCode !== 0) return failure('invalid', 'The latest trusted test must pass before submission');
    const candidate = { id: args.id.slice(0, 80), rationale: args.rationale.slice(0, 240), diff: this.current.cumulativeDiff };
    return {
      ok: true,
      submitted: true,
      candidate,
      imageId: this.current.editableImageId,
      ...(this.current.lastNodeId === undefined ? {} : { nodeId: this.current.lastNodeId }),
      exitCode: 0,
      message: 'Candidate submitted for independent audit',
    };
  }
}
