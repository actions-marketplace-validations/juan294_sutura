import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { adjudicate } from '../audit/adjudicate.js';
import { DEFAULT_MODEL_PRICES, Ledger } from './cost.js';
import type { HttpRequestInit, HttpResponse } from './nebius.js';
import { OpenAiClient } from './openai.js';
import { DIAGNOSIS, EXPECTED_DIFF } from './provider-contract-canary.js';

const environment = (
  globalThis as unknown as {
    process?: { env?: Readonly<Record<string, string | undefined>> };
  }
).process?.env ?? {};

const FIXTURE_PATH = fileURLToPath(
  new URL('./__fixtures__/openai-gpt-6-astra-adjudication.json', import.meta.url),
);

const BEFORE_LOG = 'Run pnpm test\nsrc/add.test.ts: expected -1 to be 5\nProcess completed with exit code 1.';
const AFTER_LOG = 'Run pnpm test\n1 passed\nProcess completed with exit code 0.';

const SECRET_PATTERN = /Bearer\s+\S+|\bsk-[A-Za-z0-9]{8,}/gu;

function redact(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value).replace(SECRET_PATTERN, '[redacted]')) as unknown;
}

describe.skipIf(environment.SUTURA_LIVE !== '1')('OpenAiClient live', () => {
  it('passes the exact production Astra adjudication provider-contract canary and captures a replayable fixture', async () => {
    const apiKey = environment.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is required when SUTURA_LIVE=1');

    let capturedResponseBody: unknown;
    const client = new OpenAiClient(
      { apiKey, ledger: new Ledger(DEFAULT_MODEL_PRICES) },
      {
        fetch: async (input: string, init: HttpRequestInit): Promise<HttpResponse> => {
          const response = await fetch(input, init as RequestInit);
          const text = await response.text();
          capturedResponseBody = JSON.parse(text) as unknown;
          return {
            ok: response.ok,
            status: response.status,
            headers: { get: (name: string) => response.headers.get(name) },
            json: async () => JSON.parse(text) as unknown,
            text: async () => text,
          };
        },
      },
    );

    const result = await adjudicate(client, {
      diagnosis: DIAGNOSIS,
      diff: EXPECTED_DIFF,
      beforeLog: BEFORE_LOG,
      afterLog: AFTER_LOG,
    });

    expect(result.approved).toBe(true);
    expect(result.reasoning.trim().length).toBeGreaterThan(0);

    const fixture = {
      schemaVersion: 'sutura-openai-adjudication-fixture-v1',
      capturedAt: new Date().toISOString(),
      model: client.modelId(),
      response: redact(capturedResponseBody),
    };
    await mkdir(dirname(FIXTURE_PATH), { recursive: true });
    await writeFile(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  }, 60_000);
});
