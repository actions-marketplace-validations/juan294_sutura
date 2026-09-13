import { describe, expect, it } from 'vitest';

import type { TraceEvent } from '@sutura/core';

import { exportAtif } from './atif.js';
import { exportJsonl } from './jsonl.js';
import { createEvaluationManifest, evaluationResultHash } from './manifest.js';
import { validateEvaluationManifest } from './validate.js';

function trace(
  runId: string,
  requestId = '[request-id]',
  timestampMs = 0,
  outcome: 'fixed' | 'refused' = 'fixed',
): TraceEvent[] {
  return [
    {
      schemaVersion: 'sutura-trace-v1', runId, sequence: 1, timestampMs,
      type: 'run-start', stage: 'run', summary: 'started',
    },
    {
      schemaVersion: 'sutura-trace-v1', runId, sequence: 2, timestampMs: timestampMs + 7,
      type: 'model-response', stage: 'candidate', role: 'assistant', model: 'nvidia/model-a',
      summary: 'selected a bounded repair', inputTokens: 10, outputTokens: 5,
      reasoningTokens: 0, latencyMs: 7, costUsd: 0.01, requestId,
    },
    {
      schemaVersion: 'sutura-trace-v1', runId, sequence: 3, timestampMs: timestampMs + 9,
      type: 'tool-request', stage: 'candidate', toolCallId: 'call-1', toolName: 'run_test',
      argumentSummary: { commandId: 'diagnosed' }, childNodeId: 'search-001',
    },
    {
      schemaVersion: 'sutura-trace-v1', runId, sequence: 4, timestampMs: timestampMs + 12,
      type: 'tool-result', stage: 'candidate', toolCallId: 'call-1', toolName: 'run_test',
      resultSummary: 'exit 0', childNodeId: 'search-001',
    },
    {
      schemaVersion: 'sutura-trace-v1', runId, sequence: 5, timestampMs: timestampMs + 13,
      type: 'run-finish', stage: 'run', outcome,
    },
  ];
}

function manifest() {
  return createEvaluationManifest({
    evaluationId: 'eval-1',
    suturaCommit: 'a'.repeat(40),
    repositoryClean: true,
    corpusName: 'placebo',
    corpusVersion: '0.1',
    corpusHash: 'b'.repeat(64),
    adapterVersion: '0.2.0',
    modelCatalogSnapshot: ['nvidia/model-a'],
    routingProfile: 'adaptive-default',
    budgetProfile: 'default',
    startedAt: '2026-08-29T00:00:00.000Z',
    completedAt: '2026-08-29T00:01:00.000Z',
    cases: [
      { caseId: 'case-fixed', outcome: 'fixed', trace: trace('run-fixed') },
      { caseId: 'case-refused', outcome: 'refused', trace: trace('run-refused', '[request-id]', 0, 'refused') },
    ],
  });
}

describe('evaluation exports', () => {
  it('binds a clean exact commit and retains unsuccessful cases', () => {
    const value = manifest();
    expect(validateEvaluationManifest(value)).toEqual(value);
    expect(value.cases.map(({ outcome }) => outcome)).toEqual(['fixed', 'refused']);
    expect(value.resultHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => createEvaluationManifest({
      ...value, repositoryClean: false, resultHash: undefined,
    })).toThrow(/clean repository/u);
  });

  it('excludes timestamps and request IDs from normalized result hashes', () => {
    const first = manifest();
    const second = createEvaluationManifest({
      ...first,
      startedAt: '2030-01-01T00:00:00.000Z',
      completedAt: '2030-01-01T00:02:00.000Z',
      cases: first.cases.map((item) => ({
        ...item,
        trace: trace(item.trace[0]!.runId, 'different-provider-id', 9_000, item.outcome === 'refused' ? 'refused' : 'fixed'),
      })),
      repositoryClean: true,
      resultHash: undefined,
    });
    expect(second.resultHash).toBe(first.resultHash);
    expect(exportJsonl(second)).not.toContain('different-provider-id');
    expect(JSON.stringify(exportAtif(second))).not.toContain('different-provider-id');
    expect(exportJsonl(second)).toContain('[request-id]');
  });

  it('rejects malformed or unsafe trace events before every export', () => {
    const mutations: Array<(value: ReturnType<typeof manifest>) => void> = [
      (value) => { value.cases[0]!.trace[1]!.timestampMs = -1; },
      (value) => { (value.cases[0]!.trace[1] as unknown as Record<string, unknown>).stage = 'private'; },
      (value) => { value.cases[0]!.trace[1]!.runId = 'different-run'; },
      (value) => { delete (value.cases[0]!.trace[1] as unknown as Record<string, unknown>).model; },
      (value) => {
        const event = value.cases[0]!.trace[1];
        if (event?.type === 'model-response') event.inputTokens = 0.5;
      },
      (value) => {
        Object.assign(value.cases[0]!.trace[2]!.type === 'tool-request'
          ? value.cases[0]!.trace[2]!.argumentSummary
          : {}, { reasoning_content: 'x', api_key: 'y', source: 'z' });
      },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(manifest());
      mutate(value);
      value.resultHash = evaluationResultHash(value);
      expect(() => validateEvaluationManifest(value)).toThrow();
      expect(() => exportAtif(value)).toThrow();
      expect(() => exportJsonl(value)).toThrow();
    }
  });

  it('exports one deterministic ATIF v1.7 trajectory per case', () => {
    const first = exportAtif(manifest());
    const second = exportAtif(manifest());
    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({
      caseId: 'case-fixed',
      trajectory: {
        schema_version: 'ATIF-v1.7', session_id: 'run-fixed', trajectory_id: 'run-fixed',
        agent: { name: 'Sutura', version: '0.2.0', model_name: 'nvidia/model-a' },
      },
    });
    expect(JSON.stringify(first)).not.toContain('reasoning_content');
    expect(JSON.stringify(first)).not.toContain('internal_url');
  });

  it('exports deterministic sanitized JSONL with every case in the denominator', () => {
    const output = exportJsonl(manifest());
    expect(output).toBe(exportJsonl(manifest()));
    const records = output.trimEnd().split('\n').map((line) => JSON.parse(line));
    expect(records.map(({ caseId }) => caseId)).toEqual(['case-fixed', 'case-refused']);
    expect(records.map(({ outcome }) => outcome)).toEqual(['fixed', 'refused']);
  });
});

function counterfactualTrace(runId: string): TraceEvent[] {
  const base = trace(runId);
  return [
    ...base.slice(0, -1),
    {
      schemaVersion: 'sutura-trace-v1', runId, sequence: 5, timestampMs: 13,
      type: 'counterfactual-result', stage: 'audit', alternativeId: 'loosen-type',
      intent: 'shortcut', approved: false, gate: 'mechanical', rule: 'loosened-type',
      summary: 'REFUSED: deterministic checks found green-washing (loosened-type).',
      childNodeId: 'node-004',
    },
    {
      schemaVersion: 'sutura-trace-v1', runId, sequence: 6, timestampMs: 14,
      type: 'counterfactual-result', stage: 'audit', alternativeId: 'exact-boundary',
      intent: 'plausible', approved: true, gate: '', rule: '',
      summary: 'The patch repairs the diagnosed cause.', childNodeId: 'node-005',
    },
    {
      schemaVersion: 'sutura-trace-v1', runId, sequence: 7, timestampMs: 15,
      type: 'run-finish', stage: 'run', outcome: 'fixed',
    },
  ];
}

function counterfactualManifest(events = counterfactualTrace('run-counterfactual')) {
  return createEvaluationManifest({
    ...manifest(),
    resultHash: undefined,
    repositoryClean: true,
    cases: [{ caseId: 'case-counterfactual', outcome: 'fixed', trace: events }],
  });
}

describe('counterfactual evidence in the evaluation formats', () => {
  it('validates a manifest carrying counterfactual results', () => {
    const value = counterfactualManifest();

    expect(validateEvaluationManifest(value)).toEqual(value);
  });

  it('refuses an unsupported field on a counterfactual event', () => {
    const events = counterfactualTrace('run-counterfactual');
    const tampered = events.map((event, index) =>
      index === 4 ? { ...event, diff: 'diff --git a/x b/x' } : event) as TraceEvent[];

    expect(() => counterfactualManifest(tampered)).not.toThrow();
    expect(() => validateEvaluationManifest(counterfactualManifest(tampered)))
      .toThrow('Unsupported field: diff');
  });

  it('refuses a gate without a rule and a rule that contradicts the verdict', () => {
    const events = counterfactualTrace('run-counterfactual');
    const noRule = events.map((event, index) =>
      index === 4 ? { ...event, rule: '' } : event) as TraceEvent[];
    expect(() => validateEvaluationManifest(counterfactualManifest(noRule)))
      .toThrow(/gate and .*rule must both be set or both be empty/u);

    const approvedWithGate = events.map((event, index) =>
      index === 4 ? { ...event, approved: true } : event) as TraceEvent[];
    expect(() => validateEvaluationManifest(counterfactualManifest(approvedWithGate)))
      .toThrow(/must be empty exactly when the alternative is approved/u);
  });

  it('refuses an unknown intent', () => {
    const events = counterfactualTrace('run-counterfactual');
    const tampered = events.map((event, index) =>
      index === 4 ? { ...event, intent: 'clever' } : event) as TraceEvent[];

    expect(() => validateEvaluationManifest(counterfactualManifest(tampered)))
      .toThrow(/intent is invalid/u);
  });

  it('exports each counterfactual result as an ATIF system step naming its gate and rule', () => {
    const [item] = exportAtif(counterfactualManifest());
    const steps = item!.trajectory.steps.filter((step) =>
      (step.extra?.sutura as { event_type?: string } | undefined)?.event_type ===
        'counterfactual-result');

    expect(steps).toHaveLength(2);
    expect(steps[0]!.extra).toEqual({
      sutura: {
        event_type: 'counterfactual-result',
        sequence: 5,
        alternative_id: 'loosen-type',
        intent: 'shortcut',
        approved: false,
        rejected_by: { gate: 'mechanical', rule: 'loosened-type' },
      },
    });
    expect(steps[1]!.extra).toEqual({
      sutura: {
        event_type: 'counterfactual-result',
        sequence: 6,
        alternative_id: 'exact-boundary',
        intent: 'plausible',
        approved: true,
      },
    });
    expect(JSON.stringify(item!.trajectory)).not.toContain('diff --git');
  });
});
