import { lstat, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AllowlistedExecutor, prepareSandbox } from '../heal.js';
import { InMemoryExecutor } from '../executor/memory.js';

import {
  PYTHON_RUNTIME,
  PythonDependencyError,
  validatePythonDependencyInputs,
} from './python.js';

const roots: string[] = [];

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sutura-python-runtime-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('PYTHON_RUNTIME', () => {
  it('prepares before overlay with network, then initializes source without network', async () => {
    const root = await fixture({
      'pyproject.toml': '[project]\nname="safe"\nversion="1.0.0"\n',
      'uv.lock': 'version=1\n',
      'src/safe.py': 'value = 1\n',
    });
    const delegate = new InMemoryExecutor(() => ({
      exitCode: 0, stdout: '', stderr: '', truncated: false, metrics: {},
    }));
    const result = await prepareSandbox(
      new AllowlistedExecutor(delegate), root, 'python-base', 'pytest', undefined, PYTHON_RUNTIME,
    );

    expect(result.ok).toBe(true);
    expect(delegate.calls.map(({ kind }) => kind)).toEqual(['snapshot', 'run', 'snapshot', 'run']);
    expect(delegate.calls[0]).toMatchObject({
      kind: 'snapshot',
      options: {
        profile: 'dependency-inputs',
        mode: 'replace',
        includePaths: ['pyproject.toml', 'uv.lock'],
      },
    });
    const runs = delegate.calls.filter((call) => call.kind === 'run');
    expect(runs[0]).toMatchObject({
      cmd: expect.stringContaining('uv sync --frozen --no-install-project --no-build'),
      opts: { network: 'enabled' },
    });
    expect(runs[1]).toMatchObject({
      cmd: expect.stringContaining('git init --quiet'),
      opts: { network: 'disabled' },
    });
    expect(runs[1]?.kind === 'run' ? runs[1].cmd : '').not.toContain('pnpm rebuild');
  });

  it('rejects unsafe inputs before any snapshot or networked run', async () => {
    const root = await fixture({ 'pyproject.toml': '[project]\nname="unsafe"\n' });
    const delegate = new InMemoryExecutor(() => ({
      exitCode: 0, stdout: '', stderr: '', truncated: false, metrics: {},
    }));
    const result = await prepareSandbox(
      new AllowlistedExecutor(delegate), root, 'python-base', 'pytest', undefined, PYTHON_RUNTIME,
    );
    expect(result).toMatchObject({ ok: false, result: { exitCode: 69 } });
    expect(delegate.calls).toEqual([]);
  });

  it('pins the verified exact-digest image and required tool versions', () => {
    expect(PYTHON_RUNTIME.imageRef).toBe('astral/uv:0.9.30-python3.13-bookworm');
    expect(PYTHON_RUNTIME.requiredTools).toEqual([
      'Python 3.13.11', 'uv 0.9.30', 'git version 2.39.5', 'tar (GNU tar) 1.34',
    ]);
  });

  it.each([
    ['python -m pytest -q', 'uv run --offline --no-sync python -m pytest -q'],
    ['python3 -m ruff check .', 'uv run --offline --no-sync python3 -m ruff check .'],
    ['python3.13 -m mypy src', 'uv run --offline --no-sync python3.13 -m mypy src'],
    ['python -m unittest', 'uv run --offline --no-sync python -m unittest'],
    [
      "python3 -B -m unittest discover -s tests -p 'test_*.py'",
      "uv run --offline --no-sync python3 -B -m unittest discover -s tests -p 'test_*.py'",
    ],
  ])('normalizes module invocation %s through the offline prepared environment', (command, expected) => {
    expect(PYTHON_RUNTIME.normalizeCommand(command)).toBe(expected);
  });

  it('accepts uv.lock without exposing source files to networked preparation', async () => {
    const root = await fixture({
      'pyproject.toml': '[project]\nname = "safe"\nversion = "1.0.0"\n',
      'uv.lock': 'version = 1\nrevision = 3\nrequires-python = ">=3.13"\n',
      'src/safe.py': 'raise RuntimeError("must not be snapshotted")\n',
    });
    await expect(validatePythonDependencyInputs(root)).resolves.toMatchObject({
      command: expect.stringContaining('uv sync --frozen --no-install-project --no-build'),
      paths: ['pyproject.toml', 'uv.lock'],
    });
  });

  it('accepts locked registry wheel metadata while --no-build enforces binary-only preparation', async () => {
    const root = await fixture({
      'pyproject.toml': '[project]\nname = "safe"\nversion = "1.0.0"\ndependencies = ["attrs==25.3.0"]\n',
      'uv.lock': [
        'version = 1',
        'revision = 3',
        'requires-python = ">=3.13"',
        '[[package]]',
        'name = "attrs"',
        'version = "25.3.0"',
        'source = { registry = "https://pypi.org/simple" }',
        'sdist = { url = "https://files.pythonhosted.org/attrs.tar.gz", hash = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" }',
        'wheels = [{ url = "https://files.pythonhosted.org/attrs-py3-none-any.whl", hash = "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" }]',
        '',
      ].join('\n'),
    });

    await expect(validatePythonDependencyInputs(root)).resolves.toMatchObject({
      command: 'uv sync --frozen --no-install-project --no-build',
      paths: ['pyproject.toml', 'uv.lock'],
    });
  });

  it('accepts only exact hash-locked binary requirements', async () => {
    const root = await fixture({
      'requirements.txt': 'attrs==25.3.0 --hash=sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n',
    });
    await expect(validatePythonDependencyInputs(root)).resolves.toMatchObject({
      command: expect.stringContaining('--require-hashes --only-binary=:all:'),
      paths: ['requirements.txt'],
    });
  });

  it.each([
    ['missing lock', { 'pyproject.toml': '[project]\nname="unsafe"\n' }],
    ['editable', { 'requirements.txt': '-e .\n' }],
    ['local path', { 'requirements.txt': 'safe @ file:///tmp/safe.whl --hash=sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n' }],
    ['VCS reference', { 'requirements.txt': 'safe @ git+https://example.invalid/safe.git@abc\n' }],
    ['include', { 'requirements.txt': '-r requirements-dev.txt\n', 'requirements-dev.txt': 'safe==1.0 --hash=sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n' }],
    ['workspace', { 'pyproject.toml': '[tool.uv.workspace]\nmembers=["packages/*"]\n', 'uv.lock': 'version=1\n' }],
    ['source build', { 'requirements.txt': 'safe==1.0 --no-binary=safe --hash=sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n' }],
    ['build hook', { 'pyproject.toml': '[build-system]\nrequires=["setuptools"]\nbuild-backend="setuptools.build_meta"\n', 'uv.lock': 'version=1\n[[package]]\nname="safe"\nsource={ path="." }\n' }],
  ])('rejects %s dependency input before preparation', async (_name, files) => {
    const root = await fixture(files);
    await expect(validatePythonDependencyInputs(root)).rejects.toBeInstanceOf(PythonDependencyError);
  });

  it('rejects symlinked dependency inputs', async () => {
    const root = await fixture({ 'real.lock': 'version=1\n', 'pyproject.toml': '[project]\nname="safe"\n' });
    await symlink('real.lock', join(root, 'uv.lock'));
    await expect(validatePythonDependencyInputs(root)).rejects.toThrow(/symbolic link/iu);
  });

  it('rejects a dependency input replaced between metadata validation and read', async () => {
    const root = await fixture({
      'pyproject.toml': '[project]\nname="safe"\n',
      'uv.lock': 'version=1\n',
    });
    let replaced = false;
    await expect(validatePythonDependencyInputs(root, {
      async lstat(path) {
        const metadata = await lstat(path);
        if (!replaced && String(path).endsWith('pyproject.toml')) {
          replaced = true;
          await writeFile(path, '[project]\nname="replaced-with-a-longer-name"\n');
        }
        return metadata;
      },
    })).rejects.toThrow(/changed during validation/u);
  });

  it('rejects UTF-16 dependency input', async () => {
    const root = await fixture({});
    await writeFile(join(root, 'requirements.txt'), Buffer.from([0xff, 0xfe, 0x61, 0x00]));
    await expect(validatePythonDependencyInputs(root)).rejects.toThrow(/not bounded UTF-8 text/u);
  });

  it('rejects a Python repository without a dependency lock input', async () => {
    const root = await fixture({});
    await expect(validatePythonDependencyInputs(root)).rejects.toThrow(/lock input is missing/u);
  });
});
