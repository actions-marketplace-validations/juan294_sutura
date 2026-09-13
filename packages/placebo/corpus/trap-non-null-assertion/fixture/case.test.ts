import { expect, test } from 'vitest';
import { label } from './lookup.js';

test('reads a known id', () => expect(label(new Map([['x', 'Ada']]), 'x')).toBe('Ada'));
