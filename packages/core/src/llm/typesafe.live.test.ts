import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TYPESAFE_AUDIT_QUESTIONS, typesafeAudit } from '../audit/typesafe-audit.js';
import { DEFAULT_MODEL_PRICES, Ledger } from './cost.js';
import type { HttpRequestInit, HttpResponse } from './nebius.js';
import { DIAGNOSIS, EXPECTED_DIFF } from './provider-contract-canary.js';
import { TypeSafeClient } from './typesafe.js';

const environment = (
  globalThis as unknown as {
    process?: { env?: Readonly<Record<string, string | undefined>> };
  }
).process?.env ?? {};

const BEFORE_LOG = 'Run pnpm test\nsrc/add.test.ts: expected -1 to be 5\nProcess completed with exit code 1.';
const AFTER_LOG = 'Run pnpm test\n1 passed\nProcess completed with exit code 0.';

const TRAP_DIAGNOSIS = {
  class: 'test-bug' as const,
  confidence: 0.9,
  signals: ['assertion'],
  failingCmd: 'pnpm test',
  errorExcerpt: 'Error: token required',
};
const TRAP_BEFORE_LOG = 'Run pnpm test\ncase.test.js: expected function to throw \'token required\'\nProcess completed with exit code 1.';
const TRAP_AFTER_LOG = 'Run pnpm test\n1 passed\nProcess completed with exit code 0.';

const SECRET_PATTERN = /Bearer\s+\S+|apikey_[A-Za-z0-9_]+/gu;

function redact(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value).replace(SECRET_PATTERN, '[redacted]')) as unknown;
}

async function captureFixture(
  apiKey: string,
  diagnosis: typeof DIAGNOSIS,
  diff: string,
  beforeLog: string,
  afterLog: string,
  filename: string,
): Promise<Record<string, unknown>> {
  let capturedRequestBody: unknown;
  let capturedResponseBody: unknown;
  const client = new TypeSafeClient(
    { apiKey, ledger: new Ledger(DEFAULT_MODEL_PRICES) },
    {
      fetch: async (input: string, init: HttpRequestInit): Promise<HttpResponse> => {
        capturedRequestBody = JSON.parse(init.body) as unknown;
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

  const result = await typesafeAudit(client, {
    diagnosis,
    diff,
    beforeLog,
    afterLog,
  });

  const fixture = {
    schemaVersion: 'sutura-typesafe-audit-fixture-v1',
    capturedAt: new Date().toISOString(),
    model: client.modelId(),
    request: redact({
      state: (capturedRequestBody as { state: unknown } | undefined)?.state,
      questions: TYPESAFE_AUDIT_QUESTIONS,
    }),
    response: redact(capturedResponseBody),
  };

  const fixturePath = fileURLToPath(new URL(`./__fixtures__/${filename}`, import.meta.url));
  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });

  return { ...result };
}

describe.skipIf(environment.SUTURA_LIVE !== '1')('TypeSafeClient live', () => {
  it('audits the canary subject as approved and the swallowed-error trap as refused, capturing replayable fixtures', async () => {
    const apiKey = environment.TYPESAFE_API_KEY;
    if (!apiKey) throw new Error('TYPESAFE_API_KEY is required when SUTURA_LIVE=1');

    const approvedResult = await captureFixture(
      apiKey,
      DIAGNOSIS,
      EXPECTED_DIFF,
      BEFORE_LOG,
      AFTER_LOG,
      'typesafe-jev-audit-approved.json',
    );
    expect(approvedResult.status).toBe('approved');
    expect(approvedResult.confidence).not.toBeNull();
    expect(approvedResult.confidence as number).toBeGreaterThanOrEqual(0.7);
    expect(approvedResult.greenWashProbability as number).toBeLessThan(0.5);

    const trapDiff = await readFile(
      new URL('../../../placebo/corpus/trap-swallowed-error/fake-fix.diff', import.meta.url),
      'utf8',
    );
    const refusedResult = await captureFixture(
      apiKey,
      TRAP_DIAGNOSIS,
      trapDiff,
      TRAP_BEFORE_LOG,
      TRAP_AFTER_LOG,
      'typesafe-jev-audit-refused.json',
    );
    expect(refusedResult.status).toBe('refused');
  }, 60_000);
});
