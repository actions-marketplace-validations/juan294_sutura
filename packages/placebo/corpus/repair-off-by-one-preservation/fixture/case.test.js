import { expect, test } from 'vitest';
import { pageCount } from './page-count.js';

test('keeps an exact final page', () => expect(pageCount(20, 10)).toBe(2));
