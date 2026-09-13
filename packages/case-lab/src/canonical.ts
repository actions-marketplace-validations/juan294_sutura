import { createHash } from 'node:crypto';

/**
 * Canonical JSON with sorted keys and dropped `undefined` values. This is the
 * TypeScript twin of `scripts/evidence-contract.mjs` so a Case Lab result
 * hashes identically in the workflow, the CLI, and the tests.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
