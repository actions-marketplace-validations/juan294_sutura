import { expect, it, vi } from 'vitest';
import { evaluateRuntimeCandidate } from './runtime.js';
import { prepareRuntimeChallenges } from '../challenges/runtime.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import type { Executor } from '../executor/types.js';
import type { HealLlm } from '../heal.js';
import { TYPESAFE_AUDIT_MODEL, type TypeSafeAuditClient, type TypeSafeDecision } from '../llm/typesafe.js';

function jevDecision(greenWash: number, confidence: number): TypeSafeDecision {
  return {
    model: TYPESAFE_AUDIT_MODEL,
    answers: {
      verdict: {
        type: 'choice',
        choice: greenWash >= 0.5 ? 'green_wash' : 'legitimate_repair',
        probabilities: { legitimate_repair: 1 - greenWash, green_wash: greenWash },
        confidence,
      },
      touches_only_tests: { type: 'noul', noul: 0.1 },
      weakens_assertion: { type: 'noul', noul: 0.2 },
      suppresses_error: { type: 'noul', noul: 0.3 },
      unrelated_change: { type: 'noul', noul: 0.4 },
    },
    usage: { inTok: 100, outTok: 0, reasoningTok: 0 },
    usd: 0.0001,
    latencyMs: 10,
    requestId: null,
  };
}

function jevClient(decision: TypeSafeDecision): TypeSafeAuditClient {
  return { modelId: () => decision.model, decide: async () => decision };
}
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

async function evaluateWithSecondOpinion(
  secondOpinion: HealLlm | undefined,
  typesafeAudit?: TypeSafeAuditClient,
  executorOverride?: Executor,
) {
  const executor = executorOverride ?? { run: vi.fn(async () => ({ imageId: 'result', exitCode: 0, stdout: 'passed', stderr: '', metrics: {} })) } as unknown as Executor;
  const llm = { chat: vi.fn(async () => ({ text: '{"approved":true,"reasoning":"Correct repair"}' })) } as unknown as HealLlm;
  const policy = { ...createDefaultRepositoryPolicy(), requiredCommands: ['npm test'] };
  const prepared = await prepareRuntimeChallenges({ executor, llm, policy, baselineImage: 'baseline', policyBaseSha: '', policyHash: '', baselineSnapshotHash: '', failureExcerpt: 'failed', baselineSources: [] });
  return evaluateRuntimeCandidate({
    executor, llm, policy, prepared, baselineImage: 'baseline',
    ...(secondOpinion === undefined ? {} : { secondOpinion }),
    ...(typesafeAudit === undefined ? {} : { typesafeAudit }),
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

it('fails the gate when Nemotron and Astra approve but the calibrated audit refuses', async () => {
  const secondOpinion = { chat: vi.fn(async () => ({ text: '{"approved":true,"reasoning":"Looks fine."}' })) } as unknown as HealLlm;
  const typesafeAudit = jevClient(jevDecision(0.97, 0.94));
  const result = await evaluateWithSecondOpinion(secondOpinion, typesafeAudit);
  expect(result.verdict.approved).toBe(false);
  expect(result.verification.status).toBe('failed');
  expect(result.verdict.reasoning).toMatch(/^REFUSED by calibrated audit/u);
  expect(result.verdict.checks).toContainEqual(expect.objectContaining({
    name: 'typesafe-audit', passed: false, evidence: expect.stringContaining('P(green-wash)=0.97'),
  }));
});

it('passes the gate with the calibrated audit\'s numbers when Jev is uncertain', async () => {
  const secondOpinion = { chat: vi.fn(async () => ({ text: '{"approved":true,"reasoning":"Looks fine."}' })) } as unknown as HealLlm;
  const typesafeAudit = jevClient(jevDecision(0.81, 0.63));
  const result = await evaluateWithSecondOpinion(secondOpinion, typesafeAudit);
  expect(result.verdict.approved).toBe(true);
  expect(result.verdict.checks).toContainEqual(expect.objectContaining({
    name: 'typesafe-audit', passed: true,
    evidence: expect.stringMatching(/uncertain.*confidence=0\.63/u),
  }));
});

it('passes the gate with a skipped calibrated-audit row when no TypeSafe client is configured', async () => {
  const secondOpinion = { chat: vi.fn(async () => ({ text: '{"approved":true,"reasoning":"Looks fine."}' })) } as unknown as HealLlm;
  const result = await evaluateWithSecondOpinion(secondOpinion, undefined);
  expect(result.verdict.approved).toBe(true);
  expect(result.verdict.checks).toContainEqual(expect.objectContaining({
    name: 'typesafe-audit', passed: true,
    evidence: expect.stringContaining('TYPESAFE_API_KEY'),
  }));
});

it('fails the gate on Nemotron\'s reasoning when Nemotron already refused, and still records the calibrated audit', async () => {
  const executor = { run: vi.fn(async () => ({ imageId: 'result', exitCode: 0, stdout: 'passed', stderr: '', metrics: {} })) } as unknown as Executor;
  const llm = { chat: vi.fn(async () => ({ text: '{"approved":false,"reasoning":"Deletes a test."}' })) } as unknown as HealLlm;
  const secondOpinion = { chat: vi.fn(async () => ({ text: '{"approved":true,"reasoning":"Looks fine."}' })) } as unknown as HealLlm;
  const typesafeAudit = jevClient(jevDecision(0.97, 0.94));
  const policy = { ...createDefaultRepositoryPolicy(), requiredCommands: ['npm test'] };
  const prepared = await prepareRuntimeChallenges({ executor, llm, policy, baselineImage: 'baseline', policyBaseSha: '', policyHash: '', baselineSnapshotHash: '', failureExcerpt: 'failed', baselineSources: [] });
  const result = await evaluateRuntimeCandidate({
    executor, llm, policy, prepared, baselineImage: 'baseline', secondOpinion, typesafeAudit,
    winner: { candidate: { id: 'candidate', diff, rationale: 'repair' }, imageId: 'candidate', nodeId: 'node', held: true, exitCode: 0 },
    diagnosis: { class: 'test-assertion', confidence: 1, signals: [], failingCmd: 'npm test', errorExcerpt: 'assertion' },
    beforeLog: 'failed', suiteCommand: 'npm test',
  });
  expect(result.verdict.approved).toBe(false);
  expect(result.verdict.reasoning).not.toMatch(/^REFUSED by calibrated audit/u);
  expect(result.verdict.reasoning).not.toMatch(/^REFUSED by second opinion/u);
  expect(result.verdict.checks).toContainEqual(expect.objectContaining({ name: 'typesafe-audit', passed: false }));
});

it('records a "Not run" calibrated-audit row when the fresh suite rerun fails', async () => {
  const executor = { run: vi.fn(async () => ({ imageId: 'result', exitCode: 1, stdout: '', stderr: 'failed', metrics: {} })) } as unknown as Executor;
  const result = await evaluateWithSecondOpinion(undefined, undefined, executor);
  expect(result.verdict.approved).toBe(false);
  expect(result.verdict.checks).toContainEqual(expect.objectContaining({
    name: 'typesafe-audit', passed: false, evidence: 'Not run: the fresh suite rerun failed',
  }));
});
