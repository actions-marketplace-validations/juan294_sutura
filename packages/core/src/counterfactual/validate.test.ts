import { describe, expect, it } from 'vitest';

import {
  MAX_COUNTERFACTUAL_DIFF_BYTES,
  type CounterfactualAlternative,
} from './types.js';
import {
  CounterfactualValidationError,
  validateCounterfactualAlternatives,
} from './validate.js';

function diff(path: string, replacement: string): string {
  return `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-const total = 1;
+${replacement}
`;
}

const SHORTCUT: CounterfactualAlternative = {
  id: 'loosen-type',
  intent: 'shortcut',
  rationale: 'Casts the result to any instead of fixing the boundary.',
  diff: diff('src/cart.ts', 'const total = 1 as any;'),
};

const PLAUSIBLE: CounterfactualAlternative = {
  id: 'wrong-boundary',
  intent: 'plausible',
  rationale: 'Adjusts the wrong boundary.',
  diff: diff('src/cart.ts', 'const total = 2;'),
};

const THIRD: CounterfactualAlternative = {
  id: 'wrong-rounding',
  intent: 'plausible',
  rationale: 'Rounds instead of flooring.',
  diff: diff('src/cart.ts', 'const total = 3;'),
};

function refusal(value: unknown): string {
  try {
    validateCounterfactualAlternatives(value);
  } catch (error) {
    expect(error).toBeInstanceOf(CounterfactualValidationError);
    return (error as Error).message;
  }
  throw new Error('expected a refusal');
}

describe('counterfactual alternative validation', () => {
  it('accepts a two-entry and a three-entry set with at least one shortcut', () => {
    expect(validateCounterfactualAlternatives([SHORTCUT, PLAUSIBLE])).toHaveLength(2);
    expect(validateCounterfactualAlternatives([SHORTCUT, PLAUSIBLE, THIRD])).toHaveLength(3);
  });

  it('refuses a set that is not an array or has the wrong size', () => {
    expect(refusal('nope')).toBe('alternatives must be an array');
    expect(refusal([SHORTCUT])).toContain('from 2 to 3 entries');
    expect(refusal([SHORTCUT, PLAUSIBLE, THIRD, { ...THIRD, id: 'fourth' }]))
      .toContain('from 2 to 3 entries');
  });

  it('refuses a set with no shortcut', () => {
    expect(refusal([PLAUSIBLE, THIRD]))
      .toBe('alternatives must include at least one shortcut');
  });

  it('refuses duplicate ids, rationales, and diffs', () => {
    expect(refusal([SHORTCUT, { ...PLAUSIBLE, id: SHORTCUT.id }]))
      .toBe('alternative ids must be distinct');
    expect(refusal([SHORTCUT, { ...PLAUSIBLE, rationale: SHORTCUT.rationale }]))
      .toBe('alternative rationales must be distinct');
    expect(refusal([SHORTCUT, { ...PLAUSIBLE, diff: SHORTCUT.diff }]))
      .toBe('alternative diffs must be distinct');
  });

  it('refuses a malformed entry', () => {
    expect(refusal([null, PLAUSIBLE])).toBe('alternatives[0] must be an object');
    expect(refusal([{ ...SHORTCUT, extra: 1 }, PLAUSIBLE]))
      .toBe('alternatives[0] has an unsupported field: extra');
    expect(refusal([{ ...SHORTCUT, id: 'Not An Id' }, PLAUSIBLE]))
      .toContain('alternatives[0].id must match');
    expect(refusal([{ ...SHORTCUT, intent: 'clever' }, PLAUSIBLE]))
      .toBe('alternatives[0].intent must be one of plausible, shortcut');
    expect(refusal([{ ...SHORTCUT, rationale: '  ' }, PLAUSIBLE]))
      .toBe('alternatives[0].rationale must be a non-empty string');
    expect(refusal([{ ...SHORTCUT, rationale: 'x'.repeat(241) }, PLAUSIBLE]))
      .toContain('at most 240 characters');
  });

  it('refuses a diff that is empty, oversized, or not a unified diff', () => {
    expect(refusal([{ ...SHORTCUT, diff: '' }, PLAUSIBLE]))
      .toBe('alternatives[0].diff must be a non-empty string');
    expect(refusal([{ ...SHORTCUT, diff: 'just some text' }, PLAUSIBLE]))
      .toContain('alternatives[0].diff must be a valid unified diff');
    const oversized = diff('src/cart.ts', 'x'.repeat(MAX_COUNTERFACTUAL_DIFF_BYTES));
    expect(refusal([{ ...SHORTCUT, diff: oversized }, PLAUSIBLE]))
      .toContain(`permits at most ${MAX_COUNTERFACTUAL_DIFF_BYTES}`);
  });
});
