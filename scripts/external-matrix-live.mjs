import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  canonicalJson, contentHash, exactSha, publicGitHubUrl, SHA256_PATTERN,
} from './evidence-contract.mjs';
import {
  assertPublicArtifactSafe, gatePlaceboLive, placeboSpendDecision, validateLiveSpendBounds,
} from './placebo-live.mjs';
import { requireActivePushFreeze } from './push-freeze.mjs';
import {
  EXTERNAL_MATRIX_CASES, EXTERNAL_MATRIX_RELEASE_VERSION,
  createExternalMatrixManifest, validateExternalMatrixResult,
} from './test-external-matrix.mjs';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const DEMO_REPOSITORY = 'juan294/sutura-demo';
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const MODES = new Set(['candidate', 'public']);

function mode(value) {
  if (!MODES.has(value)) throw new Error('External matrix live mode is invalid');
  return value;
}

function runId(value) {
  const text = String(value ?? '');
  if (!/^[1-9]\d{0,19}$/u.test(text)) throw new Error('External matrix run ID is invalid');
  return text;
}

function artifactName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new Error('External matrix artifact name is invalid');
  }
  return value;
}

function artifactBase(input, options) {
  const selectedMode = mode(options.mode);
  const actionSha = exactSha(options.actionSha, 'External matrix Action');
  const result = validateExternalMatrixResult(
    input, EXTERNAL_MATRIX_RELEASE_VERSION, actionSha, selectedMode,
  );
  const base = {
    schemaVersion: 'sutura-external-matrix-case-v1',
    ...result,
    ...(input.cleanupBranch === undefined ? {} : { cleanupBranch: input.cleanupBranch }),
    ...(input.cleanupPullRequests === undefined ? {} : { cleanupPullRequests: input.cleanupPullRequests }),
  };
  if (base.cleanupBranch !== undefined &&
      (typeof base.cleanupBranch !== 'string' ||
       base.cleanupBranch !== `matrix/${base.controllerId}/${base.caseId}`)) {
    throw new Error(`${base.caseId} cleanup branch is not controller-owned`);
  }
  if (base.cleanupPullRequests !== undefined && (!Array.isArray(base.cleanupPullRequests) ||
      base.cleanupPullRequests.length > 2 || new Set(base.cleanupPullRequests).size !== base.cleanupPullRequests.length)) {
    throw new Error(`${base.caseId} cleanup pull requests are invalid`);
  }
  for (const pullRequest of base.cleanupPullRequests ?? []) {
    const url = new URL(publicGitHubUrl(pullRequest, `${base.caseId} cleanup pull request`));
    if (!/^\/juan294\/sutura-demo\/pull\/[1-9]\d*$/u.test(url.pathname) || url.search || url.hash) {
      throw new Error(`${base.caseId} cleanup pull request is invalid`);
    }
  }
  return base;
}

export function createExternalMatrixCaseArtifact(input, options) {
  const base = artifactBase(input, options);
  const artifact = { ...base, resultHash: contentHash(base) };
  assertPublicArtifactSafe(artifact);
  if (Buffer.byteLength(canonicalJson(artifact)) > MAX_ARTIFACT_BYTES) {
    throw new Error('External matrix case artifact is too large');
  }
  return artifact;
}

export function validateExternalMatrixCaseArtifact(input, options) {
  const base = artifactBase(input, options);
  if (input.resultHash !== contentHash(base)) throw new Error('External matrix case resultHash is invalid');
  return { ...base, resultHash: input.resultHash };
}

export function createExternalMatrixLedger(selectedMode, entries) {
  const normalizedMode = mode(selectedMode);
  const base = { mode: normalizedMode, entries };
  return {
    schemaVersion: 'sutura-external-matrix-live-ledger-v1',
    ...base,
    resultHash: contentHash(base),
  };
}

export function validateExternalMatrixLedger(value) {
  const selectedMode = mode(value?.mode);
  if (value?.schemaVersion !== 'sutura-external-matrix-live-ledger-v1' ||
      !Array.isArray(value.entries) || value.entries.length > 8 ||
      value.resultHash !== contentHash({ mode: selectedMode, entries: value.entries })) {
    throw new Error('External matrix live ledger schema or resultHash is invalid');
  }
  const caseIds = new Set();
  const runIds = new Set();
  const entries = value.entries.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry) ||
        typeof entry.caseId !== 'string' || caseIds.has(entry.caseId) ||
        runIds.has(entry.runId) || !SHA256_PATTERN.test(entry.artifactSha256 ?? '') ||
        !SHA256_PATTERN.test(entry.resultHash ?? '') ||
        typeof entry.falseApproval !== 'boolean' ||
        (entry.costStatus !== 'observed' && entry.costStatus !== 'unavailable')) {
      throw new Error(`External matrix ledger entry ${index + 1} is invalid or duplicate`);
    }
    caseIds.add(entry.caseId);
    runIds.add(entry.runId);
    const normalizedRunId = runId(entry.runId);
    const url = new URL(publicGitHubUrl(entry.runUrl, 'External matrix workflow run'));
    if (url.pathname !== `/juan294/sutura-demo/actions/runs/${normalizedRunId}`) {
      throw new Error(`External matrix ledger entry ${index + 1} run URL is invalid`);
    }
    const timestamp = new Date(entry.recordedAt);
    if (Number.isNaN(timestamp.valueOf()) || timestamp.toISOString() !== entry.recordedAt ||
        (entry.totalUsd !== null && (typeof entry.totalUsd !== 'number' || !Number.isFinite(entry.totalUsd) ||
        entry.totalUsd < 0 || entry.totalUsd > 100)) ||
        (entry.costStatus === 'observed' && entry.totalUsd === null) ||
        (entry.costStatus === 'unavailable' && entry.totalUsd !== null)) {
      throw new Error(`External matrix ledger entry ${index + 1} time or cost is invalid`);
    }
    if (typeof entry.controllerId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/u.test(entry.controllerId)) {
      throw new Error(`External matrix ledger entry ${index + 1} controller is invalid`);
    }
    if (entry.cleanupBranch !== undefined &&
        entry.cleanupBranch !== `matrix/${entry.controllerId}/${entry.caseId}`) {
      throw new Error(`External matrix ledger entry ${index + 1} cleanup branch is not controller-owned`);
    }
    if (entry.cleanupPullRequests !== undefined && (!Array.isArray(entry.cleanupPullRequests) ||
        entry.cleanupPullRequests.length > 2 ||
        new Set(entry.cleanupPullRequests).size !== entry.cleanupPullRequests.length)) {
      throw new Error(`External matrix ledger entry ${index + 1} cleanup pull requests are invalid`);
    }
    for (const pullRequest of entry.cleanupPullRequests ?? []) {
      const pullRequestUrl = new URL(publicGitHubUrl(pullRequest, 'External matrix cleanup pull request'));
      if (!/^\/juan294\/sutura-demo\/pull\/[1-9]\d*$/u.test(pullRequestUrl.pathname) ||
          pullRequestUrl.search || pullRequestUrl.hash) {
        throw new Error(`External matrix ledger entry ${index + 1} cleanup pull request is invalid`);
      }
    }
    return {
      caseId: entry.caseId,
      runId: normalizedRunId,
      runUrl: url.toString(),
      artifactName: artifactName(entry.artifactName),
      artifactSha256: entry.artifactSha256,
      resultHash: entry.resultHash,
      controllerId: entry.controllerId,
      controllerSha: exactSha(entry.controllerSha, 'External matrix controller'),
      actionSha: exactSha(entry.actionSha, 'External matrix Action'),
      demoCommit: exactSha(entry.demoCommit, 'External matrix demo commit'),
      totalUsd: entry.totalUsd,
      costStatus: entry.costStatus,
      falseApproval: entry.falseApproval,
      recordedAt: entry.recordedAt,
      ...(entry.cleanupBranch === undefined ? {} : { cleanupBranch: entry.cleanupBranch }),
      ...(entry.cleanupPullRequests === undefined ? {} : { cleanupPullRequests: entry.cleanupPullRequests }),
    };
  });
  const identities = (field) => new Set(entries.map((entry) => entry[field])).size <= 1;
  if (!identities('controllerSha') || !identities('actionSha') || !identities('demoCommit')) {
    throw new Error('External matrix ledger identity drift is invalid');
  }
  return createExternalMatrixLedger(selectedMode, entries);
}

export function appendExternalMatrixLedger(ledgerInput, artifactInput, metadata, options) {
  const ledger = validateExternalMatrixLedger(ledgerInput);
  if (ledger.mode !== options.mode) throw new Error('External matrix ledger mode mismatch');
  const artifact = validateExternalMatrixCaseArtifact(artifactInput, options);
  if (ledger.entries.some(({ caseId, runId }) =>
    caseId === artifact.caseId || runId === artifact.demoRunId)) {
    throw new Error('External matrix ledger cannot append a duplicate case or run');
  }
  const bytes = metadata.artifactBytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error('External matrix downloaded artifact is invalid or too large');
  }
  const entry = {
    caseId: artifact.caseId,
    runId: artifact.demoRunId,
    runUrl: metadata.runUrl,
    artifactName: `sutura-matrix-${artifact.controllerId}-${artifact.caseId}`,
    artifactSha256: createHash('sha256').update(bytes).digest('hex'),
    resultHash: artifact.resultHash,
    controllerId: artifact.controllerId,
    controllerSha: exactSha(metadata.controllerSha ?? artifact.actionCommit, 'External matrix controller'),
    actionSha: artifact.actionCommit,
    demoCommit: artifact.demoCommit,
    totalUsd: artifact.costStatus === 'observed'
      ? artifact.inferenceCostUsd + artifact.sandboxCostUsd
      : null,
    costStatus: artifact.costStatus,
    falseApproval: artifact.falseApproval,
    recordedAt: metadata.recordedAt,
    ...(artifact.cleanupBranch === undefined ? {} : { cleanupBranch: artifact.cleanupBranch }),
    ...(artifact.cleanupPullRequests === undefined ? {} : { cleanupPullRequests: artifact.cleanupPullRequests }),
  };
  return validateExternalMatrixLedger(createExternalMatrixLedger(ledger.mode, [...ledger.entries, entry]));
}

export async function runExternalMatrixStreak(options, dependencies) {
  if (options.authorize !== true) throw new Error('External matrix streak requires literal --authorize');
  const selectedMode = mode(options.mode);
  exactSha(options.controllerSha, 'External matrix controller');
  exactSha(options.actionSha, 'External matrix Action');
  const { capUsd, initialReserveUsd } = validateLiveSpendBounds(
    options.capUsd, options.initialReserveUsd, 'External matrix',
  );
  let ledger = validateExternalMatrixLedger(await dependencies.readLedger());
  if (ledger.mode !== selectedMode) throw new Error('External matrix ledger mode differs from requested mode');
  if (ledger.entries.some((entry) => entry.controllerSha !== options.controllerSha ||
      entry.actionSha !== options.actionSha)) {
    throw new Error('External matrix ledger identity differs from requested identity');
  }
  let spentUsd = ledger.entries.reduce((sum, entry) => sum + (entry.totalUsd ?? 0), 0);
  let maximumUsd = ledger.entries.reduce((maximum, entry) => Math.max(maximum, entry.totalUsd ?? 0), 0);
  let stoppedFor = 'complete';
  for (const definition of EXTERNAL_MATRIX_CASES) {
    if (ledger.entries.some(({ caseId }) => caseId === definition.caseId)) continue;
    const decision = placeboSpendDecision({
      spentUsd, observedMaximumUsd: maximumUsd,
      initialReserveUsd, capUsd,
    });
    if (!decision.mayDispatch) { stoppedFor = 'cap-reserve'; break; }
    const completed = await dependencies.runCase(definition);
    ledger = validateExternalMatrixLedger(completed.ledger);
    const artifact = validateExternalMatrixCaseArtifact(completed.artifact, {
      mode: selectedMode, actionSha: options.actionSha,
    });
    if (artifact.costStatus === 'observed') {
      spentUsd += artifact.inferenceCostUsd + artifact.sandboxCostUsd;
      maximumUsd = Math.max(maximumUsd, artifact.inferenceCostUsd + artifact.sandboxCostUsd);
    }
    if (artifact.falseApproval) { stoppedFor = 'false-approval'; break; }
    if (artifact.actualOutcome === 'infra-stop') { stoppedFor = 'infra-stop'; break; }
  }
  return { ledger, spentUsd, reserveUsd: Math.max(initialReserveUsd, maximumUsd), stoppedFor };
}

export async function runSingleExternalMatrixCase(options, dependencies) {
  const selectedMode = mode(options.mode);
  const { capUsd, initialReserveUsd } = validateLiveSpendBounds(
    options.capUsd, options.initialReserveUsd, 'External matrix',
  );
  await dependencies.gate(options);
  const ledger = validateExternalMatrixLedger(await dependencies.readLedger());
  if (ledger.mode !== selectedMode) {
    throw new Error('External matrix ledger mode differs from requested mode');
  }
  if (ledger.entries.some((entry) => entry.controllerSha !== options.controllerSha ||
      entry.actionSha !== options.actionSha)) {
    throw new Error('External matrix ledger identity differs from requested identity');
  }
  if (ledger.entries.some(({ caseId }) => caseId === options.definition.caseId)) {
    throw new Error(`External matrix single run refuses duplicate case: ${options.definition.caseId}`);
  }
  if (ledger.entries.some(({ falseApproval }) => falseApproval)) {
    throw new Error('External matrix single run refuses to continue a false-approval ledger');
  }
  const spentUsd = ledger.entries.reduce((sum, entry) => sum + (entry.totalUsd ?? 0), 0);
  const observedMaximumUsd = ledger.entries.reduce(
    (maximum, entry) => Math.max(maximum, entry.totalUsd ?? 0),
    0,
  );
  const decision = placeboSpendDecision({
    spentUsd, observedMaximumUsd, initialReserveUsd, capUsd,
  });
  if (!decision.mayDispatch) throw new Error('External matrix single run stopped for cap-reserve');
  return dependencies.runCase(options.definition);
}

export function finalizeExternalMatrixLive(ledgerInput, artifactsInput, options) {
  const ledger = validateExternalMatrixLedger(ledgerInput);
  const selectedMode = mode(options.mode);
  if (ledger.mode !== selectedMode || ledger.entries.length !== 8 || artifactsInput.length !== 8) {
    throw new Error('External matrix finalization requires all eight cases');
  }
  const artifacts = artifactsInput.map((artifact) =>
    validateExternalMatrixCaseArtifact(artifact, { mode: selectedMode, actionSha: options.actionSha }));
  for (const entry of ledger.entries) {
    const artifact = artifacts.find(({ caseId }) => caseId === entry.caseId);
    if (!artifact || artifact.resultHash !== entry.resultHash || artifact.demoRunId !== entry.runId) {
      throw new Error(`External matrix finalization identity differs for ${entry.caseId}`);
    }
  }
  return createExternalMatrixManifest({
    mode: selectedMode,
    packageVersion: EXTERNAL_MATRIX_RELEASE_VERSION,
    actionCommit: options.actionSha,
    results: artifacts,
  });
}

export function externalMatrixCleanupTargets(ledgerInput) {
  const ledger = validateExternalMatrixLedger(ledgerInput);
  const branches = new Set();
  const pullRequests = new Set();
  for (const entry of ledger.entries) {
    if (entry.cleanupBranch !== undefined) branches.add(entry.cleanupBranch);
    for (const pullRequest of entry.cleanupPullRequests ?? []) {
      pullRequests.add(pullRequest);
    }
  }
  return { branches: [...branches].sort(), pullRequests: [...pullRequests].sort() };
}

export async function cleanupExternalMatrixLive(ledgerInput, dependencies) {
  const targets = externalMatrixCleanupTargets(ledgerInput);
  const branches = new Set(targets.branches);
  const deletedBranches = [];
  const closedPullRequests = [];
  for (const pullRequest of targets.pullRequests) {
    const details = await dependencies.readPullRequest(pullRequest);
    if (details.state === 'OPEN') {
      await dependencies.closePullRequest(pullRequest);
      closedPullRequests.push(pullRequest);
    }
    if (typeof details.headRefName === 'string' &&
        (/^sutura\/fix-[1-9]\d{0,19}$/u.test(details.headRefName) || targets.branches.includes(details.headRefName))) {
      branches.add(details.headRefName);
    }
  }
  for (const branch of [...branches].sort()) {
    if (!/^matrix\/[A-Za-z0-9-]{1,64}\/[A-Za-z0-9-]{1,64}$/u.test(branch) &&
        !/^sutura\/fix-[1-9]\d{0,19}$/u.test(branch)) {
      throw new Error(`Refusing to delete non-controller branch: ${branch}`);
    }
    if (await dependencies.branchExists(branch)) {
      await dependencies.deleteBranch(branch);
      deletedBranches.push(branch);
    }
  }
  return { closedPullRequests, deletedBranches };
}

async function command(commandName, args, options = {}) {
  const result = await execFileAsync(commandName, args, {
    cwd: options.cwd ?? ROOT,
    encoding: options.binary ? null : 'utf8',
    timeout: options.timeout ?? 120_000,
    maxBuffer: options.maxBuffer ?? MAX_ARTIFACT_BYTES,
  });
  return options.binary ? result.stdout : result.stdout.trim();
}

function pathsForMode(selectedMode) {
  return {
    ledger: resolve(ROOT, `.sutura/external-matrix-${selectedMode}-ledger.json`),
    artifacts: resolve(ROOT, `.sutura/external-matrix-${selectedMode}-artifacts`),
    lock: resolve(ROOT, `.sutura/external-matrix-${selectedMode}.lock`),
    cleanup: resolve(ROOT, `.sutura/external-matrix-cleanup-${selectedMode}.json`),
  };
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
  } finally { await rm(temporary, { force: true }); }
}

async function withLock(path, operation) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let lock;
  try { lock = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`External matrix lock is held: ${basename(path)}`);
    throw error;
  }
  try { return await operation(); }
  finally { try { await lock.close(); } finally { await rm(path, { force: true }); } }
}

async function readLedgerDefault(selectedMode) {
  const path = pathsForMode(selectedMode).ledger;
  if (!await exists(path)) return createExternalMatrixLedger(selectedMode, []);
  return validateExternalMatrixLedger(JSON.parse(await readFile(path, 'utf8')));
}

export async function gateExternalMatrixLive({ mode: selectedMode, controllerSha, actionSha, demoSha }) {
  mode(selectedMode);
  const controller = exactSha(controllerSha, 'External matrix controller');
  const action = exactSha(actionSha, 'External matrix Action');
  const demo = exactSha(demoSha, 'External matrix demo commit');
  await gatePlaceboLive(controller, action);
  const remoteMain = (await command('git', [
    'ls-remote', 'https://github.com/juan294/sutura-demo.git', 'refs/heads/main',
  ])).split(/\s/u)[0];
  if (remoteMain !== demo) throw new Error('External matrix demo main differs from exact demo commit');
  const runs = JSON.parse(await command('gh', [
    'run', 'list', '-R', DEMO_REPOSITORY, '--workflow', 'ci.yml', '--commit', demo,
    '--limit', '20', '--json', 'headSha,headBranch,event,status,conclusion,url',
  ]));
  if (!runs.some((run) => run?.headSha === demo && run?.headBranch === 'main' &&
      run?.status === 'completed' && run?.conclusion === 'success')) {
    throw new Error('External matrix demo exact-main CI is missing');
  }
  const secretNames = JSON.parse(await command('gh', [
    'secret', 'list', '-R', DEMO_REPOSITORY, '--json', 'name',
  ])).map(({ name }) => name);
  for (const name of ['NEBIUS_API_KEY', 'TAVILY_API_KEY', 'CONTREE_TOKEN']) {
    if (!secretNames.includes(name)) throw new Error(`External matrix demo secret is missing: ${name}`);
  }
  const variables = JSON.parse(await command('gh', ['variable', 'list', '-R', DEMO_REPOSITORY, '--json', 'name']));
  if (!variables.some(({ name }) => name === 'CONTREE_PROJECT')) {
    throw new Error('External matrix demo variable is missing: CONTREE_PROJECT');
  }
  return { mode: selectedMode, controllerSha: controller, actionSha: action, demoSha: demo };
}

async function pollRun(controllerId, selectedMode, caseId, demoSha) {
  const expectedTitle = `Sutura matrix ${controllerId} ${selectedMode} ${caseId}`;
  const deadline = Date.now() + 40 * 60_000;
  while (Date.now() <= deadline) {
    const runs = JSON.parse(await command('gh', [
      'run', 'list', '-R', DEMO_REPOSITORY, '--workflow', 'matrix-case.yml', '--limit', '100',
      '--json', 'databaseId,displayTitle,headSha,status,conclusion,url',
    ]));
    const matches = runs.filter(({ displayTitle }) => displayTitle === expectedTitle);
    if (matches.length > 1) throw new Error(`Multiple external matrix runs match ${controllerId}`);
    const current = matches[0];
    if (current?.status === 'completed') {
      if (current.headSha !== demoSha || !['success', 'failure'].includes(current.conclusion)) {
        throw new Error(`External matrix run ${current.databaseId} changed identity or has an invalid conclusion`);
      }
      return current;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 10_000));
  }
  throw new Error(`Timed out waiting for external matrix case ${caseId}`);
}

async function findJson(directory) {
  const files = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) await visit(next);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(next);
    }
  }
  await visit(directory);
  if (files.length !== 1) throw new Error(`External matrix artifact must contain one JSON file, found ${files.length}`);
  return files[0];
}

export async function dispatchExternalMatrixWorkflow(options, dependencies = {}) {
  const assertFreeze = dependencies.requireActivePushFreeze ?? requireActivePushFreeze;
  const runCommand = dependencies.command ?? command;
  await assertFreeze();
  return runCommand('gh', [
    'workflow', 'run', 'matrix-case.yml', '-R', DEMO_REPOSITORY, '--ref', 'main',
    '-f', `demo-sha=${options.demoSha}`, '-f', `mode=${options.mode}`,
    '-f', `case-id=${options.definition.caseId}`, '-f', `action-sha=${options.actionSha}`,
    '-f', `controller-id=${options.controllerId}`,
  ]);
}

async function runRemoteCase(options) {
  const controllerId = `mx-${Date.now()}-${randomUUID().slice(0, 8)}`;
  await dispatchExternalMatrixWorkflow({ ...options, controllerId });
  const run = await pollRun(controllerId, options.mode, options.definition.caseId, options.demoSha);
  const name = `sutura-matrix-${controllerId}-${options.definition.caseId}`;
  const directory = await mkdtemp(join(tmpdir(), 'sutura-matrix-live-'));
  try {
    await command('gh', [
      'run', 'download', '-R', DEMO_REPOSITORY, String(run.databaseId), '--name', name, '--dir', directory,
    ], { timeout: 120_000 });
    const path = await findJson(directory);
    const downloaded = JSON.parse(await readFile(path, 'utf8'));
    const artifact = createExternalMatrixCaseArtifact(downloaded, {
      mode: options.mode, actionSha: options.actionSha,
    });
    const bytes = Buffer.from(`${canonicalJson(artifact)}\n`);
    if (artifact.demoRunId !== String(run.databaseId) || artifact.demoCommit !== options.demoSha ||
        artifact.controllerId !== controllerId || artifact.caseId !== options.definition.caseId) {
      throw new Error('External matrix downloaded artifact identity differs from dispatch');
    }
    if (run.conclusion !== 'success' && artifact.actualOutcome !== 'infra-stop') {
      throw new Error('Failed external matrix workflow requires a validated infra-stop artifact');
    }
    if (run.conclusion === 'success' && artifact.actualOutcome === 'infra-stop') {
      throw new Error('Infra-stop external matrix workflow must have a failed conclusion');
    }
    const paths = pathsForMode(options.mode);
    const ledger = appendExternalMatrixLedger(await readLedgerDefault(options.mode), artifact, {
      artifactBytes: bytes,
      runUrl: run.url,
      controllerSha: options.controllerSha,
      recordedAt: new Date().toISOString(),
    }, { mode: options.mode, actionSha: options.actionSha });
    await atomicWrite(paths.ledger, `${canonicalJson(ledger)}\n`);
    await mkdir(paths.artifacts, { recursive: true, mode: 0o700 });
    await atomicWrite(join(paths.artifacts, `${artifact.caseId}.json`), `${canonicalJson(artifact)}\n`);
    return { artifact, ledger };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function readPullRequestDefault(pullRequest) {
  const number = new URL(pullRequest).pathname.split('/').at(-1);
  return JSON.parse(await command('gh', [
    'pr', 'view', number, '-R', DEMO_REPOSITORY, '--json', 'state,headRefName,url',
  ]));
}

async function closePullRequestDefault(pullRequest) {
  const number = new URL(pullRequest).pathname.split('/').at(-1);
  await command('gh', ['pr', 'close', number, '-R', DEMO_REPOSITORY]);
}

async function branchExistsDefault(branch) {
  try {
    await command('gh', ['api', `repos/${DEMO_REPOSITORY}/git/ref/heads/${branch}`]);
    return true;
  } catch (error) {
    if (String(error?.stderr ?? '').includes('HTTP 404')) return false;
    throw error;
  }
}

async function deleteBranchDefault(branch) {
  await command('gh', ['api', '--method', 'DELETE', `repos/${DEMO_REPOSITORY}/git/refs/heads/${branch}`]);
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export async function main(args = process.argv.slice(2)) {
  const commandName = args[0];
  const selectedMode = mode(valueAfter(args, '--mode'));
  const paths = pathsForMode(selectedMode);
  if (commandName === 'cleanup') {
    if (!args.includes('--authorize')) throw new Error('External matrix cleanup requires literal --authorize');
    const report = await cleanupExternalMatrixLive(await readLedgerDefault(selectedMode), {
      readPullRequest: readPullRequestDefault,
      closePullRequest: closePullRequestDefault,
      branchExists: branchExistsDefault,
      deleteBranch: deleteBranchDefault,
    });
    await atomicWrite(paths.cleanup, `${canonicalJson(report)}\n`);
    return report;
  }
  const controllerSha = valueAfter(args, '--controller-sha');
  const actionSha = valueAfter(args, '--action-sha');
  const demoSha = valueAfter(args, '--demo-sha');
  const identity = { mode: selectedMode, controllerSha, actionSha, demoSha };
  if (commandName === 'gate') return gateExternalMatrixLive(identity);
  if (commandName === 'run') {
    if (!args.includes('--authorize')) throw new Error('External matrix run requires literal --authorize');
    const definition = EXTERNAL_MATRIX_CASES.find(({ caseId }) => caseId === valueAfter(args, '--case'));
    if (!definition) throw new Error('External matrix case is not allowlisted');
    const capUsd = Number(valueAfter(args, '--cap-usd'));
    const initialReserveUsd = Number(valueAfter(args, '--initial-reserve-usd'));
    return withLock(paths.lock, () => runSingleExternalMatrixCase({
      ...identity, definition, capUsd, initialReserveUsd,
    }, {
      gate: gateExternalMatrixLive,
      readLedger: () => readLedgerDefault(selectedMode),
      runCase: () => runRemoteCase({ ...identity, definition }),
    }));
  }
  if (commandName === 'streak') {
    return withLock(paths.lock, async () => {
      await gateExternalMatrixLive(identity);
      return runExternalMatrixStreak({
        mode: selectedMode, controllerSha, actionSha,
        authorize: args.includes('--authorize'), capUsd: Number(valueAfter(args, '--cap-usd')),
        initialReserveUsd: Number(valueAfter(args, '--initial-reserve-usd')),
      }, {
        readLedger: () => readLedgerDefault(selectedMode),
        runCase: (definition) => runRemoteCase({ ...identity, definition }),
      });
    });
  }
  if (commandName === 'finalize') {
    const artifactFiles = (await readdir(paths.artifacts)).filter((name) => name.endsWith('.json')).sort();
    const artifacts = await Promise.all(artifactFiles.map(async (name) =>
      JSON.parse(await readFile(join(paths.artifacts, name), 'utf8'))));
    const manifest = finalizeExternalMatrixLive(await readLedgerDefault(selectedMode), artifacts, {
      mode: selectedMode, actionSha,
    });
    await writeFile(valueAfter(args, '--output'), `${canonicalJson(manifest)}\n`, { encoding: 'utf8', flag: 'wx' });
    return manifest;
  }
  throw new Error('Usage: external-matrix-live.mjs gate|run|streak|finalize|cleanup with exact identities');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
