import { randomUUID } from 'node:crypto';
import { BudgetExceededError, type RepairBudget, type RepairCapacityReservation } from '../engine/repair-budget.js';
import type { Executor, RunOptions } from '../executor/types.js';
import type { HealLlm } from '../heal.js';
import type { ChatMessage, ChatOptions, TierLlm } from '../llm/types.js';
import type { ModelPrice, ModelTier } from '../llm/cost.js';
import type { RepositoryPolicy } from '../policy/schema.js';

// A bounded audit request is reserved before repair. Larger requests abstain;
// no candidate or evidence is truncated to fit the reservation.
const AUDIT_REQUEST_BYTES = 32_000;
const AUDIT_OUTPUT_TOKENS = 4_096;
export function modelReservationUsd(bytes: number, tokens: number, price: ModelPrice): number {
  if (![price.input, price.output].every((value) => Number.isFinite(value) && value >= 0)) throw new Error('Invalid model price quote');
  return Math.max(0.000001, Math.ceil((bytes * price.input + tokens * price.output)) / 1_000_000);
}

interface BudgetedPortsInput {
  budget: RepairBudget;
  llm: HealLlm;
  executor: Executor;
  signal?: AbortSignal;
  /** Stable controller run prefix makes fresh recordings exactly replayable. */
  operationIdPrefix?: string;
}

export interface RecoveryAuditPorts {
  executor: Executor;
  llm: HealLlm;
  finish(): void;
}

/** Enforce a local deadline even if a provider ignores AbortSignal. */
export async function withinRecoveryDeadline<T>(
  seconds: number,
  signal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
  cancel?: () => Promise<unknown>,
): Promise<T> {
  if (signal?.aborted) throw new Error('Recovery was cancelled');
  if (seconds <= 0) throw new BudgetExceededError('elapsedTimeSec');
  const timeoutController = new AbortController();
  const combined = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
  const timer = setTimeout(() => timeoutController.abort(), Math.max(1, Math.floor(seconds * 1000)));
  let removeListener = () => {};
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => {
        // Cancellation identifies the exact submitted operation. Retain the spent
        // reservation even when remote terminal confirmation is unavailable.
        if (cancel) void Promise.resolve().then(cancel).catch(() => {});
        reject(timeoutController.signal.aborted ? new BudgetExceededError('elapsedTimeSec') : new Error('Recovery was cancelled'));
      };
      removeListener = () => combined.removeEventListener('abort', onAbort);
      combined.addEventListener('abort', onAbort, { once: true });
    });
    return await Promise.race([work(combined), aborted]);
  } finally {
    clearTimeout(timer);
    removeListener();
  }
}

function ports(input: BudgetedPortsInput, reservation?: RepairCapacityReservation): { executor: Executor; llm: HealLlm } {
  const delegate = input.llm as TierLlm<ModelTier>;
  const operationIdPrefix = input.operationIdPrefix ?? `recovery-${randomUUID()}`;
  let operationIndex = 0;
  const executor: Executor = {
    importImage: (ref) => input.executor.importImage(ref),
    snapshot: (dir, base, options) => input.executor.snapshot(dir, base, options),
    operationCapacity: () => input.executor.operationCapacity(),
    cancel: (id) => input.executor.cancel(id),
    async run(parent, command, options?: RunOptions) {
      if (input.signal?.aborted) throw new Error('Recovery was cancelled');
      input.budget.reserveSandboxOperation(reservation);
      const operationId = options?.operationId ?? `${operationIdPrefix}-op-${String(++operationIndex).padStart(3, '0')}`;
      const seconds = Math.min(options?.timeoutSec ?? 120, input.budget.remainingElapsedTimeSec(reservation));
      return withinRecoveryDeadline(seconds, input.signal, () => input.executor.run(parent, command, {
        ...options, operationId, network: 'disabled', timeoutSec: seconds,
      }), () => input.executor.cancel(operationId));
    },
    async runMany(parent, commands, options) {
      const results = [];
      for (const command of commands) results.push(await executor.run(parent, command, options));
      return results;
    },
  };
  const llm: HealLlm = {
    ...(delegate.modelQuote ? { modelQuote: (...args: Parameters<NonNullable<typeof delegate.modelQuote>>) => delegate.modelQuote!(...args) } : {}),
    ...(delegate.modelId ? { modelId: (tier: ModelTier) => delegate.modelId!(tier) } : {}),
    ...(delegate.capacitySnapshot ? { capacitySnapshot: () => delegate.capacitySnapshot!() } : {}),
    async chat(tier, messages: readonly ChatMessage[], options?: ChatOptions) {
      const signals = [input.signal, options?.signal].filter((value): value is AbortSignal => value !== undefined);
      const signal = signals.length ? AbortSignal.any(signals) : undefined;
      if (signal?.aborted) throw new Error('Recovery was cancelled');
      const tokens = options?.maxTokens ?? AUDIT_OUTPUT_TOKENS;
      // Bound only provider-visible content. Routing state can contain cyclic
      // controller identities and must never be serialized or charged as text.
      // The fixed allowance covers provider envelope keys/model identifiers.
      const bytes = 1_024 + Buffer.byteLength(JSON.stringify({
        messages,
        max_tokens: tokens,
        temperature: options?.temperature ?? 0,
        ...(options?.topP === undefined ? {} : { top_p: options.topP }),
        ...(options?.thinkingMode === undefined ? {} : { thinkingMode: options.thinkingMode }),
        ...(options?.reasoningEffort === undefined ? {} : { reasoning_effort: options.reasoningEffort }),
        ...(options?.responseFormat === undefined ? {} : { response_format: options.responseFormat }),
        ...(options?.tools === undefined ? {} : { tools: options.tools }),
        ...(options?.toolChoice === undefined ? {} : { tool_choice: options.toolChoice }),
      }));
      if (reservation && (tier !== 'ultra' || bytes > AUDIT_REQUEST_BYTES || tokens > AUDIT_OUTPUT_TOKENS)) throw new BudgetExceededError('inferenceCostUsd');
      const selected = options?.quotedRoute ?? delegate.modelQuote?.(tier, messages, options);
      const quote = selected === undefined ? undefined : Object.freeze({ ...selected, price: Object.freeze({ ...selected.price }) });
      if (!quote) throw new Error('Model price quote is unavailable');
      const turn = input.budget.reserveModelTurn(modelReservationUsd(bytes, tokens, quote.price), reservation);
      const reply = await withinRecoveryDeadline(input.budget.remainingElapsedTimeSec(reservation), signal,
        (boundedSignal) => delegate.chat(tier, messages, { ...options, maxTokens: tokens, quotedRoute: quote, signal: boundedSignal }));
      if ((reply.usd ?? turn.reservedUsd) > turn.reservedUsd) throw new BudgetExceededError('inferenceCostUsd');
      input.budget.settleModelTurn(turn, reply.usd ?? turn.reservedUsd);
      return reply;
    },
  };
  return { executor, llm };
}

export function budgetedRecoveryPorts(input: BudgetedPortsInput): { executor: Executor; llm: HealLlm } {
  return ports(input);
}

export function reserveRecoveryAudit(input: BudgetedPortsInput & { policy: RepositoryPolicy }): RecoveryAuditPorts {
  const quote = input.llm.modelQuote?.('ultra', [], { maxTokens: AUDIT_OUTPUT_TOKENS });
  if (!quote) throw new Error('Audit model price quote is unavailable');
  const perTurn = modelReservationUsd(AUDIT_REQUEST_BYTES, AUDIT_OUTPUT_TOKENS, quote.price);
  const reservation = input.budget.reserveCapacity({ modelTurns: 2, sandboxOperations: 1 + input.policy.requiredCommands.length * 2 + (input.policy.verification?.mode === 'disabled' ? 0 : ((input.policy.verification?.contracts.length ?? 0) > 0 ? 6 : 0)), inferenceCostUsd: perTurn * 2, elapsedTimeSec: 60 });
  let active = true;
  return {
    ...ports({ ...input, operationIdPrefix: `${input.operationIdPrefix ?? `recovery-${randomUUID()}`}-audit` }, reservation),
    finish() {
      if (active) {
        input.budget.releaseCapacity(reservation);
        active = false;
      }
    },
  };
}
