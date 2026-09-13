import { appendFile, chmod, mkdtemp, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ beforeOpen: undefined as (() => Promise<void>) | undefined, beforeRead: undefined as (() => Promise<void>) | undefined }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, open: async (...args: Parameters<typeof original.open>) => {
    const beforeOpen = hooks.beforeOpen;
    hooks.beforeOpen = undefined;
    await beforeOpen?.();
    const handle = await original.open(...args);
    const read = handle.read.bind(handle);
    handle.read = (async (...readArgs: Parameters<typeof read>) => {
      const beforeRead = hooks.beforeRead;
      hooks.beforeRead = undefined;
      await beforeRead?.();
      return read(...readArgs);
    }) as typeof handle.read;
    return handle;
  } };
});
import { readBoundedRegularFile, snapshotSelectedSource } from './source.js';
let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sutura-bounded-input-'));
  file = join(dir, 'patch');
  await writeFile(file, 'abcd');
});
afterEach(async () => {
  hooks.beforeOpen = undefined;
  hooks.beforeRead = undefined;
  await rm(dir, { recursive: true, force: true });
});
describe('bounded regular input', () => {
  it('accepts exact byte limits and empty regular files', async () => {
    expect((await readBoundedRegularFile(file, 4)).toString()).toBe('abcd');
    await writeFile(file, '');
    expect(await readBoundedRegularFile(file, 0)).toHaveLength(0);
  });
  it('refuses directories and symlinks', async () => {
    await expect(readBoundedRegularFile(dir, 100)).rejects.toThrow(/regular file/u);
    const link = join(dir, 'link');
    await symlink(file, link);
    await expect(readBoundedRegularFile(link, 100)).rejects.toThrow(/symbolic link/u);
  });
  it('bounds bytes rather than characters', async () => {
    await writeFile(file, 'éé');
    await expect(readBoundedRegularFile(file, 3)).rejects.toThrow(/at most 3/u);
  });
  it('refuses replacement between lstat and opening', async () => {
    hooks.beforeOpen = async () => {
      await rename(file, join(dir, 'old'));
      await writeFile(file, 'abcd');
    };
    await expect(readBoundedRegularFile(file, 4)).rejects.toThrow(/changed/u);
  });
  it('refuses a symlink substituted just before opening', async () => {
    hooks.beforeOpen = async () => {
      await rename(file, join(dir, 'old'));
      await symlink(join(dir, 'old'), file);
    };
    await expect(readBoundedRegularFile(file, 4)).rejects.toThrow();
  });
  it('refuses growth rather than returning a valid prefix', async () => {
    hooks.beforeRead = () => appendFile(file, 'extra');
    await expect(readBoundedRegularFile(file, 4)).rejects.toThrow(/changed/u);
  });
  it('refuses truncation during reading', async () => {
    hooks.beforeRead = () => writeFile(file, 'a');
    await expect(readBoundedRegularFile(file, 4)).rejects.toThrow(/changed/u);
  });
  it('refuses a same-length rewrite during reading', async () => {
    hooks.beforeRead = () => writeFile(file, 'wxyz');
    await expect(readBoundedRegularFile(file, 4)).rejects.toThrow(/changed/u);
  });
  it('refuses replaced paths even when the opened handle is unchanged', async () => {
    hooks.beforeRead = async () => {
      await rename(file, join(dir, 'old'));
      await writeFile(file, 'abcd');
    };
    await expect(readBoundedRegularFile(file, 4)).rejects.toThrow(/changed/u);
  });
});


it('preserves executable file identity in the frozen upload and its hash', async () => {
  const plain = await snapshotSelectedSource(dir, ['patch'], async () => {});
  await chmod(file, 0o755);
  const executable = await snapshotSelectedSource(dir, ['patch'], async () => {});
  try {
    expect((await stat(join(executable.dir, 'patch'))).mode & 0o111).toBe(0o111);
    expect(executable.snapshotSha256).not.toBe(plain.snapshotSha256);
  } finally {
    await executable.cleanup();
    await plain.cleanup();
  }
});
