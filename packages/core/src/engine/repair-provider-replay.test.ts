import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_MODELS, TOKEN_FACTORY_BASE_URL } from '../config.js';
import type { Diagnosis } from '../domain.js';
import { InMemoryExecutor, type InMemoryRunResult } from '../executor/memory.js';
import {
  type NebiusClient,
  type HttpRequestInit,
  type HttpResponse,
} from '../llm/nebius.js';
import { createTokenFactoryClient } from '../llm/token-factory.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import { capturedLiveRun } from '../__fixtures__/captured/captured-live-run.test-helper.js';
import { runControlledRepairAttempt } from './repair-attempt.js';
import { RepairBudget } from './repair-budget.js';

const BROKEN_SOURCE = 'export function add(left: number, right: number): number {\n  return left - right;\n}\n';
const FIXED_SOURCE = BROKEN_SOURCE.replace('left - right', 'left + right');
const WRONG_SOURCE = BROKEN_SOURCE.replace('left - right', 'left * right');
const SOURCE_CONTEXT = {
  sources: [
    {
      path: 'packages/core/src/dogfood-add.test.ts',
      startLine: 1,
      content: "import { add } from './dogfood-add.js';\nexpect(add(2, 3)).toBe(5);\n",
      truncated: false,
    },
    {
      path: 'packages/core/src/dogfood-add.ts',
      startLine: 1,
      content: BROKEN_SOURCE,
      truncated: false,
    },
  ],
};
const DIAGNOSIS: Diagnosis = {
  class: 'test-assertion',
  confidence: 0.99,
  signals: ['expected -1 to be 5'],
  failingCmd: 'pnpm --filter @sutura/core test',
  errorExcerpt: 'packages/core/src/dogfood-add.test.ts: expected -1 to be 5',
};

type WireBody = {
  model: string;
  messages: Array<{ role: string; content?: string | null }>;
  [key: string]: unknown;
};

function providerResponse(content: string, finishReason = 'stop'): HttpResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    async json() {
      return {
        choices: [{ finish_reason: finishReason, message: { content } }],
        usage: {
          prompt_tokens: 200,
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

function patchFromCommand(command: string): string {
  const encoded = /printf '%s' '?([A-Za-z0-9+/=]+)'? \|/u.exec(command)?.[1] ?? '';
  return Buffer.from(encoded, 'base64').toString('utf8');
}

function executor(testExitCode = 0): InMemoryExecutor {
  return new InMemoryExecutor((command, _parent, index): InMemoryRunResult => {
    if (index === 0) {
      const patch = patchFromCommand(command);
      return {
        exitCode: 0,
        stdout: patch,
        stderr: '',
        truncated: false,
        metrics: {},
      };
    }
    return {
      exitCode: testExitCode,
      stdout: testExitCode === 0 ? '1 passed' : '',
      stderr: testExitCode === 0 ? '' : 'expected -1 to be 5',
      truncated: false,
      metrics: {},
    };
  });
}

function provider(
  replies: ReadonlyArray<{ content: string; finishReason?: string }>,
): {
  client: NebiusClient;
  fetch: ReturnType<typeof vi.fn>;
  bodies: WireBody[];
} {
  const bodies: WireBody[] = [];
  const fetch = vi.fn(async (url: string, init: HttpRequestInit): Promise<HttpResponse> => {
    expect(url).toBe(`${TOKEN_FACTORY_BASE_URL}chat/completions`);
    bodies.push(JSON.parse(init.body) as WireBody);
    const reply = replies[bodies.length - 1];
    if (reply === undefined) throw new Error('No recorded provider reply');
    return providerResponse(reply.content, reply.finishReason);
  });
  return {
    client: createTokenFactoryClient({
      apiKey: 'test-key',
      models: DEFAULT_MODELS,
    }, { fetch }),
    fetch,
    bodies,
  };
}

async function attempt(
  client: NebiusClient,
  sandbox: InMemoryExecutor,
  budget = new RepairBudget(),
) {
  return runControlledRepairAttempt({
    llm: client,
    executor: sandbox,
    initialImageId: 'baseline',
    diagnosis: DIAGNOSIS,
    policy: createDefaultRepositoryPolicy(),
    budget,
    trustedCommands: { diagnosed: 'pnpm --filter @sutura/core test' },
    sourceContext: SOURCE_CONTEXT,
  });
}

describe('recorded live repair failures at the serialized provider boundary', () => {
  it('replays live run 1: parallel_tool_calls is structurally absent', async () => {
    capturedLiveRun(1, '33238860852');
    const value = provider([{ content: JSON.stringify({ replacement: FIXED_SOURCE }) }]);
    await expect(attempt(value.client, executor())).resolves.toMatchObject({ status: 'submitted' });
    expect(value.bodies[0]).not.toHaveProperty('parallel_tool_calls');
  });

  it('replays live run 2: named tool_choice and repair tools are structurally absent', async () => {
    capturedLiveRun(2, '33240572371');
    const value = provider([{ content: JSON.stringify({ replacement: FIXED_SOURCE }) }]);
    await expect(attempt(value.client, executor())).resolves.toMatchObject({ status: 'submitted' });
    expect(value.bodies[0]).not.toHaveProperty('tool_choice');
    expect(value.bodies[0]).not.toHaveProperty('tools');
  });

  it('replays live run 3: one shared budget admits multiple complete serialized attempts', async () => {
    capturedLiveRun(3, '33241358531');
    const value = provider([
      { content: JSON.stringify({ replacement: WRONG_SOURCE }) },
      { content: JSON.stringify({ replacement: FIXED_SOURCE }) },
    ]);
    const budget = new RepairBudget();

    await expect(attempt(value.client, executor(1), budget)).resolves.toMatchObject({ status: 'checkpoint' });
    await expect(attempt(value.client, executor(0), budget)).resolves.toMatchObject({ status: 'submitted' });
    expect(value.fetch).toHaveBeenCalledTimes(2);
    expect(budget.snapshot()).toMatchObject({ modelTurns: 2, branches: 2 });
  });

  it('replays live run 6: invalid model patch calls cannot cross the one-field boundary', async () => {
    capturedLiveRun(6, '33244884596');
    const invalid = JSON.stringify({
      replacement: FIXED_SOURCE,
      tool: 'apply_patch',
      arguments: { path: 'packages/core/src/dogfood-add.ts' },
    });
    const value = provider([{ content: invalid }, { content: invalid }]);
    const sandbox = executor();
    await expect(attempt(value.client, sandbox)).resolves.toMatchObject({
      status: 'gave-up',
      failureKind: 'invalid',
    });
    expect(value.fetch).toHaveBeenCalledTimes(2);
    expect(sandbox.calls).toHaveLength(0);
  });

  it('replays live run 7: trusted-test exit -1 remains checkpoint evidence', async () => {
    capturedLiveRun(7, '33246383946');
    const value = provider([{ content: JSON.stringify({ replacement: FIXED_SOURCE }) }]);
    await expect(attempt(value.client, executor(-1))).resolves.toMatchObject({
      status: 'checkpoint',
      test: { exitCode: -1 },
    });
    expect(value.fetch).toHaveBeenCalledOnce();
  });

  it('replays live run 8: a correct replacement cannot trigger later exploration', async () => {
    capturedLiveRun(8, '33247360873');
    const value = provider([{ content: JSON.stringify({ replacement: FIXED_SOURCE }) }]);
    const sandbox = executor();
    await expect(attempt(value.client, sandbox)).resolves.toMatchObject({ status: 'submitted' });
    expect(value.fetch).toHaveBeenCalledOnce();
    expect(sandbox.calls).toHaveLength(2);
  });

  it('replays live run 9: search-only output is invalid before sandbox work', async () => {
    capturedLiveRun(9, '33248388988');
    const invalid = JSON.stringify({ search_repo: 'dogfood-add' });
    const value = provider([{ content: invalid }, { content: invalid }]);
    const sandbox = executor();
    await expect(attempt(value.client, sandbox)).resolves.toMatchObject({
      status: 'gave-up',
      failureKind: 'invalid',
    });
    expect(value.fetch).toHaveBeenCalledTimes(2);
    expect(sandbox.calls).toHaveLength(0);
  });

  it('replays live run 11: provider acceptance cannot bypass the local replacement bound', async () => {
    capturedLiveRun(11, '33254012677');
    const invalid = JSON.stringify({ replacement: 'x'.repeat(1_001) });
    const value = provider([{ content: invalid }, { content: invalid }]);
    const sandbox = executor();
    await expect(attempt(value.client, sandbox)).resolves.toMatchObject({
      status: 'gave-up',
      failureKind: 'invalid',
    });
    expect(value.fetch).toHaveBeenCalledTimes(2);
    expect(sandbox.calls).toHaveLength(0);
    expect(value.bodies[0]).toMatchObject({
      response_format: { json_schema: { schema: {
        properties: { replacement: { maxLength: 1_000 } },
      } } },
    });
  });

  it('replays live run 12: finish_reason length is a completion-limit terminal', async () => {
    capturedLiveRun(12, '33256572917');
    const value = provider([{ content: '{"replacement":"', finishReason: 'length' }]);
    await expect(attempt(value.client, executor())).resolves.toMatchObject({
      status: 'gave-up',
      failureKind: 'completion-limit',
    });
  });

  it('replays live run 13: out-of-range target metadata is structurally invalid', async () => {
    capturedLiveRun(13, '33258931783');
    const invalid = JSON.stringify({
      replacement: FIXED_SOURCE,
      startLine: 99,
      endLine: 99,
    });
    const value = provider([{ content: invalid }, { content: invalid }]);
    const sandbox = executor();
    await expect(attempt(value.client, sandbox)).resolves.toMatchObject({ failureKind: 'invalid' });
    expect(value.fetch).toHaveBeenCalledTimes(2);
    expect(sandbox.calls).toHaveLength(0);
  });

  it('replays live run 14: provider-accepted target contradictions and wrong patches do not submit', async () => {
    capturedLiveRun(14, '33261605582');
    const contradiction = JSON.stringify({
      replacement: FIXED_SOURCE,
      path: 'packages/core/src/dogfood-add.test.ts',
    });
    const value = provider([
      { content: contradiction },
      { content: contradiction },
      { content: JSON.stringify({ replacement: WRONG_SOURCE }) },
    ]);
    const firstSandbox = executor();
    await expect(attempt(value.client, firstSandbox)).resolves.toMatchObject({ failureKind: 'invalid' });
    expect(firstSandbox.calls).toHaveLength(0);
    await expect(attempt(value.client, executor(1))).resolves.toMatchObject({ status: 'checkpoint' });
    expect(value.fetch).toHaveBeenCalledTimes(3);
  });

  it('replays live run 15: legacy three-field replies fail under the compact thinking-off request', async () => {
    capturedLiveRun(15, '33265268595');
    const invalid = JSON.stringify({
      id: 'model-id',
      rationale: 'model rationale',
      replacement: FIXED_SOURCE,
    });
    const value = provider([{ content: invalid }, { content: invalid }]);
    const sandbox = executor();
    await expect(attempt(value.client, sandbox)).resolves.toMatchObject({ failureKind: 'invalid' });
    expect(value.fetch).toHaveBeenCalledTimes(2);
    expect(sandbox.calls).toHaveLength(0);
    expect(value.bodies[0]).toMatchObject({
      max_tokens: 8_192,
      chat_template_kwargs: { enable_thinking: false, force_nonempty_content: true },
    });
    expect(value.bodies[0]).not.toHaveProperty('extra_body');
  });

  it('replays live run 16: the exact Super request omits reasoning_effort', async () => {
    capturedLiveRun(16, '33268037618');
    const value = provider([{ content: JSON.stringify({ replacement: FIXED_SOURCE }) }]);
    await expect(attempt(value.client, executor())).resolves.toMatchObject({ status: 'submitted' });
    expect(value.bodies[0]).toMatchObject({
      model: DEFAULT_MODELS.super,
      temperature: 1,
      top_p: 0.95,
      chat_template_kwargs: { enable_thinking: false, force_nonempty_content: true },
    });
    expect(value.bodies[0]).not.toHaveProperty('extra_body');
    expect(value.bodies[0]).not.toHaveProperty('reasoning_effort');
  });
});
