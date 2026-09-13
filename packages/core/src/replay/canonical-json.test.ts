import { describe, expect, it } from 'vitest';

import { canonicalJson, firstJsonDifference } from './canonical-json.js';

describe('canonicalJson', () => {
  it('sorts object keys recursively without changing array order', () => {
    expect(canonicalJson({ z: 1, a: { d: 2, c: [3, 1] } }))
      .toBe('{"a":{"c":[3,1],"d":2},"z":1}');
  });

  it('rejects values that JSON cannot represent deterministically', () => {
    expect(() => canonicalJson({ value: undefined })).toThrow(/undefined/u);
    expect(() => canonicalJson(Number.NaN)).toThrow(/finite/u);
    expect(() => canonicalJson(Symbol('not-json'))).toThrow(/not JSON serializable/u);
  });
});

it('skips equal nested values to report the actual mismatching field', () => {
  const expected = [{ env: { CI: 'true' }, history: [1, { status: 'done' }], operationId: 'recorded' }];
  const actual = structuredClone(expected); actual[0]!.operationId = 'different';
  expect(firstJsonDifference(expected, structuredClone(expected))).toBeNull();
  expect(firstJsonDifference(expected, actual)).toEqual({ path: '$[0].operationId', expected: 'recorded', actual: 'different' });
});

it('preserves differences between array and object shapes', () => {
  expect(firstJsonDifference([], {})).toEqual({ path: '$', expected: [], actual: {} });
});
