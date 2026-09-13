import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '@sutura/evaluation';

import {
  CORPUS_VERSION,
  type CaseKind,
  type CaseMetadata,
  type CorpusCase,
  type CorpusManifest,
  type ExpectedOutcome,
  type FixtureLanguage,
  type HiddenVerificationResult,
} from './types.js';

const DEFAULT_CORPUS_DIRECTORY = fileURLToPath(new URL('../corpus', import.meta.url));
const TEST_RUNTIME_ARCHIVES = new Map([
  ['darwin-arm64', fileURLToPath(new URL('../vendor/placebo-test-runtime-darwin-arm64-node_modules.tgz', import.meta.url))],
  ['linux-x64', fileURLToPath(new URL('../vendor/placebo-test-runtime-linux-x64-node_modules.tgz', import.meta.url))],
]);
const KINDS = new Set<CaseKind>(['trap', 'repairable', 'flaky', 'upstream']);
const EXPECTED = new Set<ExpectedOutcome>(['refused', 'fixed', 'flaky-no-patch', 'fixed-with-grounding']);
const LANGUAGES = new Set(['javascript', 'typescript', 'python']);
const FLAKE_PATTERNS = new Set(['timing', 'port', 'order', 'filesystem', 'simulated-network', 'randomness']);
const CLASSES = new Set(['typecheck', 'lint', 'build', 'test-assertion', 'test-bug', 'flaky-timing', 'dep-upstream-breaking', 'env-config', 'infra']);
const PLACEBO_TEMP_ROOT = join(tmpdir(), 'placebo.noindex');
const NON_BENCHMARK_CASE_IDS = new Set(['repair-dogfood-arithmetic']);

export async function createPlaceboTemporaryDirectory(prefix: string): Promise<string> {
  if (!/^[a-z0-9-]+$/iu.test(prefix)) throw new Error('Invalid Placebo temporary prefix');
  await mkdir(PLACEBO_TEMP_ROOT, { recursive: true, mode: 0o700 });
  const metadata = await lstat(PLACEBO_TEMP_ROOT);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Placebo temporary root must be a real directory');
  }
  return mkdtemp(join(PLACEBO_TEMP_ROOT, prefix));
}

function parseMetadata(text: string, caseId: string): CaseMetadata {
  const value = JSON.parse(text) as Partial<CaseMetadata>;
  if (value.version !== CORPUS_VERSION || !value.kind || !KINDS.has(value.kind) ||
      !value.expected || !EXPECTED.has(value.expected) || !value.class || !CLASSES.has(value.class) ||
      typeof value.description !== 'string' || typeof value.riskClass !== 'string' ||
      !/^[a-z0-9-]+$/u.test(value.riskClass) || !LANGUAGES.has(String(value.language)) ||
      typeof value.failureFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(value.failureFingerprint) ||
      !Array.isArray(value.expectedChecks) || value.expectedChecks.length === 0 ||
      !value.expectedChecks.every((check) => typeof check === 'string' && check.trim().length > 0) ||
      typeof value.source !== 'string' || !value.source.startsWith('Public synthetic ')) {
    throw new Error(`Invalid metadata for ${caseId}`);
  }
  if (value.kind === 'trap' && value.placebo !== 'fake-fix.diff') throw new Error(`Trap ${caseId} must name fake-fix.diff`);
  if (value.kind === 'flaky' && (!Array.isArray(value.triageExitCodes) || value.triageExitCodes.length !== 5 ||
      !value.triageExitCodes.some((code) => code === 0) || !value.triageExitCodes.some((code) => code !== 0) ||
      !FLAKE_PATTERNS.has(String(value.flakePattern)))) {
    throw new Error(`Flaky case ${caseId} must script a mixed five-run ratio`);
  }
  if (value.kind === 'upstream' && (!value.releaseFact || value.expectedWithoutTavily === undefined)) {
    throw new Error(`Upstream case ${caseId} must include a release fact and ablation expectation`);
  }
  const boundedId = (entry: unknown): entry is string =>
    typeof entry === 'string' && /^[a-z0-9][a-z0-9-]{0,95}$/u.test(entry);
  if (value.evaluationRevision !== undefined && !boundedId(value.evaluationRevision)) {
    throw new Error(`Invalid evaluation revision for ${caseId}`);
  }
  if (value.lineage !== undefined && (
    typeof value.lineage !== 'object' || value.lineage === null || Array.isArray(value.lineage) ||
    !boundedId(value.lineage.rootCaseId) || !boundedId(value.lineage.family) ||
    Object.keys(value.lineage).some((key) => key !== 'rootCaseId' && key !== 'family')
  )) throw new Error(`Invalid case lineage for ${caseId}`);
  if (value.split !== undefined && !['development', 'validation', 'held-out'].includes(value.split)) {
    throw new Error(`Invalid evaluation split for ${caseId}`);
  }
  if (value.evaluationRevision !== undefined && (value.lineage === undefined || value.split === undefined)) {
    throw new Error(`Versioned case ${caseId} requires lineage and evaluation split`);
  }
  return value as CaseMetadata;
}

export interface CorpusSelection {
  /** Explicitly opt into expanded oracles; the default preserves historical scores. */
  includeVersionedCases?: boolean;
}

export async function discoverCases(
  corpusDirectory = DEFAULT_CORPUS_DIRECTORY,
  selection: CorpusSelection = {},
): Promise<CorpusCase[]> {
  const entries = await readdir(corpusDirectory, { withFileTypes: true });
  const cases = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async ({ name }) => {
    const directory = join(corpusDirectory, name);
    return {
      id: name, directory, fixtureDirectory: join(directory, 'fixture'), breakPatch: join(directory, 'break.diff'),
      metadata: parseMetadata(await readFile(join(directory, 'metadata.json'), 'utf8'), name),
    };
  }));
  return cases
    .filter(({ metadata }) => selection.includeVersionedCases === true || metadata.evaluationRevision === undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export async function discoverBenchmarkCases(
  corpusDirectory = DEFAULT_CORPUS_DIRECTORY,
  selection: CorpusSelection = {},
): Promise<CorpusCase[]> {
  return (await discoverCases(corpusDirectory, selection))
    .filter(({ id }) => !NON_BENCHMARK_CASE_IDS.has(id));
}

interface CommandResult { exitCode: number; stdout: string; stderr: string }

function run(
  command: string,
  args: string[],
  cwd: string,
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, CI: '1', ...extraEnv },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout = `${stdout}${chunk}`.slice(-20_000); });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
  });
}

export async function applyPatch(fixtureDirectory: string, patch: string, reverse = false): Promise<void> {
  const result = await run('git', ['apply', ...(reverse ? ['--reverse'] : []), patch], fixtureDirectory);
  if (result.exitCode !== 0) throw new Error(`Could not apply ${patch}: ${result.stderr}`);
}

export async function installFixture(fixtureDirectory: string, storeDirectory?: string): Promise<void> {
  const isWorkspace = await lstat(join(fixtureDirectory, 'pnpm-workspace.yaml'))
    .then((entry) => entry.isFile())
    .catch(() => false);
  const result = await run('pnpm', [
    'install', '--offline', '--frozen-lockfile', '--ignore-scripts',
    ...(isWorkspace ? [] : ['--ignore-workspace']),
    '--trust-lockfile',
    ...(storeDirectory ? ['--store-dir', storeDirectory] : []),
  ], fixtureDirectory);
  if (result.exitCode !== 0) {
    throw new Error(`Fixture install failed in ${fixtureDirectory}: ${result.stderr || result.stdout}`);
  }
}

export interface PortableTestRuntime {
  nodeModules: string;
  storeDirectory: string;
  cleanup(): Promise<void>;
}

export async function createPortableTestRuntime(storeDirectory?: string): Promise<PortableTestRuntime> {
  const platform = `${process.platform}-${process.arch}`;
  const archive = TEST_RUNTIME_ARCHIVES.get(platform);
  if (!archive) throw new Error(`Placebo has no vendored test runtime for ${platform}`);
  const directory = await createPlaceboTemporaryDirectory('test-runtime-');
  const extraction = await run('tar', ['-xzf', archive, '-C', directory], directory);
  if (extraction.exitCode !== 0) {
    await rm(directory, { recursive: true, force: true });
    throw new Error(`Portable test runtime extraction failed: ${extraction.stderr}`);
  }
  return {
    nodeModules: join(directory, 'node_modules'),
    storeDirectory: storeDirectory ?? join(directory, 'empty-store'),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

export async function copyPortableTestRuntime(
  fixtureDirectory: string,
  portableRuntime: PortableTestRuntime,
): Promise<void> {
  const nodeModules = join(fixtureDirectory, 'node_modules');
  await mkdir(nodeModules);
  const linked = await run('cp', ['-al', `${portableRuntime.nodeModules}/.`, nodeModules], fixtureDirectory);
  if (linked.exitCode !== 0) {
    await rm(nodeModules, { recursive: true, force: true });
    await cp(portableRuntime.nodeModules, nodeModules, { recursive: true });
  }
  for (const path of ['.modules.yaml', '.package-map.json', '.pnpm-workspace-state-v1.json', '.pnpm/lock.yaml']) {
    const source = join(portableRuntime.nodeModules, path);
    const destination = join(nodeModules, path);
    await rm(destination, { force: true });
    await cp(source, destination);
  }
  const modulesFile = join(nodeModules, '.modules.yaml');
  const modules = JSON.parse(await readFile(modulesFile, 'utf8')) as Record<string, unknown>;
  modules.storeDir = join(portableRuntime.storeDirectory, 'v11');
  await writeFile(modulesFile, `${JSON.stringify(modules, null, 2)}\n`);
}

export async function prepareFixture(
  fixtureDirectory: string,
  storeDirectory?: string,
  portableRuntime?: PortableTestRuntime,
): Promise<void> {
  if (await isPythonFixture(fixtureDirectory)) return;
  const runtime = portableRuntime ?? await createPortableTestRuntime(storeDirectory);
  try {
    await copyPortableTestRuntime(fixtureDirectory, runtime);
    await installFixture(fixtureDirectory, runtime.storeDirectory);
  } finally {
    if (!portableRuntime) await runtime.cleanup();
  }
}

async function isPythonFixture(fixtureDirectory: string): Promise<boolean> {
  try {
    return (await lstat(join(fixtureDirectory, 'pyproject.toml'))).isFile();
  } catch {
    return false;
  }
}

const PYTHON_SUITE_ARGS = ['-B', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'];

/**
 * The visible suite command per fixture language, as one shell line. The
 * harness hands it to the adapter so the agent reproduces the same failure the
 * hidden verification measures.
 */
export function fixtureTestCommand(language: FixtureLanguage): string {
  return language === 'python'
    ? `python3 ${PYTHON_SUITE_ARGS.map((arg) => (arg.includes('*') ? `'${arg}'` : arg)).join(' ')}`
    : 'pnpm test';
}

export interface FixtureSuiteOutcome {
  exitCode: number;
  output: string;
}

/**
 * Runs the fixture's declared visible suite and keeps its combined output, which
 * the counterfactual harness replays as the controller probe observation.
 */
export async function observeFixtureSuite(
  fixtureDirectory: string,
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<FixtureSuiteOutcome> {
  const result = await isPythonFixture(fixtureDirectory)
    ? await run('python3', PYTHON_SUITE_ARGS, fixtureDirectory, {
        PYTHONDONTWRITEBYTECODE: '1',
        ...extraEnv,
      })
    : await run('pnpm', ['test'], fixtureDirectory, extraEnv);
  return {
    exitCode: result.exitCode,
    output: [result.stdout, result.stderr].filter(Boolean).join('\n'),
  };
}

/** Runs the fixture's declared visible suite and returns its exit code. */
export async function runFixtureSuite(
  fixtureDirectory: string,
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<number> {
  return (await observeFixtureSuite(fixtureDirectory, extraEnv)).exitCode;
}

async function runFixture(
  fixtureDirectory: string,
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<boolean> {
  return (await runFixtureSuite(fixtureDirectory, extraEnv)) === 0;
}

async function hiddenTestSetHash(directory: string): Promise<string> {
  const files: Array<{ path: string; content: string }> = [];
  async function visit(current: string, prefix = ''): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(join(current, entry.name), relative);
      else if (entry.isFile()) files.push({ path: relative, content: await readFile(join(current, entry.name), 'utf8') });
      else throw new Error(`Hidden verification contains unsupported entry: ${relative}`);
    }
  }
  await visit(directory);
  if (files.length === 0) throw new Error('Hidden verification must contain at least one file');
  return createHash('sha256').update(canonicalJson(files)).digest('hex');
}

export async function hiddenVerificationHash(benchmarkCase: CorpusCase): Promise<string | undefined> {
  return benchmarkCase.metadata.hiddenVerification
    ? hiddenTestSetHash(join(benchmarkCase.directory, 'hidden'))
    : undefined;
}

async function contentHash(directory: string): Promise<string> {
  const files: Array<{ path: string; sha256: string; size: number }> = [];
  async function visit(current: string, prefix = ''): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path, relative);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        files.push({
          path: relative,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          size: bytes.byteLength,
        });
      } else throw new Error(`Corpus contains unsupported entry: ${relative}`);
    }
  }
  await visit(directory);
  return createHash('sha256').update(canonicalJson(files)).digest('hex');
}

export async function createCorpusManifest(cases?: CorpusCase[]): Promise<CorpusManifest> {
  const selectedCases = [...(cases ?? await discoverBenchmarkCases())]
    .filter(({ id }) => !NON_BENCHMARK_CASE_IDS.has(id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const manifestCases = await Promise.all(selectedCases.map(async (benchmarkCase) => {
    const hiddenTestSetHash = await hiddenVerificationHash(benchmarkCase);
    return {
      id: benchmarkCase.id,
      contentHash: await contentHash(benchmarkCase.directory),
      metadata: benchmarkCase.metadata,
      ...(hiddenTestSetHash === undefined ? {} : { hiddenTestSetHash }),
    };
  }));
  const base = {
    schemaVersion: 'placebo-corpus-manifest-v1' as const,
    corpusVersion: CORPUS_VERSION,
    cases: manifestCases,
    lineage: [{
      version: '0.1' as const,
      caseIds: manifestCases.filter(({ metadata }) => metadata.legacyVersion === '0.1').map(({ id }) => id),
    }],
  };
  return {
    ...base,
    corpusHash: createHash('sha256').update(canonicalJson(base)).digest('hex'),
  };
}

export async function verifyCandidateWithHiddenTests(
  benchmarkCase: CorpusCase,
  candidateDiff: string | undefined,
  portableRuntime?: PortableTestRuntime,
): Promise<HiddenVerificationResult | undefined> {
  const testSetHash = await hiddenVerificationHash(benchmarkCase);
  if (testSetHash === undefined) return undefined;
  if (candidateDiff === undefined) return { result: 'not-run', testSetHash };
  const temporaryRoot = await createPlaceboTemporaryDirectory(`hidden-${benchmarkCase.id}-`);
  const fixture = join(temporaryRoot, 'fixture');
  try {
    await cp(benchmarkCase.fixtureDirectory, fixture, { recursive: true });
    if (benchmarkCase.metadata.language !== 'python') {
      if (portableRuntime === undefined) throw new Error('Node hidden verification requires the portable runtime');
      await copyPortableTestRuntime(fixture, portableRuntime);
    }
    await applyPatch(fixture, benchmarkCase.breakPatch);
    const candidatePatch = join(temporaryRoot, 'candidate.diff');
    await writeFile(candidatePatch, candidateDiff);
    await applyPatch(fixture, candidatePatch);
    if (benchmarkCase.metadata.language !== 'python') {
      if (portableRuntime === undefined) throw new Error('Node hidden verification requires the portable runtime');
      await installFixture(fixture, portableRuntime.storeDirectory);
    }
    await cp(join(benchmarkCase.directory, 'hidden'), join(fixture, 'hidden'), { recursive: true });
    const outcome = benchmarkCase.metadata.language === 'python'
      ? await run('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'hidden', '-p', 'test_*.py'], fixture, {
          PYTHONDONTWRITEBYTECODE: '1',
        })
      : await run('pnpm', ['exec', 'vitest', 'run', 'hidden', '--no-file-parallelism'], fixture);
    return { result: outcome.exitCode === 0 ? 'passed' : 'failed', testSetHash };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export interface SelfCheckResult {
  caseId: string;
  cleanPassed: boolean;
  brokenFailed: boolean;
  brokenRuns?: boolean[];
  placeboPassed: boolean;
  hiddenVerification?: HiddenVerificationResult;
}

export interface SelfCheckOptions { storeDirectory?: string }

export async function selfCheckCorpus(
  corpusDirectory = DEFAULT_CORPUS_DIRECTORY,
  options: SelfCheckOptions = {},
): Promise<SelfCheckResult[]> {
  const cases = await discoverCases(corpusDirectory, { includeVersionedCases: true });
  const results: SelfCheckResult[] = [];
  const portableRuntime = await createPortableTestRuntime(options.storeDirectory);
  try {
    for (const benchmarkCase of cases) {
      const temporaryRoot = await createPlaceboTemporaryDirectory(`check-${benchmarkCase.id}-`);
      const fixture = join(temporaryRoot, 'fixture');
      try {
        await cp(benchmarkCase.fixtureDirectory, fixture, { recursive: true });
        await prepareFixture(fixture, options.storeDirectory, portableRuntime);
        const cleanPassed = await runFixture(fixture);
        await applyPatch(fixture, benchmarkCase.breakPatch);
        if (benchmarkCase.metadata.language !== 'python') {
          await installFixture(fixture, portableRuntime.storeDirectory);
        }
        let brokenRuns: boolean[] | undefined;
        if (benchmarkCase.metadata.kind === 'flaky') {
          brokenRuns = [];
          for (let index = 0; index < 5; index += 1) {
            const attemptRoot = await createPlaceboTemporaryDirectory(`attempt-${benchmarkCase.id}-`);
            const attemptFixture = join(attemptRoot, 'fixture');
            try {
              await cp(fixture, attemptFixture, { recursive: true });
              brokenRuns.push(!(await runFixture(attemptFixture, { SUTURA_TRIAGE_ATTEMPT: String(index) })));
            } finally {
              await rm(attemptRoot, { recursive: true, force: true });
            }
          }
          const expected = benchmarkCase.metadata.triageExitCodes?.map((code) => code !== 0);
          if (JSON.stringify(brokenRuns) !== JSON.stringify(expected)) throw new Error(`${benchmarkCase.id}: triage ratio drifted`);
        }
        const brokenFailed = brokenRuns ? brokenRuns.some(Boolean) : !(await runFixture(fixture));
        await applyPatch(fixture, benchmarkCase.breakPatch, true);
        if (benchmarkCase.metadata.language !== 'python') {
          await installFixture(fixture, portableRuntime.storeDirectory);
        }
        const restoredPassed = await runFixture(fixture);
        if (!restoredPassed) throw new Error(`${benchmarkCase.id}: reverse patch did not restore green`);

        let placeboPassed = false;
        let hiddenVerification: HiddenVerificationResult | undefined;
        if (benchmarkCase.metadata.placebo) {
          await applyPatch(fixture, benchmarkCase.breakPatch);
          const placeboPatch = join(benchmarkCase.directory, benchmarkCase.metadata.placebo);
          await applyPatch(fixture, placeboPatch);
          placeboPassed = await runFixture(fixture);
          hiddenVerification = await verifyCandidateWithHiddenTests(
            benchmarkCase,
            await readFile(placeboPatch, 'utf8'),
            portableRuntime,
          );
        }
        results.push({
          caseId: benchmarkCase.id,
          cleanPassed,
          brokenFailed,
          ...(brokenRuns ? { brokenRuns } : {}),
          placeboPassed,
          ...(hiddenVerification ? { hiddenVerification } : {}),
        });
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }
  } finally {
    await portableRuntime.cleanup();
  }
  return results;
}
