import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import type { DependencyPreparation, RuntimeAdapter, RuntimeEvidence } from './types.js';

export interface PythonDependencyFileSystem {
  lstat(path: string): Promise<Stats>;
  open(path: string, flags: number): Promise<FileHandle>;
  realpath(path: string): Promise<string>;
}

const PYTHON_DEPENDENCY_FILE_SYSTEM: PythonDependencyFileSystem = {
  lstat: async (path) => lstat(path),
  open: async (path, flags) => open(path, flags),
  realpath: async (path) => realpath(path),
};

// ConTree's beta importer rejects OCI digest references. Use the versioned
// Docker Hub tag at that boundary, then fail closed in the live canary unless
// it still resolves to these exact index and Linux AMD64 manifest digests.
export const PYTHON_IMAGE_REF = 'astral/uv:0.9.30-python3.13-bookworm';
export const PYTHON_IMAGE_INDEX_DIGEST = 'sha256:47965cdc9d53a515f68f78241161c901e70051ce428f12e791bd7fe19f6a631a';
export const PYTHON_IMAGE_LINUX_AMD64_DIGEST = 'sha256:35b0aa516fbcf6f18624919cfc38fa02ab3458e0ffcd3c03e932051b37f315db';
export const PYTHON_REQUIRED_TOOLS = Object.freeze([
  'Python 3.13.11',
  'uv 0.9.30',
  'git version 2.39.5',
  'tar (GNU tar) 1.34',
]);
const MAX_DEPENDENCY_FILE_BYTES = 1024 * 1024;
const SHA256 = '[a-fA-F0-9]{64}';

export class PythonDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PythonDependencyError';
  }
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

async function optionalBoundedFile(
  root: string,
  name: string,
  fileSystem: PythonDependencyFileSystem,
): Promise<string | null> {
  const requested = resolve(root, name);
  let metadata;
  try {
    metadata = await fileSystem.lstat(requested);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new PythonDependencyError(`Could not inspect Python dependency input: ${name}`);
  }
  if (metadata.isSymbolicLink()) throw new PythonDependencyError(`Python dependency input must not be a symbolic link: ${name}`);
  if (!metadata.isFile() || metadata.size > MAX_DEPENDENCY_FILE_BYTES) {
    throw new PythonDependencyError(`Python dependency input must be a bounded regular file: ${name}`);
  }
  const canonical = await fileSystem.realpath(requested);
  if (!inside(root, canonical)) throw new PythonDependencyError(`Python dependency input escapes the repository: ${name}`);
  const handle = await fileSystem.open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.size !== metadata.size || current.size > MAX_DEPENDENCY_FILE_BYTES) {
      throw new PythonDependencyError(`Python dependency input changed during validation: ${name}`);
    }
    const bytes = Buffer.alloc(current.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (
      bytesRead !== current.size ||
      bytesRead > MAX_DEPENDENCY_FILE_BYTES ||
      bytes.subarray(0, bytesRead).includes(0)
    ) {
      throw new PythonDependencyError(`Python dependency input is not bounded UTF-8 text: ${name}`);
    }
    return bytes.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function rejectUnsafePyproject(content: string): void {
  if (/\[(?:tool\.(?:uv|poetry)\.workspace|tool\.uv\.sources)\]/iu.test(content)) {
    throw new PythonDependencyError('Python workspaces and local dependency sources are unsupported');
  }
}

function rejectUnsafeUvLock(content: string): void {
  if (
    /\b(?:editable|path|git)\s*=/iu.test(content) ||
    /source\s*=\s*\{[^}\n]*(?:editable|path|git|url)\s*=/iu.test(content) ||
    /\b(?:file|git\+[^\s"']+):/iu.test(content)
  ) {
    throw new PythonDependencyError('uv.lock contains a local, VCS, URL, editable, or source-build dependency');
  }
}

function validateRequirements(content: string): void {
  const logical = content.replace(/\\\r?\n/gu, ' ');
  for (const raw of logical.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^(?:-e|--editable|-r|--requirement|-c|--constraint)\b/iu.test(line)) {
      throw new PythonDependencyError('Editable installs and repository requirement includes are unsupported');
    }
    if (/\b(?:git\+|hg\+|svn\+|bzr\+|file:|\.\.?\/)|\s@\s/iu.test(line)) {
      throw new PythonDependencyError('Local, VCS, and direct URL requirements are unsupported');
    }
    if (/--(?:no-binary|config-settings|global-option|install-option)\b/iu.test(line)) {
      throw new PythonDependencyError('Source-build and PEP 517 options are unsupported');
    }
    if (!/^[A-Za-z0-9_.-]+(?:\[[A-Za-z0-9_.,-]+\])?==[^\s;]+(?:\s*;[^#]+)?\s+(?:.*\s)?--hash=sha256:[a-fA-F0-9]{64}(?:\s|$)/u.test(line) ||
      !new RegExp(`--hash=sha256:${SHA256}(?:\\s|$)`, 'u').test(line)) {
      throw new PythonDependencyError('Requirements must use exact versions and SHA-256 hashes');
    }
  }
}

export async function validatePythonDependencyInputs(
  caseDir: string,
  overrides: Partial<PythonDependencyFileSystem> = {},
): Promise<DependencyPreparation> {
  const fileSystem = { ...PYTHON_DEPENDENCY_FILE_SYSTEM, ...overrides };
  const root = await fileSystem.realpath(caseDir);
  const [pyproject, uvLock, requirements, poetryLock] = await Promise.all([
    optionalBoundedFile(root, 'pyproject.toml', fileSystem),
    optionalBoundedFile(root, 'uv.lock', fileSystem),
    optionalBoundedFile(root, 'requirements.txt', fileSystem),
    optionalBoundedFile(root, 'poetry.lock', fileSystem),
  ]);
  if (pyproject !== null) rejectUnsafePyproject(pyproject);
  if (poetryLock !== null) throw new PythonDependencyError('poetry.lock preparation is unsupported; use uv.lock');
  if (uvLock !== null) {
    if (pyproject === null) throw new PythonDependencyError('uv.lock requires pyproject.toml');
    rejectUnsafeUvLock(uvLock);
    return {
      paths: ['pyproject.toml', 'uv.lock'],
      command: 'uv sync --frozen --no-install-project --no-build',
    };
  }
  if (requirements !== null) {
    validateRequirements(requirements);
    return {
      paths: ['requirements.txt'],
      command: 'python -m pip install --require-hashes --only-binary=:all: --requirement requirements.txt',
    };
  }
  if (pyproject !== null) throw new PythonDependencyError('Python projects require uv.lock or hash-locked requirements.txt');
  throw new PythonDependencyError('Python dependency lock input is missing');
}

function detectPython(evidence: RuntimeEvidence): number {
  const paths = new Set(evidence.paths.map((path) => path.replace(/^\.\//u, '')));
  let score = 0;
  if (paths.has('pyproject.toml')) score += 2;
  if (['uv.lock', 'poetry.lock', 'requirements.txt', 'requirements-dev.txt']
    .some((path) => paths.has(path))) score += 2;
  if (paths.has('pytest.ini') || paths.has('ruff.toml')) score += 1;
  if (evidence.paths.some((path) => /\.pyi?$/u.test(path))) score += 1;
  if (/\b(?:pytest|ruff|mypy|python\s+-m)\b/u.test(evidence.failingCommand)) score += 2;
  const failedLog = (evidence.failedLog ?? '')
    .replaceAll('file:///workspace/', '')
    .replaceAll('/workspace/', '')
    .replace(
      /(?:file:\/\/)?\/(?:home\/runner\/work|__w)\/([A-Za-z0-9_.-]+)\/\1\//gmu,
      '',
    );
  if (/(?:^|[\s("'`])(?:[A-Za-z0-9_@.-]+\/)*[A-Za-z0-9_@.-]+\.pyi?(?::\d+)?(?![A-Za-z0-9_.-])/mu.test(failedLog)) score += 2;
  return score;
}

export function normalizePythonCommand(command: string): string {
  const trimmed = command.trim();
  if (
    /^(?:pytest|ruff|mypy)(?=$|\s)/u.test(trimmed) ||
    /^python(?:3(?:\.\d+)?)?\s+(?:-B\s+)?-m\s+(?:pytest|ruff|mypy|unittest)(?=$|\s)/u.test(trimmed)
  ) {
    return `uv run --offline --no-sync ${trimmed}`;
  }
  return command;
}

export const PYTHON_RUNTIME: RuntimeAdapter = Object.freeze({
  id: 'python',
  imageRef: PYTHON_IMAGE_REF,
  requiredTools: PYTHON_REQUIRED_TOOLS,
  detect: detectPython,
  dependencyInputs: validatePythonDependencyInputs,
  preparationCommand: 'uv sync --frozen --no-install-project --no-build',
  normalizeCommand: normalizePythonCommand,
  sourceExtensions: Object.freeze(['.py', '.pyi', '.toml', '.ini', '.txt']),
  policyRules: Object.freeze(['locked-binary-dependencies', 'no-editable-local-vcs', 'no-source-builds', 'no-build-hooks']),
});
