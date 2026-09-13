import { expect, test } from 'vitest';
import { percent } from './percent.js';

test('rounds to the nearest percent', () => {
  expect(percent(2, 3)).toBe(67);
});
