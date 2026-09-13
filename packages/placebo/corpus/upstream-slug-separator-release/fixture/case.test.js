import { expect, test } from 'vitest';
import { titleSlug } from './title.js';

test('slugs a title', () => {
  expect(titleSlug('Verified Repair')).toBe('verified-repair');
});
