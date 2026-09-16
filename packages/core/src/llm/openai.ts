import { Ledger, type ModelPrice } from './cost.js';
import type {
  HttpHeaders,
  HttpRequestInit,
  HttpResponse,
  NebiusClientDependencies,
  NebiusFetch,
} from './nebius.js';
import type { ChatMessage, ChatOptions, TierLlm, TierLlmReply } from './types.js';
import { trimTrailing } from '../text/trim-edge.js';

/** Optional second-opinion provider. Never the runtime model; see docs/plans/2026-09-15-launch-readiness-v0.3.1.md Design decision #3. */
export const OPENAI_BASE_URL = 'https://api.openai.com/v1/';
export const SECOND_OPINION_MODEL = 'gpt-6-astra';
export const SECOND_OPINION_PRICE: ModelPrice = { input: 10, output: 50 };
/** Exact catalog values checked on this date; future pricing requires a new record. */
export const SECOND_OPINION_PRICE_PROVENANCE = Object.freeze({
  asOf: '2026-09-15', source: 'https://developers.openai.com/api/docs/pricing',
});

export interface OpenAiClientConfig {
  apiKey: string;
  ledger: Ledger;
  model?: string;
  baseUrl?: string;
}

interface OpenAiCompletionResponse {
  choices?: Array<{
    finish_reason?: unknown;
    message?: { content?: unknown };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    completion_tokens_details?: { reasoning_tokens?: unknown } | null;
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
  return `${trimTrailing(baseUrl, '/')}/chat/completions`;
}

function wireMessages(messages: readonly ChatMessage[]): readonly unknown[] {
  return messages.map((message) => {
    if (message.role === 'assistant') {
      return {
        role: message.role,
        ...(message.content !== undefined ? { content: message.content } : {}),
        ...(message.toolCalls ? { tool_calls: message.toolCalls } : {}),
      };
    }
    if (message.role === 'tool') {
      return {
        role: message.role,
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }
    return message;
  });
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
    throw new OpenAiResponseError(`Invalid ${field} in OpenAI response`);
  }
  return value as number;
}

export class OpenAiApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly body: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'OpenAiApiError';
  }

  static fromResponse(status: number, body: string): OpenAiApiError {
    if (status === 401) {
      return new OpenAiApiError(`OpenAI authentication failed: ${body}`, status, body);
    }
    if (status === 404) {
      return new OpenAiApiError(`OpenAI model was not found: ${body}`, status, body);
    }
    return new OpenAiApiError(`OpenAI request failed with status ${status}: ${body}`, status, body);
  }
}

export class OpenAiResponseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OpenAiResponseError';
  }
}

/** Optional veto-only second-opinion client. Never routes runtime repair traffic. */
export class OpenAiClient implements TierLlm<'ultra'> {
  readonly ledger: Ledger;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetch: NebiusFetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(
    private readonly config: OpenAiClientConfig,
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
    this.model = config.model ?? SECOND_OPINION_MODEL;
    this.baseUrl = config.baseUrl ?? OPENAI_BASE_URL;
    this.ledger = config.ledger;
  }

  modelId(): string {
    return this.model;
  }

  async chat(
    tier: 'ultra',
    messages: readonly ChatMessage[],
    options: ChatOptions = {},
  ): Promise<TierLlmReply> {
    const startedAt = this.now();
    const body = {
      model: this.model,
      messages: wireMessages(messages),
      max_completion_tokens: options.maxTokens ?? 4_096,
      reasoning_effort: options.reasoningEffort ?? 'low',
      ...(options.responseFormat === undefined ? {} : { response_format: { type: 'json_object' as const } }),
    };
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
            throw new OpenAiApiError(
              `OpenAI request retry deadline exceeded: ${detail}`,
              undefined,
              detail,
              { cause: error },
            );
          }
          continue;
        }
        const detail = error instanceof Error ? error.message : String(error);
        throw new OpenAiApiError(
          `OpenAI request failed after ${MAX_RETRIES + 1} attempts: ${detail}`,
          undefined,
          detail,
          { cause: error },
        );
      }

      if (response.ok) {
        return this.parseReply(await response.json(), Math.max(0, this.now() - startedAt));
      }

      const responseBody = await response.text();
      const error = OpenAiApiError.fromResponse(response.status, responseBody);
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

  private parseReply(value: unknown, latencyMs: number): TierLlmReply {
    if (typeof value !== 'object' || value === null) {
      throw new OpenAiResponseError('OpenAI returned a non-object response');
    }
    const response = value as OpenAiCompletionResponse;
    const choice = response.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new OpenAiResponseError('OpenAI response is missing message content');
    }
    const inTok = nonNegativeInteger(response.usage?.prompt_tokens, 'usage.prompt_tokens');
    const completionTok = nonNegativeInteger(response.usage?.completion_tokens, 'usage.completion_tokens');
    const reasoningDetails = response.usage?.completion_tokens_details;
    const reasoningTok = nonNegativeInteger(
      reasoningDetails?.reasoning_tokens ?? 0,
      'usage.completion_tokens_details.reasoning_tokens',
    );
    if (reasoningTok > completionTok) {
      throw new OpenAiResponseError('Reasoning tokens exceed total completion tokens in OpenAI response');
    }
    const usage = { inTok, outTok: completionTok - reasoningTok, reasoningTok };
    const entry = this.ledger.add('ultra', this.model, usage, SECOND_OPINION_PRICE);
    const finishReason = choice?.finish_reason;
    return {
      text: content,
      finishReason: typeof finishReason === 'string' ? finishReason : null,
      usage,
      usd: entry.usd,
      model: this.model,
      providerModel: this.model,
      latencyMs,
      requestId: null,
    };
  }
}
