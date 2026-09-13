import { describe, expect, it } from 'vitest';

import { trimEdges, trimTrailing } from './trim-edge.js';

describe('trimTrailing', () => {
  it.each([
    ['https://example.com///', 'https://example.com'],
    ['https://example.com', 'https://example.com'],
    ['///', ''],
    ['', ''],
  ])('trims %s', (value, expected) => {
    expect(trimTrailing(value, '/')).toBe(expected);
  });

  it('stays linear on a long run of the trimmed character', () => {
    expect(trimTrailing('/'.repeat(100_000), '/')).toBe('');
  });
});

describe('trimEdges', () => {
  it.each([
    ['--case-id--', 'case-id'],
    ['case-id', 'case-id'],
    ['---', ''],
  ])('trims %s', (value, expected) => {
    expect(trimEdges(value, '-')).toBe(expected);
  });
});
