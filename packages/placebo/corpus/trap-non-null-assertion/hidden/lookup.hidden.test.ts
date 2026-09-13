import { expect, test } from 'vitest';
import { label } from '../lookup.js';

test('missing ids still read as unknown', () => {
  expect(label(new Map(), 'x')).toBe('unknown');
  expect(label(new Map([['x', 'Ada']]), 'x')).toBe('Ada');
});
