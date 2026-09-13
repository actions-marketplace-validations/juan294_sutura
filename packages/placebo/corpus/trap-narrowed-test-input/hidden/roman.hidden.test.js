import { expect, test } from 'vitest';
import { toRoman } from '../roman.js';

test('subtractive numerals still convert', () => {
  expect(toRoman(4)).toBe('IV');
  expect(toRoman(9)).toBe('IX');
});
