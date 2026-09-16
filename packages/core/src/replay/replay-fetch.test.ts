import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { RecordedCallCursor } from './recorded-call-cursor.js';
import { ReplayMismatchError, replayFetch } from './replay-fetch.js';
import type { ReplayBundle } from './bundle.js';

function bundle(): ReplayBundle {
  return {
    schemaVersion: 'sutura-replay-v1', runId: '1', repo: 'owner/repo',
    actionSha: 'a'.repeat(40), capturedAt: '2026-08-30T00:00:00.000Z',
    github: [], repository: [], executor: [],
    http: [{
      boundary: 'nebius', sequence: 1,
      request: {
        method: 'POST', url: 'https://example.test/chat', headers: {},
        body: '{"b":2,"a":1}',
      },
      response: {
        status: 200, headers: { 'content-type': 'application/json' },
        body: {
          raw: true, encoding: 'base64',
          data: Buffer.from('{"answer":42}').toString('base64'),
          bytes: 13,
          sha256: '0'.repeat(64),
        },
      },
      latencyMs: 1,
    }],
    configuration: {
      triageN: 1, raceK: 1,
      models: { nano: 'nano', super: 'super', ultra: 'ultra' },
      routingProfileId: 'test', maxOps: 1,
    },
    completeness: { complete: false, overflowedBoundaries: [], pendingBoundaries: [] },
  };
}

describe('replayFetch', () => {
  it('matches canonical JSON and returns recorded raw bytes', async () => {
    const fetch = replayFetch(bundle(), 'nebius');
    const response = await fetch('https://example.test/chat', {
      method: 'POST', headers: {}, body: '{"a":1,"b":2}',
    });
    await expect(response.json()).resolves.toEqual({ answer: 42 });
  });

  it('replays the openai boundary the same way as nebius', async () => {
    const openaiBundle = bundle();
    openaiBundle.http[0]!.boundary = 'openai';
    const fetch = replayFetch(openaiBundle, 'openai');
    const response = await fetch('https://example.test/chat', {
      method: 'POST', headers: {}, body: '{"a":1,"b":2}',
    });
    await expect(response.json()).resolves.toEqual({ answer: 42 });
  });

  it('treats a recorded json_schema request and a live json_object request as the same request', async () => {
    // Bundles captured before 2026-09-16 carry json_schema; the live path now sends json_object.
    const recorded = {
      model: 'super', messages: [{ role: 'user', content: 'repair' }],
      response_format: { type: 'json_schema', json_schema: { name: 'sutura_repair_proposal', strict: true, schema: { type: 'object' } } },
    };
    const drifted = bundle();
    drifted.http[0]!.request.body = JSON.stringify(recorded);
    const response = await replayFetch(drifted, 'nebius')('https://example.test/chat', {
      method: 'POST', headers: {}, body: JSON.stringify({ ...recorded, response_format: { type: 'json_object' } }),
    });
    await expect(response.json()).resolves.toEqual({ answer: 42 });

    const stillStrict = bundle();
    stillStrict.http[0]!.request.body = JSON.stringify(recorded);
    await expect(replayFetch(stillStrict, 'nebius')('https://example.test/chat', {
      method: 'POST', headers: {}, body: JSON.stringify({ ...recorded, model: 'other', response_format: { type: 'json_object' } }),
    })).rejects.toMatchObject({ path: '$.model', expected: 'super', actual: 'other' });
  });

  it('names the first differing JSON path', async () => {
    const fetch = replayFetch(bundle(), 'nebius');
    await expect(fetch('https://example.test/chat', {
      method: 'POST', headers: {}, body: '{"a":9,"b":2}',
    })).rejects.toThrowError(new ReplayMismatchError(1, '$.a', 1, 9));
  });

  it('keeps a request mismatch on a shared cursor so a swallowing caller cannot hide it', async () => {
    const cursor = new RecordedCallCursor(
      bundle().http.filter((exchange) => exchange.boundary === 'nebius'),
      (exchange) => ({ method: exchange.boundary, args: [] }),
      'HTTP',
    );
    const fetch = replayFetch(bundle(), 'nebius', cursor);
    await fetch('https://example.test/chat', { method: 'POST', headers: {}, body: '{"a":9,"b":2}' }).catch(() => undefined);

    expect(() => cursor.rethrowMismatch()).toThrowError(new ReplayMismatchError(1, '$.a', 1, 9));
  });

  it('fails closed after the recorded sequence is exhausted', async () => {
    const fetch = replayFetch(bundle(), 'nebius');
    await fetch('https://example.test/chat', {
      method: 'POST', headers: {}, body: '{"a":1,"b":2}',
    });
    await expect(fetch('https://example.test/chat', {
      method: 'POST', headers: {}, body: '{"a":1,"b":2}',
    })).rejects.toThrow(/exhausted/u);
  });

  it('rejects response evidence without replayable bytes', async () => {
    const recorded = bundle();
    const response = recorded.http[0]!.response;
    if (response === undefined || 'transportError' in response) throw new Error('test bundle response is missing');
    response.body = {
      binary: true,
      bytes: 13,
      sha256: '0'.repeat(64),
    };
    const fetch = replayFetch(recorded, 'nebius');
    await expect(fetch('https://example.test/chat', {
      method: 'POST', headers: {}, body: '{"a":1,"b":2}',
    })).rejects.toThrow(/replayable text or raw bytes/u);
  });
});
