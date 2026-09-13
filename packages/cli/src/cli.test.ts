import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  completedTriageVerdict,
  createCompleteReplayBundleForTest,
  notRunTriageVerdict,
  type AuditFile,
  type CaseFile,
} from '@sutura/core';

import { runCli } from './cli.js';

function fixed(): CaseFile {
  return {
    runId: 'case-1',
    repo: 'placebo/case',
    runtime: 'node',
    diagnosis: {
      class: 'test-assertion', confidence: 1, signals: [],
      failingCmd: 'pnpm test', errorExcerpt: 'failed',
    },
    triage: completedTriageVerdict([1, 1, 1, 1], 5),
    race: [],
    audit: { approved: true, checks: [], reasoning: 'approved' },
    outcome: 'fixed',
    cost: { entries: [], totalUsd: () => 0 },
    policy: { baseRef: 'local', baseSha: 'local', policySha: 'default' },
    stages: [],
  };
}

describe('runCli', () => {
  it('replays a complete bundle offline and prints matching CaseFile JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-cli-complete-replay-'));
    const bundlePath = join(directory, 'bundle.json');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const network = vi.fn(async () => { throw new Error('live network must not run'); });
    vi.stubGlobal('fetch', network);
    vi.stubEnv('CONTREE_TOKEN', '');
    vi.stubEnv('CONTREE_PROJECT', '');
    try {
      const bundle = await createCompleteReplayBundleForTest();
      expect(bundle.completeness).toEqual({
        complete: true,
        overflowedBoundaries: [],
        pendingBoundaries: [],
      });
      expect(bundle.executor.length).toBeGreaterThan(0);
      await writeFile(bundlePath, JSON.stringify(bundle));

      const exitCode = await runCli([
        'replay', '--bundle', bundlePath, '--format', 'json',
      ], {
        write: (value) => stdout.push(value),
        writeError: (value) => stderr.push(value),
      });

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(JSON.parse(stdout.join(''))).toMatchObject({
        runId: bundle.runId,
        outcome: bundle.outcome,
      });
      expect(network).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('exits 1 when a real replay disagrees with a tampered recorded outcome', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-cli-tampered-replay-'));
    const bundlePath = join(directory, 'bundle.json');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const network = vi.fn(async () => { throw new Error('live network must not run'); });
    vi.stubGlobal('fetch', network);
    vi.stubEnv('CONTREE_TOKEN', '');
    vi.stubEnv('CONTREE_PROJECT', '');
    try {
      const bundle = await createCompleteReplayBundleForTest();
      const replayedOutcome = bundle.outcome;
      bundle.outcome = replayedOutcome === 'gave-up' ? 'flaky-no-patch' : 'gave-up';
      await writeFile(bundlePath, JSON.stringify(bundle));

      const exitCode = await runCli([
        'replay', '--bundle', bundlePath, '--format', 'json',
      ], {
        write: (value) => stdout.push(value),
        writeError: (value) => stderr.push(value),
      });

      expect(exitCode).toBe(1);
      expect(stdout).toEqual([]);
      expect(stderr.join('')).toContain(
        `recorded ${bundle.outcome}, replayed ${String(replayedOutcome)}`,
      );
      expect(network).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('prints only reduced-assurance AuditFile JSON', async () => {
    const stdout: string[] = [];
    const auditFile = {
      assurance: 'reduced', outcome: 'audit-refused',
      diagnosis: { before: fixed().diagnosis, after: fixed().diagnosis },
      policy: fixed().policy,
      audit: { approved: false, checks: [], reasoning: 'refused' },
      cost: { entries: [], totalUsd: () => 0 },
    } satisfies AuditFile;
    const audit = vi.fn().mockResolvedValue(auditFile);
    const exitCode = await runCli([
      'audit', '--case-dir', '/tmp/case', '--candidate-diff', '/tmp/fix.diff',
      '--before-log', '/tmp/before.log', '--after-log', '/tmp/after.log', '--format', 'json',
    ], { write: (value) => stdout.push(value) }, { audit });
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(''))).toMatchObject({ assurance: 'reduced', outcome: 'audit-refused' });
    expect(stdout.join('')).not.toMatch(/fixed|verified|flaky-no-patch/u);
  });

  it('prints only valid CaseFile JSON on stdout', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const heal = vi.fn().mockResolvedValue(fixed());

    const exitCode = await runCli(
      ['heal', '--case-dir', '/tmp/case', '--format', 'json', '--no-tavily'],
      { write: (value) => stdout.push(value), writeError: (value) => stderr.push(value) },
      { heal },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(''))).toMatchObject({ outcome: 'fixed', cost: { entries: [] } });
    expect(heal).toHaveBeenCalledWith(expect.objectContaining({ caseDir: '/tmp/case', tavilyEnabled: false }));
  });

  it('returns usage errors on stderr without starting a heal', async () => {
    const stderr: string[] = [];
    const heal = vi.fn();
    const exitCode = await runCli(['heal', '--case-dir', '/tmp/case'], {
      writeError: (value) => stderr.push(value),
    }, { heal });

    expect(exitCode).toBe(2);
    expect(stderr.join('')).toContain('sutura heal --case-dir');
    expect(heal).not.toHaveBeenCalled();
  });

  it('fails closed as infra-stop JSON when runtime configuration or ConTree fails', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const heal = vi.fn().mockRejectedValue(
      new Error('CONTREE_TOKEN is required; token=private Bearer abc123'),
    );

    const exitCode = await runCli(
      ['heal', '--case-dir', '/tmp/case', '--format', 'json'],
      { write: (value) => stdout.push(value), writeError: (value) => stderr.push(value) },
      { heal },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      outcome: 'infra-stop',
      diagnosis: { class: 'infra', errorExcerpt: expect.stringContaining('CONTREE_TOKEN is required') },
      triage: notRunTriageVerdict(),
    });
    expect(stdout.join('')).not.toContain('private');
    expect(stdout.join('')).not.toContain('abc123');
  });

  it('retains the terminal provider error and removes signed URLs before bounding diagnostics', async () => {
    const stdout: string[] = [];
    // Captured run 34312341360: repeated Docker redirects exhausted the old
    // first-2,000-character excerpt before the importer terminal cause.
    const redirect = 'https://production.cloudfront.docker.com/layer?Expires=123&Signature=private-signature&Key-Pair-Id=private-key';
    const reason = `ConTree operation ended with FAILED: Import instance failed with exit code 1\n${`INFO Following redirect to ${redirect}\n`.repeat(40)}ERROR HTTP 502 Bad Gateway`;
    await runCli(
      ['heal', '--case-dir', '/tmp/case', '--format', 'json'],
      { write: (value) => stdout.push(value) },
      { heal: vi.fn().mockRejectedValue(new Error(reason)) },
    );
    const result = JSON.parse(stdout.join(''));
    expect(result.diagnosis.errorExcerpt).toMatch(/^ConTree operation ended with FAILED/u);
    expect(result.diagnosis.errorExcerpt).toContain('ERROR HTTP 502 Bad Gateway');
    expect(result.diagnosis.errorExcerpt.length).toBeLessThanOrEqual(2_000);
    expect(result.diagnosis.errorExcerpt).toContain('[truncated]');
    expect(stdout.join('')).not.toContain('private-signature');
    expect(stdout.join('')).not.toContain('private-key');
    expect(result.stages[0].note).not.toContain('before provider execution');
  });

  it('reports an auto-detected Python runtime when local healing fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-cli-python-failure-'));
    const stdout: string[] = [];
    try {
      await writeFile(join(directory, 'pyproject.toml'), '[project]\nname = "fixture"\n');
      await writeFile(join(directory, 'uv.lock'), 'version = 1\n');
      const heal = vi.fn().mockRejectedValue(new Error('sandbox failed'));

      await runCli(
        ['heal', '--case-dir', directory, '--format', 'json'],
        { write: (value) => stdout.push(value) },
        { heal },
      );

      expect(JSON.parse(stdout.join(''))).toMatchObject({
        outcome: 'infra-stop',
        runtime: 'python',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('executed verification exit status', () => {
  const argv = ['verify', '--case-dir', '/tmp/source', '--source-sha', 'a'.repeat(40), '--policy-base-sha', 'b'.repeat(40), '--candidate-diff', '/tmp/change.diff', '--failing-command', 'diagnosed', '--format', 'json'];
  for (const status of ['refused', 'insufficient', 'infra-stop']) {
    it(`returns nonzero for ${status} and preserves the result`, async () => {
      const output: string[] = [];
      const exit = await runCli(argv, { write: text => output.push(text) }, { verify: async () => ({ status }) });
      expect(exit).toBe(1);
      expect(JSON.parse(output.join('')).status).toBe(status);
    });
  }
  it('returns zero only for a verified supplied patch', async () => {
    expect(await runCli(argv, { write: () => {} }, { verify: async () => ({ status: 'verified-supplied-patch' }) })).toBe(0);
  });
});
