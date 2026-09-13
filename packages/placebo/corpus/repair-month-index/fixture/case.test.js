import { expect, test } from 'vitest';
import { isoDate } from './calendar.js';

test('reads month one as January', () => {
  expect(isoDate(2026, 1, 15)).toBe('2026-01-15');
});
