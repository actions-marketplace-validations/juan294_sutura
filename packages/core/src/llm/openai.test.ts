import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_MODEL_PRICES, Ledger } from './cost.js';
import type { HttpRequestInit, HttpResponse, NebiusClientDependencies } from './nebius.js';
import {
  OpenAiApiError,
  OpenAiClient,
  SECOND_OPINION_MODEL,
  SECOND_OPINION_PRICE,
} from './openai.js';

const MESSAGES = [{ role: 'user' as const, content: 'Diagnose this.' }];

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

function successResponse(content = '{"approved":true,"reasoning":"Fixes the diagnosed cause."}', reasoningTokens = 0): HttpResponse {
  return response({
    choices: [{ finish_reason: 'stop', message: { content } }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      completion_tokens_details: { reasoning_tokens: reasoningTokens },
    },
  });
}

function requestBody(fetch: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  const init = fetch.mock.calls[call]?.[1] as HttpRequestInit;
  return JSON.parse(init.body) as Record<string, unknown>;
}

function client(dependencies: NebiusClientDependencies = {}): OpenAiClient {
  return new OpenAiClient({ apiKey: 'sk-test', ledger: new Ledger(DEFAULT_MODEL_PRICES) }, dependencies);
}

describe('OpenAiClient', () => {
  it('sends no temperature or top_p, defaults reasoning_effort to low, and sets response_format when requested', async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse());
    await client({ fetch }).chat('ultra', MESSAGES, { responseFormat: { type: 'json_object' } });

    const body = requestBody(fetch);
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body.reasoning_effort).toBe('low');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.model).toBe(SECOND_OPINION_MODEL);
    expect(body.max_completion_tokens).toBe(4_096);
  });

  it('omits response_format when the caller did not request one', async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse());
    await client({ fetch }).chat('ultra', MESSAGES);

    expect(requestBody(fetch)).not.toHaveProperty('response_format');
  });

  it('honors an explicit reasoningEffort override', async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse());
    await client({ fetch }).chat('ultra', MESSAGES, { reasoningEffort: 'high' });

    expect(requestBody(fetch).reasoning_effort).toBe('high');
  });

  it('records usage on the ledger as an ultra gpt-6-astra entry at the Astra price', async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse());
    const ledger = new Ledger(DEFAULT_MODEL_PRICES);
    const reply = await new OpenAiClient({ apiKey: 'sk-test', ledger }, { fetch }).chat('ultra', MESSAGES);

    const expectedUsd = (100 * SECOND_OPINION_PRICE.input + 50 * SECOND_OPINION_PRICE.output) / 1_000_000;
    expect(ledger.entries).toEqual([{
      role: 'ultra',
      model: SECOND_OPINION_MODEL,
      inTok: 100,
      outTok: 50,
      reasoningTok: 0,
      usd: expectedUsd,
    }]);
    expect(reply.usd).toBe(expectedUsd);
    expect(reply.usage).toEqual({ inTok: 100, outTok: 50, reasoningTok: 0 });
  });

  it('retries a 429 response honoring Retry-After', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response('slow down', 429, { 'Retry-After': '2.5' }))
      .mockResolvedValueOnce(successResponse());
    const sleep = vi.fn().mockResolvedValue(undefined);

    await client({ fetch, sleep, random: () => 0 }).chat('ultra', MESSAGES);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_500);
  });

  it('retries a 5xx response', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response('upstream unavailable', 503))
      .mockResolvedValueOnce(successResponse());
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(client({ fetch, sleep, random: () => 0 }).chat('ultra', MESSAGES))
      .resolves.toMatchObject({ finishReason: 'stop' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 4xx response', async () => {
    const body = '{"detail":"Invalid API key for this project"}';
    const fetch = vi.fn().mockResolvedValue(response(body, 401));

    const error = await client({ fetch }).chat('ultra', MESSAGES).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(OpenAiApiError);
    expect(error).toMatchObject({ status: 401, body });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('parses the captured live fixture', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('./__fixtures__/openai-gpt-6-astra-adjudication.json', import.meta.url), 'utf8'),
    ) as { response: unknown };
    const fetch = vi.fn().mockResolvedValue(response(fixture.response));

    const reply = await client({ fetch }).chat('ultra', MESSAGES);

    expect(reply.text.trim().length).toBeGreaterThan(0);
    expect(JSON.parse(reply.text)).toMatchObject({ approved: true });
    expect(reply.usage?.inTok).toBeGreaterThan(0);
    expect((reply.usage?.outTok ?? 0) + (reply.usage?.reasoningTok ?? 0)).toBeGreaterThan(0);
  });
});
