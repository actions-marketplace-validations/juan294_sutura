import { expect, it } from 'vitest';
import { parseRuntimeCandidateEvidence, type RuntimeCandidateEvidence } from './runtime-evidence.js';
import { VERIFICATION_GATE_ORDER } from './evaluate.js';
function evidence(): RuntimeCandidateEvidence {
  return {
    schemaVersion: 'sutura-runtime-candidate-v1', candidateId: 'candidate', diffHash: 'a'.repeat(64), setHash: null,
    verification: {
      status: 'passed', blockingGate: null, challengeMode: 'optional', challengeAssurance: false,
      observations: VERIFICATION_GATE_ORDER.map(gate => ({ gate, status: gate === 'challenges' ? 'not-run' : 'passed', reasons: gate === 'challenges' ? ['missing-contract'] : [], artifacts: [] })),
    },
    subjects: [],
  };
}
it('round-trips observed baseline-only gates without upgrading assurance', () => {
  const value = evidence();
  expect(parseRuntimeCandidateEvidence(JSON.parse(JSON.stringify(value)))).toEqual(value);
});
it.each(['set', 'expected', 'source'])('rejects controller-only field %s', key => {
  expect(() => parseRuntimeCandidateEvidence({ ...evidence(), [key]: {} })).toThrow();
});
it('refuses required acceptance without a qualified challenge', () => {
  const value = evidence();
  value.verification.challengeMode = 'required';
  expect(() => parseRuntimeCandidateEvidence(value)).toThrow();
});
it('refuses repeated or omitted gate observations', () => {
  const value = evidence();
  value.verification.observations[1] = value.verification.observations[0]!;
  expect(() => parseRuntimeCandidateEvidence(value)).toThrow();
});
it.each(['verification', 'observation', 'artifact', 'subject'])('rejects private fields nested in %s', level => {
  const value = evidence();
  const verification = value.verification;
  const invalid = level === 'verification' ? { ...value, verification: { ...verification, expected: 'private answer' } }
    : level === 'observation' ? { ...value, verification: { ...verification, observations: verification.observations.map((o, i) => i ? o : { ...o, source: 'private source' }) } }
      : level === 'artifact' ? { ...value, verification: { ...verification, observations: verification.observations.map((o, i) => i ? o : { ...o, artifacts: [{ id: 'source', sha256: 'b'.repeat(64), source: 'private source' }] }) } }
        : { ...value, setHash: 'b'.repeat(64), subjects: [{ challengeId: 'probe', subject: 'baseline', repetition: 1, status: 'passed', observationSha256: 'c'.repeat(64), reasonCode: 'passed', expected: 3 }] };
  expect(() => parseRuntimeCandidateEvidence(invalid)).toThrow();
});
it.each(['failed', 'insufficient', 'infra-stop', 'not-run'] as const)('rejects approval when audit observation is %s', status => {
  const value = evidence();
  value.verification.observations[4]!.status = status;
  expect(() => parseRuntimeCandidateEvidence(value)).toThrow();
});
it('rejects a declared failure without a matching blocking observation', () => {
  const value = evidence();
  value.verification.status = 'failed';
  value.verification.blockingGate = 'audit';
  expect(() => parseRuntimeCandidateEvidence(value)).toThrow();
});
it('rejects later executed observations after a terminal failure', () => {
  const value = evidence();
  value.verification.status = 'failed';
  value.verification.blockingGate = 'audit';
  value.verification.observations[4]!.status = 'failed';
  expect(() => parseRuntimeCandidateEvidence(value)).toThrow();
});
it('accepts honest early infrastructure stops without fabricating earlier passes', () => {
  const value = evidence();
  value.verification.status = 'infra-stop';
  value.verification.blockingGate = 'challenges';
  value.verification.observations.forEach(observation => {
    observation.status = observation.gate === 'reproduction' ? 'passed' : observation.gate === 'challenges' ? 'infra-stop' : 'not-run';
    observation.reasons = observation.status === 'not-run' ? ['not-executed'] : [];
  });
  expect(parseRuntimeCandidateEvidence(value)).toEqual(value);
});

it('requires a bound complete baseline and candidate repetition set for challenge assurance', () => {
  const value = evidence();
  value.setHash = 'b'.repeat(64);
  value.verification.challengeMode = 'required';
  value.verification.challengeAssurance = true;
  value.verification.observations[5] = { gate: 'challenges', status: 'passed', reasons: [], artifacts: [{ id: 'challenge-set', sha256: value.setHash }] };
  value.subjects = (['baseline', 'candidate'] as const).flatMap(subject => [1, 2].map(repetition => ({ challengeId: 'probe', subject, repetition, status: subject === 'baseline' ? 'failed' as const : 'passed' as const, observationSha256: 'c'.repeat(64), reasonCode: 'observed' })));
  expect(parseRuntimeCandidateEvidence(value)).toEqual(value);
  expect(() => parseRuntimeCandidateEvidence({ ...value, subjects: value.subjects.slice(1) })).toThrow();
  value.subjects[3]!.status = 'failed';
  expect(() => parseRuntimeCandidateEvidence(value)).toThrow();
});
