/**
 * The executed verification route.
 *
 * A real Git checkout supplies the identity and the trusted policy; an
 * in-memory sandbox supplies the execution. What is asserted is that the run
 * executes the immutable copy, reaches a verdict from real observations, and
 * writes nothing back.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { InMemoryExecutor, type HealLlm, type InMemoryRunResult } from '@sutura/core';
import { afterEach, describe, expect, it } from 'vitest';

import type { VerifyArguments } from './args.js';
import { executeVerify } from './verify.js';

const exec = promisify(execFile);
const llm = { modelQuote: () => ({ price: { input: 0.1, output: 0.1 } }), chat: async () => ({ text: '{"approved":true,"reasoning":"Correct"}', usd: 0.0001 }) } as unknown as HealLlm;
const cleanups: Array<() => Promise<void>> = [];

const DIFF = [
  'diff --git a/page-count.js b/page-count.js',
  '--- a/page-count.js',
  '+++ b/page-count.js',
  '@@ -1 +1 @@',
  '-export const pages = (n, per) => Math.floor(n / per);',
  '+export const pages = (n, per) => Math.ceil(n / per);',
  '',
].join('\n');

async function checkout(): Promise<{ dir: string; sha: string; diffPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'sutura-verify-execute-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  await exec('git', ['init', '--quiet', dir]);
  await exec('git', ['-C', dir, 'config', 'user.email', 'test@example.invalid']);
  await exec('git', ['-C', dir, 'config', 'user.name', 'Test']);
  await writeFile(join(dir, 'page-count.js'), 'export const pages = (n, per) => Math.floor(n / per);\n');
  await writeFile(join(dir, '.sutura.json'), JSON.stringify({ version: 1, requiredCommands: ['pnpm test'] }));
  await mkdir(join(dir, '.sutura-controller'), { recursive: true });
  await writeFile(join(dir, '.sutura-controller/frozen.json'), '{"expected":3}');
  await exec('git', ['-C', dir, 'add', '--all']);
  await exec('git', ['-C', dir, 'commit', '--quiet', '-m', 'baseline']);
  const sha = (await exec('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim();

  const patches = await mkdtemp(join(tmpdir(), 'sutura-verify-patch-'));
  cleanups.push(() => rm(patches, { recursive: true, force: true }));
  const diffPath = join(patches, 'candidate.diff');
  await writeFile(diffPath, DIFF);
  return { dir, sha, diffPath };
}

function args(dir: string, sha: string, diffPath: string): VerifyArguments {
  return {
    command: 'verify',
    caseDir: dir,
    sourceSha: sha,
    policyBaseSha: sha,
    candidateDiff: diffPath,
    failingCommand: 'diagnosed',
    format: 'json',
  } as VerifyArguments;
}

function result(exitCode: number, stdout = ''): InMemoryRunResult {
  return { exitCode, stdout, stderr: '', truncated: false, metrics: {} };
}

/** The failing command fails on the baseline and passes once the patch is applied. */
function repairingSandbox(command: string): InMemoryExecutor {
  let observed = 0;
  return new InMemoryExecutor((cmd) => {
    if (cmd !== command) return result(0);
    observed += 1;
    return result(observed <= 2 ? 1 : 0, 'AssertionError: expected 3');
  });
}

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

describe('executeVerify', () => {
  it('executes an immutable copy of the declared source and reports what it observed', async () => {
    const { dir, sha, diffPath } = await checkout();
    const executor = repairingSandbox('pnpm test');

    const outcome = await executeVerify(args(dir, sha, diffPath), { executor, llm });

    expect(outcome.source.sourceSha).toBe(sha);
    expect(outcome.source.snapshotSha256).toMatch(/^[a-f0-9]{64}$/u);
    // Controller storage never reaches the copy that executes.
    expect(outcome.source.files).toBe(2);
    expect(outcome.policySource).toBe('repository');
    expect(outcome.request.failingCommand).toBe('pnpm test');
    expect(outcome.reproduction).toBe('reproduced');
    expect(outcome.generatedReplacement).toBe(false);
    expect(outcome.evidence.mode).toBe('local');
    expect(JSON.parse(outcome.verificationArtifact.bytes)).toEqual(outcome.evidence);

    const status = new Map(outcome.observations.map((item) => [item.gate, item.status]));
    expect(status.get('reproduction')).toBe('passed');
    expect(status.get('visible')).toBe('passed');
    expect(status.get('audit')).toBe('passed');
    expect(outcome.status).toBe('insufficient');
    expect(outcome.blockingGate).toBe('challenges');
  }, 60_000);

  it('removes the temporary copy whether the run succeeds or fails', async () => {
    const { dir, sha, diffPath } = await checkout();
    const executor = repairingSandbox('pnpm test');

    await executeVerify(args(dir, sha, diffPath), { executor, llm });
    const snapshots = executor.calls.filter((call) => call.kind === 'snapshot');

    expect(snapshots.length).toBeGreaterThan(0);
    for (const call of snapshots) {
      expect(call.dir).not.toBe(dir);
      await expect(exec('test', ['-e', call.dir])).rejects.toThrow();
    }
  }, 60_000);

  it('refuses before executing anything when the checkout is not the declared source', async () => {
    const { dir, sha, diffPath } = await checkout();
    await writeFile(join(dir, 'page-count.js'), 'export const pages = () => 0;\n');
    const executor = repairingSandbox('pnpm test');

    await expect(executeVerify(args(dir, sha, diffPath), { executor, llm }))
      .rejects.toThrow(/tracked or untracked changes/u);
    expect(executor.calls).toHaveLength(0);
  }, 60_000);

  it('reports a baseline that never failed instead of crediting the patch', async () => {
    const { dir, sha, diffPath } = await checkout();
    const executor = new InMemoryExecutor(() => result(0));

    const outcome = await executeVerify(args(dir, sha, diffPath), { executor, llm });

    expect(outcome.reproduction).toBe('baseline-passes');
    expect(outcome.status).toBe('insufficient');
    expect(outcome.blockingGate).toBe('reproduction');
  }, 60_000);
});
