import { RECORDED_HTTP_BOUNDARIES, type ReplayBoundary } from './bundle.js';

export const CAPTURED_FIXTURES_SCHEMA_VERSION = 'sutura-captured-fixtures-v1' as const;

export type CapturedFixtureBoundary = ReplayBoundary;

export interface CapturedFixtureEntry {
  workflowRunId: string;
  targetRunId: string;
  suturaRunId?: string;
  kind: 'ci-failure' | 'ci-success' | 'provider-capture' | 'tavily-capture'
    | 'sandbox-capture' | 'dogfood-gave-up' | 'dogfood-refused';
  headSha: string;
  capturedAt: string;
  source: string;
  capturedBy: 'workflow' | 'local';
  bundleSha256: string;
  boundaries: CapturedFixtureBoundary[];
  notes: string;
}

export interface CapturedFixturesManifest {
  schemaVersion: typeof CAPTURED_FIXTURES_SCHEMA_VERSION;
  entries: CapturedFixtureEntry[];
}

export class CapturedFixturesValidationError extends Error {
  constructor(path: string, detail: string) {
    super(`${path} ${detail}`);
    this.name = 'CapturedFixturesValidationError';
  }
}

const ID = /^[1-9]\d*$/u;
const SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const KINDS = new Set([
  'ci-failure', 'ci-success', 'provider-capture', 'tavily-capture',
  'sandbox-capture', 'dogfood-gave-up', 'dogfood-refused',
]);
const BOUNDARIES = new Set<string>(['github', 'repository', 'executor', ...RECORDED_HTTP_BOUNDARIES]);
const ENTRY_KEYS = new Set([
  'workflowRunId', 'targetRunId', 'suturaRunId', 'kind', 'headSha', 'capturedAt',
  'source', 'capturedBy', 'bundleSha256', 'boundaries', 'notes',
]);

function entryObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CapturedFixturesValidationError(path, 'must be an object');
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_000) {
    throw new CapturedFixturesValidationError(path, 'must be a bounded non-empty string');
  }
  return value;
}

export function parseCapturedFixturesManifest(value: unknown): CapturedFixturesManifest {
  const manifest = entryObject(value, 'manifest');
  if (manifest.schemaVersion !== CAPTURED_FIXTURES_SCHEMA_VERSION) {
    throw new CapturedFixturesValidationError('manifest.schemaVersion', 'is unsupported');
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length > 10_000) {
    throw new CapturedFixturesValidationError('manifest.entries', 'must be a bounded array');
  }
  const identities = new Set<string>();
  for (const [index, item] of manifest.entries.entries()) {
    const path = `manifest.entries[${index}]`;
    const entry = entryObject(item, path);
    const unknownKey = Object.keys(entry).find((key) => !ENTRY_KEYS.has(key));
    if (unknownKey) throw new CapturedFixturesValidationError(`${path}.${unknownKey}`, 'is not allowed');
    for (const field of ['workflowRunId', 'targetRunId'] as const) {
      if (!ID.test(requiredString(entry[field], `${path}.${field}`))) {
        throw new CapturedFixturesValidationError(`${path}.${field}`, 'must be a positive decimal id');
      }
    }
    if (entry.suturaRunId !== undefined && !ID.test(requiredString(entry.suturaRunId, `${path}.suturaRunId`))) {
      throw new CapturedFixturesValidationError(`${path}.suturaRunId`, 'must be a positive decimal id');
    }
    const identity = requiredString(entry.workflowRunId, `${path}.workflowRunId`);
    if (identities.has(identity)) {
      throw new CapturedFixturesValidationError(`${path}.workflowRunId`, 'must be unique');
    }
    identities.add(identity);
    if (!KINDS.has(entry.kind as string)) throw new CapturedFixturesValidationError(`${path}.kind`, 'is unknown');
    if (!SHA.test(requiredString(entry.headSha, `${path}.headSha`))) {
      throw new CapturedFixturesValidationError(`${path}.headSha`, 'must be an exact lowercase SHA');
    }
    const capturedAt = requiredString(entry.capturedAt, `${path}.capturedAt`);
    if (!capturedAt.endsWith('Z') || !Number.isFinite(Date.parse(capturedAt))) {
      throw new CapturedFixturesValidationError(`${path}.capturedAt`, 'must be an ISO UTC timestamp');
    }
    if (entry.capturedBy !== 'workflow' && entry.capturedBy !== 'local') {
      throw new CapturedFixturesValidationError(`${path}.capturedBy`, 'is unknown');
    }
    const source = requiredString(entry.source, `${path}.source`);
    if (entry.capturedBy === 'local') {
      if (!SHA.test(source)) {
        throw new CapturedFixturesValidationError(`${path}.source`, 'must be an exact capture commit SHA');
      }
    } else {
      let url: URL;
      try {
        url = new URL(source);
      } catch {
        throw new CapturedFixturesValidationError(`${path}.source`, 'must be a URL');
      }
      if (url.protocol !== 'https:' || url.hostname !== 'github.com' ||
        !url.pathname.startsWith('/juan294/sutura/actions/runs/')) {
        throw new CapturedFixturesValidationError(
          `${path}.source`,
          'must be a public juan294/sutura workflow-run URL',
        );
      }
    }
    if (!SHA256.test(requiredString(entry.bundleSha256, `${path}.bundleSha256`))) {
      throw new CapturedFixturesValidationError(`${path}.bundleSha256`, 'must be SHA-256');
    }
    if (!Array.isArray(entry.boundaries) || entry.boundaries.length === 0 ||
      entry.boundaries.some((boundary) => !BOUNDARIES.has(boundary as string))) {
      throw new CapturedFixturesValidationError(`${path}.boundaries`, 'must contain known boundaries');
    }
    requiredString(entry.notes, `${path}.notes`);
  }
  return value as CapturedFixturesManifest;
}
