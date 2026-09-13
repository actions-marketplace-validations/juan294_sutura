import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { candidateIdentity, type VerificationEvidence } from '@sutura/core';
import { caseFileCost } from './replay.js';
import { renderResultBody } from './render.js';
import { caseLabCase } from './cases.js';
import { createCaseLabResult, validateCaseLabCaseFile, type CaseLabCaseFile, type CaseLabResultBase } from './result.js';

function historical(): CaseLabCaseFile {
  const data = JSON.parse(readFileSync(new URL('../../../docs/demo/placebo-v0.2-live-2026-09.json', import.meta.url), 'utf8'));
  return data.results.find((item: { caseId: string }) => item.caseId === 'repair-off-by-one').caseFile;
}
function evidence(): VerificationEvidence {
  const hash = 'a'.repeat(64);
  return {
    schemaVersion: 'sutura-verification-evidence-v1', mode: 'local', outcome: 'repaired', assurance: 'baseline-only',
    identity: { sourceSha: 'a'.repeat(40), snapshotSha256: hash, policyBaseSha: 'b'.repeat(40), policySha256: hash, diffSha256: hash, corpusRevision: null, fixtureRevision: null, imageDigest: `sha256:${hash}`, routingVersion: 'fixed-v1', challengeVersion: 'protocol-v1' },
    startedAt: '2026-09-05T10:00:00.000Z', finishedAt: '2026-09-05T10:00:01.000Z', commands: ['pnpm test'], models: [],
    challenges: { mode: 'optional', qualifiedProbeCount: 0 },
    gates: [
      ...(['policy', 'visible', 'audit'] as const).map((gate) => ({ gate, status: 'passed' as const, reasons: [], artifacts: [{ id: `${gate}-run`, sha256: hash }] })),
      { gate: 'challenges', status: 'not-run', reasons: ['not-executed'], artifacts: [] },
    ],
    costs: { schemaVersion: 'sutura-verification-cost-v1', inference: [], sandbox: null, wallTimeMs: 1000 },
  };
}

describe('Case Lab verification evidence extension', () => {
  it('preserves absent challenge evidence on historical case files', () => {
    expect(validateCaseLabCaseFile(historical(), 'fixed')).not.toHaveProperty('verification');
  });
  it('rejects invented verification approval in an otherwise valid historical record', () => {
    expect(() => validateCaseLabCaseFile({ ...historical(), verification: { approved: true } }, 'fixed')).toThrow(/verification/u);
  });
  it('retains valid evidence bound to the same policy and whole diff', () => {
    const verification = evidence();
    const selectedCandidate = candidateIdentity(historical().race[0]!.candidate);
    verification.identity.diffSha256 = selectedCandidate.diffHash;
    const file = { ...historical(), policy: { baseRef: 'trusted', baseSha: verification.identity.policyBaseSha!, policySha: verification.identity.policySha256 }, selectedCandidate, verification };
    expect(validateCaseLabCaseFile(file, 'fixed')).toHaveProperty('verification', verification);
    expect(() => validateCaseLabCaseFile({ ...file, selectedCandidate: undefined }, 'fixed')).toThrow(/verification.*candidate/u);
    const changed = structuredClone(file); changed.race[0]!.candidate.diff += '\n';
    expect(() => validateCaseLabCaseFile(changed, 'fixed')).toThrow(/verification.*diff/u);
    const shadow = structuredClone(file);
    shadow.race.unshift({ ...structuredClone(shadow.race[0]!), held: false, candidate: { ...shadow.race[0]!.candidate, diff: 'different displayed patch' } });
    expect(() => validateCaseLabCaseFile(shadow, 'fixed')).toThrow(/verification.*duplicate/u);
    const alternate = { ...file, counterfactual: { acceptedCandidateId: 'another-patch', alternatives: [], cost: { inferenceUsd: 0, sandboxOperations: 0, elapsedTimeSec: 0 } } };
    expect(() => validateCaseLabCaseFile(alternate, 'fixed')).toThrow(/verification.*counterfactual/u);
    expect(() => validateCaseLabCaseFile({ ...file, policy: historical().policy }, 'fixed')).toThrow(/verification.*policy/u);
    expect(() => validateCaseLabCaseFile({ ...file, selectedCandidate: { id: 'control', diffHash: 'b'.repeat(64) } }, 'fixed')).toThrow(/verification.*diff/u);
    expect(() => validateCaseLabCaseFile({ ...file, verification: { ...verification, outcome: 'refused' } }, 'fixed')).toThrow(/verification.*outcome/u);
  });
});


describe('typed cost and source presentation', () => {
  function base(): CaseLabResultBase {
    const verification = evidence();
    const selectedCandidate = candidateIdentity(historical().race[0]!.candidate);
    verification.identity.diffSha256 = selectedCandidate.diffHash;
    verification.costs.sandbox = [{ operationId: 'probe', rawAmount: 5, rawUnit: null, unitSource: null, billed: null }];
    return {
      schemaVersion: 'sutura-case-lab-result-v1', requestId: 'cl-1788198872643-48b5c5d4', caseId: 'javascript-repair', mode: 'live',
      release: { version: '0.2.0', actionSha: 'c'.repeat(40) }, identity: { controllerSha: 'c'.repeat(40), demoSha: verification.identity.sourceSha! },
      outcome: 'fixed', expectedOutcome: 'fixed', matchesExpectation: true, links: {}, createdAt: verification.finishedAt,
      caseFile: { ...historical(), selectedCandidate, verification, policy: { baseRef: 'trusted', baseSha: verification.identity.policyBaseSha!, policySha: verification.identity.policySha256 } },
      cost: { inferenceUsd: 0, sandboxUsd: null, status: 'partial' },
    };
  }
  it('binds the verified source to the displayed source identity', () => {
    const value = base();
    expect(createCaseLabResult(value).identity.demoSha).toBe(value.caseFile!.verification!.identity.sourceSha);
    expect(() => createCaseLabResult({ ...value, identity: { ...value.identity, demoSha: 'd'.repeat(40) } })).toThrow(/verification.*source/u);
    expect(() => createCaseLabResult({ ...value, identity: { controllerSha: value.identity.controllerSha } })).toThrow(/verification.*source/u);
  });
  it('preserves raw unknown amounts without converting them to dollars or zero', () => {
    const value = base();
    expect(caseFileCost(value.caseFile!)).toEqual(value.cost);
    const result = createCaseLabResult(value);
    expect(result.cost.sandboxUsd).toBeNull();
    const html = renderResultBody(result, caseLabCase(result.caseId));
    expect(html).toContain('5 (unit unconfirmed)');
    expect(html).not.toContain('USD 5.000000');
    expect(() => createCaseLabResult({ ...value, cost: { inferenceUsd: 0, sandboxUsd: 5, status: 'observed' } })).toThrow(/cost/u);
    expect(() => createCaseLabResult({ ...value, cost: { inferenceUsd: 0, sandboxUsd: 0, status: 'observed' } })).toThrow(/cost/u);
  });
});

describe('Case Lab recovery binding', () => {
  function recovery() {
    const diagnosis = historical().diagnosis;
    return { schemaVersion: 'sutura-diagnosis-recovery-v1', status: 'not-run', reason: 'no-supported-recovery-signal', initialClass: diagnosis.class, observedCommand: diagnosis.failingCmd, executedCommand: diagnosis.failingCmd, authorizations: [], hypotheses: [{ id: 'hypothesis-1', class: diagnosis.class, intent: 'repair-source', path: null, sourceSha256: null, signal: 'initial-diagnosis', probeId: null, status: 'not-run', reason: 'initial-diagnosis-retained', probeOutputSha256: null }] };
  }
  it('retains bounded recovery and rejects diagnosis or command substitution', () => {
    const file = { ...historical(), recovery: recovery() };
    expect(validateCaseLabCaseFile(file, 'fixed')).toHaveProperty('recovery', file.recovery);
    expect(() => validateCaseLabCaseFile({ ...file, recovery: { ...file.recovery, observedCommand: 'another command' } }, 'fixed')).toThrow(/recovery/i);
    expect(() => validateCaseLabCaseFile({ ...file, recovery: { approved: true } }, 'fixed')).toThrow(/recovery/i);
  });
});

it('preserves bounded counterfactual exhaustion and rejects incoherent status metadata', () => {
  const counterfactual = { status: 'insufficient', reason: 'budget-exhausted', alternatives: [], cost: { inferenceUsd: 0, sandboxOperations: 0, elapsedTimeSec: 0 } };
  expect(validateCaseLabCaseFile({ ...historical(), counterfactual }, 'fixed')).toHaveProperty('counterfactual', counterfactual);
  expect(() => validateCaseLabCaseFile({ ...historical(), counterfactual: { ...counterfactual, status: 'complete' } }, 'fixed')).toThrow(/counterfactual/i);
});
