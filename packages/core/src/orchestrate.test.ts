import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_MODELS } from './config.js';
import type {
  AuditVerdict,
  Candidate,
  CostLedger,
  Diagnosis,
} from './domain.js';
import { InMemoryExecutor } from './executor/memory.js';
import type { InMemoryCall, InMemoryRunResult } from './executor/memory.js';
import { completedTriageVerdict, notRunTriageVerdict } from './engine/triage.js';
import type { TierLlm } from './llm/types.js';
import { DEFAULT_MODEL_PRICES } from './llm/cost.js';
import {
  type HttpRequestInit,
  type HttpResponse,
} from './llm/nebius.js';
import { DEFAULT_ROUTING_PROFILE_ID } from './llm/router.js';
import { createTokenFactoryClient } from './llm/token-factory.js';
import { ReplayRecorder } from './replay/bundle.js';
import { repairProposalReply } from './testing/repair-proposal.test-helper.js';
import {
  capturedFailingRun,
  capturedLiveRun,
} from './__fixtures__/captured/captured-live-run.test-helper.js';
import { parseRepositoryPolicy } from './policy/schema.js';
import {
  AlreadyAttemptedError,
  OrchestrationError,
  SUTURA_SANDBOX_ENV,
  attemptMarker,
  collectFailedLogs,
  extractSourceReferences,
  orchestrate,
  readRepairSourceContext,
  resolveAuditedCandidate,
  type AttemptTarget,
  type FailingWorkflowRun,
  type GitHubOrchestrationPort,
  type OrchestrationContext,
  type RepositoryPort,
} from './orchestrate.js';

const HONEST_DIFF = [
  'diff --git a/src/value.ts b/src/value.ts',
  '--- a/src/value.ts',
  '+++ b/src/value.ts',
  '@@ -1,1 +1,1 @@',
  '-export const value: string = 1;',
  '+export const value: string = "1";',
].join('\n') + '\n';
const HONEST_REPLACEMENT = 'export const value: string = "1";\n';

const SECOND_DIFF = HONEST_DIFF.replace(
  '+export const value: string = "1";',
  '+export const value: string = String(1);',
);
const THIRD_DIFF = HONEST_DIFF.replace(
  '+export const value: string = "1";',
  '+export const result: string = "1";',
);

const DOGFOOD_DIFF = [
  'diff --git a/packages/core/src/dogfood-add.ts b/packages/core/src/dogfood-add.ts',
  '--- a/packages/core/src/dogfood-add.ts',
  '+++ b/packages/core/src/dogfood-add.ts',
  '@@ -1,3 +1,3 @@',
  ' export function add(left: number, right: number): number {',
  '-  return left - right;',
  '+  return left + right;',
  ' }',
  '',
].join('\n');

function capturedDogfoodLog(rawLog: string): string {
  const lines = rawLog.split(/\r?\n/u).filter((line) =>
    /##\[group\]Run pnpm run test$/u.test(line)
    || /dogfood-add|expected -1 to be 5/u.test(line),
  );
  if (lines.length < 3) throw new Error('Captured dogfood log lacks its command or failure');
  return lines.join('\n');
}

const RUN: FailingWorkflowRun = {
  runId: '98765',
  repo: 'acme/widget',
  prNumber: 42,
  headSha: '0123456789abcdef0123456789abcdef01234567',
  headRef: 'feature/broken-build',
  baseSha: '89abcdef0123456789abcdef0123456789abcdef',
  baseRef: 'develop',
  failedSteps: [
    {
      jobName: 'test',
      stepName: 'Run tests',
      log: 'Run pnpm test\nsrc/value.ts(1,14): error TS2322: Type number is not assignable to type string',
    },
  ],
};

class FakeGitHub implements GitHubOrchestrationPort {
  readonly comments: Array<{ id: number; prNumber: number | undefined; body: string }> = [];
  readonly pullRequests: Array<{
    baseRef: string;
    branch: string;
    body: string;
    headSha: string;
    title: string;
  }> = [];
  readonly artifacts: Array<{ name: string; html: string }> = [];
  readonly checks: Array<{ target: AttemptTarget; input: import('./orchestrate.js').CompleteCheckInput }> = [];

  constructor(readonly run = RUN) {}

  async getFailingRun(runId: string): Promise<FailingWorkflowRun> {
    expect(runId).toBe(this.run.runId);
    return this.run;
  }

  async claimAttempt(
    prNumber: number | undefined,
    marker: string,
  ): Promise<AttemptTarget | null> {
    if (this.comments.some(
      (comment) => comment.prNumber === prNumber && comment.body.includes(marker),
    )) return null;
    const id = this.comments.length + 1;
    this.comments.push({ id, prNumber, body: marker });
    return {
      kind: prNumber === undefined ? 'commit' : 'pull-request',
      commentId: id,
      checkRunId: 700 + id,
      headSha: this.run.headSha,
    };
  }

  async updateAttempt(target: AttemptTarget, body: string): Promise<void> {
    const comment = this.comments.find(({ id }) => id === target.commentId);
    if (!comment) throw new Error(`Unknown comment ${String(target.commentId)}`);
    comment.body = body;
  }

  async createFixPullRequest(input: {
    baseRef: string;
    branch: string;
    body: string;
    headSha: string;
    title: string;
  }): Promise<{ number: number; url: string }> {
    this.pullRequests.push(input);
    return { number: 43, url: 'https://github.test/acme/widget/pull/43' };
  }

  async uploadCaseFile(name: string, html: string): Promise<{ url: string }> {
    this.artifacts.push({ name, html });
    return { url: `https://github.test/artifacts/${name}` };
  }

  async uploadReplayBundle(name: string, json: string): Promise<{ url: string }> {
    this.artifacts.push({ name, html: json });
    return { url: `https://github.test/artifacts/${name}` };
  }

  async completeCheck(target: AttemptTarget, input: import('./orchestrate.js').CompleteCheckInput): Promise<void> {
    this.checks.push({ target, input });
  }
}

class FakeRepository implements RepositoryPort {
  readonly checkouts: Array<{ repo: string; sha: string }> = [];
  readonly fixes: Array<{
    branch: string;
    checkoutDir: string;
    diff: string;
    headSha: string;
    message: string;
  }> = [];
  readonly sourceReads: Array<{
    checkoutDir: string;
    paths: string[];
  }> = [];
  readonly sources = new Map([
    ['src/value.ts', 'export const value: string = 1;\n'],
  ]);
  policyContent: string | null = null;
  readonly policyReads: Array<{ repo: string; sha: string }> = [];

  async readPolicyAtSha(repo: string, sha: string): Promise<string | null> {
    this.policyReads.push({ repo, sha });
    return this.policyContent;
  }

  async checkoutHead(repo: string, sha: string): Promise<string> {
    this.checkouts.push({ repo, sha });
    return '/tmp/exact-pr-head';
  }

  async readSourceExcerpts(
    checkoutDir: string,
    references: readonly { path: string; line?: number }[],
    _limits: {
      maxFiles: number;
      maxLinesPerFile: number;
      maxCharactersPerFile: number;
      maxBytesPerFile: number;
    },
  ): Promise<Array<{
    path: string;
    startLine: number;
    content: string;
    truncated: boolean;
  }>> {
    expect(_limits).toEqual({
      maxFiles: 8,
      maxLinesPerFile: 120,
      maxCharactersPerFile: 1_000,
      maxBytesPerFile: 1_000,
    });
    this.sourceReads.push({
      checkoutDir,
      paths: references.map(({ path }) => path),
    });
    return references.flatMap(({ path }) => {
      const content = this.sources.get(path);
      return content === undefined
        ? []
        : [{
            path,
            startLine: 1,
            content,
            truncated: false,
          }];
    });
  }

  async publishFix(input: {
    branch: string;
    checkoutDir: string;
    diff: string;
    headSha: string;
    message: string;
  }): Promise<void> {
    this.fixes.push(input);
  }
}

function ledger(): CostLedger {
  return { entries: [], totalUsd: () => 0 };
}

function candidates(): Candidate[] {
  return [
    { id: 'source', rationale: 'correct the source type', diff: HONEST_DIFF },
    { id: 'alternate', rationale: 'use the declared number type', diff: SECOND_DIFF },
    { id: 'rename', rationale: 'rename the invalid binding', diff: THIRD_DIFF },
  ];
}

function diagnosisReply(): Diagnosis {
  return {
    class: 'typecheck',
    confidence: 0.98,
    signals: ['TS2322'],
    failingCmd: 'pnpm test',
    errorExcerpt: 'TS2322: Type number is not assignable to type string',
  };
}

function scriptedLlm(auditVerdict: AuditVerdict['approved'] = true): {
  llm: TierLlm<'nano' | 'super' | 'ultra'>;
  chat: ReturnType<typeof vi.fn>;
} {
  const chat = vi.fn(async (tier: 'nano' | 'super' | 'ultra') => {
    if (tier === 'nano') return { text: JSON.stringify(diagnosisReply()) };
    if (tier === 'super') {
      return repairProposalReply(candidates()[0]!, HONEST_REPLACEMENT);
    }
    return {
      text: JSON.stringify({
        approved: auditVerdict,
        reasoning: auditVerdict
          ? 'The patch corrects the diagnosed source type.'
          : 'REFUSED: the patch changes a different contract.',
      }),
    };
  });
  const modelQuote = (tier: 'nano' | 'super' | 'ultra') => ({
    role: tier,
    modelId: DEFAULT_MODELS[tier],
    price: DEFAULT_MODEL_PRICES[tier],
    profileId: DEFAULT_ROUTING_PROFILE_ID,
  });
  return { llm: { chat, modelQuote }, chat };
}

function runResult(exitCode: number): InMemoryRunResult {
  return {
    exitCode,
    stdout: exitCode === 0 ? 'Tests passed' : '',
    stderr: exitCode === 0 ? '' : 'TS2322',
    truncated: false,
    metrics: {},
  };
}

function providerResponse(content: string): HttpResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    async json() {
      return {
        choices: [{ finish_reason: 'stop', message: { content } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          completion_tokens_details: { reasoning_tokens: 0 },
        },
      };
    },
    async text() {
      return '';
    },
  };
}

function context(
  exits: number[],
  auditVerdict = true,
  run = RUN,
): {
  ctx: OrchestrationContext;
  executor: InMemoryExecutor;
  github: FakeGitHub;
  repository: FakeRepository;
  chat: ReturnType<typeof vi.fn>;
} {
  const github = new FakeGitHub(run);
  const repository = new FakeRepository();
  let scenarioIndex = 0;
  let agentPatched = false;
  const executor = new InMemoryExecutor((command) => {
    if (command.includes('git apply - && git diff')) {
      agentPatched = true;
      const encoded = command.match(/printf '%s' '?([A-Za-z0-9+/=]+)'? \|/u)?.[1] ?? '';
      return { ...runResult(0), stdout: Buffer.from(encoded, 'base64').toString('utf8') };
    }
    if (
      command.includes('corepack pnpm install --frozen-lockfile') ||
      command.includes('git init --quiet')
    ) return runResult(0);
    if (agentPatched) {
      agentPatched = false;
      const firstRaceExit = exits[scenarioIndex] ?? 1;
      scenarioIndex += 3;
      return runResult(firstRaceExit);
    }
    return runResult(exits[scenarioIndex++] ?? 1);
  });
  const { llm, chat } = scriptedLlm(auditVerdict);
  return {
    github,
    repository,
    executor,
    chat,
    ctx: {
      runId: run.runId,
      github,
      repository,
      executor,
      llm,
      cost: ledger(),
      triageN: 2,
      raceK: 3,
      runtimeId: 'node',
    },
  };
}

function runCalls(executor: InMemoryExecutor): Extract<InMemoryCall, { kind: 'run' }>[] {
  return executor.calls.filter(
    (call): call is Extract<InMemoryCall, { kind: 'run' }> => call.kind === 'run',
  );
}

describe('orchestrate', () => {
  it('replays live crash B4', async () => {
    const captured = await capturedFailingRun('A3', '33239848825');
    const currentLog = captured.run.failedSteps[0]!.log;
    const preFixLog = currentLog
      .split(/\r?\n/u)
      .slice(1)
      .join('\n');
    const run: FailingWorkflowRun = {
      runId: captured.bundle.runId,
      repo: captured.bundle.repo,
      headSha: captured.bundle.actionSha,
      baseSha: captured.bundle.actionSha,
      headRef: 'develop',
      baseRef: 'develop',
      failedSteps: [{ jobName: 'checks', stepName: 'Test CLI', log: preFixLog }],
    };
    const { ctx, chat, executor, github } = context([], true, run);

    await expect(orchestrate(ctx)).rejects.toEqual(new OrchestrationError(
      'Failed-step logs do not contain an observed failing command',
    ));
    expect(currentLog).toContain('##[group]Run pnpm run test');
    expect(preFixLog).not.toContain('##[group]Run pnpm run test');
    expect(chat).not.toHaveBeenCalled();
    expect(executor.calls).toEqual([]);
    expect(github.comments).toEqual([]);
  });

  it.each([
    ['different workflow run id', { runId: '1' }, 'different workflow run id'],
    ['invalid workflow run id', { runId: '../unsafe' }, 'positive decimal id'],
    ['empty repository', { repo: '' }, 'invalid repository metadata'],
    ['invalid pull request number', { prNumber: 0 }, 'invalid repository metadata'],
    ['invalid head SHA', { headSha: 'bad' }, 'invalid head SHA'],
    ['invalid base SHA', { baseSha: 'bad' }, 'invalid base SHA'],
    ['empty head ref', { headRef: '' }, 'empty head or base ref'],
    ['empty base ref', { baseRef: '' }, 'empty head or base ref'],
    ['no failed steps', { failedSteps: [] }, 'no failed-step logs'],
  ] as const)('rejects captured run metadata with %s', async (_case, override, message) => {
    const captured = await capturedFailingRun('A3', '33239848825');
    const invalid = { ...captured.run, ...override } as FailingWorkflowRun;
    const { ctx, github, executor, chat } = context([], true, captured.run);
    vi.spyOn(github, 'getFailingRun').mockResolvedValue(invalid);
    if ('runId' in override && override.runId !== '1') ctx.runId = override.runId;

    await expect(orchestrate(ctx)).rejects.toThrow(message);
    expect(executor.calls).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  it('rejects a captured A2 runtime conflict before sandbox or provider work', async () => {
    const captured = await capturedFailingRun('A2', '33238191746');
    const { ctx, repository, executor, chat } = context([], true, captured.run);
    ctx.runtimeId = 'python';
    repository.policyContent = JSON.stringify({ version: 1, runtime: 'node' });

    await expect(orchestrate(ctx)).rejects.toThrow(
      'Configured runtime conflicts with repository policy runtime',
    );
    expect(executor.calls).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  it('rejects an unverified Python image before sandbox or provider work', async () => {
    const captured = await capturedFailingRun('A2', '33238191746');
    const pythonRun: FailingWorkflowRun = {
      ...captured.run,
      failedSteps: [{
        jobName: 'test',
        stepName: 'pytest',
        log: 'Run pytest -q\ntests/test_value.py:1: assertion failed',
      }],
    };
    const { ctx, executor, chat } = context([], true, pythonRun);
    ctx.runtimeId = 'python';
    ctx.imageRef = 'python:latest';

    await expect(orchestrate(ctx)).rejects.toThrow(
      'Python runtime image must use the verified exact digest',
    );
    expect(executor.calls).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  it('rejects a fixed case file without its audited candidate identity', () => {
    expect(() => resolveAuditedCandidate({ race: [] })).toThrow(
      'Fixed case file does not identify its audited candidate',
    );
  });

  it('rejects an ambiguous audited candidate identity', () => {
    const candidate = { id: 'duplicate', rationale: 'same', diff: HONEST_DIFF };
    const result = {
      candidate,
      imageId: 'node-1',
      nodeId: 'node-1',
      exitCode: 0,
      held: true,
    };

    expect(() => resolveAuditedCandidate({
      selectedCandidate: {
        id: candidate.id,
        diffHash: createHash('sha256').update(candidate.diff).digest('hex'),
      },
      race: [result, { ...result, imageId: 'node-2', nodeId: 'node-2' }],
    })).toThrow('Fixed case file audited candidate identity is ambiguous');
  });

  it('rejects an invalid base policy before provider or sandbox calls', async () => {
    const { ctx, executor, github, repository, chat } = context([]);
    repository.policyContent = '{"version":2}';

    await expect(orchestrate(ctx)).rejects.toThrow(/unsupported policy version/iu);

    expect(repository.policyReads).toEqual([{ repo: RUN.repo, sha: RUN.baseSha }]);
    expect(executor.calls).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
    expect(github.comments).toEqual([]);
  });

  it('binds public evidence to the exact base policy without provider image ids', async () => {
    const { ctx, repository } = context([1, 1, 1, 0, 1, 1, 0]);
    repository.policyContent = JSON.stringify({
      version: 1,
      allowedPaths: ['src/**'],
    });

    const caseFile = await orchestrate(ctx);

    expect(caseFile.policy).toEqual({
      baseRef: RUN.baseRef,
      baseSha: RUN.baseSha,
      policySha: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(caseFile.stages[0]).toMatchObject({
      stage: 'policy',
      nodeId: 'node-001',
      network: 'disabled',
    });
    expect(caseFile.race.every(({ imageId, nodeId }) =>
      imageId === nodeId && /^search-\d{3}$/u.test(nodeId),
    )).toBe(true);
    expect(JSON.stringify(caseFile)).not.toContain('memory-image');
  });

  it('never sends denied paths or their log lines to readers or external providers', async () => {
    const deniedRun: FailingWorkflowRun = {
      ...RUN,
      failedSteps: [{
        ...RUN.failedSteps[0]!,
        log: [
          'Run pnpm test',
          'src/private/token.ts:1: supersecret failure detail',
          '/home/runner/work/acme/acme/src/private/token.ts:2: runner-secret',
          'file:///workspace/src/private/token.ts:3: workspace-secret',
          'a/src/private/token.ts:4: git-secret',
          '/workspace/src/private data/token.ts:5: spaced-secret',
          'private.ts:6: root-secret',
          './private.ts:7: dot-root-secret',
          'src/value.ts:1: Type number is not assignable to type string',
        ].join('\n'),
      }],
    };
    const { ctx, repository, chat } = context(
      [1, 1, 1, 0, 1, 1, 0],
      true,
      deniedRun,
    );
    const search = vi.fn().mockResolvedValue([{
      title: 'Release notes',
      url: 'https://example.test/release',
      snippet: 'Documented breaking release',
    }]);
    ctx.tavily = { search };
    chat.mockImplementation(async (tier: 'nano' | 'super' | 'ultra') => {
      if (tier === 'nano') return { text: JSON.stringify({
        ...diagnosisReply(),
        class: 'dep-upstream-breaking',
      }) };
      if (tier === 'super') return repairProposalReply(candidates()[0]!, HONEST_REPLACEMENT);
      return { text: JSON.stringify({
        approved: true,
        reasoning: 'The patch corrects the diagnosed source type.',
      }) };
    });
    repository.policyContent = JSON.stringify({
      version: 1,
      allowedPaths: ['**'],
      deniedReadPaths: ['src/private/**', 'src/private data/**', 'private.ts'],
    });

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(repository.sourceReads.flatMap(({ paths }) => paths))
      .not.toContain('src/private/token.ts');
    const deniedEvidence = /src\/private|private\.ts|supersecret|runner-secret|workspace-secret|git-secret|spaced-secret|root-secret/u;
    expect(JSON.stringify(chat.mock.calls)).not.toMatch(deniedEvidence);
    expect(JSON.stringify(search.mock.calls)).not.toMatch(deniedEvidence);
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano', 'super', 'ultra']);
    expect(search).toHaveBeenCalledOnce();
  });

  it('refuses protected candidate paths before sandbox execution', async () => {
    const { ctx, executor, repository } = context([1, 1, 1]);
    repository.policyContent = JSON.stringify({
      version: 1,
      allowedPaths: ['src/**'],
      protectedPaths: ['src/**'],
    });

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(caseFile.race).toEqual([]);
    expect(caseFile.stages.some(({ stage }) => stage === 'search')).toBe(true);
    expect(runCalls(executor).some(({ cmd }) => cmd.includes('git apply'))).toBe(false);
  });

  it('opens one fix PR from the exact failing head after reproduction, triage, race, and audit', async () => {
    // reproduction, triage x2, race x3, audit rerun
    const { ctx, executor, github, repository, chat } = context([
      1, 1, 1, 0, 1, 1, 0,
    ]);

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(repository.checkouts).toEqual([
      { repo: RUN.repo, sha: RUN.headSha },
    ]);
    expect(repository.fixes).toEqual([
      expect.objectContaining({
        branch: 'sutura/fix-98765',
        checkoutDir: '/tmp/exact-pr-head',
        diff: HONEST_DIFF,
        headSha: RUN.headSha,
        message: expect.stringMatching(
          /^fix: repair CI failure with Sutura[\s\S]*Co-Authored-By:/,
        ),
      }),
    ]);
    expect(github.pullRequests).toEqual([
      expect.objectContaining({
        baseRef: RUN.headRef,
        branch: 'sutura/fix-98765',
        headSha: RUN.headSha,
      }),
    ]);
    expect(github.comments).toHaveLength(1);
    expect(github.comments[0]?.body).toContain(attemptMarker(RUN.runId));
    expect(github.comments[0]?.body).toContain('Open case-file artifact');
    expect(github.artifacts).toHaveLength(1);
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano', 'super', 'ultra']);
    expect(runCalls(executor)).toHaveLength(8);
  });

  it('keeps a fixed outcome when replay upload fails', async () => {
    const { ctx, github } = context([1, 1, 1, 0, 1, 1, 0]);
    ctx.replay = new ReplayRecorder(RUN.runId, RUN.repo, RUN.headSha, {
      triageN: 2, raceK: 3,
      models: { nano: 'nano', super: 'super', ultra: 'ultra' },
      routingProfileId: 'test', maxOps: 1,
    });
    const upload = vi.spyOn(github, 'uploadReplayBundle')
      .mockRejectedValue(new Error('artifact service unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(orchestrate(ctx)).resolves.toMatchObject({ outcome: 'fixed' });

    expect(upload).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith('Sutura could not upload the replay bundle.');
    expect(github.artifacts).toHaveLength(1);
    warn.mockRestore();
  });

  it('opens a fix PR against the exact branch for a direct push failure', async () => {
    const directRun: FailingWorkflowRun = {
      runId: RUN.runId,
      repo: RUN.repo,
      headSha: RUN.headSha,
      headRef: 'develop',
      baseSha: RUN.headSha,
      baseRef: 'develop',
      failedSteps: RUN.failedSteps,
    };
    const { ctx, github, repository } = context(
      [1, 1, 1, 0, 1, 1, 0],
      true,
      directRun,
    );
    const checkout = vi.spyOn(repository, 'checkoutHead');

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(checkout).toHaveBeenCalledWith(
      directRun.repo,
      directRun.headSha,
      directRun.headRef,
      undefined,
    );
    expect(github.comments[0]?.prNumber).toBeUndefined();
    expect(github.pullRequests[0]).toEqual(expect.objectContaining({
      baseRef: 'develop',
      headSha: directRun.headSha,
    }));
  });

  it('replays live runs 3, 4, 5, and 10 through the serialized production path', async () => {
    capturedLiveRun(3, '33241358531');
    capturedLiveRun(4, '33242204485');
    capturedLiveRun(5, '33243759945');
    capturedLiveRun(10, '33252323239');
    const captured = await capturedFailingRun('Live run 10', '33252323239');
    const dogfoodRun: FailingWorkflowRun = {
      ...captured.run,
      failedSteps: [{
        ...captured.run.failedSteps[0]!,
        log: capturedDogfoodLog(captured.jobLogText),
      }],
    };
    expect(extractSourceReferences(collectFailedLogs(dogfoodRun.failedSteps))).toContainEqual({
      path: 'packages/core/src/dogfood-add.test.ts',
      line: 7,
    });
    const { ctx, github, repository } = context(
      [1, 1, 1, 0, 1, 1, 0], true, dogfoodRun,
    );
    repository.sources.clear();
    repository.sources.set(
      'packages/core/src/dogfood-add.test.ts',
      "import { add } from './dogfood-add.js';\n\nit('adds', () => { expect(add(2, 3)).toBe(5); });\n",
    );
    repository.sources.set(
      'packages/core/src/dogfood-add.ts',
      'export function add(left: number, right: number): number {\n  return left - right;\n}\n',
    );
    const fetch = vi.fn(async (_url: string, init: HttpRequestInit): Promise<HttpResponse> => {
      const body = JSON.parse(init.body) as {
        model: string;
        messages: Array<{ role: string; content?: string | null }>;
        [key: string]: unknown;
      };
      if (body.model === DEFAULT_MODELS.nano) return providerResponse(JSON.stringify({
        class: 'test-assertion', confidence: 0.99, signals: ['expected -1 to be 5'],
        failingCmd: 'pnpm --filter @sutura/core test', errorExcerpt: 'expected -1 to be 5',
      }));
      if (body.model === DEFAULT_MODELS.super) {
        const request = JSON.parse(body.messages.find(({ role }) => role === 'user')?.content ?? '{}') as {
          sources?: Array<{ path: string; endLine: number; editable: boolean; lines: Array<{ line: number; text: string }> }>;
          selectedTarget?: { path: string; startLine: number; endLine: number };
        };
        expect(request.sources?.map(({ path }) => path)).toEqual([
          'packages/core/src/dogfood-add.test.ts',
          'packages/core/src/dogfood-add.ts',
        ]);
        expect(request.sources?.find(({ path }) => path.endsWith('dogfood-add.ts'))).toMatchObject({
          endLine: 3, editable: true,
          lines: expect.arrayContaining([{ line: 2, text: '  return left - right;' }]),
        });
        expect(request.sources?.find(({ path }) => path.endsWith('dogfood-add.test.ts')))
          .toMatchObject({ editable: false });
        expect(request.selectedTarget).toEqual({
          path: 'packages/core/src/dogfood-add.ts', startLine: 1, endLine: 3,
        });
        expect(JSON.stringify(body.response_format)).toContain('"replacement"');
        expect(JSON.stringify(body.response_format)).not.toMatch(/(?:dogfood-add|startLine|endLine|"path")/u);
        expect(body).not.toHaveProperty('tools');
        expect(body).not.toHaveProperty('tool_choice');
        expect(body).not.toHaveProperty('parallel_tool_calls');
        expect(body).not.toHaveProperty('reasoning_effort');
        expect(body).toMatchObject({
          max_tokens: 8_192,
          temperature: 1,
          top_p: 0.95,
          chat_template_kwargs: { enable_thinking: false },
        });
        expect(body).not.toHaveProperty('extra_body');
        return providerResponse(JSON.stringify({
          replacement: 'export function add(left: number, right: number): number {\n  return left + right;\n}\n',
        }));
      }
      expect(body.model).toBe(DEFAULT_MODELS.ultra);
      const auditRequest = JSON.parse(body.messages.find(({ role }) => role === 'user')?.content ?? '{}') as {
        candidateDiff?: string;
      };
      expect(auditRequest.candidateDiff).toBe(DOGFOOD_DIFF);
      return providerResponse(JSON.stringify({ approved: true, reasoning: 'The addition repair holds.' }));
    });
    const client = createTokenFactoryClient({
      apiKey: 'test-key',
      models: DEFAULT_MODELS,
    }, { fetch });
    ctx.llm = client;
    ctx.cost = client.ledger;

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(repository.fixes).toEqual([expect.objectContaining({
      branch: `sutura/fix-${dogfoodRun.runId}`,
      headSha: dogfoodRun.headSha,
      diff: DOGFOOD_DIFF,
    })]);
    expect(repository.fixes[0]?.diff).not.toContain('dogfood-add.test.ts');
    expect(github.pullRequests).toEqual([expect.objectContaining({
      baseRef: dogfoodRun.headRef,
      headSha: dogfoodRun.headSha,
    })]);
    expect(caseFile.selectedCandidate).toEqual({
      id: expect.stringMatching(/^repair-[a-f0-9]{12}$/u),
      diffHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(fetch.mock.calls.map(([, init]) =>
      JSON.parse((init as HttpRequestInit).body).model,
    )).toEqual([DEFAULT_MODELS.nano, DEFAULT_MODELS.super, DEFAULT_MODELS.ultra]);
  });

  it('publishes the same smallest held candidate that the audit approved', async () => {
    const { ctx, repository, chat } = context([1, 1, 1, 0, 0, 1, 0]);
    chat.mockImplementation(async (tier: 'nano' | 'super' | 'ultra') => {
      if (tier === 'nano') return { text: JSON.stringify(diagnosisReply()) };
      if (tier === 'super') {
        return repairProposalReply(
          { id: 'smallest', rationale: 'repair the observed source', diff: HONEST_DIFF },
          HONEST_REPLACEMENT,
        );
      }
      return { text: JSON.stringify({ approved: true, reasoning: 'The smallest held repair is correct.' }) };
    });

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(repository.fixes[0]?.diff).toBe(HONEST_DIFF);
    const auditCall = chat.mock.calls.find(([tier]) => tier === 'ultra');
    const auditMessages = auditCall?.[1] as Array<{ content: string }> | undefined;
    const auditInput = JSON.parse(auditMessages?.[1]?.content ?? '{}') as {
      candidateDiff?: string;
    };
    expect(auditInput.candidateDiff).toBe(HONEST_DIFF);
  });

  it('comments only when triage finds a flaky failure', async () => {
    // reproduction, then two passing triage runs
    const { ctx, github, repository, chat } = context([1, 0, 0]);

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('flaky-no-patch');
    expect(caseFile.triage).toEqual(completedTriageVerdict([0, 0], 2));
    expect(repository.fixes).toEqual([]);
    expect(github.pullRequests).toEqual([]);
    expect(github.comments[0]?.body).toContain('FLAKY');
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano']);
  });

  it('reports an adversarial refusal without creating a branch', async () => {
    const { ctx, github, repository } = context([1, 1, 1, 0, 1, 1, 0], false);

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('refused');
    expect(caseFile.audit?.approved).toBe(false);
    expect(repository.fixes).toEqual([]);
    expect(github.pullRequests).toEqual([]);
    expect(github.comments[0]?.body).toContain('REFUSED');
    expect(github.comments[0]?.body).toContain('Pathology');
  });

  it('reports every tried candidate when no repair holds', async () => {
    const { ctx, github, repository, chat } = context([1, 1, 1, 1, 1, 1]);

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(caseFile.race).toEqual([]);
    expect(repository.fixes).toEqual([]);
    expect(github.pullRequests).toEqual([]);
    expect(github.comments[0]?.body).toContain('NO PATCH HELD');
    expect(chat.mock.calls.map(([tier]) => tier).filter((tier) => tier === 'super').length)
      .toBeGreaterThan(1);
  });

  it('rejects model-selected candidate paths before sandbox repair work', async () => {
    const testPathRun: FailingWorkflowRun = {
      ...RUN,
      failedSteps: [{
        ...RUN.failedSteps[0]!,
        log: `${RUN.failedSteps[0]!.log}\nsrc/value-0.test.ts(1,1)\nsrc/value-1.test.ts(1,1)\nsrc/value-2.test.ts(1,1)`,
      }],
    };
    const { ctx, executor, github, repository, chat } = context(
      [1, 1, 1],
      true,
      testPathRun,
    );
    for (let index = 0; index < 3; index += 1) {
      repository.sources.set(`src/value-${index}.test.ts`, 'export const value: string = 1;');
    }
    chat.mockImplementation(async (tier: 'nano' | 'super' | 'ultra') => {
      if (tier === 'nano') return { text: JSON.stringify(diagnosisReply()) };
      if (tier === 'super') return { text: JSON.stringify({
        id: 'model-selected-path', rationale: 'Attempt to select a protected test target.',
        edits: [{
          path: 'src/value-0.test.ts', startLine: 1, endLine: 1,
          new: 'export const value: string = "1";',
        }],
      }) };
      return { text: JSON.stringify({ approved: true, reasoning: 'not reached' }) };
    });

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(caseFile.race).toEqual([]);
    expect(github.comments[0]?.body).toContain('NO PATCH HELD');
    expect(runCalls(executor).filter(({ cmd }) => cmd.includes('git apply'))).toHaveLength(0);
  });

  it('does not spend or mutate twice for the same failing run id', async () => {
    const { ctx, executor, github, repository, chat } = context([
      1, 1, 1, 0, 1, 1, 0,
    ]);
    await orchestrate(ctx);
    const before = {
      calls: executor.calls.length,
      comments: github.comments.length,
      fixes: repository.fixes.length,
      llm: chat.mock.calls.length,
    };

    await expect(orchestrate(ctx)).rejects.toBeInstanceOf(AlreadyAttemptedError);
    expect(executor.calls).toHaveLength(before.calls);
    expect(github.comments).toHaveLength(before.comments);
    expect(repository.fixes).toHaveLength(before.fixes);
    expect(chat).toHaveBeenCalledTimes(before.llm);
  });

  it('does not retry after a claimed attempt crashes before sandbox work', async () => {
    const { ctx, executor, github, repository, chat } = context([1]);
    vi.spyOn(repository, 'checkoutHead').mockRejectedValueOnce(
      new Error('checkout failed'),
    );

    await expect(orchestrate(ctx)).rejects.toThrow('checkout failed');
    expect(github.comments).toEqual([
      {
        id: 1,
        prNumber: RUN.prNumber,
        body: attemptMarker(RUN.runId),
      },
    ]);
    await expect(orchestrate(ctx)).rejects.toBeInstanceOf(AlreadyAttemptedError);
    expect(repository.checkouts).toHaveLength(0);
    expect(executor.calls).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  it('stops as infrastructure before inference when clean reproduction passes', async () => {
    const { ctx, github, repository, chat } = context([0]);

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('infra-stop');
    expect(caseFile.diagnosis.class).toBe('infra');
    expect(caseFile.diagnosis.signals).toContain('reproduction:passed');
    expect(caseFile.triage).toEqual(notRunTriageVerdict());
    expect(github.comments[0]?.body).toContain('INFRA — STOPPED');
    expect(github.comments[0]?.body).toContain('stopped before inference');
    expect(repository.fixes).toEqual([]);
    expect(github.pullRequests).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  it('passes only the strict CI allowlist to every sandbox run', async () => {
    const previous = process.env['REPOSITORY_SECRET'];
    process.env['REPOSITORY_SECRET'] = 'must-not-leak';
    try {
      const { ctx, executor } = context([1, 0, 0]);

      await orchestrate(ctx);

      expect(runCalls(executor)).not.toHaveLength(0);
      for (const call of runCalls(executor)) {
        expect(call.opts?.env).toEqual(SUTURA_SANDBOX_ENV);
        expect(call.opts?.env).not.toHaveProperty('REPOSITORY_SECRET');
      }
    } finally {
      if (previous === undefined) delete process.env['REPOSITORY_SECRET'];
      else process.env['REPOSITORY_SECRET'] = previous;
    }
  });

  it('reproduces before the first paid model call', async () => {
    const { ctx, executor, chat } = context([1, 0, 0]);
    chat.mockImplementationOnce(async () => {
      expect(runCalls(executor)).toHaveLength(3);
      return { text: JSON.stringify(diagnosisReply()) };
    });

    await orchestrate(ctx);
  });

  it('installs in a clean image before reproduction and forks triage from that prepared image', async () => {
    const { ctx, executor } = context([1, 0, 0]);

    await orchestrate(ctx);

    const calls = runCalls(executor);
    const snapshots = executor.calls.filter((call) => call.kind === 'snapshot');
    expect(snapshots.map(({ options }) => options)).toEqual([
      { profile: 'dependency-inputs', mode: 'replace' },
      { profile: 'repository', mode: 'overlay' },
    ]);
    expect(calls[0]?.cmd).toContain('corepack pnpm install --frozen-lockfile --ignore-scripts');
    expect(calls[0]?.opts?.network).toBe('enabled');
    expect(calls[1]?.cmd).toContain('git --literal-pathspecs add');
    expect(calls[1]?.cmd).toContain('--pathspec-file-nul');
    expect(calls[1]?.cmd).toContain('core.hooksPath /dev/null');
    expect(calls[1]?.cmd).toContain('--no-verify');
    expect(calls[1]?.opts?.network).toBe('disabled');
    expect(calls.slice(2).every(({ parent }) => parent === calls[1]?.imageId)).toBe(true);
    expect(calls.slice(2).every(({ opts }) => opts?.network === 'disabled')).toBe(true);
  });

  it('reports preparation failure before reproduction or paid inference', async () => {
    const { ctx, github, chat } = context([]);
    const executor = new InMemoryExecutor(() => runResult(1));
    ctx.executor = executor;

    const caseFile = await orchestrate(ctx);

    expect(caseFile).toMatchObject({
      outcome: 'infra-stop',
      diagnosis: { class: 'infra', signals: ['sandbox-preparation:failed'] },
    });
    expect(runCalls(executor)).toHaveLength(1);
    expect(github.comments[0]?.body).toContain('INFRA — STOPPED');
    expect(chat).not.toHaveBeenCalled();
  });

  it('grounds a web-helpful diagnosis between classification and triage', async () => {
    const buildRun: FailingWorkflowRun = {
      ...RUN,
      failedSteps: [
        {
          jobName: 'build',
          stepName: 'Build',
          log: "Run pnpm build\nError: Cannot find module '@acme/money'",
        },
      ],
    };
    const { ctx, chat } = context([1, 0, 0], true, buildRun);
    chat.mockImplementationOnce(async () => ({
      text: JSON.stringify({
        class: 'build',
        confidence: 0.91,
        signals: ['missing module'],
        failingCmd: 'pnpm build',
        errorExcerpt: "Cannot find module '@acme/money'",
      }),
    }));
    const search = vi.fn().mockResolvedValue([
      {
        title: 'Migration guide',
        url: 'https://docs.example.test/migration',
        snippet: 'The package export moved.',
      },
    ]);
    ctx.tavily = { search };

    const caseFile = await orchestrate(ctx);

    expect(search).toHaveBeenCalledTimes(1);
    expect(caseFile.diagnosis.grounding).toMatchObject({
      skipped: false,
      citations: [expect.objectContaining({ title: 'Migration guide' })],
    });
  });

  it('repairs an actual broken Placebo source using its bounded file context', async () => {
    const pristineSource = await readFile(
      new URL('../../placebo/corpus/repair-type-mismatch/fixture/parse-port.ts', import.meta.url),
      'utf8',
    );
    const brokenSource = pristineSource.replace('Number(value)', 'value');
    const placeboRun: FailingWorkflowRun = {
      ...RUN,
      failedSteps: [
        {
          jobName: 'typecheck',
          stepName: 'Typecheck',
          log: 'Run pnpm test\nparse-port.ts(2,3): error TS2322: Type string is not assignable to type number',
        },
      ],
    };
    const { ctx, chat, repository } = context(
      [1, 1, 1, 0, 1, 1, 0],
      true,
      placeboRun,
    );
    repository.sources.clear();
    repository.sources.set('parse-port.ts', brokenSource);
    const repairDiff = [
      'diff --git a/parse-port.ts b/parse-port.ts',
      '--- a/parse-port.ts',
      '+++ b/parse-port.ts',
      '@@ -1,3 +1,3 @@',
      ' export function parsePort(value: string): number {',
      '-  return value;',
      '+  return Number(value);',
      ' }',
    ].join('\n') + '\n';
    let placeboSuperCall = 0;
    chat.mockImplementation(async (
      tier: 'nano' | 'super' | 'ultra',
      messages: readonly { role: string; content?: string | null }[],
    ) => {
      if (tier === 'nano') return { text: JSON.stringify({
        class: 'typecheck', confidence: 0.99, signals: ['TS2322'],
        failingCmd: 'pnpm test', errorExcerpt: 'parse-port.ts(2,3): TS2322',
      }) };
      if (tier === 'super') {
        if (placeboSuperCall === 0) {
          const user = messages.find(({ role }) => role === 'user');
          const request = JSON.parse(user?.content ?? '') as {
            sources: Array<{ path: string; lines: Array<{ line: number; text: string }> }>;
          };
          expect(request.sources).toEqual([
            expect.objectContaining({
              path: 'parse-port.ts',
              lines: [
                { line: 1, text: 'export function parsePort(value: string): number {' },
                { line: 2, text: '  return value;' },
                { line: 3, text: '}' },
              ],
            }),
          ]);
        }
        placeboSuperCall += 1;
        return repairProposalReply(
          { id: 'placebo-fix', rationale: 'restore numeric conversion', diff: repairDiff },
          pristineSource,
        );
      }
      return { text: JSON.stringify({ approved: true, reasoning: 'The repair restores numeric conversion.' }) };
    });

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(repository.sourceReads).toEqual([
      {
        checkoutDir: '/tmp/exact-pr-head',
        paths: ['parse-port.ts', 'tsconfig.json', 'package.json'],
      },
    ]);
    expect(repository.fixes[0]?.diff).toBe(repairDiff);
    expect(brokenSource.replace('return value;', 'return Number(value);'))
      .toBe(pristineSource);
  });

  it('uses safe manifest fallback context for a dependency failure with no logged path', async () => {
    const dependencyRun: FailingWorkflowRun = {
      ...RUN,
      failedSteps: [
        {
          jobName: 'test',
          stepName: 'Test',
          log: "Run pnpm test\nError: Cannot find module '@acme/money'",
        },
      ],
    };
    const { ctx, chat, repository } = context(
      [1, 1, 1, 1, 1, 1],
      true,
      dependencyRun,
    );
    repository.sources.clear();
    repository.sources.set(
      'package.json',
      '{"dependencies":{"@acme/money":"4.0.0"}}',
    );
    const dependencyDiff = (version: string) => [
      'diff --git a/package.json b/package.json',
      '--- a/package.json',
      '+++ b/package.json',
      '@@ -1 +1 @@',
      '-{"dependencies":{"@acme/money":"4.0.0"}}',
      `+{"dependencies":{"@acme/money":"${version}"}}`,
    ].join('\n');
    ctx.tavily = {
      search: vi.fn().mockResolvedValue([{
        title: 'Money 4 migration',
        url: 'https://docs.example.test/money-4',
        snippet: 'The package now requires an explicit compatibility migration.',
      }]),
    };
    let dependencySuperCall = 0;
    chat.mockImplementation(async (tier: 'nano' | 'super' | 'ultra', messages: readonly {
      role: string;
      content?: string | null;
    }[]) => {
      if (tier === 'nano') return { text: JSON.stringify({
        class: 'dep-upstream-breaking', confidence: 0.96, signals: ['missing module'],
        failingCmd: 'pnpm test', errorExcerpt: "Cannot find module '@acme/money'",
      }) };
      if (tier === 'super') {
        if (dependencySuperCall === 0) {
          const user = messages.find(({ role }) => role === 'user');
          const request = JSON.parse(user?.content ?? '') as { sources: Array<{ path: string }> };
          expect(request.sources.map(({ path }) => path)).toEqual(['package.json']);
        }
        dependencySuperCall += 1;
        return repairProposalReply(
          { id: 'pin-a', rationale: 'pin compatible release', diff: dependencyDiff('3.9.0') },
          '{"dependencies":{"@acme/money":"3.9.0"}}',
        );
      }
      return { text: JSON.stringify({ approved: true, reasoning: 'not reached' }) };
    });

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(chat.mock.calls.map(([tier]) => tier).filter((tier) => tier === 'super').length)
      .toBeGreaterThan(1);
    expect(repository.sourceReads[0]?.paths).toEqual([
      'package.json',
      'pnpm-lock.yaml',
      'package-lock.json',
      'yarn.lock',
    ]);
  });

  it('replays live run 6: absent editable source stops before a Super turn', async () => {
    const noPathRun = (await capturedFailingRun('Live run 6', '33244884596')).run;
    const { ctx, chat, repository } = context([1, 1, 1], true, noPathRun);
    repository.sources.clear();

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(caseFile.race).toEqual([]);
    expect(chat.mock.calls.map(([tier]) => tier)).not.toContain('super');
  });

  it('rejects a non-numeric workflow run id before claiming an attempt', async () => {
    const hostileRun = { ...RUN, runId: '../unsafe' };
    const { ctx, github } = context([], true, hostileRun);

    await expect(orchestrate(ctx)).rejects.toThrow('positive decimal id');
    expect(github.comments).toEqual([]);
    expect(github.artifacts).toEqual([]);
  });
});

describe('failed log collection', () => {
  it('keeps only the final 200 lines from each failed step', () => {
    const longLog = Array.from({ length: 250 }, (_, index) => `line-${index}`).join('\n');
    const result = collectFailedLogs([
      { jobName: 'one', stepName: 'first', log: longLog },
      { jobName: 'two', stepName: 'second', log: longLog },
    ]);

    expect(result).not.toContain('line-49\n');
    expect(result.match(/line-50/g)).toHaveLength(2);
    expect(result.match(/line-249/g)).toHaveLength(2);
    expect(result).toContain('[one / first]');
    expect(result).toContain('[two / second]');
  });

  it('does not character-truncate any of the final 200 lines', () => {
    const longFinalLine = `FINAL-${'x'.repeat(120_000)}`;

    const result = collectFailedLogs([
      { jobName: 'one', stepName: 'large output', log: longFinalLine },
    ]);

    expect(result.endsWith(longFinalLine)).toBe(true);
  });

  it('counts 200 content lines when a failed-step log ends in a newline', () => {
    const longLog = `${Array.from(
      { length: 250 },
      (_, index) => `line-${index}`,
    ).join('\n')}\n`;

    const result = collectFailedLogs([
      { jobName: 'one', stepName: 'trailing newline', log: longLog },
    ]);

    expect(result).toContain('line-50\n');
    expect(result).not.toContain('line-49\n');
    expect(result.endsWith('line-249\n')).toBe(true);
  });
});

describe('repair source context', () => {
  it('rejects a repository response beyond the source file limit', async () => {
    const captured = await capturedFailingRun('A3', '33239848825');
    expect(captured.run.failedSteps).not.toHaveLength(0);
    const paths = Array.from({ length: 8 }, (_, index) => `src/captured-${index}.ts`);
    const repository = {
      readSourceExcerpts: vi.fn().mockResolvedValue([
        ...paths.map((path) => ({
          path, startLine: 1, content: 'export {};\n', truncated: false,
        })),
        { path: 'src/extra.ts', startLine: 1, content: 'export {};\n', truncated: false },
      ]),
    };

    await expect(readRepairSourceContext(
      repository,
      '/tmp/captured',
      paths.map((path) => `${path}:1: error`).join('\n'),
    )).rejects.toThrow('Repository source port exceeded the file limit');
  });

  it('rejects more repository excerpts than were requested', async () => {
    const captured = await capturedFailingRun('A3', '33239848825');
    const path = extractSourceReferences(captured.run.failedSteps[0]?.log ?? '')[0]?.path;
    if (path === undefined) throw new Error('Captured A3 log has no source path');
    const repository = {
      readSourceExcerpts: vi.fn().mockResolvedValue([
        { path, startLine: 1, content: 'export {};\n', truncated: false },
        { path: 'src/extra.ts', startLine: 1, content: 'export {};\n', truncated: false },
      ]),
    };

    await expect(readRepairSourceContext(
      repository,
      '/tmp/captured',
      `${path}:1: error`,
    )).rejects.toThrow('Repository source port returned an unsafe or unbounded excerpt');
  });

  it('rejects a structurally unsafe repository excerpt', async () => {
    const captured = await capturedFailingRun('A3', '33239848825');
    const path = extractSourceReferences(captured.run.failedSteps[0]?.log ?? '')[0]?.path;
    if (path === undefined) throw new Error('Captured A3 log has no source path');
    const repository = {
      readSourceExcerpts: vi.fn().mockResolvedValue([
        { path, startLine: 0, content: 'export {};\n', truncated: false },
      ]),
    };

    await expect(readRepairSourceContext(
      repository,
      '/tmp/captured',
      `${path}:1: error`,
    )).rejects.toThrow('Repository source port returned an unsafe or unbounded excerpt');
  });

  it('replays live runs 4 and 5: monorepo ESM evidence reaches the TypeScript implementation', async () => {
    capturedLiveRun(4, '33242204485');
    const captured = await capturedFailingRun('Live run 5', '33243759945');
    const repository = new FakeRepository();
    repository.sources.clear();
    repository.sources.set(
      'packages/core/src/dogfood-add.test.ts',
      "import { add } from './dogfood-add.js';\n\nexpect(add(2, 3)).toBe(5);\n",
    );
    repository.sources.set(
      'packages/core/src/dogfood-add.ts',
      'export function add(left: number, right: number): number {\n  return left - right;\n}\n',
    );

    const context = await readRepairSourceContext(
      repository,
      '/tmp/exact-pr-head',
      capturedDogfoodLog(captured.jobLogText),
      { class: 'test-assertion' },
    );

    expect(context.sources.map(({ path }) => path)).toEqual([
      'packages/core/src/dogfood-add.test.ts',
      'packages/core/src/dogfood-add.ts',
    ]);
    expect(repository.sourceReads).toEqual([
      {
        checkoutDir: '/tmp/exact-pr-head',
        paths: [
          'packages/core/src/dogfood-add.test.ts',
        ],
      },
      {
        checkoutDir: '/tmp/exact-pr-head',
        paths: [
          'packages/core/src/dogfood-add.js',
          'packages/core/src/dogfood-add.ts',
          'packages/core/src/dogfood-add.tsx',
        ],
      },
    ]);
  });

  it('omits ambiguous and credential-shaped dependency sources', async () => {
    const repository = new FakeRepository();
    repository.sources.clear();
    repository.sources.set('src/test.ts', "import './ambiguous.js';\nimport './secret.js';\n");
    repository.sources.set('src/ambiguous.js', 'export const value = 1;\n');
    repository.sources.set('src/ambiguous.ts', 'export const value = 2;\n');
    repository.sources.set('src/secret.ts', 'const TOKEN: string = "super-secret-value";\n');

    const context = await readRepairSourceContext(
      repository,
      '/tmp/exact-pr-head',
      'src/test.ts:1: assertion failed',
      { class: 'test-assertion' },
    );

    expect(context.sources.map(({ path }) => path)).toEqual(['src/test.ts']);
    expect(JSON.stringify(context)).not.toContain('super-secret-value');
  });

  it('omits source evidence that capture already redacted', async () => {
    const repository = new FakeRepository();
    repository.sources.clear();
    repository.sources.set('src/test.ts', '[redacted credential]\n');

    const context = await readRepairSourceContext(
      repository,
      '/tmp/exact-pr-head',
      'src/test.ts:1: assertion failed',
      { class: 'test-assertion' },
    );

    expect(context.sources).toEqual([]);
  });

  it('does not add another dependency variant when the failed log already supplied one', async () => {
    const repository = new FakeRepository();
    repository.sources.clear();
    repository.sources.set('src/test.ts', "import './local.js';\n");
    repository.sources.set('src/local.ts', 'export const value = 1;\n');
    repository.sources.set('src/local.js', 'export const value = 2;\n');

    const context = await readRepairSourceContext(
      repository,
      '/tmp/exact-pr-head',
      'src/test.ts:1: assertion failed\nsrc/local.ts:1: related frame',
      { class: 'test-assertion' },
    );

    expect(context.sources.map(({ path }) => path)).toEqual(['src/test.ts', 'src/local.ts']);
    expect(repository.sourceReads).toHaveLength(1);
  });

  it('bounds dependency cycles, depth, policy, and total source count', async () => {
    const repository = new FakeRepository();
    repository.sources.clear();
    repository.sources.set('src/root.ts', "import './child.js';\nimport './denied.js';\n");
    repository.sources.set('src/child.ts', "import './root.js';\nimport './grand.js';\n");
    repository.sources.set('src/grand.ts', "import './too-deep.js';\n");
    repository.sources.set('src/too-deep.ts', 'export const value = 4;\n');
    repository.sources.set('src/denied.ts', 'export const secret = 1;\n');

    const bounded = await readRepairSourceContext(
      repository,
      '/tmp/exact-pr-head',
      'src/root.ts:1: assertion failed',
      { class: 'test-assertion' },
      parseRepositoryPolicy(JSON.stringify({
        version: 1, allowedPaths: ['src/**'], deniedReadPaths: ['src/denied.*'],
      })),
    );

    expect(bounded.sources.map(({ path }) => path)).toEqual([
      'src/root.ts', 'src/child.ts', 'src/grand.ts',
    ]);
    expect(JSON.stringify(repository.sourceReads)).not.toContain('src/denied.ts');
    expect(JSON.stringify(repository.sourceReads)).not.toContain('src/too-deep.ts');

    const cappedRepository = new FakeRepository();
    cappedRepository.sources.clear();
    cappedRepository.sources.set(
      'src/root.ts',
      Array.from({ length: 8 }, (_, index) => `import './d${index}.js';`).join('\n'),
    );
    for (let index = 0; index < 8; index += 1) {
      cappedRepository.sources.set(`src/d${index}.ts`, `export const d${index} = ${index};\n`);
    }

    const capped = await readRepairSourceContext(
      cappedRepository, '/tmp/exact-pr-head', 'src/root.ts:1: assertion failed',
      { class: 'test-assertion' },
    );

    expect(capped.sources.map(({ path }) => path)).toEqual([
      'src/root.ts', 'src/d0.ts', 'src/d1.ts', 'src/d2.ts',
      'src/d3.ts', 'src/d4.ts', 'src/d5.ts', 'src/d6.ts',
    ]);
  });

  it('caps dependency candidate probes without treating unprobed variants as unique', async () => {
    const repository = new FakeRepository();
    repository.sources.clear();
    repository.sources.set(
      'src/root.ts',
      Array.from({ length: 24 }, (_, index) => `import './missing-${index}';`).join('\n'),
    );
    repository.sources.set('src/missing-23.ts', 'export const tooLate = true;\n');

    const context = await readRepairSourceContext(
      repository, '/tmp/exact-pr-head', 'src/root.ts:1: assertion failed',
      { class: 'test-assertion' },
    );

    expect(context.sources.map(({ path }) => path)).toEqual(['src/root.ts']);
    expect(repository.sourceReads).toHaveLength(25);
    expect(repository.sourceReads.flatMap(({ paths }) => paths)).not.toContain('src/missing-23.ts');
  });

  it('extracts only safe, exact workspace-relative source paths', () => {
    const log = [
      '/workspace/src/value.ts:42:3 error TS2322',
      'file:///workspace/src/config.ts(7,2): error',
      '../../secret.ts:1:1',
      'node_modules/vendor/index.js:4:1',
      '/etc/host.ts:1:1',
      '/workspace/src/value.ts:99:1 duplicate',
    ].join('\n');

    expect(extractSourceReferences(log)).toEqual([
      { path: 'src/value.ts', line: 42 },
      { path: 'src/config.ts', line: 7 },
    ]);
  });

  it('upgrades a command path when a later diagnostic supplies its line', () => {
    expect(
      extractSourceReferences(
        'Run eslint src/large.ts\nsrc/large.ts:500:1 lint error',
      ),
    ).toEqual([{ path: 'src/large.ts', line: 500 }]);
  });

  it('resolves pnpm recursive package diagnostics to repository paths', async () => {
    const repository = new FakeRepository();
    repository.sources.clear();
    repository.sources.set(
      'packages/core/src/diagnose/tavily.ts',
      "const MAX_QUERY_CHARACTERS: number = '2_000';",
    );
    const log = [
      'Run pnpm -r typecheck',
      "##[error]packages/core typecheck: src/diagnose/tavily.ts(20,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    ].join('\n');

    await expect(
      readRepairSourceContext(repository, '/tmp/exact-pr-head', log, {
        class: 'typecheck',
      }),
    ).resolves.toEqual({
      sources: [{
        path: 'packages/core/src/diagnose/tavily.ts',
        startLine: 1,
        content: "const MAX_QUERY_CHARACTERS: number = '2_000';",
        truncated: false,
      }],
    });
    expect(repository.sourceReads[0]?.paths).toEqual([
      'packages/core/src/diagnose/tavily.ts',
      'tsconfig.json',
      'package.json',
    ]);
  });

  it('resolves ANSI-colored Vitest reporter paths to their pnpm workspace', async () => {
    const repository = new FakeRepository();
    repository.sources.clear();
    repository.sources.set(
      'packages/core/src/dogfood-add.test.ts',
      "import { add } from './dogfood-add.js';\nexpect(add(2, 3)).toBe(5);\n",
    );
    repository.sources.set(
      'packages/core/src/dogfood-add.ts',
      'export const add = (left: number, right: number) => left - right;\n',
    );
    const log = [
      'packages/core test: \u001b[31m❯\u001b[39m src/dogfood-add.test.ts \u001b[2m(1 test | 1 failed)\u001b[22m',
      'packages/core test: \u001b[36m ❯\u001b[39m src/dogfood-add.test.ts:\u001b[2m7:23\u001b[22m',
    ].join('\n');

    const context = await readRepairSourceContext(
      repository, '/tmp/exact-pr-head', log, { class: 'test-assertion' },
    );

    expect(context.sources.map(({ path }) => path)).toEqual([
      'packages/core/src/dogfood-add.test.ts',
      'packages/core/src/dogfood-add.ts',
    ]);
  });

  it('unions competing fallback classes inside the existing eight-file source limit', async () => {
    const repository = new FakeRepository();
    await readRepairSourceContext(
      repository, '/tmp/exact-pr-head', 'Run pnpm test\nAssertion failed',
      { class: 'test-assertion' }, undefined, 'node', 'first', ['env-config', 'env-config'],
    );
    expect(repository.sourceReads[0]?.paths).toContain('tsconfig.json');
    expect(repository.sourceReads[0]?.paths).toEqual([...new Set(repository.sourceReads[0]?.paths)]);
    const capped = new FakeRepository();
    const log = Array.from({ length: 8 }, (_, index) => `src/file${index}.ts:1:1`).join('\n');
    await readRepairSourceContext(capped, '/tmp/exact-pr-head', log,
      { class: 'test-assertion' }, undefined, 'node', 'first', ['env-config']);
    expect(capped.sourceReads[0]?.paths).toHaveLength(8);
    expect(capped.sourceReads[0]?.paths).not.toContain('tsconfig.json');
  });

  it('uses only Python fallback manifests for Python dependency failures', async () => {
    const repository = new FakeRepository();

    await readRepairSourceContext(
      repository,
      '/tmp/exact-pr-head',
      'Run pytest -q\nImportError: dependency failed',
      { class: 'dep-upstream-breaking' },
      undefined,
      'python',
    );

    expect(repository.sourceReads[0]?.paths).toEqual([
      'pyproject.toml',
      'uv.lock',
      'requirements.txt',
    ]);
  });

  it('upgrades an inferred workspace line after the source-file cap is full', () => {
    const log = [
      'Run pnpm -r typecheck',
      'packages/p0 typecheck: src/deep.ts error TS2322',
      ...Array.from(
        { length: 7 },
        (_, index) => `packages/p${index + 1} typecheck: src/value.ts error TS2322`,
      ),
      'packages/p0 typecheck: src/deep.ts(500,1): error TS2322',
      'packages/ignored typecheck: src/ninth.ts(9,1): error TS2322',
    ].join('\n');

    const references = extractSourceReferences(log);

    expect(references).toHaveLength(8);
    expect(references[0]).toEqual({
      path: 'packages/p0/src/deep.ts',
      line: 500,
    });
    expect(references).not.toContainEqual(
      expect.objectContaining({ path: 'packages/ignored/src/ninth.ts' }),
    );
  });

  it('keeps the latest failure paths when earlier reporter summaries fill the cap', () => {
    const log = [
      ...Array.from({ length: 8 }, (_, index) => `src/summary-${index}.test.ts`),
      'src/dogfood-add.test.ts:7:23 AssertionError: expected -1 to be 5',
    ].join('\n');

    const references = extractSourceReferences(log, 'latest');

    expect(references).toHaveLength(8);
    expect(references).not.toContainEqual({ path: 'src/summary-0.test.ts' });
    expect(references).toContainEqual({ path: 'src/dogfood-add.test.ts', line: 7 });
  });

  it('keeps latest pnpm reporter paths qualified by their workspace', () => {
    const log = [
      ...Array.from(
        { length: 8 },
        (_, index) => `packages/core test: src/summary-${index}.test.ts`,
      ),
      'packages/core test: src/dogfood-add.test.ts:7:23 AssertionError',
    ].join('\n');

    const references = extractSourceReferences(log, 'latest');

    expect(references).toContainEqual({
      path: 'packages/core/src/dogfood-add.test.ts',
      line: 7,
    });
    expect(references).not.toContainEqual({ path: 'src/dogfood-add.test.ts', line: 7 });
  });

  it('reserves dependency capacity for the latest line-bearing failure source', async () => {
    const repository = new FakeRepository();
    repository.sources.clear();
    for (let index = 0; index < 8; index += 1) {
      repository.sources.set(
        `packages/core/src/summary-${index}.test.ts`,
        'export {};\n',
      );
    }
    repository.sources.set(
      'packages/core/src/dogfood-add.test.ts',
      "import { add } from './dogfood-add.js';\nexpect(add(2, 3)).toBe(5);\n",
    );
    repository.sources.set(
      'packages/core/src/dogfood-add.ts',
      'export const add = (left: number, right: number) => left - right;\n',
    );
    const log = [
      ...Array.from(
        { length: 8 },
        (_, index) => `packages/core test: src/summary-${index}.test.ts`,
      ),
      'packages/core test: src/dogfood-add.test.ts:7:23 AssertionError',
    ].join('\n');

    const context = await readRepairSourceContext(
      repository,
      '/tmp/exact-pr-head',
      log,
      { class: 'test-assertion' },
      undefined,
      'node',
      'latest',
    );

    expect(context.sources.map(({ path }) => path)).toContain(
      'packages/core/src/dogfood-add.ts',
    );
    expect(repository.sourceReads[0]?.paths).toHaveLength(4);
  });

  it('extracts exact JSON paths without accepting partial extensions', () => {
    expect(
      extractSourceReferences([
        'package.json:14:2 invalid package metadata',
        'tsconfig.json(7,1): invalid compiler option',
        'archive.json.backup:2 must not be read',
        'module.jsonish:3 must not be read',
      ].join('\n')),
    ).toEqual([
      { path: 'package.json', line: 14 },
      { path: 'tsconfig.json', line: 7 },
    ]);
  });

  it('normalizes only validated duplicated GitHub workspace prefixes', () => {
    expect(
      extractSourceReferences([
        '/home/runner/work/widget/widget/src/linux.ts:12:3 error',
        'file:///home/runner/work/widget/widget/src/file-url.ts(8,2): error',
        '/__w/widget/widget/src/container.ts:4:1 error',
        '/home/runner/work/widget/other/src/mismatch.ts:1:1 rejected',
        'file:///home/runner/work/widget/other/src/file-mismatch.ts:1:1 rejected',
        'prefix/home/runner/work/widget/widget/src/embedded.ts:1:1 rejected',
        '/etc/private.ts:1:1 rejected',
      ].join('\n')),
    ).toEqual([
      { path: 'src/linux.ts', line: 12 },
      { path: 'src/file-url.ts', line: 8 },
      { path: 'src/container.ts', line: 4 },
      {
        path: 'prefix/home/runner/work/widget/widget/src/embedded.ts',
        line: 1,
      },
    ]);
  });

  it('never requests sensitive source files from the repository port', async () => {
    const repository = new FakeRepository();

    await readRepairSourceContext(
      repository,
      '/tmp/exact-pr-head',
      [
        'src/value.ts:1:1 error TS2322',
        'credentials.json:2:1 must remain private',
      ].join('\n'),
      { class: 'typecheck' },
    );

    expect(repository.sourceReads).toEqual([{
      checkoutDir: '/tmp/exact-pr-head',
      paths: ['src/value.ts', 'tsconfig.json', 'package.json'],
    }]);
  });

  it('rejects source-port responses that exceed bounds or return unrequested files', async () => {
    const repository = new FakeRepository();
    const largeSource = Array.from(
      { length: 300 },
      (_, index) => `line-${index}-${'🧵'.repeat(100)}`,
    ).join('\n');
    vi.spyOn(repository, 'readSourceExcerpts').mockResolvedValue([
      {
        path: 'src/value.ts',
        startLine: 100,
        content: largeSource,
        truncated: true,
      },
      {
        path: '../secret.ts',
        startLine: 1,
        content: 'SECRET',
        truncated: false,
      },
    ]);

    await expect(
      readRepairSourceContext(
        repository,
        '/tmp/exact-pr-head',
        'src/value.ts:150:2 error TS2322',
      ),
    ).rejects.toThrow('unsafe or unbounded excerpt');
    expect(Buffer.byteLength(largeSource, 'utf8')).toBeGreaterThan(12_000);
  });
});
