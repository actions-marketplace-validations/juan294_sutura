import { expect, test } from 'vitest';
import { loadProfile } from './profile.js';

const load = (name) => loadProfile(name);
test('waits for asynchronous helper setup with unchanged arguments', async () => {
  const profile = await load(' Ada ');
  expect(profile.name).toBe('ADA');
});
