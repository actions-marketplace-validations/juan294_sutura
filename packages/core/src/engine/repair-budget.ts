export interface RepairBudgetLimits {
  modelTurns: number;
  toolCalls: number;
  branches: number;
  sandboxOperations: number;
  elapsedTimeSec: number;
  inferenceCostUsd: number;
  /** Separate from inferenceCostUsd: caps the optional GPT-6 Astra veto-only second opinion. */
  secondOpinionUsd: number;
  /** Separate cap for the optional TypeSafe Jev calibrated audit. */
  typesafeAuditUsd: number;
  diffBytes: number;
}

export const DEFAULT_REPAIR_BUDGET_LIMITS = Object.freeze({
  modelTurns: 8,
  toolCalls: 24,
  branches: 12,
  sandboxOperations: 32,
  elapsedTimeSec: 600,
  inferenceCostUsd: 0.25,
  secondOpinionUsd: 0.30,
  typesafeAuditUsd: 0.02,
  diffBytes: 65_536,
}) satisfies Readonly<RepairBudgetLimits>;

export type RepairBudgetOverrides = Partial<RepairBudgetLimits>;

export class BudgetExceededError extends Error {
  constructor(readonly budget: keyof RepairBudgetLimits) {
    super(`Repair ${budget} budget is exhausted`);
    this.name = 'BudgetExceededError';
  }
}

function boundedLimit<K extends keyof RepairBudgetLimits>(
  key: K,
  value: number | undefined,
): number {
  const maximum = DEFAULT_REPAIR_BUDGET_LIMITS[key];
  const resolved = value ?? maximum;
  if (!Number.isFinite(resolved) || resolved <= 0 || resolved > maximum) {
    throw new RangeError(`Repair ${key} must be greater than 0 and at most ${maximum}`);
  }
  if (
    key !== 'inferenceCostUsd' && key !== 'secondOpinionUsd' && key !== 'typesafeAuditUsd' &&
    !Number.isSafeInteger(resolved)
  ) {
    throw new RangeError(`Repair ${key} must be an integer`);
  }
  return resolved;
}

export function repairBudgetLimits(
  overrides: RepairBudgetOverrides = {},
): RepairBudgetLimits {
  return {
    modelTurns: boundedLimit('modelTurns', overrides.modelTurns),
    toolCalls: boundedLimit('toolCalls', overrides.toolCalls),
    branches: boundedLimit('branches', overrides.branches),
    sandboxOperations: boundedLimit('sandboxOperations', overrides.sandboxOperations),
    elapsedTimeSec: boundedLimit('elapsedTimeSec', overrides.elapsedTimeSec),
    inferenceCostUsd: boundedLimit('inferenceCostUsd', overrides.inferenceCostUsd),
    secondOpinionUsd: boundedLimit('secondOpinionUsd', overrides.secondOpinionUsd),
    typesafeAuditUsd: boundedLimit('typesafeAuditUsd', overrides.typesafeAuditUsd),
    diffBytes: boundedLimit('diffBytes', overrides.diffBytes),
  };
}

export interface ModelTurnReservation {
  readonly id: number;
  readonly reservedUsd: number;
}

export interface SecondOpinionReservation {
  readonly id: number;
  readonly reservedUsd: number;
}

export interface TypeSafeAuditReservation {
  readonly id: number;
  readonly reservedUsd: number;
}

const CAPACITY_KEYS = ['modelTurns', 'toolCalls', 'branches', 'sandboxOperations', 'inferenceCostUsd', 'elapsedTimeSec'] as const;
type CapacityKey = typeof CAPACITY_KEYS[number];
export type RepairCapacity = Partial<Pick<RepairBudgetLimits, CapacityKey>>;
/** Capability valid only in the issuing budget; serialized lookalikes have no authority. */
export interface RepairCapacityReservation { readonly id: number }

export interface RepairBudgetSnapshot {
  modelTurns: number;
  toolCalls: number;
  branches: number;
  sandboxOperations: number;
  elapsedTimeSec: number;
  inferenceCostUsd: number;
  secondOpinionUsd: number;
  typesafeAuditUsd: number;
}

export class RepairBudget {
  readonly limits: Readonly<RepairBudgetLimits>;
  private modelTurns = 0;
  private toolCalls = 0;
  private branches = 0;
  private sandboxOperations = 0;
  private inferenceCostUsd = 0;
  private secondOpinionUsd = 0;
  private typesafeAuditUsd = 0;
  private nextReservationId = 1;
  private readonly unsettled = new Map<number, number>();
  private readonly unsettledSecondOpinion = new Map<number, number>();
  private readonly unsettledTypeSafeAudit = new Map<number, number>();
  private readonly held = new Map<RepairCapacityReservation, Record<CapacityKey, number>>();
  private readonly startedAt: number;

  constructor(
    limits: RepairBudgetOverrides = DEFAULT_REPAIR_BUDGET_LIMITS,
    private readonly now: () => number = Date.now,
  ) {
    this.limits = repairBudgetLimits(limits);
    this.startedAt = now();
  }

  private assertElapsed(reservation?: RepairCapacityReservation): void {
    if (this.remainingElapsedTimeSec(reservation) <= 0) {
      throw new BudgetExceededError('elapsedTimeSec');
    }
  }

  private reserveCount(
    key: 'toolCalls' | 'branches' | 'sandboxOperations',
    reservation?: RepairCapacityReservation,
  ): void {
    this.assertElapsed(reservation);
    if (reservation !== undefined) {
      const remaining = this.capacityFor(reservation);
      if (remaining[key] < 1) throw new BudgetExceededError(key);
      remaining[key] -= 1;
    } else if (this.committed(key) >= this.limits[key]) throw new BudgetExceededError(key);
    this[key] += 1;
  }

  private committed(key: CapacityKey): number {
    const spent = key === 'elapsedTimeSec' ? Math.max(0, (this.now() - this.startedAt) / 1_000) : this[key];
    return spent + [...this.held.values()].reduce((sum, capacity) => sum + capacity[key], 0);
  }

  private capacityFor(reservation: RepairCapacityReservation): Record<CapacityKey, number> {
    const remaining = this.held.get(reservation);
    if (!remaining) throw new Error('Capacity reservation is not active in this run');
    return remaining;
  }

  reserveCapacity(capacity: RepairCapacity): RepairCapacityReservation {
    this.assertElapsed();
    if (Object.keys(capacity).some((key) => !CAPACITY_KEYS.includes(key as CapacityKey))) {
      throw new RangeError('Capacity reservation contains an unknown resource');
    }
    const remaining = {} as Record<CapacityKey, number>;
    for (const key of CAPACITY_KEYS) {
      const value = capacity[key] ?? 0;
      if (!Number.isFinite(value) || value < 0 || (key !== 'inferenceCostUsd' && !Number.isSafeInteger(value))) {
        throw new RangeError('Capacity reservation must contain bounded nonnegative resources');
      }
      if (this.committed(key) + value > this.limits[key]) throw new BudgetExceededError(key);
      remaining[key] = value;
    }
    const reservation = Object.freeze({ id: this.nextReservationId++ });
    this.held.set(reservation, remaining);
    return reservation;
  }

  releaseCapacity(reservation: RepairCapacityReservation): void {
    this.capacityFor(reservation);
    this.held.delete(reservation);
  }

  reserveToolCall(reservation?: RepairCapacityReservation): void { this.reserveCount('toolCalls', reservation); }
  reserveBranch(reservation?: RepairCapacityReservation): void { this.reserveCount('branches', reservation); }
  reserveSandboxOperation(reservation?: RepairCapacityReservation): void { this.reserveCount('sandboxOperations', reservation); }

  reserveModelTurn(worstCaseUsd: number, capacity?: RepairCapacityReservation): ModelTurnReservation {
    this.assertElapsed(capacity);
    if (!Number.isFinite(worstCaseUsd) || worstCaseUsd <= 0) {
      throw new RangeError('Worst-case model cost must be positive');
    }
    const remaining = capacity === undefined ? undefined : this.capacityFor(capacity);
    if (remaining ? remaining.modelTurns < 1 : this.committed('modelTurns') >= this.limits.modelTurns) {
      throw new BudgetExceededError('modelTurns');
    }
    if (remaining ? worstCaseUsd > remaining.inferenceCostUsd + 1e-12 : this.committed('inferenceCostUsd') + worstCaseUsd > this.limits.inferenceCostUsd) {
      throw new BudgetExceededError('inferenceCostUsd');
    }
    if (remaining) {
      remaining.modelTurns -= 1;
      remaining.inferenceCostUsd = Math.max(0, remaining.inferenceCostUsd - worstCaseUsd);
    }
    this.modelTurns += 1;
    this.inferenceCostUsd += worstCaseUsd;
    const reservation = { id: this.nextReservationId, reservedUsd: worstCaseUsd };
    this.nextReservationId += 1;
    this.unsettled.set(reservation.id, worstCaseUsd);
    return reservation;
  }

  settleModelTurn(reservation: ModelTurnReservation, actualUsd: number): void {
    const reserved = this.unsettled.get(reservation.id);
    if (reserved === undefined) throw new Error('Model turn reservation is not active');
    if (!Number.isFinite(actualUsd) || actualUsd < 0 || actualUsd > reserved) {
      throw new RangeError('Actual model cost must be between zero and the reservation');
    }
    this.unsettled.delete(reservation.id);
    this.inferenceCostUsd -= reserved - actualUsd;
  }

  /** Independent of inferenceCostUsd: caps only the optional veto-only second opinion. */
  reserveSecondOpinion(worstCaseUsd: number): SecondOpinionReservation {
    this.assertElapsed();
    if (!Number.isFinite(worstCaseUsd) || worstCaseUsd <= 0) {
      throw new RangeError('Worst-case second-opinion cost must be positive');
    }
    if (this.secondOpinionUsd + worstCaseUsd > this.limits.secondOpinionUsd) {
      throw new BudgetExceededError('secondOpinionUsd');
    }
    this.secondOpinionUsd += worstCaseUsd;
    const reservation = { id: this.nextReservationId, reservedUsd: worstCaseUsd };
    this.nextReservationId += 1;
    this.unsettledSecondOpinion.set(reservation.id, worstCaseUsd);
    return reservation;
  }

  settleSecondOpinion(reservation: SecondOpinionReservation, actualUsd: number): void {
    const reserved = this.unsettledSecondOpinion.get(reservation.id);
    if (reserved === undefined) throw new Error('Second-opinion reservation is not active');
    if (!Number.isFinite(actualUsd) || actualUsd < 0 || actualUsd > reserved) {
      throw new RangeError('Actual second-opinion cost must be between zero and the reservation');
    }
    this.unsettledSecondOpinion.delete(reservation.id);
    this.secondOpinionUsd -= reserved - actualUsd;
  }

  /** Independent of inferenceCostUsd and secondOpinionUsd: caps only the optional TypeSafe Jev calibrated audit. */
  reserveTypeSafeAudit(worstCaseUsd: number): TypeSafeAuditReservation {
    this.assertElapsed();
    if (!Number.isFinite(worstCaseUsd) || worstCaseUsd <= 0) {
      throw new RangeError('Worst-case TypeSafe audit cost must be positive');
    }
    if (this.typesafeAuditUsd + worstCaseUsd > this.limits.typesafeAuditUsd) {
      throw new BudgetExceededError('typesafeAuditUsd');
    }
    this.typesafeAuditUsd += worstCaseUsd;
    const reservation = { id: this.nextReservationId, reservedUsd: worstCaseUsd };
    this.nextReservationId += 1;
    this.unsettledTypeSafeAudit.set(reservation.id, worstCaseUsd);
    return reservation;
  }

  settleTypeSafeAudit(reservation: TypeSafeAuditReservation, actualUsd: number): void {
    const reserved = this.unsettledTypeSafeAudit.get(reservation.id);
    if (reserved === undefined) throw new Error('TypeSafe audit reservation is not active');
    if (!Number.isFinite(actualUsd) || actualUsd < 0 || actualUsd > reserved) {
      throw new RangeError('Actual TypeSafe audit cost must be between zero and the reservation');
    }
    this.unsettledTypeSafeAudit.delete(reservation.id);
    this.typesafeAuditUsd -= reserved - actualUsd;
  }

  assertDiffBytes(bytes: number): void {
    this.assertElapsed();
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.limits.diffBytes) {
      throw new BudgetExceededError('diffBytes');
    }
  }

  remainingElapsedTimeSec(reservation?: RepairCapacityReservation): number {
    if (reservation !== undefined) this.capacityFor(reservation);
    const protectedTime = [...this.held].reduce((sum, [owner, capacity]) => sum + (owner === reservation ? 0 : capacity.elapsedTimeSec), 0);
    return Math.max(
      0,
      this.limits.elapsedTimeSec - (this.now() - this.startedAt) / 1_000 - protectedTime,
    );
  }

  snapshot(): RepairBudgetSnapshot {
    return {
      modelTurns: this.committed('modelTurns'),
      toolCalls: this.committed('toolCalls'),
      branches: this.committed('branches'),
      sandboxOperations: this.committed('sandboxOperations'),
      elapsedTimeSec: Math.max(0, (this.now() - this.startedAt) / 1_000),
      inferenceCostUsd: this.committed('inferenceCostUsd'),
      secondOpinionUsd: this.secondOpinionUsd,
      typesafeAuditUsd: this.typesafeAuditUsd,
    };
  }
}
