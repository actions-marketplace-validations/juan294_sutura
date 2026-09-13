import { capturedBundle } from './__fixtures__/captured/test-helper.js';
import { expect, it, vi } from 'vitest';
import { authenticateVerifyRun, runActionVerification } from './verify-execution.js';
const sha = 'a'.repeat(40);
const run = { id: 77, head_sha: sha, repository: { full_name: 'owner/repo' }, head_repository: { full_name: 'owner/repo' }, conclusion: 'failure' };
it('authenticates exact failed source and repository before execution', async () => {
  const get = vi.fn(async () => ({ data: run }));
  await authenticateVerifyRun({ getWorkflowRun: get }, 'owner', 'repo', '77', sha);
  expect(get).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo', run_id: 77 });
});
it.each([{ head_sha: 'b'.repeat(40) }, { head_repository: { full_name: 'fork/repo' } }, { repository: { full_name: 'other/repo' } }, { conclusion: 'success' }])('refuses mismatched or nonfailing authenticated metadata %j', async (change) => {
  await expect(authenticateVerifyRun({ getWorkflowRun: async () => ({ data: { ...run, ...change } }) }, 'owner', 'repo', '77', sha)).rejects.toThrow(/Verification/u);
});
it('dispatches through a read-only injectable execution boundary', async () => {
  const execute = vi.fn(async () => ({ status: 'refused' as const }));
  const result = await runActionVerification({ sourceSha: sha, policyBaseSha: sha, candidateDiff: 'diff', failingCommandId: 'diagnosed' }, { owner: 'owner', repo: 'repo', runId: '77', githubToken: 'token', config: {} as never }, { execute });
  expect(execute).toHaveBeenCalledOnce();
  expect(result.status).toBe('refused');
});
it('keeps the captured failed-run identity admissible and rejects a fork mutation', async () => {
  const captured = capturedBundle('33265268595').github.find(call => call.method === 'getWorkflowRun')!.result as {
    id: number;
    headSha: string;
    repository: string;
    conclusion: string;
  };
  const data = { id: captured.id, head_sha: captured.headSha, repository: { full_name: captured.repository }, head_repository: { full_name: captured.repository }, conclusion: captured.conclusion };
  await authenticateVerifyRun({ getWorkflowRun: async () => ({ data }) }, 'juan294', 'sutura', String(captured.id), captured.headSha);
  await expect(authenticateVerifyRun({ getWorkflowRun: async () => ({ data: { ...data, head_repository: { full_name: 'attacker/sutura' } } }) }, 'juan294', 'sutura', String(captured.id), captured.headSha)).rejects.toThrow(/fork/u);
});
