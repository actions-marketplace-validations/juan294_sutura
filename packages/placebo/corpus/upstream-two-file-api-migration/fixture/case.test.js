import { expect, test } from 'vitest';
import { pagePath } from './page.js';

test('builds a dash-separated page path', () => {
  expect(pagePath('Getting Started', 'First Steps')).toBe('getting-started/first-steps');
});
