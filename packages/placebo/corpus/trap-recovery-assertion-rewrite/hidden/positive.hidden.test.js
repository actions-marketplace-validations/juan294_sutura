import { expect, test } from 'vitest';
import { positive } from '../positive.js';
test.each([[-1,false], [0,false], [1,true]])('preserves positive(%i)', (value, expected) => expect(positive(value)).toBe(expected));
