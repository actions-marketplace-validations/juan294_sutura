import { discoverBenchmarkCases } from './corpus.js';
import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';

import { DummyAdapter, RefuseAllAdapter } from './adapters.js';
import { DEFAULT_ROUTING_PROFILE_ID, completedTriageVerdict } from '@sutura/core';
import { runBenchmark } from './harness.js';
import type { Adapter, CaseFile } from './types.js';

function approved(grounded = false): CaseFile {
  return {
    runId: 'recording', repo: 'placebo/case',
    runtime: 'node',
    diagnosis: {
      class: 'test-assertion', confidence: 1, signals: [], failingCmd: 'pnpm test', errorExcerpt: 'failed',
      ...(grounded ? { grounding: { query: 'release', skipped: false, citations: [{ title: 'Release', url: 'https://example.test/release', snippet: 'breaking change' }] } } : {}),
    },
    triage: completedTriageVerdict([1, 1, 1, 1], 5), race: [],
    audit: { approved: true, checks: [], reasoning: 'approved' }, outcome: 'fixed',
    cost: { entries: [], totalUsd: () => 0 },
    policy: { baseRef: 'local', baseSha: 'local', policySha: 'default' },
    stages: [],
  };
}

describe('runBenchmark', { timeout: 120_000 }, () => {
  it('runs the full corpus against an approve-everything control and disqualifies unavailable hidden checks', async () => {
    const report = await runBenchmark(new DummyAdapter());

    expect(report.score.catchRate).toEqual({ refused: 0, of: 19 });
    expect(report.score.fixRate).toMatchObject({ fixed: 14, of: 18 });
    expect(report.score.fixRate.failures).toHaveLength(4);
    expect(report.score.hiddenRepairPreservation).toEqual({ passed: 0, of: 4, notRun: 4 });
    expect(report.results).toHaveLength(55);
  }, 300_000);

  it('shows the refuse-all control cannot score repairs', async () => {
    const report = await runBenchmark(new RefuseAllAdapter());

    expect(report.score.catchRate).toEqual({ refused: 19, of: 19 });
    expect(report.score.fixRate).toMatchObject({ fixed: 0, of: 18 });
  }, 300_000);

  it.each([
    ['python-repair-missing-await', "python3 -B -m unittest discover -s tests -p 'test_*.py'"],
    ['repair-off-by-one', 'pnpm test'],
  ])('hands %s the visible suite command its hidden verification runs', async (caseId, expected) => {
    const commands: Array<string | undefined> = [];
    const adapter: Adapter = {
      name: 'recording',
      async heal(_directory, context) {
        commands.push(context?.failingCommand);
        return approved();
      },
    };

    await runBenchmark(adapter, { caseId });

    expect(commands).toEqual([expected]);
  });

  it('selects one exact canonical case before adapter or runtime work', async () => {
    const heal = vi.fn(async () => approved());
    const adapter: Adapter = { name: 'recording', heal };
    const report = await runBenchmark(adapter, { caseId: 'repair-off-by-one' });

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.caseId).toBe('repair-off-by-one');
    expect(heal).toHaveBeenCalledOnce();

    heal.mockClear();
    await expect(runBenchmark(adapter, { caseId: 'unknown-case' })).rejects.toThrow(/Unknown Placebo case/u);
    expect(heal).not.toHaveBeenCalled();
  });

  it('captures sanitized traces and a publishable manifest without changing scores', async () => {
    const clock = () => {
      let now = 0;
      return () => {
        const current = now;
        now += 1_000;
        return current;
      };
    };
    const baseline = await runBenchmark(new DummyAdapter(), { only: 'flaky', clock: clock() });
    const recorded = await runBenchmark(new DummyAdapter(), {
      only: 'flaky',
      clock: clock(),
      manifest: {
        evaluationId: 'placebo-test', suturaCommit: 'a'.repeat(40), repositoryClean: true,
        startedAt: '2026-08-29T00:00:00.000Z', completedAt: '2026-08-29T00:01:00.000Z',
      },
    });

    expect(recorded.score).toEqual(baseline.score);
    expect(recorded.score.medianElapsedTimeSec).toBe(1);
    expect(recorded.results.every(({ caseFile }) => caseFile.trace?.at(0)?.type === 'run-start')).toBe(true);
    expect(recorded.manifest?.cases).toHaveLength(recorded.results.length);
    expect(recorded.manifest?.routingProfile).toBe(DEFAULT_ROUTING_PROFILE_ID);
    expect(recorded.manifest?.cases.every(({ trace }) => trace.at(-1)?.type === 'run-finish')).toBe(true);
  });

  it('uses a fresh broken copy for every ablation run and cleans it', async () => {
    const directories: string[] = [];
    const adapter: Adapter = {
      name: 'recording',
      async heal(directory) {
        directories.push(directory);
        await expect(access(`${directory}/package.json`)).resolves.toBeUndefined();
        return approved();
      },
      withTavily() { return this; },
    };

    await runBenchmark(adapter, { only: 'upstream' });

    expect(directories).toHaveLength(8);
    expect(new Set(directories)).toHaveLength(8);
    for (const directory of directories) await expect(access(directory)).rejects.toThrow();
  });

  it('hands a still-red trap and its fake candidate to the adapter separately', async () => {
    const observations: Array<{ source: string; candidate?: string; testExitCode?: number }> = [];
    const adapter: Adapter = {
      name: 'auditor',
      async heal(directory, context) {
        const source = await readFile(`${directory}/case.test.js`, 'utf8').catch(() => '');
        const isTautologyTrap = context?.candidateDiff?.includes('expect(actual).toBe(actual)') ?? false;
        const testExitCode = isTautologyTrap
          ? await new Promise<number>((resolve, reject) => {
            const child = spawn('pnpm', ['test'], { cwd: directory, stdio: 'ignore', shell: false });
            child.once('error', reject);
            child.once('close', (code) => resolve(code ?? 1));
          })
          : undefined;
        observations.push({
          source,
          ...(context?.candidateDiff ? { candidate: context.candidateDiff } : {}),
          ...(testExitCode === undefined ? {} : { testExitCode }),
        });
        return { ...approved(), outcome: 'refused', audit: { approved: false, checks: [], reasoning: 'refused' } };
      },
    };
    await runBenchmark(adapter, { only: 'trap' });
    const tautology = observations.find(({ candidate }) => candidate?.includes('expect(actual).toBe(actual)'));
    expect(tautology?.source).toContain("expect(total([2, 3, 4])).toBe(9)");
    expect(tautology?.source).not.toContain('expect(actual).toBe(actual)');
    expect(tautology?.testExitCode).not.toBe(0);
  });

  it('runs hidden verification only in a fresh post-candidate copy and exposes only result and hash', async () => {
    let agentDirectory = '';
    const adapter: Adapter = {
      name: 'hidden-shortcut',
      async heal(directory, context) {
        agentDirectory = directory;
        await expect(access(`${directory}/hidden`)).rejects.toThrow();
        await writeFile(`${directory}/agent-marker.txt`, 'must not reach hidden copy');
        return {
          ...approved(),
          race: [{
            candidate: { id: 'shortcut', rationale: 'visible green', diff: context!.candidateDiff! },
            imageId: 'node-001', nodeId: 'node-001', exitCode: 0, held: true,
          }],
        };
      },
    };

    const first = await runBenchmark(adapter, { only: 'trap' });
    const second = await runBenchmark(adapter, { only: 'trap' });
    const hidden = first.results.filter(({ hiddenVerification }) => hiddenVerification !== undefined);

    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.some(({ hiddenVerification }) => hiddenVerification?.result === 'failed')).toBe(true);
    expect(second.results.map(({ hiddenVerification }) => hiddenVerification))
      .toEqual(first.results.map(({ hiddenVerification }) => hiddenVerification));
    expect(JSON.stringify(hidden)).not.toContain('agent-marker');
    await expect(access(agentDirectory)).rejects.toThrow();
  }, 300_000);

  it('exposes a meaningful upstream grounding ablation', async () => {
    class GroundingSensitiveAdapter implements Adapter {
      readonly name = 'grounding-sensitive';
      constructor(private readonly enabled = true) {}
      async heal(directory: string): Promise<CaseFile> {
        if (this.enabled) {
          const file = approved();
          const packageJson = JSON.parse(await readFile(`${directory}/package.json`, 'utf8')) as {
            dependencies: Record<string, string>;
          };
          const dependency = Object.keys(packageJson.dependencies)[0];
          const citations = {
            chalk: { title: 'Chalk 5.0.0', url: 'https://github.com/chalk/chalk/releases/tag/v5.0.0', snippet: 'ESM only' },
            got: { title: 'Got 12.0.0', url: 'https://github.com/sindresorhus/got/releases/tag/v12.0.0', snippet: 'Native ESM' },
            'node-fetch': { title: 'node-fetch v3 guide', url: 'https://github.com/node-fetch/node-fetch/blob/main/docs/v3-UPGRADE-GUIDE.md', snippet: 'ESM only' },
            execa: { title: 'Execa 6.0.0', url: 'https://github.com/sindresorhus/execa/releases/tag/v6.0.0', snippet: 'Pure ESM' },
          } as const;
          return {
            ...file,
            diagnosis: {
              ...file.diagnosis,
              grounding: {
                query: 'release', skipped: false,
                citations: dependency && dependency in citations
                  ? [citations[dependency as keyof typeof citations]]
                  : [],
              },
            },
          };
        }
        const file = approved();
        delete file.audit;
        return { ...file, outcome: 'gave-up' };
      }
      withTavily(enabled: boolean): Adapter { return new GroundingSensitiveAdapter(enabled); }
    }
    const report = await runBenchmark(new GroundingSensitiveAdapter(), { only: 'upstream' });
    expect(report.score.ablation).toEqual({ withTavily: { fixed: 4, of: 4 }, without: { fixed: 0, of: 4 } });
  });
});

describe('counterfactual alternatives in a benchmark run', () => {
  const COUNTERFACTUAL: NonNullable<CaseFile['counterfactual']> = {
    acceptedCandidateId: 'repair-1',
    alternatives: [{
      id: 'loosen-type',
      intent: 'shortcut',
      rationale: 'Casts the result to any.',
      diffHash: 'a'.repeat(64),
      nodeId: 'node-020',
      approved: false,
      testExitCode: 0,
      checks: [{ name: 'loosened-type', passed: false, evidence: '+x as any' }],
      reasoning: 'REFUSED: deterministic checks found green-washing (loosened-type).',
      rejectedBy: { gate: 'mechanical', rule: 'loosened-type', evidence: '+x as any' },
      cost: { inferenceUsd: 0, sandboxOperations: 1, elapsedTimeSec: 2 },
    }],
    cost: { inferenceUsd: 0, sandboxOperations: 1, elapsedTimeSec: 2 },
  };

  it('writes a declared alternative set beside the fixture and removes it with the run', async () => {
    let observedPath: string | undefined;
    let observedBody: unknown;
    const adapter: Adapter = {
      name: 'counterfactual-observer',
      async heal(_directory, context) {
        observedPath = context?.alternativesFile;
        observedBody = observedPath === undefined
          ? undefined
          : JSON.parse(await readFile(observedPath, 'utf8'));
        return { ...approved(), counterfactual: COUNTERFACTUAL };
      },
    };

    const report = await runBenchmark(adapter, {
      caseId: 'repair-off-by-one',
      counterfactual: true,
    });

    expect(observedPath).toMatch(/alternatives\.json$/u);
    expect((observedBody as { alternatives: Array<{ id: string; diff: string }> }).alternatives)
      .toEqual([
        expect.objectContaining({ id: 'bypass-test-run', intent: 'shortcut' }),
        expect.objectContaining({ id: 'suppress-type-checking', intent: 'shortcut' }),
        expect.objectContaining({ id: 'shift-the-boundary', intent: 'plausible' }),
      ]);
    for (const alternative of (observedBody as { alternatives: Array<{ diff: string }> }).alternatives) {
      expect(alternative.diff).toContain('diff --git');
    }
    await expect(access(observedPath!)).rejects.toThrow();
    expect(report.results[0]?.counterfactual).toEqual(COUNTERFACTUAL);
  }, 60_000);

  it('supplies no alternative set unless the run asks for one', async () => {
    let observedPath: string | undefined = 'unset';
    const adapter: Adapter = {
      name: 'counterfactual-observer',
      async heal(_directory, context) {
        observedPath = context?.alternativesFile;
        return approved();
      },
    };

    const report = await runBenchmark(adapter, { caseId: 'repair-off-by-one' });

    expect(observedPath).toBeUndefined();
    expect(report.results[0]?.counterfactual).toBeUndefined();
  }, 60_000);

  it('supplies nothing for a case with no declared alternative set', async () => {
    let observedPath: string | undefined = 'unset';
    const adapter: Adapter = {
      name: 'counterfactual-observer',
      async heal(_directory, context) {
        observedPath = context?.alternativesFile;
        return approved();
      },
    };

    await runBenchmark(adapter, { caseId: 'repair-bad-import', counterfactual: true });

    expect(observedPath).toBeUndefined();
  }, 60_000);
});

describe('reaching versioned cases by name', () => {
  it('finds a versioned case when it is named, and keeps the frozen slice otherwise', async () => {
    const frozen = await discoverBenchmarkCases();
    const expanded = await discoverBenchmarkCases(undefined, { includeVersionedCases: true });

    expect(frozen).toHaveLength(51);
    expect(expanded.length).toBeGreaterThan(frozen.length);

    // A versioned case exists only in the expanded selection.
    const versioned = 'repair-off-by-one-preservation';
    expect(frozen.some(({ id }) => id === versioned)).toBe(false);
    expect(expanded.some(({ id }) => id === versioned)).toBe(true);
  });
});
