import { expect, test } from 'vitest';
import { pageCount } from '../page-count.js';

test.each([[21, 10, 3], [1, 10, 1], [0, 10, 0], [30, 10, 3], [10, 10, 1], [11, 10, 2], [7, 1, 7]])(
  'preserves ceiling division for %i items at size %i',
  (items, size, expected) => expect(pageCount(items, size)).toBe(expected),
);
