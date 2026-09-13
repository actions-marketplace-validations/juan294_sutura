import { describe, expect, it, vi } from 'vitest';

import { runCli } from './cli.js';
import { score } from './score.js';
import type { BenchmarkReport } from './types.js';

function report(resultCount = 0): BenchmarkReport {
  return {
    adapter: 'dummy',
    results: Array.from({ length: resultCount }, () => ({})) as BenchmarkReport['results'],
    score: {
      ...score([]),
      catchRate: { refused: 0, of: 19 },
    },
  };
}

describe('placebo CLI', { timeout: 120_000 }, () => {
  it('prints honest JSON for the dummy control', async () => {
    const write = vi.fn();
    const benchmark = vi.fn(async (adapter) => {
      expect(adapter.name).toBe('dummy');
      return report();
    });
    const exitCode = await runCli(
      ['run', '--adapter', 'dummy'],
      { write },
      { benchmark },
    );

    expect(exitCode).toBe(0);
    expect(benchmark).toHaveBeenCalledOnce();
    expect(JSON.parse(write.mock.calls[0]?.[0] as string)).toMatchObject({
      score: { catchRate: { refused: 0, of: 19 } },
    });
  });

  it('filters by kind and propagates --no-tavily', async () => {
    const write = vi.fn();
    const benchmark = vi.fn().mockResolvedValue(report(4));
    const exitCode = await runCli(
      ['run', '--adapter', 'dummy', '--only', 'upstream', '--no-tavily'],
      { write },
      { benchmark },
    );
    const output = JSON.parse(write.mock.calls[0]?.[0] as string) as { results: unknown[] };

    expect(exitCode).toBe(0);
    expect(benchmark).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'dummy' }),
      { only: 'upstream', noTavily: true },
    );
    expect(output.results).toHaveLength(4);
  });

  it('selects one case and rejects conflicting or repeated selectors', async () => {
    const write = vi.fn();
    const writeError = vi.fn();
    const benchmark = vi.fn().mockResolvedValue(report(1));
    await expect(runCli(
      ['run', '--adapter', 'dummy', '--case', 'repair-off-by-one'],
      { write, writeError },
      { benchmark },
    )).resolves.toBe(0);
    expect(benchmark).toHaveBeenCalledWith(expect.anything(), {
      caseId: 'repair-off-by-one', noTavily: false,
    });

    benchmark.mockClear();
    await expect(runCli(
      ['run', '--adapter', 'dummy', '--case', 'repair-off-by-one', '--only', 'repairable'],
      { writeError }, { benchmark },
    )).resolves.toBe(2);
    await expect(runCli(
      ['run', '--adapter', 'dummy', '--case', 'repair-off-by-one', '--case', 'repair-missing-await'],
      { writeError }, { benchmark },
    )).resolves.toBe(2);
    expect(benchmark).not.toHaveBeenCalled();
  });

  it('passes one explicit Sutura binary without shell parsing', async () => {
    const benchmark = vi.fn(async (adapter) => {
      expect(adapter).toMatchObject({ name: 'sutura' });
      return report();
    });
    await expect(runCli([
      'run', '--adapter', 'sutura', '--sutura-command', '/tmp/subject/dist/bin.js',
      '--case', 'repair-off-by-one',
    ], {}, { benchmark })).resolves.toBe(0);
    expect(benchmark).toHaveBeenCalledOnce();
  });

  it('rejects an unknown adapter', async () => {
    const writeError = vi.fn();
    await expect(runCli(['run', '--adapter', 'unknown'], { writeError })).resolves.toBe(2);
    expect(writeError).toHaveBeenCalled();
  });

  it('rejects a missing manifest output path before running the benchmark', async () => {
    const writeError = vi.fn();
    const benchmark = vi.fn();

    await expect(runCli(
      ['run', '--adapter', 'dummy', '--manifest-output'],
      { writeError },
      { benchmark },
    )).resolves.toBe(2);
    expect(writeError).toHaveBeenCalledWith('--manifest-output requires a file path\n');
    expect(benchmark).not.toHaveBeenCalled();
  });

  it('captures a manifest only with explicit output and a clean exact commit', async () => {
    const write = vi.fn();
    const benchmark = vi.fn().mockResolvedValue({
      adapter: 'dummy', results: [], score: { catchRate: { refused: 0, of: 0 } },
      manifest: { schemaVersion: 'sutura-evaluation-v1', evaluationId: 'placebo-dummy' },
    });
    const output = `/tmp/placebo-manifest-${process.pid}-${Date.now()}.json`;

    const exitCode = await runCli(
      ['run', '--adapter', 'dummy', '--manifest-output', output],
      { write },
      {
        benchmark,
        repositoryState: async () => ({ commit: 'a'.repeat(40), clean: true }),
      },
    );

    expect(exitCode).toBe(0);
    expect(benchmark).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      manifest: expect.objectContaining({ suturaCommit: 'a'.repeat(40), repositoryClean: true }),
    }));
    await import('node:fs/promises').then(({ rm }) => rm(output, { force: true }));
  });
});

describe('placebo counterfactual command', () => {
  const report = {
    schemaVersion: 'sutura-counterfactual-v1' as const,
    corpusVersion: '0.2',
    corpusHash: 'a'.repeat(64),
    counterfactualHash: 'b'.repeat(64),
    cases: [],
    totals: {
      cases: 0, alternatives: 0, rejected: 0, shortcuts: 0, shortcutsRejected: 0,
      expectationMismatches: 0, inferenceUsd: 0 as const, sandboxOperations: 0, elapsedTimeSec: 0,
    },
    resultHash: 'c'.repeat(64),
  };

  it('runs the whole set and exits 0 when every expectation holds', async () => {
    const write = vi.fn();
    const counterfactual = vi.fn().mockResolvedValue(report);

    await expect(runCli(['counterfactual'], { write }, { counterfactual })).resolves.toBe(0);
    expect(counterfactual).toHaveBeenCalledWith({});
  });

  it('exits 1 when an observed gate does not match its declaration', async () => {
    const counterfactual = vi.fn().mockResolvedValue({
      ...report,
      totals: { ...report.totals, expectationMismatches: 1 },
    });

    await expect(runCli(['counterfactual'], { write: vi.fn() }, { counterfactual })).resolves.toBe(1);
  });

  it('exits 1 when a shortcut was not rejected', async () => {
    const counterfactual = vi.fn().mockResolvedValue({
      ...report,
      totals: { ...report.totals, shortcuts: 2, shortcutsRejected: 1 },
    });

    await expect(runCli(['counterfactual'], { write: vi.fn() }, { counterfactual })).resolves.toBe(1);
  });

  it('passes a validated case id through', async () => {
    const counterfactual = vi.fn().mockResolvedValue(report);

    await expect(runCli(
      ['counterfactual', '--case', 'repair-off-by-one'], { write: vi.fn() }, { counterfactual },
    )).resolves.toBe(0);
    expect(counterfactual).toHaveBeenCalledWith({ caseId: 'repair-off-by-one' });
  });

  it.each([
    ['an unknown flag', ['counterfactual', '--adapter', 'dummy']],
    ['a malformed case id', ['counterfactual', '--case', 'Not A Case']],
    ['a missing case value', ['counterfactual', '--case']],
    ['a missing output value', ['counterfactual', '--output']],
  ])('refuses %s', async (_case, args) => {
    const writeError = vi.fn();
    const counterfactual = vi.fn().mockResolvedValue(report);

    await expect(runCli(args, { write: vi.fn(), writeError }, { counterfactual })).resolves.toBe(2);
    expect(counterfactual).not.toHaveBeenCalled();
  });

  it('refuses to overwrite an existing output without --force', async () => {
    const { writeFile, rm } = await import('node:fs/promises');
    const output = `/tmp/placebo-counterfactual-${process.pid}-${Date.now()}.json`;
    await writeFile(output, '{}');
    const writeError = vi.fn();
    const counterfactual = vi.fn().mockResolvedValue(report);

    try {
      await expect(runCli(
        ['counterfactual', '--output', output], { write: vi.fn(), writeError }, { counterfactual },
      )).resolves.toBe(1);
      expect(counterfactual).not.toHaveBeenCalled();

      await expect(runCli(
        ['counterfactual', '--output', output, '--force'], { write: vi.fn() }, { counterfactual },
      )).resolves.toBe(0);
      expect(JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(output, 'utf8'))))
        .toMatchObject({ resultHash: 'c'.repeat(64) });
    } finally {
      await rm(output, { force: true });
    }
  });
});

describe('placebo compare, select, and arena commands', () => {
  const manifestStub = {
    schemaVersion: 'sutura-search-comparison-v1' as const,
    comparisonId: 'compare-1',
    invariants: {},
    arms: [{ arm: 'sutura' }, { arm: 'single-branch' }],
    complete: true,
    resultHash: 'a'.repeat(64),
  } as unknown as Record<string, unknown>;

  const repositoryState = async () => ({ commit: 'b'.repeat(40), clean: true });

  async function temporaryPath(suffix: string): Promise<string> {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    return join(await mkdtemp(join(tmpdir(), 'placebo-cli-')), suffix);
  }

  it('runs the declared arms and writes a comparison manifest', async () => {
    const compare = vi.fn().mockResolvedValue(manifestStub);
    const output = await temporaryPath('comparison.json');

    const exitCode = await runCli([
      'compare', '--arm', 'sutura', '--arm', 'single-branch', '--adapter', 'sutura',
      '--output', output,
    ], { write: vi.fn() }, { compare, repositoryState });

    expect(exitCode).toBe(0);
    expect(compare).toHaveBeenCalledWith(expect.objectContaining({
      arms: ['sutura', 'single-branch'],
      adapterName: 'sutura',
      suturaCommit: 'b'.repeat(40),
      noTavily: false,
    }));
    const { readFile } = await import('node:fs/promises');
    expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({ comparisonId: 'compare-1' });
  });

  it('exits 1 when the comparison is incomplete', async () => {
    const compare = vi.fn().mockResolvedValue({ ...manifestStub, complete: false });

    await expect(runCli([
      'compare', '--arm', 'sutura', '--adapter', 'sutura',
      '--output', await temporaryPath('incomplete.json'),
    ], { write: vi.fn() }, { compare, repositoryState })).resolves.toBe(1);
  });

  it.each([
    ['no arm', ['compare', '--adapter', 'sutura', '--output', '/tmp/x.json']],
    ['an unknown arm', ['compare', '--arm', 'beam-plus', '--adapter', 'sutura', '--output', '/tmp/x.json']],
    ['a repeated arm', ['compare', '--arm', 'sutura', '--arm', 'sutura', '--adapter', 'sutura', '--output', '/tmp/x.json']],
    ['a control adapter', ['compare', '--arm', 'sutura', '--adapter', 'dummy', '--output', '/tmp/x.json']],
    ['a missing output', ['compare', '--arm', 'sutura', '--adapter', 'sutura']],
    ['an unknown flag', ['compare', '--arm', 'sutura', '--adapter', 'sutura', '--output', '/tmp/x.json', '--only', 'trap']],
  ])('refuses a comparison with %s', async (_case, args) => {
    const compare = vi.fn();

    await expect(runCli(args, { write: vi.fn(), writeError: vi.fn() }, { compare, repositoryState }))
      .resolves.toBe(2);
    expect(compare).not.toHaveBeenCalled();
  });

  it('selects a reproducible stratified set from the committed corpus', async () => {
    const output = await temporaryPath('selection.json');
    const catalogOutput = await temporaryPath('catalog.json');

    const exitCode = await runCli([
      'select', '--catalog', 'corpus', '--captured-at', '2026-09-04T00:00:00.000Z',
      '--catalog-output', catalogOutput, '--size', '10', '--seed', 'cli-test',
      '--minimum', 'javascript:test-assertion=2', '--output', output,
    ], { write: vi.fn() });

    expect(exitCode).toBe(0);
    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(await readFile(output, 'utf8')) as {
      cases: Array<{ inclusionReason: string; repository: string; difficulty: string }>;
      resultHash: string;
    };
    expect(manifest.cases).toHaveLength(10);
    expect(manifest.cases.every(({ inclusionReason }) => inclusionReason.length > 0)).toBe(true);
    expect(JSON.parse(await readFile(catalogOutput, 'utf8'))).toMatchObject({
      schemaVersion: 'sutura-arena-catalog-v1',
    });
  }, 30_000);

  it.each([
    ['a missing seed', ['select', '--catalog', 'corpus', '--size', '5', '--output', '/tmp/s.json']],
    ['a non-integer size', ['select', '--catalog', 'corpus', '--size', 'ten', '--seed', 's', '--output', '/tmp/s.json']],
    ['a malformed minimum', ['select', '--catalog', 'corpus', '--size', '5', '--seed', 's', '--minimum', 'javascript', '--output', '/tmp/s.json']],
    ['a malformed captured-at', ['select', '--catalog', 'corpus', '--captured-at', 'yesterday', '--size', '5', '--seed', 's', '--output', '/tmp/s.json']],
    ['an unknown flag', ['select', '--catalog', 'corpus', '--size', '5', '--seed', 's', '--output', '/tmp/s.json', '--adapter', 'dummy']],
  ])('refuses a selection with %s', async (_case, args) => {
    await expect(runCli(args, { write: vi.fn(), writeError: vi.fn() })).resolves.toBe(2);
  });

  it('renders the committed control comparison into a labelled Arena report', async () => {
    const { fileURLToPath } = await import('node:url');
    const comparison = fileURLToPath(
      new URL('../../../docs/demo/sutura-arena-controls-v0.2.json', import.meta.url),
    );
    const outputJson = await temporaryPath('arena.json');
    const outputHtml = await temporaryPath('arena.html');

    const exitCode = await runCli([
      'arena', '--comparison', comparison,
      '--output-json', outputJson, '--output-html', outputHtml,
    ], { write: vi.fn(), writeError: vi.fn() });

    expect(exitCode).toBe(0);
    const { readFile } = await import('node:fs/promises');
    expect(JSON.parse(await readFile(outputJson, 'utf8'))).toMatchObject({
      schemaVersion: 'sutura-arena-report-v1',
    });
    expect(await readFile(outputHtml, 'utf8')).toContain('Measures by arm');
  });

  it('refuses to overwrite an existing Arena output without --force', async () => {
    const { fileURLToPath } = await import('node:url');
    const { writeFile } = await import('node:fs/promises');
    const comparison = fileURLToPath(
      new URL('../../../docs/demo/sutura-arena-controls-v0.2.json', import.meta.url),
    );
    const outputJson = await temporaryPath('arena.json');
    const outputHtml = await temporaryPath('arena.html');
    await writeFile(outputJson, '{}');

    await expect(runCli([
      'arena', '--comparison', comparison,
      '--output-json', outputJson, '--output-html', outputHtml,
    ], { write: vi.fn(), writeError: vi.fn() })).resolves.toBe(1);
  });

  it('reports expansion readiness and exits 1 when expansion is not justified', async () => {
    const { fileURLToPath } = await import('node:url');
    const comparison = fileURLToPath(
      new URL('../../../docs/demo/sutura-arena-controls-v0.2.json', import.meta.url),
    );
    const write = vi.fn();

    const exitCode = await runCli([
      'arena', '--comparison', comparison,
      '--output-json', await temporaryPath('arena.json'),
      '--output-html', await temporaryPath('arena.html'),
      '--expansion-budget', '0', '--spent', '0',
    ], { write, writeError: vi.fn() });

    expect(exitCode).toBe(1);
    expect(write.mock.calls.join('')).toContain('"ready": false');
  });
});
