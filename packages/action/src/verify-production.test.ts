import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), checkout: vi.fn(), snapshot: vi.fn(), policy: vi.fn(), execute: vi.fn(), upload: vi.fn(), summary: vi.fn(), cleanup: vi.fn() }));
vi.mock('@actions/github', () => ({ getOctokit: () => ({ rest: { actions: { getWorkflowRun: mocks.get } } }) }));
vi.mock('@actions/artifact', () => ({ DefaultArtifactClient: class {
    uploadArtifact = mocks.upload;
  } }));
vi.mock('@actions/core', () => ({ setOutput: vi.fn(), summary: { addHeading: () => ({ addCodeBlock: () => ({ write: mocks.summary }) }) } }));
vi.mock('./repository.js', () => ({ GitRepository: class {
    checkoutHead = mocks.checkout;
  } }));
vi.mock('@sutura/core', async (original) => ({ ...await original<typeof import('@sutura/core')>(), snapshotCleanSourceAt: mocks.snapshot, readTrustedPolicyAtCommit: mocks.policy, executeExternalVerification: mocks.execute, createTokenFactoryClient: () => ({}), ContreeExecutor: class {
  } }));
import { createDefaultRepositoryPolicy } from '@sutura/core';
import { runActionVerification } from './verify-execution.js';
const sha = 'a'.repeat(40);
const inputs = { sourceSha: sha, policyBaseSha: sha, candidateDiff: 'diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n', failingCommandId: 'diagnosed' };
const context = { owner: 'owner', repo: 'repo', runId: '77', githubToken: 'token', config: { contreeToken: 'token', contreeProject: 'project' } as never };
it('executes the production readonly route and uploads terminal refusal evidence', async () => {
  mocks.get.mockResolvedValue({ data: { id: 77, head_sha: sha, repository: { full_name: 'owner/repo' }, head_repository: { full_name: 'owner/repo' }, conclusion: 'failure' } });
  mocks.checkout.mockResolvedValue('/tmp/controller-checkout');
  mocks.policy.mockResolvedValue({ policy: { ...createDefaultRepositoryPolicy(), requiredCommands: ['npm test'] }, sha: 'b'.repeat(64) });
  mocks.snapshot.mockResolvedValue({ dir: '/tmp/immutable', snapshotSha256: 'c'.repeat(64), cleanup: mocks.cleanup });
  mocks.execute.mockResolvedValue({ status: 'refused', verification: { blockingGate: 'challenges', challengeAssurance: false }, generatedReplacement: false });
  expect(await runActionVerification(inputs, context)).toEqual({ status: 'refused' });
  expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ mode: 'live', sourceDir: '/tmp/immutable', snapshotSha256: 'c'.repeat(64), request: expect.objectContaining({ candidateDiff: inputs.candidateDiff }) }));
  expect(mocks.upload).toHaveBeenCalledOnce();
  expect(mocks.summary).toHaveBeenCalledOnce();
  expect(mocks.cleanup).toHaveBeenCalledOnce();
}, 30000);
it('does not fetch source or execute after authentication refuses the run', async () => {
  mocks.checkout.mockClear();
  mocks.execute.mockClear();
  mocks.get.mockResolvedValue({ data: { id: 77, head_sha: sha, repository: { full_name: 'owner/repo' }, head_repository: { full_name: 'fork/repo' }, conclusion: 'failure' } });
  await expect(runActionVerification(inputs, context)).rejects.toThrow(/fork/u);
  expect(mocks.checkout).not.toHaveBeenCalled();
  expect(mocks.execute).not.toHaveBeenCalled();
});
