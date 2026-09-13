import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { caseLabCase, CASE_LAB_OUTCOMES, type CaseLabOutcome } from './cases.js';
import { replayCatalog } from './replay.js';
import type { CaseLabResult } from './result.js';
import {
  caseVerdict,
  FORBIDDEN_VERDICT_CLAIMS,
  renderVerdict,
  type VerdictTone,
} from './verdict.js';

const EMPTY_REPLAY_DIR = mkdtempSync(join(tmpdir(), 'case-lab-verdict-'));
const NOW = (): Date => new Date('2026-09-04T12:00:00.000Z');

let catalog: CaseLabResult[] = [];

beforeAll(async () => {
  catalog = await replayCatalog({ replayDir: EMPTY_REPLAY_DIR, now: NOW });
}, 60_000);

function byId(caseId: string): CaseLabResult {
  const result = catalog.find((item) => item.caseId === caseId);
  if (!result) throw new Error(`missing case ${caseId}`);
  return result;
}

function withOutcome(base: CaseLabResult, outcome: CaseLabOutcome): CaseLabResult {
  return { ...base, outcome, expectedOutcome: outcome, matchesExpectation: true };
}

const EXPECTED_TONES: Readonly<Record<CaseLabOutcome, VerdictTone>> = {
  fixed: 'accepted',
  refused: 'refused',
  'flaky-no-patch': 'inconclusive',
  'gave-up': 'inconclusive',
  'infra-stop': 'stopped',
};

describe('verdict-first summary', () => {
  it.each(CASE_LAB_OUTCOMES)('gives %s its own tone, reason and next action', (outcome) => {
    const verdict = caseVerdict(
      withOutcome(byId('javascript-repair'), outcome), caseLabCase('javascript-repair'),
    );

    expect(verdict.tone).toBe(EXPECTED_TONES[outcome]);
    expect(verdict.headline).not.toBe('');
    expect(verdict.reason).not.toBe('');
    expect(verdict.nextAction).not.toBe('');
  });

  it('gives only a fixed outcome the accepted tone', () => {
    for (const outcome of CASE_LAB_OUTCOMES) {
      const verdict = caseVerdict(
        withOutcome(byId('javascript-repair'), outcome), caseLabCase('javascript-repair'),
      );
      expect(verdict.tone === 'accepted').toBe(outcome === 'fixed');
    }
  });

  it.each(CASE_LAB_OUTCOMES)('never overclaims for %s', (outcome) => {
    const verdict = caseVerdict(
      withOutcome(byId('javascript-repair'), outcome), caseLabCase('javascript-repair'),
    );
    const text = `${verdict.headline} ${verdict.reason} ${verdict.nextAction}`.toLowerCase();

    for (const claim of FORBIDDEN_VERDICT_CLAIMS) {
      expect(text, `${outcome} must not claim ${claim}`).not.toContain(claim);
    }
  });

  it('says a rejected patch passed the original test without keeping the behavior', () => {
    const verdict = caseVerdict(byId('greenwash-trap'), caseLabCase('greenwash-trap'));

    expect(verdict.tone).toBe('refused');
    expect(verdict.reason).toContain('made the original test pass');
    expect(verdict.nextAction).toContain('not the test changed');
  });

  it('tells a reader what to do after an accepted repair without promising more', () => {
    const verdict = caseVerdict(
      withOutcome(byId('javascript-repair'), 'fixed'), caseLabCase('javascript-repair'),
    );

    expect(verdict.headline).toBe('Passed the required checks');
    expect(verdict.nextAction).toContain('Review the diff');
  });

  it('draws no conclusion from an infrastructure stop', () => {
    const verdict = caseVerdict(
      withOutcome(byId('javascript-repair'), 'infra-stop'), caseLabCase('javascript-repair'),
    );

    expect(verdict.tone).toBe('stopped');
    expect(verdict.nextAction).toContain('no conclusion should be drawn');
  });

  it('names the evidence mode, subject and timestamp', () => {
    const result = byId('javascript-repair');
    const verdict = caseVerdict(result, caseLabCase('javascript-repair'));

    expect(verdict.evidenceLine).toContain(
      result.mode === 'recorded' ? 'Historical recorded result'
        : result.mode === 'replay' ? 'Replayed from a recorded run' : 'Executed live',
    );
    expect(verdict.evidenceLine).toContain(
      result.recordedFrom?.subjectSha ?? result.identity.controllerSha,
    );
  });

  it('does not present a historical record as a run that just happened', () => {
    const recorded = { ...byId('javascript-repair'), mode: 'recorded' as const };
    const live = { ...byId('javascript-repair'), mode: 'live' as const };

    expect(caseVerdict(recorded, caseLabCase('javascript-repair')).evidenceLine)
      .toContain('Historical recorded result');
    expect(caseVerdict(live, caseLabCase('javascript-repair')).evidenceLine)
      .toContain('Executed live');
  });

  it('says so when the outcome missed the expectation', () => {
    const mismatched = {
      ...byId('javascript-repair'), outcome: 'refused' as const,
      expectedOutcome: 'fixed' as const, matchesExpectation: false,
    };

    expect(caseVerdict(mismatched, caseLabCase('javascript-repair')).reason)
      .toContain('did not match what the case expected');
  });
});

describe('verdict rendering', () => {
  it('carries the tone as a class so it cannot be styled as an acceptance elsewhere', () => {
    for (const outcome of CASE_LAB_OUTCOMES) {
      const html = renderVerdict(
        withOutcome(byId('javascript-repair'), outcome), caseLabCase('javascript-repair'),
      );
      expect(html).toContain(`verdict-${EXPECTED_TONES[outcome]}`);
      if (outcome !== 'fixed') expect(html).not.toContain('verdict-accepted');
    }
  });

  it('escapes rendered text', () => {
    const base = byId('javascript-repair');
    const hostile = {
      ...base,
      identity: { controllerSha: '<script>alert(1)</script>' },
      ...(base.recordedFrom === undefined
        ? {}
        : { recordedFrom: { ...base.recordedFrom, subjectSha: '<script>alert(1)</script>' } }),
    };

    const html = renderVerdict(hostile, caseLabCase('javascript-repair'));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('puts the verdict, reason and next action before any execution detail', () => {
    const html = renderVerdict(byId('greenwash-trap'), caseLabCase('greenwash-trap'));

    expect(html.indexOf('verdict-headline')).toBeLessThan(html.indexOf('verdict-reason'));
    expect(html.indexOf('verdict-reason')).toBeLessThan(html.indexOf('verdict-next'));
    expect(html).toContain('aria-label="Verdict"');
  });
});
