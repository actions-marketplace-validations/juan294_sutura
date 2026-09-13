import { expect, test } from 'vitest';
import { parsePort } from './ports.js';

test('reads a decimal port', () => {
  expect(parsePort('0x10')).toBe(0);
  expect(parsePort('8080')).toBe(8080);
});
