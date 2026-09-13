import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { workflowActionReferences } from './evidence-contract.mjs';

export const RELEASE_VERSION = '0.2.1';
const SHA_PATTERN = /^[a-f0-9]{40}$/iu;
const EXACT_SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const execFileAsync = promisify(execFile);

function exactSha(value, label) {
  if (!SHA_PATTERN.test(value ?? '')) throw new Error(`${label} must be an exact 40-character commit`);
  return value.toLowerCase();
}

export function exactReleaseVersion(value) {
  if (typeof value !== 'string' || !EXACT_SEMVER_PATTERN.test(value)) {
    throw new Error('Public package release must be an exact semver');
  }
  return value;
}

export function packedFilename(output) {
  const parsed = JSON.parse(output);
  const records = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && typeof parsed.filename === 'string'
      ? [parsed]
      : parsed && typeof parsed === 'object'
        ? Object.values(parsed)
        : [];
  const record = records.length === 1 ? records[0] : undefined;
  if (!record || typeof record.filename !== 'string' || record.filename.length === 0) {
    throw new Error('npm pack did not return one filename');
  }
  return record.filename;
}

async function execute(command, args, options = {}) {
  const { stdout } = await execFileAsync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 1024 * 1024,
    timeout: 10 * 60_000,
  });
  return stdout;
}

async function packDefault(source, destination) {
  const output = await execute('npm', [
    'pack', source, '--json', '--pack-destination', destination,
  ]);
  return join(destination, packedFilename(output));
}

async function installDefault(tarball, consumer) {
  await execute('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', tarball,
  ], { cwd: consumer });
}

async function invokeDefault(binary, args, consumer, environment) {
  return execute(binary, args, { cwd: consumer, env: environment });
}

async function publicCommitDefault(version, cwd) {
  const tag = `v${version}`;
  const output = await execute('git', [
    'ls-remote', 'https://github.com/juan294/sutura.git',
    `refs/tags/${tag}`, `refs/tags/${tag}^{}`,
  ], { cwd });
  const lines = output.trim().split(/\r?\n/u).filter(Boolean);
  const direct = [];
  const peeled = [];
  for (const line of lines) {
    const match = /^([^\t]+)\t([^\t]+)$/u.exec(line);
    if (!match) throw new Error(`Public Action tag ${tag} returned malformed data`);
    const [, commit = '', ref = ''] = match;
    if (ref === `refs/tags/${tag}`) direct.push(exactSha(commit, `Public Action tag ${tag}`));
    else if (ref === `refs/tags/${tag}^{}`) peeled.push(exactSha(commit, `Public Action tag ${tag}`));
    else throw new Error(`Public Action tag ${tag} returned an unexpected ref`);
  }
  if (direct.length !== 1 || peeled.length > 1) {
    throw new Error(`Public Action tag ${tag} did not resolve uniquely`);
  }
  return peeled[0] ?? direct[0];
}

export const resolvePublicActionCommit = publicCommitDefault;

async function createDoctorShim(directory) {
  const path = join(directory, 'gh');
  await writeFile(path, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'secret' && args[1] === 'list') process.stdout.write('NEBIUS_API_KEY\\nCONTREE_TOKEN\\n');
else if (args[0] === 'variable' && args[1] === 'list') process.stdout.write('CONTREE_PROJECT\\n');
else { process.stderr.write('unsupported read-only gh smoke command\\n'); process.exitCode = 2; }
`);
  await chmod(path, 0o755);
}

function cleanEnvironment(shimDirectory) {
  return {
    PATH: `${shimDirectory}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    CI: 'true',
    NO_COLOR: '1',
  };
}

function validateGeneratedWorkflow(workflow, actionCommit) {
  const activeReferences = workflowActionReferences(workflow, 'Generated Sutura workflow');
  if (activeReferences.length !== 1 || activeReferences[0] !== `juan294/sutura@${actionCommit}`) {
    throw new Error('Generated workflow must contain exactly one active Sutura step at the release commit');
  }
}

function validateDoctorOutput(doctor, actionCommit) {
  const required = [
    'Sutura workflow exists.',
    `Workflow uses juan294/sutura@${actionCommit}.`,
    'Workflow grants checks: write.',
    'Workflow wires github-token.',
    'Workflow wires run-id.',
    'Workflow wires runtime.',
    'Workflow wires nebius-api-key.',
    'Workflow wires contree-token.',
    'Workflow wires contree-project.',
    'GitHub secret NEBIUS_API_KEY is configured.',
    'GitHub secret CONTREE_TOKEN is configured.',
    'GitHub variable CONTREE_PROJECT is configured.',
  ];
  const lines = new Set(doctor.split(/\r?\n/u));
  if (doctor.split(/\r?\n/u).some((line) => line.startsWith('[FAIL]')) ||
      required.some((message) => !lines.has(`[PASS] ${message}`))) {
    throw new Error('Installed CLI doctor did not report every required PASS check');
  }
}

async function installedContentHash(packageRoot) {
  const hash = createHash('sha256');
  let totalBytes = 0;
  async function visit(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Installed CLI contains symbolic link: ${relative}`);
      if (entry.isDirectory()) await visit(path, relative);
      else if (entry.isFile()) {
        const metadata = await stat(path);
        if (metadata.size > 20 * 1024 * 1024 - totalBytes) {
          throw new Error('Installed CLI exceeds 20971520 bytes');
        }
        const bytes = await readFile(path);
        totalBytes += bytes.byteLength;
        hash.update(relative).update('\0').update(bytes).update('\0');
      } else throw new Error(`Installed CLI contains unsupported entry: ${relative}`);
    }
  }
  await visit(packageRoot);
  return hash.digest('hex');
}

export async function verifyInstall(options) {
  if (options.mode !== 'candidate' && options.mode !== 'public') {
    throw new Error('Install mode must be candidate or public');
  }
  const dependencies = options.dependencies ?? {};
  const pack = dependencies.pack ?? packDefault;
  const install = dependencies.install ?? installDefault;
  const invoke = dependencies.invoke ?? invokeDefault;
  const resolvePublicCommit = dependencies.resolvePublicCommit ?? publicCommitDefault;
  const now = options.now ?? (() => performance.now());
  const releaseVersion = options.mode === 'public'
    ? exactReleaseVersion(options.releaseVersion ?? RELEASE_VERSION)
    : RELEASE_VERSION;
  const actionCommit = options.mode === 'candidate'
    ? exactSha(options.actionCommit, 'Candidate Action SHA')
    : exactSha(await resolvePublicCommit(releaseVersion, options.root), 'Public Action SHA');
  const temporary = await mkdtemp(join(tmpdir(), `sutura-${options.mode}-install-`));
  try {
    const packageDirectory = join(temporary, 'package');
    const consumer = join(temporary, 'consumer');
    const shimDirectory = join(temporary, 'bin');
    await mkdir(packageDirectory);
    await mkdir(join(consumer, '.github', 'workflows'), { recursive: true });
    await mkdir(shimDirectory);
    await writeFile(join(consumer, 'package.json'), '{"name":"sutura-install-smoke","private":true}\n');
    await writeFile(join(consumer, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\n');
    await createDoctorShim(shimDirectory);

    const source = options.mode === 'candidate'
      ? join(options.root, 'packages', 'cli')
      : `sutura@${releaseVersion}`;
    const tarball = await pack(source, packageDirectory);
    const packageIntegrity = createHash('sha256').update(await readFile(tarball)).digest('hex');
    await install(tarball, consumer);
    const installedRoot = join(consumer, 'node_modules', 'sutura');
    const installed = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'));
    if (installed.name !== 'sutura' || installed.version !== releaseVersion) {
      throw new Error(`Installed package is not sutura@${releaseVersion}`);
    }
    if (installed.dependencies && Object.keys(installed.dependencies).length > 0) {
      throw new Error('Installed CLI contains runtime dependencies');
    }
    const installedLicense = await readFile(join(installedRoot, 'LICENSE'));
    const repositoryLicense = await readFile(join(options.root, 'LICENSE'));
    if (!installedLicense.equals(repositoryLicense)) {
      throw new Error('Installed CLI license differs from the repository license');
    }
    const packageContentHash = await installedContentHash(installedRoot);
    if (options.expectedPackageContentHash !== undefined &&
        packageContentHash !== options.expectedPackageContentHash) {
      throw new Error('Public package content differs from trusted candidate evidence');
    }

    const binary = join(consumer, 'node_modules', '.bin', 'sutura');
    const environment = cleanEnvironment(shimDirectory);
    const actionArgs = options.mode === 'candidate' ? ['--action-sha', actionCommit] : [];
    const startedAt = now();
    await invoke(binary, [
      'init', '--workflow', 'CI', '--repo', 'sutura/install-smoke', ...actionArgs,
    ], consumer, environment);
    const setupDurationMs = Math.max(0, now() - startedAt);
    const workflow = await readFile(join(consumer, '.github', 'workflows', 'sutura.yml'), 'utf8');
    validateGeneratedWorkflow(workflow, actionCommit);
    const doctorStartedAt = now();
    const doctor = await invoke(binary, [
      'doctor', '--repo', 'sutura/install-smoke', ...actionArgs,
    ], consumer, environment);
    const doctorDurationMs = Math.max(0, now() - doctorStartedAt);
    validateDoctorOutput(doctor, actionCommit);
    if ((await invoke(binary, ['--version'], consumer, environment)).trim() !== releaseVersion) {
      throw new Error('Installed CLI returned the wrong version');
    }

    return {
      schemaVersion: 'sutura-install-evidence-v1',
      mode: options.mode,
      repository: 'sutura/install-smoke',
      packageVersion: releaseVersion,
      packageSource: source,
      packageIntegrity,
      packageContentHash,
      actionCommit,
      setupDurationMs,
      doctorDurationMs,
      doctorOutcome: 'passed',
      setupFailures: [],
      unclearInstructions: [],
      manualInterventions: [],
      outcome: 'passed',
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
