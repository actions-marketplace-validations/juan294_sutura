import { describe, expect, it } from 'vitest';

import {
  buildChallengeGenerationPrompt,
  CHALLENGE_REPETITIONS,
  CHALLENGE_SET_VERSION,
  ChallengeGenerationError,
  FORBIDDEN_CHALLENGE_CONTEXT_KEYS,
  freezeChallengeSet,
  MAX_RETAINED_CHALLENGES,
  type ChallengeGenerationContext,
} from './generate.js';
import type { VerificationPolicy } from './contracts.js';

const policy: VerificationPolicy = {
  mode: 'required',
  contracts: [
    {
      id: 'page-count-ceiling',
      kind: 'callable-example',
      target: { adapter: 'javascript', path: 'page-count.js', export: 'pageCount' },
      examples: [{ args: [20, 10], expected: 2 }],
    },
  ] as unknown as VerificationPolicy['contracts'],
};

const context: ChallengeGenerationContext = {
  failureExcerpt: 'expected 3 to be 2',
  baselineSources: [{ path: 'page-count.js', startLine: 1, content: 'export function pageCount() {}\n' }],
  contractExcerpts: [{ contractId: 'page-count-ceiling', path: '.sutura.json', excerpt: '{"id":"page-count-ceiling"}' }],
  baselineSnapshotHash: 'a'.repeat(64),
  trustedPolicySha: 'b'.repeat(64),
};

function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ceiling-preserved',
    kind: 'preservation',
    contractRefs: [{ path: '.sutura.json', sha256: 'c'.repeat(64), startLine: 1, endLine: 4 }],
    rationale: 'An exact page boundary must stay at two pages.',
    probeId: 'page-count',
    inputs: [20, 10],
    contractId: 'page-count-ceiling',
    relationId: 'equals',
    ...overrides,
  };
}

function freeze(proposals: readonly unknown[]) {
  return freezeChallengeSet({
    proposals,
    policy,
    baselineSnapshotHash: context.baselineSnapshotHash,
    trustedPolicySha: context.trustedPolicySha,
    contextHash: 'd'.repeat(64),
    promptHash: 'e'.repeat(64),
  });
}

describe('challenge generation prompt', () => {
  it('carries only baseline failure, source and contract evidence', () => {
    const { messages } = buildChallengeGenerationPrompt(context);
    const user = JSON.parse(String(messages[1]!.content)) as Record<string, unknown>;

    expect(Object.keys(user).toSorted())
      .toEqual(['baselineSources', 'contractExcerpts', 'failureExcerpt']);
    expect(JSON.stringify(user)).not.toContain('diff --git');
  });

  it('tells the generator it cannot supply expectations, source or commands', () => {
    const system = String(buildChallengeGenerationPrompt(context).messages[0]!.content);

    expect(system).toContain('cannot supply an expected value');
    expect(system).toContain('Expected values come from the trusted policy');
    expect(system).toContain('A citation does not establish semantics');
  });

  it.each(FORBIDDEN_CHALLENGE_CONTEXT_KEYS)('refuses a context carrying %s', (key) => {
    const leaked = { ...context, [key]: 'leaked' } as unknown as ChallengeGenerationContext;

    expect(() => buildChallengeGenerationPrompt(leaked)).toThrow(ChallengeGenerationError);
    expect(() => buildChallengeGenerationPrompt(leaked)).toThrow(/must not reach/u);
  });

  it('refuses a forbidden key nested inside supplied evidence', () => {
    const leaked = {
      ...context,
      baselineSources: [{ path: 'a.js', startLine: 1, content: 'x', transcript: 'secret' }],
    } as unknown as ChallengeGenerationContext;

    expect(() => buildChallengeGenerationPrompt(leaked)).toThrow(/transcript must not reach/u);
  });

  it('hashes context and prompt reproducibly and distinctly', () => {
    const first = buildChallengeGenerationPrompt(context);
    const second = buildChallengeGenerationPrompt(context);
    const other = buildChallengeGenerationPrompt({ ...context, failureExcerpt: 'different' });

    expect(first.contextHash).toBe(second.contextHash);
    expect(first.promptHash).toBe(second.promptHash);
    expect(first.contextHash).not.toBe(first.promptHash);
    expect(other.contextHash).not.toBe(first.contextHash);
  });
});

describe('frozen challenge set', () => {
  it('freezes a valid proposal with a reproducible set hash', () => {
    const frozen = freeze([proposal()]);

    expect(frozen.version).toBe(CHALLENGE_SET_VERSION);
    expect(frozen.challenges).toHaveLength(1);
    expect(frozen.excluded).toEqual([]);
    expect(frozen.setHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(freeze([proposal()]).setHash).toBe(frozen.setHash);
  });

  it('changes the set hash when any frozen field changes', () => {
    const base = freeze([proposal()]);
    const other = freeze([proposal({ inputs: [30, 10] })]);

    expect(other.setHash).not.toBe(base.setHash);
  });

  it('excludes a proposal naming a contract the trusted policy does not declare', () => {
    const frozen = freeze([proposal({ contractId: 'invented-contract' })]);

    expect(frozen.challenges).toEqual([]);
    expect(frozen.excluded).toEqual([{ id: 'ceiling-preserved', reasonCode: 'untrusted-contract' }]);
  });

  it.each([
    ['an expected override', { expected: 4 }, 'unsupported-field'],
    ['test source', { source: 'assert(1)' }, 'unsupported-field'],
    ['a shell command', { command: 'rm -rf /' }, 'unsupported-field'],
    ['an unknown kind', { kind: 'vibes' }, 'invalid-kind'],
    ['an unbounded input list', { inputs: Array.from({ length: 9 }, (_v, i) => i) }, 'invalid-inputs'],
    ['a malformed id', { id: 'Not An Id' }, 'invalid-id'],
    ['no contract reference', { contractRefs: [] }, 'invalid-contract-refs'],
    ['a bad reference hash', { contractRefs: [{ path: 'a', sha256: 'nope', startLine: 1, endLine: 2 }] }, 'invalid-contract-refs'],
  ])('excludes a proposal carrying %s', (_name, overrides, reasonCode) => {
    const frozen = freeze([proposal(overrides)]);

    expect(frozen.challenges).toEqual([]);
    expect(frozen.excluded[0]?.reasonCode).toBe(reasonCode);
  });

  it('retains at most three challenges and records the rest', () => {
    const frozen = freeze(Array.from({ length: 5 }, (_value, index) =>
      proposal({ id: `challenge-${index}` })));

    expect(frozen.challenges).toHaveLength(MAX_RETAINED_CHALLENGES);
    expect(frozen.excluded).toEqual([
      { id: 'challenge-3', reasonCode: 'retention-limit' },
      { id: 'challenge-4', reasonCode: 'retention-limit' },
    ]);
  });

  it('excludes a duplicate identifier instead of retaining it twice', () => {
    const frozen = freeze([proposal(), proposal()]);

    expect(frozen.challenges).toHaveLength(1);
    expect(frozen.excluded).toEqual([{ id: 'ceiling-preserved', reasonCode: 'duplicate-id' }]);
  });

  it('binds the baseline snapshot and trusted policy it was frozen against', () => {
    const frozen = freeze([proposal()]);

    expect(frozen.baselineSnapshotHash).toBe(context.baselineSnapshotHash);
    expect(frozen.trustedPolicySha).toBe(context.trustedPolicySha);
  });

  it('declares two repetitions per retained challenge', () => {
    expect(CHALLENGE_REPETITIONS).toBe(2);
  });
});
