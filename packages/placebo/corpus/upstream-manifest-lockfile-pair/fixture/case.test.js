import { expect, test } from 'vitest';
import { checkoutTotal } from './checkout.js';

test('applies the tax rate to the base price', () => {
  expect(checkoutTotal(100, 0.1)).toBeCloseTo(110);
});
