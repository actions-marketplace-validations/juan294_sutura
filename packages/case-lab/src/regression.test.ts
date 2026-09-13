import { describe, expect, it } from 'vitest';

import {
  buildTwoPatchComparison,
  RegressionComparisonError,
  renderTwoPatchComparison,
  type ComparisonArm,
  type IndependentCheck,
} from './regression.js';

const BASELINE = { sourceSha: 'a'.repeat(40), snapshotSha256: 'b'.repeat(64) };
const CORRECT: ComparisonArm = {
  label: 'correct repair', diffSha256: 'c'.repeat(64), visibleTestPassed: true,
};
const GREEN_BUT_BROKEN: ComparisonArm = {
  label: 'green but broken', diffSha256: 'd'.repeat(64), visibleTestPassed: true,
};

/** 21 items at 10 per page needs 3 pages; the floor-only patch says 2. */
const CHECKS: IndependentCheck[] = [
  {
    id: 'partial-page',
    description: '21 items, 10 per page',
    expected: '3',
    observed: ['3', '2'],
  },
  {
    id: 'exact-boundary',
    description: '20 items, 10 per page',
    expected: '2',
    observed: ['2', '2'],
  },
];

function build(overrides: Partial<Parameters<typeof buildTwoPatchComparison>[0]> = {}) {
  return buildTwoPatchComparison({
    baseline: BASELINE,
    visibleTestCommand: 'pnpm test',
    arms: [CORRECT, GREEN_BUT_BROKEN],
    checks: CHECKS,
    ...overrides,
  });
}

function reasonOf(run: () => unknown): string {
  try {
    run();
    return 'accepted';
  } catch (error) {
    expect(error).toBeInstanceOf(RegressionComparisonError);
    return (error as RegressionComparisonError).reasonCode;
  }
}

describe('two patch regression comparison', () => {
  it('binds one baseline, two exact patches and the discriminating checks', () => {
    const comparison = build();

    expect(comparison.baseline).toEqual(BASELINE);
    expect(comparison.arms.map((arm) => arm.diffSha256))
      .toEqual(['c'.repeat(64), 'd'.repeat(64)]);
    expect(comparison.discriminating).toEqual(['partial-page']);
  });

  it('refuses a comparison where no check separates the two patches', () => {
    const agreeing = CHECKS.map((check) => ({ ...check, observed: ['2', '2'] as [string, string] }));

    expect(reasonOf(() => build({ checks: agreeing }))).toBe('no-discriminating-check');
  });

  it('refuses when a patch did not pass the original test', () => {
    expect(reasonOf(() => build({
      arms: [CORRECT, { ...GREEN_BUT_BROKEN, visibleTestPassed: false }],
    }))).toBe('visible-test-not-green');
  });

  it('refuses the same patch listed twice', () => {
    expect(reasonOf(() => build({ arms: [CORRECT, { ...GREEN_BUT_BROKEN, diffSha256: CORRECT.diffSha256 }] })))
      .toBe('identical-patches');
  });

  it('refuses anything other than exactly two patches', () => {
    expect(reasonOf(() => build({ arms: [CORRECT] }))).toBe('arm-count');
    expect(reasonOf(() => build({ arms: [CORRECT, GREEN_BUT_BROKEN, CORRECT] }))).toBe('arm-count');
  });

  it('refuses an inexact baseline or diff hash', () => {
    expect(reasonOf(() => build({ baseline: { ...BASELINE, sourceSha: 'main' } })))
      .toBe('invalid-baseline');
    expect(reasonOf(() => build({ baseline: { ...BASELINE, snapshotSha256: 'short' } })))
      .toBe('invalid-baseline');
    expect(reasonOf(() => build({ arms: [CORRECT, { ...GREEN_BUT_BROKEN, diffSha256: 'abc' }] })))
      .toBe('invalid-diff-hash');
  });

  it('refuses a duplicate check id and a missing visible command', () => {
    expect(reasonOf(() => build({ checks: [CHECKS[0]!, CHECKS[0]!] }))).toBe('duplicate-check');
    expect(reasonOf(() => build({ visibleTestCommand: '  ' }))).toBe('missing-visible-command');
  });

  it('renders both hashes and marks which checks separate the patches', () => {
    const html = renderTwoPatchComparison(build());

    expect(html).toContain('c'.repeat(64));
    expect(html).toContain('d'.repeat(64));
    expect(html).toContain('class="separates"');
    expect(html).toContain('class="agrees"');
    expect(html).toContain('the test that was already there');
  });

  it('escapes rendered labels and descriptions', () => {
    const html = renderTwoPatchComparison(build({
      arms: [{ ...CORRECT, label: '<script>alert(1)</script>' }, GREEN_BUT_BROKEN],
    }));

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
