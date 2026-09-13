import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { ContreeExecutor } from './contree.js';

const exec = promisify(execFile);
const reserved = [
  '.sutura-controller/frozen.json', '.sutura-evaluator/answers.json',
  '.sutura/challenges/expectations.json', 'hidden/preservation.test.js',
  'packages/placebo/corpus/example/hidden/answers.json',
];

describe('controller and evaluator snapshot isolation', () => {
  it.each([false, true])('excludes oracle bytes and Git objects (git=%s)', async (git) => {
    const root = await mkdtemp(join(tmpdir(), 'sutura-oracle-snapshot-'));
    try {
      await writeFile(join(root, 'source.js'), 'export const value = 1;');
      await writeFile(join(root, '.sutura.json'), '{"publicContract":"specification"}');
      for (const path of reserved) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), 'CONTROLLER_HIDDEN_SENTINEL');
      }
      if (git) {
        await exec('git', ['init', '--quiet', root]);
        await exec('git', ['-C', root, 'add', '--all']);
      } else {
        await mkdir(join(root, '.git', 'objects'), { recursive: true });
        await writeFile(join(root, '.git', 'objects', 'sentinel'), 'RAW_GIT_SENTINEL');
      }
      let archive: Uint8Array | undefined;
      const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
        archive = new Uint8Array(await new Response(init?.body).arrayBuffer());
        throw new Error('Local test stops after archive capture');
      });
      const executor = new ContreeExecutor({ token: 'test', project: 'test', fetch });
      await expect(executor.snapshot(root, 'test-image', { profile: 'repository', mode: 'overlay' }))
        .rejects.toThrow('Local test stops after archive capture');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(archive).toBeDefined();
      const archivePath = join(root, 'captured.tar');
      await writeFile(archivePath, archive!);
      const entries = (await exec('tar', ['-tf', archivePath])).stdout.trim().split('\n');
      expect(entries.sort()).toEqual(['.sutura.json', 'source.js']);
      const bytes = Buffer.from(archive!).toString('utf8');
      expect(bytes).not.toContain('CONTROLLER_HIDDEN_SENTINEL');
      expect(bytes).not.toContain('RAW_GIT_SENTINEL');
      expect(bytes).toContain('specification');
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it('excludes hidden workspace metadata from the dependency lane', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sutura-oracle-dependencies-'));
    try {
      await exec('git', ['init', '--quiet', root]);
      await writeFile(join(root, 'package.json'), '{"workspaces":["packages/*"]}');
      await mkdir(join(root, 'packages', 'hidden'), { recursive: true });
      await writeFile(join(root, 'packages', 'hidden', 'package.json'), '{"oracle":"HIDDEN_DEPENDENCY_SENTINEL"}');
      let archive: Uint8Array | undefined;
      const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
        archive = new Uint8Array(await new Response(init?.body).arrayBuffer());
        throw new Error('Local test stops after archive capture');
      });
      const executor = new ContreeExecutor({ token: 'test', project: 'test', fetch });
      await expect(executor.snapshot(root, 'test-image', { profile: 'dependency-inputs', mode: 'replace' }))
        .rejects.toThrow('Local test stops after archive capture');
      expect(archive).toBeDefined();
      expect(Buffer.from(archive!).includes(Buffer.from('HIDDEN_DEPENDENCY_SENTINEL'))).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it.each(reserved)('rejects a source alias to %s before upload', async (path) => {
    const root = await mkdtemp(join(tmpdir(), 'sutura-oracle-alias-'));
    try {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), 'CONTROLLER_HIDDEN_SENTINEL');
      await symlink(path, join(root, 'innocent.js'));
      const fetch = vi.fn<typeof globalThis.fetch>();
      const executor = new ContreeExecutor({ token: 'test', project: 'test', fetch });
      await expect(executor.snapshot(root, 'test-image', { profile: 'repository', mode: 'overlay' }))
        .rejects.toThrow(/sensitive symlink/u);
      expect(fetch).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);
});
