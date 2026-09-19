import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MAX_RUNTIME_EVIDENCE_ENTRIES,
  RuntimeDetectionError,
  detectRuntime,
  detectRuntimeAtPath,
  runtimeRootEvidencePaths,
  runtimeEvidencePaths,
} from './detect.js';

const DOGFOOD_16_RUNTIME = new URL(
  './__fixtures__/captured/33268037618/runtime-evidence.json',
  import.meta.url,
);

describe('detectRuntime', () => {
  it('selects Node and Python from bounded repository and command evidence', () => {
    expect(detectRuntime({ paths: ['package.json', 'pnpm-lock.yaml'], failingCommand: 'pnpm test' }).id)
      .toBe('node');
    expect(detectRuntime({ paths: ['pyproject.toml', 'uv.lock', 'src/widget.py'], failingCommand: 'pytest' }).id)
      .toBe('python');
  });

  it('fails closed on equal-confidence polyglot evidence with configuration guidance', () => {
    expect(() => detectRuntime({
      paths: ['package.json', 'pnpm-lock.yaml', 'pyproject.toml', 'uv.lock'],
      failingCommand: 'make test',
    })).toThrowError(RuntimeDetectionError);
    expect(() => detectRuntime({
      paths: ['package.json', 'pnpm-lock.yaml', 'pyproject.toml', 'uv.lock'],
      failingCommand: 'make test',
    })).toThrow(/\.sutura\.json.*runtime/iu);
  });

  it('uses an explicit allowlisted runtime only to resolve the polyglot choice', () => {
    const evidence = {
      paths: ['package.json', 'pnpm-lock.yaml', 'pyproject.toml', 'uv.lock'],
      failingCommand: 'make test',
    } as const;
    expect(detectRuntime({ ...evidence, configuredRuntime: 'node' }).id).toBe('node');
    expect(detectRuntime({ ...evidence, configuredRuntime: 'python' }).id).toBe('python');
  });

  it.each([
    'tests/test_widget.py:14: AssertionError',
    'File "/workspace/tests/test_widget.py", line 14, in test_widget',
    'file:///workspace/tests/test_widget.py:14: AssertionError',
    '/home/runner/work/widget/widget/tests/test_widget.py:14: AssertionError',
    '/__w/widget/widget/tests/test_widget.py:14: AssertionError',
  ])('uses Python source path from failed log as runtime evidence: %s', (failedLog) => {
    expect(detectRuntime({ paths: [], failingCommand: 'make test', failedLog }).id).toBe('python');
  });

  it('bounds visited directory entries even when the tree contains no files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sutura-runtime-many-dirs-'));
    try {
      await Promise.all(Array.from(
        { length: MAX_RUNTIME_EVIDENCE_ENTRIES + 1 },
        (_, index) => mkdir(join(root, `dir-${String(index).padStart(4, '0')}`)),
      ));
      await expect(runtimeEvidencePaths(root)).rejects.toMatchObject({
        code: 'runtime-evidence-limit',
        stage: 'runtime-detection',
        details: {
          visitedEntries: MAX_RUNTIME_EVIDENCE_ENTRIES + 1,
          maximumEntries: MAX_RUNTIME_EVIDENCE_ENTRIES,
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    'npm error Missing: @vitest/coverage-v8@4.1.11 from lock file',
    'npm error Invalid: lock file\'s vitest@4.1.10 does not satisfy vitest@4.1.11',
  ])('selects Node before a bounded scan for a Clarity lockfile failure: %s', async (failedLog) => {
    const root = await mkdtemp(join(tmpdir(), 'sutura-runtime-clarity-'));
    try {
      await writeFile(join(root, 'package.json'), '{"scripts":{"test":"vitest run"}}\n');
      await writeFile(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
      await Promise.all(Array.from(
        { length: MAX_RUNTIME_EVIDENCE_ENTRIES + 1 },
        (_, index) => writeFile(join(root, `source-${String(index).padStart(4, '0')}.ts`), 'export {};\n'),
      ));

      const observations: unknown[] = [];
      await expect(detectRuntimeAtPath(
        root, 'npm ci', undefined, failedLog,
        (observation) => observations.push(observation),
      ))
        .resolves.toMatchObject({ id: 'node' });
      expect(observations).toEqual([{
        runtime: 'node', evidenceSource: 'root',
        evidencePaths: ['package-lock.json', 'package.json'], visitedEntries: 2,
      }]);
      await expect(runtimeRootEvidencePaths(root)).resolves.toEqual([
        'package-lock.json',
        'package.json',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not follow a symlinked evidence directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sutura-runtime-symlink-'));
    const outside = await mkdtemp(join(tmpdir(), 'sutura-runtime-outside-'));
    try {
      await writeFile(join(root, 'package.json'), '{}\n');
      await writeFile(join(outside, 'hidden.py'), 'value = 1\n');
      await symlink(outside, join(root, 'python-source'));
      await expect(runtimeEvidencePaths(root)).resolves.toEqual(['package.json']);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('detects the runtime from the captured dogfood-16 checkout boundary', async () => {
    const captured = JSON.parse(await readFile(DOGFOOD_16_RUNTIME, 'utf8')) as {
      configuredRuntime: 'node';
      paths: string[];
    };
    const policy = JSON.parse(await readFile(
      new URL('./__fixtures__/captured/33268037618/.sutura.json', import.meta.url),
      'utf8',
    )) as { runtime: 'node' };
    expect(detectRuntime({
      configuredRuntime: policy.runtime,
      paths: captured.paths,
      failingCommand: 'pnpm --filter @sutura/core test',
    }).id).toBe('node');
    expect(detectRuntime({
      paths: captured.paths,
      failingCommand: 'pnpm --filter @sutura/core test',
    }).id).toBe('node');
  });

  it('fails closed when an evidence directory is replaced before it is read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sutura-runtime-replaced-'));
    try {
      await expect(runtimeEvidencePaths(root, {
        async lstat() {
          return { isSymbolicLink: () => true, isDirectory: () => false } as never;
        },
      })).rejects.toThrow(/changed during bounded detection/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed on a deterministic realpath escape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sutura-runtime-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'sutura-runtime-escape-'));
    let realpathCalls = 0;
    try {
      await expect(runtimeEvidencePaths(root, {
        async realpath(path) {
          realpathCalls += 1;
          return realpathCalls === 1 ? String(path) : outside;
        },
      })).rejects.toThrow(/escapes the repository/u);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
