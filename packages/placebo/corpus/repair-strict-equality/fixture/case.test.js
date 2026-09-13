import { expect, test } from 'vitest';
import { isEnabled } from './flags.js';

test('only true enables the flag', () => {
  expect(isEnabled('true')).toBe(true);
  expect(isEnabled(1)).toBe(false);
  expect(isEnabled('')).toBe(false);
});
