import { describe, expect, it } from 'vitest';

import { createDefaultRepositoryPolicy } from '../policy/load.js';
import type { ChallengeProposal } from './generate.js';
import {
  MAX_CHALLENGE_INPUT_BYTES,
  SUPPORTED_RELATIONS,
  TAUTOLOGICAL_RELATIONS,
  validateChallengeProposal,
  type ChallengeValidationContext,
} from './validate.js';

const SOURCE_SHA = 'a'.repeat(64);
const policy = createDefaultRepositoryPolicy();

function context(overrides: Partial<ChallengeValidationContext> = {}): ChallengeValidationContext {
  return {
    policy,
    sourceHashes: new Map([['.sutura.json', SOURCE_SHA], ['src/page-count.js', SOURCE_SHA]]),
    trustedContractIds: new Set(['page-count-ceiling']),
    ...overrides,
  };
}

function proposal(overrides: Partial<ChallengeProposal> = {}): ChallengeProposal {
  return {
    id: 'ceiling-preserved',
    kind: 'preservation',
    contractRefs: [{ path: '.sutura.json', sha256: SOURCE_SHA, startLine: 1, endLine: 4 }],
    rationale: 'the boundary stays at two pages',
    probeId: 'page-count',
    inputs: [20, 10],
    contractId: 'page-count-ceiling',
    relationId: 'equals',
    ...overrides,
  };
}

function reasonFor(
  overrides: Partial<ChallengeProposal>,
  contextOverrides: Partial<ChallengeValidationContext> = {},
): string {
  const result = validateChallengeProposal(proposal(overrides), context(contextOverrides));
  return result.ok ? 'accepted' : result.reasonCode;
}

describe('challenge proposal validation', () => {
  it('accepts a proposal the controller can evaluate from what it already trusts', () => {
    expect(validateChallengeProposal(proposal(), context())).toEqual({ ok: true });
  });

  it.each(SUPPORTED_RELATIONS)('accepts the supported relation %s', (relationId) => {
    expect(reasonFor({ relationId })).toBe('accepted');
  });

  it.each([
    ['an absolute target', { contractRefs: [{ path: '/etc/passwd', sha256: SOURCE_SHA, startLine: 1, endLine: 1 }] }, 'absolute-target'],
    ['a Windows absolute target', { contractRefs: [{ path: 'C:\\secrets', sha256: SOURCE_SHA, startLine: 1, endLine: 1 }] }, 'absolute-target'],
    ['a traversal target', { contractRefs: [{ path: '../outside.json', sha256: SOURCE_SHA, startLine: 1, endLine: 1 }] }, 'traversal-target'],
    ['a nested traversal target', { contractRefs: [{ path: 'src/../../escape.json', sha256: SOURCE_SHA, startLine: 1, endLine: 1 }] }, 'traversal-target'],
    ['an evaluator-private target', { contractRefs: [{ path: 'hidden/answers.json', sha256: SOURCE_SHA, startLine: 1, endLine: 1 }] }, 'reserved-target'],
    ['a controller-private target', { contractRefs: [{ path: '.sutura-controller/frozen.json', sha256: SOURCE_SHA, startLine: 1, endLine: 1 }] }, 'reserved-target'],
    ['a credential target', { contractRefs: [{ path: 'deploy/id_rsa', sha256: SOURCE_SHA, startLine: 1, endLine: 1 }] }, 'reserved-target'],
  ])('rejects %s', (_name, overrides, reasonCode) => {
    expect(reasonFor(overrides)).toBe(reasonCode);
  });

  it('rejects a target that resolves through a symbolic link', () => {
    expect(reasonFor({}, { symlinkPaths: new Set(['.sutura.json']) })).toBe('symlink-target');
  });

  it('rejects a source the repository policy denies reading', () => {
    expect(reasonFor({}, {
      policy: { ...policy, deniedReadPaths: [...policy.deniedReadPaths, '.sutura.json'] },
    })).toBe('denied-source');
  });

  it('rejects a reference whose hash does not match the controller baseline', () => {
    expect(reasonFor({
      contractRefs: [{ path: '.sutura.json', sha256: 'b'.repeat(64), startLine: 1, endLine: 4 }],
    })).toBe('source-hash-mismatch');
  });

  it('rejects a reference to a path the controller never read', () => {
    expect(reasonFor({
      contractRefs: [{ path: 'src/unknown.js', sha256: SOURCE_SHA, startLine: 1, endLine: 4 }],
    })).toBe('source-hash-mismatch');
  });

  it('rejects inputs beyond the bounded size', () => {
    const huge = ['x'.repeat(MAX_CHALLENGE_INPUT_BYTES + 1)];

    expect(reasonFor({ inputs: huge })).toBe('oversized-inputs');
  });

  it('rejects an input that is not a bounded typed value', () => {
    expect(reasonFor({ inputs: [() => 1] })).toBe('executable-override');
    expect(reasonFor({ inputs: [undefined] })).toBe('executable-override');
    expect(reasonFor({ inputs: [Symbol('x')] })).toBe('executable-override');
  });

  it.each(TAUTOLOGICAL_RELATIONS)('rejects the tautological relation %s', (relationId) => {
    expect(reasonFor({ relationId })).toBe('tautological-relation');
  });

  it('rejects an unknown relation rather than interpreting it', () => {
    expect(reasonFor({ relationId: 'roughly-matches' })).toBe('unknown-relation');
  });

  it('rejects a contract the trusted policy does not declare', () => {
    expect(reasonFor({ contractId: 'invented' })).toBe('unknown-contract');
    expect(reasonFor({}, { trustedContractIds: new Set() })).toBe('unknown-contract');
  });

  it('checks the trusted contract before anything a proposal can influence', () => {
    const result = validateChallengeProposal(
      proposal({ contractId: 'invented', relationId: 'roughly-matches' }), context(),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reasonCode).toBe('unknown-contract');
  });
});
