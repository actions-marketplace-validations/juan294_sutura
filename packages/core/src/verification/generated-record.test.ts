import { expect, it } from 'vitest';
import type { CaseFile, Candidate } from '../domain.js';
import type { HealLlm } from '../heal.js';
import { InMemoryExecutor } from '../executor/memory.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import { VERIFICATION_GATE_ORDER } from './evaluate.js';
import { decodeVerificationEvidence } from './codec.js';
import { GeneratedVerificationRecorder } from './generated-record.js';
import { candidateIdentity } from '../engine/candidate-identity.js';

const hash = 'a'.repeat(64);
function setup() {
  const executor = new InMemoryExecutor(() => ({ exitCode: 0, stdout: 'ok', stderr: '', truncated: false, metrics: {} }));
  const llm = { chat: async () => ({ text: '{}', providerModel: 'model', usage: { inTok: 1, outTok: 1, reasoningTok: 0 } }), modelQuote: () => ({ role: 'super', modelId: 'model', profileId: 'baseline', price: { input: 1, output: 1 } }) } as unknown as HealLlm;
  const recorder = new GeneratedVerificationRecorder({ executor, llm, baselineImageId: 'immutable-baseline', policy: createDefaultRepositoryPolicy(),
    sourceIdentity: { kind: 'local-snapshot', sourceSha: null, policyBaseSha: null, snapshotSha256: hash } });
  const file = { outcome: 'gave-up', race: [], stages: [], diagnosis: { errorExcerpt: 'failure' } } as unknown as CaseFile;
  return { recorder, file };
}
it('attaches local snapshot identity without inventing Git SHAs and preserves terminal unknowns', async () => {
  const { recorder, file } = setup();
  await recorder.executor.run('immutable-baseline', 'npm test', { operationId: 'triage' });
  const result = recorder.attach(file);
  expect(result.verification?.identity).toMatchObject({ sourceKind: 'local-snapshot', sourceSha: null, policyBaseSha: null, snapshotSha256: hash, executorImageId: 'immutable-baseline' });
  expect(result.verification?.outcome).toBe('insufficient');
  expect(result.verification?.gates.every(gate => gate.status === 'not-run')).toBe(true);
  expect(decodeVerificationEvidence(result.verificationArtifact!, result.verification!.identity)).toEqual(result.verification);
});
it('binds selected candidate evidence, rather than the most recently inspected candidate', async () => {
  const { recorder, file } = setup();
  await recorder.executor.run('immutable-baseline', 'npm test', { operationId: 'suite' });
  const selected: Candidate = { id: 'chosen', diff: 'selected diff', rationale: 'chosen' };
  const other: Candidate = { id: 'other', diff: 'other diff', rationale: 'other' };
  const prepared = { mode: 'required' as const, set: null, baseline: [], qualified: [{ challengeId: 'one', qualified: true, reasonCode: 'qualified', observations: [] }], reason: null };
  const verification = { status: 'passed' as const, blockingGate: null, challengeMode: 'required' as const, challengeAssurance: true,
    observations: VERIFICATION_GATE_ORDER.map(gate => ({ gate, status: 'passed' as const, reasons: [], artifacts: [{ id: gate, sha256: hash }] })) };
  recorder.record(selected, prepared, { verdict: { approved: true, checks: [], reasoning: 'passed' }, verification, challenges: null });
  recorder.record(other, prepared, { verdict: { approved: true, checks: [], reasoning: 'passed' }, verification, challenges: null });
  const result = recorder.attach({ ...file, outcome: 'fixed', selectedCandidate: candidateIdentity(selected) });
  expect(result.verification?.identity.diffSha256).toBe(candidateIdentity(selected).diffHash);
  expect(result.verification?.outcome).toBe('repaired');
  expect(result.verification?.assurance).toBe('contract-verified');
});
it('refuses to attach an accepted result with no executed candidate verification', () => {
  const { recorder, file } = setup();
  expect(() => recorder.attach({ ...file, outcome: 'fixed' })).toThrow(/executed candidate/u);
});
