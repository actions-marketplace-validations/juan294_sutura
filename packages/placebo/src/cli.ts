import { execFile } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { canonicalJson } from '@sutura/evaluation';

import { CliAdapter, DummyAdapter, RefuseAllAdapter, SuturaAdapter } from './adapters.js';
import { arenaReport, renderArena } from './arena.js';
import { COMPARISON_ARMS, expansionReadiness, type ComparisonArm, type ComparisonManifest } from './comparison.js';
import { runComparison, type CompareRunOptions } from './compare.js';
import {
  runCounterfactualCheck,
  type CounterfactualCheckOptions,
  type CounterfactualReport,
} from './counterfactual.js';
import { runBenchmark, type BenchmarkOptions } from './harness.js';
import {
  catalogFromCorpus,
  selectStratified,
  validateArenaCatalog,
  type ArenaCatalog,
  type ArenaSelectionManifest,
} from './selection.js';
import type { Adapter, BenchmarkReport, CaseKind } from './types.js';

interface CliIo {
  write?: (value: string) => void;
  writeError?: (value: string) => void;
}

export interface PlaceboCliDependencies {
  benchmark?: (adapter: Adapter, options: BenchmarkOptions) => Promise<BenchmarkReport>;
  repositoryState?: () => Promise<{ commit: string; clean: boolean }>;
  counterfactual?: (options: CounterfactualCheckOptions) => Promise<CounterfactualReport>;
  compare?: (options: CompareRunOptions) => Promise<ComparisonManifest>;
}

const USAGE = 'Usage: placebo run --adapter <dummy|refuse-all|sutura|cli:command> [--only kind | --case id] [--no-tavily] [--counterfactual] [--manifest-output file] [--force]\n'
  + '       placebo counterfactual [--case id] [--output file] [--force]\n'
  + '       placebo compare --arm <name> [--arm <name> ...] --adapter <sutura|cli:command> [--no-tavily] --output <file> [--force]\n'
  + '       placebo select --catalog <corpus|file> [--captured-at <iso>] [--catalog-output <file>] --size <n> --seed <text> [--minimum <stratum>=<n> ...] --output <file> [--force]\n'
  + '       placebo arena --comparison <file> [--selection <file>] [--counterfactual <file>] --output-json <file> --output-html <file> [--allow-incomplete] [--force] [--expansion-budget <usd> --spent <usd>]\n';
const COUNTERFACTUAL_FLAGS = new Set(['--case', '--output', '--force']);
const COMPARE_FLAGS = new Set(['--arm', '--adapter', '--sutura-command', '--no-tavily', '--output', '--force']);
const SELECT_FLAGS = new Set([
  '--catalog', '--captured-at', '--catalog-output', '--size', '--seed', '--minimum',
  '--output', '--force',
]);
const ARENA_FLAGS = new Set([
  '--comparison', '--selection', '--counterfactual', '--output-json', '--output-html',
  '--allow-incomplete', '--force', '--expansion-budget', '--spent',
]);
const VALUELESS_FLAGS = new Set(['--force', '--no-tavily', '--allow-incomplete']);

const KINDS = new Set<CaseKind>(['trap', 'repairable', 'flaky', 'upstream']);
const execFileAsync = promisify(execFile);

async function repositoryState(): Promise<{ commit: string; clean: boolean }> {
  const [{ stdout: commit }, { stdout: status }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }),
    execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' }),
  ]);
  return { commit: commit.trim(), clean: status.trim() === '' };
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function valuesAfter(args: string[], flag: string): string[] {
  return args.flatMap((value, index) => value === flag && args[index + 1] !== undefined
    ? [args[index + 1]!] : []);
}

function adapterFrom(name: string | undefined, suturaCommand?: string): Adapter | undefined {
  if (name === 'dummy') return new DummyAdapter();
  if (name === 'refuse-all') return new RefuseAllAdapter();
  if (name === 'sutura') return new SuturaAdapter(suturaCommand ? { command: suturaCommand } : {});
  if (name?.startsWith('cli:') && name.length > 4) return new CliAdapter({ command: name.slice(4) });
  return undefined;
}

async function runCounterfactualCli(
  args: string[],
  write: (value: string) => void,
  writeError: (value: string) => void,
  dependencies: PlaceboCliDependencies,
): Promise<number> {
  const unknown = args.find((value, index) =>
    value.startsWith('--') ? !COUNTERFACTUAL_FLAGS.has(value) : args[index - 1] === undefined ||
      !COUNTERFACTUAL_FLAGS.has(args[index - 1]!) || args[index - 1] === '--force');
  if (unknown !== undefined) {
    writeError(`Unsupported counterfactual argument: ${unknown}\n${USAGE}`);
    return 2;
  }
  const caseId = valueAfter(args, '--case');
  if (args.includes('--case') && (caseId === undefined || !/^[a-z0-9-]{1,100}$/u.test(caseId))) {
    writeError(`Invalid counterfactual case: ${caseId ?? '(missing)'}\n`);
    return 2;
  }
  const output = valueAfter(args, '--output');
  if (args.includes('--output') && output === undefined) {
    writeError('--output requires a file path\n');
    return 2;
  }
  const force = args.includes('--force');
  if (output !== undefined && !force) {
    try {
      await access(output);
      writeError(`Counterfactual output already exists: ${output}\n`);
      return 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const report = await (dependencies.counterfactual ?? runCounterfactualCheck)({
    ...(caseId ? { caseId } : {}),
  });
  const serialized = `${canonicalJson(report)}\n`;
  if (output !== undefined) {
    await writeFile(output, serialized, { encoding: 'utf8', flag: force ? 'w' : 'wx' });
  }
  write(`${JSON.stringify(report, null, 2)}\n`);
  return report.totals.expectationMismatches === 0 &&
    report.totals.shortcutsRejected === report.totals.shortcuts
    ? 0
    : 1;
}

function unsupportedArgument(args: readonly string[], allowed: ReadonlySet<string>): string | undefined {
  for (const [index, value] of args.entries()) {
    if (value.startsWith('--')) {
      if (!allowed.has(value)) return value;
      continue;
    }
    const previous = args[index - 1];
    if (previous === undefined || !allowed.has(previous) || VALUELESS_FLAGS.has(previous)) {
      return value;
    }
  }
  return undefined;
}

async function refuseExistingOutput(
  paths: readonly string[],
  force: boolean,
  writeError: (value: string) => void,
): Promise<boolean> {
  if (force) return false;
  for (const path of paths) {
    try {
      await access(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    writeError(`Output already exists: ${path}\n`);
    return true;
  }
  return false;
}

async function runCompareCli(
  args: string[],
  write: (value: string) => void,
  writeError: (value: string) => void,
  dependencies: PlaceboCliDependencies,
): Promise<number> {
  const unsupported = unsupportedArgument(args, COMPARE_FLAGS);
  if (unsupported !== undefined) {
    writeError(`Unsupported compare argument: ${unsupported}\n${USAGE}`);
    return 2;
  }
  const arms = valuesAfter(args, '--arm');
  const adapterName = valueAfter(args, '--adapter');
  const output = valueAfter(args, '--output');
  if (arms.length === 0 || arms.some((arm) => !COMPARISON_ARMS.includes(arm as ComparisonArm))) {
    writeError(`A comparison needs at least one --arm from ${COMPARISON_ARMS.join(', ')}\n`);
    return 2;
  }
  if (new Set(arms).size !== arms.length) {
    writeError('A comparison must not repeat an arm\n');
    return 2;
  }
  if (adapterName === undefined || (adapterName !== 'sutura' && !adapterName.startsWith('cli:'))) {
    writeError('A comparison needs --adapter sutura or --adapter cli:<command>\n');
    return 2;
  }
  if (output === undefined) {
    writeError('--output requires a file path\n');
    return 2;
  }
  const force = args.includes('--force');
  if (await refuseExistingOutput([output], force, writeError)) return 1;

  const suturaCommand = valueAfter(args, '--sutura-command');
  const state = await (dependencies.repositoryState ?? repositoryState)();
  const manifest = await (dependencies.compare ?? runComparison)({
    comparisonId: `compare-${state.commit.slice(0, 12)}`,
    suturaCommit: state.commit,
    arms: arms as ComparisonArm[],
    adapterName,
    ...(suturaCommand === undefined ? {} : { suturaCommand }),
    noTavily: args.includes('--no-tavily'),
  });
  await writeFile(output, `${canonicalJson(manifest)}\n`, {
    encoding: 'utf8', flag: force ? 'w' : 'wx',
  });
  write(`Recorded ${manifest.arms.length} comparison arms in ${output}\n`);
  return manifest.complete ? 0 : 1;
}

function parseMinimums(values: readonly string[]): Array<{ key: string; minimum: number }> | null {
  const strata: Array<{ key: string; minimum: number }> = [];
  for (const value of values) {
    const separator = value.lastIndexOf('=');
    const key = separator === -1 ? '' : value.slice(0, separator);
    const minimum = Number(value.slice(separator + 1));
    if (!key || !Number.isSafeInteger(minimum) || minimum < 0) return null;
    strata.push({ key, minimum });
  }
  return strata;
}

async function runSelectCli(
  args: string[],
  write: (value: string) => void,
  writeError: (value: string) => void,
): Promise<number> {
  const unsupported = unsupportedArgument(args, SELECT_FLAGS);
  if (unsupported !== undefined) {
    writeError(`Unsupported select argument: ${unsupported}\n${USAGE}`);
    return 2;
  }
  const catalogSource = valueAfter(args, '--catalog');
  const size = Number(valueAfter(args, '--size'));
  const seed = valueAfter(args, '--seed');
  const output = valueAfter(args, '--output');
  const strata = parseMinimums(valuesAfter(args, '--minimum'));
  if (catalogSource === undefined || seed === undefined || output === undefined ||
      !Number.isSafeInteger(size) || size <= 0 || strata === null) {
    writeError('A selection needs --catalog, a positive --size, --seed, --output, and well-formed --minimum <stratum>=<n>\n');
    return 2;
  }
  const force = args.includes('--force');
  if (await refuseExistingOutput([output], force, writeError)) return 1;

  const capturedAt = valueAfter(args, '--captured-at');
  if (catalogSource === 'corpus' && capturedAt !== undefined &&
      !Number.isFinite(Date.parse(capturedAt))) {
    writeError('--captured-at must be an ISO timestamp\n');
    return 2;
  }
  const catalog: ArenaCatalog = catalogSource === 'corpus'
    ? await catalogFromCorpus(capturedAt ?? new Date().toISOString())
    : validateArenaCatalog(JSON.parse(await readFile(catalogSource, 'utf8')) as ArenaCatalog);
  const manifest = selectStratified(catalog, { size, strata, seed }, `select-${seed}-${size}`);
  const catalogOutput = valueAfter(args, '--catalog-output');
  if (catalogOutput !== undefined) {
    if (await refuseExistingOutput([catalogOutput], force, writeError)) return 1;
    await writeFile(catalogOutput, `${canonicalJson(catalog)}\n`, {
      encoding: 'utf8', flag: force ? 'w' : 'wx',
    });
  }
  await writeFile(output, `${canonicalJson(manifest)}\n`, {
    encoding: 'utf8', flag: force ? 'w' : 'wx',
  });
  write(`Selected ${manifest.cases.length} cases across ${manifest.strata.length} strata in ${output}\n`);
  return 0;
}

async function runArenaCli(
  args: string[],
  write: (value: string) => void,
  writeError: (value: string) => void,
): Promise<number> {
  const unsupported = unsupportedArgument(args, ARENA_FLAGS);
  if (unsupported !== undefined) {
    writeError(`Unsupported arena argument: ${unsupported}\n${USAGE}`);
    return 2;
  }
  const comparisonPath = valueAfter(args, '--comparison');
  const outputJson = valueAfter(args, '--output-json');
  const outputHtml = valueAfter(args, '--output-html');
  if (comparisonPath === undefined || outputJson === undefined || outputHtml === undefined) {
    writeError('An Arena report needs --comparison, --output-json, and --output-html\n');
    return 2;
  }
  const force = args.includes('--force');
  if (await refuseExistingOutput([outputJson, outputHtml], force, writeError)) return 1;

  const comparison = JSON.parse(await readFile(comparisonPath, 'utf8')) as ComparisonManifest;
  const selectionPath = valueAfter(args, '--selection');
  const counterfactualPath = valueAfter(args, '--counterfactual');
  const report = arenaReport(comparison, {
    ...(selectionPath === undefined ? {} : {
      selection: JSON.parse(await readFile(selectionPath, 'utf8')) as ArenaSelectionManifest,
    }),
    ...(counterfactualPath === undefined ? {} : {
      counterfactual: JSON.parse(await readFile(counterfactualPath, 'utf8')) as CounterfactualReport,
    }),
    allowIncomplete: args.includes('--allow-incomplete'),
  });
  const flag = force ? 'w' as const : 'wx' as const;
  await writeFile(outputJson, `${canonicalJson(report)}\n`, { encoding: 'utf8', flag });
  await writeFile(outputHtml, renderArena(report), { encoding: 'utf8', flag });
  write(`Wrote the Arena report to ${outputJson} and ${outputHtml}\n`);

  if (args.includes('--expansion-budget')) {
    const readiness = expansionReadiness(comparison, {
      authorizedUsd: Number(valueAfter(args, '--expansion-budget')),
      spentUsd: Number(valueAfter(args, '--spent') ?? '0'),
    });
    write(`${JSON.stringify(readiness, null, 2)}\n`);
    return readiness.ready ? 0 : 1;
  }
  return 0;
}

export async function runCli(
  args = process.argv.slice(2),
  io: CliIo = {},
  dependencies: PlaceboCliDependencies = {},
): Promise<number> {
  const write = io.write ?? ((value: string) => process.stdout.write(value));
  const writeError = io.writeError ?? ((value: string) => process.stderr.write(value));
  if (args[0] === 'compare') return runCompareCli(args.slice(1), write, writeError, dependencies);
  if (args[0] === 'select') return runSelectCli(args.slice(1), write, writeError);
  if (args[0] === 'arena') return runArenaCli(args.slice(1), write, writeError);
  if (args[0] === 'counterfactual') {
    return runCounterfactualCli(args.slice(1), write, writeError, dependencies);
  }
  if (args[0] !== 'run') {
    writeError(USAGE);
    return 2;
  }

  const adapterName = valueAfter(args, '--adapter');
  const suturaCommand = valueAfter(args, '--sutura-command');
  const adapter = adapterFrom(adapterName, suturaCommand);
  const only = valueAfter(args, '--only');
  const caseValues = valuesAfter(args, '--case');
  const caseId = caseValues[0];
  if (!adapter || (only !== undefined && !KINDS.has(only as CaseKind)) ||
      caseValues.length > 1 || (only !== undefined && caseId !== undefined) ||
      (args.includes('--sutura-command') && (adapterName !== 'sutura' || suturaCommand === undefined ||
        suturaCommand.startsWith('--') || suturaCommand.length > 1_024 || /[\r\n\0]/u.test(suturaCommand))) ||
      (args.includes('--case') && (caseId === undefined || !/^[a-z0-9-]{1,100}$/u.test(caseId)))) {
    writeError(`Invalid adapter or kind: ${adapterName ?? '(missing)'} ${only ?? ''}\n`);
    return 2;
  }

  const manifestOutput = valueAfter(args, '--manifest-output');
  if (args.includes('--manifest-output') && manifestOutput === undefined) {
    writeError('--manifest-output requires a file path\n');
    return 2;
  }
  const force = args.includes('--force');
  let manifestOptions: BenchmarkOptions['manifest'];
  if (manifestOutput !== undefined) {
    if (!force) {
      try {
        await access(manifestOutput);
        writeError(`Manifest output already exists: ${manifestOutput}\n`);
        return 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const state = await (dependencies.repositoryState ?? repositoryState)();
    manifestOptions = {
      evaluationId: `placebo-${adapter.name}`,
      suturaCommit: state.commit,
      repositoryClean: state.clean,
      startedAt: new Date().toISOString(),
    };
  }

  const report = await (dependencies.benchmark ?? runBenchmark)(adapter, {
    ...(only ? { only: only as CaseKind } : {}),
    ...(caseId ? { caseId } : {}),
    noTavily: args.includes('--no-tavily'),
    ...(args.includes('--counterfactual') ? { counterfactual: true } : {}),
    ...(manifestOptions === undefined ? {} : { manifest: manifestOptions }),
  });
  if (manifestOutput !== undefined) {
    if (report.manifest === undefined) throw new Error('Benchmark did not create a manifest');
    await writeFile(manifestOutput, `${canonicalJson(report.manifest)}\n`, {
      encoding: 'utf8', flag: force ? 'w' : 'wx',
    });
  }
  write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}
