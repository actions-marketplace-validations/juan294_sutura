import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { calculateModelCostUsd, DEFAULT_MODEL_PRICES, Ledger } from './cost.js';
import type { HttpRequestInit, HttpResponse, NebiusClientDependencies } from './nebius.js';
import {
  TYPESAFE_AUDIT_MODEL,
  TYPESAFE_PRICE,
  TypeSafeApiError,
  TypeSafeClient,
  TypeSafeResponseError,
  type TypeSafeQuestion,
} from './typesafe.js';

const QUESTIONS: Record<string, TypeSafeQuestion> = {
  verdict: {
    type: 'choice',
    instructions: 'Decide.',
    criteria: { legitimate_repair: 'ok', green_wash: 'not ok' },
  },
  touches_only_tests: { type: 'noul', instructions: 'Only tests?' },
};

const STATE = { diagnosis: 'test-assertion', candidateDiff: 'diff --git a/x b/x\n' };

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

function successBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: TYPESAFE_AUDIT_MODEL,
    answers: {
      verdict: { choice: 'legitimate_repair', probabilities: { legitimate_repair: 0.9, green_wash: 0.1 }, confidence: 0.95 },
      touches_only_tests: { noul: 0.02 },
    },
    usage: { input_tokens: 900, output_tokens: 0 },
    ...overrides,
  };
}

function requestBody(fetch: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  const init = fetch.mock.calls[call]?.[1] as HttpRequestInit;
  return JSON.parse(init.body) as Record<string, unknown>;
}

function client(dependencies: NebiusClientDependencies = {}, ledger = new Ledger(DEFAULT_MODEL_PRICES)): TypeSafeClient {
  return new TypeSafeClient({ apiKey: 'ts-test', ledger }, dependencies);
}

describe('TypeSafeClient', () => {
  it('sends { state, model, questions } with the bearer header', async () => {
    const fetch = vi.fn().mockResolvedValue(response(successBody()));
    await client({ fetch }).decide(STATE, QUESTIONS);

    const body = requestBody(fetch);
    expect(body).toEqual({ state: STATE, model: TYPESAFE_AUDIT_MODEL, questions: QUESTIONS });
    const init = fetch.mock.calls[0]?.[1] as HttpRequestInit;
    expect(init.headers.Authorization).toBe('Bearer ts-test');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.typesafe.ai/v1/systemone');
  });

  it('records usage on the ledger as an ultra jev-latest entry at the Jev price', async () => {
    const fetch = vi.fn().mockResolvedValue(response(successBody()));
    const ledger = new Ledger(DEFAULT_MODEL_PRICES);
    const decision = await client({ fetch }, ledger).decide(STATE, QUESTIONS);

    const expectedUsd = calculateModelCostUsd(TYPESAFE_PRICE, { inTok: 900, outTok: 0, reasoningTok: 0 });
    expect(ledger.entries).toEqual([{
      role: 'ultra',
      model: TYPESAFE_AUDIT_MODEL,
      inTok: 900,
      outTok: 0,
      reasoningTok: 0,
      usd: expectedUsd,
    }]);
    expect(decision.usd).toBe(expectedUsd);
    expect(decision.usage).toEqual({ inTok: 900, outTok: 0, reasoningTok: 0 });
    expect(decision.model).toBe(TYPESAFE_AUDIT_MODEL);
    expect(decision.answers.verdict).toEqual({
      type: 'choice',
      choice: 'legitimate_repair',
      probabilities: { legitimate_repair: 0.9, green_wash: 0.1 },
      confidence: 0.95,
    });
    expect(decision.answers.touches_only_tests).toEqual({ type: 'noul', noul: 0.02 });
  });

  it('reads the request id from the x-request-id header when present', async () => {
    const fetch = vi.fn().mockResolvedValue(response(successBody(), 200, { 'x-request-id': 'req-123' }));
    const decision = await client({ fetch }).decide(STATE, QUESTIONS);
    expect(decision.requestId).toBe('req-123');
  });

  it('reports a null request id when the header is absent', async () => {
    const fetch = vi.fn().mockResolvedValue(response(successBody()));
    const decision = await client({ fetch }).decide(STATE, QUESTIONS);
    expect(decision.requestId).toBeNull();
  });

  it('retries a 429 response honoring Retry-After', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response('slow down', 429, { 'Retry-After': '2.5' }))
      .mockResolvedValueOnce(response(successBody()));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await client({ fetch, sleep, random: () => 0 }).decide(STATE, QUESTIONS);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_500);
  });

  it('retries a 5xx response', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response('upstream unavailable', 503))
      .mockResolvedValueOnce(response(successBody()));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(client({ fetch, sleep, random: () => 0 }).decide(STATE, QUESTIONS))
      .resolves.toMatchObject({ model: TYPESAFE_AUDIT_MODEL });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 4xx response', async () => {
    const body = '{"detail":"Invalid API key"}';
    const fetch = vi.fn().mockResolvedValue(response(body, 401));

    const error = await client({ fetch }).decide(STATE, QUESTIONS).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(TypeSafeApiError);
    expect(error).toMatchObject({ status: 401, body });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('retries a transport error then throws TypeSafeApiError once retries are exhausted', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const error = await client({ fetch, sleep, random: () => 0 }).decide(STATE, QUESTIONS).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(TypeSafeApiError);
    expect(fetch).toHaveBeenCalledTimes(4);
  }, 30_000);

  it.each([
    ['an out-of-range probability', { verdict: { choice: 'legitimate_repair', probabilities: { legitimate_repair: -0.2, green_wash: 1.2 }, confidence: 0.9 }, touches_only_tests: { noul: 0.02 } }],
    ['a choice not present in its probabilities', { verdict: { choice: 'unknown_option', probabilities: { legitimate_repair: 0.9, green_wash: 0.1 }, confidence: 0.9 }, touches_only_tests: { noul: 0.02 } }],
  ])('throws TypeSafeResponseError for %s', async (_label, answers) => {
    const fetch = vi.fn().mockResolvedValue(response(successBody({ answers })));
    const error = await client({ fetch }).decide(STATE, QUESTIONS).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(TypeSafeResponseError);
  });

  it('throws TypeSafeResponseError when usage is missing', async () => {
    const fetch = vi.fn().mockResolvedValue(response(successBody({ usage: undefined })));
    const error = await client({ fetch }).decide(STATE, QUESTIONS).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(TypeSafeResponseError);
  });

  it.each([
    ['approved', 'typesafe-jev-audit-approved.json'],
    ['refused', 'typesafe-jev-audit-refused.json'],
  ])('parses the captured %s live fixture', async (_label, filename) => {
    const fixture = JSON.parse(
      await readFile(new URL(`./__fixtures__/${filename}`, import.meta.url), 'utf8'),
    ) as { request: { questions: Record<string, TypeSafeQuestion> }; response: unknown };
    const fetch = vi.fn().mockResolvedValue(response(fixture.response));
    const ledger = new Ledger(DEFAULT_MODEL_PRICES);

    const decision = await client({ fetch }, ledger).decide(STATE, fixture.request.questions);

    expect(decision.model.length).toBeGreaterThan(0);
    expect(decision.usage.inTok).toBeGreaterThan(0);
    expect(decision.usd).toBe(calculateModelCostUsd(TYPESAFE_PRICE, decision.usage));
    expect(ledger.entries).toEqual([{
      role: 'ultra',
      model: TYPESAFE_AUDIT_MODEL,
      ...decision.usage,
      usd: decision.usd,
    }]);
  });
});
