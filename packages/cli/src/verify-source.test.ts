import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertCleanCheckoutAt,
  MAX_POLICY_OBJECT_BYTES,
  readTrustedPolicyAtCommit,
  snapshotCleanSourceAt,
  VerifySourceError,
} from './verify-source.js';

const exec = promisify(execFile);

let root: string;
/** Commit with a trusted policy declaration. */
let withPolicy: string;
/** Later commit that removed it. */
let withoutPolicy: string;

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await exec('git', ['-C', cwd, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.invalid',
    },
  });
  return result.stdout;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'sutura-verify-source-'));
  await git(root, ['init', '-q', '-b', 'main']);
  await writeFile(join(root, 'page-count.js'), 'export const a = 1;\n');
  await writeFile(join(root, '.sutura.json'), JSON.stringify({
    version: 1, maxChangedFiles: 2, requiredCommands: ['pnpm test'],
  }));
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'with policy']);
  withPolicy = (await git(root, ['rev-parse', 'HEAD'])).trim();

  await git(root, ['rm', '-q', '.sutura.json']);
  await git(root, ['commit', '-qm', 'without policy']);
  withoutPolicy = (await git(root, ['rev-parse', 'HEAD'])).trim();
}, 60_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('clean checkout identity', () => {
  it('accepts a checkout sitting exactly on the declared source', async () => {
    await expect(assertCleanCheckoutAt(root, withoutPolicy)).resolves.toBeUndefined();
  });

  it('refuses a checkout at a different commit', async () => {
    await expect(assertCleanCheckoutAt(root, withPolicy))
      .rejects.toThrow(/not the declared source/u);
  });

  it('refuses a tracked modification', async () => {
    await writeFile(join(root, 'page-count.js'), 'export const a = 2;\n');
    try {
      await expect(assertCleanCheckoutAt(root, withoutPolicy))
        .rejects.toThrow(/tracked or untracked changes/u);
    } finally {
      await git(root, ['checkout', '--', 'page-count.js']);
    }
  });

  it('refuses an untracked file', async () => {
    const stray = join(root, 'stray.txt');
    await writeFile(stray, 'left behind\n');
    try {
      await expect(assertCleanCheckoutAt(root, withoutPolicy))
        .rejects.toThrow(/tracked or untracked changes/u);
    } finally {
      await rm(stray, { force: true });
    }
  });

  it('refuses a directory that is not a Git checkout', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'sutura-plain-'));
    try {
      await expect(assertCleanCheckoutAt(plain, withoutPolicy))
        .rejects.toThrow(VerifySourceError);
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('trusted policy at a commit', () => {
  it('reads the declaration from the operator-chosen commit', async () => {
    const loaded = await readTrustedPolicyAtCommit(root, withPolicy);

    expect(loaded.source).toBe('repository');
    expect(loaded.policy.maxChangedFiles).toBe(2);
    expect(loaded.sha).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('reads the policy from that commit even when the checkout is elsewhere', async () => {
    // HEAD is the commit that removed the declaration; the trusted commit still has it.
    expect((await git(root, ['rev-parse', 'HEAD'])).trim()).toBe(withoutPolicy);

    const loaded = await readTrustedPolicyAtCommit(root, withPolicy);
    expect(loaded.source).toBe('repository');
  });

  it('falls back to versioned built-in defaults when the commit declares none', async () => {
    const loaded = await readTrustedPolicyAtCommit(root, withoutPolicy);

    expect(loaded.source).toBe('default');
    expect(loaded.sha).toBe('default');
    expect(loaded.policy.maxChangedFiles).toBeGreaterThan(0);
  });

  it('refuses a commit this checkout does not have', async () => {
    await expect(readTrustedPolicyAtCommit(root, 'c'.repeat(40)))
      .rejects.toThrow(/not available in this checkout/u);
  });

  it('refuses an invalid trusted declaration rather than falling back', async () => {
    const broken = await mkdtemp(join(tmpdir(), 'sutura-broken-policy-'));
    try {
      await git(broken, ['init', '-q', '-b', 'main']);
      await writeFile(join(broken, '.sutura.json'), '{not json');
      await git(broken, ['add', '-A']);
      await git(broken, ['commit', '-qm', 'broken policy']);
      const sha = (await git(broken, ['rev-parse', 'HEAD'])).trim();

      await expect(readTrustedPolicyAtCommit(broken, sha)).rejects.toThrow(/is not valid/u);
    } finally {
      await rm(broken, { recursive: true, force: true });
    }
  }, 60_000);

  it('bounds the declaration it will read', () => {
    expect(MAX_POLICY_OBJECT_BYTES).toBe(65_536);
  });
});


describe('untrusted Git object boundaries', () => {
  async function fixture(setup: (dir: string) => Promise<void>): Promise<{ dir: string; sha: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-source-boundary-'));
    await git(dir, ['init', '-q', '-b', 'main']);
    await setup(dir);
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-qm', 'boundary']);
    return { dir, sha: (await git(dir, ['rev-parse', 'HEAD'])).trim() };
  }

  it('refuses a policy object larger than the Git output buffer instead of defaulting', async () => {
    const { dir, sha } = await fixture(async (dir) => {
      await writeFile(join(dir, '.sutura.json'), ' '.repeat(MAX_POLICY_OBJECT_BYTES * 5));
    });
    try {
      await expect(readTrustedPolicyAtCommit(dir, sha)).rejects.toMatchObject({ reasonCode: 'policy-too-large' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('refuses a policy tree instead of treating it as a declaration', async () => {
    const { dir, sha } = await fixture(async (dir) => {
      await mkdir(join(dir, '.sutura.json'));
      await writeFile(join(dir, '.sutura.json', 'policy'), '{}');
    });
    try {
      await expect(readTrustedPolicyAtCommit(dir, sha)).rejects.toMatchObject({ reasonCode: 'policy-not-a-file' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('refuses a symlink policy even when its link text is valid policy JSON', async () => {
    const { dir, sha } = await fixture(async (dir) => {
      await symlink('{"version":1}', join(dir, '.sutura.json'));
    });
    try {
      await expect(readTrustedPolicyAtCommit(dir, sha)).rejects.toMatchObject({ reasonCode: 'policy-not-a-file' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('refuses a missing declared blob instead of defaulting', async () => {
    const { dir, sha } = await fixture(async (dir) => {
      await writeFile(join(dir, '.sutura.json'), '{"version":1}');
    });
    try {
      const blob = (await git(dir, ['rev-parse', `${sha}:.sutura.json`])).trim();
      await rm(join(dir, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
      await expect(readTrustedPolicyAtCommit(dir, sha)).rejects.toMatchObject({ reasonCode: 'policy-read-failed' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('refuses a tracked symlink without copying external bytes', async () => {
    const external = await mkdtemp(join(tmpdir(), 'sutura-external-source-'));
    await writeFile(join(external, 'secret'), 'private bytes');
    const { dir, sha } = await fixture(async (dir) => {
      await symlink(join(external, 'secret'), join(dir, 'source.js'));
    });
    try {
      await expect(snapshotCleanSourceAt(dir, sha)).rejects.toMatchObject({ reasonCode: 'source-not-a-file' });
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  });
});
