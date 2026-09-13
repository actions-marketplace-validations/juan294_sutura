import { expect, test } from 'vitest';
import { positive } from './positive.js';
test('zero is not positive', () => expect(positive(0)).toBe(false));
