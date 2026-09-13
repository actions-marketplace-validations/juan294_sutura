import { DEFAULT_MODELS, DEFAULT_REPAIR_BUDGET_LIMITS, DEFAULT_ROUTING_PROFILE_ID } from '@sutura/core';
import { describe, expect, it } from 'vitest';

import { ARENA_REPORT_SCHEMA_VERSION, ArenaReportError, arenaReport, renderArena } from './arena.js';
import { ARM_SEARCH_LIMITS } from './baseline.js';
import {
  budgetProfileHash,
  createComparison,
  SCORE_CONTRACT_VERSION,
  type ComparisonArm,
  type ComparisonManifest,
  type ComparisonObservation,
} from './comparison.js';
import { score } from './score.js';
import type { CounterfactualReport } from './counterfactual.js';
import type { Score } from './types.js';

const CASE_IDS = ['case-a', 'case-b', 'case-c', 'case-d'] as const;

function observation(
  caseId: string,
  overrides: Partial<ComparisonObservation> = {},
): ComparisonObservation {
  return {
    caseId,
    kind: caseId === 'case-d' ? 'trap' : 'repairable',
    language: caseId === 'case-c' ? 'python' : 'javascript',
    failureClass: caseId === 'case-b' ? 'typecheck' : 'test-assertion',
    outcome: 'fixed',
    approved: true,
    falseApproval: false,
    hiddenVerification: 'passed',
    inferenceUsd: 0.1,
    sandboxOperations: 5,
    elapsedTimeSec: 20,
    ...overrides,
  };
}

function armScore(fixed: number, of: number, falseApprovals = 0): Score {
  return {
    ...score([]),
    fixRate: { fixed, of, failures: [] },
    catchRate: { refused: of - fixed, of },
    falseApprovalCount: falseApprovals,
    flakyAccuracy: { correct: fixed, of },
  };
}

function armRecord(
  name: ComparisonArm,
  approvedCount: number,
  falseApprovals = 0,
) {
  const derived = name === 'first-green-wins';
  const observations = CASE_IDS.map((caseId, index) => observation(caseId, index < approvedCount
    ? {}
    : { outcome: 'gave-up', approved: false, hiddenVerification: 'not-run' }));
  return {
    arm: name,
    searchLimits: derived
      ? null
      : { ...ARM_SEARCH_LIMITS[name as Exclude<ComparisonArm, 'first-green-wins'>] },
    auditEnabled: !derived,
    derived,
    observations,
    score: armScore(approvedCount, CASE_IDS.length, falseApprovals),
  };
}

function manifest(complete = true): ComparisonManifest {
  return createComparison({
    comparisonId: 'arena-control-v0.2',
    invariants: {
      caseIds: [...CASE_IDS],
      corpusName: 'placebo',
      corpusVersion: '0.2',
      corpusHash: 'a'.repeat(64),
      models: { ...DEFAULT_MODELS },
      routingProfile: DEFAULT_ROUTING_PROFILE_ID,
      budgetProfileHash: budgetProfileHash(DEFAULT_REPAIR_BUDGET_LIMITS),
      scoreContractVersion: SCORE_CONTRACT_VERSION,
      tavilyEnabled: true,
      suturaCommit: 'b'.repeat(40),
    },
    arms: complete
      ? [
        armRecord('sutura', 3),
        armRecord('single-branch', 2),
        armRecord('fixed-parallel', 2),
        armRecord('first-green-wins', 4, 1),
      ]
      : [armRecord('sutura', 3)],
  });
}

const COUNTERFACTUAL = {
  schemaVersion: 'sutura-counterfactual-v1',
  resultHash: 'c'.repeat(64),
  totals: {
    cases: 5, alternatives: 15, rejected: 14, shortcuts: 10, shortcutsRejected: 10,
    expectationMismatches: 0, inferenceUsd: 0, sandboxOperations: 17, elapsedTimeSec: 10,
  },
  cases: [{
    alternatives: [
      { observed: { gate: 'mechanical', rule: 'loosened-type', evidence: '' } },
      { observed: { gate: 'patch-policy', rule: 'deletes test file', evidence: '' } },
      { observed: null },
    ],
  }],
} as unknown as CounterfactualReport;

describe('Arena report', () => {
  it('computes every roadmap measure from one validated comparison', () => {
    const report = arenaReport(manifest(), { generatedAt: '2026-09-04T00:00:00.000Z' });

    expect(report.schemaVersion).toBe(ARENA_REPORT_SCHEMA_VERSION);
    expect(report.complete).toBe(true);
    expect(report.measures.arms.map(({ arm }) => arm))
      .toEqual(['sutura', 'single-branch', 'fixed-parallel', 'first-green-wins']);
    expect(report.measures.arms[0]?.repairRate).toMatchObject({ numerator: 3, denominator: 4 });
    expect(report.measures.arms[3]?.falseApprovals).toBe(1);
    expect(report.measures.byLanguage.some(({ key }) => key === 'python')).toBe(true);
    expect(report.measures.byFailureClass.some(({ key }) => key === 'typecheck')).toBe(true);
    expect(report.measures.refusalReasons.length).toBeGreaterThan(0);
    expect(report.measures.tokenTotals.sandboxOperations).toBeGreaterThan(0);
  });

  it('lists every case no arm repaired without removing it from a denominator', () => {
    const report = arenaReport(manifest(), { generatedAt: '2026-09-04T00:00:00.000Z' });

    for (const arm of report.comparison.arms) {
      expect(arm.observations).toHaveLength(CASE_IDS.length);
      expect(arm.score.fixRate.of).toBe(CASE_IDS.length);
    }
    expect(report.measures.completeFailures).toEqual([]);

    const allFail = arenaReport(createComparison({
      comparisonId: 'arena-fail',
      invariants: manifest().invariants,
      arms: [
        armRecord('sutura', 0), armRecord('single-branch', 0),
        armRecord('fixed-parallel', 0), armRecord('first-green-wins', 0),
      ],
    }), { generatedAt: '2026-09-04T00:00:00.000Z' });
    expect(allFail.measures.completeFailures).toEqual([...CASE_IDS]);
    expect(renderArena(allFail)).toContain('case-a');
  });

  it('refuses an incomplete comparison unless the draft is asked for and labelled', () => {
    expect(() => arenaReport(manifest(false))).toThrow(ArenaReportError);

    const draft = arenaReport(manifest(false), {
      allowIncomplete: true, generatedAt: '2026-09-04T00:00:00.000Z',
    });
    expect(draft.complete).toBe(false);
    expect(renderArena(draft)).toContain('Incomplete comparison');
  });

  it('hashes stably across generation time and timings, and unstably across measures', () => {
    const first = arenaReport(manifest(), { generatedAt: '2026-09-04T00:00:00.000Z' });
    const later = arenaReport(manifest(), { generatedAt: '2030-01-01T00:00:00.000Z' });
    expect(later.resultHash).toBe(first.resultHash);

    const different = arenaReport(createComparison({
      comparisonId: 'arena-control-v0.2',
      invariants: manifest().invariants,
      arms: [
        armRecord('sutura', 4), armRecord('single-branch', 2),
        armRecord('fixed-parallel', 2), armRecord('first-green-wins', 4, 1),
      ],
    }), { generatedAt: '2026-09-04T00:00:00.000Z' });
    expect(different.resultHash).not.toBe(first.resultHash);
  });

  it('summarizes counterfactual evidence without repeating a patch body', () => {
    const report = arenaReport(manifest(), {
      counterfactual: COUNTERFACTUAL,
      generatedAt: '2026-09-04T00:00:00.000Z',
    });

    expect(report.counterfactual).toMatchObject({
      cases: 5, alternatives: 15, rejected: 14, shortcutsRejected: 10,
      gates: ['mechanical', 'patch-policy'],
    });
    const html = renderArena(report);
    expect(html).toContain('14 of 15 alternative patches');
    expect(html).toContain('10 declared shortcuts');
    expect(html).not.toContain('diff --git');
  });
});

describe('Arena page', () => {
  const report = arenaReport(manifest(), {
    counterfactual: COUNTERFACTUAL,
    generatedAt: '2026-09-04T00:00:00.000Z',
  });

  it('states what is held identical and renders every measure heading', () => {
    const html = renderArena(report);

    expect(html).toContain('the same models, the same routing profile');
    for (const heading of [
      'Why green is not sufficient',
      'Measures by arm',
      'Results by language',
      'Results by failure class',
      'Complete failures and refusal reasons',
    ]) {
      expect(html).toContain(heading);
    }
    for (const column of [
      'Repair rate', 'Catch rate', 'False approvals', 'Flake accuracy',
      'Median latency', 'p95 latency', 'Inference', 'Sandbox ops',
    ]) {
      expect(html).toContain(column);
    }
    expect(html).toContain(report.comparison.resultHash);
    expect(html).toContain(report.resultHash);
  });

  it('renders a control banner above every number when a note is supplied', () => {
    const control = arenaReport(manifest(), {
      note: 'CONTROL ARTIFACT — NOT A SUTURA RESULT.',
      generatedAt: '2026-09-04T00:00:00.000Z',
    });

    expect(control.note).toBe('CONTROL ARTIFACT — NOT A SUTURA RESULT.');
    const html = renderArena(control);
    expect(html).toContain('CONTROL ARTIFACT');
    expect(html.indexOf('CONTROL ARTIFACT')).toBeLessThan(html.indexOf('Sutura repair rate'));
    expect(control.resultHash).not.toBe(report.resultHash);
  });

  it('carries no script and no external resource', () => {
    const html = renderArena(report);

    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/(?:src|href)="https?:/u);
  });

  it('escapes untrusted identifiers', () => {
    const hostile = arenaReport(createComparison({
      comparisonId: '<script>alert("arena")</script>',
      invariants: manifest().invariants,
      arms: [
        armRecord('sutura', 3), armRecord('single-branch', 2),
        armRecord('fixed-parallel', 2), armRecord('first-green-wins', 4, 1),
      ],
    }), { generatedAt: '2026-09-04T00:00:00.000Z' });

    const html = renderArena(hostile);
    expect(html).not.toContain('<script>alert("arena")</script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;arena&quot;)&lt;/script&gt;');
  });
});
