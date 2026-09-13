import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertCleanCheckoutAt,
  MAX_POLICY_OBJECT_BYTES,
  MAX_SNAPSHOT_FILES,
  readTrustedPolicyAtCommit,
  snapshotCleanSourceAt,
} from './source.js';

let root: string;
let sha: string;
function git(args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  }).trim();
}
function commit(): string {
  git(['add', '-A']);
  git(['commit', '--allow-empty', '-qm', 'source boundary']);
  return git(['rev-parse', 'HEAD']);
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sutura-core-source-git-'));
  git(['init', '-q', '-b', 'main']);
  sha = commit();
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('Git source identity guards', () => {
  it('accepts the exact clean commit and refuses a different source identity', async () => {
    await expect(assertCleanCheckoutAt(root, sha)).resolves.toBeUndefined();
    await expect(assertCleanCheckoutAt(root, '0'.repeat(40)))
      .rejects.toMatchObject({ reasonCode: 'source-sha-mismatch' });
  });
  it('refuses a directory outside a Git repository', async () => {
    await rm(join(root, '.git'), { recursive: true });
    await expect(assertCleanCheckoutAt(root, sha))
      .rejects.toMatchObject({ reasonCode: 'not-a-repository' });
  });
  it('refuses untracked source changes', async () => {
    await writeFile(join(root, 'source.js'), 'changed');
    await expect(assertCleanCheckoutAt(root, sha))
      .rejects.toMatchObject({ reasonCode: 'dirty-checkout' });
  });
  it('refuses more tracked files than the snapshot limit before copying', async () => {
    // Short real paths keep Git output inside its independent byte limit.
    for (let start = 0; start <= MAX_SNAPSHOT_FILES; start += 128) {
      await Promise.all(Array.from({ length: Math.min(128, MAX_SNAPSHOT_FILES + 1 - start) },
        (_, offset) => writeFile(join(root, `f${start + offset}`), '')));
    }
    const sourceSha = commit();
    await expect(snapshotCleanSourceAt(root, sourceSha))
      .rejects.toMatchObject({ reasonCode: 'source-too-large' });
  }, 60_000);
});

describe('trusted Git policy guards', () => {
  it('uses defaults only when the trusted commit has no declaration', async () => {
    await expect(readTrustedPolicyAtCommit(root, sha))
      .resolves.toMatchObject({ source: 'default', sha: 'default' });
    await expect(readTrustedPolicyAtCommit(root, '0'.repeat(40)))
      .rejects.toMatchObject({ reasonCode: 'policy-commit-unavailable' });
  });
  it.each(['tree', 'symlink'] as const)('refuses a policy %s', async (kind) => {
    const path = join(root, '.sutura.json');
    if (kind === 'tree') {
      await mkdir(path);
      await writeFile(join(path, 'policy'), '{}');
    } else {
      await symlink('{"version":1}', path);
    }
    await expect(readTrustedPolicyAtCommit(root, commit()))
      .rejects.toMatchObject({ reasonCode: 'policy-not-a-file' });
  });
  it('refuses an oversized policy before reading its blob', async () => {
    await writeFile(join(root, '.sutura.json'), ' '.repeat(MAX_POLICY_OBJECT_BYTES * 5));
    await expect(readTrustedPolicyAtCommit(root, commit()))
      .rejects.toMatchObject({ reasonCode: 'policy-too-large' });
  });
  it('refuses an invalid declaration instead of defaulting', async () => {
    await writeFile(join(root, '.sutura.json'), '{not json');
    await expect(readTrustedPolicyAtCommit(root, commit()))
      .rejects.toMatchObject({ reasonCode: 'policy-invalid' });
  });
  it('refuses a missing declared blob instead of defaulting', async () => {
    await writeFile(join(root, '.sutura.json'), '{"version":1}');
    const policySha = commit();
    const blob = git(['rev-parse', `${policySha}:.sutura.json`]);
    await rm(join(root, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
    await expect(readTrustedPolicyAtCommit(root, policySha))
      .rejects.toMatchObject({ reasonCode: 'policy-read-failed' });
  });
});
