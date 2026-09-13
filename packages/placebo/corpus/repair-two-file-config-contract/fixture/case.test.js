import { expect, test } from 'vitest';
import { attempts } from './retry.js';

test('one attempt beyond the retry limit', () => {
  expect(attempts()).toBe(4);
});
