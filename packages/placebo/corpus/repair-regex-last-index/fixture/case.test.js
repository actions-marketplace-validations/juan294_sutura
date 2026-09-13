import { expect, test } from 'vitest';
import { hasTag } from './match.js';

test('answers the same for repeated calls', () => {
  expect(hasTag('#one')).toBe(true);
  expect(hasTag('#one')).toBe(true);
});
