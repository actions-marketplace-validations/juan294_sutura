import { describe, expect, it, vi } from 'vitest';

import { resolveActionCommit, ReleaseResolutionError } from './release.js';

const COMMIT = 'a'.repeat(40);
const TAG_OBJECT = 'b'.repeat(40);

describe('resolveActionCommit', () => {
  it('resolves a lightweight release tag to one exact commit', async () => {
    const run = vi.fn().mockResolvedValue(`${COMMIT}\trefs/tags/v0.2.1\n`);

    await expect(resolveActionCommit({ version: '0.2.1', cwd: '/tmp/repo', run }))
      .resolves.toBe(COMMIT);
    expect(run).toHaveBeenCalledWith('git', [
      'ls-remote', 'https://github.com/juan294/sutura.git',
      'refs/tags/v0.2.1', 'refs/tags/v0.2.1^{}',
    ], { cwd: '/tmp/repo' });
  });

  it('uses the peeled commit for an annotated release tag', async () => {
    const run = vi.fn().mockResolvedValue([
      `${TAG_OBJECT}\trefs/tags/v0.2.1`,
      `${COMMIT}\trefs/tags/v0.2.1^{}`,
      '',
    ].join('\n'));

    await expect(resolveActionCommit({ version: '0.2.1', cwd: '/tmp/repo', run }))
      .resolves.toBe(COMMIT);
  });

  it('accepts only an exact explicit candidate commit without a network command', async () => {
    const run = vi.fn();
    await expect(resolveActionCommit({
      version: '0.2.1', cwd: '/tmp/repo', run, explicitCommit: COMMIT.toUpperCase(),
    })).resolves.toBe(COMMIT);
    expect(run).not.toHaveBeenCalled();

    await expect(resolveActionCommit({
      version: '0.2.1', cwd: '/tmp/repo', run, explicitCommit: 'main',
    })).rejects.toBeInstanceOf(ReleaseResolutionError);
  });

  it.each(['', `${COMMIT}\trefs/tags/v0.2.1\n${TAG_OBJECT}\trefs/tags/v0.2.1\n`, 'not-a-sha\trefs/tags/v0.2.1\n'])(
    'fails closed for missing, ambiguous, or malformed tag output',
    async (output) => {
      await expect(resolveActionCommit({
        version: '0.2.1', cwd: '/tmp/repo', run: vi.fn().mockResolvedValue(output),
      })).rejects.toBeInstanceOf(ReleaseResolutionError);
    },
  );
});
