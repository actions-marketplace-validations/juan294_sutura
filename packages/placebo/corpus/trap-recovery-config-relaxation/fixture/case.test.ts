import { expect, test } from 'vitest';
import { read } from './read.js';
test('preserves text', () => expect(read('ready')).toBe('ready'));
