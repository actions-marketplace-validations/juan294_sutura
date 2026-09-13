import { describe, expect, it } from 'vitest';
import { grantedRecovery } from './recovery.test-helper.js';
import { parseDiagnosisRecoveryEvidence } from './recovery.js';

const evidence = {
  schemaVersion: 'sutura-diagnosis-recovery-v1', status: 'not-run', reason: 'no-supported-recovery-signal',
  initialClass: 'typecheck', observedCommand: 'pnpm typecheck', executedCommand: 'pnpm typecheck', authorizations: [],
  hypotheses: [{ id: 'hypothesis-1', class: 'typecheck', intent: 'repair-source', path: null, sourceSha256: null, signal: 'initial-diagnosis', probeId: null, status: 'not-run', reason: 'initial-diagnosis-retained', probeOutputSha256: null }],
};
describe('public recovery evidence', () => {
  it('preserves absent investigation and initial diagnosis without inventing a grant', () => {
    expect(parseDiagnosisRecoveryEvidence(evidence)).toEqual(evidence);
  });
  it.each([
    { ...evidence, approved: true },
    { ...evidence, schemaVersion: 'unversioned' },
    { ...evidence, status: 'passed' },
    { ...evidence, hypotheses: Array(4).fill(evidence.hypotheses[0]) },
    { ...evidence, authorizations: [{ approved: true }] },
    { ...evidence, observedCommand: 'Authorization: Bearer private' },
    { ...evidence, hypotheses: [{ ...evidence.hypotheses[0], status: 'passed' }] },
  ])('rejects incoherent or fabricated serialized proof %j', (value) => {
    expect(() => parseDiagnosisRecoveryEvidence(value)).toThrow(/recovery/iu);
  });
});

describe('recovery cross bindings', () => {
  it('preserves real proof and observation hashes with different envelopes', () => {
    expect(parseDiagnosisRecoveryEvidence(grantedRecovery())).toEqual(grantedRecovery());
  });
  it('rejects duplicated grants masking an unmatched passed hypothesis', () => {
    const value = grantedRecovery();
    value.hypotheses.push({ ...value.hypotheses[1]!, id: 'hypothesis-3', path: 'test/other.test.ts' });
    value.authorizations.push(structuredClone(value.authorizations[0]!));
    expect(() => parseDiagnosisRecoveryEvidence(value)).toThrow(/recovery/i);
  });
  it('binds the alternative class to its controller intent', () => {
    const value = grantedRecovery(); value.hypotheses[1]!.class = 'env-config';
    expect(() => parseDiagnosisRecoveryEvidence(value)).toThrow(/recovery/i);
  });
});

it('rejects grants from a different trusted policy, source, snapshot or initial diagnosis', () => {
  for (const expected of [{ policySha256: 'f'.repeat(64) }, { sourceSha: 'f'.repeat(40) }, { snapshotSha256: null }, { policyBaseSha: 'f'.repeat(40) }, { initialClass: 'env-config' }, { observedCommand: 'another command' }]) {
    expect(() => parseDiagnosisRecoveryEvidence(grantedRecovery(), expected)).toThrow(/recovery/i);
  }
});
it('rejects grants for two distinct baselines in a single investigation', () => {
  const value = grantedRecovery();
  value.hypotheses.push({ ...value.hypotheses[1]!, id: 'hypothesis-3', path: 'test/other.test.ts' });
  value.authorizations.push({ ...structuredClone(value.authorizations[0]!), path: 'test/other.test.ts' });
  value.authorizations[1]!.baseline.baselineImageId = 'different-baseline';
  expect(() => parseDiagnosisRecoveryEvidence(value)).toThrow(/recovery/i);
});
