import { describe, expect, it } from 'vitest';

import type { RunMetrics } from '../executor/types.js';
import {
  evaluatePatchPolicy,
  evaluateResourceThresholds,
  filterPolicyDeniedText,
  isPolicyPathMatched,
  policyAllowsSourceRead,
  policyAllowsPatchPath,
} from './evaluate.js';
import { parseRepositoryPolicy } from './schema.js';

const POLICY = parseRepositoryPolicy(JSON.stringify({
  version: 1,
  allowedPaths: ['src/**'],
  protectedPaths: ['src/protected/**'],
  deniedReadPaths: ['src/private/**'],
  maxDiffBytes: 2_000,
  maxChangedFiles: 2,
  requiredCommands: ['pnpm test'],
  resourceLimits: {
    elapsedTimePercent: 20,
    maxRssPercent: 20,
  },
}));

function diff(path: string, body = '+export const value = 1;'): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -0,0 +1 @@',
    body,
  ].join('\n') + '\n';
}

describe('policy glob matching', () => {
  it.each([
    ['src/**', 'src/index.ts', true],
    ['src/**', 'src/nested/index.ts', true],
    ['src/*.ts', 'src/index.ts', true],
    ['src/*.ts', 'src/nested/index.ts', false],
    ['src/?.ts', 'src/a.ts', true],
    ['src/?.ts', 'src/ab.ts', false],
  ])('%s matches %s = %s', (glob, path, expected) => {
    expect(isPolicyPathMatched(glob, path)).toBe(expected);
  });
});

describe('evaluatePatchPolicy', () => {
  it('accepts an allowed bounded source change', () => {
    expect(evaluatePatchPolicy(diff('src/index.ts'), POLICY)).toEqual({
      ok: true,
      violations: [],
    });
  });

  it.each([
    ['.sutura.json', 'protected path'],
    ['src/protected/key.ts', 'protected path'],
    ['docs/readme.md', 'disallowed path'],
  ])('refuses %s as a %s before execution', (path, violation) => {
    expect(evaluatePatchPolicy(diff(path), POLICY).violations.join('\n'))
      .toContain(violation);
  });

  it('applies changed-file and byte limits', () => {
    const tooMany = [diff('src/a.ts'), diff('src/b.ts'), diff('src/c.ts')].join('');
    expect(evaluatePatchPolicy(tooMany, POLICY).violations).toContain(
      'changes 3 files; policy permits at most 2',
    );
    expect(evaluatePatchPolicy(diff('src/a.ts', `+${'x'.repeat(2_100)}`), POLICY)
      .violations.join('\n')).toMatch(/diff.*bytes/iu);
  });
});

describe('policyAllowsSourceRead', () => {
  it('keeps denied paths away from source readers', () => {
    expect(policyAllowsSourceRead('src/private/token.ts', POLICY)).toBe(false);
    expect(policyAllowsSourceRead('src/public/index.ts', POLICY)).toBe(true);
  });

  it('removes the complete log line for a denied repository path', () => {
    const filtered = filterPolicyDeniedText(
      'src/private/token.ts:1 supersecret\nsrc/public/index.ts:2 safe',
      POLICY,
    );

    expect(filtered).toBe(
      '[policy-denied repository context]\nsrc/public/index.ts:2 safe',
    );
  });

  it.each([
    '/home/runner/work/acme/acme/src/private/token.ts:1 supersecret',
    'file:///workspace/src/private/token.ts:1 supersecret',
    '/workspace/src/private/token.ts:1 supersecret',
    'a/src/private/token.ts:1 supersecret',
  ])('normalizes denied path form %s', (line) => {
    expect(filterPolicyDeniedText(line, POLICY))
      .toBe('[policy-denied repository context]');
  });

  it('supports a denied repository path containing a space', () => {
    const policy = parseRepositoryPolicy(JSON.stringify({
      version: 1,
      deniedReadPaths: ['src/private data/**'],
    }));
    expect(filterPolicyDeniedText(
      '/workspace/src/private data/token.ts:1 supersecret',
      policy,
    )).toBe('[policy-denied repository context]');
  });

  it.each(['private.ts:1 root-secret', './private.ts:1 root-secret'])(
    'filters denied root source location %s',
    (line) => {
      const policy = parseRepositoryPolicy(JSON.stringify({
        version: 1,
        deniedReadPaths: ['private.ts'],
      }));
      expect(filterPolicyDeniedText(line, policy))
        .toBe('[policy-denied repository context]');
    },
  );
});

describe('evaluateResourceThresholds', () => {
  const baseline: RunMetrics = { elapsedTimeSec: 10, maxRssKb: 100 };

  it('compares paired metrics for the same command', () => {
    expect(evaluateResourceThresholds('pnpm test', baseline, {
      elapsedTimeSec: 12,
      maxRssKb: 120,
    }, POLICY.resourceLimits)).toEqual([]);
    expect(evaluateResourceThresholds('pnpm test', baseline, {
      elapsedTimeSec: 12.1,
      maxRssKb: 121,
    }, POLICY.resourceLimits).join('\n')).toMatch(/elapsed time|max RSS/iu);
  });

  it.each([
    [{ maxRssKb: 100 }, { elapsedTimeSec: 10, maxRssKb: 100 }],
    [{ elapsedTimeSec: 0, maxRssKb: 100 }, { elapsedTimeSec: 1, maxRssKb: 100 }],
    [{ elapsedTimeSec: 10, maxRssKb: 100 }, { maxRssKb: 100 }],
  ] as const)('fails closed for missing or zero configured metrics', (before, after) => {
    expect(evaluateResourceThresholds('pnpm test', before, after, POLICY.resourceLimits))
      .not.toEqual([]);
  });
});


describe('controller authority paths', () => {
  it.each(['.sutura-controller/frozen.json', '.sutura-evaluator/answers.json', '.sutura/challenges/result.json', 'hidden/expected.json'])('cannot grant read or write authority to %s', (path) => {
    const policy = { ...POLICY, allowedPaths: ['**'], protectedPaths: [], deniedReadPaths: [] };
    expect(policyAllowsSourceRead(path, policy)).toBe(false);
    expect(policyAllowsPatchPath(path, policy)).toBe(false);
    expect(evaluatePatchPolicy(diff(path), policy).ok).toBe(false);
  });
});
