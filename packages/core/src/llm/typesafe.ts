import { Ledger, calculateModelCostUsd, type ModelPrice } from './cost.js';
import type {
  HttpHeaders,
  HttpRequestInit,
  HttpResponse,
  NebiusClientDependencies,
  NebiusFetch,
} from './nebius.js';
import { trimTrailing } from '../text/trim-edge.js';

/** Veto-only calibrated audit provider. Never the runtime model; see docs/plans/2026-09-17-typesafe-jev-calibrated-audit.md Design decision #1. */
export const TYPESAFE_BASE_URL = 'https://api.typesafe.ai/v1/';
export const TYPESAFE_AUDIT_MODEL = 'jev-latest';
/** USD per 1M tokens; output is free (no autoregressive decoding). */
export const TYPESAFE_PRICE: ModelPrice = { input: 0.042, output: 0 };
/** Exact catalog values checked on this date; future pricing requires a new record. */
export const TYPESAFE_PRICE_PROVENANCE = Object.freeze({
  asOf: '2026-09-17', source: 'https://typesafe.ai/',
});
/** Vendor request budget: state and questions share ~32,000 tokens. */
export const TYPESAFE_REQUEST_TOKEN_BUDGET = 32_000;
export const TYPESAFE_WORST_CASE_USD = calculateModelCostUsd(TYPESAFE_PRICE, {
  inTok: TYPESAFE_REQUEST_TOKEN_BUDGET,
  outTok: 0,
  reasoningTok: 0,
});

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface NoulQuestion {
  type: 'noul';
  instructions: JsonValue;
  criteria?: { true?: JsonValue; false?: JsonValue };
}

export interface ChoiceQuestion {
  type: 'choice';
  instructions: JsonValue;
  criteria: Record<string, JsonValue>;
}

// Score omitted: unused by the audit.
export type TypeSafeQuestion = NoulQuestion | ChoiceQuestion;

export interface NoulAnswer {
  type: 'noul';
  noul: number;
}

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export type TypeSafeAnswer = NoulAnswer | ChoiceAnswer;

export interface TypeSafeDecision {
  /** Resolved model from the response. */
  model: string;
  answers: Record<string, TypeSafeAnswer>;
  usage: { inTok: number; outTok: number; reasoningTok: 0 };
  usd: number;
  latencyMs: number;
  requestId: string | null;
}

export interface TypeSafeClientConfig {
  apiKey: string;
  ledger: Ledger;
  model?: string;
  baseUrl?: string;
}

interface TypeSafeCompletionResponse {
  model?: unknown;
  answers?: Record<string, unknown>;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
  };
}

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 250;
const RETRY_DEADLINE_MS = 30_000;

function defaultSleep(milliseconds: number): Promise<void> {
  const { setTimeout } = globalThis as unknown as {
    setTimeout(callback: () => void, delay: number): unknown;
  };
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function endpoint(baseUrl: string): string {
  return `${trimTrailing(baseUrl, '/')}/systemone`;
}

function retryAfterSeconds(headers: HttpHeaders): number | null {
  const raw = headers.get('retry-after')?.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > RETRY_DEADLINE_MS / 1_000) return null;
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeSafeResponseError(`Invalid ${field} in TypeSafe response`);
  }
  return value as number;
}

function unitInterval(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeSafeResponseError(`Invalid ${field} in TypeSafe response`);
  }
  return value;
}

function parseAnswer(id: string, question: TypeSafeQuestion, raw: unknown): TypeSafeAnswer {
  if (typeof raw !== 'object' || raw === null) {
    throw new TypeSafeResponseError(`Missing or invalid answer "${id}" in TypeSafe response`);
  }
  const value = raw as Record<string, unknown>;
  if (value.type !== question.type) {
    throw new TypeSafeResponseError(
      `answers.${id}.type "${String(value.type)}" does not match its question type "${question.type}" in TypeSafe response`,
    );
  }
  if (question.type === 'noul') {
    return { type: 'noul', noul: unitInterval(value.noul, `answers.${id}.noul`) };
  }
  const choice = value.choice;
  if (typeof choice !== 'string' || choice.length === 0) {
    throw new TypeSafeResponseError(`Invalid answers.${id}.choice in TypeSafe response`);
  }
  const rawProbabilities = value.probabilities;
  if (typeof rawProbabilities !== 'object' || rawProbabilities === null) {
    throw new TypeSafeResponseError(`Invalid answers.${id}.probabilities in TypeSafe response`);
  }
  const probabilities: Record<string, number> = {};
  for (const [option, probability] of Object.entries(rawProbabilities as Record<string, unknown>)) {
    probabilities[option] = unitInterval(probability, `answers.${id}.probabilities.${option}`);
  }
  if (!Object.hasOwn(probabilities, choice)) {
    throw new TypeSafeResponseError(`answers.${id}.choice is not a key of its probabilities in TypeSafe response`);
  }
  const confidence = unitInterval(value.confidence, `answers.${id}.confidence`);
  return { type: 'choice', choice, probabilities, confidence };
}

export class TypeSafeApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly body: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TypeSafeApiError';
  }

  static fromResponse(status: number, body: string): TypeSafeApiError {
    if (status === 401) {
      return new TypeSafeApiError(`TypeSafe authentication failed: ${body}`, status, body);
    }
    if (status === 404) {
      return new TypeSafeApiError(`TypeSafe model was not found: ${body}`, status, body);
    }
    return new TypeSafeApiError(`TypeSafe request failed with status ${status}: ${body}`, status, body);
  }
}

export class TypeSafeResponseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TypeSafeResponseError';
  }
}

export interface TypeSafeAuditClient {
  modelId(): string;
  decide(
    state: JsonValue,
    questions: Record<string, TypeSafeQuestion>,
    options?: { signal?: AbortSignal },
  ): Promise<TypeSafeDecision>;
}

/** Optional veto-only calibrated audit client. Never routes runtime repair traffic. */
export class TypeSafeClient implements TypeSafeAuditClient {
  readonly ledger: Ledger;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetch: NebiusFetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(
    private readonly config: TypeSafeClientConfig,
    dependencies: NebiusClientDependencies = {},
  ) {
    const runtimeFetch = (globalThis as unknown as { fetch?: NebiusFetch }).fetch;
    if (!dependencies.fetch && !runtimeFetch) {
      throw new Error('This runtime does not provide fetch');
    }
    this.fetch = dependencies.fetch ?? (runtimeFetch as NebiusFetch);
    this.sleep = dependencies.sleep ?? defaultSleep;
    this.random = dependencies.random ?? Math.random;
    this.now = dependencies.now ?? Date.now;
    this.model = config.model ?? TYPESAFE_AUDIT_MODEL;
    this.baseUrl = config.baseUrl ?? TYPESAFE_BASE_URL;
    this.ledger = config.ledger;
  }

  modelId(): string {
    return this.model;
  }

  async decide(
    state: JsonValue,
    questions: Record<string, TypeSafeQuestion>,
    options: { signal?: AbortSignal } = {},
  ): Promise<TypeSafeDecision> {
    const startedAt = this.now();
    const body = { state, model: this.model, questions };
    const requestUrl = endpoint(this.baseUrl);
    const request: HttpRequestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };

    const retryDeadline = this.now() + RETRY_DEADLINE_MS;
    for (let attempt = 0; ; attempt += 1) {
      let response: HttpResponse;
      try {
        response = await this.fetch(requestUrl, request);
      } catch (error) {
        if (options.signal?.aborted === true) throw error;
        if (attempt < MAX_RETRIES) {
          const delay = this.localBackoff(attempt);
          if (!(await this.waitForRetry(delay, retryDeadline))) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new TypeSafeApiError(
              `TypeSafe request retry deadline exceeded: ${detail}`,
              undefined,
              detail,
              { cause: error },
            );
          }
          continue;
        }
        const detail = error instanceof Error ? error.message : String(error);
        throw new TypeSafeApiError(
          `TypeSafe request failed after ${MAX_RETRIES + 1} attempts: ${detail}`,
          undefined,
          detail,
          { cause: error },
        );
      }

      if (response.ok) {
        return this.parseDecision(await response.json(), questions, Math.max(0, this.now() - startedAt), response.headers);
      }

      const responseBody = await response.text();
      const error = TypeSafeApiError.fromResponse(response.status, responseBody);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_RETRIES) {
        throw error;
      }
      const retryAfter = response.status === 429 ? retryAfterSeconds(response.headers) : null;
      const delay = retryAfter === null ? this.localBackoff(attempt) : retryAfter * 1_000;
      if (!(await this.waitForRetry(delay, retryDeadline))) {
        throw error;
      }
    }
  }

  private localBackoff(attempt: number): number {
    const jitter = 0.5 + this.random();
    return BASE_RETRY_DELAY_MS * 2 ** attempt * jitter;
  }

  private async waitForRetry(delay: number, deadline: number): Promise<boolean> {
    if (!Number.isFinite(delay) || delay < 0 || delay > deadline - this.now()) {
      return false;
    }
    await this.sleep(delay);
    return this.now() <= deadline;
  }

  private parseDecision(
    value: unknown,
    questions: Record<string, TypeSafeQuestion>,
    latencyMs: number,
    headers: HttpHeaders,
  ): TypeSafeDecision {
    if (typeof value !== 'object' || value === null) {
      throw new TypeSafeResponseError('TypeSafe returned a non-object response');
    }
    const response = value as TypeSafeCompletionResponse;
    if (typeof response.model !== 'string' || response.model.length === 0) {
      throw new TypeSafeResponseError('TypeSafe response is missing model');
    }
    if (typeof response.answers !== 'object' || response.answers === null) {
      throw new TypeSafeResponseError('TypeSafe response is missing answers');
    }
    const answers: Record<string, TypeSafeAnswer> = {};
    for (const [id, question] of Object.entries(questions)) {
      answers[id] = parseAnswer(id, question, response.answers[id]);
    }
    const inTok = nonNegativeInteger(response.usage?.input_tokens, 'usage.input_tokens');
    const outTok = nonNegativeInteger(response.usage?.output_tokens, 'usage.output_tokens');
    const usage = { inTok, outTok, reasoningTok: 0 as const };
    const entry = this.ledger.add('ultra', response.model, usage, TYPESAFE_PRICE);
    return {
      model: response.model,
      answers,
      usage,
      usd: entry.usd,
      latencyMs,
      requestId: headers.get('x-request-id'),
    };
  }
}
