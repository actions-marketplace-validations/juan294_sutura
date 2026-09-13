import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_MODELS, TOKEN_FACTORY_BASE_URL } from '../config.js';
import { createTokenFactoryClient } from './token-factory.js';
import type { HttpResponse } from './nebius.js';

function response(): HttpResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    async json() {
      return {
        choices: [{ finish_reason: 'stop', message: { content: 'healthy' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      };
    },
    async text() {
      return '';
    },
  };
}

describe('createTokenFactoryClient', () => {
  it('owns the production endpoint, model defaults, prices, and credential normalization', async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    const client = createTokenFactoryClient({ apiKey: '  test-key  ' }, { fetch });

    expect(client.modelId('nano')).toBe(DEFAULT_MODELS.nano);
    expect(client.modelId('super')).toBe(DEFAULT_MODELS.super);
    expect(client.modelId('ultra')).toBe(DEFAULT_MODELS.ultra);

    await client.chat('super', [{ role: 'user', content: 'health check' }], {
      maxTokens: 2_000,
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe(`${TOKEN_FACTORY_BASE_URL}chat/completions`);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer test-key' },
    });
    expect(client.ledger.totalUsd()).toBeGreaterThan(0);
  });

  it('accepts configured Nano and Ultra ids while preserving the verified Super contract', () => {
    const client = createTokenFactoryClient({
      apiKey: 'test-key',
      models: {
        nano: 'example/nano',
        super: DEFAULT_MODELS.super,
        ultra: 'example/ultra',
      },
    }, { fetch: vi.fn() });

    expect(client.modelId('nano')).toBe('example/nano');
    expect(client.modelId('super')).toBe(DEFAULT_MODELS.super);
    expect(client.modelId('ultra')).toBe('example/ultra');
  });

  it('rejects an empty key or an unverified Super model before any request', () => {
    expect(() => createTokenFactoryClient({ apiKey: '  ' }, { fetch: vi.fn() }))
      .toThrow(/apiKey is required/u);
    expect(() => createTokenFactoryClient({
      apiKey: 'test-key',
      models: { ...DEFAULT_MODELS, super: 'example/unverified-super' },
    }, { fetch: vi.fn() })).toThrow(/verified Super model/u);
  });

  it('rejects an unverified routing profile before any request', () => {
    expect(() => createTokenFactoryClient({
      apiKey: 'test-key',
      routingProfileId: 'unverified-profile',
    }, { fetch: vi.fn() })).toThrow(/verified routing profile/u);
  });
});


it('selects the frozen development adaptive profile without changing defaults', async () => {
  const fetch = vi.fn().mockResolvedValue(response());
  const client = createTokenFactoryClient({ apiKey: 'test-key', routingProfileId: 'development-adaptive-v1' }, { fetch });
  const messages = [{ role: 'user' as const, content: 'Fix one target' }];
  const options = { maxTokens: 2_000, purpose: 'repair' as const, routing: {
    failureClass: null, diagnosisConfidence: 0.95, remainingInferenceBudgetUsd: 1,
    targetCount: 1, runScope: {},
  } };
  const quote = client.modelQuote('super', messages, options);
  expect(quote.role).toBe('nano');
  expect(client.modelQuote('super', messages, options)).toEqual(quote);
  await client.chat('super', messages, { ...options, quotedRoute: quote });
  expect(JSON.parse(fetch.mock.calls[0]![1].body).model).toBe(quote.modelId);
  expect(client.ledger.entries[0]?.role).toBe('nano');
});

it('does not treat an unverified model override as an adaptive contract', () => {
  expect(() => createTokenFactoryClient({ apiKey: 'test-key', routingProfileId: 'development-adaptive-v1', models: {
    ...DEFAULT_MODELS, nano: 'example/unverified',
  } }, { fetch: vi.fn() })).toThrow(/verified model/u);
});
