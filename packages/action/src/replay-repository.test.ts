import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseReplayBundle, ReplayRecorder, type RepositoryPort } from '@sutura/core';

import { recordingRepositoryPort } from './replay-repository.js';

const CONFIG = {
  triageN: 1, raceK: 1,
  models: { nano: 'nano', super: 'super', ultra: 'ultra' },
  routingProfileId: 'test', maxOps: 1,
} as const;

describe('recordingRepositoryPort', () => {
  it('records all repository calls in order and returns exact results', async () => {
    const checkoutDir = await mkdtemp(join(tmpdir(), 'sutura-replay-repository-'));
    await mkdir(join(checkoutDir, 'src'));
    await writeFile(join(checkoutDir, 'package.json'), '{"type":"module"}');
    await writeFile(join(checkoutDir, 'src', 'value.ts'), 'export const value = 1;');
    const port = {
      readPolicyAtSha: vi.fn(async () => '{"runtime":"node"}'),
      checkoutHead: vi.fn(async () => checkoutDir),
      readSourceExcerpts: vi.fn(async () => [{
        path: 'src/value.ts', startLine: 1, content: 'value', truncated: false,
      }]),
      publishFix: vi.fn(async () => undefined),
    } satisfies RepositoryPort;
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const wrapped = recordingRepositoryPort(port, recorder);

    await expect(wrapped.readPolicyAtSha('acme/widget', 'a'.repeat(40)))
      .resolves.toBe('{"runtime":"node"}');
    await expect(wrapped.checkoutHead('acme/widget', 'a'.repeat(40)))
      .resolves.toBe(checkoutDir);
    await expect(wrapped.readSourceExcerpts(checkoutDir, [], {
      maxFiles: 1, maxLinesPerFile: 1, maxCharactersPerFile: 10, maxBytesPerFile: 10,
    })).resolves.toEqual([{
      path: 'src/value.ts', startLine: 1, content: 'value', truncated: false,
    }]);
    await expect(wrapped.publishFix({
      branch: 'sutura/fix-77001', checkoutDir, diff: '',
      headSha: 'a'.repeat(40), message: 'fix',
    })).resolves.toBeUndefined();

    const calls = recorder.finish('fixed').repository;
    expect(calls.map(({ method }) => method)).toEqual([
      'readPolicyAtSha', 'checkoutHead', 'readSourceExcerpts', 'publishFix',
    ]);
    expect(calls[1]?.result).toEqual({
      checkoutId: 'checkout-1',
      snapshot: {
        runtimeEvidencePaths: ['package.json'],
        files: [{ path: 'package.json', content: '{"type":"module"}' }],
      },
    });
    expect(calls[2]?.args[0]).toBe('checkout-1');
    expect(calls[3]?.args[0]).toMatchObject({ checkoutDir: 'checkout-1' });
    await rm(checkoutDir, { recursive: true, force: true });
  });

  it('returns the checkout but marks an unsafe snapshot incomplete', async () => {
    const checkoutDir = await mkdtemp(join(tmpdir(), 'sutura-replay-repository-'));
    const outside = join(tmpdir(), `sutura-replay-outside-${String(process.pid)}.json`);
    await writeFile(outside, '{}');
    await symlink(outside, join(checkoutDir, 'package.json'));
    const port = {
      checkoutHead: vi.fn(async () => checkoutDir),
    } as unknown as RepositoryPort;
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);

    await expect(recordingRepositoryPort(port, recorder).checkoutHead(
      'acme/widget', 'a'.repeat(40),
    )).resolves.toBe(checkoutDir);

    const bundle = recorder.finish('infra-stop');
    expect(bundle.repository[0]?.result).toMatchObject({
      checkoutId: 'checkout-1',
      snapshot: { runtimeEvidencePaths: [], files: [] },
      captureError: expect.stringContaining('must not be a symlink'),
    });
    expect(bundle.completeness).toMatchObject({
      complete: false,
      overflowedBoundaries: ['repository'],
    });
    expect(() => parseReplayBundle(bundle)).not.toThrow();
    await rm(checkoutDir, { recursive: true, force: true });
    await rm(outside, { force: true });
  });

  it('does not enumerate runtime evidence when repository policy configures it', async () => {
    const checkoutDir = await mkdtemp(join(tmpdir(), 'sutura-replay-repository-'));
    try {
      await writeFile(join(checkoutDir, '.sutura.json'), '{"version":1,"runtime":"node"}\n');
      await Promise.all(Array.from({ length: 501 }, (_, index) =>
        writeFile(join(checkoutDir, `file-${index}.ts`), 'export {};\n'),
      ));
      const port = {
        checkoutHead: vi.fn(async () => checkoutDir),
      } as unknown as RepositoryPort;
      const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);

      await recordingRepositoryPort(port, recorder).checkoutHead(
        'acme/widget', 'a'.repeat(40),
      );

      expect(recorder.finish('gave-up').repository[0]?.result).toMatchObject({
        checkoutId: 'checkout-1',
        snapshot: {
          runtimeEvidencePaths: [],
          files: [{ path: '.sutura.json', content: '{"version":1,"runtime":"node"}\n' }],
        },
      });
    } finally {
      await rm(checkoutDir, { recursive: true, force: true });
    }
  });

  it('captures shared root runtime evidence without scanning a large checkout', async () => {
    const checkoutDir = await mkdtemp(join(tmpdir(), 'sutura-replay-clarity-'));
    try {
      await writeFile(join(checkoutDir, 'package.json'), '{}\n');
      await writeFile(join(checkoutDir, 'package-lock.json'), '{"lockfileVersion":3}\n');
      await Promise.all(Array.from({ length: 501 }, (_, index) =>
        writeFile(join(checkoutDir, `source-${index}.ts`), 'export {};\n'),
      ));
      const port = {
        checkoutHead: vi.fn(async () => checkoutDir),
      } as unknown as RepositoryPort;
      const recorder = new ReplayRecorder('77001', 'acme/clarity', 'a'.repeat(40), CONFIG);

      await recordingRepositoryPort(port, recorder).checkoutHead(
        'acme/clarity', 'a'.repeat(40),
      );

      expect(recorder.finish('infra-stop').repository[0]?.result).toMatchObject({
        checkoutId: 'checkout-1',
        snapshot: {
          runtimeEvidencePaths: ['package-lock.json', 'package.json'],
          files: [
            { path: 'package.json', content: '{}\n' },
            { path: 'package-lock.json', content: '{"lockfileVersion":3}\n' },
          ],
        },
      });
    } finally {
      await rm(checkoutDir, { recursive: true, force: true });
    }
  });

  it('preserves bounded nested evidence for a rootless runtime fallback', async () => {
    const checkoutDir = await mkdtemp(join(tmpdir(), 'sutura-replay-nested-runtime-'));
    try {
      await mkdir(join(checkoutDir, 'src'));
      await writeFile(join(checkoutDir, 'src', 'widget.py'), 'value = 1\n');
      const port = {
        checkoutHead: vi.fn(async () => checkoutDir),
      } as unknown as RepositoryPort;
      const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);

      await recordingRepositoryPort(port, recorder).checkoutHead(
        'acme/widget', 'a'.repeat(40),
      );

      expect(recorder.finish('gave-up').repository[0]?.result).toMatchObject({
        snapshot: { runtimeEvidencePaths: ['src/widget.py'] },
      });
    } finally {
      await rm(checkoutDir, { recursive: true, force: true });
    }
  });

  it('does not treat a source excerpt truncated flag as capture loss', async () => {
    const port = {
      readSourceExcerpts: vi.fn(async () => [{
        path: 'src/value.ts', startLine: 1, content: 'value', truncated: true,
      }]),
    } as unknown as RepositoryPort;
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);

    await recordingRepositoryPort(port, recorder).readSourceExcerpts('/tmp/repo', [], {
      maxFiles: 1, maxLinesPerFile: 1, maxCharactersPerFile: 10, maxBytesPerFile: 10,
    });

    expect(recorder.finish('fixed').completeness.overflowedBoundaries)
      .not.toContain('repository');
  });
});
