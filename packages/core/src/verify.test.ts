import { describe, expect, it } from 'vitest';

import { createDefaultRepositoryPolicy } from './policy/load.js';
import {
  validateVerifyRequest,
  verifyExternalPatch,
  VerifyRequestError,
  VERIFY_RESERVED_PATHS,
  type VerifyRequest,
} from './verify.js';
import type { VerificationGateRunner } from './verification/evaluate.js';

const policy = createDefaultRepositoryPolicy();
const trustedCommands = { diagnosed: 'pnpm test' };
const SHA = 'a'.repeat(40);
const POLICY_SHA = 'b'.repeat(40);

function diffFor(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1 +1 @@',
    '-const a = 1;',
    '+const a = 2;',
    '',
  ].join('\n');
}

function request(overrides: Partial<VerifyRequest> = {}): VerifyRequest {
  return {
    caseDir: '/tmp/checkout',
    sourceSha: SHA,
    policyBaseSha: POLICY_SHA,
    candidateDiff: diffFor('src/page-count.js'),
    failureCommandId: 'diagnosed',
    ...overrides,
  };
}

const allPass: VerificationGateRunner = () => ({ status: 'passed' });

function validate(overrides: Partial<VerifyRequest> = {}) {
  return validateVerifyRequest(request(overrides), policy, trustedCommands);
}

describe('external verification request', () => {
  it('accepts an exact identity, trusted command and bounded patch', () => {
    const validated = validate();

    expect(validated).toMatchObject({
      sourceSha: SHA,
      policyBaseSha: POLICY_SHA,
      failingCommand: 'pnpm test',
      runtimeId: 'auto',
      changedFiles: ['src/page-count.js'],
    });
    expect(validated.diffBytes).toBeGreaterThan(0);
  });

  it.each([
    ['a short source sha', { sourceSha: 'abc1234' }, 'invalid-source-sha'],
    ['an uppercase source sha', { sourceSha: 'A'.repeat(40) }, 'invalid-source-sha'],
    ['a branch name as policy base', { policyBaseSha: 'main' }, 'invalid-policy-base-sha'],
    ['no checkout directory', { caseDir: '   ' }, 'invalid-case-dir'],
  ])('refuses %s', (_name, overrides, reasonCode) => {
    expect(() => validate(overrides)).toThrow(VerifyRequestError);
    try {
      validate(overrides);
    } catch (error) {
      expect((error as VerifyRequestError).reasonCode).toBe(reasonCode);
    }
  });

  it('refuses a failing command the operator did not trust', () => {
    expect(() => validate({ failureCommandId: 'rm -rf /' }))
      .toThrow(/is not trusted/u);
    expect(() => validateVerifyRequest(request(), policy, {}))
      .toThrow(/is not trusted/u);
  });

  it('refuses a command that is merely printable text', () => {
    expect(() => validateVerifyRequest(
      request({ failureCommandId: 'diagnosed' }), policy, { diagnosed: '   ' },
    )).toThrow(/is not trusted/u);
  });

  it('refuses a patch that changes the trusted policy declaration', () => {
    for (const path of VERIFY_RESERVED_PATHS) {
      expect(() => validate({ candidateDiff: diffFor(path) }))
        .toThrow(/may not change the trusted policy declaration/u);
    }
  });

  it.each([
    '.sutura-controller/expectations.json',
    'hidden/test_secret.py',
    '.sutura/challenges/set.json',
    '.env',
    'deploy/id_rsa',
  ])('refuses a patch reaching the reserved or sensitive path %s', (path) => {
    expect(() => validate({ candidateDiff: diffFor(path) })).toThrow(VerifyRequestError);
  });

  it('refuses an empty, unparsable or oversized patch', () => {
    expect(() => validate({ candidateDiff: '   ' })).toThrow(/non-empty candidate diff/u);
    expect(() => validate({ candidateDiff: 'not a diff' })).toThrow(/complete unified diff/u);
    expect(() => validateVerifyRequest(request(), { ...policy, maxDiffBytes: 8 }, trustedCommands))
      .toThrow(/policy permits/u);
  });

  it('applies the transaction file cap to a supplied patch', () => {
    const threeFiles = ['a.js', 'b.js', 'c.js'].map(diffFor).join('');

    expect(() => validate({ candidateDiff: threeFiles }))
      .toThrow(/at most 2 are permitted/u);
  });

  it('refuses a path the repository policy denies', () => {
    expect(() => validateVerifyRequest(
      request(), { ...policy, protectedPaths: [...policy.protectedPaths, 'src/**'] }, trustedCommands,
    )).toThrow(/denies changes to/u);
  });

  it('refuses an unsupported runtime and accepts the supported ones', () => {
    expect(() => validate({ runtimeId: 'ruby' as never })).toThrow(/Unsupported runtime/u);
    expect(validate({ runtimeId: 'node' }).runtimeId).toBe('node');
    expect(validate({ runtimeId: 'python' }).runtimeId).toBe('python');
  });
});

describe('external patch verification', () => {
  it('verifies a supplied patch without generating a replacement', async () => {
    const result = await verifyExternalPatch(request(), policy, trustedCommands, { runGate: allPass });

    expect(result.status).toBe('verified-supplied-patch');
    expect(result.generatedReplacement).toBe(false);
    expect(result.verification.challengeMode).toBe('required');
    expect(result.verification.challengeAssurance).toBe(true);
  });

  it('requires challenge assurance by default rather than the visible suite alone', async () => {
    const result = await verifyExternalPatch(request(), policy, trustedCommands, {
      runGate: (gate) => (gate === 'challenges'
        ? { status: 'not-run', reasons: ['missing-contract'] }
        : { status: 'passed' }),
    });

    expect(result.status).toBe('insufficient');
    expect(result.verification.blockingGate).toBe('challenges');
    expect(result.generatedReplacement).toBe(false);
  });

  it('refuses a patch that fails any gate and names the blocking one', async () => {
    const result = await verifyExternalPatch(request(), policy, trustedCommands, {
      runGate: (gate) => (gate === 'visible'
        ? { status: 'failed', reasons: ['command-failed'] }
        : { status: 'passed' }),
    });

    expect(result.status).toBe('refused');
    expect(result.verification.blockingGate).toBe('visible');
  });

  it('reports an infrastructure stop distinctly from a refusal', async () => {
    const result = await verifyExternalPatch(request(), policy, trustedCommands, {
      runGate: (gate) => (gate === 'reproduction'
        ? { status: 'infra-stop', reasons: ['provider-error'] }
        : { status: 'passed' }),
    });

    expect(result.status).toBe('infra-stop');
  });

  it('walks the same ordered gate stack a generated repair walks', async () => {
    const result = await verifyExternalPatch(request(), policy, trustedCommands, { runGate: allPass });

    expect(result.verification.observations.map(({ gate }) => gate)).toEqual([
      'reproduction', 'policy', 'mechanical', 'visible',
      'audit', 'challenges', 'adjudication', 'repository-policy', 'resources',
    ]);
  });

  it('validates trust inputs before running any gate', async () => {
    let ran = false;
    await expect(verifyExternalPatch(request({ sourceSha: 'bad' }), policy, trustedCommands, {
      runGate: () => { ran = true; return { status: 'passed' }; },
    })).rejects.toThrow(VerifyRequestError);

    expect(ran).toBe(false);
  });
});
