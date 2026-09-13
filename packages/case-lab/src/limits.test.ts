import { describe, expect, it } from 'vitest';

import {
  CASE_LAB_LIMITS,
  caseLabDispatchDecision,
  retryAfterSeconds,
  runsInLastHour,
  runsToday,
} from './limits.js';

const open = { enabled: true, activeRuns: 0, runsInLastHour: 0, runsToday: 0 };

describe('caseLabDispatchDecision', () => {
  it('derives the daily run cap from the daily spend stop and the worst-case run cost', () => {
    expect(CASE_LAB_LIMITS.maxRunsPerDay).toBe(Math.floor(CASE_LAB_LIMITS.dailySpendStopUsd / CASE_LAB_LIMITS.worstCaseRunUsd));
    expect(CASE_LAB_LIMITS).toEqual({
      maxConcurrentRuns: 1,
      maxRunsPerHour: 4,
      worstCaseRunUsd: 0.75,
      dailySpendStopUsd: 6,
      maxRunsPerDay: 8,
    });
    expect(Object.isFrozen(CASE_LAB_LIMITS)).toBe(true);
  });

  it('allows a dispatch inside every limit', () => {
    expect(caseLabDispatchDecision(open)).toEqual({ allowed: true });
    expect(caseLabDispatchDecision({ ...open, runsInLastHour: 3, runsToday: 7 })).toEqual({ allowed: true });
  });

  it('refuses in a fixed order: disabled, concurrency, hourly throttle, daily spend stop', () => {
    expect(caseLabDispatchDecision({ ...open, enabled: false, activeRuns: 1, runsInLastHour: 4, runsToday: 8 }))
      .toEqual({ allowed: false, reason: 'disabled' });
    expect(caseLabDispatchDecision({ ...open, activeRuns: 1, runsInLastHour: 4, runsToday: 8 }))
      .toEqual({ allowed: false, reason: 'concurrency' });
    expect(caseLabDispatchDecision({ ...open, runsInLastHour: 4, runsToday: 8 }))
      .toEqual({ allowed: false, reason: 'hourly-throttle' });
    expect(caseLabDispatchDecision({ ...open, runsToday: 8 }))
      .toEqual({ allowed: false, reason: 'daily-spend-stop' });
  });

  it('treats anything but literal true as disabled', () => {
    for (const enabled of ['true', 1, {}, undefined, null] as unknown[]) {
      expect(caseLabDispatchDecision({ ...open, enabled: enabled as boolean })).toEqual({ allowed: false, reason: 'disabled' });
    }
  });

  it('fails closed on invalid counts and limits', () => {
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1' as unknown as number]) {
      expect(() => caseLabDispatchDecision({ ...open, activeRuns: value })).toThrow('activeRuns must be a nonnegative integer');
      expect(() => caseLabDispatchDecision({ ...open, runsInLastHour: value })).toThrow('runsInLastHour must be a nonnegative integer');
      expect(() => caseLabDispatchDecision({ ...open, runsToday: value })).toThrow('runsToday must be a nonnegative integer');
    }
    expect(() => caseLabDispatchDecision(open, { ...CASE_LAB_LIMITS, maxRunsPerDay: 9 }))
      .toThrow('maxRunsPerDay must equal floor(dailySpendStopUsd / worstCaseRunUsd)');
    expect(() => caseLabDispatchDecision(open, { ...CASE_LAB_LIMITS, maxConcurrentRuns: 0 }))
      .toThrow('maxConcurrentRuns must be a positive integer');
    expect(() => caseLabDispatchDecision(open, { ...CASE_LAB_LIMITS, worstCaseRunUsd: 0 }))
      .toThrow('worstCaseRunUsd must be a positive number');
  });
});

describe('run counting', () => {
  const now = new Date('2026-09-04T12:30:00.000Z');

  it('counts runs in the current UTC day and in the last rolling hour', () => {
    const runs = [
      { createdAt: '2026-09-03T23:59:59.000Z' },
      { createdAt: '2026-09-04T00:00:00.000Z' },
      { createdAt: '2026-09-04T11:29:59.000Z' },
      { createdAt: '2026-09-04T11:30:00.000Z' },
      { createdAt: '2026-09-04T12:29:00.000Z' },
    ];
    expect(runsToday(runs, now)).toBe(4);
    expect(runsInLastHour(runs, now)).toBe(2);
  });

  it('fails closed on an unparseable timestamp', () => {
    expect(() => runsToday([{ createdAt: 'yesterday' }], now)).toThrow('run createdAt must be an ISO 8601 timestamp');
    expect(() => runsInLastHour([{ createdAt: '' }], now)).toThrow('run createdAt must be an ISO 8601 timestamp');
  });

  it('suggests a retry delay per refusal reason', () => {
    expect(retryAfterSeconds('concurrency', now)).toBe(120);
    expect(retryAfterSeconds('hourly-throttle', now)).toBe(900);
    expect(retryAfterSeconds('daily-spend-stop', now)).toBe(11.5 * 3_600);
    expect(retryAfterSeconds('disabled', now)).toBe(3_600);
  });
});
