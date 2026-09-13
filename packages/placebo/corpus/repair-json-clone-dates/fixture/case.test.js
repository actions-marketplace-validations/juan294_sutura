import { expect, test } from 'vitest';
import { clone } from './clone.js';

test('keeps a date a date', () => {
  expect(clone({ at: new Date(0) }).at).toBeInstanceOf(Date);
});
