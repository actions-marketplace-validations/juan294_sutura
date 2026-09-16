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

async function evaluateWithSecondOpinion(secondOpinion: HealLlm | undefined) {
  const executor = { run: vi.fn(async () => ({ imageId: 'result', exitCode: 0, stdout: 'passed', stderr: '', metrics: {} })) } as unknown as Executor;
  const llm = { chat: vi.fn(async () => ({ text: '{"approved":true,"reasoning":"Correct repair"}' })) } as unknown as HealLlm;
  const policy = { ...createDefaultRepositoryPolicy(), requiredCommands: ['npm test'] };
  const prepared = await prepareRuntimeChallenges({ executor, llm, policy, baselineImage: 'baseline', policyBaseSha: '', policyHash: '', baselineSnapshotHash: '', failureExcerpt: 'failed', baselineSources: [] });
  return evaluateRuntimeCandidate({
    executor, llm, policy, prepared, baselineImage: 'baseline',
    ...(secondOpinion === undefined ? {} : { secondOpinion }),
    winner: { candidate: { id: 'candidate', diff, rationale: 'repair' }, imageId: 'candidate', nodeId: 'node', held: true, exitCode: 0 },
    diagnosis: { class: 'test-assertion', confidence: 1, signals: [], failingCmd: 'npm test', errorExcerpt: 'assertion' },
    beforeLog: 'failed', suiteCommand: 'npm test',
  });
}

it('fails the gate when Nemotron approves and the second opinion refuses', async () => {
  const secondOpinion = { chat: vi.fn(async () => ({ text: '{"approved":false,"reasoning":"Weakens an assertion."}' })) } as unknown as HealLlm;
  const result = await evaluateWithSecondOpinion(secondOpinion);
  expect(result.verdict.approved).toBe(false);
  expect(result.verification.status).toBe('failed');
  expect(result.verdict.reasoning).toMatch(/^REFUSED by second opinion/u);
  expect(result.verdict.checks).toContainEqual(expect.objectContaining({
    name: 'second-opinion', passed: false,
  }));
});

it('passes the gate with a skipped row when Nemotron approves and no second opinion is configured', async () => {
  const result = await evaluateWithSecondOpinion(undefined);
  expect(result.verdict.approved).toBe(true);
  expect(result.verification.status).toBe('passed');
  expect(result.verdict.checks).toContainEqual(expect.objectContaining({
    name: 'second-opinion', passed: true, evidence: expect.stringContaining('skipped'),
  }));
});

it('fails the gate when Nemotron refuses, and still records the second opinion', async () => {
  const executor = { run: vi.fn(async () => ({ imageId: 'result', exitCode: 0, stdout: 'passed', stderr: '', metrics: {} })) } as unknown as Executor;
  const llm = { chat: vi.fn(async () => ({ text: '{"approved":false,"reasoning":"Deletes a test."}' })) } as unknown as HealLlm;
  const secondOpinion = { chat: vi.fn(async () => ({ text: '{"approved":true,"reasoning":"Looks fine."}' })) } as unknown as HealLlm;
  const policy = { ...createDefaultRepositoryPolicy(), requiredCommands: ['npm test'] };
  const prepared = await prepareRuntimeChallenges({ executor, llm, policy, baselineImage: 'baseline', policyBaseSha: '', policyHash: '', baselineSnapshotHash: '', failureExcerpt: 'failed', baselineSources: [] });
  const result = await evaluateRuntimeCandidate({
    executor, llm, policy, prepared, baselineImage: 'baseline', secondOpinion,
    winner: { candidate: { id: 'candidate', diff, rationale: 'repair' }, imageId: 'candidate', nodeId: 'node', held: true, exitCode: 0 },
    diagnosis: { class: 'test-assertion', confidence: 1, signals: [], failingCmd: 'npm test', errorExcerpt: 'assertion' },
    beforeLog: 'failed', suiteCommand: 'npm test',
  });
  expect(result.verdict.approved).toBe(false);
  expect(secondOpinion.chat).toHaveBeenCalled();
  expect(result.verdict.checks).toContainEqual(expect.objectContaining({ name: 'llm-adjudication', passed: false }));
  expect(result.verdict.checks).toContainEqual(expect.objectContaining({ name: 'second-opinion', passed: true }));
});
