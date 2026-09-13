import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { AuditVerdict, Candidate, CostLedger, Diagnosis } from './domain.js';
import { DEFAULT_MODELS, MAX_STAGE_EVIDENCE_ENTRIES } from './config.js';
import { InMemoryExecutor, type InMemoryRunResult } from './executor/memory.js';
import {
  buildSandboxRepositoryInitializationCommandForTest,
  healCase,
  repairFailure,
  repairVerificationCommand,
  StageLedger,
  tracedLlm,
  sandboxExecutableCommand,
  sandboxPreparationCommand,
  sandboxTargetCommand,
  SUTURA_SANDBOX_ENV,
  type HealCaseContext,
} from './heal.js';
import type { ChatMessage, TierLlm } from './llm/types.js';
import { DEFAULT_MODEL_PRICES } from './llm/cost.js';
import { DEFAULT_ROUTING_PROFILE_ID } from './llm/router.js';
import { parseRepositoryPolicy } from './policy/schema.js';
import { createDefaultRepositoryPolicy } from './policy/load.js';
import { repairProposalReply } from './testing/repair-proposal.test-helper.js';
import { TraceRecorder } from './trace/recorder.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'placebo', 'corpus');
const HONEST_DIFF = [
  'diff --git a/page-count.js b/page-count.js',
  '--- a/page-count.js',
  '+++ b/page-count.js',
  '@@ -1 +1 @@',
  '-export function pageCount(items, size) { return Math.floor(items / size) + 1; }',
  '+export function pageCount(items, size) { return Math.ceil(items / size); }',
].join('\n') + '\n';
const HONEST_REPLACEMENT = 'export function pageCount(items, size) { return Math.ceil(items / size); }\n';

const WRONG_REPLACEMENT_DIFF = HONEST_DIFF.replace(
  '+export function pageCount(items, size) { return Math.ceil(items / size); }',
  '+export function pageCount(items, size) { return Math.round(items / size); }',
);
const WRONG_REPLACEMENT = 'export function pageCount(items, size) { return Math.round(items / size); }\n';

const UPSTREAM_DIFF = [
  'diff --git a/app.cjs b/app.cjs',
  '--- a/app.cjs',
  '+++ b/app.cjs',
  '@@ -1,2 +1,2 @@',
  "-const fetch = require('node-fetch');",
  "-exports.fetchName = () => fetch('data:Juan').then((response) => response.text());",
  "+const fetchClient = require('node-fetch');",
  "+exports.fetchName = () => fetchClient('data:Juan').then((response) => response.text());",
].join('\n') + '\n';
const UPSTREAM_REPLACEMENT = [
  "const fetchClient = require('node-fetch');",
  "exports.fetchName = () => fetchClient('data:Juan').then((response) => response.text());",
].join('\n') + '\n';

function candidateReplacement(candidate: Candidate): string {
  if (candidate.diff === HONEST_DIFF) return HONEST_REPLACEMENT;
  if (candidate.diff === WRONG_REPLACEMENT_DIFF) return WRONG_REPLACEMENT;
  if (candidate.diff === UPSTREAM_DIFF) return UPSTREAM_REPLACEMENT;
  throw new Error(`No explicit replacement fixture for ${candidate.id}`);
}

function result(exitCode: number, stderr = exitCode === 0 ? '' : 'case.test.js: assertion failed'): InMemoryRunResult {
  return { exitCode, stdout: exitCode === 0 ? 'Tests passed' : '', stderr, truncated: false, metrics: {} };
}

function ledger(): CostLedger {
  return { entries: [], totalUsd: () => 0 };
}

function diagnosis(failureClass: Diagnosis['class']): Diagnosis {
  return {
    class: failureClass,
    confidence: 0.95,
    signals: ['scripted'],
    failingCmd: 'pnpm test',
    errorExcerpt: 'case.test.js: assertion failed',
  };
}

function scriptedLlm(
  failureClass: Diagnosis['class'],
  candidates: Candidate[] = [{ id: 'repair', rationale: 'fix the source', diff: HONEST_DIFF }],
  auditApproved = true,
): { llm: TierLlm<'nano' | 'super' | 'ultra'>; chat: ReturnType<typeof vi.fn> } {
  const chat = vi.fn(async (tier: 'nano' | 'super' | 'ultra') => {
    if (tier === 'nano') return { text: JSON.stringify(diagnosis(failureClass)) };
    if (tier === 'super') return repairProposalReply(candidates[0]!, candidateReplacement(candidates[0]!));
    const verdict: Pick<AuditVerdict, 'approved' | 'reasoning'> = {
      approved: auditApproved,
      reasoning: auditApproved ? 'The source repair holds.' : 'REFUSED: wrong cause.',
    };
    return { text: JSON.stringify(verdict) };
  });
  const modelQuote = (tier: 'nano' | 'super' | 'ultra') => ({
    role: tier,
    modelId: DEFAULT_MODELS[tier],
    price: DEFAULT_MODEL_PRICES[tier],
    profileId: DEFAULT_ROUTING_PROFILE_ID,
  });
  return { llm: { chat, modelQuote }, chat };
}

function context(
  caseId: string,
  exits: number[],
  failureClass: Diagnosis['class'],
  extra: Partial<HealCaseContext> = {},
): { ctx: HealCaseContext; executor: InMemoryExecutor; chat: ReturnType<typeof vi.fn> } {
  let scenarioIndex = 0;
  const repairCandidates = caseId.startsWith('upstream-')
    ? [{ id: 'repair', rationale: 'rename the source binding', diff: UPSTREAM_DIFF }]
    : undefined;
  const repairDiff = repairCandidates?.[0]?.diff ?? HONEST_DIFF;
  const executor = new InMemoryExecutor((command) =>
    command.includes('git apply - && git diff')
      ? { ...result(0), stdout: repairDiff }
      : command.includes('corepack pnpm install --frozen-lockfile') ||
        command.includes('git init --quiet')
      ? result(0)
      : result(exits[scenarioIndex++] ?? 1),
  );
  const { llm, chat } = scriptedLlm(failureClass, repairCandidates);
  return {
    executor,
    chat,
    ctx: {
      runId: `placebo-${caseId}`,
      repo: `placebo/${caseId}`,
      caseDir: join(ROOT, caseId, 'fixture'),
      executor,
      llm,
      cost: ledger(),
      triageN: 5,
      raceK: 1,
      readSourceContext: async () => {
        const path = caseId.startsWith('upstream-') ? 'app.cjs' : 'page-count.js';
        return {
          sources: [{
            path,
            startLine: 1,
            content: caseId === 'repair-off-by-one'
              ? 'export function pageCount(items, size) { return Math.floor(items / size) + 1; }\n'
              : await readFile(join(ROOT, caseId, 'fixture', path), 'utf8'),
            truncated: false,
          }],
        };
      },
      ...extra,
    },
  };
}

describe('healCase', () => {
  it('prioritizes an authorized recovery when only one repair fits and probes the original command', async () => {
    const before = 'import { test, expect } from "vitest";\ntest("name", async () => { expect(load()).toBe("ADA"); });\n';
    const after = before.replace('expect(load())', 'expect(await load())');
    const patch = ['diff --git a/case.test.js b/case.test.js', '--- a/case.test.js', '+++ b/case.test.js',
      '@@ -1,2 +1,2 @@', ...before.trimEnd().split('\n').map((line) => `-${line}`),
      ...after.trimEnd().split('\n').map((line) => `+${line}`), '',
    ].join('\n');
    const value = context('repair-off-by-one', [], 'test-assertion', { repairBudgets: { modelTurns: 5 } });
    const executor = new InMemoryExecutor((command) => {
      if (command.includes('SUTURA_SOURCE_SHA256')) return { ...result(1), stdout: `SUTURA_SOURCE_SHA256=${createHash('sha256').update(before).digest('hex')}\nExpected Promise to be ADA` };
      if (command.includes('SUTURA_TRIAGE_ATTEMPT')) return result(1);
      if (command.includes('git apply')) return { ...result(0), stdout: patch };
      return result(0);
    });
    value.ctx.readSourceContext = async () => ({ sources: [
      { path: 'case.test.js', startLine: 1, content: before, truncated: false },
      { path: 'page-count.js', startLine: 1, content: 'export const value = 1;\n', truncated: false },
    ] });
    value.ctx.llm = { ...value.ctx.llm, chat: async (tier, messages) => ({ usd: 0, text: JSON.stringify(
      tier === 'nano' ? diagnosis('test-assertion') : tier === 'ultra' ? { approved: true, reasoning: 'unchanged assertions' } :
      messages[0]?.content?.includes('Investigate') ? { hypotheses: [{ signalIndex: 0, sourceIndex: 0, intent: 'await-operation', probeId: 'async-completion' }] } : { replacement: after },
    ) }) };
    const caseFile = await repairFailure({ ...value.ctx, executor, failingImage: 'baseline',
      failedLog: 'Run pnpm -r test\npackages/core test: AssertionError: expected Promise to be ADA',
    });
    expect(caseFile.outcome).toBe('fixed');
    expect(caseFile.diagnosis.failingCmd).toBe('pnpm -r test');
    expect(caseFile.search).toHaveLength(1);
    const probe = executor.calls.find((call) => call.kind === 'run' && call.cmd.includes('SUTURA_SOURCE_SHA256'));
    expect(probe?.kind === 'run' ? probe.cmd : '').toContain(sandboxExecutableCommand('pnpm -r test'));
    expect(caseFile.selectedCandidate?.diffHash).toBe(createHash('sha256').update(patch).digest('hex'));
  });

  it('abstains explicitly when repair reservation pricing is unavailable', async () => {
    const value = context('repair-off-by-one', [1, 1, 1, 1], 'test-assertion');
    const quote = value.ctx.llm.modelQuote!;
    value.ctx.llm = { ...value.ctx.llm, modelQuote: (tier, messages, options) => {
      if (tier === 'super') throw new Error('quote unavailable');
      return tier === 'nano' ? quote('nano', messages, options) : quote('ultra', messages, options);
    } };
    const caseFile = await repairFailure({ ...value.ctx, failingImage: 'baseline', failedLog: 'Run pnpm test\nAssertionError: expected 5' });
    expect(caseFile.outcome).toBe('gave-up');
    expect(value.chat.mock.calls.map(([tier]) => tier)).toEqual(['nano']);
    expect(caseFile.stages.some(({ note }) => note?.startsWith('provider abstention'))).toBe(true);
  });

  it('charges initial diagnosis against the budget reserved for repair and audit', async () => {
    const value = context('repair-off-by-one', [1, 1, 1, 1, 0, 0], 'test-assertion', {
      repairBudgets: { modelTurns: 3 },
    });
    const caseFile = await repairFailure({ ...value.ctx, failingImage: 'baseline', failedLog: 'Run pnpm test\nAssertionError: expected 5' });
    expect(caseFile.outcome).toBe('gave-up');
    expect(value.chat.mock.calls.map(([tier]) => tier)).toEqual(['nano']);
  });

  it('charges classification schema repair before making a second model call', async () => {
    const value = context('repair-off-by-one', [1, 1, 1, 1], 'test-assertion', { repairBudgets: { modelTurns: 1 } });
    value.chat.mockResolvedValueOnce({ text: 'not JSON' });
    const caseFile = await repairFailure({ ...value.ctx, failingImage: 'baseline', failedLog: 'Run pnpm test\nAssertionError: expected 5' });
    expect(caseFile.outcome).toBe('gave-up');
    expect(value.chat).toHaveBeenCalledTimes(1);
    expect(value.executor.calls).toEqual([]);
    expect(caseFile.stages.some(({ note }) => note?.includes('modelTurns'))).toBe(true);
  });

  it('starts elapsed accounting before classification rather than after source discovery', async () => {
    const value = context('repair-off-by-one', [1, 1, 1, 1, 0, 0], 'test-assertion', { repairBudgets: { elapsedTimeSec: 1 } });
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    value.chat.mockImplementation(async () => { now += 2_000; return { text: JSON.stringify(diagnosis('test-assertion')) }; });
    try {
      const caseFile = await repairFailure({ ...value.ctx, failingImage: 'baseline', failedLog: 'Run pnpm test\nAssertionError: expected 5' });
      expect(caseFile.outcome).toBe('gave-up');
      expect(value.executor.calls).toEqual([]);
      expect(caseFile.stages.some(({ note }) => note?.includes('elapsedTimeSec'))).toBe(true);
    } finally { clock.mockRestore(); }
  });

  it('bounds public stage evidence entries', () => {
    const stageLedger = new StageLedger();
    for (let attempt = 1; attempt <= MAX_STAGE_EVIDENCE_ENTRIES; attempt += 1) {
      stageLedger.record({ stage: 'triage', attempt, network: 'disabled' });
    }

    expect(() => stageLedger.record({
      stage: 'triage',
      attempt: MAX_STAGE_EVIDENCE_ENTRIES + 1,
      network: 'disabled',
    })).toThrow('Stage evidence exceeds the bounded entry count');
  });

  it('traces the reserved route without recomputing routing after admission', async () => {
    const trace = new TraceRecorder('frozen-route');
    const modelQuote = vi.fn(() => { throw new Error('must not quote again'); });
    const quotedRoute = { role:'super' as const, modelId:'reserved-model', profileId:'fixed', price:{input:1,output:1} };
    const llm = tracedLlm({chat: async () => ({text:'ok'}),modelQuote}, trace);
    await llm.chat('super', [], {quotedRoute});
    expect(modelQuote).not.toHaveBeenCalled();
    expect(trace.events().find(event => event.type==='model-request')).toMatchObject({model:'reserved-model'});
  });

  it('fails closed when model routing has no quote', () => {
    const value = context('repair-off-by-one', [1, 1, 1, 1, 1], 'test-assertion');
    const llm = tracedLlm({ chat: value.ctx.llm.chat }, new TraceRecorder('quote-guard'));

    expect(() => llm.modelQuote?.('nano', [])).toThrow('Model routing quote is unavailable');
  });

  it.each([
    ['run id', { runId: '' }],
    ['repository', { repo: '' }],
    ['case directory', { caseDir: '' }],
  ])('requires a non-empty %s', async (_case, override) => {
    const value = context('repair-off-by-one', [], 'test-assertion');

    await expect(healCase({ ...value.ctx, ...override })).rejects.toThrow(
      'runId, repo, and caseDir must be non-empty',
    );
  });

  it('requires a non-empty failure command', async () => {
    const value = context('repair-off-by-one', [], 'test-assertion');

    await expect(healCase({ ...value.ctx, failureCommand: ' ' })).rejects.toThrow(
      'failureCommand must be non-empty',
    );
  });

  it('rejects a configured runtime that conflicts with repository policy', async () => {
    const value = context('repair-off-by-one', [], 'test-assertion', {
      runtimeId: 'python',
      policy: parseRepositoryPolicy(JSON.stringify({ version: 1, runtime: 'node' })),
    });

    await expect(healCase(value.ctx)).rejects.toThrow(
      'Configured runtime conflicts with repository policy runtime',
    );
    expect(value.executor.calls).toEqual([]);
  });

  it('uses raceK only as a direct-call compatibility width when search settings are absent', async () => {
    const legacy = context('repair-off-by-one', [1, 1, 1, 1, 1, 0, 0], 'test-assertion');
    const legacyCase = await healCase(legacy.ctx);
    expect(legacy.chat.mock.calls.filter(([tier]) => tier === 'super')).toHaveLength(1);
    expect(legacyCase.search?.[0]).toMatchObject({ nodeId: 'search-001', terminalReason: 'passed' });

    const adaptive = context('repair-off-by-one', [1, 1, 1, 1, 1, 0, 0, 1], 'test-assertion', {
      search: { initialBranches: 2, beamWidth: 1, maximumDepth: 1, maximumTotalBranches: 2 },
    });
    const adaptiveCase = await healCase(adaptive.ctx);
    expect(adaptiveCase.search?.[0]).toMatchObject({ nodeId: 'search-001' });
    expect(adaptive.executor.calls.some((call) =>
      call.kind === 'run' && call.opts?.operationId?.startsWith('search-'),
    )).toBe(true);
    expect(adaptiveCase.stages.some((entry) =>
      entry.operationId?.startsWith('search-') &&
      entry.operationTerminal === 'succeeded' &&
      entry.cancellationRequested === false,
    )).toBe(true);
  });

  it('replays live run 3 with audit capacity held before initial repair branches', async () => {
    const value = context('repair-off-by-one', [1, 1, 1, 1, 1, 0, 0, 0, 0, 0], 'test-assertion', {
      search: { initialBranches: 4, beamWidth: 2, maximumDepth: 4, maximumTotalBranches: 12 },
    });

    const caseFile = await healCase(value.ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(caseFile.search?.map(({ nodeId }) => nodeId)).toEqual([
      'search-001', 'search-002', 'search-003',
    ]);
  });

  it('schedules every admitted target even when the configured initial width is smaller', async () => {
    const value = context(
      'repair-off-by-one',
      [1, 1, 1, 1, 1, 0, 0],
      'test-assertion',
      { search: { initialBranches: 2, beamWidth: 1, maximumDepth: 1, maximumTotalBranches: 5 } },
    );
    let scenarioIndex = 0;
    const selectedTargets: string[] = [];
    value.ctx.executor = new InMemoryExecutor((command) =>
      command.includes('git apply - && git diff')
        ? { ...result(0), stdout: HONEST_DIFF }
        : command.includes('corepack pnpm install --frozen-lockfile') ||
          command.includes('git init --quiet')
          ? result(0)
          : result(scenarioIndex++ < 5 || selectedTargets.at(-1) !== 'page-count.js' ? 1 : 0),
    { operationLimit: 1 });
    const distractors = Array.from({ length: 2 }, (_unused, index) => ({
      path: `src/distractor-${index + 1}.ts`, startLine: 1,
      content: `export const distractor${index + 1} = ${index + 1};\n`, truncated: false,
    }));
    value.ctx.readSourceContext = async () => ({
      sources: [
        ...distractors,
        { path: 'page-count.js', startLine: 1, content: [
          'export function pageCount(items, size) { return Math.floor(items / size) + 1; }',
          '',
        ].join('\n'), truncated: false },
      ],
    });
    value.ctx.llm = {
      chat: vi.fn(async (
        tier: 'nano' | 'super' | 'ultra',
        messages: readonly ChatMessage[],
      ) => {
        if (tier === 'nano') return { text: JSON.stringify(diagnosis('test-assertion')) };
        if (tier === 'ultra') {
          return { text: JSON.stringify({ approved: true, reasoning: 'The repair holds.' }) };
        }
        const user = messages.find(({ role }) => role === 'user');
        const request = JSON.parse(user?.content ?? '{}') as {
          selectedTarget: { path: string };
          sources: Array<{ path: string; lines: Array<{ text: string }> }>;
        };
        selectedTargets.push(request.selectedTarget.path);
        const selected = request.sources.find(({ path }) => path === request.selectedTarget.path)!;
        const replacement = request.selectedTarget.path === 'page-count.js'
          ? HONEST_REPLACEMENT
          : `${selected.lines.map(({ text }) => text).join('\n')}\n// distinct failing repair\n`;
        return repairProposalReply(
          { id: request.selectedTarget.path, rationale: 'Repair the assigned target.', diff: HONEST_DIFF },
          replacement,
        );
      }),
      modelQuote: (tier) => ({
        role: tier, modelId: DEFAULT_MODELS[tier], price: DEFAULT_MODEL_PRICES[tier],
        profileId: DEFAULT_ROUTING_PROFILE_ID,
      }),
    };

    const caseFile = await healCase(value.ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(selectedTargets).toEqual([
      'src/distractor-1.ts', 'src/distractor-2.ts', 'page-count.js',
    ]);
  });

  it('admits only the targets that fit the remaining shared budget', async () => {
    const value = context(
      'repair-off-by-one',
      [1, 1, 1, 1, 1, 1],
      'test-assertion',
      { search: { initialBranches: 4, beamWidth: 1, maximumDepth: 1, maximumTotalBranches: 4 } },
    );
    value.ctx.readSourceContext = async () => ({
      sources: Array.from({ length: 5 }, (_unused, index) => ({
        path: `src/target-${index + 1}.ts`, startLine: 1,
        content: `export const target${index + 1} = ${index + 1};\n`, truncated: false,
      })),
    });

    const caseFile = await healCase(value.ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(value.chat.mock.calls.map(([tier]) => tier)).toEqual(['nano', 'super', 'super', 'super']);
    expect(caseFile.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: 'search',
        note: 'Admitted 3 of 5 controller-owned repair targets within the shared budget; validated recovery targets take priority',
      }),
    ]));
  });

  it('replays live run 12: one completion limit stops the remaining repair branches', async () => {
    let scenarioIndex = 0;
    const executor = new InMemoryExecutor((command) => {
      if (
        command.includes('corepack pnpm install --frozen-lockfile') ||
        command.includes('git init --quiet')
      ) return result(0);
      return result([1, 1, 1, 1, 1][scenarioIndex++] ?? 1);
    }, { operationLimit: 1 });
    const value = context('repair-off-by-one', [], 'test-assertion', {
      executor,
      search: { initialBranches: 4, beamWidth: 2, maximumDepth: 4, maximumTotalBranches: 12 },
    });
    value.ctx.executor = executor;
    value.chat.mockImplementation(async (tier: 'nano' | 'super' | 'ultra') => {
      if (tier === 'nano') return { text: JSON.stringify(diagnosis('test-assertion')) };
      if (tier === 'super') return { text: '{"id":"truncated"', finishReason: 'length' as const };
      return { text: JSON.stringify({ approved: true, reasoning: 'unused' }) };
    });

    const caseFile = await healCase(value.ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(value.chat.mock.calls.filter(([tier]) => tier === 'super')).toHaveLength(1);
    expect(caseFile.search).toEqual([
      expect.objectContaining({ nodeId: 'search-001', terminalReason: 'completion-limit' }),
    ]);
    expect(executor.calls.filter((call) =>
      call.kind === 'run' && call.cmd.includes('git apply'),
    )).toHaveLength(0);
  });

  it('replays run 33836899254: one completion limit among applied proposals continues to depth 2', async () => {
    const executor = new InMemoryExecutor((command, _parent, _callIndex, opts) => {
      if (
        command.includes('corepack pnpm install --frozen-lockfile') ||
        command.includes('git init --quiet')
      ) return result(0);
      if (command.includes('git apply - && git diff')) {
        if (opts?.operationId?.startsWith('search-004-')) return result(1);
        const operationId = opts?.operationId ?? 'repair';
        const distinctDiff = [
          'diff --git a/page-count.js b/page-count.js',
          '--- a/page-count.js',
          '+++ b/page-count.js',
          '@@ -1 +1,2 @@',
          '-export function pageCount(items, size) { return Math.floor(items / size) + 1; }',
          '+export function pageCount(items, size) { return Math.ceil(items / size); }',
          `+// ${operationId}`,
        ].join('\n') + '\n';
        return { ...result(0), stdout: distinctDiff };
      }
      return result(1);
    }, { operationLimit: 4 });
    const value = context('repair-off-by-one', [], 'test-assertion', {
      executor,
      search: { initialBranches: 4, beamWidth: 2, maximumDepth: 2, maximumTotalBranches: 12 },
    });
    let superCalls = 0;
    value.chat.mockImplementation(async (tier: 'nano' | 'super' | 'ultra') => {
      if (tier === 'nano') return { text: JSON.stringify(diagnosis('test-assertion')) };
      if (tier === 'super') {
        superCalls += 1;
        return superCalls === 3
          ? { text: '{"replacement":"', finishReason: 'length' as const, usd: 0.001 }
          : repairProposalReply(
              { id: `repair-${superCalls}`, rationale: 'Apply a distinct repair.', diff: HONEST_DIFF },
              `${HONEST_REPLACEMENT.trimEnd()}\n// distinct repair ${superCalls}\n`,
            );
      }
      return { text: JSON.stringify({ approved: true, reasoning: 'unused' }) };
    });

    const caseFile = await healCase(value.ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(superCalls).toBeGreaterThanOrEqual(5);
    const completionLimits = caseFile.search?.filter(
      ({ terminalReason }) => terminalReason === 'completion-limit',
    ) ?? [];
    expect(completionLimits).toHaveLength(1);
    expect(caseFile.search?.slice(0, 4)).toEqual([
      expect.objectContaining({ nodeId: 'search-001', depth: 1, changedFiles: 1 }),
      expect.objectContaining({ nodeId: 'search-002', depth: 1, changedFiles: 1 }),
      expect.objectContaining({ nodeId: 'search-003', depth: 1, terminalReason: 'completion-limit' }),
      expect.objectContaining({ nodeId: 'search-004', depth: 2, parentNodeId: 'search-001', terminalReason: 'failed' }),
    ]);
    const depthTwoNodes = caseFile.search?.filter(({ depth }) => depth === 2) ?? [];
    expect(depthTwoNodes.length).toBeGreaterThan(0);
    expect(depthTwoNodes.every(({ parentNodeId }) =>
      parentNodeId !== completionLimits[0]?.nodeId,
    )).toBe(true);
    expect(depthTwoNodes.every(({ parentNodeId }) =>
      parentNodeId === 'search-001' || parentNodeId === 'search-002',
    )).toBe(true);
    const depthOneDecisions = caseFile.trace?.flatMap((entry) => {
      if (
        entry.type !== 'search-decision' ||
        !['search-001', 'search-002', 'search-003'].includes(entry.childNodeId ?? '') ||
        (!entry.summary.startsWith('Retain') && !entry.summary.startsWith('Branch terminal'))
      ) return [];
      return [[entry.childNodeId, entry.summary]];
    });
    expect(depthOneDecisions).toEqual([
      ['search-001', 'Retain branch in frontier'],
      ['search-002', 'Retain branch in frontier'],
      ['search-003', 'Branch terminal: completion-limit'],
    ]);
    expect(caseFile.stages.some(({ note }) => note?.includes('Cancellation requested'))).toBe(false);
  });

  it.each([
    ['tool calls', { toolCalls: 2 }],
    ['inference cost', { inferenceCostUsd: 0.01 }],
  ] as const)('admits no expansion when only partial %s capacity fits the controller path', async (_label, repairBudgets) => {
    const value = context('repair-off-by-one', [1, 1, 1, 1, 1], 'test-assertion', {
      repairBudgets,
    });

    const caseFile = await healCase(value.ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(caseFile.search).toEqual([]);
    expect(value.chat.mock.calls.filter(([tier]) => tier === 'super')).toHaveLength(0);
    expect(value.executor.calls.filter((call) =>
      call.kind === 'run' && call.cmd.includes('git apply'),
    )).toHaveLength(0);
    expect(caseFile.recovery).toMatchObject({ status: 'insufficient', reason: 'budget-exhausted' });
  });

  it('admits no expansion when ConTree has no operation capacity', async () => {
    let scenarioIndex = 0;
    const executor = new InMemoryExecutor((command) => {
      if (
        command.includes('corepack pnpm install --frozen-lockfile') ||
        command.includes('git init --quiet')
      ) return result(0);
      return result([1, 1, 1, 1, 1][scenarioIndex++] ?? 1);
    }, { operationLimit: 0 });
    const value = context('repair-off-by-one', [], 'test-assertion', { executor });
    value.ctx.executor = executor;

    const caseFile = await healCase(value.ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(caseFile.search).toEqual([]);
    expect(value.chat.mock.calls.filter(([tier]) => tier === 'super')).toHaveLength(0);
  });

  it('uses the routed worst-case repair quote for inference admission', async () => {
    const value = context('repair-off-by-one', [1, 1, 1, 1, 1], 'test-assertion');
    value.ctx.llm = {
      ...value.ctx.llm,
      modelQuote: (tier) => tier === 'super'
        ? {
            role: tier, modelId: 'expensive-super', price: { input: 100, output: 100 },
            profileId: DEFAULT_ROUTING_PROFILE_ID,
          }
        : {
            role: tier, modelId: DEFAULT_MODELS[tier], price: DEFAULT_MODEL_PRICES[tier],
            profileId: DEFAULT_ROUTING_PROFILE_ID,
          },
    };

    const caseFile = await healCase(value.ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(caseFile.search).toEqual([]);
    expect(value.chat.mock.calls.filter(([tier]) => tier === 'super')).toHaveLength(0);
  });

  it('replaces a failed first-depth proposal from the clean baseline with bounded feedback', async () => {
    let applyCount = 0;
    let ordinaryTestCount = 0;
    let awaitingCandidateTest = false;
    const executor = new InMemoryExecutor((command) => {
      if (
        command.includes('corepack pnpm install --frozen-lockfile') ||
        command.includes('git init --quiet')
      ) return result(0);
      if (command.includes('git apply - && git diff')) {
        applyCount += 1;
        awaitingCandidateTest = true;
        return { ...result(0), stdout: applyCount === 1 ? WRONG_REPLACEMENT_DIFF : HONEST_DIFF };
      }
      if (awaitingCandidateTest) {
        awaitingCandidateTest = false;
        return applyCount === 1
          ? result(1, 'still failing after rounded division')
          : result(0);
      }
      ordinaryTestCount += 1;
      return ordinaryTestCount <= 5 ? result(1) : result(0);
    });
    let superCall = 0;
    const chat = vi.fn(async (
      tier: 'nano' | 'super' | 'ultra',
      messages: readonly { role: string; content?: string | null }[],
    ) => {
      if (tier === 'nano') return { text: JSON.stringify(diagnosis('test-assertion')) };
      if (tier === 'super') {
        superCall += 1;
        if (superCall === 2) {
          const request = JSON.parse(messages.find(({ role }) => role === 'user')?.content ?? '{}') as {
            previousAttempt?: { candidateDiff: string; testOutput: string; errorFingerprint: string };
          };
          expect(request.previousAttempt).toEqual({
            candidateDiff: WRONG_REPLACEMENT_DIFF,
            testOutput: expect.stringContaining('still failing after rounded division'),
            errorFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
          });
        }
        const candidate = superCall === 1
          ? { id: 'rounded', rationale: 'Round the division result.', diff: WRONG_REPLACEMENT_DIFF }
          : { id: 'ceiling', rationale: 'Use ceiling division.', diff: HONEST_DIFF };
        return repairProposalReply(candidate, candidateReplacement(candidate));
      }
      return { text: JSON.stringify({ approved: true, reasoning: 'The ceiling repair holds.' }) };
    });
    const base = context('repair-off-by-one', [], 'test-assertion', {
      executor,
      search: { initialBranches: 1, beamWidth: 1, maximumDepth: 2, maximumTotalBranches: 2 },
    });
    base.ctx.executor = executor;
    base.ctx.llm = {
      chat,
      modelQuote: (tier) => ({
        role: tier, modelId: DEFAULT_MODELS[tier], price: DEFAULT_MODEL_PRICES[tier],
        profileId: DEFAULT_ROUTING_PROFILE_ID,
      }),
    };

    const caseFile = await healCase(base.ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(caseFile.search).toEqual([
      expect.objectContaining({ nodeId: 'search-001', depth: 1 }),
      expect.objectContaining({ nodeId: 'search-002', depth: 2, parentNodeId: 'search-001', terminalReason: 'passed' }),
    ]);
    expect(caseFile.race[0]?.candidate).toMatchObject({
      id: expect.stringMatching(/^repair-[a-f0-9]{12}$/u), diff: HONEST_DIFF,
    });
    expect(caseFile.selectedCandidate).toEqual({
      id: caseFile.race[0]?.candidate.id,
      diffHash: createHash('sha256').update(HONEST_DIFF).digest('hex'),
    });
    const applyParents = executor.calls.flatMap((call) =>
      call.kind === 'run' && call.cmd.includes('git apply - && git diff')
        ? [call.parent]
        : [],
    );
    expect(applyParents).toHaveLength(2);
    expect(new Set(applyParents).size).toBe(1);
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano', 'super', 'super', 'ultra']);
    expect(JSON.stringify(caseFile.trace)).not.toContain('Math.round');
  });

  it('keeps searching after visible green is refused by full adjudication', async () => {
    let applyCount = 0;
    let ordinaryTestCount = 0;
    let awaitingCandidateTest = false;
    const executor = new InMemoryExecutor((command) => {
      if (
        command.includes('corepack pnpm install --frozen-lockfile') ||
        command.includes('git init --quiet')
      ) return result(0);
      if (command.includes('git apply - && git diff')) {
        applyCount += 1;
        awaitingCandidateTest = true;
        return { ...result(0), stdout: applyCount === 1 ? WRONG_REPLACEMENT_DIFF : HONEST_DIFF };
      }
      if (awaitingCandidateTest) {
        awaitingCandidateTest = false;
        return result(0);
      }
      ordinaryTestCount += 1;
      return ordinaryTestCount <= 5 ? result(1) : result(0);
    });
    let superCall = 0;
    let auditCall = 0;
    const chat = vi.fn(async (
      tier: 'nano' | 'super' | 'ultra',
    ) => {
      if (tier === 'nano') return { text: JSON.stringify(diagnosis('test-assertion')) };
      if (tier === 'super') {
        superCall += 1;
        const candidate = superCall === 1
          ? { id: 'rounded', rationale: 'Round the division result.', diff: WRONG_REPLACEMENT_DIFF }
          : { id: 'ceiling', rationale: 'Use ceiling division.', diff: HONEST_DIFF };
        return repairProposalReply(candidate, candidateReplacement(candidate));
      }
      auditCall += 1;
      return { text: JSON.stringify({ approved: auditCall > 1, reasoning: auditCall > 1 ? 'The ceiling repair holds.' : 'Rounded division breaks the contract.' }) };
    });
    const base = context('repair-off-by-one', [], 'test-assertion', {
      executor,
      search: { initialBranches: 2, beamWidth: 1, maximumDepth: 1, maximumTotalBranches: 2 },
    });
    base.ctx.executor = executor;
    base.ctx.llm = {
      chat,
      modelQuote: (tier) => ({
        role: tier, modelId: DEFAULT_MODELS[tier], price: DEFAULT_MODEL_PRICES[tier],
        profileId: DEFAULT_ROUTING_PROFILE_ID,
      }),
    };

    const caseFile = await healCase(base.ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(caseFile.search).toEqual([
      expect.objectContaining({ nodeId: 'search-001', depth: 1, terminalReason:'verification-refused' }),
      expect.objectContaining({ nodeId: 'search-002', depth: 1, terminalReason: 'passed' }),
    ]);
    expect(caseFile.race[0]?.candidate).toMatchObject({
      id: expect.stringMatching(/^repair-[a-f0-9]{12}$/u), diff: HONEST_DIFF,
    });
    expect(caseFile.selectedCandidate).toEqual({
      id: caseFile.race[0]?.candidate.id,
      diffHash: createHash('sha256').update(HONEST_DIFF).digest('hex'),
    });
    const applyParents = executor.calls.flatMap((call) =>
      call.kind === 'run' && call.cmd.includes('git apply - && git diff')
        ? [call.parent]
        : [],
    );
    expect(applyParents).toHaveLength(2);
    expect(new Set(applyParents).size).toBe(1);
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano', 'super', 'super', 'ultra', 'ultra']);
    expect(caseFile.verificationRuns?.map(run=>run.verification.status)).toEqual(['failed','passed']);
  });

  it('requests one alternative when a child repeats its parent proposal', async () => {
    let applyCount = 0;
    let ordinaryTestCount = 0;
    let awaitingCandidateTest = false;
    const executor = new InMemoryExecutor((command) => {
      if (
        command.includes('corepack pnpm install --frozen-lockfile') ||
        command.includes('git init --quiet')
      ) return result(0);
      if (command.includes('git apply - && git diff')) {
        applyCount += 1;
        awaitingCandidateTest = true;
        return { ...result(0), stdout: applyCount < 3 ? WRONG_REPLACEMENT_DIFF : HONEST_DIFF };
      }
      if (awaitingCandidateTest) {
        awaitingCandidateTest = false;
        return applyCount < 3
          ? result(1, 'still failing after rounded division')
          : result(0);
      }
      ordinaryTestCount += 1;
      return ordinaryTestCount <= 5 ? result(1) : result(0);
    });
    let superCall = 0;
    const chat = vi.fn(async (
      tier: 'nano' | 'super' | 'ultra',
      messages: readonly ChatMessage[],
    ) => {
      void messages;
      if (tier === 'nano') return { text: JSON.stringify(diagnosis('test-assertion')) };
      if (tier === 'super') {
        superCall += 1;
        const candidate = superCall < 3
          ? { id: 'rounded', rationale: 'Round the division result.', diff: WRONG_REPLACEMENT_DIFF }
          : { id: 'ceiling', rationale: 'Use ceiling division.', diff: HONEST_DIFF };
        return repairProposalReply(candidate, candidateReplacement(candidate));
      }
      return { text: JSON.stringify({ approved: true, reasoning: 'The ceiling repair holds.' }) };
    });
    const value = context('repair-off-by-one', [], 'test-assertion', {
      executor,
      search: { initialBranches: 1, beamWidth: 1, maximumDepth: 2, maximumTotalBranches: 2 },
    });
    value.ctx.executor = executor;
    value.ctx.llm = {
      chat,
      modelQuote: (tier) => ({
        role: tier, modelId: DEFAULT_MODELS[tier], price: DEFAULT_MODEL_PRICES[tier],
        profileId: DEFAULT_ROUTING_PROFILE_ID,
      }),
    };

    const caseFile = await healCase(value.ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(caseFile.stages).toContainEqual(expect.objectContaining({
      note: expect.stringMatching(/^Identical proposal for search-/u),
    }));
    const alternativeMessages = chat.mock.calls[3]?.[1] as readonly ChatMessage[];
    expect(alternativeMessages.find(({ role }) => role === 'user')?.content)
      .toContain('"repeatedProposal":true');
    expect(caseFile.trace?.filter(({ type }) => type === 'model-request')).toHaveLength(5);
    expect(executor.calls.filter((call) =>
      call.kind === 'run' && call.opts?.operationId?.startsWith('search-002-alt-'),
    )).toHaveLength(2);
  });

  it('marks the node repeated-state when the alternative is identical too', async () => {
    let ordinaryTestCount = 0;
    let awaitingCandidateTest = false;
    const executor = new InMemoryExecutor((command) => {
      if (
        command.includes('corepack pnpm install --frozen-lockfile') ||
        command.includes('git init --quiet')
      ) return result(0);
      if (command.includes('git apply - && git diff')) {
        awaitingCandidateTest = true;
        return { ...result(0), stdout: WRONG_REPLACEMENT_DIFF };
      }
      if (awaitingCandidateTest) {
        awaitingCandidateTest = false;
        return result(1, 'still failing after rounded division');
      }
      ordinaryTestCount += 1;
      return ordinaryTestCount <= 5 ? result(1) : result(0);
    });
    const value = context('repair-off-by-one', [], 'test-assertion', {
      executor,
      search: { initialBranches: 1, beamWidth: 1, maximumDepth: 2, maximumTotalBranches: 2 },
    });
    value.ctx.executor = executor;
    value.ctx.llm = {
      ...value.ctx.llm,
      chat: vi.fn(async (tier: 'nano' | 'super' | 'ultra') => {
        if (tier === 'nano') return { text: JSON.stringify(diagnosis('test-assertion')) };
        if (tier === 'super') {
          return repairProposalReply(
            { id: 'rounded', rationale: 'Round the division result.', diff: WRONG_REPLACEMENT_DIFF },
            WRONG_REPLACEMENT,
          );
        }
        return { text: JSON.stringify({ approved: true, reasoning: 'unused' }) };
      }),
    };

    const caseFile = await healCase(value.ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(caseFile.search).toContainEqual(expect.objectContaining({
      nodeId: 'search-002',
      terminalReason: 'repeated-state',
    }));
  });

  it('skips the alternative when no complete repair branch remains', async () => {
    let ordinaryTestCount = 0;
    let awaitingCandidateTest = false;
    const executor = new InMemoryExecutor((command) => {
      if (
        command.includes('corepack pnpm install --frozen-lockfile') ||
        command.includes('git init --quiet')
      ) return result(0);
      if (command.includes('git apply - && git diff')) {
        awaitingCandidateTest = true;
        return { ...result(0), stdout: WRONG_REPLACEMENT_DIFF };
      }
      if (awaitingCandidateTest) {
        awaitingCandidateTest = false;
        return result(1, 'still failing after rounded division');
      }
      ordinaryTestCount += 1;
      return ordinaryTestCount <= 5 ? result(1) : result(0);
    });
    const value = context('repair-off-by-one', [], 'test-assertion', {
      executor,
      repairBudgets: { branches: 2 },
      search: { initialBranches: 1, beamWidth: 1, maximumDepth: 2, maximumTotalBranches: 2 },
    });
    const superChat = vi.fn(async (tier: 'nano' | 'super' | 'ultra') => {
      if (tier === 'nano') return { text: JSON.stringify(diagnosis('test-assertion')) };
      if (tier === 'super') {
        return repairProposalReply(
          { id: 'rounded', rationale: 'Round the division result.', diff: WRONG_REPLACEMENT_DIFF },
          WRONG_REPLACEMENT,
        );
      }
      return { text: JSON.stringify({ approved: true, reasoning: 'unused' }) };
    });
    value.ctx.executor = executor;
    value.ctx.llm = {
      ...value.ctx.llm,
      chat: superChat,
    };

    const caseFile = await healCase(value.ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(superChat.mock.calls.filter(([tier]) => tier === 'super')).toHaveLength(2);
    expect(caseFile.stages).not.toContainEqual(expect.objectContaining({
      note: expect.stringMatching(/^Identical proposal for search-/u),
    }));
  });

  it('expands an unpatched parent on the next target', async () => {
    const alternateDiff = [
      'diff --git a/src/alternate.ts b/src/alternate.ts',
      '--- a/src/alternate.ts',
      '+++ b/src/alternate.ts',
      '@@ -1 +1 @@',
      '-export const alternate = 1;',
      '+export const alternate = 2;',
    ].join('\n') + '\n';
    let ordinaryTestCount = 0;
    let awaitingCandidateTest = false;
    const executor = new InMemoryExecutor((command) => {
      if (
        command.includes('corepack pnpm install --frozen-lockfile') ||
        command.includes('git init --quiet')
      ) return result(0);
      if (command.includes('git apply - && git diff')) {
        awaitingCandidateTest = true;
        return { ...result(0), stdout: alternateDiff };
      }
      if (awaitingCandidateTest) {
        awaitingCandidateTest = false;
        return result(1, 'alternate still fails');
      }
      ordinaryTestCount += 1;
      return ordinaryTestCount <= 5 ? result(1) : result(0);
    });
    const selectedTargets: string[] = [];
    let superCall = 0;
    const superChat = vi.fn(async (
      tier: 'nano' | 'super' | 'ultra',
      messages: readonly ChatMessage[],
    ) => {
      if (tier === 'nano') return { text: JSON.stringify(diagnosis('test-assertion')) };
      if (tier === 'super') {
        superCall += 1;
        const request = JSON.parse(
          messages.find(({ role }) => role === 'user')?.content ?? '{}',
        ) as { selectedTarget: { path: string } };
        selectedTargets.push(request.selectedTarget.path);
        return superCall <= 4
          ? { text: 'not json', usd: 0 }
          : { text: JSON.stringify({ replacement: 'export const alternate = 2;\n' }), usd: 0 };
      }
      return { text: JSON.stringify({ approved: true, reasoning: 'unused' }) };
    });
    const value = context('repair-off-by-one', [], 'test-assertion', {
      executor,
      search: { initialBranches: 1, beamWidth: 1, maximumDepth: 2, maximumTotalBranches: 3 },
      readSourceContext: async () => ({ sources: [
        {
          path: 'page-count.js', startLine: 1,
          content: 'export function pageCount(items, size) { return Math.floor(items / size) + 1; }\n',
          truncated: false,
        },
        {
          path: 'src/alternate.ts', startLine: 1,
          content: 'export const alternate = 1;\n', truncated: false,
        },
      ] }),
    });
    value.ctx.executor = executor;
    value.ctx.llm = {
      ...value.ctx.llm,
      chat: superChat,
    };

    await healCase(value.ctx);

    expect(selectedTargets).toHaveLength(5);
    expect(selectedTargets.slice(0, 4).sort()).toEqual([
      'page-count.js', 'page-count.js',
      'src/alternate.ts', 'src/alternate.ts',
    ].sort());
    expect(selectedTargets.at(-1)).toBe('src/alternate.ts');
  });

  it('refuses the first adaptive expansion when the current provider snapshot has no capacity', async () => {
    const value = context('repair-off-by-one', [1, 1, 1, 1, 1, 1], 'test-assertion', {
      search: { initialBranches: 4, beamWidth: 2, maximumDepth: 4, maximumTotalBranches: 12 },
    });
    value.ctx.llm = {
      ...value.ctx.llm,
      capacitySnapshot: () => ({
        remainingRequests: 0, remainingTokens: 1000,
        resetRequestsSec: 1, resetTokensSec: 1,
        dynamicRequestScale: null, dynamicTokenScale: null,
        windowUsageRequests: null, windowUsageTokens: null,
        retryAfterSec: null, requestId: 'capacity-zero',
      }),
    };
    const caseFile = await healCase(value.ctx);
    expect(caseFile.outcome).toBe('gave-up');
    expect(value.chat.mock.calls.filter(([tier]) => tier === 'super')).toHaveLength(0);
    expect(caseFile.search).toEqual([]);
  });
  it.each([
    [{ elapsedTimeSec: 12, maxRssKb: 120 }, 'fixed'],
    [{ elapsedTimeSec: 12.1, maxRssKb: 120 }, 'refused'],
    [{ maxRssKb: 120 }, 'refused'],
  ] as const)(
    'runs required commands on baseline and audited candidate with paired metrics: %j',
    async (candidateMetrics, outcome) => {
      const { ctx } = context(
        'repair-off-by-one',
        [],
        'test-assertion',
      );
      let scenarioIndex = 0;
      let policyCommandRuns = 0;
      const ordinaryExits = [1, 1, 1, 1, 1, 0, 0];
      const executor = new InMemoryExecutor((command) => {
        if (command.includes('git apply - && git diff')) {
          return { ...result(0), stdout: HONEST_DIFF };
        }
        if (
          command.includes('corepack pnpm install --frozen-lockfile') ||
          command.includes('git init --quiet')
        ) return result(0);
        if (command.includes('policy-check')) {
          policyCommandRuns += 1;
          return {
            ...result(policyCommandRuns === 1 ? 1 : 0),
            metrics: policyCommandRuns === 1
              ? { elapsedTimeSec: 10, maxRssKb: 100 }
              : { ...candidateMetrics },
          };
        }
        return result(ordinaryExits[scenarioIndex++] ?? 1);
      });
      ctx.executor = executor;
      ctx.policy = parseRepositoryPolicy(JSON.stringify({
        version: 1,
        allowedPaths: ['**'],
        requiredCommands: ['pnpm run policy-check'],
        resourceLimits: { elapsedTimePercent: 20, maxRssPercent: 20 },
      }));

      const caseFile = await healCase(ctx);

      expect(caseFile.outcome).toBe(outcome);
      expect(policyCommandRuns).toBe(2);
      expect(caseFile.audit?.checks).toContainEqual(expect.objectContaining({
        name: 'policy-resource-limit',
        passed: outcome === 'fixed',
      }));
      expect(caseFile.stages.filter(({ note }) => note?.includes('Required command')))
        .toHaveLength(2);
    },
  );

  it('repairs a real Placebo fixture after one snapshot and one pre-inference reproduction', async () => {
    const { ctx, executor, chat } = context(
      'repair-off-by-one',
      [1, 1, 1, 1, 1, 0, 0],
      'test-assertion',
    );

    const caseFile = await healCase(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(caseFile.runtime).toBe('node');
    expect(executor.calls.filter(({ kind }) => kind === 'snapshot')).toHaveLength(2);
    expect(executor.calls.find((call) => call.kind === 'run')).toMatchObject({
      kind: 'run',
      cmd: expect.stringContaining('corepack pnpm install --frozen-lockfile'),
    });
    expect(executor.calls.filter(({ kind }) => kind === 'run').every((call) =>
      call.kind !== 'run' || call.opts?.env === SUTURA_SANDBOX_ENV,
    )).toBe(true);
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano', 'super', 'ultra']);
    expect(caseFile.trace?.map(({ type }) => type)).toEqual(expect.arrayContaining([
      'run-start',
      'model-request',
      'model-response',
      'tool-request',
      'tool-result',
      'sandbox-operation',
      'search-decision',
      'candidate-submitted',
      'audit-result',
      'run-finish',
    ]));
    expect(caseFile.trace?.at(0)).toMatchObject({ sequence: 1, timestampMs: 0, type: 'run-start' });
    expect(caseFile.trace?.at(-1)).toMatchObject({ type: 'run-finish', outcome: 'fixed' });
    const serializedTrace = JSON.stringify(caseFile.trace);
    expect(serializedTrace).not.toContain('export function pageCount');
    expect(serializedTrace).not.toContain('-export function');
    expect(caseFile.trace?.find(({ type }) => type === 'model-request')).toMatchObject({
      promptHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      promptExcerpt: expect.any(String),
    });
  });

  it('labels the real Placebo flaky fixture without generating a patch', async () => {
    const { ctx, chat } = context(
      'flaky-timer-race',
      [1, 1, 0, 1, 0, 0],
      'flaky-timing',
    );

    const readSourceContext = vi.fn(ctx.readSourceContext);
    ctx.readSourceContext = readSourceContext;
    await expect(healCase(ctx)).resolves.toMatchObject({
      outcome: 'flaky-no-patch',
      runtime: 'node',
      triage: { status: 'intermittent', reproduced: 2, of: 5 },
    });
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano']);
    expect(readSourceContext).not.toHaveBeenCalled();
  });

  it('administers and refuses the real Placebo trap candidate without a repair-model call', async () => {
    const candidateDiff = await readFile(join(ROOT, 'trap-skipped-test', 'fake-fix.diff'), 'utf8');
    const { ctx, executor, chat } = context(
      'trap-skipped-test',
      [1, 1, 1, 1, 1, 0],
      'test-assertion',
      { candidateDiff },
    );

    const readSourceContext = vi.fn(ctx.readSourceContext);
    ctx.readSourceContext = readSourceContext;
    const caseFile = await healCase(ctx);
    expect(caseFile.recovery).toBeUndefined();
    expect(readSourceContext).not.toHaveBeenCalled();

    expect(caseFile.outcome).toBe('refused');
    expect(caseFile.runtime).toBe('node');
    expect(caseFile.audit?.approved).toBe(false);
    expect(caseFile.audit?.checks).toContainEqual(expect.objectContaining({ name: 'skipped-test', passed: false }));
    expect(executor.calls.filter(({ kind }) => kind === 'run')).toHaveLength(7);
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano']);
  });

  it('refuses a pass-with-no-tests package-script bypass before the candidate race', async () => {
    const candidateDiff = await readFile(
      join(ROOT, 'trap-pass-with-no-tests', 'fake-fix.diff'),
      'utf8',
    );
    const { ctx, executor, chat } = context(
      'trap-pass-with-no-tests',
      [1, 1, 1, 1, 1],
      'test-assertion',
      { candidateDiff },
    );

    const caseFile = await healCase(ctx);

    expect(caseFile).toMatchObject({
      outcome: 'refused',
      audit: {
        approved: false,
        reasoning: expect.stringContaining('adds pass-with-no-tests bypass'),
      },
    });
    expect(executor.calls.filter(({ kind }) => kind === 'run')).toHaveLength(7);
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano']);
  });

  it('grounds an upstream Placebo fixture only when Tavily is enabled', async () => {
    const search = vi.fn().mockResolvedValue([{
      title: 'node-fetch v3 upgrade guide',
      url: 'https://github.com/node-fetch/node-fetch/blob/main/docs/v3-UPGRADE-GUIDE.md',
      snippet: 'node-fetch v3 is ESM-only.',
    }]);
    const { ctx } = context(
      'upstream-parser-release',
      [1, 1, 1, 1, 1, 0, 0],
      'dep-upstream-breaking',
      { tavily: { search } },
    );

    const caseFile = await healCase(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(caseFile.diagnosis.grounding).toMatchObject({ skipped: false });
    expect(search).toHaveBeenCalledOnce();
  });

  it('gives up on a real upstream break when release grounding is unavailable', async () => {
    const { ctx, chat } = context(
      'upstream-parser-release',
      [1, 1, 1, 1, 1, 1],
      'dep-upstream-breaking',
    );

    await expect(healCase(ctx)).resolves.toMatchObject({
      outcome: 'gave-up',
      runtime: 'node',
      diagnosis: {
        class: 'dep-upstream-breaking',
        grounding: { skipped: true, reason: 'disabled', citations: [] },
      },
      race: [],
    });
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano']);
  });

  it('reproduces with the Python default command when none was observed', async () => {
    const { ctx } = context('python-repair-missing-await', [0, 0], 'test-assertion', { runtimeId: 'python' });

    await healCase(ctx);

    const commands = ctx.executor instanceof InMemoryExecutor
      ? ctx.executor.calls.filter((call) => call.kind === 'run').map(({ cmd }) => cmd)
      : [];
    expect(commands.some((cmd) => cmd.includes('uv run --offline --no-sync python -m unittest'))).toBe(true);
    expect(commands.some((cmd) => cmd.includes('pnpm test'))).toBe(false);
  });

  it('stops before paid inference when the clean sandbox does not reproduce', async () => {
    const { ctx, chat } = context('python-repair-missing-await', [0, 0], 'test-assertion', {
      runtimeId: 'python',
      failureCommand: 'pytest -q',
    });

    await expect(healCase(ctx)).resolves.toMatchObject({
      outcome: 'infra-stop',
      runtime: 'python',
      triage: { status: 'not-run', reproduced: 0, of: 0 },
    });
    expect(chat).not.toHaveBeenCalled();
  });

  it('stops before reproduction and paid inference when sandbox preparation fails', async () => {
    const { ctx, chat } = context('python-repair-missing-await', [1], 'test-assertion', {
      runtimeId: 'python',
      failureCommand: 'pytest -q',
    });
    const executor = new InMemoryExecutor(() => result(1, 'pnpm install failed'));
    ctx.executor = executor;

    await expect(healCase(ctx)).resolves.toMatchObject({
      outcome: 'infra-stop',
      runtime: 'python',
      diagnosis: {
        class: 'infra',
        signals: ['sandbox-preparation:failed'],
        errorExcerpt: 'pnpm install failed',
      },
    });
    expect(executor.calls.filter(({ kind }) => kind === 'run')).toHaveLength(1);
    expect(chat).not.toHaveBeenCalled();
  });

  it('does not let an explicit Python selector replace the verified image digest', async () => {
    const { ctx, executor } = context('python-repair-missing-await', [], 'test-assertion', {
      runtimeId: 'python',
      failureCommand: 'pytest -q',
      imageRef: 'python:latest',
    });

    await expect(healCase(ctx)).rejects.toThrow('Python runtime image must use the verified exact digest');
    expect(executor.calls).toEqual([]);
  });

  it('reproduces an observed dependency-install command from manifest-only preparation', async () => {
    const { ctx, chat } = context('repair-off-by-one', [0], 'infra', {
      failureCommand: 'pnpm install --frozen-lockfile',
    });

    const caseFile = await healCase(ctx);

    expect(caseFile.outcome).toBe('infra-stop');
    const commands = ctx.executor instanceof InMemoryExecutor
      ? ctx.executor.calls.filter((call) => call.kind === 'run').map(({ cmd }) => cmd)
      : [];
    expect(commands[0]).toContain('pnpm install --frozen-lockfile --ignore-scripts');
    const runs = ctx.executor instanceof InMemoryExecutor
      ? ctx.executor.calls.filter((call) => call.kind === 'run')
      : [];
    expect(runs[0]?.opts?.network).toBe('enabled');
    expect(runs.slice(1).every((call) => call.opts?.network === 'disabled')).toBe(true);
    expect(chat).not.toHaveBeenCalled();
  });
});

describe('sandbox command resolution', () => {
  it('creates an exact hook-disabled Git baseline from only manifest members', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-git-baseline-'));
    const marker = join(directory, 'hook-ran');
    const manifest = join(directory, 'overlay.manifest');
    const template = join(directory, 'empty-template');
    try {
      await mkdir(join(directory, 'src'), { recursive: true });
      await mkdir(join(directory, 'node_modules', 'dependency'), { recursive: true });
      await writeFile(join(directory, 'package.json'), '{"name":"fixture"}\n');
      await writeFile(join(directory, 'src', 'index.ts'), 'export const ready = true;\n');
      await writeFile(join(directory, 'node_modules', 'dependency', 'output.js'), 'prepared\n');
      await writeFile(manifest, Buffer.from('package.json\0src/index.ts\0'));
      await mkdir(template);
      expect(spawnSync('git', ['init', '--quiet'], { cwd: directory }).status).toBe(0);
      const hook = join(directory, '.git', 'hooks', 'pre-commit');
      await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
      await chmod(hook, 0o755);

      const command = buildSandboxRepositoryInitializationCommandForTest({
        manifestPath: manifest,
        templatePath: template,
      });
      const initialized = spawnSync('sh', ['-c', command], {
        cwd: directory,
        encoding: 'utf8',
      });

      expect(initialized.status, initialized.stderr).toBe(0);
      const listed = spawnSync('git', ['ls-files', '-z'], {
        cwd: directory,
        encoding: 'utf8',
      });
      expect(listed.stdout.split('\0').filter(Boolean).sort()).toEqual([
        'package.json',
        'src/index.ts',
      ]);
      await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('uses verified lifecycle-blocking installer modes', () => {
    const command = sandboxPreparationCommand();

    expect(command).toContain('pnpm install --frozen-lockfile --ignore-scripts');
    expect(command).toContain('npm ci --ignore-scripts');
    expect(command).toContain('yarn install --frozen-lockfile --ignore-scripts');
    expect(command).toContain('yarn install --immutable --mode=skip-build');
    expect(command).toContain('unsupported Yarn version');
  });

  it('uses one resolved command for reproduction, triage, race, and audit', async () => {
    const observed = 'vitest run;';
    const { ctx, executor, chat } = context(
      'repair-off-by-one',
      [1, 1, 1, 1, 1, 0, 0],
      'test-assertion',
      { failureCommand: observed },
    );
    chat.mockImplementation(async (tier: 'nano' | 'super' | 'ultra') => {
      if (tier === 'nano') {
        return {
          text: JSON.stringify({
            ...diagnosis('test-assertion'),
            failingCmd: observed,
          }),
        };
      }
      if (tier === 'super') {
        return repairProposalReply(
          { id: 'repair', rationale: 'fix the source', diff: HONEST_DIFF },
          HONEST_REPLACEMENT,
        );
      }
      return {
        text: JSON.stringify({ approved: true, reasoning: 'The source repair holds.' }),
      };
    });

    const caseFile = await healCase(ctx);
    const stageCommands = executor.calls.flatMap((call) =>
      call.kind === 'run' &&
        !call.cmd.includes('corepack pnpm install --frozen-lockfile') &&
        !call.cmd.includes('git init --quiet') &&
        call.cmd.includes('vitest run;')
        ? [call.cmd]
        : [],
    );

    expect(caseFile).toMatchObject({
      outcome: 'fixed',
      diagnosis: { failingCmd: observed },
    });
    expect(stageCommands).toHaveLength(7);
    expect(stageCommands.every((command) =>
      command.includes('corepack pnpm exec sh -c') && command.includes('vitest run;'),
    )).toBe(true);
  });

  it('runs an observed package binary through the repository package manager', () => {
    const command = sandboxExecutableCommand('vitest run');

    expect(command).toContain("corepack pnpm exec sh -c 'vitest run'");
    expect(command).toContain("corepack yarn exec sh -c 'vitest run'");
    expect(command).toContain("PATH=\"./node_modules/.bin:$PATH\" sh -c 'vitest run'");
    expect(sandboxTargetCommand('vitest run')).toContain('corepack pnpm exec sh -c');
  });

  it('scopes a recursive pnpm repair check to the one failing workspace', () => {
    const diagnosed = {
      class: 'test-assertion',
      confidence: 0.95,
      signals: ['scripted'],
      failingCmd: 'pnpm -r test',
      errorExcerpt: 'AssertionError: expected -1 to be 5',
    } satisfies Diagnosis;
    expect(repairVerificationCommand(diagnosed, [
      '2026-08-30T16:56:38Z packages/action test: Tests 118 passed',
      '2026-08-30T16:56:38Z packages/core test: FAIL src/dogfood-add.test.ts',
      '2026-08-30T16:56:38Z packages/core test: AssertionError: expected -1 to be 5',
    ].join('\n'))).toBe('pnpm --filter ./packages/core test');
  });

  it('keeps a full recursive pnpm repair check for a legacy replay', () => {
    expect(repairVerificationCommand({
      class: 'test-assertion',
      confidence: 0.95,
      signals: ['scripted'],
      failingCmd: 'pnpm -r test',
      errorExcerpt: 'packages/core test: AssertionError: failed',
    }, undefined, 'full')).toBe('pnpm -r test');
  });

  it('keeps a recursive pnpm repair check when the failing workspace is ambiguous', () => {
    const diagnosed = {
      class: 'test-assertion',
      confidence: 0.95,
      signals: ['scripted'],
      failingCmd: 'pnpm --recursive test',
      errorExcerpt: 'assertion failed',
    } satisfies Diagnosis;
    expect(repairVerificationCommand(diagnosed, [
        'packages/core test: AssertionError: expected -1 to be 5',
        'packages/action test: Error: failed',
    ].join('\n'))).toBe('pnpm --recursive test');
  });

  it.each([
    ['pnpm', 'pnpm-lock.yaml'],
    ['yarn', 'yarn.lock'],
    ['npm', null],
  ] as const)('resolves a local package binary in a %s repository', async (_manager, lockfile) => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-package-command-'));
    try {
      const binDirectory = join(directory, 'node_modules', '.bin');
      const toolDirectory = join(directory, 'tools');
      await mkdir(binDirectory, { recursive: true });
      await mkdir(toolDirectory, { recursive: true });
      await writeFile(
        join(binDirectory, 'vitest'),
        '#!/bin/sh\nprintf "local-vitest:%s\\n" "$1"\n',
      );
      await chmod(join(binDirectory, 'vitest'), 0o755);
      await writeFile(
        join(toolDirectory, 'corepack'),
        [
          '#!/bin/sh',
          'case "$1:$2" in pnpm:exec|yarn:exec) shift 2 ;; *) exit 90 ;; esac',
          'PATH="$PWD/node_modules/.bin:$PATH" exec "$@"',
          '',
        ].join('\n'),
      );
      await chmod(join(toolDirectory, 'corepack'), 0o755);
      if (lockfile) await writeFile(join(directory, lockfile), '');

      const execution = spawnSync(
        '/bin/sh',
        ['-c', sandboxExecutableCommand('vitest local;')],
        {
          cwd: directory,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${toolDirectory}:${process.env['PATH'] ?? ''}`,
          },
        },
      );

      expect(execution.status, execution.stderr).toBe(0);
      expect(execution.stdout).toBe('local-vitest:local\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    'vitest run;',
    'vitest run &',
    String.raw`vitest run --testNamePattern 'quotes; pipes | and dollars $HOME' && echo done`,
  ])('produces valid shell for package command %s', (observed) => {
    const command = sandboxExecutableCommand(observed);

    expect(spawnSync('sh', ['-n'], { input: command }).status).toBe(0);
    expect(command).toContain(observed.replaceAll("'", `'\"'\"'`));
  });

  it.each([
    'vitest-evil',
    'vitest.config.ts',
    'vitest/run',
  ])('does not resolve package-binary lookalike %s', (observed) => {
    expect(sandboxExecutableCommand(observed)).toBe(observed);
  });

  it('places Corepack package-manager shims on PATH for the whole command', () => {
    const command = sandboxExecutableCommand(
      'cd packages/core && CI=true pnpm test && yarn lint',
    );

    expect(command).toContain('corepack enable --install-directory');
    expect(command).toContain('PATH="$sutura_corepack_bin:$PATH" sh -c');
    expect(command).toContain('cd packages/core && CI=true pnpm test && yarn lint');
    expect(sandboxExecutableCommand('corepack pnpm test && pnpm lint'))
      .toContain('corepack enable --install-directory');
  });

  it('executes compound and redirected package-manager commands through Corepack', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-corepack-command-'));
    try {
      const toolDirectory = join(directory, 'tools');
      await mkdir(toolDirectory, { recursive: true });
      await writeFile(
        join(toolDirectory, 'corepack'),
        [
          '#!/bin/sh',
          'if [ "$1" = "pnpm" ]; then shift; printf "corepack-pnpm:%s\\n" "$*"; exit 0; fi',
          '[ "$1:$2" = "enable:--install-directory" ] || exit 90',
          'directory=$3',
          `printf '#!/bin/sh\nprintf "pnpm:%%s\\n" "$*"\n' > "$directory/pnpm"`,
          `printf '#!/bin/sh\nprintf "yarn:%%s\\n" "$*"\n' > "$directory/yarn"`,
          'chmod +x "$directory/pnpm" "$directory/yarn"',
          '',
        ].join('\n'),
      );
      await chmod(join(toolDirectory, 'corepack'), 0o755);
      await mkdir(join(directory, 'packages', 'core'), { recursive: true });

      const execution = spawnSync(
        '/bin/sh',
        ['-c', sandboxExecutableCommand(
          'corepack pnpm install --frozen-lockfile && cd packages/core && CI=true pnpm test && yarn lint && pnpm>result.txt',
        )],
        {
          cwd: directory,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${toolDirectory}:${process.env['PATH'] ?? ''}`,
            TMPDIR: directory,
          },
        },
      );

      expect(execution.status, execution.stderr).toBe(0);
      expect(execution.stdout).toBe(
        'corepack-pnpm:install --frozen-lockfile\npnpm:test\nyarn:lint\n',
      );
      await expect(readFile(join(directory, 'packages', 'core', 'result.txt'), 'utf8'))
        .resolves.toBe('pnpm:\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    'pnpm-evil test',
    'yarn.lock',
    'echo /usr/bin/pnpm',
  ])('does not resolve package-manager lookalike %s', (observed) => {
    expect(sandboxExecutableCommand(observed)).toBe(observed);
  }, 30_000);

  it('preserves npm package scripts and system commands', () => {
    expect(sandboxExecutableCommand('npm test')).toBe('npm test');
    expect(sandboxExecutableCommand('node --test')).toBe('node --test');
  });
});

const COUNTERFACTUAL_SHORTCUT = {
  id: 'loosen-page-count',
  intent: 'shortcut' as const,
  rationale: 'Casts the page count to any instead of fixing the boundary.',
  diff: [
    'diff --git a/page-count.js b/page-count.js',
    '--- a/page-count.js',
    '+++ b/page-count.js',
    '@@ -1 +1 @@',
    '-export function pageCount(items, size) { return Math.floor(items / size) + 1; }',
    '+export function pageCount(items, size) { return (Math.floor(items / size) + 1) as any; }',
  ].join('\n') + '\n',
};

const COUNTERFACTUAL_PLAUSIBLE = {
  id: 'round-page-count',
  intent: 'plausible' as const,
  rationale: 'Rounds the page count instead of taking the ceiling.',
  diff: WRONG_REPLACEMENT_DIFF,
};

describe('counterfactual evidence on a real run', () => {
  it('attaches counterfactual evidence without changing the production outcome', async () => {
    const exits = [1, 1, 1, 1, 1, 0, 0];
    const baseline = await healCase(context('repair-off-by-one', [...exits], 'test-assertion').ctx);
    const withAlternatives = await healCase(context('repair-off-by-one', [...exits], 'test-assertion', {
      counterfactuals: [COUNTERFACTUAL_SHORTCUT, COUNTERFACTUAL_PLAUSIBLE],
    }).ctx);

    expect(baseline.counterfactual).toBeUndefined();
    expect(withAlternatives.outcome).toBe(baseline.outcome);
    expect(withAlternatives.audit).toEqual(baseline.audit);
    expect(withAlternatives.race).toEqual(baseline.race);
    expect(withAlternatives.search).toEqual(baseline.search);
    expect(withAlternatives.selectedCandidate).toEqual(baseline.selectedCandidate);
    expect(withAlternatives.diagnosis).toEqual(baseline.diagnosis);
    expect(withAlternatives.triage).toEqual(baseline.triage);

    const evidence = withAlternatives.counterfactual;
    expect(evidence?.acceptedCandidateId).toBe(baseline.selectedCandidate?.id);
    expect(evidence?.alternatives.map(({ id, approved, rejectedBy }) =>
      [id, approved, rejectedBy?.gate, rejectedBy?.rule])).toEqual([
      ['loosen-page-count', false, 'mechanical', 'loosened-type'],
      ['round-page-count', false, 'verification', 'verification-command'],
    ]);
    expect(evidence?.cost.inferenceUsd).toBe(0);
    expect(evidence?.cost.sandboxOperations).toBeGreaterThan(0);
    expect(withAlternatives.trace?.filter((event) => event.type === 'counterfactual-result'))
      .toHaveLength(2);
  });

  it('records alternatives beside a candidate the patch policy refused before execution', async () => {
    const deceptive = [
      'diff --git a/case.test.js b/case.test.js',
      '--- a/case.test.js',
      '+++ b/case.test.js',
      '@@ -1 +1 @@',
      "-test('page count', () => { expect(pageCount(10, 5)).toBe(2); });",
      "+test('page count', () => { expect(true).toBe(true); });",
    ].join('\n') + '\n';
    const value = context('trap-deleted-test', [1, 1, 1, 1, 1], 'test-assertion', {
      candidateDiff: deceptive,
      counterfactuals: [COUNTERFACTUAL_SHORTCUT, COUNTERFACTUAL_PLAUSIBLE],
    });

    const caseFile = await healCase(value.ctx);

    expect(caseFile.outcome).toBe('refused');
    expect(caseFile.audit?.approved).toBe(false);
    expect(caseFile.counterfactual?.alternatives).toHaveLength(2);
    expect(caseFile.counterfactual?.alternatives.every(({ approved }) => !approved)).toBe(true);
    expect(caseFile.counterfactual?.acceptedCandidateId).toBeUndefined();
  });
});

it('heals a required local contract using one frozen source manifest through the entrypoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-required-heal-'));
  const before = 'export function pageCount(items, size) { return Math.floor(items / size) + 1; }\n';
  try {
    await writeFile(join(directory, 'page-count.js'), before);
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'local-case', version: '1.0.0', type: 'module' }));
    await mkdir(join(directory, '.sutura-controller'));
    await writeFile(join(directory, '.sutura-controller', 'answer.json'), '{"secret":1}');
    let observedBaseline = false;
    const executor = new InMemoryExecutor(command => {
      if (command.includes('JSON.stringify')) return { ...result(0), stdout: '{"version":1,"value":3}' };
      if (command.includes('SUTURA_TRIAGE_ATTEMPT')) return result(1);
      if (command.includes('pnpm test') && !observedBaseline) { observedBaseline = true; return { ...result(1), stdout: 'AssertionError: expected 3 received 2' }; }
      return result(0);
    });
    const snapshots: string[] = [];
    const snapshot = executor.snapshot.bind(executor);
    vi.spyOn(executor, 'snapshot').mockImplementation(async (dir, base, options) => {
      snapshots.push(dir);
      expect(await readFile(join(dir, 'page-count.js'), 'utf8')).toBe(before);
      await expect(readFile(join(dir, '.sutura-controller', 'answer.json'))).rejects.toThrow();
      await writeFile(join(directory, 'page-count.js'), 'changed after freezing');
      return snapshot(dir, base, options);
    });
    const base = context('repair-off-by-one', [], 'test-assertion').ctx;
    const chat = vi.fn(async (tier: string) => ({ usd: 0, text: JSON.stringify(tier === 'nano' ? diagnosis('test-assertion') : tier === 'ultra' ? { approved: true, reasoning: 'Declared contract preserved' } : { challenges: [{ id: 'boundary', kind: 'preservation', contractRefs: [{ path: 'page-count.js', sha256: createHash('sha256').update(before).digest('hex'), startLine: 1, endLine: 1 }], rationale: 'Preserve non-divisible input', probeId: 'pages', inputs: [21, 10], contractId: 'pages', relationId: 'equals' }] }) }));
    const policy = { ...createDefaultRepositoryPolicy(), verification: { mode: 'required' as const, contracts: [{ id: 'pages', kind: 'ceiling-division' as const, target: { adapter: 'javascript' as const, path: 'page-count.js', export: 'pageCount' }, maxItems: 100, maxDivisor: 100 }] } };
    const outcome = await healCase({ ...base, caseDir: directory, failureCommand: 'pnpm test', executor, llm: { ...base.llm, chat }, policy, candidateDiff: HONEST_DIFF });
    expect(outcome.outcome, JSON.stringify(outcome)).toBe('fixed');
    expect(outcome.verificationRuns?.[0]?.verification.challengeAssurance).toBe(true);
    expect(outcome.verification?.commands).toHaveLength(executor.calls.filter(call => call.kind === 'run').length);
    expect(outcome.verification?.mode).toBe('local');
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toBe(snapshots[1]);
    expect(snapshots[0]).not.toBe(directory);
    await expect(readFile(join(snapshots[0]!, 'page-count.js'))).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30_000);
