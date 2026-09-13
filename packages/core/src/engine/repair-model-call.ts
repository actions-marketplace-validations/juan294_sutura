import type { RepairFailureKind } from '../domain.js';
import type { ModelPrice } from '../llm/cost.js';
import type { CapacitySnapshot, ChatMessage, ChatOptions, TierLlm } from '../llm/types.js';
import { redactExternalText } from '../security/external-text.js';
import { BudgetExceededError, type RepairBudget } from './repair-budget.js';

type RepairModelReply = Awaited<ReturnType<TierLlm<'super'>['chat']>>;

export type RepairModelCallFailure = {
  status: 'gave-up' | 'infra-stop';
  reason: string;
  failureKind: RepairFailureKind;
};

export interface RepairModelCallOptions {
  llm: TierLlm<'super'>;
  budget: RepairBudget;
  messages: readonly ChatMessage[];
  options: ChatOptions;
  worstCaseUsd(price: ModelPrice): number;
  signal?: AbortSignal;
  observeCapacity?: (capacity: CapacitySnapshot) => void;
}

export function publicRepairReason(value: string): string {
  return redactExternalText(value).text.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 300);
}

export async function requestRepairModel(
  input: RepairModelCallOptions,
): Promise<{ ok: true; reply: RepairModelReply } | { ok: false; outcome: RepairModelCallFailure }> {
  if (input.signal?.aborted) {
    return { ok: false, outcome: { status: 'gave-up', failureKind: 'sandbox', reason: 'Repair branch was cancelled' } };
  }
  let reservation;
  let quote;
  try {
    quote = input.llm.modelQuote?.('super', input.messages, input.options);
    if (quote === undefined) throw new Error('Repair model routing quote is unavailable');
    reservation = input.budget.reserveModelTurn(input.worstCaseUsd(quote.price));
  } catch (error) {
    return {
      ok: false,
      outcome: {
        status: 'gave-up',
        failureKind: error instanceof BudgetExceededError ? 'budget' : 'provider',
        reason: publicRepairReason(error instanceof Error ? error.message : String(error)),
      },
    };
  }
  const controller = new AbortController();
  const signal = input.signal === undefined
    ? controller.signal
    : AbortSignal.any([controller.signal, input.signal]);
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, Math.floor(input.budget.remainingElapsedTimeSec() * 1_000)),
  );
  let removeAbortListener = (): void => {};
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = (): void => reject(
        controller.signal.aborted
          ? new BudgetExceededError('elapsedTimeSec')
          : new Error('Repair branch was cancelled'),
      );
      removeAbortListener = () => signal.removeEventListener('abort', onAbort);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
    const reply = await Promise.race([
      input.llm.chat('super', input.messages, { ...input.options, quotedRoute: quote, signal }),
      aborted,
    ]);
    if (reply.capacity !== undefined) input.observeCapacity?.(reply.capacity);
    const actualUsd = reply.usd ?? reservation.reservedUsd;
    if (actualUsd > reservation.reservedUsd) {
      return {
        ok: false,
        outcome: {
          status: 'gave-up', failureKind: 'budget',
          reason: 'Model response exceeded its reserved worst-case cost',
        },
      };
    }
    input.budget.settleModelTurn(reservation, actualUsd);
    return { ok: true, reply };
  } catch (error) {
    const reason = publicRepairReason(error instanceof Error ? error.message : String(error));
    return {
      ok: false,
      outcome: error instanceof BudgetExceededError || controller.signal.aborted
        ? { status: 'gave-up', failureKind: 'budget', reason }
        : input.signal?.aborted
          ? { status: 'gave-up', failureKind: 'sandbox', reason: 'Repair branch was cancelled' }
          : { status: 'infra-stop', failureKind: 'provider', reason },
    };
  } finally {
    removeAbortListener();
    clearTimeout(timeout);
  }
}
