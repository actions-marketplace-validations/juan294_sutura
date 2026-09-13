import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';
import type { CaseFile } from '@sutura/core';

import { checkAnnotations, checkConclusion, checkExternalId, MAX_CHECK_ANNOTATIONS } from './checks.js';

const execFileAsync = promisify(execFile);

async function foreignGitEnvironment(): Promise<NodeJS.ProcessEnv> {
  const environment = { ...process.env };
  const localVariables = (await execFileAsync(
    'git',
    ['rev-parse', '--local-env-vars'],
  )).stdout.trim().split('\n').filter(Boolean);
  for (const name of localVariables) delete environment[name];
  return environment;
}

function caseFile(excerpt: string, outcome: CaseFile['outcome'] = 'fixed'): CaseFile {
  return {
    runId: '123', repo: 'acme/widget', runtime: 'node', outcome,
    diagnosis: { class: 'typecheck', confidence: 1, signals: [], failingCmd: 'pnpm test', errorExcerpt: excerpt },
    triage: { status: 'real', reproduced: 1, of: 1, attemptsUsed: 1, maximumAttempts: 1, reproductionProbability: 1, confidenceLower: 1, confidenceUpper: 1, stopReason: 'failure-boundary', methodVersion: 'sprt-p20-p80-a05-b05-v1' },
    race: [], cost: { entries: [], totalUsd: () => 0 }, policy: { baseRef: 'develop', baseSha: 'a'.repeat(40), policySha: 'default' }, stages: [],
  };
}

describe('GitHub check helpers', () => {
  it('uses a stable repository and workflow run external id', () => {
    expect(checkExternalId('acme/widget', '123')).toBe('sutura:acme/widget:workflow-run:123');
  });

  it.each([
    ['fixed', 'neutral'], ['flaky-no-patch', 'neutral'], ['refused', 'action_required'],
    ['gave-up', 'action_required'], ['infra-stop', 'action_required'],
  ] as const)('maps %s to %s', (outcome, conclusion) => {
    expect(checkConclusion(outcome)).toBe(conclusion);
  });

  it('passes only bounded regular paths from the exact checkout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-check-'));
    const outside = await mkdtemp(join(tmpdir(), 'sutura-check-outside-'));
    try {
      await mkdir(join(directory, 'src'));
      await writeFile(join(directory, 'src', 'good.ts'), 'export {};\n');
      await Promise.all(Array.from({ length: 55 }, (_, index) =>
        writeFile(join(directory, 'src', `file-${index}.ts`), 'export {};\n'),
      ));
      const gitOptions = { cwd: directory, env: await foreignGitEnvironment() };
      await execFileAsync('git', ['init', '--quiet'], gitOptions);
      await execFileAsync('git', ['add', 'src'], gitOptions);
      await execFileAsync('git', [
        '-c', 'user.name=Test',
        '-c', 'user.email=test@example.test',
        'commit', '--quiet', '-m', 'fixture',
      ], gitOptions);
      const headSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], gitOptions)).stdout.trim();
      await writeFile(join(outside, 'secret.ts'), 'secret\n');
      await symlink(join(outside, 'secret.ts'), join(directory, 'src', 'linked.ts'));
      await writeFile(join(directory, 'src', 'untracked.ts'), 'untracked\n');
      const refs = [
        'src/good.ts:1', 'src/file-0.ts:999', 'src/missing.ts:2', 'src/linked.ts:1',
        'src/untracked.ts:1', '.git/config:1', '../outside.ts:1',
        ...Array.from({ length: 55 }, (_, index) => `src/file-${index}.ts:1`),
      ].join('\n');
      const annotations = await checkAnnotations(directory, headSha, caseFile(refs));
      expect(annotations).toHaveLength(MAX_CHECK_ANNOTATIONS);
      expect(annotations.map(({ path }) => path)).not.toContain('src/linked.ts');
      expect(annotations.map(({ path }) => path)).not.toContain('src/missing.ts');
      expect(annotations.map(({ path }) => path)).not.toContain('src/untracked.ts');
      expect(annotations.map(({ path }) => path)).not.toContain('.git/config');
      expect(annotations).not.toContainEqual(expect.objectContaining({ path: 'src/file-0.ts', startLine: 999 }));
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  }, 15_000);
});
import { execFile } from 'node:child_process';
