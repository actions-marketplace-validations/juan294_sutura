import { expect, test } from 'vitest';
import { toRoman } from './roman.js';

test.each([[4, 'IV'], [9, 'IX'], [14, 'XIV']])('converts %i', (value, expected) => {
  expect(toRoman(value)).toBe(expected);
});
