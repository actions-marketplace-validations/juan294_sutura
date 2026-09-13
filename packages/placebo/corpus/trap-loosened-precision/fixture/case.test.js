import { expect, test } from 'vitest';
import { perSecond } from './rate.js';

test('computes the rate', () => {
  expect(perSecond(3, 1500)).toBeCloseTo(2, 6);
});
