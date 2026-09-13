import { expect, test } from 'vitest';
import { countByKey } from './index.js';

test('counts equal descriptors together', () => {
  const counts = countByKey([{ kind: 'a', name: 'x' }, { kind: 'a', name: 'x' }]);
  expect([...counts.values()]).toEqual([2]);
});
