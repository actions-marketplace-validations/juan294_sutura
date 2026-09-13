import { readFile } from 'node:fs/promises';

import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import type {
  AssistantMessage,
  CapacitySnapshot,
  ChatMessage,
  ChatOptions,
  FunctionToolCall,
  FunctionToolDefinition,
  ResponseFormat,
  ToolChoice,
  ToolMessage,
} from '@sutura/core';

import {
  capturedDogfoodReplayBundle,
  decodedRecordedBody,
  successfulCapturedHttp,
} from '../__fixtures__/captured/live-dogfood-replay.test-helper.js';
import { DEFAULT_MODEL_PRICES } from './cost.js';
import {
  MODEL_SELECTION_SCHEMA_VERSION,
  type ModelSelectionProfile,
} from './router.js';
import {
  NebiusApiError,
  NebiusClient,
  NebiusResponseError,
  type NebiusClientConfig,
  type HttpRequestInit,
  type HttpResponse,
} from './nebius.js';

const MODELS = {
  nano: 'nano-model',
  super: 'super-model',
  ultra: 'ultra-model',
};

const CONFIG: NebiusClientConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://example.test/v1/',
  models: MODELS,
  prices: DEFAULT_MODEL_PRICES,
};

const MESSAGES = [{ role: 'user', content: 'Diagnose this.' }] as const;
const SELECTED_PROFILE: ModelSelectionProfile = {
  schemaVersion: MODEL_SELECTION_SCHEMA_VERSION,
  profileId: 'ablation:complete-local',
  complete: true,
  pricesVerified: true,
  models: {
    nano: 'nvidia/Nemotron-3_5-Lightning',
    super: MODELS.super,
    ultra: MODELS.ultra,
  },
  prices: {
    nano: { input: 0.2, output: 0.4 },
    super: DEFAULT_MODEL_PRICES.super,
    ultra: DEFAULT_MODEL_PRICES.ultra,
  },
};

function response(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): HttpResponse {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return normalizedHeaders[name.toLowerCase()] ?? null;
      },
    },
    async json() {
      return body;
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

function successResponse(content = 'fixed', reasoningTokens = 0): HttpResponse {
  return response({
    choices: [{ finish_reason: 'stop', message: { content } }],
    usage: {
      prompt_tokens: 1_000,
      completion_tokens: 2_000,
      completion_tokens_details: { reasoning_tokens: reasoningTokens },
    },
  });
}

async function capturedNebiusResponse(): Promise<unknown> {
  const bundle = await capturedDogfoodReplayBundle();
  const body = successfulCapturedHttp(bundle, 'nebius')[0]?.response.body;
  if (body === undefined) throw new Error('Captured Nebius response body is unavailable');
  return JSON.parse(decodedRecordedBody(body));
}

async function capturedUltraAuditResponse(): Promise<unknown> {
  const bundle = await capturedDogfoodReplayBundle('33325938237');
  for (const exchange of successfulCapturedHttp(bundle, 'nebius')) {
    const parsed = JSON.parse(decodedRecordedBody(exchange.response.body)) as {
      choices?: Array<{ message?: { tool_calls?: unknown } }>;
    };
    if (parsed.choices?.[0]?.message?.tool_calls === null) return parsed;
  }
  throw new Error('Captured Ultra audit response is unavailable');
}

describe('NebiusClient', () => {
  it('accepts the captured workflow 33321172589 Nebius response shape', async () => {
    const client = new NebiusClient(CONFIG, {
      fetch: vi.fn().mockResolvedValue(response(await capturedNebiusResponse())),
    });

    const reply = await client.chat('nano', MESSAGES);

    expect(reply.text).toContain('test-assertion');
    expect(reply.usage.inTok).toBeGreaterThan(0);
    expect(reply.usage.outTok).toBeGreaterThan(0);
  });

  it('replays live run 33326031664: accepts null tool_calls with audit content', async () => {
    const client = new NebiusClient(CONFIG, {
      fetch: vi.fn().mockResolvedValue(response(await capturedUltraAuditResponse())),
    });

    const reply = await client.chat('ultra', MESSAGES);

    expect(reply.text).toContain('"approved":true');
    expect(reply.toolCalls).toEqual([]);
    expect(reply.usage.reasoningTok).toBeGreaterThan(0);
  });

  it('exports the Token Factory protocol types from the package root', () => {
    expectTypeOf<ChatMessage>().toBeObject();
    expectTypeOf<AssistantMessage>().toBeObject();
    expectTypeOf<ToolMessage>().toBeObject();
    expectTypeOf<ChatOptions>().toBeObject();
    expectTypeOf<CapacitySnapshot>().toBeObject();
    expectTypeOf<FunctionToolCall>().toBeObject();
    expectTypeOf<FunctionToolDefinition>().toBeObject();
    expectTypeOf<ResponseFormat>().toBeObject();
    expectTypeOf<ToolChoice>().toEqualTypeOf<'none' | 'auto'>();
  });

  it.each(['nano', 'super', 'ultra'] as const)(
    'routes the %s tier to its configured model id',
    async (tier) => {
      const fetch = vi.fn().mockResolvedValue(successResponse());
      const client = new NebiusClient(CONFIG, { fetch });

      await client.chat(tier, MESSAGES, {
        maxTokens: 2_048,
        temperature: 0.25,
        reasoningEffort: 'low',
        responseFormat: { type: 'json_object' },
      });

      expect(fetch).toHaveBeenCalledOnce();
      const [url, init] = fetch.mock.calls[0] as [string, HttpRequestInit];
      expect(url).toBe('https://example.test/v1/chat/completions');
      expect(init.headers).toEqual({
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(init.body as string)).toEqual({
        model: MODELS[tier],
        messages: MESSAGES,
        max_tokens: 2_048,
        temperature: 0.25,
        reasoning_effort: 'low',
        response_format: { type: 'json_object' },
      });
    },
  );

  it('sends a completed selected profile and records its actual model and routed role', async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse());
    const client = new NebiusClient({
      ...CONFIG,
      routingProfileId: SELECTED_PROFILE.profileId,
      selectionProfiles: [SELECTED_PROFILE],
    }, { fetch });

    const reply = await client.chat('nano', MESSAGES);

    const [, init] = fetch.mock.calls[0] as [string, HttpRequestInit];
    expect(JSON.parse(init.body as string).model).toBe('nvidia/Nemotron-3_5-Lightning');
    expect(reply.model).toBe('nvidia/Nemotron-3_5-Lightning');
    expect(client.ledger.entries[0]).toMatchObject({
      role: 'nano',
      model: 'nvidia/Nemotron-3_5-Lightning',
      usd: 0.001,
    });
  });

  it('defaults max_tokens to 4096 and temperature to zero', async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse());
    const client = new NebiusClient(CONFIG, { fetch });

    await client.chat('nano', MESSAGES);

    const [, init] = fetch.mock.calls[0] as [string, HttpRequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      max_tokens: 4_096,
      temperature: 0,
    });
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid topP %s before making a request',
    async (topP) => {
      const fetch = vi.fn();
      const client = new NebiusClient(CONFIG, { fetch });

      await expect(client.chat('nano', MESSAGES, { topP })).rejects.toThrow(
        'topP must be between 0 and 1',
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('replays canary 33312570131: sends chat_template_kwargs directly', async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse('{"replacement":"fixed"}'));
    const client = new NebiusClient(CONFIG, { fetch });

    await client.chat('super', MESSAGES, {
      maxTokens: 8_192,
      temperature: 1,
      topP: 0.95,
      thinkingMode: 'disabled',
    });

    const [, init] = fetch.mock.calls[0] as [string, HttpRequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: MODELS.super,
      max_tokens: 8_192,
      temperature: 1,
      top_p: 0.95,
      chat_template_kwargs: {
        enable_thinking: false,
        force_nonempty_content: true,
      },
    });
    expect(body).not.toHaveProperty('extra_body');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('supports enabled and low-effort model chat-template modes', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(successResponse())
      .mockResolvedValueOnce(successResponse());
    const client = new NebiusClient(CONFIG, { fetch });

    await client.chat('super', MESSAGES, { thinkingMode: 'enabled' });
    await client.chat('super', MESSAGES, { thinkingMode: 'low-effort' });

    const bodies = fetch.mock.calls.map(([, init]) =>
      JSON.parse((init as HttpRequestInit).body as string),
    );
    expect(bodies[0]).toMatchObject({
      chat_template_kwargs: { enable_thinking: true },
    });
    expect(bodies[0].chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(bodies[1]).toMatchObject({
      chat_template_kwargs: { enable_thinking: true, low_effort: true },
    });
    expect(bodies[1].chat_template_kwargs).toEqual({
      enable_thinking: true, low_effort: true,
    });
  });

  it('rejects conflicting reasoning controls before making a request', async () => {
    const fetch = vi.fn();
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(client.chat('super', MESSAGES, {
      thinkingMode: 'disabled',
      reasoningEffort: 'low',
    })).rejects.toThrow('thinkingMode and reasoningEffort are mutually exclusive');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends a strict JSON Schema request in Token Factory format', async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse('{"fixed":true}'));
    const client = new NebiusClient(CONFIG, { fetch });
    const schema = {
      type: 'object',
      properties: { fixed: { type: 'boolean' } },
      required: ['fixed'],
      additionalProperties: false,
    } as const;

    await client.chat('nano', MESSAGES, {
      maxTokens: 2_048,
      responseFormat: {
        type: 'json_schema',
        jsonSchema: { name: 'repair_result', strict: true, schema },
      },
    });

    const [, init] = fetch.mock.calls[0] as [string, HttpRequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'repair_result', strict: true, schema },
      },
    });
  });

  it('sends required function tools and typed tool messages in Token Factory format', async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse('done'));
    const client = new NebiusClient(CONFIG, { fetch });
    const messages = [
      { role: 'user', content: 'Read the file.' },
      {
        role: 'assistant',
        content: null,
        toolCalls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"src/a.ts"}' },
        }],
      },
      { role: 'tool', toolCallId: 'call_1', content: 'file contents' },
    ] as const;

    await client.chat('nano', messages, {
      maxTokens: 2_048,
      tools: [{
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a repository file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
          strict: true,
        },
      }],
      toolChoice: 'auto',
    });

    const [, init] = fetch.mock.calls[0] as [string, HttpRequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      messages: [
        { role: 'user', content: 'Read the file.' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"src/a.ts"}' },
          }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'file contents' },
      ],
      tools: [expect.objectContaining({
        type: 'function',
        function: expect.objectContaining({ name: 'read_file', strict: true }),
      })],
      tool_choice: 'auto',
    });
    expect(JSON.parse(init.body as string)).not.toHaveProperty('parallel_tool_calls');
  });

  it('rejects a reasoning budget below 2000 tokens before sending a request', async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse());
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(
      client.chat('nano', MESSAGES, { maxTokens: 1_999 }),
    ).rejects.toThrow(/maxTokens must be an integer of at least 2000/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('strips a think prefix from all returned content and meters reasoning output', async () => {
    const raw = '<think>hidden chain of thought</think>\nFinal answer';
    const fetch = vi.fn().mockResolvedValue(successResponse(raw, 16));
    const client = new NebiusClient(CONFIG, { fetch, now: () => 0 });

    const reply = await client.chat('nano', MESSAGES);

    expect(reply).toEqual({
      text: 'Final answer',
      raw: 'Final answer',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inTok: 1_000, outTok: 1_984, reasoningTok: 16 },
      usd: 0.00054,
      capacity: {
        remainingRequests: null,
        remainingTokens: null,
        resetRequestsSec: null,
        resetTokensSec: null,
        dynamicRequestScale: null,
        dynamicTokenScale: null,
        windowUsageRequests: null,
        windowUsageTokens: null,
        retryAfterSec: null,
        requestId: null,
      },
      model: 'nano-model',
      providerModel: null,
      hadThinkPrefix: true,
      reasoningTokensReported: true,
      latencyMs: 0,
      requestId: null,
    });
    expect(client.ledger.entries).toHaveLength(1);
    expect(client.ledger.totalUsd()).toBe(0.00054);
  });

  it('drops a truncated think prefix from all returned content', async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse('<think>hidden chain of thought'));
    const client = new NebiusClient(CONFIG, { fetch });

    const reply = await client.chat('nano', MESSAGES);

    expect(reply.text).toBe('');
    expect(reply.raw).toBe('');
    expect(reply.hadThinkPrefix).toBe(true);
    expect(JSON.stringify(reply)).not.toContain('hidden chain of thought');
  });

  it('preserves safe provider-contract metadata without exposing hidden content', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      model: 'provider/actual-model',
      choices: [{ finish_reason: 'stop', message: { content: 'healthy' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const client = new NebiusClient(CONFIG, { fetch });

    const reply = await client.chat('nano', MESSAGES);

    expect(reply).toMatchObject({
      providerModel: 'provider/actual-model',
      hadThinkPrefix: false,
      reasoningTokensReported: false,
    });
  });

  it('treats null reasoning-token details as not reported', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      choices: [{ finish_reason: 'stop', message: { content: 'healthy' } }],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        completion_tokens_details: null,
      },
    }));
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(client.chat('nano', MESSAGES)).resolves.toMatchObject({
      usage: { inTok: 1, outTok: 1, reasoningTok: 0 },
      reasoningTokensReported: false,
    });
  });

  it('accepts null content only with valid function calls and meters all completion tokens', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [{
            id: 'call_abc-123',
            type: 'function',
            function: { name: 'inspect_diff', arguments: '{"compact":true}' },
          }],
        },
      }],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        completion_tokens_details: { reasoning_tokens: 7 },
      },
    }));
    const client = new NebiusClient(CONFIG, { fetch });

    const reply = await client.chat('nano', MESSAGES);

    expect(reply).toMatchObject({
      text: '',
      raw: null,
      finishReason: 'tool_calls',
      toolCalls: [{
        id: 'call_abc-123',
        type: 'function',
        function: { name: 'inspect_diff', arguments: '{"compact":true}' },
      }],
      usage: { inTok: 120, outTok: 23, reasoningTok: 7 },
    });
    expect(client.ledger.entries[0]).toMatchObject({
      outTok: 23,
      reasoningTok: 7,
    });
  });

  it('rejects null content without tool calls', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      choices: [{ finish_reason: 'stop', message: { content: null } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(client.chat('nano', MESSAGES)).rejects.toThrow(
      /missing message content or valid tool calls/,
    );
  });

  it('rejects omitted content even when tool calls are present', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{}' },
          }],
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(client.chat('nano', MESSAGES)).rejects.toThrow(
      /missing message content/,
    );
  });

  it.each([
    ['missing id', { type: 'function', function: { name: 'read_file', arguments: '{}' } }],
    ['invalid id', { id: 'bad id', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
    ['invalid type', { id: 'call_1', type: 'custom', function: { name: 'read_file', arguments: '{}' } }],
    ['invalid name', { id: 'call_1', type: 'function', function: { name: 'read file', arguments: '{}' } }],
    ['invalid arguments type', { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: {} } }],
    ['invalid arguments JSON', { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{' } }],
    ['non-object arguments', { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '[]' } }],
  ])('rejects a tool call with %s', async (_label, toolCall) => {
    const fetch = vi.fn().mockResolvedValue(response({
      choices: [{
        finish_reason: 'tool_calls',
        message: { content: null, tool_calls: [toolCall] },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(client.chat('nano', MESSAGES)).rejects.toBeInstanceOf(
      NebiusResponseError,
    );
  });

  it('rejects more than 128 tool calls', async () => {
    const toolCalls = Array.from({ length: 129 }, (_, index) => ({
      id: `call_${index}`,
      type: 'function',
      function: { name: 'read_file', arguments: '{}' },
    }));
    const fetch = vi.fn().mockResolvedValue(response({
      choices: [{
        finish_reason: 'tool_calls',
        message: { content: null, tool_calls: toolCalls },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(client.chat('nano', MESSAGES)).rejects.toThrow(/at most 128/);
  });

  it('rejects duplicate tool call ids', async () => {
    const duplicateCall = {
      id: 'call_1',
      type: 'function',
      function: { name: 'read_file', arguments: '{}' },
    };
    const fetch = vi.fn().mockResolvedValue(response({
      choices: [{
        finish_reason: 'tool_calls',
        message: { content: null, tool_calls: [duplicateCall, duplicateCall] },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(client.chat('nano', MESSAGES)).rejects.toThrow(
      /Duplicate tool call id/,
    );
  });

  it('preserves a length finish reason for bounded-output diagnostics', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      choices: [{ finish_reason: 'length', message: { content: '{}' } }],
      usage: {
        prompt_tokens: 1_000,
        completion_tokens: 2_000,
      },
    }));
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(client.chat('super', MESSAGES)).resolves.toMatchObject({
      finishReason: 'length',
    });
  });

  it('retries a 429 response and succeeds after exponential backoff', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response('slow down', 429))
      .mockResolvedValueOnce(successResponse());
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new NebiusClient(CONFIG, { fetch, sleep, random: () => 0 });

    await expect(client.chat('nano', MESSAGES)).resolves.toMatchObject({
      text: 'fixed',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(125);
  });

  it('uses Retry-After before exponential jitter for a 429 response', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response('slow down', 429, { 'Retry-After': '2.5' }))
      .mockResolvedValueOnce(successResponse());
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new NebiusClient(CONFIG, { fetch, sleep, random: () => 0 });

    await client.chat('nano', MESSAGES);

    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(2_500);
  });

  it.each(['-1', 'NaN', '31', '1e100', 'tomorrow'])(
    'ignores invalid or excessive Retry-After value %s',
    async (retryAfter) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(response('slow down', 429, {
          'Retry-After': retryAfter,
        }))
        .mockResolvedValueOnce(successResponse());
      const sleep = vi.fn().mockResolvedValue(undefined);
      const client = new NebiusClient(CONFIG, { fetch, sleep, random: () => 0 });

      await client.chat('nano', MESSAGES);

      expect(sleep).toHaveBeenCalledWith(125);
    },
  );

  it('stops retries at one total 30-second deadline', async () => {
    const fetch = vi.fn().mockResolvedValue(response('slow down', 429, {
      'Retry-After': '20',
    }));
    let now = 1_000;
    const sleep = vi.fn().mockImplementation(async (milliseconds: number) => {
      now += milliseconds;
    });
    const client = new NebiusClient(CONFIG, {
      fetch,
      sleep,
      now: () => now,
      random: () => 0,
    });

    await expect(client.chat('nano', MESSAGES)).rejects.toMatchObject({
      status: 429,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('returns a frozen sanitized capacity snapshot for each response', async () => {
    const first = successResponse();
    first.headers = response({}, 200, {
      'x-ratelimit-remaining-requests': '599',
      'x-ratelimit-remaining-tokens': '399000',
      'x-ratelimit-reset-requests': '0.1',
      'x-ratelimit-reset-tokens': '1.25',
      'x-ratelimit-dynamic-scale-requests': '1.2',
      'x-ratelimit-dynamic-scale-tokens': '1.44',
      'x-ratelimit-dynamic-period-usage-requests': '80',
      'x-ratelimit-dynamic-period-usage-tokens': '50.5',
      'Retry-After': '2',
      'x-request-id': 'req_abc-123',
    }).headers;
    const second = successResponse();
    const fetch = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const client = new NebiusClient(CONFIG, { fetch });

    expect(client.capacitySnapshot()).toBeUndefined();
    const firstReply = await client.chat('nano', MESSAGES);
    expect(client.capacitySnapshot()).toBe(firstReply.capacity);
    const secondReply = await client.chat('nano', MESSAGES);

    expect(firstReply.capacity).toEqual({
      remainingRequests: 599,
      remainingTokens: 399_000,
      resetRequestsSec: 0.1,
      resetTokensSec: 1.25,
      dynamicRequestScale: 1.2,
      dynamicTokenScale: 1.44,
      windowUsageRequests: 80,
      windowUsageTokens: 50.5,
      retryAfterSec: 2,
      requestId: 'req_abc-123',
    });
    expect(Object.isFrozen(firstReply.capacity)).toBe(true);
    expect(secondReply.capacity).not.toBe(firstReply.capacity);
    expect(secondReply.capacity.remainingRequests).toBeNull();
    expect(client.capacitySnapshot()).toBe(secondReply.capacity);
  });

  it('drops malformed capacity headers from the snapshot', async () => {
    const result = successResponse();
    result.headers = response({}, 200, {
      'x-ratelimit-remaining-requests': '-1',
      'x-ratelimit-remaining-tokens': 'Infinity',
      'x-ratelimit-reset-requests': '86401',
      'x-ratelimit-dynamic-scale-requests': '101',
      'x-ratelimit-dynamic-period-usage-tokens': '100.1',
      'Retry-After': '31',
      'x-request-id': 'contains spaces',
    }).headers;
    const client = new NebiusClient(CONFIG, {
      fetch: vi.fn().mockResolvedValue(result),
    });

    const reply = await client.chat('nano', MESSAGES);

    expect(reply.capacity).toEqual({
      remainingRequests: null,
      remainingTokens: null,
      resetRequestsSec: null,
      resetTokensSec: null,
      dynamicRequestScale: null,
      dynamicTokenScale: null,
      windowUsageRequests: null,
      windowUsageTokens: null,
      retryAfterSec: null,
      requestId: null,
    });
  });

  it('stops after three retries of a retryable response', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () => response('upstream unavailable', 503));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new NebiusClient(CONFIG, { fetch, sleep, random: () => 0 });

    await expect(client.chat('nano', MESSAGES)).rejects.toMatchObject({
      name: 'NebiusApiError',
      status: 503,
      body: 'upstream unavailable',
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('surfaces a 401 body verbatim in a typed authentication error', async () => {
    const body = '{"detail":"Invalid API key for this project"}';
    const fetch = vi
      .fn()
      .mockResolvedValue(response(body, 401));
    const client = new NebiusClient(CONFIG, { fetch });

    const error = await client.chat('nano', MESSAGES).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(NebiusApiError);
    expect(error).toMatchObject({ status: 401, body });
    expect((error as Error).message).toContain(body);
    expect((error as Error).message).toContain('authentication failed');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('distinguishes a missing model from an authentication failure', async () => {
    const body = '{"detail":"Model nano-model was not found"}';
    const fetch = vi
      .fn()
      .mockResolvedValue(response(body, 404));
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(client.chat('nano', MESSAGES)).rejects.toThrow(
      `model was not found: ${body}`,
    );
  });

  it('rethrows an aborted transport request without retrying', async () => {
    const controller = new AbortController();
    controller.abort();
    const transportError = new Error('synthetic aborted transport');
    const fetch = vi.fn().mockRejectedValue(transportError);
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(client.chat('nano', MESSAGES, { signal: controller.signal }))
      .rejects.toBe(transportError);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('wraps a synthetic transport failure when retry delay exceeds the deadline', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('synthetic network down'));
    const client = new NebiusClient(CONFIG, {
      fetch,
      now: vi.fn()
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(0)
        .mockReturnValue(30_001),
      random: () => 0,
    });

    await expect(client.chat('nano', MESSAGES)).rejects.toMatchObject({
      name: 'NebiusApiError',
      status: undefined,
      body: 'synthetic network down',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('wraps a synthetic transport failure after all retry attempts', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('synthetic network down'));
    const client = new NebiusClient(CONFIG, {
      fetch,
      sleep: vi.fn().mockResolvedValue(undefined),
      now: () => 0,
      random: () => 0,
    });

    await expect(client.chat('nano', MESSAGES)).rejects.toThrow(/after 4 attempts/u);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['non-object response', null, /non-object response/u],
    ['non-array tool calls', {
      choices: [{ message: { content: null, tool_calls: {} } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }, /message\.tool_calls/u],
    ['non-object tool call', {
      choices: [{ message: { content: null, tool_calls: [null] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }, /tool call at index/u],
    ['oversized tool arguments', {
      choices: [{ message: { content: null, tool_calls: [{
        id: 'call_1', type: 'function', function: { name: 'read_file', arguments: 'x'.repeat(64_001) },
      }] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }, /tool call arguments/u],
    ['invalid content type', {
      choices: [{ message: { content: 1 } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }, /message\.content/u],
    ['negative prompt tokens', {
      choices: [{ message: { content: 'fixed' } }],
      usage: { prompt_tokens: -1, completion_tokens: 1 },
    }, /usage\.prompt_tokens/u],
    ['non-integer completion tokens', {
      choices: [{ message: { content: 'fixed' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1.5 },
    }, /usage\.completion_tokens/u],
    ['invalid reasoning tokens', {
      choices: [{ message: { content: 'fixed' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, completion_tokens_details: { reasoning_tokens: -1 } },
    }, /reasoning_tokens/u],
    ['reasoning exceeds completion', {
      choices: [{ message: { content: 'fixed' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, completion_tokens_details: { reasoning_tokens: 2 } },
    }, /exceed total completion/u],
    ['invalid finish reason', {
      choices: [{ finish_reason: 1, message: { content: 'fixed' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }, /finish_reason/u],
    ['invalid provider model', {
      model: '',
      choices: [{ message: { content: 'fixed' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }, /Invalid model/u],
  ] as const)('rejects synthetic provider shape: %s', async (_label, body, message) => {
    const client = new NebiusClient(CONFIG, { fetch: vi.fn().mockResolvedValue(response(body)) });
    await expect(client.chat('nano', MESSAGES)).rejects.toThrow(message);
  });

  it('preserves the labeled synthetic live-16 reasoning_effort none error body', async () => {
    const body = (await readFile(new URL(
      '../__fixtures__/captured/provider/error-shapes/live-16-reasoning-effort-none.synthetic.json',
      import.meta.url,
    ), 'utf8')).trim();
    const client = new NebiusClient(CONFIG, { fetch: vi.fn().mockResolvedValue(response(body, 400)) });

    await expect(client.chat('super', MESSAGES)).rejects.toMatchObject({ status: 400, body });
  });
});


describe('development adaptive dispatch', () => {
  function adaptiveClient() {
    const fetch = vi.fn().mockResolvedValue(successResponse());
    return { fetch, client: new NebiusClient({ ...CONFIG, routingProfileId: 'development-adaptive-v1' }, { fetch }) };
  }
  const messages = [{ role: 'user' as const, content: 'repair' }];
  function options(): ChatOptions {
    return { maxTokens: 2_000, purpose: 'repair', routing: {
      failureClass: null, diagnosisConfidence: 0.95, remainingInferenceBudgetUsd: 1,
      targetCount: 1, priorRepairFeedback: true, runScope: {},
    } };
  }
  it('quotes without spending escalation and scopes the one dispatch cap to a run', async () => {
    const { client, fetch } = adaptiveClient();
    const request = options();
    const first = client.modelQuote('super', messages, request);
    expect(first.role).toBe('ultra');
    expect(client.modelQuote('super', messages, request)).toEqual(first);
    await client.chat('super', messages, { ...request, quotedRoute: first });
    expect(client.modelQuote('super', messages, request).role).toBe('super');
    expect(client.modelQuote('super', messages, options()).role).toBe('ultra');
    await expect(client.chat('super', messages, { ...request, quotedRoute: first })).rejects.toThrow(/quote/u);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('refuses unaffordable required adjudication before fetching', async () => {
    const { client, fetch } = adaptiveClient();
    const request = options();
    request.purpose = 'adjudication';
    request.routing!.remainingInferenceBudgetUsd = 0;
    await expect(client.chat('ultra', messages, request)).rejects.toThrow(/abstained/u);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not clamp an oversized prompt to the context ceiling', async () => {
    const { client, fetch } = adaptiveClient();
    await expect(client.chat('super', [{ role: 'user', content: 'x'.repeat(130_000) }], options())).rejects.toThrow(/abstained/u);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('includes schema and tools in the context bound', async () => {
    const { client, fetch } = adaptiveClient();
    const request = options();
    request.responseFormat = { type: 'json_schema', jsonSchema: { name: 'big', strict: true, schema: { description: 'x'.repeat(130_000) } } };
    await expect(client.chat('super', messages, request)).rejects.toThrow(/abstained/u);
    expect(fetch).not.toHaveBeenCalled();
  });
});
