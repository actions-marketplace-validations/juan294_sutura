import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('node:child_process', () => ({
  // Match execFile's custom promisify contract, including stdout/stderr.
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: boundary.exec }),
}));

import { readTrustedPolicyAtCommit } from './source.js';

const sha = 'a'.repeat(40);
const blob = 'b'.repeat(40);
beforeEach(() => { boundary.exec.mockReset(); });
function response(stdout: string): void {
  boundary.exec.mockResolvedValueOnce({ stdout, stderr: '' });
}
function declaredPolicy(): void {
  response('commit\n');
  response(`100644 blob ${blob}\t.sutura.json\0`);
}

describe('malformed Git policy responses', () => {
  it('refuses a successful commit query returning a non-commit type', async () => {
    response('blob\n');
    await expect(readTrustedPolicyAtCommit('/unused', sha))
      .rejects.toMatchObject({ reasonCode: 'policy-commit-unavailable' });
    expect(boundary.exec).toHaveBeenCalledTimes(1);
  });
  it.each(['NaN', '-1', '1.5', '9007199254740992'])('refuses invalid object size %s', async (size) => {
    declaredPolicy();
    response(`${size}\n`);
    await expect(readTrustedPolicyAtCommit('/unused', sha))
      .rejects.toMatchObject({ reasonCode: 'policy-read-failed' });
    expect(boundary.exec).toHaveBeenCalledTimes(3);
  });
  it('refuses a blob whose returned bytes do not match its declared size', async () => {
    declaredPolicy();
    response('2\n');
    response('{"version":1}');
    await expect(readTrustedPolicyAtCommit('/unused', sha))
      .rejects.toMatchObject({ reasonCode: 'policy-read-failed' });
    expect(boundary.exec).toHaveBeenCalledTimes(4);
  });
});
