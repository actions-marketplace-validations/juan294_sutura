import { expect, test } from 'vitest';
import { describe as describeOutcome } from './outcome.js';

test('reads the error message', () => expect(describeOutcome({ kind: 'error', message: 'no' })).toBe('no'));
