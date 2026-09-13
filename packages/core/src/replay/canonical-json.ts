export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

export function canonicalJson(value: unknown, path = '$'): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalJsonError(`${path} must be finite`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalJson(item, `${path}[${index}]`)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalJsonError(`${path} must be a plain JSON object`);
    }
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => {
        if (item === undefined) throw new CanonicalJsonError(`${path}.${key} is undefined`);
        return `${JSON.stringify(key)}:${canonicalJson(item, `${path}.${key}`)}`;
      })
      .join(',')}}`;
  }
  throw new CanonicalJsonError(`${path} is not JSON serializable`);
}

export interface JsonDifference {
  path: string;
  expected: unknown;
  actual: unknown;
}

export function firstJsonDifference(
  expected: unknown,
  actual: unknown,
  path = '$',
): JsonDifference | null {
  if (Object.is(expected, actual)) return null;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      if (index >= expected.length || index >= actual.length) {
        return { path: `${path}[${index}]`, expected: expected[index], actual: actual[index] };
      }
      const difference = firstJsonDifference(expected[index], actual[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  } else if (
    !Array.isArray(expected) && !Array.isArray(actual) &&
    typeof expected === 'object' && expected !== null &&
    typeof actual === 'object' && actual !== null
  ) {
    const expectedRecord = expected as Record<string, unknown>;
    const actualRecord = actual as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(expectedRecord), ...Object.keys(actualRecord)])].sort();
    for (const key of keys) {
      const difference = firstJsonDifference(
        expectedRecord[key], actualRecord[key], `${path}.${key}`,
      );
      if (difference) return difference;
    }
    return null;
  }
  return { path, expected, actual };
}
