import { createHash } from 'node:crypto';

import type {
  HttpHeaders,
  HttpRequestInit,
  HttpResponse,
  NebiusFetch,
} from '../llm/nebius.js';
import type {
  TavilyFetch,
  TavilyHttpRequestInit,
  TavilyHttpResponse,
} from '../diagnose/tavily.js';
import {
  binaryBody,
  boundedText,
  rawBody,
  type RecordedBody,
  type RecordedHttpBoundary,
  type RecordedHttpExchange,
  type ReplayRecorder,
} from './bundle.js';

const RESPONSE_HEADER_NAMES = [
  'content-length',
  'content-type',
  'retry-after',
  'set-cookie',
  'x-api-key',
  'x-ratelimit-dynamic-period-usage-requests',
  'x-ratelimit-dynamic-period-usage-tokens',
  'x-ratelimit-dynamic-scale-requests',
  'x-ratelimit-dynamic-scale-tokens',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-requests',
  'x-ratelimit-reset-tokens',
  'x-request-id',
] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function objectHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  try {
    return Object.fromEntries(
      Object.entries(headers ?? {}).map(([name, value]) => [name, String(value)]),
    );
  } catch {
    return {};
  }
}

function webHeaders(headers: RequestInit['headers']): Record<string, string> {
  try {
    return Object.fromEntries(new Headers(headers).entries());
  } catch {
    return {};
  }
}

function selectedHeaders(headers: HttpHeaders): Record<string, string> {
  try {
    return Object.fromEntries(RESPONSE_HEADER_NAMES.flatMap((name) => {
      const value = headers.get(name);
      return value === null ? [] : [[name, value]];
    }));
  } catch {
    return {};
  }
}

function recordResponseOnce(
  recorder: ReplayRecorder,
  exchange: Omit<RecordedHttpExchange, 'sequence' | 'response' | 'latencyMs'>,
  startedAt: number,
  response: HttpResponse | TavilyHttpResponse,
  headers: Record<string, string>,
  sequence: number | null,
): (body: RecordedBody) => void {
  let recorded = false;
  return (body) => {
    if (recorded) return;
    recorded = true;
    recorder.recordHttp({
      ...exchange,
      response: { status: response.status, headers, body },
      latencyMs: Date.now() - startedAt,
    }, sequence);
  };
}

interface RawReadableResponse {
  arrayBuffer?(): Promise<ArrayBuffer>;
}

type ByteCapture = { bytes: Uint8Array } | { error: unknown };

function captureResult(promise: Promise<Uint8Array>): Promise<ByteCapture> {
  return promise.then(
    (bytes) => ({ bytes }),
    (error: unknown) => ({ error }),
  );
}

function responseBytes(response: unknown): Promise<ByteCapture> {
  const readable = response as RawReadableResponse;
  try {
    if (typeof readable.arrayBuffer === 'function') {
      return captureResult(readable.arrayBuffer().then((value) => new Uint8Array(value)));
    }
  } catch (error) {
    return Promise.resolve({ error });
  }
  return Promise.resolve({ error: new Error('Response body is unavailable') });
}

function recordedBodyReader(
  recorder: ReplayRecorder,
  record: (body: RecordedBody) => void,
  capture: Promise<ByteCapture>,
  response: { json(): Promise<unknown>; text?: () => Promise<string> },
): {
  json(): Promise<unknown>;
  text(): Promise<string>;
  record(): Promise<void>;
} {
  let consumed = false;
  const captured = async (): Promise<Uint8Array | null> => {
    const result = await capture;
    if ('bytes' in result) return result.bytes;
    recorder.markOverflow('http');
    record(null);
    return null;
  };
  const consume = async <T>(
    parse: (bytes: Uint8Array) => T,
    fallback: () => Promise<T>,
  ): Promise<T> => {
    if (consumed) throw new TypeError('Body is unusable');
    consumed = true;
    const bytes = await captured();
    if (bytes === null) return fallback();
    record(rawBody(bytes));
    return parse(bytes);
  };
  return {
    json: () => consume(
      (bytes) => JSON.parse(new TextDecoder().decode(bytes)) as unknown,
      () => response.json(),
    ),
    text: () => consume(
      (bytes) => new TextDecoder().decode(bytes),
      () => response.text
        ? response.text()
        : Promise.reject(new TypeError('Response text is unavailable')),
    ),
    async record(): Promise<void> {
      const bytes = await captured();
      if (bytes !== null) record(rawBody(bytes));
    },
  };
}

/** One recorder for every OpenAI-shaped HTTP boundary; the boundary name is the only difference between them. */
function recordingHttpFetch(
  boundary: Exclude<RecordedHttpBoundary, 'contree' | 'tavily'>,
  recorder: ReplayRecorder,
  fetch: NebiusFetch,
): NebiusFetch {
  return async (input: string, init: HttpRequestInit): Promise<HttpResponse> => {
    const sequence = recorder.reserveHttpSequence(boundary);
    const startedAt = Date.now();
    const request = {
      boundary,
      request: {
        method: init.method,
        url: input,
        headers: objectHeaders(init.headers),
        body: boundedText(init.body),
      },
    };
    let response: HttpResponse;
    try {
      response = await fetch(input, init);
    } catch (error) {
      recorder.recordHttp({
        ...request,
        response: { transportError: errorMessage(error) },
        latencyMs: Date.now() - startedAt,
      }, sequence);
      throw error;
    }
    const record = recordResponseOnce(
      recorder,
      request,
      startedAt,
      response,
      selectedHeaders(response.headers),
      sequence,
    );
    const body = recordedBodyReader(
      recorder,
      record,
      responseBytes(response),
      response,
    );
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      json: body.json,
      text: body.text,
    };
  };
}

export function recordingNebiusFetch(
  recorder: ReplayRecorder,
  fetch: NebiusFetch,
): NebiusFetch {
  return recordingHttpFetch('nebius', recorder, fetch);
}

export function recordingOpenAiFetch(
  recorder: ReplayRecorder,
  fetch: NebiusFetch,
): NebiusFetch {
  return recordingHttpFetch('openai', recorder, fetch);
}

export function recordingTypeSafeFetch(
  recorder: ReplayRecorder,
  fetch: NebiusFetch,
): NebiusFetch {
  return recordingHttpFetch('typesafe', recorder, fetch);
}

export function recordingTavilyFetch(
  recorder: ReplayRecorder,
  fetch: TavilyFetch,
): TavilyFetch {
  return async (
    input: string,
    init: TavilyHttpRequestInit,
  ): Promise<TavilyHttpResponse> => {
    const sequence = recorder.reserveHttpSequence('tavily');
    const startedAt = Date.now();
    const request = {
      boundary: 'tavily' as const,
      request: {
        method: init.method,
        url: input,
        headers: objectHeaders(init.headers),
        body: init.body === undefined ? null : boundedText(init.body),
      },
    };
    let response: TavilyHttpResponse;
    try {
      response = await fetch(input, init);
    } catch (error) {
      recorder.recordHttp({
        ...request,
        response: { transportError: errorMessage(error) },
        latencyMs: Date.now() - startedAt,
      }, sequence);
      throw error;
    }
    const record = recordResponseOnce(recorder, request, startedAt, response, {}, sequence);
    const body = recordedBodyReader(
      recorder,
      record,
      responseBytes(response),
      response,
    );
    if (!response.ok) {
      await body.record();
    }
    return {
      ok: response.ok,
      status: response.status,
      json: body.json,
    };
  };
}

async function streamBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<RecordedBody> {
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      if (result.value) {
        bytes += result.value.byteLength;
        hash.update(result.value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { stream: true, bytes, sha256: hash.digest('hex') };
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== 'undefined' && value instanceof ReadableStream;
}

function cancelReplayStream(
  target: { cancel(reason?: unknown): Promise<void> },
  reason: string,
): void {
  try {
    void target.cancel(reason).catch(() => undefined);
  } catch {
    // Replay capture cancellation is best-effort.
  }
}

function captureContreeRequest(init: RequestInit): {
  init: RequestInit;
  body: Promise<RecordedBody>;
  immediateBody?: RecordedBody;
  cancel(): void;
} {
  const body = init.body;
  const captured = (value: RecordedBody) => ({
    init,
    body: Promise.resolve(value),
    immediateBody: value,
    cancel() {},
  });
  if (body === null || body === undefined) return captured(null);
  if (typeof body === 'string') return captured(boundedText(body));
  if (body instanceof URLSearchParams) {
    return captured(boundedText(body.toString()));
  }
  if (body instanceof Blob) {
    return {
      init,
      body: body.arrayBuffer().then((value) => binaryBody(new Uint8Array(value))),
      cancel() {},
    };
  }
  if (body instanceof ArrayBuffer) {
    return captured(binaryBody(new Uint8Array(body)));
  }
  if (ArrayBuffer.isView(body)) {
    return captured(binaryBody(
      new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
    ));
  }
  if (isReadableStream(body)) {
    const [fetchBody, recordedBody] = body.tee();
    const reader = recordedBody.getReader();
    return {
      init: { ...init, body: fetchBody },
      body: streamBody(reader),
      cancel() {
        const reason = 'ConTree transport completed before replay capture';
        cancelReplayStream(reader, reason);
        cancelReplayStream(fetchBody, reason);
      },
    };
  }
  return captured(boundedText(String(body)));
}

function responseBody(response: Response): Promise<RecordedBody> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  return response.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    return contentType.includes('json') || contentType.startsWith('text/')
      ? boundedText(new TextDecoder().decode(bytes))
      : binaryBody(bytes);
  });
}

export function recordingContreeFetch(
  recorder: ReplayRecorder,
  fetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init = {}): Promise<Response> => {
    const sequence = recorder.reserveHttpSequence('contree');
    const startedAt = Date.now();
    let captured: ReturnType<typeof captureContreeRequest>;
    try {
      captured = captureContreeRequest(init);
    } catch {
      recorder.markOverflow('http');
      captured = { init, body: Promise.resolve(null), immediateBody: null, cancel() {} };
    }
    const capturedBody = captured.body.catch(() => {
      recorder.markOverflow('http');
      return null;
    });
    const url = input instanceof Request ? input.url : String(input);
    let response: Response;
    try {
      response = await fetch(input, captured.init);
    } catch (error) {
      captured.cancel();
      const requestBody = captured.immediateBody ?? null;
      if (captured.immediateBody === undefined) recorder.markOverflow('http');
      recorder.recordHttp({
        boundary: 'contree',
        request: {
          method: init.method ?? (input instanceof Request ? input.method : 'GET'),
          url,
          headers: webHeaders(init.headers),
          body: requestBody,
        },
        response: { transportError: errorMessage(error) },
        latencyMs: Date.now() - startedAt,
      }, sequence);
      throw error;
    }
    const requestBody = await capturedBody;
    let recordedResponseBody: RecordedBody = null;
    try {
      recordedResponseBody = await responseBody(response.clone());
    } catch {
      recorder.markOverflow('http');
    }
    recorder.recordHttp({
      boundary: 'contree',
      request: {
        method: init.method ?? (input instanceof Request ? input.method : 'GET'),
        url,
        headers: webHeaders(init.headers),
        body: requestBody,
      },
      response: {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: recordedResponseBody,
      },
      latencyMs: Date.now() - startedAt,
    }, sequence);
    return response;
  };
}
