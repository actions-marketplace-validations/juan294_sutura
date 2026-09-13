import { describe, expect, it, vi } from 'vitest';

import {
  evaluateVerification,
  VERIFICATION_GATE_ORDER,
  verificationApproved,
  type OrderedVerificationGate,
  type SharedVerificationRequest,
  type VerificationGateResult,
  type VerificationGateRunner,
} from './evaluate.js';

const ALL_PASS: VerificationGateRunner = () => ({ status: 'passed' });

function request(overrides: Partial<SharedVerificationRequest> = {}): SharedVerificationRequest {
  return { challengeMode: 'optional', runGate: ALL_PASS, ...overrides };
}

function refuseAt(
  gate: OrderedVerificationGate,
  result: VerificationGateResult,
): SharedVerificationRequest['runGate'] {
  return (current) => (current === gate ? result : { status: 'passed' });
}

function statuses(observations: Array<{ gate: string; status: string }>): Record<string, string> {
  return Object.fromEntries(observations.map(({ gate, status }) => [gate, status]));
}

describe('shared verification evaluator', () => {
  it('walks the production gate order and records every gate', async () => {
    const outcome = await evaluateVerification(request());

    expect(outcome.observations.map(({ gate }) => gate)).toEqual([...VERIFICATION_GATE_ORDER]);
    expect(outcome.status).toBe('passed');
    expect(outcome.blockingGate).toBeNull();
    expect(verificationApproved(outcome)).toBe(true);
  });

  it('places the counterfactual record outside the candidate gate stack', () => {
    expect([...VERIFICATION_GATE_ORDER]).not.toContain('counterfactual');
    expect(VERIFICATION_GATE_ORDER.indexOf('reproduction'))
      .toBeLessThan(VERIFICATION_GATE_ORDER.indexOf('policy'));
    expect(VERIFICATION_GATE_ORDER.indexOf('visible'))
      .toBeLessThan(VERIFICATION_GATE_ORDER.indexOf('audit'));
    expect(VERIFICATION_GATE_ORDER.indexOf('challenges'))
      .toBeLessThan(VERIFICATION_GATE_ORDER.indexOf('adjudication'));
  });

  it.each(VERIFICATION_GATE_ORDER)('names %s as the first blocking gate', async (gate) => {
    const outcome = await evaluateVerification(request({
      runGate: refuseAt(gate, { status: 'failed', reasons: ['assertion-failed'] }),
    }));

    expect(outcome.status).toBe('failed');
    expect(outcome.blockingGate).toBe(gate);
    expect(verificationApproved(outcome)).toBe(false);
  });

  it('keeps every later gate as an explicit not-run record after a refusal', async () => {
    const outcome = await evaluateVerification(request({
      runGate: refuseAt('mechanical', { status: 'failed', reasons: ['policy-denied'] }),
    }));

    const after = outcome.observations.slice(
      VERIFICATION_GATE_ORDER.indexOf('mechanical') + 1,
    );
    expect(after).not.toHaveLength(0);
    for (const item of after) {
      expect(item.status).toBe('not-run');
      expect(item.reasons).toEqual(['not-executed']);
    }
    expect(outcome.observations).toHaveLength(VERIFICATION_GATE_ORDER.length);
  });

  it('stops running gates once one refuses', async () => {
    const runGate = vi.fn(refuseAt('policy', { status: 'failed', reasons: ['policy-denied'] }));
    await evaluateVerification(request({ runGate }));

    expect(runGate.mock.calls.map((call) => call[0])).toEqual(['reproduction', 'policy']);
  });

  it.each(['insufficient', 'infra-stop'] as const)('treats %s as terminal', async (status) => {
    const outcome = await evaluateVerification(request({
      runGate: refuseAt('audit', { status, reasons: ['provider-error'] }),
    }));

    expect(outcome.status).toBe(status);
    expect(outcome.blockingGate).toBe('audit');
    expect(verificationApproved(outcome)).toBe(false);
  });

  it('records an unsupported gate with its reason and keeps going', async () => {
    const outcome = await evaluateVerification(request({
      unsupportedGates: { adjudication: 'provider-error', 'repository-policy': 'missing-contract' },
    }));

    const byGate = statuses(outcome.observations);
    expect(byGate.adjudication).toBe('not-run');
    expect(byGate['repository-policy']).toBe('not-run');
    expect(byGate.resources).toBe('passed');
    expect(outcome.status).toBe('passed');
    expect(outcome.observations.find(({ gate }) => gate === 'adjudication')?.reasons)
      .toEqual(['provider-error']);
  });

  it('never runs a gate the subject declared unsupported', async () => {
    const runGate = vi.fn<VerificationGateRunner>(ALL_PASS);
    await evaluateVerification(request({
      runGate, unsupportedGates: { challenges: 'not-executed', adjudication: 'not-executed' },
    }));

    const called = runGate.mock.calls.map((call) => call[0]);
    expect(called).not.toContain('challenges');
    expect(called).not.toContain('adjudication');
  });

  it('does not run challenges when the mode disables them', async () => {
    const runGate = vi.fn<VerificationGateRunner>(ALL_PASS);
    const outcome = await evaluateVerification(request({ challengeMode: 'disabled', runGate }));

    expect(runGate.mock.calls.map((call) => call[0])).not.toContain('challenges');
    expect(outcome.challengeAssurance).toBe(false);
    expect(outcome.status).toBe('passed');
  });

  it('refuses to approve required mode without qualified challenge assurance', async () => {
    const skipped = await evaluateVerification(request({
      challengeMode: 'required',
      unsupportedGates: { challenges: 'missing-contract' },
    }));
    const notRun = await evaluateVerification(request({
      challengeMode: 'required',
      runGate: refuseAt('challenges', { status: 'not-run', reasons: ['invalid-probe'] }),
    }));

    for (const outcome of [skipped, notRun]) {
      expect(outcome.status).toBe('insufficient');
      expect(outcome.blockingGate).toBe('challenges');
      expect(outcome.challengeAssurance).toBe(false);
      expect(verificationApproved(outcome)).toBe(false);
    }
  });

  it('approves required mode only when the challenge gate itself passed', async () => {
    const outcome = await evaluateVerification(request({ challengeMode: 'required' }));

    expect(outcome.challengeAssurance).toBe(true);
    expect(outcome.status).toBe('passed');
    expect(verificationApproved(outcome)).toBe(true);
  });

  it('keeps optional-mode assurance visible without blocking approval', async () => {
    const outcome = await evaluateVerification(request({
      challengeMode: 'optional',
      unsupportedGates: { challenges: 'unsupported-contract' },
    }));

    expect(outcome.status).toBe('passed');
    expect(outcome.challengeAssurance).toBe(false);
    expect(verificationApproved(outcome)).toBe(true);
  });

  it('produces identical observations for the same subject through any adapter', async () => {
    const runGate = refuseAt('visible', { status: 'failed', reasons: ['command-failed'] });
    const [repair, supplied, counterfactual] = await Promise.all([
      evaluateVerification(request({ runGate })),
      evaluateVerification(request({ runGate })),
      evaluateVerification(request({ runGate })),
    ]);

    expect(supplied).toEqual(repair);
    expect(counterfactual).toEqual(repair);
  });
});
