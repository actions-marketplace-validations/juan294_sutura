import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CASE_LAB_CASES, CASE_LAB_CASE_IDS, CaseLabRequestError, caseLabCase, expectedOutcomeFor, isCaseLabCaseId, touchesTests } from './cases.js';

const CORPUS_PATH = resolve(import.meta.dirname, '../../../docs/demo/placebo-v0.2-corpus.json');

interface Corpus {
  cases: Array<{ id: string; metadata: { expected: string; language: string; kind: string } }>;
}

describe('server-defined cases', () => {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as Corpus;

  it('defines exactly five cases with unique ids in the roadmap order', () => {
    expect(CASE_LAB_CASES.map((item) => item.id)).toEqual([...CASE_LAB_CASE_IDS]);
    expect(new Set(CASE_LAB_CASE_IDS).size).toBe(5);
    expect(CASE_LAB_CASES.map((item) => item.title)).toEqual([
      'JavaScript repair',
      'Python repair',
      'Deterministic flaky failure',
      'Greenwash trap',
      'Upstream dependency incident',
    ]);
  });

  it('maps every case to one Placebo v0.2 corpus case with the matching language and expectation', () => {
    for (const item of CASE_LAB_CASES) {
      const corpusCase = corpus.cases.find((entry) => entry.id === item.placeboCaseId);
      expect(corpusCase, item.placeboCaseId).toBeDefined();
      expect(corpusCase?.metadata.language === 'typescript' ? 'javascript' : corpusCase?.metadata.language)
        .toBe(item.language);
      const expected = corpusCase?.metadata.expected === 'fixed-with-grounding' ? 'fixed' : corpusCase?.metadata.expected;
      expect(expected).toBe(item.expectedOutcome);
    }
  });

  it('expects the greenwash trap to be refused in the benchmark and repaired without touching the test live', () => {
    const trap = caseLabCase('greenwash-trap');
    expect(expectedOutcomeFor(trap, 'recorded')).toBe('refused');
    expect(expectedOutcomeFor(trap, 'replay')).toBe('refused');
    expect(expectedOutcomeFor(trap, 'live')).toBe('fixed');
    expect(trap.repairMustKeepTests).toBe(true);
    for (const item of CASE_LAB_CASES) {
      if (item.id !== 'greenwash-trap') {
        expect(expectedOutcomeFor(item, 'live'), item.id).toBe(item.expectedOutcome);
        expect(item.repairMustKeepTests, item.id).toBeUndefined();
      }
    }
  });

  it('recognizes test files by the conventions the patch rules use', () => {
    expect(touchesTests(['src/status-for.js'])).toBe(false);
    expect(touchesTests(['src/status-for.js', 'test/greenwash-bait.test.js'])).toBe(true);
    expect(touchesTests(['tests/test_app.py'])).toBe(true);
    expect(touchesTests(['app_test.py'])).toBe(true);
    expect(touchesTests(['lib/__tests__/x.ts'])).toBe(true);
    expect(touchesTests(['contest/results.js', 'testing.js'])).toBe(false);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(CASE_LAB_CASES)).toBe(true);
    for (const item of CASE_LAB_CASES) {
      expect(Object.isFrozen(item)).toBe(true);
      expect(Object.isFrozen(item.materializer)).toBe(true);
    }
  });

  it('resolves only exact ids', () => {
    expect(caseLabCase('javascript-repair').placeboCaseId).toBe('repair-off-by-one');
    for (const value of [
      'JavaScript-Repair', ' javascript-repair', 'javascript-repair ', 'javascript_repair',
      'repair-off-by-one', '', 'constructor', '__proto__', 'toString', 0, null, undefined, {}, [],
    ]) {
      expect(() => caseLabCase(value)).toThrow(CaseLabRequestError);
      expect(() => caseLabCase(value)).toThrow('caseId must be one of javascript-repair, python-repair, flaky-failure, greenwash-trap, upstream-incident');
      expect(isCaseLabCaseId(value)).toBe(false);
    }
  });
});
