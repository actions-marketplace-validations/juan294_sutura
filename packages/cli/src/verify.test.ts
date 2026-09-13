import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CliUsageError, parseArgs, type VerifyArguments } from './args.js';
import {
  MAX_CANDIDATE_DIFF_FILE_BYTES,
  prepareVerify,
  readCandidateDiffFile,
  VerifyInputError,
  verifyRuntimeFromEnvironment,
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

let root: string;
let diffPath: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'sutura-verify-'));
  diffPath = join(root, 'candidate.diff');
  await writeFile(diffPath, DIFF);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function argv(overrides: Record<string, string> = {}): string[] {
  const values: Record<string, string> = {
    '--case-dir': '/tmp/checkout',
    '--source-sha': SOURCE_SHA,
    '--policy-base-sha': POLICY_SHA,
    '--candidate-diff': '/tmp/candidate.diff',
    '--failing-command': 'diagnosed',
    '--format': 'json',
    ...overrides,
  };
  return ['verify', ...Object.entries(values).flat()];
}

describe('verify argument parsing', () => {
  it('parses a complete verification request', () => {
    expect(parseArgs(argv())).toEqual({
      command: 'verify',
      caseDir: '/tmp/checkout',
      sourceSha: SOURCE_SHA,
      policyBaseSha: POLICY_SHA,
      candidateDiff: '/tmp/candidate.diff',
      failingCommand: 'diagnosed',
      format: 'json',
    });
  });

  it.each([
    '--case-dir', '--source-sha', '--policy-base-sha', '--candidate-diff', '--failing-command', '--format',
  ])('requires %s', (flag) => {
    const args = argv();
    const index = args.indexOf(flag);

    expect(() => parseArgs([...args.slice(0, index), ...args.slice(index + 2)]))
      .toThrow(new RegExp(`${flag} is required`, 'u'));
  });

  it.each([
    ['a short sha', 'abc1234'],
    ['an uppercase sha', 'A'.repeat(40)],
    ['a branch name', 'main'],
    ['a 41-character value', 'a'.repeat(41)],
  ])('refuses %s as an identity', (_name, value) => {
    expect(() => parseArgs(argv({ '--source-sha': value })))
      .toThrow(/must be an exact lowercase 40-character commit/u);
    expect(() => parseArgs(argv({ '--policy-base-sha': value })))
      .toThrow(/must be an exact lowercase 40-character commit/u);
  });

  it('refuses an unknown, duplicated or non-json argument', () => {
    expect(() => parseArgs([...argv(), '--publish', 'true'])).toThrow(CliUsageError);
    expect(() => parseArgs([...argv(), '--case-dir', '/other'])).toThrow(/Duplicate argument/u);
    expect(() => parseArgs(argv({ '--format': 'yaml' }))).toThrow(/--format must be json/u);
  });

  it('accepts the supported runtimes and treats auto as unset', () => {
    expect((parseArgs([...argv(), '--runtime', 'node']) as VerifyArguments).runtime).toBe('node');
    expect((parseArgs([...argv(), '--runtime', 'python']) as VerifyArguments).runtime).toBe('python');
    expect((parseArgs([...argv(), '--runtime', 'auto']) as VerifyArguments).runtime).toBeUndefined();
    expect(() => parseArgs([...argv(), '--runtime', 'ruby'])).toThrow(/--runtime must be/u);
  });

  it('documents verify in the usage text', async () => {
    const { USAGE } = await import('./args.js');

    expect(USAGE).toContain('sutura verify');
    expect(USAGE).toContain('--policy-base-sha');
  });
});

describe('candidate diff file reading', () => {
  it('reads a regular file exactly once', async () => {
    expect(await readCandidateDiffFile(diffPath)).toBe(DIFF);
  });

  it('refuses a path that cannot be opened', async () => {
    await expect(readCandidateDiffFile(join(root, 'missing.diff')))
      .rejects.toThrow(VerifyInputError);
  });

  it('refuses a directory', async () => {
    await expect(readCandidateDiffFile(root)).rejects.toThrow(/regular file/u);
  });

  it('refuses a file beyond the read bound', async () => {
    const big = join(root, 'big.diff');
    await writeFile(big, 'x'.repeat(MAX_CANDIDATE_DIFF_FILE_BYTES + 1));

    await expect(readCandidateDiffFile(big)).rejects.toThrow(/at most/u);
  });

  it('does not follow a symbolic link to somewhere else', async () => {
    const secret = join(root, 'secret.diff');
    const link = join(root, 'link.diff');
    await writeFile(secret, DIFF);
    await symlink(secret, link);

    await expect(readCandidateDiffFile(link)).rejects.toThrow(/symbolic link/u);
  });
});

describe('verify preparation', () => {
  let repo: string;
  let repoSha: string;

  beforeAll(async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.invalid',
    };
    repo = join(root, 'repo');
    await exec('git', ['init', '-q', '-b', 'main', repo], { env });
    await writeFile(join(repo, 'page-count.js'), 'const a = 1;\n');
    await writeFile(join(repo, '.sutura.json'), JSON.stringify({
      version: 1, requiredCommands: ['pnpm test'],
    }));
    await exec('git', ['-C', repo, 'add', '-A'], { env });
    await exec('git', ['-C', repo, 'commit', '-qm', 'base'], { env });
    repoSha = (await exec('git', ['-C', repo, 'rev-parse', 'HEAD'], { env })).stdout.trim();
  }, 60_000);

  const base = (): VerifyArguments => ({
    command: 'verify',
    caseDir: repo,
    sourceSha: repoSha,
    policyBaseSha: repoSha,
    candidateDiff: diffPath,
    failingCommand: 'diagnosed',
    format: 'json',
  });

  it('reads the trusted policy from the chosen commit and validates the patch', async () => {
    const prepared = await prepareVerify(base());

    expect(prepared.policySource).toBe('repository');
    expect(prepared.trustedCommands).toEqual({ diagnosed: 'pnpm test' });
    expect(prepared.request).toMatchObject({
      sourceSha: repoSha, failingCommand: 'pnpm test', changedFiles: ['page-count.js'],
    });
  });

  it('refuses a checkout that is not the declared source', async () => {
    await expect(prepareVerify({ ...base(), sourceSha: 'd'.repeat(40) }))
      .rejects.toThrow(/not the declared source/u);
  });

  it('refuses a failing command the trusted policy did not declare', async () => {
    await expect(prepareVerify({ ...base(), failingCommand: 'rm -rf /' }))
      .rejects.toThrow(/is not trusted/u);
  });

  it('refuses a patch that reaches the trusted policy declaration', async () => {
    const policyPatch = join(root, 'policy.diff');
    await writeFile(policyPatch, DIFF.replaceAll('page-count.js', '.sutura.json'));

    await expect(prepareVerify({ ...base(), candidateDiff: policyPatch }))
      .rejects.toThrow(/trusted policy declaration/u);
  });

  it('refuses a patch that is not a complete unified diff', async () => {
    const garbage = join(root, 'garbage.diff');
    await writeFile(garbage, 'this is not a diff\n');

    await expect(prepareVerify({ ...base(), candidateDiff: garbage }))
      .rejects.toThrow(/complete unified diff/u);
  });
});

it('labels environment-backed execution as live',()=>{
 expect(verifyRuntimeFromEnvironment({CONTREE_TOKEN:'test',CONTREE_PROJECT:'test',NEBIUS_API_KEY:'test'}).mode).toBe('live');
});
