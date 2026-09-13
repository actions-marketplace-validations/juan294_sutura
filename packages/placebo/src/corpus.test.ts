import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { access, cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runMechanicalChecks } from '@sutura/core';

import { applyPatch, createCorpusManifest, createPortableTestRuntime, discoverBenchmarkCases, discoverCases, installFixture, prepareFixture, runFixtureSuite, selfCheckCorpus, verifyCandidateWithHiddenTests } from './corpus.js';
import type { CaseKind, CorpusCase } from './types.js';

const NEW_CASE_IDS = [
  'flaky-filesystem-visibility',
  'flaky-order-cache',
  'flaky-port-worker',
  'flaky-simulated-network',
  'flaky-timing-deadline',
  'repair-cache-invalidation-target',
  'repair-dogfood-arithmetic',
  'repair-esm-extension-nested',
  'repair-missing-await-setup',
  'repair-tsconfig-drift-indexed-access',
  'trap-conditional-assertion-deletion',
  'trap-error-propagation-removal',
  'trap-mocked-dependency-replacement',
  'trap-policy-file-modification',
  'trap-snapshot-acceptance',
  'trap-test-glob-exclusion',
  'trap-timeout-inflation',
  'trap-workflow-check-removal',
] as const;
const PYTHON_CASE_IDS = [
  'python-flaky-timer',
  'python-repair-cache-key',
  'python-repair-missing-await',
  'python-repair-type-mismatch',
  'python-repair-wrong-import',
  'python-trap-broad-type-ignore',
  'python-trap-skipped-test',
  'python-trap-swallowed-exception',
] as const;

describe('Placebo v0.2 corpus', () => {
  it('prepares a standalone fixture against a new empty store', async () => {
    const benchmarkCase = (await discoverCases()).find(({ id }) => id === 'repair-off-by-one');
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'placebo-prepare-test-'));
    const fixture = join(temporaryRoot, 'fixture');
    const emptyStore = join(temporaryRoot, 'empty-store');
    try {
      await cp(benchmarkCase!.fixtureDirectory, fixture, { recursive: true });
      await prepareFixture(fixture, emptyStore);
      await expect(promisify(execFile)('pnpm', ['test'], {
        cwd: fixture,
        env: { PATH: process.env.PATH, CI: '1' },
      })).resolves.toBeDefined();
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it('requires public-safe v0.2 metadata while preserving every v0.1 identity', async () => {
    const cases = await discoverCases();
    const counts = new Map<CaseKind, CorpusCase[]>();
    for (const kind of ['trap', 'repairable', 'flaky', 'upstream'] as const) counts.set(kind, []);
    for (const benchmarkCase of cases) counts.get(benchmarkCase.metadata.kind)?.push(benchmarkCase);

    expect(counts.get('trap')).toHaveLength(19);
    expect(counts.get('repairable')).toHaveLength(19);
    expect(counts.get('flaky')).toHaveLength(10);
    expect(counts.get('upstream')).toHaveLength(4);
    expect(cases.filter(({ metadata }) => metadata.difficulty === 'hard')).toHaveLength(2);
    expect(counts.get('trap')?.every(({ metadata }) => metadata.placebo === 'fake-fix.diff')).toBe(true);
    expect(counts.get('upstream')?.every(({ metadata }) =>
      metadata.expectedWithoutTavily === 'gave-up' && metadata.releaseFact?.url.startsWith('https://github.com/'),
    )).toBe(true);
    for (const benchmarkCase of cases) {
      expect(benchmarkCase.metadata.version).toBe('0.2');
      expect(benchmarkCase.metadata.riskClass).toMatch(/^[a-z0-9-]+$/);
      expect(['javascript', 'typescript', 'python']).toContain(benchmarkCase.metadata.language);
      expect(benchmarkCase.metadata.failureFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(benchmarkCase.metadata.expectedChecks.length).toBeGreaterThan(0);
      expect(benchmarkCase.metadata.source).toMatch(/^Public synthetic /);
      if (benchmarkCase.metadata.language === 'python') {
        await expect(access(`${benchmarkCase.fixtureDirectory}/uv.lock`)).resolves.toBeUndefined();
        await expect(access(`${benchmarkCase.fixtureDirectory}/node_modules`)).rejects.toThrow();
        const pyproject = await readFile(`${benchmarkCase.fixtureDirectory}/pyproject.toml`, 'utf8');
        const projectName = pyproject.match(/^name = "([a-z0-9-]+)"$/mu)?.[1];
        const projectVersion = pyproject.match(/^version = "([0-9.]+)"$/mu)?.[1];
        const lock = await readFile(`${benchmarkCase.fixtureDirectory}/uv.lock`, 'utf8');
        expect(projectName).toBeDefined();
        expect(projectVersion).toBeDefined();
        expect(lock).toContain(`[[package]]\nname = "${projectName}"\nversion = "${projectVersion}"\nsource = { virtual = "." }`);
      } else {
        await expect(access(`${benchmarkCase.fixtureDirectory}/pnpm-lock.yaml`)).resolves.toBeUndefined();
        const packageJson = JSON.parse(await readFile(`${benchmarkCase.fixtureDirectory}/package.json`, 'utf8')) as {
          devDependencies?: Record<string, string>;
        };
        expect(packageJson.devDependencies?.vitest).toBe('4.1.11');
      }
    }
    const v01Ids = JSON.parse(await readFile(new URL('../../../docs/demo/placebo-v0.1-2026-08-28.json', import.meta.url), 'utf8')) as {
      results: Array<{ caseId: string }>;
    };
    expect([...new Set(v01Ids.results.map(({ caseId }) => caseId))].every((id) =>
      cases.some((benchmarkCase) => benchmarkCase.id === id))).toBe(true);
  });

  it('creates a stable content-addressed manifest with complete v0.1 lineage', async () => {
    const cases = await discoverCases();
    const first = await createCorpusManifest();
    const second = await createCorpusManifest(cases.toReversed());
    expect(second).toEqual(first);
    expect(first.cases).toHaveLength(51);
    expect(await discoverBenchmarkCases()).toHaveLength(51);
    expect(first.cases.some(({ id }) => id === 'repair-dogfood-arithmetic')).toBe(false);
    expect(first.lineage).toEqual([{ version: '0.1', caseIds: expect.any(Array) }]);
    expect(first.lineage[0]?.caseIds).toHaveLength(26);
    expect(first.corpusHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.cases.every(({ contentHash }) => /^[a-f0-9]{64}$/u.test(contentHash))).toBe(true);
    expect(first.cases.filter(({ hiddenTestSetHash }) => hiddenTestSetHash !== undefined)).toHaveLength(15);
  });

  it('keeps the frozen v0.2 corpus hash byte-identical to the committed manifest', async () => {
    const committed: unknown = JSON.parse(await readFile(
      fileURLToPath(new URL('../../../docs/demo/placebo-v0.2-corpus.json', import.meta.url)),
      'utf8',
    ));

    expect((await createCorpusManifest()).corpusHash)
      .toBe((committed as { corpusHash: string }).corpusHash);
  });

  it('keeps every corpus file public-safe and the network simulator outbound-free', async () => {
    const forbidden = /(?:\/Users\/|[A-Z]:\\Users\\|github_pat_|ghp_|sk-[A-Za-z0-9]{20}|NEBIUS_API_KEY\s*=|TAVILY_API_KEY\s*=)/u;
    for (const benchmarkCase of await discoverCases()) {
      for (const relative of await readdir(benchmarkCase.directory, { recursive: true })) {
        const text = await readFile(join(benchmarkCase.directory, relative), 'utf8').catch(() => undefined);
        if (text !== undefined) expect(text, `${benchmarkCase.id}/${relative}`).not.toMatch(forbidden);
      }
    }
    const simulator = (await discoverCases()).find(({ id }) => id === 'flaky-simulated-network')!;
    const simulatorText = await Promise.all([
      readFile(join(simulator.fixtureDirectory, 'case.test.js'), 'utf8'),
      readFile(simulator.breakPatch, 'utf8'),
    ]).then((parts) => parts.join('\n'));
    expect(simulatorText).not.toMatch(/(?:fetch\s*\(|https?:\/\/|createConnection|connect\s*\()/u);
  });

  it('uses the Phase 5 branch attempt contract instead of mutable clone state', async () => {
    const flaky = (await discoverCases()).filter(({ metadata }) => metadata.kind === 'flaky');
    const mechanismSignals = {
      'flaky-port-collision': ['first.address().port', 'listen(second'],
      'flaky-random-threshold': ['mulberry32', 'admitted(mulberry32'],
      'flaky-test-order': ['contaminatingOrder', "['add', 'empty']"],
      'flaky-timer-race': ['delay(losesRace', 'await delay(10)'],
      'flaky-timing-deadline': ['completedAt', 'SUTURA_TRIAGE_ATTEMPT'],
      'flaky-port-worker': ['configuredPort', 'first.address().port'],
      'flaky-order-cache': ["['store', 'empty']", 'SUTURA_TRIAGE_ATTEMPT'],
      'flaky-filesystem-visibility': ['writeName', 'staging.txt'],
      'flaky-simulated-network': ['localResponse', '503'],
      'python-flaky-timer': ['completed_before_deadline', 'attempt not in'],
    } as const;
    for (const benchmarkCase of flaky) {
      const patch = await readFile(benchmarkCase.breakPatch, 'utf8');
      const attemptContract = benchmarkCase.metadata.language === 'python'
        ? `${patch}\n${await readFile(join(benchmarkCase.fixtureDirectory, 'tests/test_timing.py'), 'utf8')}`
        : patch;
      expect(attemptContract).toContain('SUTURA_TRIAGE_ATTEMPT');
      expect(attemptContract).not.toContain('.placebo-run-index');
      expect(attemptContract).not.toContain('process.exitCode');
      for (const signal of mechanismSignals[benchmarkCase.id as keyof typeof mechanismSignals]) {
        expect(patch).toContain(signal);
      }
    }
  });

  it.each([
    ['trap-deleted-test', 'deleted-test'],
    ['trap-skipped-test', 'skipped-test'],
    ['trap-weakened-expect', 'weakened-assertion'],
    ['trap-as-any', 'loosened-type'],
    ['trap-eslint-off', 'relaxed-config'],
    ['trap-pass-with-no-tests', 'pass-with-no-tests'],
  ] as const)('feeds the Phase 6 %s seed into its exact mechanical check', async (caseId, expectedFailure) => {
    const benchmarkCase = (await discoverCases()).find(({ id }) => id === caseId);
    expect(benchmarkCase).toBeDefined();
    const fakeFix = await readFile(join(benchmarkCase!.directory, 'fake-fix.diff'), 'utf8');
    expect(runMechanicalChecks(fakeFix).filter(({ passed }) => !passed).map(({ name }) => name)).toEqual([
      expectedFailure,
    ]);
  });

  it.each(['trap-assertion-tautology', 'trap-swallowed-error'])(
    'keeps subtle trap %s for adjudication after mechanical checks',
    async (caseId) => {
      const benchmarkCase = (await discoverCases()).find(({ id }) => id === caseId);
      const fakeFix = await readFile(join(benchmarkCase!.directory, 'fake-fix.diff'), 'utf8');
      expect(runMechanicalChecks(fakeFix).every(({ passed }) => passed)).toBe(true);
    },
  );

  it('keeps every repair candidate compatible with Phase 5 patch vetting', async () => {
    const repairable = (await discoverCases()).filter(({ metadata }) => metadata.kind === 'repairable');
    for (const benchmarkCase of repairable) {
      const diff = await readFile(benchmarkCase.breakPatch, 'utf8');
      const changedPaths = [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1] ?? '');
      expect(changedPaths).not.toHaveLength(0);
      if (benchmarkCase.metadata.class !== 'test-bug') {
        expect(changedPaths.some((path) => /(?:^|\/)[^/]+\.(?:test|spec)\./.test(path))).toBe(false);
      }
      if (benchmarkCase.metadata.class !== 'env-config') {
        expect(changedPaths.some((path) => /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(path))).toBe(false);
      }
    }
  });

  it('applies every fake fix cleanly after its break patch', async () => {
    const traps = (await discoverCases()).filter(({ metadata }) => metadata.kind === 'trap');
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'placebo-fake-fix-check-'));
    try {
      for (const benchmarkCase of traps) {
        const fixture = join(temporaryRoot, benchmarkCase.id);
        await cp(benchmarkCase.fixtureDirectory, fixture, { recursive: true });
        await applyPatch(fixture, benchmarkCase.breakPatch);
        await expect(applyPatch(fixture, join(benchmarkCase.directory, 'fake-fix.diff'))).resolves.toBeUndefined();
      }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('self-checks every Python fixture without a Node runtime injection', async () => {
    const corpus = await mkdtemp(join(tmpdir(), 'placebo-python-corpus-'));
    try {
      const source = new URL('../corpus/', import.meta.url);
      for (const caseId of PYTHON_CASE_IDS) {
        await cp(new URL(`${caseId}/`, source), join(corpus, caseId), { recursive: true });
      }
      const report = await selfCheckCorpus(corpus);
      expect(report.map(({ caseId }) => caseId)).toEqual(PYTHON_CASE_IDS);
      expect(report.filter(({ cleanPassed, brokenFailed }) => !cleanPassed || !brokenFailed)).toEqual([]);
      expect(report.filter(({ placeboPassed }) => placeboPassed).map(({ caseId }) => caseId)).toEqual([
        'python-trap-broad-type-ignore',
        'python-trap-skipped-test',
        'python-trap-swallowed-exception',
      ]);
      expect(report.filter(({ hiddenVerification }) => hiddenVerification?.result === 'failed')).toHaveLength(3);
    } finally {
      await rm(corpus, { recursive: true, force: true });
    }
  }, 120_000);

  it('keeps Python repair and trap hidden verification separate from the flaky case', async () => {
    const cases = (await discoverCases()).filter(({ metadata }) => metadata.language === 'python');
    const repairs = cases.filter(({ metadata }) => metadata.kind === 'repairable');
    const traps = cases.filter(({ metadata }) => metadata.kind === 'trap');
    for (const benchmarkCase of repairs) {
      const candidate = await readFile(join(benchmarkCase.directory, 'repair.diff'), 'utf8');
      await expect(verifyCandidateWithHiddenTests(benchmarkCase, candidate)).resolves.toMatchObject({ result: 'passed' });
    }
    for (const benchmarkCase of traps) {
      const candidate = await readFile(join(benchmarkCase.directory, 'fake-fix.diff'), 'utf8');
      await expect(verifyCandidateWithHiddenTests(benchmarkCase, candidate)).resolves.toMatchObject({ result: 'failed' });
    }
    const flaky = cases.find(({ metadata }) => metadata.kind === 'flaky')!;
    await expect(verifyCandidateWithHiddenTests(flaky, undefined)).resolves.toBeUndefined();
  }, 120_000);

  it('self-checks every new v0.2 fixture and hidden trap', async () => {
    const corpus = await mkdtemp(join(tmpdir(), 'placebo-v02-corpus-'));
    const emptyStore = await mkdtemp(join(tmpdir(), 'placebo-v02-store-'));
    try {
      const source = new URL('../corpus/', import.meta.url);
      for (const caseId of NEW_CASE_IDS) {
        await cp(new URL(`${caseId}/`, source), join(corpus, caseId), { recursive: true });
      }
      const report = await selfCheckCorpus(corpus, { storeDirectory: emptyStore });
      expect(report.map(({ caseId }) => caseId)).toEqual(NEW_CASE_IDS);
      expect(report.filter(({ cleanPassed, brokenFailed }) => !cleanPassed || !brokenFailed)).toEqual([]);
      expect(report.filter(({ placeboPassed }) => placeboPassed)).toHaveLength(8);
      expect(report.filter(({ hiddenVerification }) => hiddenVerification?.result === 'failed')).toHaveLength(8);
    } finally {
      await rm(corpus, { recursive: true, force: true });
      await rm(emptyStore, { recursive: true, force: true });
    }
  }, 900_000);

  it('self-checks the canonical dogfood fixture as clean, red, and repairable', async () => {
    const corpus = await mkdtemp(join(tmpdir(), 'placebo-dogfood-corpus-'));
    const emptyStore = await mkdtemp(join(tmpdir(), 'placebo-dogfood-store-'));
    try {
      await cp(new URL('../corpus/repair-dogfood-arithmetic/', import.meta.url),
        join(corpus, 'repair-dogfood-arithmetic'), { recursive: true });
      const report = await selfCheckCorpus(corpus, { storeDirectory: emptyStore });
      expect(report).toMatchObject([{
        caseId: 'repair-dogfood-arithmetic',
        cleanPassed: true,
        brokenFailed: true,
      }]);
    } finally {
      await rm(corpus, { recursive: true, force: true });
      await rm(emptyStore, { recursive: true, force: true });
    }
  }, 120_000);

  it('makes every flaky fixture fail its first reproduction, before triage sets an attempt', async () => {
    // Sutura reproduces once with no SUTURA_TRIAGE_ATTEMPT before triage
    // scripts the ratio. A fixture that defaults the attempt can pass that
    // reproduction, and the run is then reported as an infrastructure stop
    // rather than as a flake, which is what happened live to
    // flaky-shared-counter on 2026-09-06.
    const cases = (await discoverCases(undefined, { includeVersionedCases: true }))
      .filter(({ metadata }) => metadata.kind === 'flaky');
    expect(cases.length).toBeGreaterThan(0);

    const store = await mkdtemp(join(tmpdir(), 'placebo-flaky-store-'));
    const runtime = await createPortableTestRuntime(store);
    const passed: string[] = [];
    try {
      for (const benchmarkCase of cases) {
        const root = await mkdtemp(join(tmpdir(), `placebo-flaky-${benchmarkCase.id}-`));
        const fixture = join(root, 'fixture');
        try {
          await cp(benchmarkCase.fixtureDirectory, fixture, { recursive: true });
          await prepareFixture(fixture, store, runtime);
          await applyPatch(fixture, benchmarkCase.breakPatch);
          if (benchmarkCase.metadata.language !== 'python') await installFixture(fixture, store);
          const exitCode = await runFixtureSuite(fixture, { SUTURA_TRIAGE_ATTEMPT: '' });
          if (exitCode === 0) passed.push(benchmarkCase.id);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    } finally {
      await runtime.cleanup();
      await rm(store, { recursive: true, force: true });
    }

    expect(passed, 'these flakes pass their first reproduction and read as infra-stop').toEqual([]);
  }, 900_000);

  it('proves every break patch is red and every clean fixture is green', async () => {
    const emptyStore = await mkdtemp(join(tmpdir(), 'placebo-empty-store-'));
    const report = await selfCheckCorpus(undefined, { storeDirectory: emptyStore }).finally(() =>
      rm(emptyStore, { recursive: true, force: true }),
    );

    expect(report).toHaveLength(101);
    expect(report.every(({ brokenFailed, cleanPassed }) => brokenFailed && cleanPassed)).toBe(true);
    expect(report.filter(({ brokenRuns }) => brokenRuns && brokenRuns.some(Boolean) && brokenRuns.some((failed) => !failed))).toHaveLength(13);
    expect(report.filter(({ placeboPassed }) => placeboPassed).map(({ caseId }) => caseId)).toEqual([
      'python-trap-assert-true',
      'python-trap-broad-type-ignore',
      'python-trap-expected-failure',
      'python-trap-patched-subject',
      'python-trap-skipped-test',
      'python-trap-swallowed-exception',
      'python-trap-widened-tolerance',
      'trap-as-any',
      'trap-assertion-tautology',
      'trap-conditional-assertion-deletion',
      'trap-deleted-test',
      'trap-empty-catch',
      'trap-error-propagation-removal',
      'trap-eslint-off',
      'trap-loosened-precision',
      'trap-mocked-dependency-replacement',
      'trap-narrowed-test-input',
      'trap-non-null-assertion',
      'trap-pass-with-no-tests',
      'trap-policy-file-modification',
      'trap-recovery-assertion-rewrite',
      'trap-recovery-config-relaxation',
      'trap-skipped-test',
      'trap-snapshot-acceptance',
      'trap-swallowed-error',
      'trap-test-glob-exclusion',
      'trap-timeout-inflation',
      'trap-two-file-test-shortcut',
      'trap-two-file-third-path',
      'trap-weakened-expect',
      'trap-workflow-check-removal',
    ]);
    // Hidden verification runs for the traps that ship hidden checks beside
    // their fake fix; the rest are caught by the visible suite alone.
    expect(report.filter(({ hiddenVerification }) => hiddenVerification !== undefined))
      .toHaveLength(21);
    expect(report.filter(({ hiddenVerification }) => hiddenVerification?.result === 'failed'))
      .toHaveLength(21);
  }, 1_500_000);
});
