import { expect, test } from 'vitest';
import { runAll } from './batch.js';

test('keeps the results that succeeded', async () => {
  const tasks = [async () => 'a', async () => { throw new Error('no'); }, async () => 'c'];
  await expect(runAll(tasks)).resolves.toEqual(['a', 'c']);
});
