import { expect, test } from 'vitest';
import { ascending } from './sorting.js';

test('orders numbers by value', () => {
  expect(ascending([10, 9, 100])).toEqual([9, 10, 100]);
});
