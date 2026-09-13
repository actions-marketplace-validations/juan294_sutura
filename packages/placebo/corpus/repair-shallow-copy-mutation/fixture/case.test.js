import { expect, test } from 'vitest';
import { withRetries } from './settings.js';

test('leaves the original untouched', () => {
  const original = { limits: { retries: 1 } };
  withRetries(original, 9);
  expect(original.limits.retries).toBe(1);
});
