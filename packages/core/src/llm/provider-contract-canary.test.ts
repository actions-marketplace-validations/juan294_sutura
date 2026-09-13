import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_MODELS, TOKEN_FACTORY_BASE_URL } from '../config.js';
import {
  SUPER_REPAIR_PROVIDER_CONTRACT_VERSION,
  runSuperRepairProviderContractCanary,
} from './provider-contract-canary.js';
import type { HttpRequestInit, HttpResponse } from './nebius.js';

const FIXED_SOURCE = [
  'export function add(left: number, right: number): number {',
  '  return left + right;',
  '}',
  '',
].join('\n');

function response(
  content: string,
  finishReason = 'stop',
  usage: Record<string, unknown> = {
    prompt_tokens: 321,
    completion_tokens: 17,
    completion_tokens_details: { reasoning_tokens: 0 },
  },
): HttpResponse {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name: string) {
        return name.toLowerCase() === 'x-request-id' ? 'canary-request-1' : null;
      },
    },
    async json() {
      return {
        model: DEFAULT_MODELS.super,
        choices: [{ finish_reason: finishReason, message: { content } }],
        usage,
      };
    },
    async text() {
      return '';
    },
  };
}

describe('Super repair provider-contract canary', () => {
  it('pins the force-nonempty contract version', () => {
    expect(SUPER_REPAIR_PROVIDER_CONTRACT_VERSION).toBe('sutura-super-repair-v5');
  });

  it('rejects an empty provider credential before constructing the client', async () => {
    await expect(runSuperRepairProviderContractCanary(
      { apiKey: '  ' },
      { fetch: vi.fn() },
    )).rejects.toThrow(/NEBIUS_API_KEY is required/u);
  });
  it('uses the exact production endpoint, model, serializer, and one-field repair contract', async () => {
    const fetch = vi.fn().mockResolvedValue(response(JSON.stringify({ replacement: FIXED_SOURCE })));

    const result = await runSuperRepairProviderContractCanary(
      { apiKey: 'test-key' },
      { fetch },
    );

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as [string, HttpRequestInit];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(url).toBe(`${TOKEN_FACTORY_BASE_URL}chat/completions`);
    expect(body).toMatchObject({
      model: DEFAULT_MODELS.super,
      max_tokens: 8_192,
      temperature: 1,
      top_p: 0.95,
      chat_template_kwargs: {
        enable_thinking: false,
        force_nonempty_content: true,
      },
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'sutura_repair_proposal',
          strict: true,
          schema: {
            type: 'object',
            properties: { replacement: { type: 'string', maxLength: 1_000 } },
            required: ['replacement'],
            additionalProperties: false,
          },
        },
      },
    });
    expect(body).not.toHaveProperty('extra_body');
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body).not.toHaveProperty('parallel_tool_calls');
    expect(body).not.toHaveProperty('tool_choice');
    expect(body).not.toHaveProperty('tools');
    expect(result).toMatchObject({
      contractVersion: SUPER_REPAIR_PROVIDER_CONTRACT_VERSION,
      endpoint: `${TOKEN_FACTORY_BASE_URL}chat/completions`,
      model: DEFAULT_MODELS.super,
      finishReason: 'stop',
      usage: { inTok: 321, outTok: 17, reasoningTok: 0 },
      replacementCodePoints: FIXED_SOURCE.length,
      requestId: 'canary-request-1',
    });
    expect(result.replacementSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('fails when the provider does not return a normal stop finish reason', async () => {
    const fetch = vi.fn().mockResolvedValue(response(
      JSON.stringify({ replacement: FIXED_SOURCE }),
      'length',
    ));

    await expect(runSuperRepairProviderContractCanary(
      { apiKey: 'test-key' },
      { fetch },
    )).rejects.toThrow(/finish_reason length/u);
  });

  it('fails when the provider reports a model other than the exact requested Super id', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ...response(JSON.stringify({ replacement: FIXED_SOURCE })),
      async json() {
        return {
          model: 'provider/routed-somewhere-else',
          choices: [{
            finish_reason: 'stop',
            message: { content: JSON.stringify({ replacement: FIXED_SOURCE }) },
          }],
          usage: {
            prompt_tokens: 321,
            completion_tokens: 17,
            completion_tokens_details: { reasoning_tokens: 0 },
          },
        };
      },
    });

    await expect(runSuperRepairProviderContractCanary(
      { apiKey: 'test-key' },
      { fetch },
    )).rejects.toThrow(/returned model provider\/routed-somewhere-else/u);
  });

  it('fails when the provider returns a schema-breaking oversized replacement', async () => {
    const fetch = vi.fn().mockResolvedValue(response(JSON.stringify({
      replacement: 'x'.repeat(1_001),
    })));

    await expect(runSuperRepairProviderContractCanary(
      { apiKey: 'test-key' },
      { fetch },
    )).rejects.toThrow(/provider contract canary failed/u);
  });

  it('fails when required token usage is absent', async () => {
    const fetch = vi.fn().mockResolvedValue(response(
      JSON.stringify({ replacement: FIXED_SOURCE }),
      'stop',
      {},
    ));

    await expect(runSuperRepairProviderContractCanary(
      { apiKey: 'test-key' },
      { fetch },
    )).rejects.toThrow(/usage.prompt_tokens/u);
  });

  it('fails when thinking-off still reports hidden reasoning tokens', async () => {
    const fetch = vi.fn().mockResolvedValue(response(
      JSON.stringify({ replacement: FIXED_SOURCE }),
      'stop',
      {
        prompt_tokens: 321,
        completion_tokens: 17,
        completion_tokens_details: { reasoning_tokens: 2 },
      },
    ));

    await expect(runSuperRepairProviderContractCanary(
      { apiKey: 'test-key' },
      { fetch },
    )).rejects.toThrow(/reasoning tokens/u);
  });

  it('fails when thinking-off returns a think prefix even with zero reasoning tokens', async () => {
    const fetch = vi.fn().mockResolvedValue(response(
      `<think>hidden reasoning</think>${JSON.stringify({ replacement: FIXED_SOURCE })}`,
    ));

    await expect(runSuperRepairProviderContractCanary(
      { apiKey: 'test-key' },
      { fetch },
    )).rejects.toThrow(/think prefix/u);
  });

  it('fails closed when an invalid first response would trigger a valid retry', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response('<think>hidden reasoning</think>not json'))
      .mockResolvedValueOnce(response(JSON.stringify({ replacement: FIXED_SOURCE })));

    await expect(runSuperRepairProviderContractCanary(
      { apiKey: 'test-key' },
      { fetch },
    )).rejects.toThrow(/expected exactly one response, received 2/u);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('replays canary 33314221139: accepts omitted zero-reasoning details', async () => {
    const fetch = vi.fn().mockResolvedValue(response(
      JSON.stringify({ replacement: FIXED_SOURCE }),
      'stop',
      { prompt_tokens: 321, completion_tokens: 17 },
    ));

    await expect(runSuperRepairProviderContractCanary(
      { apiKey: 'test-key' },
      { fetch },
    )).resolves.toMatchObject({
      usage: { inTok: 321, outTok: 17, reasoningTok: 0 },
    });
  });

  it('rejects a non-canonical arithmetic replacement', async () => {
    const fetch = vi.fn().mockResolvedValue(response(JSON.stringify({
      replacement: FIXED_SOURCE.replace('left + right', 'right + left'),
    })));

    await expect(runSuperRepairProviderContractCanary(
      { apiKey: 'test-key' },
      { fetch },
    )).rejects.toThrow(/provider contract canary failed/u);
  });

  it.each([
    ['CRLF line endings', FIXED_SOURCE.replaceAll('\n', '\r\n')],
    ['a missing final newline', FIXED_SOURCE.trimEnd()],
  ])('replays canary 33315587765: accepts normalized %s', async (_label, replacement) => {
    const fetch = vi.fn().mockResolvedValue(response(JSON.stringify({ replacement })));

    await expect(runSuperRepairProviderContractCanary(
      { apiKey: 'test-key' },
      { fetch },
    )).resolves.toMatchObject({
      replacementCodePoints: [...FIXED_SOURCE].length,
      replacementSha256: createHash('sha256').update(FIXED_SOURCE).digest('hex'),
    });
  });

  it.each([
    ['prompt', { prompt_tokens: 0, completion_tokens: 17, completion_tokens_details: { reasoning_tokens: 0 } }],
    ['completion', { prompt_tokens: 321, completion_tokens: 0, completion_tokens_details: { reasoning_tokens: 0 } }],
  ])('fails when %s token usage is zero', async (_label, usage) => {
    const fetch = vi.fn().mockResolvedValue(response(
      JSON.stringify({ replacement: FIXED_SOURCE }),
      'stop',
      usage,
    ));

    await expect(runSuperRepairProviderContractCanary(
      { apiKey: 'test-key' },
      { fetch },
    )).rejects.toThrow(/empty token usage/u);
  });
});
