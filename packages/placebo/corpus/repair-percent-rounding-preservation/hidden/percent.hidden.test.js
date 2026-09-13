import { expect, test } from 'vitest';
import { percent } from '../percent.js';

test('the half-way boundary still rounds up', () => {
  expect(percent(1, 8)).toBe(13);
  expect(percent(2, 3)).toBe(67);
});
