import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { CliUsageError, parseArgs, VERSION } from './args.js';

describe('parseArgs', () => {
  it('parses the Placebo-compatible heal contract', () => {
    expect(parseArgs([
      'heal', '--case-dir', '/tmp/case', '--format', 'json',
      '--candidate-diff', 'diff --git a/a.js b/a.js\n',
      '--routing-profile', 'production-baseline-v1', '--no-tavily',
      '--runtime', 'python',
      '--failing-command', " python3 -B -m unittest discover -s tests -p 'test_*.py' ",
    ])).toEqual({
      command: 'heal',
      caseDir: '/tmp/case',
      format: 'json',
      candidateDiff: 'diff --git a/a.js b/a.js\n',
      failingCommand: "python3 -B -m unittest discover -s tests -p 'test_*.py'",
      routingProfile: 'production-baseline-v1',
      runtime: 'python',
      tavilyEnabled: false,
    });
  });

  it('leaves the failing command to the core default when the flag is absent', () => {
    expect(parseArgs(['heal', '--case-dir', '/tmp/case', '--format', 'json'])).not.toHaveProperty('failingCommand');
  });

  it('parses external repository setup options', () => {
    expect(parseArgs([
      'init', '--workflow', 'CI', '--repo', 'octo/example', '--action-sha', 'a'.repeat(40),
      '--force', '--no-tavily',
    ])).toEqual({
      command: 'init',
      workflow: 'CI',
      repository: 'octo/example',
      actionSha: 'a'.repeat(40),
      force: true,
      tavilyEnabled: false,
    });
  });

  it('parses repository diagnosis options', () => {
    expect(parseArgs(['doctor', '--repo', 'octo/example', '--action-sha', 'b'.repeat(40)])).toEqual({
      command: 'doctor',
      repository: 'octo/example',
      actionSha: 'b'.repeat(40),
    });
  });

  it('parses reduced-assurance audit inputs as file paths', () => {
    expect(parseArgs([
      'audit', '--case-dir', '/tmp/case', '--candidate-diff', '/tmp/fix.diff',
      '--before-log', '/tmp/before.log', '--after-log', '/tmp/after.log', '--format', 'json',
    ])).toEqual({
      command: 'audit', caseDir: '/tmp/case', candidateDiff: '/tmp/fix.diff',
      beforeLog: '/tmp/before.log', afterLog: '/tmp/after.log', format: 'json',
    });
  });

  it('parses replay bundle and runtime options', () => {
    expect(parseArgs([
      'replay', '--bundle', '/tmp/replay.json', '--format', 'json', '--runtime', 'python',
    ])).toEqual({
      command: 'replay', bundle: '/tmp/replay.json', format: 'json', runtime: 'python',
    });
    expect(parseArgs([
      'replay', '--bundle', '/tmp/replay.json', '--format', 'json', '--runtime', 'auto',
    ])).toEqual({
      command: 'replay', bundle: '/tmp/replay.json', format: 'json',
    });
  });

  it('parses evaluation validation and export commands', () => {
    expect(parseArgs(['eval', 'validate', '--manifest', '/tmp/manifest.json'])).toEqual({
      command: 'eval-validate', manifest: '/tmp/manifest.json',
    });
    expect(parseArgs([
      'eval', 'export', '--manifest', '/tmp/manifest.json', '--format', 'atif',
      '--output', '/tmp/trajectory.atif.json', '--force',
    ])).toEqual({
      command: 'eval-export', manifest: '/tmp/manifest.json', format: 'atif',
      output: '/tmp/trajectory.atif.json', force: true,
    });
  });

  it.each([['--help'], ['help']])('parses help form %j', (...args) => {
    expect(parseArgs(args)).toEqual({ command: 'help' });
  });

  it.each([['--version'], ['version']])('parses version form %j', (...args) => {
    expect(parseArgs(args)).toEqual({ command: 'version' });
  });

  it('keeps the CLI version aligned with its package', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(manifest.version);
  });

  const invalidArguments: string[][] = [
    [],
    ['repair'],
    ['heal'],
    ['heal', '--case-dir'],
    ['heal', '--case-dir', '/tmp/case', '--format', 'text'],
    ['heal', '--case-dir', '/tmp/case', '--format', 'json', '--unknown'],
    ['heal', '--case-dir', '/tmp/a', '--case-dir', '/tmp/b', '--format', 'json'],
    ['heal', '--case-dir', '/tmp/a', '--format', 'json', '--candidate-diff', ''],
    ['heal', '--case-dir', '/tmp/a', '--format', 'json', '--runtime', 'ruby'],
    ['heal', '--case-dir', '/tmp/a', '--format', 'json', '--failing-command', '   '],
    ['heal', '--case-dir', '/tmp/a', '--format', 'json', '--failing-command', 'pnpm test\npnpm lint'],
    ['heal', '--case-dir', '/tmp/a', '--format', 'json', '--failing-command', 'pnpm t\u00e9st'],
    ['heal', '--case-dir', '/tmp/a', '--format', 'json', '--failing-command', `pnpm test ${'-'.repeat(300)}`],
    ['heal', '--case-dir', '/tmp/a', '--format', 'json', '--failing-command', 'pnpm test', '--failing-command', 'pnpm lint'],
    ['init', '--repo', 'invalid'],
    ['init', '--workflow', 'CI', '--workflow', 'Tests'],
    ['init', '--action-sha', 'main'],
    ['doctor', '--unknown'],
    ['doctor', '--action-sha', 'abc'],
    ['audit'],
    ['audit', '--case-dir', '/tmp/case', '--candidate-diff', '/tmp/fix.diff', '--before-log', '/tmp/before.log', '--after-log', '/tmp/after.log', '--format', 'text'],
    ['audit', '--case-dir', '/tmp/case', '--candidate-diff', '/tmp/fix.diff', '--before-log', '/tmp/before.log', '--before-log', '/tmp/again.log', '--after-log', '/tmp/after.log', '--format', 'json'],
    ['replay', '--format', 'json'],
    ['replay', '--bundle', '/tmp/replay.json', '--format', 'json', '--unknown'],
    ['replay', '--bundle', '/tmp/replay.json', '--bundle', '/tmp/other.json', '--format', 'json'],
    ['replay', '--bundle', '/tmp/replay.json', '--format', 'text'],
    ['replay', '--bundle', '/tmp/replay.json', '--format', 'json', '--runtime', 'ruby'],
    ['eval'],
    ['eval', 'validate'],
    ['eval', 'validate', '--manifest', '/tmp/a', '--force'],
    ['eval', 'export', '--manifest', '/tmp/a', '--format', 'array', '--output', '/tmp/o'],
    ['eval', 'export', '--manifest', '/tmp/a', '--format', 'atif'],
  ];

  it.each(invalidArguments.map((args) => [args] as const))('rejects malformed arguments: %j', (args) => {
    expect(() => parseArgs(args)).toThrow(CliUsageError);
  });
});

describe('parseArgs counterfactual alternatives', () => {
  it('parses --alternatives-file as a path', () => {
    expect(parseArgs([
      'heal', '--case-dir', '/tmp/case', '--format', 'json',
      '--alternatives-file', '/tmp/alternatives.json',
    ])).toEqual({
      command: 'heal',
      caseDir: '/tmp/case',
      format: 'json',
      alternativesFile: '/tmp/alternatives.json',
      tavilyEnabled: true,
    });
  });

  it('omits the field when the flag is absent', () => {
    expect(parseArgs(['heal', '--case-dir', '/tmp/case', '--format', 'json']))
      .not.toHaveProperty('alternativesFile');
  });

  it.each([
    ['a missing value', ['heal', '--case-dir', '/tmp/case', '--format', 'json', '--alternatives-file']],
    ['a flag as the value', ['heal', '--case-dir', '/tmp/case', '--format', 'json', '--alternatives-file', '--no-tavily']],
    ['a duplicate flag', ['heal', '--case-dir', '/tmp/case', '--format', 'json', '--alternatives-file', '/a.json', '--alternatives-file', '/b.json']],
  ])('refuses %s', (_case, args) => {
    expect(() => parseArgs(args)).toThrow(CliUsageError);
  });

  it('documents the flag in the usage text', async () => {
    const { USAGE } = await import('./args.js');

    expect(USAGE).toContain('--alternatives-file <file>');
  });
});
