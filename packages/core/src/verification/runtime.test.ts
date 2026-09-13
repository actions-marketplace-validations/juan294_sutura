import { expect, it, vi } from 'vitest';
import { evaluateRuntimeCandidate } from './runtime.js';
import { prepareRuntimeChallenges } from '../challenges/runtime.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import type { Executor } from '../executor/types.js';
import type { HealLlm } from '../heal.js';
const diff = 'diff --git a/src/pages.js b/src/pages.js\n--- a/src/pages.js\n+++ b/src/pages.js\n@@ -1 +1 @@\n-export const pages = n => n;\n+export const pages = n => Math.ceil(n / 10);\n';
it('runs full audit and policy before admitting a provisional candidate', async () => {
  const calls: string[] = [];
  const executor = { run: vi.fn(async (_image: string, command: string) => { calls.push(command); return { imageId: 'result', exitCode: 0, stdout: 'passed', stderr: '', metrics: {} }; }) } as unknown as Executor;
  const llm = { chat: vi.fn(async () => { calls.push('adjudication'); return { text: '{"approved":true,"reasoning":"Correct repair"}' }; }) } as unknown as HealLlm;
  const policy = { ...createDefaultRepositoryPolicy(), requiredCommands: ['npm test'] };
  const prepared = await prepareRuntimeChallenges({ executor, llm, policy, baselineImage: 'baseline', policyBaseSha: '', policyHash: '', baselineSnapshotHash: '', failureExcerpt: 'failed', baselineSources: [] });
  const result = await evaluateRuntimeCandidate({ executor, llm, policy, prepared, baselineImage: 'baseline', winner: { candidate: { id: 'candidate', diff, rationale: 'repair' }, imageId: 'candidate', nodeId: 'node', held: true, exitCode: 0 }, diagnosis: { class: 'test-assertion', confidence: 1, signals: [], failingCmd: 'npm test', errorExcerpt: 'assertion' }, beforeLog: 'failed', suiteCommand: 'npm test' });
  expect(result.verdict.approved).toBe(true);
  expect(calls).toEqual(['npm test', 'adjudication', "sh -lc 'npm test'", "sh -lc 'npm test'"]);
  expect(result.verification.challengeAssurance).toBe(false);
});
it('abstains when required contracts are absent without calling adjudication', async () => {
  const executor = { run: vi.fn(async () => ({ imageId: 'result', exitCode: 0, stdout: 'passed', stderr: '', metrics: {} })) } as unknown as Executor;
  const llm = { chat: vi.fn() } as unknown as HealLlm;
  const policy = { ...createDefaultRepositoryPolicy(), verification: { mode: 'required' as const, contracts: [] } };
  const prepared = await prepareRuntimeChallenges({ executor, llm, policy, baselineImage: 'baseline', policyBaseSha: '', policyHash: '', baselineSnapshotHash: '', failureExcerpt: 'failed', baselineSources: [] });
  const result = await evaluateRuntimeCandidate({ executor, llm, policy, prepared, baselineImage: 'baseline', winner: { candidate: { id: 'candidate', diff, rationale: 'repair' }, imageId: 'candidate', nodeId: 'node', held: true, exitCode: 0 }, diagnosis: { class: 'test-assertion', confidence: 1, signals: [], failingCmd: 'npm test', errorExcerpt: 'assertion' }, beforeLog: 'failed', suiteCommand: 'npm test' });
  expect(result.verification.status).toBe('insufficient');
  expect(result.verification.blockingGate).toBe('challenges');
  expect(llm.chat).not.toHaveBeenCalled();
});
