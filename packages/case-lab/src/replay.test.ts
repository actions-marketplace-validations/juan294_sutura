import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCompleteReplayBundleForTest } from '@sutura/core';
import { describe, expect, it, vi } from 'vitest';

import { CASE_LAB_CASES, caseLabCase } from './cases.js';
import { loadRecordedEvidence } from './evidence.js';
import {
  CaseLabReplayError,
  deterministicResult,
  loadRelease,
  recordedResult,
  replayCatalog,
  replayedResult,
  REPOSITORY_ROOT,
} from './replay.js';
import { validateCaseLabResult, type CaseLabResult } from './result.js';

const NOW = () => new Date('2026-09-04T12:00:00.000Z');
const RELEASE = loadRelease();
const DEMO_SHA = 'a7a3278db7e1185403dc223a97ebb205ccf4c2f7';
const CAPTURED_RUN_URL = 'https://github.com/juan294/sutura-demo/actions/runs/33949921397';
const EMPTY_REPLAY_DIR = mkdtempSync(join(tmpdir(), 'case-lab-no-replay-'));

function fixtureFor(bundle: unknown): Record<string, unknown> {
  return { schemaVersion: 'sutura-case-lab-replay-fixture-v1', release: RELEASE, demoSha: DEMO_SHA, capturedRunUrl: CAPTURED_RUN_URL, bundle };
}

describe('recorded evidence', () => {
  it('loads the committed live result and ledger after proving their hashes', () => {
    const evidence = loadRecordedEvidence(REPOSITORY_ROOT);
    expect(evidence.result.subjectSha).toBe(RELEASE.actionSha);
    expect(evidence.result.results).toHaveLength(55);
    expect(evidence.ledger.entries).toHaveLength(51);
  });

  it('refuses tampered evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'case-lab-evidence-'));
    const evidence = loadRecordedEvidence(REPOSITORY_ROOT);
    mkdirSync(join(dir, 'docs/demo'), { recursive: true });
    writeFileSync(join(dir, 'docs/demo/placebo-v0.2-live-ledger-2026-09.json'), JSON.stringify(evidence.ledger));
    writeFileSync(
      join(dir, 'docs/demo/placebo-v0.2-live-2026-09.json'),
      JSON.stringify({ ...evidence.result, inferenceUsd: 0 }),
    );
    expect(() => loadRecordedEvidence(dir)).toThrow('resultHash does not match its content');
  });
});

describe('deterministic results', () => {
  it('produces one validated recorded result per case in roadmap order', { timeout: 60_000 }, async () => {
    const results = await replayCatalog({ replayDir: EMPTY_REPLAY_DIR, now: NOW });
    expect(results.map((item) => item.caseId)).toEqual(CASE_LAB_CASES.map((item) => item.id));
    for (const result of results) {
      expect(validateCaseLabResult(JSON.parse(JSON.stringify(result)))).toEqual(result);
      expect(result.mode).toBe('recorded');
      expect(result.requestId).toBe(`recorded-${result.caseId}`);
      expect(result.release).toEqual(RELEASE);
      expect(result.recordedFrom?.subjectSha).toBe(RELEASE.actionSha);
      expect(result.links.workflowRun).toMatch(/^https:\/\/github\.com\/juan294\/sutura\/actions\/runs\/\d+$/u);
      expect(result.caseFile).toBeDefined();
      expect(result.cost.status).toBe('observed');
    }
    const byId = Object.fromEntries(results.map((item) => [item.caseId, item]));
    expect(byId['javascript-repair']?.outcome).toBe('fixed');
    expect(byId['javascript-repair']?.matchesExpectation).toBe(true);
    expect(byId['flaky-failure']?.outcome).toBe('flaky-no-patch');
    expect(byId['greenwash-trap']?.outcome).toBe('refused');
    expect(byId['greenwash-trap']?.caseFile?.audit?.approved).toBe(false);
    expect(byId['python-repair']?.outcome).toBe('infra-stop');
    expect(byId['python-repair']?.matchesExpectation).toBe(false);
    expect(byId['upstream-incident']?.outcome).toBe('infra-stop');
    expect(byId['upstream-incident']?.matchesExpectation).toBe(false);
    expect(byId['javascript-repair']?.cost.inferenceUsd).toBeCloseTo(0.005507, 6);
  });

  it('reads the Tavily-enabled arm for the upstream case', () => {
    const evidence = loadRecordedEvidence(REPOSITORY_ROOT);
    const result = recordedResult(caseLabCase('upstream-incident'), evidence, { release: RELEASE, now: NOW });
    expect(result.elapsedMs).toBeCloseTo(72700.26491299999, 3);
  });

  it('replays a complete fixture bound to the release and the demo commit', { timeout: 60_000 }, async () => {
    const bundle = { ...(await createCompleteReplayBundleForTest()), actionSha: DEMO_SHA };
    const result = await replayedResult(caseLabCase('flaky-failure'), fixtureFor(bundle), {
      release: RELEASE, now: NOW, fixtureSha256: 'a'.repeat(64),
    });
    expect(result.mode).toBe('replay');
    expect(result.outcome).toBe('flaky-no-patch');
    expect(result.matchesExpectation).toBe(true);
    expect(result.identity).toEqual({ controllerSha: RELEASE.actionSha, demoSha: DEMO_SHA });
    expect(result.replayedFrom).toEqual({
      bundleSha256: 'a'.repeat(64),
      capturedRunUrl: CAPTURED_RUN_URL,
      actionSha: RELEASE.actionSha,
    });
    expect(result.links.ciRun).toBe(`https://github.com/${bundle.repo}/actions/runs/${bundle.runId}`);
    expect(validateCaseLabResult(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });

  it('refuses a fixture from another release, a bundle from another demo commit, a partial bundle, and a drifted outcome', { timeout: 60_000 }, async () => {
    const bundle = { ...(await createCompleteReplayBundleForTest()), actionSha: DEMO_SHA };
    const options = { release: RELEASE, now: NOW, fixtureSha256: 'a'.repeat(64) };
    await expect(replayedResult(caseLabCase('flaky-failure'), { ...fixtureFor(bundle), release: { version: '0.1.0', actionSha: 'b'.repeat(40) } }, options))
      .rejects.toThrow(`replay fixture release actionSha ${'b'.repeat(40)} must equal release.json actionSha ${RELEASE.actionSha}`);
    await expect(replayedResult(caseLabCase('flaky-failure'), fixtureFor({ ...bundle, actionSha: 'c'.repeat(40) }), options))
      .rejects.toThrow(`replay bundle actionSha ${'c'.repeat(40)} must equal the fixture demoSha ${DEMO_SHA}`);
    const partial = { ...bundle, completeness: { complete: false, overflowedBoundaries: [], pendingBoundaries: ['tavily'] } };
    await expect(replayedResult(caseLabCase('flaky-failure'), fixtureFor(partial), options)).rejects.toThrow(CaseLabReplayError);
    const drifted = { ...bundle, outcome: 'fixed' as const };
    await expect(replayedResult(caseLabCase('flaky-failure'), fixtureFor(drifted), options))
      .rejects.toThrow('replay outcome mismatch: recorded fixed, replayed flaky-no-patch');
    await expect(replayedResult(caseLabCase('flaky-failure'), bundle, options))
      .rejects.toThrow('replay fixture must be a sutura-case-lab-replay-fixture-v1 document');
  });

  it('prefers a fixture on disk over the recorded result', { timeout: 60_000 }, async () => {
    const replayDir = mkdtempSync(join(tmpdir(), 'case-lab-replay-'));
    const bundle = { ...(await createCompleteReplayBundleForTest()), actionSha: DEMO_SHA };
    writeFileSync(join(replayDir, 'flaky-failure.json'), JSON.stringify(fixtureFor(bundle)));
    const result = await deterministicResult('flaky-failure', { replayDir, now: NOW });
    expect(result.mode).toBe('replay');
    expect(result.replayedFrom?.bundleSha256).toMatch(/^[a-f0-9]{64}$/u);
    const recorded = await deterministicResult('greenwash-trap', { replayDir, now: NOW });
    expect(recorded.mode).toBe('recorded');
    await expect(deterministicResult('unknown', { replayDir, now: NOW })).rejects.toThrow('caseId must be one of');
  });
});

describe('replay determinism and fallback', () => {
  it('produces the same semantic result twice with no network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const replayDir = mkdtempSync(join(tmpdir(), 'case-lab-twice-'));
    try {
      const first = await replayCatalog({ replayDir, now: NOW });
      const second = await replayCatalog({ replayDir, now: NOW });

      const semantic = (results: CaseLabResult[]): unknown =>
        results.map(({ caseId, mode, outcome, matchesExpectation, resultHash }) =>
          ({ caseId, mode, outcome, matchesExpectation, resultHash }));

      expect(semantic(second)).toEqual(semantic(first));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      rmSync(replayDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('falls back to a labelled recorded view when a bundle cannot replay', async () => {
    const replayDir = mkdtempSync(join(tmpdir(), 'case-lab-bad-bundle-'));
    try {
      writeFileSync(
        join(replayDir, 'flaky-failure.json'),
        JSON.stringify({ schemaVersion: 'not-a-supported-version' }),
      );
      const result = await deterministicResult('flaky-failure', { replayDir, now: NOW });

      expect(result.mode).toBe('recorded');
      expect(result.replayedFrom).toBeUndefined();
      expect(result.recordedFrom?.replayFallbackReason).toBeTruthy();
    } finally {
      rmSync(replayDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('records no fallback reason when no bundle was present at all', async () => {
    const replayDir = mkdtempSync(join(tmpdir(), 'case-lab-no-bundle-'));
    try {
      const result = await deterministicResult('flaky-failure', { replayDir, now: NOW });

      expect(result.mode).toBe('recorded');
      expect(result.recordedFrom?.replayFallbackReason).toBeUndefined();
    } finally {
      rmSync(replayDir, { recursive: true, force: true });
    }
  }, 60_000);
});
