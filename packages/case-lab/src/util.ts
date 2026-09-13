import { readFileSync } from 'node:fs';

export const SHA_PATTERN = /^[a-f0-9]{40}$/u;
export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export interface BoundedJsonFile {
  readonly value: unknown;
  readonly bytes: Buffer;
}

/**
 * Read one JSON file with a byte cap. Every failure mode (missing file, over
 * the cap, invalid JSON) becomes the caller's error type with a message that
 * names the file and the cause.
 */
export function readBoundedJson(
  path: string,
  maxBytes: number,
  label: string,
  makeError: (message: string) => Error,
): BoundedJsonFile {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    throw makeError(`${label} is missing at ${path}`);
  }
  if (bytes.byteLength > maxBytes) throw makeError(`${label} exceeds ${maxBytes} bytes`);
  try {
    return { value: JSON.parse(bytes.toString('utf8')) as unknown, bytes };
  } catch {
    throw makeError(`${label} is not valid JSON`);
  }
}

/** Every string leaf and key of a JSON-like value, in document order. */
export function* stringLeaves(value: unknown): Generator<string> {
  if (typeof value === 'string') {
    yield value;
  } else if (Array.isArray(value)) {
    for (const item of value) yield* stringLeaves(item);
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      yield key;
      yield* stringLeaves(item);
    }
  }
}
