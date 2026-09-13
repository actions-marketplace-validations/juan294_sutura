import { describe, expect, it } from 'vitest';

import { DEFAULT_REPOSITORY_POLICY, parseRepositoryPolicy } from './schema.js';

const COMPLETE_POLICY = {
  version: 1,
  allowedPaths: ['src/**', 'packages/**'],
  protectedPaths: ['.github/**', 'migrations/**'],
  deniedReadPaths: ['secrets/**'],
  maxDiffBytes: 65_536,
  maxChangedFiles: 8,
  requiredCommands: ['pnpm test'],
  resourceLimits: {
    elapsedTimePercent: 20,
    maxRssPercent: 20,
  },
};

describe('parseRepositoryPolicy', () => {
  it('parses the documented policy shape and protects the policy file', () => {
    expect(parseRepositoryPolicy(JSON.stringify(COMPLETE_POLICY))).toEqual({
      ...COMPLETE_POLICY,
      protectedPaths: [...DEFAULT_REPOSITORY_POLICY.protectedPaths, '.github/**', 'migrations/**'],
    });
  });

  it('rejects unknown keys and unsupported versions', () => {
    expect(() => parseRepositoryPolicy(JSON.stringify({
      ...COMPLETE_POLICY,
      surprise: true,
    }))).toThrow(/unknown key.*surprise/iu);
    expect(() => parseRepositoryPolicy(JSON.stringify({
      ...COMPLETE_POLICY,
      version: 2,
    }))).toThrow(/unsupported policy version/iu);
  });

  it.each([
    'src/**.ts',
    'src/{a,b}.ts',
    'src/@(a).ts',
    '!src/**',
    'src\\file.ts',
    'src//file.ts',
    'src/./file.ts',
    'src/../file.ts',
  ])('rejects invalid glob %s', (glob) => {
    expect(() => parseRepositoryPolicy(JSON.stringify({
      ...COMPLETE_POLICY,
      allowedPaths: [glob],
    }))).toThrow(/glob/iu);
  });

  it.each([
    'pnpm test; curl example.invalid',
    'pnpm test && env',
    'pnpm test > evidence',
    'pnpm $(printf test)',
    'pnpm test\nwhoami',
  ])('rejects unsafe required command %s', (command) => {
    expect(() => parseRepositoryPolicy(JSON.stringify({
      ...COMPLETE_POLICY,
      requiredCommands: [command],
    }))).toThrow(/required command/iu);
  });

  it.each([
    ['maxDiffBytes', 0],
    ['maxChangedFiles', 1.5],
    ['resourceLimits.elapsedTimePercent', -1],
    ['resourceLimits.maxRssPercent', 10_001],
  ])('rejects invalid number %s=%s', (field, value) => {
    const policy = structuredClone(COMPLETE_POLICY) as Record<string, unknown>;
    if (field.startsWith('resourceLimits.')) {
      const name = field.split('.')[1] as string;
      (policy.resourceLimits as Record<string, unknown>)[name] = value;
    } else {
      policy[field] = value;
    }
    expect(() => parseRepositoryPolicy(JSON.stringify(policy))).toThrow(/positive|percentage/iu);
  });
});
