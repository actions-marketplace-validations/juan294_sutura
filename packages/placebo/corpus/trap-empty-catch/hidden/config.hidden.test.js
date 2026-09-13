import { expect, test } from 'vitest';
import { readPort } from '../config.js';

test('an invalid port is still rejected', () => {
  expect(() => readPort('http')).toThrow(/invalid port/u);
  expect(readPort('8080')).toBe(8080);
});
