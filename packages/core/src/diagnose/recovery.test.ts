import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { recoverDiagnosis } from './hypotheses.js';
import { RepairBudget } from '../engine/repair-budget.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import type { Executor } from '../executor/types.js';
import type { HealLlm } from '../heal.js';
import type { RecoveryInput } from './hypotheses.js';

function setup(overrides: Partial<RecoveryInput> = {}) {
  const source = "test('name', async () => { expect(load()).toBe('ADA'); });\n";
  const sourceHash = createHash('sha256').update(source).digest('hex');
  const run = vi.fn(async () => ({ imageId: 'probe-child', exitCode: 1, stdout: `SUTURA_SOURCE_SHA256=${sourceHash}\nAssertionError: expected Promise to be ADA`, stderr: '', truncated: false, metrics: {} }));
  const chat = vi.fn(async () => ({ text: JSON.stringify({ hypotheses: [{ signalIndex: 0, sourceIndex: 0, intent: 'await-operation', probeId: 'async-completion' }] }), usd: 0.001 }));
  const llm: HealLlm = { chat, modelQuote: (tier) => ({ role: tier, modelId: tier, profileId: 'fixed', price: { input: 1, output: 1 } }) };
  const executor: Executor = { run, runMany: async () => [], importImage: async () => 'unused', snapshot: async () => 'unused', operationCapacity: () => ({ limit: 1, active: 0, available: 1 }), cancel: async (operationId) => ({ operationId, requested: true, terminal: 'cancelled' }) };
  const input: RecoveryInput = {
    initialDiagnosis: { class: 'test-assertion', confidence: 0.4, signals: ['mechanical:test-assertion', 'llm:test-bug'], failingCmd: 'pnpm test', errorExcerpt: 'Expected Promise to be ADA' },
    failedLog: 'AssertionError: expected Promise to be ADA', sourceContext: { sources: [{ path: 'case.test.js', startLine: 1, content: source, truncated: false }] },
    baseline: { kind: 'local-snapshot', sourceSha: null, policyBaseSha: null, policySha256: 'a'.repeat(64), baselineImageId: 'baseline', snapshotSha256: null },
    policy: createDefaultRepositoryPolicy(), executor, llm, budget: new RepairBudget(), trustedCommand: 'pnpm test', repairReservationUsd: 0.05, observe: vi.fn(), ...overrides,
  };
  return { input, run, chat };
}

describe('diagnosis recovery scheduling', () => {
  it('retains initial diagnosis, verifies source binding and executes at most two controller probes', async () => {
    const { input, run, chat } = setup();
    const recovered = await recoverDiagnosis(input);
    expect(recovered.hypotheses).toHaveLength(2);
    expect(recovered.attempts[0]?.diagnosis).toEqual(input.initialDiagnosis);
    expect(recovered.attempts[1]?.authorization).toBeDefined();
    expect(recovered.evidence.hypotheses[1]).toMatchObject({ status: 'passed' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(recovered.audit).toBeDefined();
    expect(input.budget.snapshot().modelTurns).toBeGreaterThan(1);
  });

  it('never executes a model-supplied command or uses fabricated expected values', async () => {
    const { input, run, chat } = setup();
    chat.mockResolvedValue({ text: JSON.stringify({ hypotheses: [{ signalIndex: 0, sourceIndex: 0, intent: 'await-operation', probeId: 'async-completion', command: 'arbitrary-command' }] }), usd: 0.001 });
    const result = await recoverDiagnosis(input);
    expect(run).not.toHaveBeenCalled();
    expect(result.attempts).toHaveLength(1);
    expect(result.evidence.status).toBe('insufficient');
  });

  it('refuses source substitution and preserves an explicit probe failure', async () => {
    const { input, run } = setup();
    run.mockResolvedValue({ imageId: 'probe-child', exitCode: 1, stdout: `SUTURA_SOURCE_SHA256=${'b'.repeat(64)}\nExpected Promise to be ADA`, stderr: '', truncated: false, metrics: {} });
    const result = await recoverDiagnosis(input);
    expect(result.attempts).toHaveLength(1);
    expect(result.evidence.hypotheses[1]).toMatchObject({ status: 'insufficient', reason: 'source-identity-mismatch' });
  });

  it('reserves audit first and abstains without model or sandbox calls when capacity is unavailable', async () => {
    const { input, run, chat } = setup({ budget: new RepairBudget({ sandboxOperations: 1 }) });
    const result = await recoverDiagnosis(input);
    expect(result.attempts).toEqual([]);
    expect(result.evidence.reason).toBe('budget-exhausted');
    expect(run).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it('honors cancellation before reserving or executing work', async () => {
    const { input, run, chat } = setup({ signal: AbortSignal.abort() });
    const result = await recoverDiagnosis(input);
    expect(result.evidence.reason).toBe('cancelled');
    expect(run).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it.each([{ toolCalls: 2 }, { inferenceCostUsd: 0.1 }, { elapsedTimeSec: 89 }])('protects a complete repair before investigation with %o', async (limits) => {
    const { input, run, chat } = setup({ budget: new RepairBudget(limits), repairReservationUsd: 0.09 });
    const result = await recoverDiagnosis(input);
    expect(result.evidence.reason).toBe('budget-exhausted');
    expect(chat).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  });

  it('does not infer a recovery signal from low model confidence alone', async () => {
    const { input, run, chat } = setup({ failedLog: 'ordinary compiler failure', sourceContext: { sources: [{ path: 'index.js', startLine: 1, content: 'export const result = 1;\n', truncated: false }] } });
    const result = await recoverDiagnosis(input);
    expect(result.attempts).toHaveLength(1);
    expect(result.evidence.status).toBe('not-run');
    expect(run).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it('distinguishes unavailable price evidence from exhausted capacity', async () => {
    const { input, run, chat } = setup();
    input.llm = { chat };
    const result = await recoverDiagnosis(input);
    expect(result.evidence).toMatchObject({ status: 'insufficient', reason: 'verification-reservation-unavailable' });
    expect(run).not.toHaveBeenCalled(); expect(chat).not.toHaveBeenCalled();
  });

  it('retains provider failure as infrastructure evidence rather than an invalid proposal', async () => {
    const { input, run, chat } = setup();
    chat.mockRejectedValue(new Error('Provider connection failed'));
    const result = await recoverDiagnosis(input);
    expect(result.evidence).toMatchObject({ status: 'infra-stop', reason: 'hypothesis-provider-failed' });
    expect(run).not.toHaveBeenCalled();
  });
});
