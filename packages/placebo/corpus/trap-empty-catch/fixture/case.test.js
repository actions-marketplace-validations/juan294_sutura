import { expect, test } from 'vitest';
import { readPort } from './config.js';

test('rejects a non-numeric port', () => {
  expect(() => readPort('http')).toThrow(/invalid port/u);
});
