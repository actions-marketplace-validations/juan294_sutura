export interface CaseLabLimits {
  /** Live runs allowed to be queued or in progress at once. */
  readonly maxConcurrentRuns: number;
  /** Live runs allowed in any rolling hour. */
  readonly maxRunsPerHour: number;
  /** Worst-case cost of one live run: the Action inference ceiling plus the largest observed sandbox cost, rounded up. */
  readonly worstCaseRunUsd: number;
  /** Daily spend stop in USD. */
  readonly dailySpendStopUsd: number;
  /** Live runs allowed per UTC day; equals floor(dailySpendStopUsd / worstCaseRunUsd). */
  readonly maxRunsPerDay: number;
}

/** Defaults are also ceilings: nothing configurable can raise them. */
export const CASE_LAB_LIMITS: CaseLabLimits = Object.freeze({
  maxConcurrentRuns: 1,
  maxRunsPerHour: 4,
  worstCaseRunUsd: 0.75,
  dailySpendStopUsd: 6,
  maxRunsPerDay: 8,
});

export type CaseLabRefusalReason =
  | 'disabled'
  | 'concurrency'
  | 'hourly-throttle'
  | 'daily-spend-stop';

export type CaseLabDispatchDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: CaseLabRefusalReason };

export interface DispatchWindow {
  readonly enabled: boolean;
  readonly activeRuns: number;
  readonly runsInLastHour: number;
  readonly runsToday: number;
}

export interface RunTimestamp {
  readonly createdAt: string;
}

const HOUR_MS = 60 * 60 * 1_000;

function count(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative integer`);
  }
  return value;
}

function assertLimits(limits: CaseLabLimits): void {
  for (const key of ['maxConcurrentRuns', 'maxRunsPerHour', 'maxRunsPerDay'] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) {
      throw new RangeError(`${key} must be a positive integer`);
    }
  }
  for (const key of ['worstCaseRunUsd', 'dailySpendStopUsd'] as const) {
    if (!Number.isFinite(limits[key]) || limits[key] <= 0) {
      throw new RangeError(`${key} must be a positive number`);
    }
  }
  if (limits.maxRunsPerDay !== Math.floor(limits.dailySpendStopUsd / limits.worstCaseRunUsd)) {
    throw new RangeError('maxRunsPerDay must equal floor(dailySpendStopUsd / worstCaseRunUsd)');
  }
}

/**
 * Decide whether one more live run may be dispatched. The checks run in a fixed
 * order and every invalid input refuses rather than allows.
 */
export function caseLabDispatchDecision(
  window: DispatchWindow,
  limits: CaseLabLimits = CASE_LAB_LIMITS,
): CaseLabDispatchDecision {
  assertLimits(limits);
  const activeRuns = count(window.activeRuns, 'activeRuns');
  const runsInLastHour = count(window.runsInLastHour, 'runsInLastHour');
  const runsToday = count(window.runsToday, 'runsToday');
  if (window.enabled !== true) return { allowed: false, reason: 'disabled' };
  if (activeRuns >= limits.maxConcurrentRuns) return { allowed: false, reason: 'concurrency' };
  if (runsInLastHour >= limits.maxRunsPerHour) return { allowed: false, reason: 'hourly-throttle' };
  if (runsToday >= limits.maxRunsPerDay) return { allowed: false, reason: 'daily-spend-stop' };
  return { allowed: true };
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (typeof value !== 'string' || !Number.isFinite(parsed)) {
    throw new RangeError(`${label} must be an ISO 8601 timestamp`);
  }
  return parsed;
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function runsToday(runs: readonly RunTimestamp[], now: Date): number {
  const start = startOfUtcDay(now).getTime();
  return runs.filter((run) => timestamp(run.createdAt, 'run createdAt') >= start).length;
}

export function runsInLastHour(runs: readonly RunTimestamp[], now: Date): number {
  const start = now.getTime() - HOUR_MS;
  return runs.filter((run) => timestamp(run.createdAt, 'run createdAt') >= start).length;
}

/** Seconds a refused caller should wait before trying again. */
export function retryAfterSeconds(reason: CaseLabRefusalReason, now: Date): number {
  switch (reason) {
    case 'concurrency':
      return 120;
    case 'hourly-throttle':
      return 900;
    case 'daily-spend-stop': {
      const nextDay = startOfUtcDay(now).getTime() + 24 * HOUR_MS;
      return Math.max(60, Math.ceil((nextDay - now.getTime()) / 1_000));
    }
    case 'disabled':
      return 3_600;
  }
}
