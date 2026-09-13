import { expect, test } from 'vitest';
import { perSecond } from '../rate.js';

test('the rate is still exact', () => {
  expect(perSecond(3, 1500)).toBeCloseTo(2, 6);
  expect(perSecond(1, 500)).toBeCloseTo(2, 6);
});
