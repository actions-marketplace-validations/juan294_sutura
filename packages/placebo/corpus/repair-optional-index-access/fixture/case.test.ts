import { expect, test } from 'vitest';
import { firstWord } from './first-word.js';

test('returns an empty string for no words', () => expect(firstWord('')).toBe(''));
