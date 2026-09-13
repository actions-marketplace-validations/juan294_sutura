import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  applyPatch, createCorpusManifest, createPortableTestRuntime, discoverBenchmarkCases,
  discoverCases, prepareFixture, runFixtureSuite, verifyCandidateWithHiddenTests,
} from './corpus.js';

const CASE_ID = 'repair-off-by-one-preservation';
const WRONG_HASH = '1bfdf2005cf1adcb94836588d781f537845bc3061245d0d7d6710c80eff59402';

describe('versioned pagination preservation regression', () => {
  it('keeps the frozen legacy slice and exposes lineage only in the expanded selection', async () => {
    const legacy = await discoverBenchmarkCases();
    expect(legacy).toHaveLength(51);
    expect(legacy.some(({ id }) => id === CASE_ID)).toBe(false);
    const expanded = await discoverBenchmarkCases(undefined, { includeVersionedCases: true });
    const regression = expanded.find(({ id }) => id === CASE_ID);
    expect(regression?.metadata).toMatchObject({
      evaluationRevision: 'preservation-v1',
      lineage: { rootCaseId: 'repair-off-by-one', family: 'pagination-ceiling-division' },
      split: 'development',
      hiddenVerification: true,
    });
    const committed = JSON.parse(await readFile(new URL('../../../docs/demo/placebo-v0.2-corpus.json', import.meta.url), 'utf8')) as { corpusHash: string };
    // The frozen slice and its committed hash are what every historical score
    // refers to; adding versioned cases must never move either.
    expect((await createCorpusManifest()).corpusHash).toBe(committed.corpusHash);
    expect((await createCorpusManifest(expanded)).cases).toHaveLength(100);
    expect((await createCorpusManifest(expanded)).corpusHash).not.toBe(committed.corpusHash);
  });

  it('retains the exact recorded patch bytes and release identity', async () => {
    const regression = (await discoverCases(undefined, { includeVersionedCases: true })).find(({ id }) => id === CASE_ID)!;
    const wrong = await readFile(join(regression.directory, 'recorded-floor-only.diff'), 'utf8');
    const historical = JSON.parse(await readFile(new URL('../../../docs/demo/placebo-v0.2-live-2026-09.json', import.meta.url), 'utf8')) as {
      subjectSha: string; subjectVersion: string;
      results: Array<{ caseId: string; caseFile: { race: Array<{ candidate: { diff: string } }> } }>;
    };
    expect(historical.subjectVersion).toBe('0.2.0');
    expect(historical.subjectSha).toBe('a943ded4c734aed75c5c63f2b2dd63a2f44556c2');
    expect(wrong).toBe(historical.results.find(({ caseId }) => caseId === 'repair-off-by-one')!.caseFile.race[0]!.candidate.diff);
    expect(createHash('sha256').update(wrong).digest('hex')).toBe(WRONG_HASH);
    const declarations = JSON.parse(await readFile(join(regression.directory, 'controls.json'), 'utf8')) as {
      schemaVersion: string;
      controls: Array<{ file: string; sha256: string; datasetTruth: string }>;
    };
    expect(declarations.schemaVersion).toBe('sutura-pagination-controls-v1');
    expect(declarations.controls.map(({ datasetTruth }) => datasetTruth)).toEqual([
      'regression', 'contract-preserving', 'contract-preserving',
    ]);
    for (const control of declarations.controls) {
      const bytes = await readFile(join(regression.directory, control.file));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(control.sha256);
    }
    expect(new Set(declarations.controls.map(({ sha256 }) => sha256)).size).toBe(3);
    expect((await readdir(regression.fixtureDirectory, { recursive: true })).some((path) => path.includes('hidden') || path.endsWith('.diff'))).toBe(false);
  });

  it.each([
    { evaluationRevision: '../unsafe' },
    { lineage: { rootCaseId: 'repair-off-by-one', family: '../unsafe' } },
    { split: 'expected-fixed' },
    { lineage: undefined },
  ])('rejects invalid revision and split metadata: %j', async (replacement) => {
    const regression = (await discoverCases(undefined, { includeVersionedCases: true })).find(({ id }) => id === CASE_ID)!;
    const root = await mkdtemp(join(tmpdir(), 'pagination-metadata-'));
    try {
      await cp(regression.directory, join(root, CASE_ID), { recursive: true });
      await writeFile(join(root, CASE_ID, 'metadata.json'), JSON.stringify({ ...regression.metadata, ...replacement }));
      await expect(discoverCases(root, { includeVersionedCases: true })).rejects.toThrow(/revision|lineage|split/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('executes the same green visible check for all controls but rejects floor-only preservation', async () => {
    const regression = (await discoverCases(undefined, { includeVersionedCases: true })).find(({ id }) => id === CASE_ID)!;
    const runtime = await createPortableTestRuntime();
    const root = await mkdtemp(join(tmpdir(), 'pagination-preservation-'));
    try {
      for (const [file, expected] of [
        ['recorded-floor-only.diff', 'failed'],
        ['repair.diff', 'passed'],
        ['equivalent.diff', 'passed'],
      ] as const) {
        const fixture = join(root, file);
        await cp(regression.fixtureDirectory, fixture, { recursive: true });
        await prepareFixture(fixture, undefined, runtime);
        expect(await runFixtureSuite(fixture)).toBe(0);
        await applyPatch(fixture, regression.breakPatch);
        expect(await runFixtureSuite(fixture)).not.toBe(0);
        await applyPatch(fixture, join(regression.directory, file));
        expect(await runFixtureSuite(fixture)).toBe(0);
        const diff = await readFile(join(regression.directory, file), 'utf8');
        expect(await verifyCandidateWithHiddenTests(regression, diff, runtime)).toMatchObject({ result: expected });
      }
      expect(await verifyCandidateWithHiddenTests(regression, undefined, runtime)).toMatchObject({ result: 'not-run' });
    } finally {
      await runtime.cleanup();
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
