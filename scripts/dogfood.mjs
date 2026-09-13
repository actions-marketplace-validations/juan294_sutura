import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  contentHash, exactSha, publicGitHubUrl, SHA256_PATTERN,
} from './evidence-contract.mjs';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const CANONICAL_LEDGER = 'docs/demo/dogfood-ledger.json';
const SCRATCH_LEDGER = '.sutura/dogfood-ledger-scratch.json';
const ARTIFACT_ROOT = '.sutura/dogfood-artifacts';
const FIXTURE_ROOT = 'packages/placebo/corpus/repair-dogfood-arithmetic';
const OUTCOMES = new Set(['fixed', 'flaky-no-patch', 'refused', 'gave-up', 'infra-stop']);
const MAX_JSON_BYTES = 1024 * 1024;
export const MAX_PHASE_5_SPEND_USD = 14;
const SUTURA_CHECK_NAME = 'Sutura repair audit';
const PROVIDER_CANARY_REPLACEMENT = [
  'export function add(left: number, right: number): number {',
  '  return left + right;',
  '}',
  '',
].join('\n');
const PROVIDER_CANARY_REPLACEMENT_SHA256 = createHash('sha256')
  .update(PROVIDER_CANARY_REPLACEMENT).digest('hex');

function exactRunId(value, name) {
  const text = String(value ?? '');
  if (!/^[1-9]\d{0,19}$/u.test(text)) throw new Error(`${name} must be a workflow run id`);
  return text;
}

function nonnegativeUsd(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${name} must be a bounded nonnegative USD amount`);
  }
  return value;
}

export function validateDogfoodLedger(value) {
  if (value?.schemaVersion !== 'sutura-dogfood-ledger-v1' || !Array.isArray(value.entries) ||
      value.entries.length > 1000) throw new Error('Dogfood ledger schema is invalid');
  const entries = value.entries.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry) ||
        !Number.isSafeInteger(entry.attempt) || entry.attempt < 1 || entry.attempt > 10 ||
        !OUTCOMES.has(entry.outcome)) {
      throw new Error(`Dogfood ledger entry ${index + 1} is invalid`);
    }
    const previous = value.entries[index - 1];
    const expectedAttempt = previous?.actionSha === entry.actionSha ? previous.attempt + 1 : 1;
    if (entry.attempt !== expectedAttempt) {
      throw new Error(`Dogfood ledger entry ${index + 1} attempt sequence is invalid`);
    }
    const normalized = {
      attempt: entry.attempt,
      ciRunId: exactRunId(entry.ciRunId, 'Dogfood CI run'),
      suturaRunId: exactRunId(entry.suturaRunId, 'Dogfood Sutura run'),
      dogfoodSha: exactSha(entry.dogfoodSha, 'Dogfood commit'),
      actionSha: exactSha(entry.actionSha, 'Dogfood Action commit'),
      packagesTreeHash: exactSha(entry.packagesTreeHash, 'Dogfood packages tree'),
      outcome: entry.outcome,
      bundleSha256: SHA256_PATTERN.test(entry.bundleSha256 ?? '')
        ? entry.bundleSha256 : (() => { throw new Error('Dogfood bundle hash is invalid'); })(),
      sandboxUsd: nonnegativeUsd(entry.sandboxUsd, 'Dogfood sandbox cost'),
      inferenceUsd: nonnegativeUsd(entry.inferenceUsd, 'Dogfood inference cost'),
      ...(entry.prUrl === undefined ? {} : {
        prUrl: publicGitHubUrl(entry.prUrl, 'Dogfood pull request'),
      }),
      recordedAt: entry.recordedAt,
    };
    if (typeof normalized.recordedAt !== 'string' ||
        new Date(normalized.recordedAt).toISOString() !== normalized.recordedAt) {
      throw new Error('Dogfood recordedAt must be an ISO timestamp');
    }
    return normalized;
  });
  if (value.resultHash !== contentHash(entries)) throw new Error('Dogfood ledger resultHash is invalid');
  return { schemaVersion: 'sutura-dogfood-ledger-v1', entries, resultHash: value.resultHash };
}

export function dogfoodLedger(entries) {
  return {
    schemaVersion: 'sutura-dogfood-ledger-v1',
    entries,
    resultHash: contentHash(entries),
  };
}

export function dogfoodLedgerCostSummary(entries) {
  let spentMicroUsd = 0;
  let maximumAttemptUsd = 0;
  for (const entry of entries) {
    const attemptUsd = entry.sandboxUsd + entry.inferenceUsd;
    spentMicroUsd = Math.round(spentMicroUsd + attemptUsd * 1_000_000);
    maximumAttemptUsd = Math.max(maximumAttemptUsd, attemptUsd);
  }
  return { spentMicroUsd, maximumAttemptUsd };
}

export function renderDogfoodLedger(ledger) {
  const lines = [
    '# Sutura dogfood streak ledger', '',
    `Result hash: \`${ledger.resultHash}\``, '',
  ];
  if (ledger.entries.length === 0) return `${lines.join('\n')}\nNo live streak attempts are recorded.\n`;
  const trailing = ledger.entries.slice(-10);
  if (trailing.length === 10 && trailing.every((entry) =>
    entry.outcome === 'fixed' && entry.actionSha === trailing[0]?.actionSha)) {
    lines.push(`Trailing fixed streak Action: \`${trailing[0].actionSha}\``, '');
  }
  lines.push('| Attempt | CI run | Sutura run | Outcome | Cost USD |', '| ---: | ---: | ---: | --- | ---: |');
  for (const entry of ledger.entries) {
    lines.push(`| ${entry.attempt} | ${entry.ciRunId} | ${entry.suturaRunId} | ${entry.outcome} | ${(entry.sandboxUsd + entry.inferenceUsd).toFixed(4)} |`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderDogfoodExecutableEquivalence(value) {
  const streakActionSha = exactSha(value.streakActionSha, 'Dogfood streak Action');
  const releaseCommit = exactSha(value.releaseCommit, 'Dogfood release commit');
  if (!SHA256_PATTERN.test(value.executableFingerprint ?? '')) {
    throw new Error('Dogfood executable fingerprint is invalid');
  }
  if (!Number.isSafeInteger(value.fixedAttempts) || value.fixedAttempts < 1 ||
      !Number.isFinite(value.totalUsd) || value.totalUsd < 0 ||
      !Array.isArray(value.paths) || value.paths.length === 0 ||
      !Array.isArray(value.widerDifferences)) {
    throw new Error('Dogfood executable equivalence input is invalid');
  }
  const boundedPath = (path) => typeof path === 'string' && /^[A-Za-z0-9._/-]{1,200}$/u.test(path) &&
    !path.includes('..');
  if (![...value.paths, ...value.widerDifferences].every(boundedPath)) {
    throw new Error('Dogfood executable equivalence path is invalid');
  }
  return [
    '# Sutura v0.2.0 dogfood executable equivalence',
    '',
    `Ten consecutive live repairs ran at \`${streakActionSha}\`.`,
    '',
    `The v0.2.0 release commit is \`${releaseCommit}\`. Its Action metadata and executable bundle have the same Git-object fingerprint as the streak Action.`,
    '',
    `No dogfood run executed at \`${releaseCommit}\`.`,
    '',
    `Fixed attempts: ${value.fixedAttempts}`,
    '',
    `Total live spend: USD ${value.totalUsd.toFixed(6)}`,
    '',
    `Executable fingerprint: \`${value.executableFingerprint}\``,
    '',
    'Executed paths:',
    '',
    ...value.paths.map((path) => `- \`${path}\``),
    '',
    'The wider package tree differs only in these CLI setup and test files:',
    '',
    ...value.widerDifferences.map((path) => `- \`${path}\``),
    '',
  ].join('\n');
}

async function command(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: options.binary ? null : 'utf8',
    maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
    timeout: options.timeout ?? 120_000,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (options.binary) return result.stdout;
  return options.trim === false ? result.stdout : result.stdout.trim();
}

async function readJson(path) {
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_JSON_BYTES) throw new Error(`${path} exceeds ${MAX_JSON_BYTES} bytes`);
  return JSON.parse(bytes.toString('utf8'));
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function withExclusiveLock(path, operation) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let lock;
  try {
    lock = await open(path, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`Dogfood lock is already held: ${basename(path)}`);
    throw error;
  }
  try {
    return await operation();
  } finally {
    try { await lock.close(); } finally { await rm(path, { force: true }); }
  }
}

async function findSingleArtifactFile(root, expectedName) {
  const matches = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) await visit(next);
      else if (entry.isFile() && entry.name === expectedName) matches.push(next);
    }
  }
  await visit(root);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one downloaded ${expectedName}, found ${matches.length}`);
  }
  return matches[0];
}

async function defaultCanaryEvidence(sha, dependencies) {
  const listing = JSON.parse(await dependencies.ghApi(
    `repos/juan294/sutura/actions/workflows/provider-contract-canary.yml/runs?head_sha=${sha}&status=completed&per_page=100`,
  ));
  const runs = Array.isArray(listing?.workflow_runs) ? listing.workflow_runs : [];
  const run = runs.filter((value) => value?.head_sha === sha && value?.conclusion === 'success')
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))[0];
  if (!run || !Number.isSafeInteger(run.id)) throw new Error('missing successful provider canary run');
  const artifacts = JSON.parse(await dependencies.ghApi(
    `repos/juan294/sutura/actions/runs/${run.id}/artifacts?per_page=100`,
  ));
  if (!Number.isSafeInteger(artifacts?.total_count) || artifacts.total_count < 0 ||
      artifacts.total_count > 100 || !Array.isArray(artifacts.artifacts)) {
    throw new Error('invalid or unbounded provider canary artifact metadata');
  }
  const matches = artifacts.artifacts.filter((artifact) =>
    artifact?.name === 'provider-contract-canary' && artifact.expired === false &&
    Number.isSafeInteger(artifact.id) && Number.isSafeInteger(artifact.size_in_bytes) &&
    artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 10 * 1024 * 1024);
  if (matches.length !== 1) throw new Error('missing provider-contract-canary artifact');
  const archive = await dependencies.ghApi(
    `repos/juan294/sutura/actions/artifacts/${matches[0].id}/zip`, true,
  );
  if (!(archive instanceof Uint8Array) || archive.byteLength > 10 * 1024 * 1024) {
    throw new Error('provider canary artifact archive is invalid or too large');
  }
  const directory = await mkdtemp(join(tmpdir(), 'sutura-canary-artifact-'));
  try {
    const zip = join(directory, 'artifact.zip');
    await writeFile(zip, archive);
    const listing = await command('unzip', ['-Z1', zip], { maxBuffer: MAX_JSON_BYTES });
    const files = listing.split(/\r?\n/u).filter((name) =>
      name === `provider-contract-canary-${sha}.json`);
    if (files.length !== 1) throw new Error('provider canary archive must contain one SHA-bound JSON file');
    const text = await command('unzip', ['-p', zip, files[0]], { maxBuffer: MAX_JSON_BYTES });
    return JSON.parse(text);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function defaultRuntimeImageEvidence(sha, dependencies) {
  const listing = JSON.parse(await dependencies.ghApi(
    `repos/juan294/sutura/actions/workflows/provider-contract-canary.yml/runs?head_sha=${sha}&status=completed&per_page=100`,
  ));
  const runs = Array.isArray(listing?.workflow_runs) ? listing.workflow_runs : [];
  const run = runs.filter((value) => value?.head_sha === sha && value?.conclusion === 'success')
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))[0];
  if (!run || !Number.isSafeInteger(run.id)) throw new Error('missing successful runtime image canary run');
  const artifacts = JSON.parse(await dependencies.ghApi(
    `repos/juan294/sutura/actions/runs/${run.id}/artifacts?per_page=100`,
  ));
  if (!Number.isSafeInteger(artifacts?.total_count) || artifacts.total_count < 0 ||
      artifacts.total_count > 100 || !Array.isArray(artifacts.artifacts)) {
    throw new Error('invalid or unbounded runtime image canary artifact metadata');
  }
  const matches = artifacts.artifacts.filter((artifact) =>
    artifact?.name === 'runtime-image-canary' && artifact.expired === false &&
    Number.isSafeInteger(artifact.id) && Number.isSafeInteger(artifact.size_in_bytes) &&
    artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 10 * 1024 * 1024);
  if (matches.length !== 1) throw new Error('missing runtime-image-canary artifact');
  const archive = await dependencies.ghApi(
    `repos/juan294/sutura/actions/artifacts/${matches[0].id}/zip`, true,
  );
  if (!(archive instanceof Uint8Array) || archive.byteLength > 10 * 1024 * 1024) {
    throw new Error('runtime image canary artifact archive is invalid or too large');
  }
  const directory = await mkdtemp(join(tmpdir(), 'sutura-runtime-canary-artifact-'));
  try {
    const zip = join(directory, 'artifact.zip');
    await writeFile(zip, archive);
    const listing = await command('unzip', ['-Z1', zip], { maxBuffer: MAX_JSON_BYTES });
    const files = listing.split(/\r?\n/u).filter((name) =>
      name === `runtime-image-canary-${sha}.json`);
    if (files.length !== 1) throw new Error('runtime image canary archive must contain one SHA-bound JSON file');
    const text = await command('unzip', ['-p', zip, files[0]], { maxBuffer: MAX_JSON_BYTES });
    return JSON.parse(text);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function validateCanaryEvidence(evidence, candidate, expected) {
  if (evidence?.schemaVersion !== 'sutura-provider-contract-canary-v1' ||
      evidence.headSha !== candidate || evidence.contractVersion !== expected.contractVersion ||
      evidence.result?.contractVersion !== expected.contractVersion ||
      evidence.result?.finishReason !== 'stop' || evidence.result?.endpoint !== expected.endpoint ||
      evidence.result?.model !== expected.model || !Number.isFinite(evidence.result?.latencyMs) ||
      evidence.result.latencyMs < 0 || !Number.isSafeInteger(evidence.result?.replacementCodePoints) ||
      evidence.result.replacementCodePoints !== [...PROVIDER_CANARY_REPLACEMENT].length ||
      evidence.result?.replacementSha256 !== PROVIDER_CANARY_REPLACEMENT_SHA256 ||
      (evidence.result?.requestId !== null && typeof evidence.result?.requestId !== 'string') ||
      !Number.isSafeInteger(evidence.result?.usage?.inTok) || evidence.result.usage.inTok <= 0 ||
      !Number.isSafeInteger(evidence.result?.usage?.outTok) || evidence.result.usage.outTok <= 0 ||
      evidence.result?.usage?.reasoningTok !== 0) {
    throw new Error('provider canary artifact contract is invalid');
  }
  return evidence;
}

function validateRuntimeImageEvidence(evidence, candidate, expected) {
  if (evidence?.schemaVersion !== 'sutura-runtime-image-canary-v2' ||
      evidence.headSha !== candidate ||
      evidence.registryResolution?.imageRef !== expected.imageRef ||
      evidence.registryResolution?.indexDigest !== expected.indexDigest ||
      evidence.registryResolution?.linuxAmd64Digest !== expected.linuxAmd64Digest ||
      evidence.proof?.schemaVersion !== expected.schemaVersion ||
      evidence.proof?.imageRef !== expected.imageRef ||
      evidence.proof?.expectedIndexDigest !== expected.indexDigest ||
      evidence.proof?.expectedLinuxAmd64Digest !== expected.linuxAmd64Digest ||
      typeof evidence.proof?.importedImageId !== 'string' || !evidence.proof.importedImageId ||
      JSON.stringify(evidence.proof?.requiredTools) !== JSON.stringify(expected.requiredTools) ||
      evidence.proof?.operationId !== 'sutura-python-runtime-image-proof') {
    throw new Error('runtime image canary artifact contract is invalid');
  }
  return evidence;
}

async function findRegressionTest(runId) {
  const files = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) await visit(next);
      else if (entry.isFile() && /\.test\.[cm]?[jt]s$/u.test(entry.name)) files.push(next);
    }
  }
  await visit(join(ROOT, 'packages'));
  for (const file of files.sort()) {
    const text = await readFile(file, 'utf8');
    const match = text.match(new RegExp(`(?:it|test)\\(\\s*['\"]([^'\"]*live run ${runId}[^'\"]*)`, 'u'));
    if (match?.[1]) return match[1];
  }
  return undefined;
}

export function createDogfoodDependencies(overrides = {}) {
  const dependencies = {
    stdout: process.stdout,
    now: () => Date.now(),
    sleep: (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
    git: (args, options) => command('git', args, options),
    gh: (args, options) => command('gh', args, options),
    ghApi: (endpoint, binary = false) => command('gh', ['api', '-X', 'GET', endpoint], { binary }),
    readLedger: async () => readJson(await exists(resolve(ROOT, SCRATCH_LEDGER))
      ? resolve(ROOT, SCRATCH_LEDGER) : resolve(ROOT, CANONICAL_LEDGER)),
    readCommittedLedger: undefined,
    writeScratchLedger: (ledger) => atomicWrite(
      resolve(ROOT, SCRATCH_LEDGER), `${JSON.stringify(ledger, null, 2)}\n`,
    ),
    canaryEvidence: undefined,
    runtimeImageEvidence: undefined,
    findRegressionTest,
    runRegressionTest: (name) => command('pnpm', [
      '--filter', '@sutura/core', '--filter', '@sutura/action', 'test', '-t', name,
    ]),
    parseReplayArtifact: async (value) => import('./replay-contract.mjs')
      .then(({ parseReplayBundle }) => parseReplayBundle(value)),
    withStreakLock: (operation) => withExclusiveLock(
      resolve(ROOT, '.sutura/dogfood-streak.lock'), operation,
    ),
    ...overrides,
  };
  dependencies.canaryEvidence ??= (sha) => defaultCanaryEvidence(sha, dependencies);
  dependencies.runtimeImageEvidence ??= (sha) => defaultRuntimeImageEvidence(sha, dependencies);
  dependencies.readCommittedLedger ??= async () => JSON.parse(await dependencies.git([
    'show', `HEAD:${CANONICAL_LEDGER}`,
  ]));
  return dependencies;
}

function cleanStatus(text) {
  return text.split(/\r?\n/u).filter(Boolean).filter((line) =>
    !line.slice(3).startsWith('docs/demo/thumbnail/')).join('\n');
}

export async function gateDogfood(sha, inputDependencies = {}) {
  const candidate = exactSha(sha, 'Dogfood candidate');
  const dependencies = createDogfoodDependencies(inputDependencies);
  const checks = [];
  const check = async (name, operation) => {
    try {
      const detail = await operation();
      checks.push({ name, passed: true, detail: String(detail ?? 'PASS') });
    } catch (error) {
      checks.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };
  await check('clean-tree', async () => {
    const status = cleanStatus(await dependencies.git(['status', '--porcelain']));
    if (status) throw new Error(`dirty paths: ${status}`);
    const head = await dependencies.git(['rev-parse', 'HEAD']);
    if (head !== candidate) throw new Error(`HEAD is ${head}`);
  });
  await check('origin-develop', async () => {
    await dependencies.git(['fetch', 'origin', 'develop']);
    const remote = await dependencies.git(['rev-parse', 'origin/develop']);
    if (remote !== candidate) throw new Error(`origin/develop is ${remote}`);
  });
  await check('develop-ci', async () => {
    const response = JSON.parse(await dependencies.ghApi(
      `repos/juan294/sutura/actions/workflows/ci.yml/runs?head_sha=${candidate}&status=completed&per_page=100`,
    ));
    const valid = (response?.workflow_runs ?? []).some((run) =>
      run?.head_sha === candidate && run?.head_branch === 'develop' && run?.event === 'push' && run?.conclusion === 'success');
    if (!valid) throw new Error('missing successful develop push CI');
  });
  await check('provider-canary', async () => {
    const evidence = await dependencies.canaryEvidence(candidate);
    const core = await import('../packages/core/dist/index.js');
    validateCanaryEvidence(evidence, candidate, {
      contractVersion: core.SUPER_REPAIR_PROVIDER_CONTRACT_VERSION,
      endpoint: `${core.TOKEN_FACTORY_BASE_URL}chat/completions`,
      model: core.DEFAULT_MODELS.super,
    });
    const age = dependencies.now() - Date.parse(evidence.capturedAt);
    if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) {
      throw new Error('provider canary is older than 24 hours');
    }
  });
  await check('runtime-image-canary', async () => {
    const evidence = await dependencies.runtimeImageEvidence(candidate);
    const core = await import('../packages/core/dist/index.js');
    validateRuntimeImageEvidence(evidence, candidate, {
      schemaVersion: core.PYTHON_IMAGE_PROOF_SCHEMA_VERSION,
      imageRef: core.PYTHON_IMAGE_REF,
      indexDigest: core.PYTHON_IMAGE_INDEX_DIGEST,
      linuxAmd64Digest: core.PYTHON_IMAGE_LINUX_AMD64_DIGEST,
      requiredTools: core.PYTHON_REQUIRED_TOOLS,
    });
    const age = dependencies.now() - Date.parse(evidence.capturedAt);
    if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) {
      throw new Error('runtime image canary is older than 24 hours');
    }
  });
  await check('ledger', async () => {
    const ledger = validateDogfoodLedger(await dependencies.readLedger());
    const last = ledger.entries.at(-1);
    if (last && last.outcome !== 'fixed') {
      const testName = await dependencies.findRegressionTest(last.suturaRunId);
      if (!testName) throw new Error(`missing regression test for live run ${last.suturaRunId}`);
      await dependencies.runRegressionTest(testName);
    }
  });
  await check('packages-tree', async () => {
    const tree = await dependencies.git(['rev-parse', `${candidate}:packages`]);
    exactSha(tree, 'Dogfood packages tree');
  });
  for (const result of checks) {
    dependencies.stdout.write(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}\n`);
  }
  if (checks.some(({ passed }) => !passed)) throw new Error('Dogfood gate failed');
  return checks;
}

async function poll(dependencies, description, read, accept, timeoutMs = 30 * 60 * 1000) {
  const deadline = dependencies.now() + timeoutMs;
  while (dependencies.now() <= deadline) {
    const value = await read();
    const accepted = await accept(value);
    if (accepted !== undefined) return accepted;
    await dependencies.sleep(10_000);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

const GH_LOG_PREFIX = String.raw`(?:[^\t\n]+\t[^\t\n]+\t\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z )?`;

function evidenceLinePattern(message) {
  return `^${GH_LOG_PREFIX}${message}$`;
}

export function costFromLog(log, label) {
  const matches = [...log.matchAll(new RegExp(
    evidenceLinePattern(`${label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}[^\\n]*cost USD=(?<cost>\\d+(?:\\.\\d+)?)`),
    'gmu',
  ))];
  if (matches.length !== 1 || !matches[0]?.groups?.cost) {
    throw new Error(`${label} must contain exactly one valid cost line`);
  }
  return nonnegativeUsd(Number(matches[0].groups.cost), `${label} cost`);
}

export function outcomeFromLog(log) {
  const matches = [...log.matchAll(new RegExp(
    evidenceLinePattern('Sutura outcome: (\\S+)'), 'gmu',
  ))];
  const outcome = matches.length === 1 ? matches[0]?.[1] : undefined;
  if (!OUTCOMES.has(outcome)) throw new Error('Sutura outcome must appear exactly once and be valid');
  return outcome;
}

export function inferenceCostFromEvidence(log, replayEvidence) {
  const missingInferenceIsProvenZero = replayEvidence.zeroInference &&
    !new RegExp(evidenceLinePattern('Nemotron runtime:[^\\n]*'), 'mu').test(log) &&
    new RegExp(evidenceLinePattern(
      'ConTree runtime: sandbox preparation failed before reproduction;[^\\n]*',
    ), 'mu').test(log);
  return missingInferenceIsProvenZero ? 0 : costFromLog(log, 'Nemotron runtime:');
}

export function validateFailedCiJobs(jobs) {
  const failed = (Array.isArray(jobs) ? jobs : []).flatMap((job) =>
    (Array.isArray(job?.steps) ? job.steps : [])
      .filter((step) => step?.conclusion === 'failure')
      .map((step) => ({ job: job?.name, step: step?.name })),
  );
  if (failed.length !== 1 || failed[0]?.step !== 'Run pnpm run test') {
    throw new Error(`Dogfood CI must fail only at pnpm run test; found ${JSON.stringify(failed)}`);
  }
  return failed[0];
}

export function validateSuturaCheckRuns(checkRuns, options) {
  const expectedConclusion = options.outcome === 'fixed' || options.outcome === 'flaky-no-patch'
    ? 'neutral' : 'action_required';
  const externalId = `sutura:juan294/sutura:workflow-run:${options.ciRunId}`;
  const matches = (Array.isArray(checkRuns) ? checkRuns : []).filter((check) =>
    check?.name === SUTURA_CHECK_NAME && check?.external_id === externalId &&
    check?.head_sha === options.dogfoodSha && check?.status === 'completed');
  if (matches.length !== 1 || matches[0]?.conclusion !== expectedConclusion) {
    throw new Error(`Sutura check-run conclusion differs from ${expectedConclusion}`);
  }
  return matches[0];
}

export function validateDogfoodReplay(bundle, options) {
  if (bundle?.runId !== options.ciRunId || bundle?.actionSha !== options.actionSha ||
      bundle?.outcome !== options.outcome ||
      bundle?.completeness?.overflowedBoundaries?.length !== 0) {
    throw new Error('Dogfood replay bundle identity, outcome, or completeness differs');
  }
  const complete = bundle.completeness.complete === true &&
    bundle.completeness.pendingBoundaries?.length === 0;
  const zeroInference = options.outcome === 'infra-stop' && !complete &&
    bundle.completeness.pendingBoundaries?.includes('nebius') === true &&
    bundle.http?.every((exchange) => exchange?.boundary !== 'nebius') === true;
  if (!complete && !zeroInference) {
    throw new Error('Dogfood replay bundle identity, outcome, or completeness differs');
  }
  return { complete, zeroInference };
}

async function appendScratchEntry(entry, dependencies) {
  return withExclusiveLock(resolve(ROOT, '.sutura/dogfood-ledger.lock'), async () => {
    const ledger = validateDogfoodLedger(await dependencies.readLedger());
    const canonical = validateDogfoodLedger(await dependencies.readCommittedLedger());
    assertAppendOnlyLedger(ledger, canonical);
    const next = validateDogfoodLedger(dogfoodLedger([...ledger.entries, entry]));
    await dependencies.writeScratchLedger(next);
    return next;
  });
}

export function assertAppendOnlyLedger(next, committed) {
  if (next.entries.length < committed.entries.length ||
      JSON.stringify(next.entries.slice(0, committed.entries.length)) !== JSON.stringify(committed.entries)) {
    throw new Error('Dogfood ledger is not append-only');
  }
}

export function createSuturaRunCorrelator(ciRunId, dependencies) {
  const targetRunId = exactRunId(ciRunId, 'Dogfood CI run');
  const inspected = new Set();
  const correlated = new Map();
  return async (runs) => {
    if (!Array.isArray(runs) || runs.length > 100) {
      throw new Error('Sutura run list is invalid or unbounded');
    }
    for (const run of runs.filter((value) => value?.status === 'completed')) {
      const runId = exactRunId(run.databaseId, 'Dogfood Sutura run');
      if (inspected.has(runId)) continue;
      const artifacts = JSON.parse(await dependencies.ghApi(
        `repos/juan294/sutura/actions/runs/${runId}/artifacts?per_page=100`,
      ));
      if (!Number.isSafeInteger(artifacts?.total_count) || artifacts.total_count < 0 ||
          artifacts.total_count > 100 || !Array.isArray(artifacts.artifacts) ||
          artifacts.artifacts.length > 100) {
        throw new Error('Sutura artifact metadata is invalid or unbounded');
      }
      const matches = artifacts.artifacts
        .filter(({ name }) => name === `sutura-case-file-${targetRunId}.html`);
      if (matches.length > 1) {
        throw new Error('Sutura run has duplicate correlated case-file artifacts');
      }
      inspected.add(runId);
      if (matches.length === 1) correlated.set(runId, run);
    }
    if (correlated.size > 1) {
      throw new Error('Multiple Sutura runs correlate to the dogfood CI run');
    }
    return correlated.values().next().value;
  };
}

export async function runDogfoodAttempt(options, inputDependencies = {}) {
  const sha = exactSha(options.sha, 'Dogfood candidate');
  if (!Number.isSafeInteger(options.attempt) || options.attempt < 1 || options.attempt > 10) {
    throw new Error('Dogfood attempt must be an integer from 1 through 10');
  }
  const dependencies = createDogfoodDependencies(inputDependencies);
  await (dependencies.gate ?? gateDogfood)(sha, dependencies);
  const ledger = validateDogfoodLedger(await dependencies.readLedger());
  const lastEntry = ledger.entries.at(-1);
  const expectedAttempt = lastEntry?.actionSha === sha ? lastEntry.attempt + 1 : 1;
  if (options.attempt !== expectedAttempt) {
    throw new Error(`Dogfood attempt must be ${expectedAttempt}`);
  }
  if (dependencies.executeAttempt) {
    const entry = await dependencies.executeAttempt({ sha, attempt: options.attempt });
    await (dependencies.appendEntry ?? appendScratchEntry)(entry, dependencies);
    return entry;
  }

  const branch = `dogfood/streak-${sha.slice(0, 7)}-${options.attempt}`;
  const worktree = await mkdtemp(join(tmpdir(), 'sutura-dogfood-'));
  try {
    await dependencies.git(['worktree', 'add', '-b', branch, worktree, sha]);
    for (const name of ['dogfood-add.ts', 'dogfood-add.test.ts']) {
      const object = `${sha}:${FIXTURE_ROOT}/fixture/packages/core/src/${name}`;
      await writeFile(
        join(worktree, 'packages/core/src', name),
        await dependencies.git(['show', object], { trim: false }),
      );
    }
    await dependencies.git(['apply', resolve(ROOT, FIXTURE_ROOT, 'break.diff')], { cwd: worktree });
    await dependencies.git(['add', 'packages/core/src/dogfood-add.ts', 'packages/core/src/dogfood-add.test.ts'], { cwd: worktree });
    await dependencies.git(['commit', '-m', `test: dogfood streak attempt ${options.attempt} on ${sha.slice(0, 7)}`], { cwd: worktree });
    const dogfoodSha = await dependencies.git(['rev-parse', 'HEAD'], { cwd: worktree });
    await dependencies.git(['push', 'origin', branch], { cwd: worktree });
    await dependencies.gh(['workflow', 'run', 'ci.yml', '--ref', branch]);
    const ciRun = await poll(dependencies, 'dogfood CI', async () => JSON.parse(await dependencies.gh([
      'run', 'list', '--branch', branch, '--workflow', 'ci.yml', '--limit', '20',
      '--json', 'databaseId,headSha,status,conclusion,event',
    ])), (runs) => {
      const run = runs.find((value) => value?.headSha === dogfoodSha && value?.status === 'completed');
      if (!run) return undefined;
      if (run.conclusion !== 'failure') throw new Error('Dogfood CI must fail before repair');
      return run;
    });
    const ciRunId = exactRunId(ciRun.databaseId, 'Dogfood CI run');
    const ciDetails = JSON.parse(await dependencies.gh([
      'run', 'view', ciRunId, '--json', 'jobs',
    ]));
    validateFailedCiJobs(ciDetails?.jobs);
    const correlateSuturaRun = createSuturaRunCorrelator(ciRunId, dependencies);
    const sutura = await poll(dependencies, 'correlated Sutura artifact', async () => JSON.parse(await dependencies.gh([
      'run', 'list', '--workflow', 'sutura.yml', '--limit', '100', '--json', 'databaseId,status,conclusion',
    ])), correlateSuturaRun);
    const suturaRunId = exactRunId(sutura.databaseId, 'Dogfood Sutura run');
    const artifactDirectory = resolve(ROOT, ARTIFACT_ROOT, ciRunId);
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
    await dependencies.gh([
      'run', 'download', suturaRunId, '--name', `sutura-case-file-${ciRunId}.html`,
      '--dir', artifactDirectory,
    ]);
    await dependencies.gh([
      'run', 'download', suturaRunId, '--name', `sutura-replay-${ciRunId}.json`,
      '--dir', artifactDirectory,
    ]);
    await findSingleArtifactFile(artifactDirectory, `sutura-case-file-${ciRunId}.html`);
    const bundlePath = await findSingleArtifactFile(artifactDirectory, `sutura-replay-${ciRunId}.json`);
    const bundleBytes = await readFile(bundlePath);
    const bundleSha256 = createHash('sha256').update(bundleBytes).digest('hex');
    const log = await dependencies.gh(['run', 'view', suturaRunId, '--log'], { maxBuffer: 50 * 1024 * 1024 });
    const outcome = outcomeFromLog(log);
    const expectedWorkflowConclusion = outcome === 'fixed' ? 'success' : 'failure';
    if (sutura.conclusion !== expectedWorkflowConclusion) {
      throw new Error(`Sutura workflow conclusion differs from ${expectedWorkflowConclusion}`);
    }
    const bundle = await dependencies.parseReplayArtifact(bundleBytes);
    const replayEvidence = validateDogfoodReplay(bundle, { ciRunId, actionSha: sha, outcome });
    const checkRuns = JSON.parse(await dependencies.ghApi(
      `repos/juan294/sutura/commits/${dogfoodSha}/check-runs?per_page=100`,
    ));
    validateSuturaCheckRuns(checkRuns?.check_runs, { outcome, ciRunId, dogfoodSha });
    const sandboxUsd = costFromLog(log, 'Sandbox evidence:');
    const inferenceUsd = inferenceCostFromEvidence(log, replayEvidence);
    let prUrl;
    if (outcome === 'fixed') {
      const prs = JSON.parse(await dependencies.gh([
        'pr', 'list', '--head', `sutura/fix-${ciRunId}`, '--state', 'all',
        '--json', 'url,headRefName,headRefOid', '--limit', '10',
      ]));
      if (prs.length !== 1) throw new Error('Fixed dogfood run must create one repair PR');
      prUrl = publicGitHubUrl(prs[0].url, 'Dogfood repair PR');
      const repairSha = exactSha(prs[0].headRefOid, 'Dogfood repair commit');
      await dependencies.git(['fetch', 'origin', prs[0].headRefName]);
      const fetchedRepairSha = await dependencies.git(['rev-parse', 'FETCH_HEAD']);
      if (fetchedRepairSha !== repairSha) throw new Error('Fetched repair branch differs from repair PR head');
      const parent = await dependencies.git(['rev-parse', `${repairSha}^`]);
      if (parent !== dogfoodSha) throw new Error('Dogfood repair parent differs from dogfood commit');
      const diff = await dependencies.git([
        'diff', '--no-ext-diff', `${dogfoodSha}..${repairSha}`, '--', 'packages/core/src/dogfood-add.ts',
      ]);
      const changed = await dependencies.git(['diff', '--name-only', `${dogfoodSha}..${repairSha}`]);
      const canonicalRepair = await readFile(resolve(ROOT, FIXTURE_ROOT, 'repair.diff'), 'utf8');
      const normalizePatch = (value) => value.replace(/^index [^\n]*\n/gmu, '').trimEnd();
      if (changed !== 'packages/core/src/dogfood-add.ts' ||
          normalizePatch(diff) !== normalizePatch(canonicalRepair)) {
        throw new Error('Dogfood repair differs from the canonical one-line fix');
      }
      await dependencies.gh(['workflow', 'run', 'ci.yml', '--ref', prs[0].headRefName]);
      await poll(dependencies, 'repair branch CI', async () => JSON.parse(await dependencies.gh([
        'run', 'list', '--branch', prs[0].headRefName, '--workflow', 'ci.yml', '--limit', '20',
        '--json', 'headSha,status,conclusion',
      ])), (runs) => {
        const run = runs.find((value) => value?.headSha === repairSha && value?.status === 'completed');
        if (!run) return undefined;
        if (run.conclusion !== 'success') throw new Error('Repair branch CI failed');
        return run;
      });
    }
    const packagesTreeHash = await dependencies.git(['rev-parse', `${sha}:packages`]);
    const entry = {
      attempt: options.attempt, ciRunId, suturaRunId, dogfoodSha,
      actionSha: sha, packagesTreeHash: exactSha(packagesTreeHash, 'Dogfood packages tree'),
      outcome, bundleSha256, sandboxUsd, inferenceUsd,
      ...(prUrl ? { prUrl } : {}),
      recordedAt: new Date(dependencies.now()).toISOString(),
    };
    await (dependencies.appendEntry ?? appendScratchEntry)(entry, dependencies);
    if (outcome === 'gave-up' || outcome === 'refused') {
      const { installCompleteCapturedFixture } = await import('./capture-run.mjs');
      await (dependencies.promoteNonFixed ?? dependencies.promoteGaveUp ?? installCompleteCapturedFixture)({
        workflowRunId: ciRunId,
        suturaRunId,
        headSha: dogfoodSha,
        bundleBytes,
        outDir: resolve(ROOT, 'packages/action/src/__fixtures__/captured'),
        notes: `Live dogfood streak attempt ${options.attempt} ${outcome}`,
      });
    }
    return entry;
  } finally {
    await dependencies.git(['worktree', 'remove', '--force', worktree]).catch(() => undefined);
    await rm(worktree, { recursive: true, force: true });
  }
}

export async function runDogfoodStreak(options, inputDependencies = {}) {
  if (options.authorize !== true) throw new Error('Dogfood streak requires literal --authorize');
  const sha = exactSha(options.sha, 'Dogfood candidate');
  const capUsd = nonnegativeUsd(options.capUsd, 'Dogfood cap');
  const initialReserveUsd = nonnegativeUsd(options.initialReserveUsd ?? 1.5, 'Dogfood initial reserve');
  if (capUsd > MAX_PHASE_5_SPEND_USD) {
    throw new Error(`Dogfood cap must not exceed USD ${MAX_PHASE_5_SPEND_USD}`);
  }
  if (initialReserveUsd < 1.5) throw new Error('Dogfood initial reserve must be at least USD 1.50');
  const dependencies = createDogfoodDependencies(inputDependencies);
  return dependencies.withStreakLock(async () => {
    const runAttempt = dependencies.runDogfoodAttempt ?? runDogfoodAttempt;
    const initialLedger = validateDogfoodLedger(await dependencies.readLedger());
    const lastEntry = initialLedger.entries.at(-1);
    if (lastEntry?.actionSha === sha && lastEntry.outcome !== 'fixed') {
      throw new Error('Dogfood streak requires a new candidate after a non-fixed outcome');
    }
    const existingFixed = [];
    for (let index = initialLedger.entries.length - 1; index >= 0; index -= 1) {
      const entry = initialLedger.entries[index];
      if (entry?.outcome !== 'fixed' || entry.actionSha !== sha) break;
      existingFixed.unshift(entry);
    }
    if (existingFixed.length > 10) throw new Error('Dogfood ledger has more than ten trailing fixed attempts');
    const costSummary = dogfoodLedgerCostSummary(initialLedger.entries);
    let spent = costSummary.spentMicroUsd / 1_000_000;
    let observedMaximum = costSummary.maximumAttemptUsd;
    let reserve = existingFixed.length > 0 ? observedMaximum : initialReserveUsd;
    const entries = [];
    for (let index = 0; index < 10 - existingFixed.length; index += 1) {
      if (Math.round((spent + reserve) * 1_000_000) > Math.round(capUsd * 1_000_000)) break;
      const attempt = existingFixed.length + index + 1;
      const entry = await runAttempt({ sha, attempt }, dependencies);
      entries.push(entry);
      const cost = nonnegativeUsd(entry.sandboxUsd + entry.inferenceUsd, 'Dogfood attempt cost');
      spent = Math.round((spent + cost) * 1_000_000) / 1_000_000;
      observedMaximum = Math.max(observedMaximum, cost);
      reserve = observedMaximum;
      if (entry.outcome !== 'fixed') break;
    }
    const streakEntries = [...existingFixed, ...entries];
    dependencies.stdout.write(`Dogfood streak: ${streakEntries.filter(({ outcome }) => outcome === 'fixed').length}/10; total Phase 5 cost USD=${spent.toFixed(4)}\n`);
    if (streakEntries.length === 10 && streakEntries.every(({ outcome }) => outcome === 'fixed')) {
      const ledger = validateDogfoodLedger(await dependencies.readLedger());
      await atomicWrite(resolve(ROOT, CANONICAL_LEDGER), `${JSON.stringify(ledger, null, 2)}\n`);
      await atomicWrite(resolve(ROOT, 'docs/demo/dogfood-ledger.md'), renderDogfoodLedger(ledger));
    }
    return { entries, streakEntries, spent, reserve };
  });
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const commandName = args[0];
  if (commandName === 'gate') {
    const sha = args.includes('--sha') ? valueAfter(args, '--sha') : await createDogfoodDependencies(dependencies).git(['rev-parse', 'HEAD']);
    return gateDogfood(sha, dependencies);
  }
  if (commandName === 'run') {
    const resolved = createDogfoodDependencies(dependencies);
    return resolved.withStreakLock(() => runDogfoodAttempt({
      sha: valueAfter(args, '--sha'), attempt: Number(valueAfter(args, '--attempt')),
    }, resolved));
  }
  if (commandName === 'streak') {
    return runDogfoodStreak({
      sha: valueAfter(args, '--sha'),
      authorize: args.includes('--authorize'),
      capUsd: Number(valueAfter(args, '--cap-usd')),
      initialReserveUsd: args.includes('--initial-reserve-usd')
        ? Number(valueAfter(args, '--initial-reserve-usd')) : 1.5,
    }, dependencies);
  }
  throw new Error('Usage: dogfood.mjs gate [--sha <sha>] | run --sha <sha> --attempt <n> | streak --sha <sha> --authorize --cap-usd <usd> [--initial-reserve-usd <usd>]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
