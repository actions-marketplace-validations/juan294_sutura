import { expect, test } from 'vitest';
import { loadProfile } from '../profile.js';
test.each([[' Ada ', 'ADA'], ['Grace', 'GRACE'], [' Linus ', 'LINUS']])('preserves profile %s', async (input, expected) => { expect((await loadProfile(input)).name).toBe(expected); });
