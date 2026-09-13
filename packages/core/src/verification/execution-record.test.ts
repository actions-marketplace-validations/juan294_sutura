import { expect, it, vi } from 'vitest';
import { InMemoryExecutor } from '../executor/memory.js';
import type { HealLlm } from '../heal.js';
import { VERIFICATION_GATE_ORDER } from './evaluate.js';
import { decodeVerificationEvidence, encodeVerificationEvidence } from './codec.js';
import { VerificationExecutionRecorder } from './execution-record.js';
const digest = 'a'.repeat(64);
function context() {
  const executor = new InMemoryExecutor(() => ({ exitCode: 0, stdout: 'ok', stderr: '', truncated: false, metrics: { cost: 123 } }));
  const llm = { modelQuote: () => ({ role: 'super', modelId: 'requested-model', price: { input: 0.1, output: 0.2 }, profileId: 'fixed-v1' }), chat: vi.fn(async () => ({ text: '{}', providerModel: 'requested-model', usage: { inTok: 10, outTok: 4, reasoningTok: 2 }, usd: 0.1 })) } as unknown as HealLlm;
  const recorder = new VerificationExecutionRecorder({ executor, llm, now: () => 1000 });
  const result = (extra: Partial<Parameters<VerificationExecutionRecorder['finish']>[0]> = {}) => recorder.finish({
    identity: { sourceSha: 'a'.repeat(40), policyBaseSha: 'b'.repeat(40), policySha256: digest, snapshotSha256: digest, diffSha256: digest, corpusRevision: null, fixtureRevision: null },
    outcome: 'refused',
    verification: { status: 'failed', blockingGate: 'visible', challengeMode: 'required', challengeAssurance: false,
      observations: VERIFICATION_GATE_ORDER.map((gate) => ({ gate, status: gate === 'visible' ? 'failed' : 'not-run', reasons: [gate === 'visible' ? 'assertion-failed' : 'not-executed'], artifacts: [] })) },
    prepared: null, challenges: null, ...extra,
  });
  return { executor, llm, recorder, result };
}
it('records actual imports, commands, requested/returned models and unconfirmed sandbox units', async () => {
  const { recorder, result } = context();
  const image = await recorder.executor.importImage(`node:22@sha256:${digest}`);
  await recorder.executor.run(image, 'npm test', { operationId: 'op-1' });
  await recorder.llm.chat('super', [{ role: 'user', content: 'baseline only' }], { purpose: 'challenge-generation' });
  const { evidence, verificationArtifact } = result();
  expect(evidence.mode).toBe('local');
  expect(evidence.identity.imageDigest).toBe(`sha256:${digest}`);
  expect(evidence.commands).toEqual(['npm test']);
  expect(evidence.models[0]).toMatchObject({ purpose: 'challenge-generation', requestedModel: 'requested-model', returnedModel: 'requested-model' });
  expect(evidence.costs.inference).toEqual([{ modelIndex: 0, inputTokens: 10, outputTokens: 4, reasoningTokens: 2, price: null, estimateUsd: null }]);
  expect(evidence.costs.sandbox).toContainEqual({ operationId: 'op-1', rawAmount: 123, rawUnit: null, unitSource: null, billed: null });
  expect(decodeVerificationEvidence(verificationArtifact, evidence.identity)).toEqual(evidence);
});
it('does not turn missing usage, failed provider calls or unknown image identity into zeros', async () => {
  const { recorder, llm, result } = context();
  await recorder.executor.importImage('node:22');
  await recorder.llm.chat('super', []);
  vi.mocked(llm.chat).mockRejectedValueOnce(new Error('provider stopped'));
  await expect(recorder.llm.chat('ultra', [], { purpose: 'adjudication' })).rejects.toThrow('provider stopped');
  expect(result().evidence.costs.inference).toBeNull();
  expect(result().evidence.identity.imageDigest).toBeNull();
  expect(result().evidence.models[1]?.returnedModel).toBeNull();
});
it('hashes long or private command text and retains failed sandbox attempts as unknown costs', async () => {
  const { recorder, executor, result } = context();
  vi.spyOn(executor, 'run').mockRejectedValue(new Error('transport stopped'));
  await expect(recorder.executor.run('image', `printf '${'x'.repeat(5000)}'`, { operationId: 'failed-op' })).rejects.toThrow();
  const evidence = result().evidence;
  expect(evidence.commands[0]).toMatch(/^command-sha256:[a-f0-9]{64}$/u);
  expect(evidence.costs.sandbox).toContainEqual({ operationId: 'failed-op', rawAmount: null, rawUnit: null, unitSource: null, billed: null });
});
it('keeps frozen qualified baseline repetitions when a candidate cannot run', () => {
  const { result } = context();
  const baseline = [1, 2].map(repetition => ({ challengeId: 'one', subject: 'baseline' as const, repetition, status: 'passed' as const, observationSha256: digest, reasonCode: 'passed' }));
  const base = result({ prepared: { mode: 'required', set: { setHash: digest } as NonNullable<Parameters<VerificationExecutionRecorder['finish']>[0]['prepared']>['set'], baseline,
    qualified: [{ challengeId: 'one', qualified: true, reasonCode: 'qualified', observations: baseline }], reason: null } });
  expect(base.evidence.challenges.qualifiedProbeCount).toBe(1);
  expect(base.evidence.challenges.subjects).toEqual(baseline);
});
it('v2 binds accepted evidence to actual executor image while v1 still requires an OCI digest', async () => {
  const { recorder } = context();
  await recorder.executor.importImage('node:22');
  await recorder.executor.run('baseline-actual', 'npm test');
  const result = recorder.finish({
    identity: { sourceSha: 'a'.repeat(40), policyBaseSha: 'b'.repeat(40), policySha256: digest, snapshotSha256: digest, diffSha256: digest, corpusRevision: null, fixtureRevision: null },
    baselineImageId: 'baseline-actual', outcome: 'verified-supplied-patch',
    verification: { status: 'passed', blockingGate: null, challengeMode: 'required', challengeAssurance: true,
      observations: VERIFICATION_GATE_ORDER.map(gate => ({ gate, status: 'passed', reasons: [], artifacts: [{ id: gate, sha256: digest }] })) },
    prepared: { mode: 'required', set: null, baseline: [], qualified: [{ challengeId: 'one', qualified: true, reasonCode: 'qualified', observations: [] }], reason: null },
    challenges: null,
  });
  expect(result.evidence.schemaVersion).toBe('sutura-verification-evidence-v2');
  expect(result.evidence.identity.imageDigest).toBeNull();
  expect(result.evidence.identity.executorImageId).toBe('baseline-actual');
  expect(() => decodeVerificationEvidence(result.verificationArtifact, { ...result.evidence.identity, executorImageId: 'another-image' })).toThrow(/identity/u);
  const old = { ...result.evidence, schemaVersion: 'sutura-verification-evidence-v1' as const, identity: { ...result.evidence.identity } };
  delete old.identity.executorImageId;
  delete old.identity.sourceKind;
  expect(() => encodeVerificationEvidence(old)).toThrow(/image identities/u);
  expect(() => encodeVerificationEvidence({ ...result.evidence, identity: { ...result.evidence.identity, executorImageId: null } })).toThrow(/image identities/u);
});
it('records a reserved quote without rerouting and derives absent purpose from its role', async () => {
  const { recorder, llm, result } = context();
  const quote = { role: 'ultra' as const, modelId: 'reserved-model', profileId: 'fixed-v1', price: { input: 1, output: 3 } };
  const reroute = vi.spyOn(llm, 'modelQuote').mockImplementation(() => { throw new Error('must not reroute'); });
  await recorder.llm.chat('ultra', [], { quotedRoute: quote });
  expect(reroute).not.toHaveBeenCalled();
  expect(result().evidence.models[0]).toMatchObject({ purpose: 'adjudication', tier: 'ultra', requestedModel: 'reserved-model' });
});
it('prices only exact catalog model and returned identity using the dated primary source', async () => {
  const { recorder, llm, result } = context();
  const quote = { role: 'super' as const, modelId: 'nvidia/nemotron-3-super-120b-a12b', profileId: 'fixed-v1', price: { input: 0.3, output: 0.9 } };
  vi.mocked(llm.chat).mockResolvedValueOnce({ text: '{}', providerModel: quote.modelId, usage: { inTok: 100, outTok: 10, reasoningTok: 2 } });
  await recorder.llm.chat('super', [], { quotedRoute: quote });
  expect(result().evidence.costs.inference?.[0]).toMatchObject({ price: { inputPerMillionUsd: 0.3, outputPerMillionUsd: 0.9, asOf: '2026-09-08', source: 'https://tokenfactory.nebius.com/model-catalog.md' } });
  expect(result().evidence.costs.inference?.[0]?.estimateUsd).toBeCloseTo(0.0000408, 12);
  vi.mocked(llm.chat).mockResolvedValueOnce({ text: '{}', providerModel: 'other-model', usage: { inTok: 100, outTok: 10, reasoningTok: 2 } });
  await recorder.llm.chat('super', [], { quotedRoute: quote });
  expect(result().evidence.costs.inference?.[1]).toMatchObject({ estimateUsd: null, price: null });
});
