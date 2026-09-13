import { describe, expect, it, vi } from 'vitest';
import { completedTriageVerdict, notRunTriageVerdict } from '@sutura/core';

import { CliAdapter, SuturaAdapter } from './adapters.js';

const VALID_CASE_FILE = JSON.stringify({
  runId: 'run-1', repo: 'placebo/case',
  runtime: 'node',
  diagnosis: {
    class: 'dep-upstream-breaking', confidence: 0.9, signals: [], failingCmd: 'pnpm test', errorExcerpt: 'ERR_MODULE_NOT_FOUND',
    grounding: { query: 'chalk 5 esm', skipped: false, citations: [{ title: 'Chalk 5', url: 'https://github.com/chalk/chalk/releases/tag/v5.0.0', snippet: 'ESM only' }] },
  },
  triage: completedTriageVerdict([1, 1, 1, 1], 5), race: [],
  audit: { approved: true, checks: [], reasoning: 'approved' }, outcome: 'fixed', cost: { entries: [] },
  policy: { baseRef: 'local', baseSha: 'local', policySha: 'default' },
  stages: [{ stage: 'policy', attempt: 1, nodeId: 'node-001', metrics: {}, network: 'disabled' }],
});

describe('CLI adapters', () => {
  it('passes --no-tavily to Sutura without a shell', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: VALID_CASE_FILE, stderr: '', exitCode: 0 });
    const adapter = new SuturaAdapter({ tavilyEnabled: false, execute });
    await expect(adapter.heal('/tmp/example')).resolves.toMatchObject({ outcome: 'fixed' });
    expect(execute).toHaveBeenCalledWith('sutura', [
      'heal', '--case-dir', '/tmp/example', '--format', 'json', '--no-tavily',
    ], expect.any(Object));
  });

  it('passes a placebo candidate to Sutura as a distinct audit input', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: VALID_CASE_FILE, stderr: '', exitCode: 0 });
    const adapter = new SuturaAdapter({ execute });
    const candidateDiff = "diff --git a/test.js b/test.js\n-test('fails')\n+test.skip('fails')\n";

    await adapter.heal('/tmp/example', { candidateDiff });

    expect(execute).toHaveBeenCalledWith('sutura', [
      'heal', '--case-dir', '/tmp/example', '--format', 'json', '--candidate-diff', candidateDiff,
    ], expect.any(Object));
  });

  it.each([
    ['python', 'python'],
    ['javascript', 'node'],
    ['typescript', 'node'],
  ] as const)('maps trusted %s fixture metadata to the %s runtime selector', async (language, runtime) => {
    const execute = vi.fn().mockResolvedValue({ stdout: VALID_CASE_FILE, stderr: '', exitCode: 0 });

    await new SuturaAdapter({ execute }).heal('/tmp/example', { language });

    expect(execute).toHaveBeenCalledWith('sutura', [
      'heal', '--case-dir', '/tmp/example', '--format', 'json', '--runtime', runtime,
    ], expect.any(Object));
  });

  it('forwards the benchmark failing command to Sutura as one argv value', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: VALID_CASE_FILE, stderr: '', exitCode: 0 });
    const failingCommand = "python3 -B -m unittest discover -s tests -p 'test_*.py'";

    await new SuturaAdapter({ execute }).heal('/tmp/example', { language: 'python', failingCommand });

    expect(execute).toHaveBeenCalledWith('sutura', [
      'heal', '--case-dir', '/tmp/example', '--format', 'json', '--runtime', 'python',
      '--failing-command', failingCommand,
    ], expect.any(Object));
  });

  it('passes a placebo candidate to a generic CLI adapter too', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: VALID_CASE_FILE, stderr: '', exitCode: 0 });
    const candidateDiff = 'diff --git a/test.js b/test.js\n';

    await new CliAdapter({ command: 'repair-agent', execute }).heal('/tmp/example', { candidateDiff });

    expect(execute).toHaveBeenCalledWith('repair-agent', [
      '--case-dir', '/tmp/example', '--candidate-diff', candidateDiff,
    ], expect.any(Object));
  });

  it('accepts gave-up and rejects invented adapter fields', async () => {
    const gaveUpValue: Record<string, unknown> = { ...JSON.parse(VALID_CASE_FILE) as Record<string, unknown>, outcome: 'gave-up' };
    delete gaveUpValue.audit;
    const execute = vi.fn().mockResolvedValue({ stdout: JSON.stringify(gaveUpValue), stderr: '', exitCode: 0 });
    await expect(new CliAdapter({ command: 'agent', execute }).heal('/tmp/case')).resolves.toMatchObject({ outcome: 'gave-up' });

    execute.mockResolvedValueOnce({ stdout: '{"outcome":"fixed","grounded":true}', stderr: '', exitCode: 0 });
    await expect(new CliAdapter({ command: 'agent', execute }).heal('/tmp/case')).resolves.toMatchObject({ outcome: 'gave-up', diagnosis: { class: 'infra' } });
  });

  it.each([
    ['missing', undefined],
    ['mismatched', 'node'],
  ])('rejects %s runtime evidence for a trusted Python fixture', async (_name, returnedRuntime) => {
    const value = JSON.parse(VALID_CASE_FILE) as Record<string, unknown>;
    if (returnedRuntime === undefined) delete value.runtime;
    else value.runtime = returnedRuntime;
    const execute = vi.fn().mockResolvedValue({
      stdout: JSON.stringify(value), stderr: '', exitCode: 0,
    });

    await expect(new SuturaAdapter({ execute }).heal('/tmp/case', { language: 'python' }))
      .resolves.toMatchObject({
        outcome: 'gave-up',
        runtime: 'python',
        diagnosis: { errorExcerpt: expect.stringContaining('invalid adapter JSON') },
      });
  });

  it('does not infer the runtime selector from fixture path or candidate content', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: VALID_CASE_FILE, stderr: '', exitCode: 0 });
    const adapter = new SuturaAdapter({ execute });

    await adapter.heal('/tmp/python-fixture', {
      language: 'typescript',
      candidateDiff: 'diff --git a/runtime.py b/runtime.py\n',
    });

    expect(execute.mock.calls[0]?.[1]).toContain('node');
    expect(execute.mock.calls[0]?.[1]).not.toContain('python');
  });

  it('accepts a fail-closed infra-stop with triage not run', async () => {
    const value = JSON.parse(VALID_CASE_FILE) as Record<string, unknown>;
    value.outcome = 'infra-stop';
    value.triage = notRunTriageVerdict();
    delete value.audit;
    const execute = vi.fn().mockResolvedValue({ stdout: JSON.stringify(value), stderr: '', exitCode: 0 });

    await expect(new CliAdapter({ command: 'agent', execute }).heal('/tmp/case'))
      .resolves.toMatchObject({ outcome: 'infra-stop', triage: { status: 'not-run' } });
  });

  it('turns ENOENT, timeout, and oversized output into gave-up case files', async () => {
    await expect(new CliAdapter({ command: '/definitely/missing/placebo-agent' }).heal('/tmp/case')).resolves.toMatchObject({ outcome: 'gave-up' });
    await expect(new CliAdapter({ command: process.execPath, args: ['-e', 'setTimeout(() => {}, 10_000)', '--'], timeoutMs: 20 }).heal('/tmp/case')).resolves.toMatchObject({ outcome: 'gave-up', diagnosis: { errorExcerpt: expect.stringContaining('timed out') } });
    await expect(new CliAdapter({ command: process.execPath, args: ['-e', 'process.stdout.write("x".repeat(10000))', '--'], maxOutputBytes: 100 }).heal('/tmp/case')).resolves.toMatchObject({ outcome: 'gave-up', diagnosis: { errorExcerpt: expect.stringContaining('output limit') } });
  });

  it.each([
    { inTok: -1, outTok: 0, reasoningTok: 0, usd: 0 },
    { inTok: 1.5, outTok: 0, reasoningTok: 0, usd: 0 },
    { inTok: 0, outTok: -1, reasoningTok: 0, usd: 0 },
    { inTok: 0, outTok: 0, reasoningTok: -1, usd: 0 },
    { inTok: 0, outTok: 0, reasoningTok: 0, usd: -0.01 },
  ])('rejects invalid token and cost ledger values: $inTok/$outTok/$reasoningTok/$usd', async (entry) => {
    const value = JSON.parse(VALID_CASE_FILE) as Record<string, unknown>;
    value.cost = { entries: [{ role: 'super', model: 'model-a', ...entry }] };
    const execute = vi.fn().mockResolvedValue({ stdout: JSON.stringify(value), stderr: '', exitCode: 0 });
    await expect(new CliAdapter({ command: 'agent', execute }).heal('/tmp/case'))
      .resolves.toMatchObject({ outcome: 'gave-up', diagnosis: { class: 'infra' } });
  });
});

const COUNTERFACTUAL_ALTERNATIVE = {
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
};

function caseFileWithCounterfactual(alternative: unknown): string {
  return JSON.stringify({
    ...JSON.parse(VALID_CASE_FILE),
    counterfactual: {
      acceptedCandidateId: 'repair-1',
      alternatives: [alternative],
      cost: { inferenceUsd: 0, sandboxOperations: 1, elapsedTimeSec: 2 },
    },
  });
}

describe('counterfactual evidence at the adapter boundary', () => {
  it('accepts a case file carrying valid counterfactual evidence', async () => {
    const execute = vi.fn().mockResolvedValue({
      stdout: caseFileWithCounterfactual(COUNTERFACTUAL_ALTERNATIVE), stderr: '', exitCode: 0,
    });

    await expect(new CliAdapter({ command: 'agent', execute }).heal('/tmp/case'))
      .resolves.toMatchObject({
        outcome: 'fixed',
        counterfactual: { alternatives: [{ id: 'loosen-type', approved: false }] },
      });
  });

  it.each([
    ['an unknown gate', { rejectedBy: { gate: 'vibes', rule: 'r', evidence: 'e' } }],
    ['an unknown intent', { intent: 'clever' }],
    ['a malformed diff hash', { diffHash: 'not-a-hash' }],
    ['a non-integer test exit code', { testExitCode: 1.5 }],
    ['a malformed cost', { cost: { inferenceUsd: -1, sandboxOperations: 1, elapsedTimeSec: 2 } }],
    ['malformed checks', { checks: [{ name: 'loosened-type' }] }],
  ])('refuses counterfactual evidence with %s', async (_case, override) => {
    const execute = vi.fn().mockResolvedValue({
      stdout: caseFileWithCounterfactual({ ...COUNTERFACTUAL_ALTERNATIVE, ...override }),
      stderr: '', exitCode: 0,
    });

    await expect(new CliAdapter({ command: 'agent', execute }).heal('/tmp/case'))
      .resolves.toMatchObject({
        outcome: 'gave-up',
        diagnosis: { errorExcerpt: expect.stringContaining('does not match Sutura CaseFile') },
      });
  });
});

describe('counterfactual alternatives at the adapter boundary', () => {
  it('passes the harness-written alternatives file as a path, never as diffs', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: VALID_CASE_FILE, stderr: '', exitCode: 0 });

    await new SuturaAdapter({ execute }).heal('/tmp/example', {
      alternativesFile: '/tmp/run-x/alternatives.json',
    });

    expect(execute).toHaveBeenCalledWith('sutura', [
      'heal', '--case-dir', '/tmp/example', '--format', 'json',
      '--alternatives-file', '/tmp/run-x/alternatives.json',
    ], expect.any(Object));
    expect(JSON.stringify(execute.mock.calls)).not.toContain('diff --git');
  });

  it('passes the alternatives file to a generic CLI adapter too', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: VALID_CASE_FILE, stderr: '', exitCode: 0 });

    await new CliAdapter({ command: 'repair-agent', execute }).heal('/tmp/example', {
      alternativesFile: '/tmp/run-x/alternatives.json',
    });

    expect(execute).toHaveBeenCalledWith('repair-agent', [
      '--case-dir', '/tmp/example', '--alternatives-file', '/tmp/run-x/alternatives.json',
    ], expect.any(Object));
  });

  it('omits the flag when the harness supplied no set', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: VALID_CASE_FILE, stderr: '', exitCode: 0 });

    await new SuturaAdapter({ execute }).heal('/tmp/example');

    expect(execute.mock.calls[0]?.[1]).not.toContain('--alternatives-file');
  });
});
