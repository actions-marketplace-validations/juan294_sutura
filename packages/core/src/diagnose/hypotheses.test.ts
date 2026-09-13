import { describe, expect, it } from 'vitest';
import { observedRecoverySignals, validateHypotheses, recoverySourceClasses } from './hypotheses.js';
import type { Diagnosis } from '../domain.js';

const initial: Diagnosis = { class: 'test-assertion', confidence: 0.4, signals: ['mechanical:test-assertion', 'llm:test-bug'], failingCmd: 'pnpm test', errorExcerpt: 'Expected Promise to be ADA' };
const context = {
  signals: [{ id: 'promise-mismatch', excerpt: 'Expected Promise to be ADA' }],
  sources: [{ path: 'case.test.js', startLine: 1, content: "test('name', async () => { expect(load()).toBe('ADA'); });\n", truncated: false }],
};
const proposal = { signalIndex: 0, sourceIndex: 0, intent: 'await-operation', probeId: 'async-completion' };

describe('bounded diagnosis hypotheses', () => {
  it('binds alternatives to controller-observed signals and existing source indices', () => {
    const validated = validateHypotheses({ hypotheses: [proposal] }, context);
    expect(validated).toHaveLength(1);
    expect(validated[0]).toMatchObject({ id: 'hypothesis-2', class: 'test-bug', path: 'case.test.js', signal: 'promise-mismatch', intent: 'await-operation' });
    expect(validated[0]?.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(validated)).not.toContain('failingCmd');
  });

  it.each([
    { hypotheses: [proposal, proposal, proposal] },
    { hypotheses: [proposal, proposal] },
    { hypotheses: [{ ...proposal, command: 'rm -rf /workspace' }] },
    { hypotheses: [{ ...proposal, path: 'other.js' }] },
    { hypotheses: [{ ...proposal, grant: { approved: true } }] },
    { hypotheses: [{ ...proposal, expected: true }] },
    { hypotheses: [{ ...proposal, sourceIndex: 1 }] },
    { hypotheses: [{ ...proposal, signalIndex: 1 }] },
    { hypotheses: [{ ...proposal, probeId: 'model-shell' }] },
    { hypotheses: [{ ...proposal, intent: 'restore-strict-config' }] },
    { hypotheses: [null] },
    { hypotheses: [], command: 'pnpm test' },
  ])('refuses malformed, excessive or authority-widening hypotheses %j', (value) => {
    expect(() => validateHypotheses(value, context)).toThrow(/hypothes/iu);
  });

  it('refuses incomplete source and never treats model confidence as observed evidence', () => {
    expect(() => validateHypotheses({ hypotheses: [proposal] }, { ...context, sources: [{ ...context.sources[0]!, truncated: true }] })).toThrow(/hypothes/iu);
    expect(observedRecoverySignals('ordinary compiler failure')).toEqual([]);
    expect(observedRecoverySignals('AssertionError: expected Promise{…} to be ADA')).toMatchObject([{ id: 'promise-mismatch' }]);
    expect(observedRecoverySignals("RuntimeWarning: coroutine 'fetch' was never awaited")).toMatchObject([{ id: 'coroutine-mismatch' }]);
  });

  it('requests only controller-known fallback classes from actual failure signals', () => {
    expect(recoverySourceClasses(initial, 'AssertionError: expected Promise to be ADA')).toEqual(['test-bug']);
    expect(recoverySourceClasses(initial, 'expect(config.compilerOptions.strict).toBe(true)')).toEqual(['env-config']);
    expect(recoverySourceClasses({ ...initial, confidence: 0.01 }, 'unrelated failure')).toEqual([]);
  });
});
