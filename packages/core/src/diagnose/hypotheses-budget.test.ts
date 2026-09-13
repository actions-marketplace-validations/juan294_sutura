import type { TierLlm } from '../llm/types.js';
import { describe, expect, it, vi } from 'vitest';
import { budgetedRecoveryPorts, reserveRecoveryAudit } from './hypotheses-budget.js';
import { BudgetExceededError, RepairBudget } from '../engine/repair-budget.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import type { Executor } from '../executor/types.js';
import type { HealLlm } from '../heal.js';

function setup() {
  const chat = vi.fn(async () => ({ text: 'ok', usd: 0.001 }));
  const llm: HealLlm = { chat, modelQuote: (tier) => ({ role: tier, modelId: tier, profileId: 'fixed', price: { input: 1, output: 1 } }) };
  const run = vi.fn<Executor['run']>(async () => ({ imageId: 'child', exitCode: 0, stdout: '', stderr: '', truncated: false, metrics: {} }));
  const cancel = vi.fn(async (operationId: string) => ({ operationId, requested: true, terminal: 'cancelled' as const }));
  const executor: Executor = { run, cancel, runMany: async () => [], importImage: async () => 'unused', snapshot: async () => 'unused', operationCapacity: () => ({ limit: 1, active: 0, available: 1 }) };
  return { llm, executor, chat, run, cancel };
}

describe('shared recovery ports', () => {
  it('reserves structured response schema bytes before making a provider request', async () => {
    const input = setup(); input.chat.mockResolvedValue({ text: 'ok', usd: 0 });
    const ports = budgetedRecoveryPorts({ ...input, budget: new RepairBudget({ inferenceCostUsd: 0.001 }) });
    await expect(ports.llm.chat('nano', [], { maxTokens: 1, responseFormat: {
      type: 'json_schema', jsonSchema: { name: 'diagnosis', strict: true, schema: { type: 'string', description: 'x'.repeat(2000) } },
    } })).rejects.toThrow(BudgetExceededError);
    expect(input.chat).not.toHaveBeenCalled();
  });

  it('applies the complete audit request bound to response schemas too', async () => {
    const input = setup(); input.chat.mockResolvedValue({ text: 'ok', usd: 0 });
    const audit = reserveRecoveryAudit({ ...input, budget: new RepairBudget(), policy: createDefaultRepositoryPolicy() });
    await expect(audit.llm.chat('ultra', [], { maxTokens: 1, responseFormat: {
      type: 'json_schema', jsonSchema: { name: 'audit', strict: true, schema: { type: 'string', description: 'x'.repeat(33_000) } },
    } })).rejects.toThrow(BudgetExceededError);
    expect(input.chat).not.toHaveBeenCalled();
  });

  it('charges initial model and each sandbox call before work, and settles actual costs', async () => {
    const input = setup(); const budget = new RepairBudget({ modelTurns: 1, sandboxOperations: 1 });
    const ports = budgetedRecoveryPorts({ ...input, budget });
    await ports.llm.chat('nano', [{ role: 'user', content: 'diagnose' }], { maxTokens: 2048 });
    await expect(ports.llm.chat('nano', [], { maxTokens: 2048 })).rejects.toThrow(BudgetExceededError);
    await ports.executor.run('base', 'pnpm test');
    await expect(ports.executor.run('base', 'pnpm test')).rejects.toThrow(BudgetExceededError);
    expect(input.chat).toHaveBeenCalledTimes(1); expect(input.run).toHaveBeenCalledTimes(1);
    expect(budget.snapshot().inferenceCostUsd).toBeCloseTo(0.001);
  });

  it('enforces model deadlines even when the delegate ignores cancellation', async () => {
    vi.useFakeTimers();
    try {
      const input = setup(); input.chat.mockImplementation(() => new Promise(() => {}));
      const ports = budgetedRecoveryPorts({ ...input, budget: new RepairBudget({ elapsedTimeSec: 1 }) });
      const result = expect(ports.llm.chat('nano', [], { maxTokens: 2048 })).rejects.toThrow(BudgetExceededError);
      await vi.advanceTimersByTimeAsync(1000); await result;
    } finally { vi.useRealTimers(); }
  });

  it('cancels the exact active sandbox operation and stops on caller cancellation', async () => {
    const input = setup(); input.run.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const ports = budgetedRecoveryPorts({ ...input, budget: new RepairBudget(), signal: controller.signal });
    const result = expect(ports.executor.run('base', 'pnpm test')).rejects.toThrow(/cancelled/u);
    controller.abort(); await result;
    const id = input.run.mock.calls[0]?.[2]?.operationId;
    expect(id).toMatch(/^recovery-/u); expect(input.cancel).toHaveBeenCalledWith(id);
  });

  it('protects final audit time and preserves caller cancellation', async () => {
    const input = setup(); const budget = new RepairBudget();
    const ports = reserveRecoveryAudit({ ...input, budget, policy: createDefaultRepositoryPolicy() });
    expect(budget.remainingElapsedTimeSec()).toBeLessThanOrEqual(540);
    await expect(ports.llm.chat('ultra', [], { maxTokens: 2048, signal: AbortSignal.abort() })).rejects.toThrow(/cancelled/u);
    expect(input.chat).not.toHaveBeenCalled();
  });

  it('releases unused terminal capacity after verification without refunding spent work', async () => {
    const input = setup(); const budget = new RepairBudget();
    const audit = reserveRecoveryAudit({ ...input, budget, policy: createDefaultRepositoryPolicy() });
    await audit.llm.chat('ultra', [], { maxTokens: 2048 });
    audit.finish(); audit.finish();
    expect(budget.snapshot().modelTurns).toBe(1);
    expect(budget.snapshot().inferenceCostUsd).toBeCloseTo(0.001);
    expect(budget.remainingElapsedTimeSec()).toBeGreaterThan(590);
    await expect(audit.llm.chat('ultra', [], { maxTokens: 2048 })).rejects.toThrow(/reservation/u);
  });
});

it('uses stable per-port operation sequences and keeps audit operations disjoint', async () => {
  const input = setup();
  const budget = new RepairBudget();
  const first = budgetedRecoveryPorts({ ...input, budget, operationIdPrefix: 'run-77-initial' });
  const replay = budgetedRecoveryPorts({ ...input, budget, operationIdPrefix: 'run-77-initial' });
  const audit = reserveRecoveryAudit({ ...input, budget, policy: createDefaultRepositoryPolicy(), operationIdPrefix: 'run-77-initial' });
  await first.executor.run('base', 'pnpm test');
  await first.executor.run('base', 'pnpm test');
  await replay.executor.run('base', 'pnpm test');
  await audit.executor.run('base', 'pnpm test');
  await first.executor.run('base', 'pnpm test', { operationId: 'explicit-controller-id' });
  expect(input.run.mock.calls.map((call) => call[2]?.operationId)).toEqual([
    'run-77-initial-op-001', 'run-77-initial-op-002', 'run-77-initial-op-001',
    'run-77-initial-audit-op-001', 'explicit-controller-id',
  ]);
  audit.finish();
});

it('does not serialize controller routing identities into billable input', async () => {
  const input = setup();
  input.chat.mockResolvedValue({ text: 'ok', usd: 0 });
  const runScope: Record<string, unknown> = {};
  runScope.self = runScope;
  const ports = budgetedRecoveryPorts({ ...input, budget: new RepairBudget({ inferenceCostUsd: 0.01 }) });
  await expect(ports.llm.chat('super', [], { maxTokens: 1, purpose: 'diagnosis-recovery', routing: { runScope, failureClass: null, diagnosisConfidence: null, remainingInferenceBudgetUsd: 0.01 } })).resolves.toMatchObject({ text: 'ok' });
});

it('forwards the exact reserved immutable quote to the provider dispatch', async () => {
  const input = setup();
  const quote = { role: 'super' as const, modelId: 'reserved-super', profileId: 'fixed', price: { input: 1, output: 1 } };
  const modelQuote = vi.fn(() => quote);
  const chat = vi.fn<TierLlm<'nano' | 'super' | 'ultra'>['chat']>(async (_tier, _messages, options) => {
    expect(options?.quotedRoute).toEqual(quote);
    expect(Object.isFrozen(options?.quotedRoute)).toBe(true);
    expect(Object.isFrozen(options?.quotedRoute?.price)).toBe(true);
    return { text: 'ok', usd: 0 };
  });
  const ports = budgetedRecoveryPorts({ ...input, llm: { chat, modelQuote }, budget: new RepairBudget() });
  await ports.llm.chat('super', [], { maxTokens: 2048 });
  expect(modelQuote).toHaveBeenCalledOnce();
});
