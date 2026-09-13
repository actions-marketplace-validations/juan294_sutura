import { describe, expect, it } from 'vitest';

import {
  BudgetExceededError,
  DEFAULT_REPAIR_BUDGET_LIMITS,
  RepairBudget,
  repairBudgetLimits,
} from './repair-budget.js';

describe('RepairBudget', () => {
  it('reserves concurrent operations atomically against one global limit', async () => {
    const budget = new RepairBudget({ ...DEFAULT_REPAIR_BUDGET_LIMITS, sandboxOperations: 2 });

    const reservations = await Promise.allSettled([
      Promise.resolve().then(() => budget.reserveSandboxOperation()),
      Promise.resolve().then(() => budget.reserveSandboxOperation()),
      Promise.resolve().then(() => budget.reserveSandboxOperation()),
    ]);

    expect(reservations.filter(({ status }) => status === 'fulfilled')).toHaveLength(2);
    expect(reservations.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(budget.snapshot().sandboxOperations).toBe(2);
  });

  it('reserves worst-case inference cost before a model request and settles actual cost', () => {
    const budget = new RepairBudget({ ...DEFAULT_REPAIR_BUDGET_LIMITS, inferenceCostUsd: 0.05 });
    const reservation = budget.reserveModelTurn(0.04);

    expect(() => budget.reserveModelTurn(0.02)).toThrow(BudgetExceededError);
    budget.settleModelTurn(reservation, 0.01);
    expect(() => budget.reserveModelTurn(0.04)).not.toThrow();
  });

  it('rejects a second model reservation when the model-turn limit is one', () => {
    const budget = new RepairBudget({ ...DEFAULT_REPAIR_BUDGET_LIMITS, modelTurns: 1 });
    budget.reserveModelTurn(0.01);
    expect(() => budget.reserveModelTurn(0.01)).toThrowError(new BudgetExceededError('modelTurns'));
  });

  it('rejects a 65,537-byte diff', () => {
    const budget = new RepairBudget();
    expect(() => budget.assertDiffBytes(65_537)).toThrowError(new BudgetExceededError('diffBytes'));
  });

  it('accepts lower limits and rejects values above the core hard maxima', () => {
    expect(repairBudgetLimits({ modelTurns: 2 })).toMatchObject({ modelTurns: 2 });
    expect(() => repairBudgetLimits({ modelTurns: 9 })).toThrow(/at most 8/u);
    expect(() => new RepairBudget({ modelTurns: 9 })).toThrow(/at most 8/u);
  });

  it('protects terminal audit capacity from repair and charges its actual work once', () => {
    const budget = new RepairBudget({ modelTurns: 3, sandboxOperations: 3, inferenceCostUsd: 0.1 });
    const audit = budget.reserveCapacity({ modelTurns: 1, sandboxOperations: 2, inferenceCostUsd: 0.04 });
    budget.reserveSandboxOperation();
    expect(() => budget.reserveSandboxOperation()).toThrow(BudgetExceededError);
    const repair = budget.reserveModelTurn(0.05);
    budget.settleModelTurn(repair, 0.01);
    budget.reserveSandboxOperation(audit);
    budget.reserveSandboxOperation(audit);
    const adjudication = budget.reserveModelTurn(0.04, audit);
    budget.settleModelTurn(adjudication, 0.02);
    budget.releaseCapacity(audit);
    expect(budget.snapshot()).toMatchObject({ modelTurns: 2, sandboxOperations: 3 });
    expect(budget.snapshot().inferenceCostUsd).toBeCloseTo(0.03, 10);
    expect(() => budget.reserveSandboxOperation(audit)).toThrow(/reservation/u);
  });

  it('rejects capacity reservations atomically and cannot borrow another run reserve', () => {
    const budget = new RepairBudget({ modelTurns: 1, sandboxOperations: 1 });
    expect(() => budget.reserveCapacity({ modelTurns: 1, sandboxOperations: 2 })).toThrow(BudgetExceededError);
    expect(budget.snapshot()).toMatchObject({ modelTurns: 0, sandboxOperations: 0 });
    const foreign = new RepairBudget().reserveCapacity({ sandboxOperations: 1 });
    expect(() => budget.reserveSandboxOperation(foreign)).toThrow(/reservation/u);
    expect(() => budget.reserveCapacity({ modelTurns: -1 })).toThrow(RangeError);
    expect(() => budget.reserveCapacity({ sandboxOperations: 0.5 })).toThrow(RangeError);
  });

  it('releases only unspent capacity, never spent work, including failed model reservations', () => {
    const budget = new RepairBudget();
    const reserved = budget.reserveCapacity({ modelTurns: 2, sandboxOperations: 2, inferenceCostUsd: 0.1 });
    budget.reserveModelTurn(0.04, reserved);
    budget.reserveSandboxOperation(reserved);
    budget.releaseCapacity(reserved);
    expect(budget.snapshot()).toMatchObject({ modelTurns: 1, sandboxOperations: 1, inferenceCostUsd: 0.04 });
    expect(() => budget.releaseCapacity(reserved)).toThrow(/reservation/u);
  });

  it('retains elapsed-time limits on reserved terminal capacity', () => {
    let now = 0;
    const budget = new RepairBudget({ elapsedTimeSec: 1 }, () => now);
    const reserved = budget.reserveCapacity({ sandboxOperations: 1 });
    now = 1000;
    expect(() => budget.reserveSandboxOperation(reserved)).toThrowError(new BudgetExceededError('elapsedTimeSec'));
  });

  it('protects wall time for terminal work while retaining the global deadline', () => {
    let now = 0;
    const budget = new RepairBudget({ elapsedTimeSec: 100 }, () => now);
    const audit = budget.reserveCapacity({ elapsedTimeSec: 40, modelTurns: 1, inferenceCostUsd: 0.01 });
    expect(budget.remainingElapsedTimeSec()).toBe(60);
    expect(budget.remainingElapsedTimeSec(audit)).toBe(100);
    now = 60_000;
    expect(() => budget.reserveModelTurn(0.01)).toThrowError(new BudgetExceededError('elapsedTimeSec'));
    expect(() => budget.reserveModelTurn(0.01, audit)).not.toThrow();
    now = 100_000;
    expect(budget.remainingElapsedTimeSec(audit)).toBe(0);
    expect(() => budget.reserveSandboxOperation(audit)).toThrowError(new BudgetExceededError('elapsedTimeSec'));
  });

  it('cannot reserve overlapping wall-time capacity or use a foreign time lease', () => {
    const budget = new RepairBudget({ elapsedTimeSec: 100 });
    budget.reserveCapacity({ elapsedTimeSec: 60 });
    expect(() => budget.reserveCapacity({ elapsedTimeSec: 41 })).toThrowError(new BudgetExceededError('elapsedTimeSec'));
    const other = new RepairBudget().reserveCapacity({ elapsedTimeSec: 1 });
    expect(() => budget.remainingElapsedTimeSec(other)).toThrow(/reservation/u);
  });
});
