/**
 * The immutable source snapshot.
 *
 * Verification executes a copy, not the developer's checkout, so what the run
 * verified cannot change afterwards. These tests use a real Git checkout and a
 * real temporary copy.
 */
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { snapshotCleanSourceAt, VerifySourceError } from './verify-source.js';

const exec = promisify(execFile);
const cleanups: Array<() => Promise<void>> = [];

async function checkout(files: Record<string, string>): Promise<{ dir: string; sha: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'sutura-verify-checkout-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  await exec('git', ['init', '--quiet', dir]);
  await exec('git', ['-C', dir, 'config', 'user.email', 'test@example.invalid']);
  await exec('git', ['-C', dir, 'config', 'user.name', 'Test']);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  await exec('git', ['-C', dir, 'add', '--all']);
  await exec('git', ['-C', dir, 'commit', '--quiet', '-m', 'baseline']);
  const sha = (await exec('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim();
  return { dir, sha };
}

function reasonOf(error: unknown): string {
  expect(error).toBeInstanceOf(VerifySourceError);
  return (error as VerifySourceError).reasonCode;
}

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

describe('snapshotCleanSourceAt', () => {
  it('copies the tracked source, binds its hash, and leaves the copy read-only', async () => {
    const { dir, sha } = await checkout({
      'src/app.js': 'export const value = 1;\n',
      'src/nested/deep.js': 'export const deep = 2;\n',
      'README.md': '# case\n',
    });

    const snapshot = await snapshotCleanSourceAt(dir, sha);
    cleanups.push(snapshot.cleanup);

    expect(snapshot.sourceSha).toBe(sha);
    expect(snapshot.snapshotSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.files).toEqual(['README.md', 'src/app.js', 'src/nested/deep.js']);
    expect(snapshot.dir).not.toBe(dir);
    expect(await readFile(join(snapshot.dir, 'src/nested/deep.js'), 'utf8')).toBe('export const deep = 2;\n');
    expect((await stat(join(snapshot.dir, 'src/app.js'))).mode & 0o222).toBe(0);
    await expect(writeFile(join(snapshot.dir, 'src/app.js'), 'tampered')).rejects.toThrow();
  }, 60_000);

  it('never copies the Git directory', async () => {
    const { dir, sha } = await checkout({ 'src/app.js': 'export const value = 1;\n' });

    const snapshot = await snapshotCleanSourceAt(dir, sha);
    cleanups.push(snapshot.cleanup);

    await expect(stat(join(snapshot.dir, '.git'))).rejects.toThrow();
    expect(snapshot.files.some((path) => path.startsWith('.git'))).toBe(false);
  }, 60_000);

  it('excludes controller storage, evaluator storage and hidden tests', async () => {
    const { dir, sha } = await checkout({
      'src/app.js': 'export const value = 1;\n',
      '.sutura-controller/frozen.json': '{"answer":1}',
      '.sutura-evaluator/answers.json': '{"answer":1}',
      'hidden/preservation.test.js': 'assert(true);',
      '.sutura/challenges/expectations.json': '{"expected":3}',
    });

    const snapshot = await snapshotCleanSourceAt(dir, sha);
    cleanups.push(snapshot.cleanup);

    expect(snapshot.files).toEqual(['src/app.js']);
    for (const excluded of ['.sutura-controller', '.sutura-evaluator', 'hidden', '.sutura']) {
      await expect(stat(join(snapshot.dir, excluded))).rejects.toThrow();
    }
  }, 60_000);

  it('gives two identical sources the same hash and two different sources different hashes', async () => {
    const first = await checkout({ 'src/app.js': 'export const value = 1;\n' });
    const same = await checkout({ 'src/app.js': 'export const value = 1;\n' });
    const other = await checkout({ 'src/app.js': 'export const value = 2;\n' });

    const snapshots = [];
    for (const source of [first, same, other]) {
      const snapshot = await snapshotCleanSourceAt(source.dir, source.sha);
      cleanups.push(snapshot.cleanup);
      snapshots.push(snapshot.snapshotSha256);
    }

    expect(snapshots[0]).toBe(snapshots[1]);
    expect(snapshots[0]).not.toBe(snapshots[2]);
  }, 60_000);

  it('refuses a dirty checkout and a checkout at another commit before copying', async () => {
    const { dir, sha } = await checkout({ 'src/app.js': 'export const value = 1;\n' });
    await writeFile(join(dir, 'src/app.js'), 'export const value = 99;\n');

    expect(reasonOf(await snapshotCleanSourceAt(dir, sha).catch((error: unknown) => error)))
      .toBe('dirty-checkout');

    await exec('git', ['-C', dir, 'checkout', '--quiet', '--', 'src/app.js']);
    expect(reasonOf(await snapshotCleanSourceAt(dir, 'f'.repeat(40)).catch((error: unknown) => error)))
      .toBe('source-sha-mismatch');
  }, 60_000);

  it('refuses a source that changes while it is being copied', async () => {
    const { dir, sha } = await checkout({
      'a.js': 'export const a = 1;\n',
      'b.js': 'export const b = 2;\n',
    });
    // Attach the handler before the concurrent write can make Git reject.
    const changed = snapshotCleanSourceAt(dir, sha).catch((error: unknown) => error);
    // The copy reads a.js, then b.js; rewriting a.js during the copy leaves the
    // snapshot describing neither the old source nor the new one.
    await writeFile(join(dir, 'a.js'), 'export const a = 99;\n');

    expect(reasonOf(await changed))
      .toMatch(/source-changed-during-snapshot|dirty-checkout/u);
    await chmod(dir, 0o755).catch(() => undefined);
  }, 60_000);
});
