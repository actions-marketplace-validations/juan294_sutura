import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { Diagnosis } from '../domain.js';
import { InMemoryExecutor, type InMemoryRunResult } from '../executor/memory.js';
import { DEFAULT_MODEL_PRICES } from '../llm/cost.js';
import type { ChatMessage, ChatOptions, TierLlm } from '../llm/types.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import { RepairBudget } from './repair-budget.js';
import { createRepairAuthorizationSession, deriveRepairAuthorization, type ControllerBaselineBinding } from './repair-authorization.js';
import {
  CONTROLLED_REPAIR_MAX_TOKENS,
  controlledRepairAttemptReservationUsd,
  recoveryRepairReservationUsd,
  prepareControlledRepairProposalTemplate,
  runControlledRepairAttempt,
} from './repair-attempt.js';
import {
  anchoredEditsDiff,
  REPAIR_FULL_REPLACEMENT_MAX_CODE_POINTS,
  type RepairSourceContext,
} from './repair.js';

const diagnosis: Diagnosis = {
  class: 'test-assertion', confidence: 0.98, signals: ['expected 5'],
  failingCmd: 'pnpm test', errorExcerpt: 'expected -1 to be 5',
};
const sourceContext: RepairSourceContext = { sources: [{
  path: 'packages/core/src/dogfood-add.ts', startLine: 1, truncated: false,
  content: 'export function add(left: number, right: number): number {\n  return left - right;\n}\n',
}] };
const fixedSource = 'export function add(left: number, right: number): number {\n  return left + right;\n}\n';
const wrongSource = 'export function add(left: number, right: number): number {\n  return left * right;\n}\n';
const ambiguousSourceContext: RepairSourceContext = { sources: [
  {
    path: 'packages/core/src/dogfood-add.test.ts', startLine: 1, truncated: false,
    content: [
      "import { expect, it } from 'vitest';", '', "import { add } from './dogfood-add.js';", '',
      "it('adds two values', () => {", '  expect(add(2, 3)).toBe(5);', '});', '',
    ].join('\n'),
  },
  sourceContext.sources[0]!,
] };
const diff = [
  'diff --git a/packages/core/src/dogfood-add.ts b/packages/core/src/dogfood-add.ts',
  '--- a/packages/core/src/dogfood-add.ts', '+++ b/packages/core/src/dogfood-add.ts',
  '@@ -1,3 +1,3 @@', ' export function add(left: number, right: number): number {',
  '-  return left - right;', '+  return left + right;', ' }', '',
].join('\n');

function runResult(exitCode: number, stdout = '', stderr = ''): InMemoryRunResult {
  return { exitCode, stdout, stderr, truncated: false, metrics: {} };
}

function llm(
  replies: string | readonly string[],
  price = DEFAULT_MODEL_PRICES.super,
): { model: TierLlm<'super'>; chat: ReturnType<typeof vi.fn> } {
  const queue = typeof replies === 'string' ? [replies] : [...replies];
  let replyIndex = 0;
  const chat = vi.fn(async (
    _tier: 'super',
    _messages: readonly ChatMessage[],
    _options?: ChatOptions,
  ) => {
    void _tier;
    void _messages;
    void _options;
    const text = queue[replyIndex] ?? queue.at(-1) ?? '';
    replyIndex += 1;
    return { text, usd: 0.01 };
  });
  const model: TierLlm<'super'> = {
    modelQuote: vi.fn(() => ({
      role: 'super' as const, modelId: 'super', price, profileId: 'test',
    })),
    chat,
  };
  return { model, chat };
}

describe('runControlledRepairAttempt', () => {
  it('selects a complete test source only through its controller-derived narrow grant', async () => {
    const source = { path: 'case.test.js', startLine: 1, truncated: false,
      content: "import { expect, test } from 'vitest';\ntest('loads', async () => { expect(fetchName()).toBe('Ada'); });\n" };
    const policy = createDefaultRepositoryPolicy();
    const baseline: ControllerBaselineBinding = { kind: 'local-snapshot', sourceSha: null, policyBaseSha: null,
      policySha256: 'a'.repeat(64), baselineImageId: 'baseline', snapshotSha256: null };
    const session = createRepairAuthorizationSession({ baseline, failingCommand: 'pnpm test', policy, sources: [source] });
    expect(await deriveRepairAuthorization(session, { kind: 'await-operation', path: source.path,
      evidenceReferences: ['recorded-await-failure'], controllerProbe: { id: 'async-completion', sourceSha256: createHash('sha256').update(source.content).digest('hex'), failingCommand: diagnosis.failingCmd, imageId: 'baseline', exitCode: 1,
        output: 'AssertionError: expected Promise to be Ada' } })).toMatchObject({ ok: true });
    expect(prepareControlledRepairProposalTemplate({ diagnosis, policy, sourceContext: { sources: [source, sourceContext.sources[0]!] },
      authorization: { session, baseline } }).targetCount).toBe(1);
    const quoted = llm('', { input: 100, output: 3 });
    const budget = new RepairBudget();
    const quoteContext = { llm: quoted.model, diagnosis, policy, sourceContext: { sources: [source, sourceContext.sources[0]!] }, budget };
    const reserved = recoveryRepairReservationUsd(quoteContext);
    const actual = controlledRepairAttemptReservationUsd({ ...quoteContext,
      diagnosis: { ...diagnosis, class: 'test-bug', signals: [...diagnosis.signals, 'recovery:hypothesis-3'] },
      executor: new InMemoryExecutor(() => runResult(1)), initialImageId: 'baseline',
      trustedCommands: { diagnosed: diagnosis.failingCmd }, authorization: { session, baseline },
    });
    expect(reserved).toBeGreaterThan(0.05);
    expect(reserved).toBeGreaterThanOrEqual(actual);
    expect(quoted.chat).not.toHaveBeenCalled();
    expect(budget.snapshot().modelTurns).toBe(0);
    expect(() => prepareControlledRepairProposalTemplate({ diagnosis, policy, sourceContext: { sources: [source] } })).toThrow(/policy-admissible/u);
  });

  it('never turns a test-bug label into test-edit authority', () => {
    expect(() => prepareControlledRepairProposalTemplate({
      diagnosis: { ...diagnosis, class: 'test-bug' }, policy: createDefaultRepositoryPolicy(),
      sourceContext: { sources: [ambiguousSourceContext.sources[0]!] },
    })).toThrow(/policy-admissible/u);
  });

  it('replays live run 8: an accepted patch is tested and submitted without exploration', async () => {
    const results = [
      runResult(0, diff),
      runResult(0, '1 passed'),
    ];
    const executor = new InMemoryExecutor((_command, _parent, index) => results[index]!);
    const { model, chat } = llm(JSON.stringify({ replacement: fixedSource }));
    const budget = new RepairBudget();

    const outcome = await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(),
      budget, trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
      branchId: 'search-001',
    });

    expect(outcome).toMatchObject({
      status: 'submitted',
      candidate: {
        id: `repair-${createHash('sha256').update(diff).digest('hex').slice(0, 12)}`,
        diff,
      },
    });
    expect(chat).toHaveBeenCalledOnce();
    const options = chat.mock.calls[0]?.[2] as ChatOptions | undefined;
    expect(options).toMatchObject({ responseFormat: { type: 'json_schema' } });
    expect(options).toMatchObject({
      maxTokens: CONTROLLED_REPAIR_MAX_TOKENS,
      temperature: 1,
      topP: 0.95,
      thinkingMode: 'disabled',
    });
    expect(options).not.toHaveProperty('reasoningEffort');
    expect(JSON.stringify(options)).toContain('"replacement"');
    expect(JSON.stringify(options)).not.toContain('"startLine"');
    expect(JSON.stringify(options)).not.toContain('"path"');
    expect(JSON.stringify(options)).not.toContain('"old"');
    expect(options).not.toHaveProperty('tools');
    expect(executor.calls.map((call) => call.kind === 'run' ? call.cmd : '')).toEqual([
      expect.stringContaining('git apply'), 'pnpm test',
    ]);
    expect(budget.snapshot()).toMatchObject({ modelTurns: 1, toolCalls: 3, branches: 1, sandboxOperations: 2 });
  });

  it('returns a checkpoint immediately after a trusted test failure', async () => {
    const results = [
      runResult(0, diff),
      runResult(1, '', 'expected 7 to be 5'),
    ];
    const executor = new InMemoryExecutor((_command, _parent, index) => results[index]!);
    const outcome = await runControlledRepairAttempt({
      llm: llm(JSON.stringify({ replacement: wrongSource })).model,
      executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(),
      budget: new RepairBudget(), trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    });

    expect(outcome).toMatchObject({ status: 'checkpoint', test: { exitCode: 1 } });
    expect(executor.calls).toHaveLength(2);
  });

  it('rejects missing bounded source before repair inference or sandbox work', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const { model, chat } = llm('not json');
    const empty = await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(),
      budget: new RepairBudget(), trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: { sources: [] },
    });
    expect(empty).toMatchObject({ status: 'gave-up', failureKind: 'invalid' });
    expect(chat).not.toHaveBeenCalled();
    expect(executor.calls).toHaveLength(0);

    const emptyFile = await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' },
      sourceContext: { sources: [{ path: 'src/empty.ts', startLine: 1, content: '', truncated: false }] },
    });
    expect(emptyFile).toMatchObject({
      status: 'gave-up', failureKind: 'invalid',
      reason: 'No non-empty anchorable repair source was available',
    });
    expect(chat).not.toHaveBeenCalled();
  });

  it('replays live run 9: search-only text is invalid and cannot exhaust tool or sandbox budgets', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const { model, chat } = llm('Search the repository for the implementation.');

    const invalid = await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(),
      budget: new RepairBudget(), trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    });
    expect(invalid).toMatchObject({ status: 'gave-up', failureKind: 'invalid' });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(executor.calls).toHaveLength(0);
  });

  it('retries one invalid proposal and submits the valid second reply', async () => {
    const executor = new InMemoryExecutor((_command, _parent, index) => [
      runResult(0, diff), runResult(0, '1 passed'),
    ][index]!);
    const { model, chat } = llm([
      'not json',
      JSON.stringify({ replacement: fixedSource }),
    ]);
    const budget = new RepairBudget();
    const observe = vi.fn((entry: { parentImageId: string; note: string }) => {
      void entry;
      return 'proposal-retry-observation';
    });

    const outcome = await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget,
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext, observe,
    });

    expect(outcome).toMatchObject({ status: 'submitted', candidate: { diff } });
    expect(chat).toHaveBeenCalledTimes(2);
    const retryMessages = chat.mock.calls[1]?.[1] as readonly ChatMessage[];
    expect(retryMessages.slice(-2)).toEqual([
      { role: 'assistant', content: 'not json' },
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining(JSON.stringify({
          replacement: 'complete replacement for the controller-selected excerpt',
        })),
      }),
    ]);
    expect(observe).toHaveBeenCalledWith({
      parentImageId: 'baseline', note: 'Proposal retry after invalid response',
    });
    expect(observe.mock.calls.filter(([entry]) =>
      entry.note === 'Proposal retry after invalid response',
    )).toHaveLength(1);
    expect(observe.mock.invocationCallOrder[0]).toBeLessThan(
      chat.mock.invocationCallOrder[1]!,
    );
    expect(budget.snapshot().modelTurns).toBe(2);
  });

  it('fails closed after a second invalid proposal', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const { model, chat } = llm(['not json', 'still not json']);

    const outcome = await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    });

    expect(outcome).toMatchObject({ status: 'gave-up', failureKind: 'invalid' });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(executor.calls).toHaveLength(0);
  });

  it('stops the retry on budget', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const { model, chat } = llm([
      'not json',
      JSON.stringify({ replacement: fixedSource }),
    ]);

    const outcome = await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget({ modelTurns: 1 }),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    });

    expect(outcome).toMatchObject({ status: 'gave-up', failureKind: 'budget' });
    expect(chat).toHaveBeenCalledOnce();
    expect(executor.calls).toHaveLength(0);
  });

  it('replays live run 12: a provider length terminal is not misreported as malformed JSON', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const value = llm('{"id":"truncated"');
    value.chat.mockResolvedValueOnce({
      text: '{"id":"truncated"', usd: 0.01, finishReason: 'length',
    });

    const outcome = await runControlledRepairAttempt({
      llm: value.model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    });

    expect(outcome).toMatchObject({
      status: 'gave-up', failureKind: 'completion-limit',
      reason: 'Repair proposal reached the provider completion-token limit',
    });
    expect(value.chat).toHaveBeenCalledOnce();
    expect(executor.calls).toHaveLength(0);
  });

  it('replays live runs 13 and 14: the model cannot select a path or line range', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const value = llm(JSON.stringify({
      id: 'wrong-line', rationale: 'Use the assertion stack line.',
      edits: [{
        path: 'packages/core/src/dogfood-add.ts', startLine: 6, endLine: 6,
        new: '  return left + right;',
      }],
    }));

    const outcome = await runControlledRepairAttempt({
      llm: value.model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: ambiguousSourceContext,
    });

    expect(outcome).toMatchObject({ status: 'gave-up', failureKind: 'invalid' });
    expect(value.chat).toHaveBeenCalledTimes(2);
    expect(executor.calls).toHaveLength(0);
    const messages = value.chat.mock.calls[0]?.[1] as readonly ChatMessage[] | undefined;
    const user = messages?.find(({ role }) => role === 'user');
    const evidence = JSON.parse(user?.content ?? '{}') as {
      sources?: Array<{ path: string; startLine: number; endLine: number; lines: Array<{ line: number; text: string }> }>;
      selectedTarget?: { path: string; startLine: number; endLine: number };
    };
    expect(evidence.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'packages/core/src/dogfood-add.test.ts', editable: false,
      }),
      expect.objectContaining({
        path: 'packages/core/src/dogfood-add.ts', startLine: 1, endLine: 3, editable: true,
        lines: [
          { line: 1, text: 'export function add(left: number, right: number): number {' },
          { line: 2, text: '  return left - right;' },
          { line: 3, text: '}' },
        ],
      }),
    ]));
    expect(evidence.selectedTarget).toEqual({
      path: 'packages/core/src/dogfood-add.ts', startLine: 1, endLine: 3,
    });
    const options = value.chat.mock.calls[0]?.[2] as ChatOptions | undefined;
    if (options?.responseFormat?.type !== 'json_schema') throw new Error('Expected repair JSON schema');
    const schema = options.responseFormat.jsonSchema.schema;
    expect(schema).toMatchObject({
      properties: { replacement: { type: 'string', maxLength: 1_000 } },
      required: ['replacement'],
      additionalProperties: false,
    });
    expect(JSON.stringify(schema)).not.toMatch(/(?:path|startLine|endLine|dogfood-add)/u);
  });

  it('uses a non-empty CRLF source beside an empty excerpt without schema drift', async () => {
    const crlfContext: RepairSourceContext = { sources: [
      { path: 'src/empty.ts', startLine: 1, content: '', truncated: false },
      { path: 'src/value.ts', startLine: 10, content: 'const old = 1;\r\nexport { old };\r\n', truncated: false },
    ] };
    const crlfDiff = anchoredEditsDiff([{
      path: 'src/value.ts', startLine: 10, endLine: 11,
      new: 'const old = 2;\r\nexport { old };\r\n',
    }], crlfContext);
    const executor = new InMemoryExecutor((_command, _parent, index) => [
      runResult(0, crlfDiff), runResult(0, '1 passed'),
    ][index]!);
    const value = llm(JSON.stringify({ replacement: 'const old = 2;\nexport { old };\n' }));

    const outcome = await runControlledRepairAttempt({
      llm: value.model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: crlfContext,
    });

    expect(outcome).toMatchObject({ status: 'submitted', candidate: { diff: crlfDiff } });
    const messages = value.chat.mock.calls[0]?.[1] as readonly ChatMessage[];
    const user = messages.find(({ role }) => role === 'user');
    const evidence = JSON.parse(user?.content ?? '{}') as {
      sources: Array<{ path: string; startLine: number; endLine: number; lines: Array<{ line: number; text: string }> }>;
    };
    expect(evidence.sources).toEqual([expect.objectContaining({
      path: 'src/value.ts', startLine: 10, endLine: 11,
      lines: [{ line: 10, text: 'const old = 1;' }, { line: 11, text: 'export { old };' }],
    })]);
  });

  it('caches immutable source contracts across admission and execution', () => {
    const template = prepareControlledRepairProposalTemplate({
      diagnosis, policy: createDefaultRepositoryPolicy(), sourceContext: ambiguousSourceContext,
    });
    expect(template.contract()).toBe(template.contract());
    const feedback = { candidateDiff: diff, testOutput: 'still failing', errorFingerprint: 'abc' };
    expect(template.contract(feedback)).toBe(template.contract({ ...feedback }));
  });

  it('adds the repeated-proposal instruction only when feedback sets it', () => {
    const template = prepareControlledRepairProposalTemplate({
      diagnosis, policy: createDefaultRepositoryPolicy(), sourceContext: ambiguousSourceContext,
    });
    const repeated = template.contract({
      candidateDiff: diff,
      testOutput: 'fail',
      errorFingerprint: 'f',
      repeatedProposal: true,
    }, 0);
    const ordinary = template.contract({
      candidateDiff: diff,
      testOutput: 'fail',
      errorFingerprint: 'f',
    }, 0);

    expect(repeated).not.toBe(ordinary);
    expect(repeated.messages[0]?.content).toContain('materially different replacement');
    expect(ordinary.messages[0]?.content).not.toContain('materially different replacement');
  });

  it('creates distinct controller-owned contracts for multiple editable targets', () => {
    const template = prepareControlledRepairProposalTemplate({
      diagnosis, policy: createDefaultRepositoryPolicy(),
      sourceContext: { sources: [
        sourceContext.sources[0]!,
        { path: 'src/alternate.ts', startLine: 8, content: 'export const alternate = 1;\n', truncated: false },
      ] },
    });
    expect(template.targetCount).toBe(2);
    const first = template.contract(undefined, 0);
    const second = template.contract(undefined, 1);
    expect(first.target).toEqual({
      path: 'packages/core/src/dogfood-add.ts', startLine: 1, endLine: 3,
    });
    expect(second.target).toEqual({ path: 'src/alternate.ts', startLine: 8, endLine: 8 });
    expect(first).not.toBe(second);
    expect(JSON.stringify(first.schema)).not.toMatch(/(?:dogfood-add|alternate|startLine|endLine|"path")/u);
    expect(() => template.contract(undefined, 2)).toThrow(/target index/iu);
  });

  it('applies a replacement only to the controller-selected target', async () => {
    const alternate = {
      path: 'src/alternate.ts', startLine: 8,
      content: 'export const alternate = 1;\n', truncated: false,
    };
    const multipleSources = { sources: [sourceContext.sources[0]!, alternate] };
    const template = prepareControlledRepairProposalTemplate({
      diagnosis, policy: createDefaultRepositoryPolicy(), sourceContext: multipleSources,
    });
    const alternateDiff = anchoredEditsDiff([{
      path: alternate.path, startLine: 8, endLine: 8, new: 'export const alternate = 2;',
    }], multipleSources);
    const executor = new InMemoryExecutor((_command, _parent, index) => [
      runResult(0, alternateDiff), runResult(0, '1 passed'),
    ][index]!);
    const outcome = await runControlledRepairAttempt({
      llm: llm(JSON.stringify({ replacement: 'export const alternate = 2;\n' })).model,
      executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: multipleSources,
      proposalTemplate: template, proposalContract: template.contract(undefined, 1),
    });
    expect(outcome).toMatchObject({
      status: 'submitted',
      candidate: { id: expect.stringMatching(/^repair-[a-f0-9]{12}$/u), diff: alternateDiff },
    });
    expect(alternateDiff).not.toContain('dogfood-add.ts');
  });

  it('keeps a controller-selected source path identical without exposing it to provider output', () => {
    const credentialShapedPath = 'src/sk_test_abcdefgh.ts';
    const contract = prepareControlledRepairProposalTemplate({
      diagnosis, policy: createDefaultRepositoryPolicy(),
      sourceContext: { sources: [{
        path: credentialShapedPath, startLine: 1, content: 'export const value = 1;\n', truncated: false,
      }] },
    }).contract();
    const evidence = JSON.parse(contract.messages[1]!.content ?? '{}') as { sources: Array<{ path: string }> };
    expect(evidence.sources[0]?.path).toBe(credentialShapedPath);
    expect(contract.target.path).toBe(credentialShapedPath);
    expect(JSON.stringify(contract.schema)).not.toContain(credentialShapedPath);
  });

  it('rejects source ranges that overflow safe line anchors before inference', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const value = llm('unused');
    const outcome = await runControlledRepairAttempt({
      llm: value.model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' },
      sourceContext: { sources: [{
        path: 'src/value.ts', startLine: Number.MAX_SAFE_INTEGER,
        content: 'const first = 1;\nconst second = 2;\n', truncated: false,
      }] },
    });
    expect(outcome).toMatchObject({
      status: 'gave-up', failureKind: 'invalid',
      reason: 'repair source src/value.ts line range exceeds safe integers',
    });
    expect(value.chat).not.toHaveBeenCalled();
    expect(executor.calls).toHaveLength(0);
  });

  it('rejects a full-excerpt target that cannot fit the declared completion envelope', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const value = llm('unused');
    const outcome = await runControlledRepairAttempt({
      llm: value.model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' },
      sourceContext: { sources: [{
        path: 'src/value.ts', startLine: 1,
        content: `${'x'.repeat(REPAIR_FULL_REPLACEMENT_MAX_CODE_POINTS)}\n`,
        truncated: true,
      }] },
    });

    expect(outcome).toMatchObject({
      status: 'gave-up', failureKind: 'invalid',
      reason: 'No completion-bounded repair source was available',
    });
    expect(value.chat).not.toHaveBeenCalled();
    expect(executor.calls).toHaveLength(0);
  });

  it('rejects a truncated partial final line before inference', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const value = llm('unused');
    const outcome = await runControlledRepairAttempt({
      llm: value.model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' },
      sourceContext: { sources: [{
        path: 'src/value.ts', startLine: 1,
        content: 'export const partial =', truncated: true,
      }] },
    });

    expect(outcome).toMatchObject({ status: 'gave-up', failureKind: 'invalid' });
    expect(value.chat).not.toHaveBeenCalled();
    expect(executor.calls).toHaveLength(0);
  });

  it('keeps a maximally escaped replacement within the reasoning-disabled completion envelope', () => {
    const text = JSON.stringify({
      replacement: '\u0000'.repeat(REPAIR_FULL_REPLACEMENT_MAX_CODE_POINTS),
    });

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(CONTROLLED_REPAIR_MAX_TOKENS);
  });

  it('replays live runs 1 and 2: unsupported parallel and tool-choice fields are absent', async () => {
    const executor = new InMemoryExecutor((_command, _parent, index) => [
      runResult(0, diff), runResult(0, '1 passed'),
    ][index]!);
    const { model, chat } = llm(JSON.stringify({ replacement: fixedSource }));

    await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    });

    const options = chat.mock.calls[0]?.[2] as ChatOptions | undefined;
    expect(options).not.toHaveProperty('parallelToolCalls');
    expect(options).not.toHaveProperty('toolChoice');
    expect(options).not.toHaveProperty('tools');
  });

  it('replays live run 11: provider and local replacement bounds use one contract', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const { model, chat } = llm(JSON.stringify({
      replacement: 'x'.repeat(REPAIR_FULL_REPLACEMENT_MAX_CODE_POINTS + 1),
    }));

    const outcome = await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    });

    expect(outcome).toMatchObject({ status: 'gave-up', failureKind: 'invalid' });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(executor.calls).toHaveLength(0);
    expect(chat.mock.calls[0]?.[2]).toMatchObject({ responseFormat: { jsonSchema: { schema: {
      properties: {
        replacement: { type: 'string', maxLength: 1_000 },
      },
    } } } });
  });

  it('uses JSON Schema code-point lengths and rejects model-selected target fields', async () => {
    const acceptedExecutor = new InMemoryExecutor((_command, _parent, index) => [
      runResult(0, diff), runResult(0, '1 passed'),
    ][index]!);
    await expect(runControlledRepairAttempt({
      llm: llm(JSON.stringify({
        replacement: '😀'.repeat(REPAIR_FULL_REPLACEMENT_MAX_CODE_POINTS),
      })).model,
      executor: acceptedExecutor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    })).resolves.toMatchObject({ status: 'submitted' });

    const rejectedExecutor = new InMemoryExecutor(() => runResult(1));
    await expect(runControlledRepairAttempt({
      llm: llm(JSON.stringify({
        id: 'unsafe-line', rationale: 'Reject an unsafe JSON integer.',
        edits: [{
          path: 'packages/core/src/dogfood-add.ts',
          startLine: Number.MAX_SAFE_INTEGER + 1,
          endLine: Number.MAX_SAFE_INTEGER + 1,
          new: '',
        }],
      })).model,
      executor: rejectedExecutor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    })).resolves.toMatchObject({ status: 'gave-up', failureKind: 'invalid' });
    expect(rejectedExecutor.calls).toHaveLength(0);
  });

  it('replays live run 15: legacy model-owned metadata is rejected before sandbox work', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const { model, chat } = llm(JSON.stringify({
      id: 'legacy-id',
      rationale: 'Legacy model-owned rationale.',
      replacement: fixedSource,
    }));
    const outcome = await runControlledRepairAttempt({
      llm: model,
      executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    });

    expect(outcome).toMatchObject({
      status: 'gave-up', failureKind: 'invalid',
      reason: 'Repair proposal must contain only the replacement field',
    });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(executor.calls).toHaveLength(0);
  });

  it('returns typed provider, policy, sandbox, cancellation, and budget terminals', async () => {
    const provider = llm('unused');
    provider.chat.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(runControlledRepairAttempt({
      llm: provider.model, executor: new InMemoryExecutor(() => runResult(1)),
      initialImageId: 'baseline', diagnosis, policy: createDefaultRepositoryPolicy(),
      budget: new RepairBudget(), trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    })).resolves.toMatchObject({ status: 'infra-stop', failureKind: 'provider' });

    const protectedPolicy = createDefaultRepositoryPolicy();
    protectedPolicy.protectedPaths.push('packages/core/src/dogfood-add.ts');
    await expect(runControlledRepairAttempt({
      llm: llm(JSON.stringify({ replacement: fixedSource })).model,
      executor: new InMemoryExecutor(() => runResult(1)), initialImageId: 'baseline', diagnosis,
      policy: protectedPolicy, budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    })).resolves.toMatchObject({ status: 'gave-up', failureKind: 'policy' });

    let runIndex = 0;
    const missingTest = new InMemoryExecutor(() => {
      runIndex += 1;
      if (runIndex === 1) return runResult(0, diff);
      throw new Error('trusted test evidence unavailable');
    });
    await expect(runControlledRepairAttempt({
      llm: llm(JSON.stringify({ replacement: fixedSource })).model,
      executor: missingTest, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    })).resolves.toMatchObject({ status: 'gave-up', failureKind: 'sandbox' });

    const controller = new AbortController();
    controller.abort();
    const cancelled = llm('unused');
    await expect(runControlledRepairAttempt({
      llm: cancelled.model, executor: new InMemoryExecutor(() => runResult(1)),
      initialImageId: 'baseline', diagnosis, policy: createDefaultRepositoryPolicy(),
      budget: new RepairBudget(), trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
      signal: controller.signal,
    })).resolves.toMatchObject({ status: 'gave-up', failureKind: 'sandbox' });
    expect(cancelled.chat).not.toHaveBeenCalled();

    const expensive = llm('unused', { input: 100, output: 100 });
    await expect(runControlledRepairAttempt({
      llm: expensive.model, executor: new InMemoryExecutor(() => runResult(1)),
      initialImageId: 'baseline', diagnosis, policy: createDefaultRepositoryPolicy(),
      budget: new RepairBudget({ inferenceCostUsd: 0.01 }),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    })).resolves.toMatchObject({ status: 'gave-up', failureKind: 'budget' });
    expect(expensive.chat).not.toHaveBeenCalled();
  });

  it('replays live run 7: a trusted-test timeout becomes checkpoint evidence without another model turn', async () => {
    const executor = new InMemoryExecutor((_command, _parent, index) => [
      runResult(0, diff), runResult(-1, '', 'command timed out'),
    ][index]!);
    const { model, chat } = llm(JSON.stringify({ replacement: fixedSource }));

    const outcome = await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    });

    expect(outcome).toMatchObject({
      status: 'checkpoint', test: { exitCode: -1, output: expect.stringContaining('timed out') },
    });
    expect(chat).toHaveBeenCalledOnce();
    expect(executor.calls).toHaveLength(2);
  });

  it('does not submit a candidate when cancellation arrives during the trusted test', async () => {
    const controller = new AbortController();
    const executor = new InMemoryExecutor((_command, _parent, index) => {
      if (index === 0) return runResult(0, diff);
      controller.abort();
      return runResult(0, '1 passed');
    });
    const { model, chat } = llm(JSON.stringify({ replacement: fixedSource }));
    const budget = new RepairBudget();

    const outcome = await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget,
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
      signal: controller.signal,
    });

    expect(outcome).toMatchObject({ status: 'gave-up', failureKind: 'sandbox' });
    expect(chat).toHaveBeenCalledOnce();
    expect(executor.calls).toHaveLength(2);
    expect(budget.snapshot().toolCalls).toBe(2);
  });
});

describe('module-system hints and policy feedback', () => {
  const cjsSource: RepairSourceContext = { sources: [{
    path: 'app.cjs', startLine: 1, truncated: false,
    content: "const chalk = require('chalk');\nexports.renderStatus = () => chalk.green('ready');\n",
  }] };
  const upstream: Diagnosis = {
    class: 'dep-upstream-breaking', confidence: 0.9, signals: [],
    failingCmd: 'pnpm test', errorExcerpt: 'TypeError: chalk.green is not a function',
  };

  it('tells the model the selected .cjs target is CommonJS', () => {
    const template = prepareControlledRepairProposalTemplate({
      diagnosis: upstream, policy: createDefaultRepositoryPolicy(), sourceContext: cjsSource,
    });
    const system = template.contract(undefined, 0).messages[0]!.content;
    expect(system).toContain('CommonJS (.cjs)');
    expect(system).toContain("require('pkg').default");
    expect(system).not.toContain('ES module (.mjs)');
  });

  it('tells the model the selected .mjs target is an ES module', () => {
    const template = prepareControlledRepairProposalTemplate({
      diagnosis: upstream, policy: createDefaultRepositoryPolicy(),
      sourceContext: { sources: [{
        path: 'app.mjs', startLine: 1, truncated: false,
        content: "import chalk from 'chalk';\nexport const renderStatus = () => chalk.green('ready');\n",
      }] },
    });
    const system = template.contract(undefined, 0).messages[0]!.content;
    expect(system).toContain('ES module (.mjs)');
    expect(system).not.toContain('CommonJS (.cjs)');
  });

  it('adds no module-system line for other extensions', () => {
    const template = prepareControlledRepairProposalTemplate({
      diagnosis, policy: createDefaultRepositoryPolicy(), sourceContext,
    });
    const system = template.contract(undefined, 0).messages[0]!.content;
    expect(system).not.toContain('CommonJS (.cjs)');
    expect(system).not.toContain('ES module (.mjs)');
  });

  it('replays live Placebo run 33810847395: names the policy violation when the patch is rejected', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const value = llm(JSON.stringify({
      replacement: "import chalk from 'chalk';\nexports.renderStatus = () => chalk.green('ready');\n",
    }));

    const outcome = await runControlledRepairAttempt({
      llm: value.model, executor, initialImageId: 'baseline', diagnosis: upstream,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: cjsSource,
    });

    expect(outcome).toMatchObject({ status: 'gave-up', failureKind: 'policy' });
    expect(outcome.status === 'gave-up' ? outcome.reason : '')
      .toContain('adds ES module syntax to CommonJS file: app.cjs');
    expect(executor.calls).toHaveLength(0);
  });
});
