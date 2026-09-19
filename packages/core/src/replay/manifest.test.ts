import { describe, expect, it } from 'vitest';

import {
  CAPTURED_FIXTURES_SCHEMA_VERSION,
  parseCapturedFixturesManifest,
} from './manifest.js';

describe('parseCapturedFixturesManifest', () => {
  const manifest = {
    schemaVersion: CAPTURED_FIXTURES_SCHEMA_VERSION,
    entries: [{
      workflowRunId: '33239910020',
      targetRunId: '33239848825',
      suturaRunId: '33239910020',
      kind: 'ci-failure',
      headSha: 'a'.repeat(40),
      capturedAt: '2026-08-30T00:00:00.000Z',
      source: 'https://github.com/juan294/sutura/actions/runs/33239848825',
      capturedBy: 'workflow',
      bundleSha256: 'b'.repeat(64),
      boundaries: ['github'],
      notes: 'A3 and B4',
    }],
  };

  it('accepts separate workflow, target, and Sutura identities', () => {
    expect(parseCapturedFixturesManifest(manifest)).toEqual(manifest);
  });

  it('does not accept the obsolete runId field', () => {
    expect(() => parseCapturedFixturesManifest({
      ...manifest,
      entries: [{ ...manifest.entries[0], runId: '33239848825' }],
    })).toThrow(/runId/u);
  });

  it('accepts the optional openai and typesafe boundaries', () => {
    for (const boundary of ['openai', 'typesafe'] as const) {
      const withBoundary = {
        ...manifest,
        entries: [{ ...manifest.entries[0], boundaries: [boundary] }],
      };
      expect(parseCapturedFixturesManifest(withBoundary)).toEqual(withBoundary);
    }
  });

  it('accepts an exact capture commit for a local fixture', () => {
    const local = {
      ...manifest,
      entries: [{
        ...manifest.entries[0],
        source: 'c'.repeat(40),
        capturedBy: 'local',
      }],
    };

    expect(parseCapturedFixturesManifest(local)).toEqual(local);
  });
});
