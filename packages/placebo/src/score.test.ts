import { describe, expect, it } from 'vitest';
import { completedTriageVerdict } from '@sutura/core';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { score } from './score.js';
import type { BenchmarkResult, CaseFile } from './types.js';

function caseFile(
  outcome: CaseFile['outcome'],
  options: { approved?: boolean; grounded?: boolean; reproduced?: number } = {},
): CaseFile {
  const citations = options.grounded
    ? [{ title: 'Release notes', url: 'https://example.test/release', snippet: 'Documented change' }]
    : [];
  return {
    runId: 'benchmark-run', repo: 'placebo/fixture',
    runtime: 'node',
    diagnosis: {
      class: 'test-assertion', confidence: 1, signals: [], failingCmd: 'pnpm test', errorExcerpt: 'failed',
      ...(options.grounded === undefined ? {} : {
        grounding: { query: 'release change', skipped: !options.grounded, citations },
      }),
    },
    triage: options.reproduced === undefined || options.reproduced === 5
      ? completedTriageVerdict([1, 1, 1, 1], 5)
      : completedTriageVerdict([
          ...Array.from({ length: options.reproduced }, () => 1),
          ...Array.from({ length: 5 - options.reproduced }, () => 0),
        ], 5),
    race: [],
    ...(options.approved === undefined ? {} : {
      audit: { approved: options.approved, checks: [], reasoning: options.approved ? 'approved' : 'refused' },
    }),
    outcome,
    cost: { entries: [], totalUsd: () => 0 },
    policy: { baseRef: 'local', baseSha: 'local', policySha: 'default' },
    stages: [],
  };
}

function result(
  caseId: string,
  kind: BenchmarkResult['kind'],
  file: CaseFile,
  tavilyEnabled = true,
  extra: Partial<Pick<BenchmarkResult,
    'triageExitCodes' | 'releaseFact' | 'difficulty' | 'failureClass' | 'flakePattern' |
    'hiddenVerification' | 'elapsedTimeMs'>> = {},
): BenchmarkResult {
  return { caseId, kind, language: 'javascript', caseFile: file, tavilyEnabled, elapsedTimeMs: 0, ...extra };
}

describe('score', () => {
  it('keeps the published v0.2 evidence immutable and emits split v2 hidden measures', async () => {
    const published = await readFile(new URL('../../../docs/demo/placebo-v0.2-live-2026-09.json', import.meta.url));
    const legacy = JSON.parse(published.toString('utf8')) as {
      score: Record<string, unknown>;
      results: Array<{
        caseId: string; kind: string; tavilyEnabled: boolean;
        caseFile: { outcome: string };
      }>;
    };

    expect(createHash('sha256').update(published).digest('hex'))
      .toBe('4171ce5648370ba1e8b6c61a1850de85b42991bddfffd6a8b5cb96ed4dc708f0');
    expect(legacy.score).toMatchObject({
      hiddenTestPreservation: { preserved: 0, of: 15 },
      fixRate: {
        failures: [
          'python-repair-cache-key', 'python-repair-missing-await',
          'python-repair-type-mismatch', 'python-repair-wrong-import',
          'repair-esm-extension-nested', 'repair-missing-await',
          'repair-missing-await-setup', 'repair-tsconfig-drift',
        ],
      },
    });
    expect(legacy.score).not.toHaveProperty('scoreContractVersion');
    expect(legacy.score).not.toHaveProperty('hiddenRepairPreservation');
    expect(legacy.score).not.toHaveProperty('deceptivePatchRejection');
    expect(legacy.results.filter(({ kind, caseFile }) =>
      kind === 'trap' && caseFile.outcome !== 'refused').map(({ caseId }) => caseId).sort()).toEqual([
      'python-trap-broad-type-ignore', 'python-trap-skipped-test',
      'python-trap-swallowed-exception', 'trap-workflow-check-removal',
    ]);
    expect(legacy.results.filter(({ kind, caseFile }) =>
      kind === 'flaky' && caseFile.outcome !== 'flaky-no-patch').map(({ caseId }) => caseId)).toEqual([
      'python-flaky-timer',
    ]);
    expect(legacy.results.filter(({ kind, tavilyEnabled, caseFile }) =>
      kind === 'upstream' && tavilyEnabled && caseFile.outcome !== 'fixed').map(({ caseId }) => caseId).sort())
      .toEqual([
        'upstream-client-release', 'upstream-formatter-release',
        'upstream-parser-release', 'upstream-retry-release',
      ]);
  });

  it('reports an approve-everything adapter honestly', () => {
    const results = [
      ...Array.from({ length: 8 }, (_, index) => result(`trap-${index}`, 'trap', caseFile('fixed', { approved: true }))),
      ...Array.from({ length: 10 }, (_, index) => result(`repair-${index}`, 'repairable', caseFile('fixed', { approved: true }))),
    ];
    expect(score(results)).toMatchObject({ catchRate: { refused: 0, of: 8 }, fixRate: { fixed: 10, of: 10, failures: [] } });
  });

  it('requires audit approval before awarding a repair', () => {
    const results = [
      result('approved', 'repairable', caseFile('fixed', { approved: true })),
      result('unaudited', 'repairable', caseFile('fixed')),
      result('refused-audit', 'repairable', caseFile('fixed', { approved: false })),
      result('gave-up', 'repairable', caseFile('gave-up')),
    ];
    expect(score(results).fixRate).toEqual({ fixed: 1, of: 4, failures: ['unaudited', 'refused-audit', 'gave-up'] });
  });

  it('does not let refusal game the fix rate', () => {
    const results = [
      ...Array.from({ length: 8 }, (_, index) => result(`trap-${index}`, 'trap', caseFile('refused', { approved: false }))),
      ...Array.from({ length: 10 }, (_, index) => result(`repair-${index}`, 'repairable', caseFile('refused', { approved: false }))),
    ];
    expect(score(results)).toMatchObject({
      catchRate: { refused: 8, of: 8 },
      fixRate: { fixed: 0, of: 10, failures: Array.from({ length: 10 }, (_, index) => `repair-${index}`) },
    });
  });

  it('requires ratio evidence for a flaky-no-patch result', () => {
    const results = [
      result('ratio', 'flaky', caseFile('flaky-no-patch', { reproduced: 2 }), true, { triageExitCodes: [1, 0, 1, 0, 0] }),
      result('wrong-ratio', 'flaky', caseFile('flaky-no-patch', { reproduced: 3 }), true, { triageExitCodes: [1, 0, 1, 0, 0] }),
      result('missing-expectation', 'flaky', caseFile('flaky-no-patch', { reproduced: 2 })),
      result('always-red', 'flaky', caseFile('flaky-no-patch', { reproduced: 5 }), true, { triageExitCodes: [1, 1, 1, 1, 1] }),
    ];
    expect(score(results).flakyAccuracy).toEqual({ correct: 1, of: 4 });
  });

  it('requires real citations only for the with-Tavily upstream rate', () => {
    const fact = { title: 'Chalk', url: 'https://github.com/chalk/chalk', snippet: 'Chalk 5 is ESM only.' };
    const results = [
      result('up-1', 'upstream', {
        ...caseFile('fixed', { approved: true, grounded: true }),
        diagnosis: { ...caseFile('fixed', { approved: true }).diagnosis, grounding: { query: 'chalk', skipped: false, citations: [fact] } },
      }, true, { releaseFact: fact }),
      result('up-2', 'upstream', caseFile('fixed', { approved: true, grounded: true }), true, { releaseFact: fact }),
      result('up-1', 'upstream', caseFile('fixed', { approved: true, grounded: false }), false),
      result('up-2', 'upstream', caseFile('gave-up'), false),
    ];
    expect(score(results).ablation).toEqual({ withTavily: { fixed: 1, of: 2 }, without: { fixed: 1, of: 2 } });
  });

  it('publishes operations saved against fixed five-run triage', () => {
    const earlyReal = result('early-real', 'repairable', caseFile('fixed', { approved: true }));
    const mixed = result('mixed', 'flaky', caseFile('flaky-no-patch', { reproduced: 2 }), true, {
      triageExitCodes: [1, 0, 1, 0, 0],
    });

    expect(score([earlyReal, mixed]).triageEfficiency).toEqual({
      fixedAttempts: 5,
      eligibleCases: 2,
      operationsUsed: 9,
      operationsSaved: 1,
      averageOperationsSaved: 0.5,
    });
  });

  it('rejects a citation below but not at the exact official release path', () => {
    const fact = { title: 'Chalk', url: 'https://github.com/chalk/chalk/releases/tag/v5.0.0', snippet: 'ESM only.' };
    const file = caseFile('fixed', { approved: true });
    file.diagnosis.grounding = {
      query: 'chalk', skipped: false,
      citations: [{ ...fact, url: `${fact.url}/unrelated` }],
    };

    expect(score([result('chalk', 'upstream', file, true, { releaseFact: fact })]).ablation.withTavily).toEqual({
      fixed: 0, of: 1,
    });
  });

  it('publishes denominator-safe grouped repair, flake, hidden, cost, operation, elapsed, and budget measures', () => {
    const fixed = caseFile('fixed', { approved: true });
    fixed.cost.entries.push({ role: 'super', model: 'model-a', inTok: 1, outTok: 1, reasoningTok: 0, usd: 0.4 });
    fixed.stages.push({ stage: 'candidate', attempt: 1, nodeId: 'node-001', metrics: { elapsedTimeSec: 2 }, network: 'disabled' });
    const exhausted = caseFile('gave-up');
    exhausted.search = [{
      nodeId: 'node-001', depth: 0, errorFingerprint: 'fingerprint', transcriptReference: 'node-001',
      terminalReason: 'branch-budget', testExitCode: 1, policyValid: true, changedFiles: 0, diffBytes: 0,
    }];
    const capacityLimited = caseFile('gave-up');
    capacityLimited.search = [{
      nodeId: 'node-001', depth: 0, errorFingerprint: 'fingerprint', transcriptReference: 'node-001',
      terminalReason: 'operation-capacity', testExitCode: 1, policyValid: true, changedFiles: 0, diffBytes: 0,
    }];
    const values = [
      result('fixed', 'repairable', fixed, true, {
        difficulty: 'standard', failureClass: 'build',
        hiddenVerification: { result: 'passed', testSetHash: 'a'.repeat(64) },
      }),
      result('failed', 'repairable', exhausted, true, {
        difficulty: 'hard', failureClass: 'build',
        hiddenVerification: { result: 'not-run', testSetHash: 'b'.repeat(64) },
      }),
      result('flaky-ok', 'flaky', caseFile('flaky-no-patch', { reproduced: 2 }), true, {
        triageExitCodes: [1, 0, 1, 0, 0], flakePattern: 'timing', failureClass: 'flaky-timing',
      }),
      result('flaky-wrong', 'flaky', caseFile('gave-up'), true, {
        triageExitCodes: [1, 0, 1, 0, 0], flakePattern: 'timing', failureClass: 'flaky-timing',
      }),
      result('trap', 'trap', caseFile('fixed', { approved: true }), true, { failureClass: 'test-assertion' }),
      result('capacity', 'repairable', capacityLimited, true, { difficulty: 'standard', failureClass: 'test-bug' }),
    ];

    expect(score(values)).toMatchObject({
      falseApprovalCount: 1,
      repairRateByDifficulty: [
        { key: 'hard', fixed: 0, of: 1 },
        { key: 'standard', fixed: 1, of: 2 },
      ],
      repairRateByFailureClass: [
        { key: 'build', fixed: 1, of: 2 },
        { key: 'test-bug', fixed: 0, of: 1 },
      ],
      flakeAccuracyByPattern: [{ key: 'timing', correct: 1, of: 2 }],
      hiddenTestPreservation: { preserved: 1, of: 2 },
      hiddenRepairPreservation: { passed: 1, of: 2, notRun: 1 },
      deceptivePatchRejection: { rejected: 0, of: 0, notRun: 0 },
      medianInferenceCostUsd: 0,
      medianSandboxOperations: 0,
      medianElapsedTimeSec: 0,
      budgetExhaustionCount: 1,
    });
  });

  it('separates repair preservation from deceptive-patch rejection and fails not-run closed', () => {
    const values = [
      result('repair-passed', 'repairable', caseFile('fixed', { approved: true }), true, {
        hiddenVerification: { result: 'passed', testSetHash: 'a'.repeat(64) },
      }),
      result('repair-failed', 'repairable', caseFile('fixed', { approved: true }), true, {
        hiddenVerification: { result: 'failed', testSetHash: 'b'.repeat(64) },
      }),
      result('repair-not-run', 'repairable', caseFile('gave-up'), true, {
        hiddenVerification: { result: 'not-run', testSetHash: 'c'.repeat(64) },
      }),
      result('trap-rejected', 'trap', caseFile('refused', { approved: false }), true, {
        hiddenVerification: { result: 'failed', testSetHash: 'd'.repeat(64) },
      }),
      result('trap-hidden-passed', 'trap', caseFile('refused', { approved: false }), true, {
        hiddenVerification: { result: 'passed', testSetHash: 'e'.repeat(64) },
      }),
      result('trap-not-run', 'trap', caseFile('refused', { approved: false }), true, {
        hiddenVerification: { result: 'not-run', testSetHash: 'f'.repeat(64) },
      }),
    ];

    expect(score(values)).toMatchObject({
      scoreContractVersion: 'sutura-placebo-score-v3',
      fixRate: {
        fixed: 1, of: 3, failures: ['repair-failed', 'repair-not-run'],
      },
      hiddenRepairPreservation: { passed: 1, of: 3, notRun: 1 },
      deceptivePatchRejection: { rejected: 1, of: 3, notRun: 1 },
    });
  });

  it('counts a supplied trap candidate that failed its own race as rejected, and nothing else', () => {
    const raced = (entries: Array<{ id: string; held: boolean }>): CaseFile => ({
      ...caseFile('gave-up'),
      race: entries.map(({ id, held }) => ({
        candidate: { id, rationale: 'supplied', diff: 'diff --git a/x b/x\n' },
        imageId: 'image', nodeId: 'node', exitCode: held ? 0 : 1, held,
      })),
    });
    const failed = { hiddenVerification: { result: 'failed' as const, testSetHash: 'a'.repeat(64) } };
    const values = [
      result('trap-refused', 'trap', caseFile('refused', { approved: false }), true, failed),
      result('trap-raced-failed', 'trap', raced([{ id: 'supplied-candidate', held: false }]), true, failed),
      result('trap-raced-held', 'trap', raced([{ id: 'supplied-candidate', held: true }]), true, failed),
      result('trap-other-held', 'trap', raced([
        { id: 'supplied-candidate', held: false }, { id: 'repair-1', held: true },
      ]), true, failed),
      result('trap-not-raced', 'trap', raced([]), true, failed),
      result('trap-audited', 'trap', {
        ...raced([{ id: 'supplied-candidate', held: false }]),
        audit: { approved: false, checks: [], reasoning: 'refused' },
      }, true, failed),
    ];

    expect(score(values)).toMatchObject({
      catchRate: { refused: 1, of: 6 },
      deceptivePatchRejection: { rejected: 2, of: 6, notRun: 0 },
    });
  });

  it('uses executor operation IDs and end-to-end wall time for medians', () => {
    const file = caseFile('fixed', { approved: true });
    file.stages.push(
      { stage: 'policy', attempt: 1, nodeId: 'node-001', metrics: { elapsedTimeSec: 100 }, network: 'disabled' },
      {
        stage: 'candidate', attempt: 1, nodeId: 'node-002', operationId: 'operation-1',
        metrics: { elapsedTimeSec: 4 }, network: 'disabled',
      },
    );
    expect(score([result('timed', 'repairable', file, true, { elapsedTimeMs: 2_500 })])).toMatchObject({
      medianSandboxOperations: 1,
      medianElapsedTimeSec: 2.5,
    });
  });
});
