import { expect, test } from 'vitest';
import { next } from './counter.js';

test('increments by one', () => {
  expect(next(1)).toBe(2);
});
