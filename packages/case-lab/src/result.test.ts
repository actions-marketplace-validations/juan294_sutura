import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contentHash } from './canonical.js';
import { modeLabel } from './labels.js';
import {
  CaseLabResultError,
  assertCaseLabResultPublicSafe,
  createCaseLabResult,
  publicGitHubUrl,
  validateCaseLabResult,
  type CaseLabCaseFile,
  type CaseLabResultBase,
} from './result.js';

const LIVE_RESULT_PATH = resolve(import.meta.dirname, '../../../docs/demo/placebo-v0.2-live-2026-09.json');
const RELEASE_SHA = 'a943ded4c734aed75c5c63f2b2dd63a2f44556c2';
const CONTROLLER_SHA = '48ac760399950dcc82542ffba5269323da3a1e76';

interface LiveResult {
  results: Array<{ caseId: string; caseFile: CaseLabCaseFile }>;
}

function recordedCaseFile(caseId: string): CaseLabCaseFile {
  const live = JSON.parse(readFileSync(LIVE_RESULT_PATH, 'utf8')) as LiveResult;
  const entry = live.results.find((item) => item.caseId === caseId);
  if (!entry) throw new Error(`missing ${caseId}`);
  return entry.caseFile;
}

type Overrides = { [K in keyof CaseLabResultBase]?: CaseLabResultBase[K] | undefined };

function recordedBase(overrides: Overrides = {}): CaseLabResultBase {
  const merged: Record<string, unknown> = {
    schemaVersion: 'sutura-case-lab-result-v1',
    requestId: 'recorded-javascript-repair',
    caseId: 'javascript-repair',
    mode: 'recorded',
    release: { version: '0.2.0', actionSha: RELEASE_SHA },
    identity: { controllerSha: CONTROLLER_SHA },
    outcome: 'fixed',
    expectedOutcome: 'fixed',
    matchesExpectation: true,
    links: {
      workflowRun: 'https://github.com/juan294/sutura/actions/runs/33422107459',
      evidence: 'https://github.com/juan294/sutura/blob/develop/docs/demo/placebo-v0.2-live-2026-09.json',
    },
    caseFile: recordedCaseFile('repair-off-by-one'),
    recordedFrom: {
      file: 'docs/demo/placebo-v0.2-live-2026-09.json',
      resultHash: '628791ba8ed0b2814b1d249ccdc835ccfa6c120becd94073ef2a4db2b95cf31d',
      runUrl: 'https://github.com/juan294/sutura/actions/runs/33422107459',
      subjectSha: RELEASE_SHA,
      recordedAt: '2026-08-31T17:56:59.589Z',
    },
    cost: { inferenceUsd: 0.005507, sandboxUsd: 0.1503, status: 'observed' },
    elapsedMs: 120_000,
    createdAt: '2026-09-04T12:00:00.000Z',
    ...overrides,
  };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return merged as unknown as CaseLabResultBase;
}

describe('CaseLabResult', () => {
  it('round-trips through create and validate with a content hash', () => {
    const result = createCaseLabResult(recordedBase());
    expect(result.resultHash).toBe(contentHash({ ...result, resultHash: undefined }));
    expect(validateCaseLabResult(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });

  it('rejects a tampered hash and tampered content', () => {
    const result = createCaseLabResult(recordedBase());
    expect(() => validateCaseLabResult({ ...result, resultHash: 'f'.repeat(64) })).toThrow('resultHash does not match the result content');
    expect(() => validateCaseLabResult({ ...result, createdAt: '2026-09-04T12:00:01.000Z' })).toThrow('resultHash does not match');
  });

  it('requires outcome agreement between the result and the case file', () => {
    expect(() => createCaseLabResult(recordedBase({ outcome: 'refused', matchesExpectation: false })))
      .toThrow('caseFile.outcome must equal the result outcome refused');
    expect(() => createCaseLabResult(recordedBase({ matchesExpectation: false })))
      .toThrow('matchesExpectation must equal outcome === expectedOutcome');
  });

  it('binds request ids to the mode', () => {
    expect(() => createCaseLabResult(recordedBase({ requestId: 'recorded-flaky-failure' })))
      .toThrow('requestId must be recorded-javascript-repair for a recorded result');
    const live = recordedBase({
      mode: 'live', requestId: 'cl-1788198872643-48b5c5d4', recordedFrom: undefined,
    });
    expect(createCaseLabResult(live).mode).toBe('live');
    expect(() => createCaseLabResult({ ...live, requestId: 'cl-1-2' }))
      .toThrow('requestId must match cl-<13 digits>-<8 hex> for a live result');
    expect(() => createCaseLabResult(recordedBase({ mode: 'live', requestId: 'cl-1788198872643-48b5c5d4' })))
      .toThrow('recordedFrom is allowed only for a recorded result');
    expect(() => createCaseLabResult(recordedBase({ mode: 'replay', requestId: 'replay-javascript-repair', recordedFrom: undefined })))
      .toThrow('replayedFrom must be an object');
  });

  it('accepts a result without a case file when the live bundle was partial', () => {
    const result = createCaseLabResult(recordedBase({
      mode: 'live', requestId: 'cl-1788198872643-48b5c5d4', recordedFrom: undefined, caseFile: undefined,
      cost: { inferenceUsd: 0, sandboxUsd: 0, status: 'unavailable' },
    }));
    expect(result.caseFile).toBeUndefined();
  });

  it('allows only public GitHub links without credentials', () => {
    expect(publicGitHubUrl('https://github.com/juan294/sutura-demo/pull/17', 'link')).toBe('https://github.com/juan294/sutura-demo/pull/17');
    expect(publicGitHubUrl('https://raw.githubusercontent.com/juan294/sutura-demo/case-lab-results/results/x.json', 'link'))
      .toContain('raw.githubusercontent.com');
    for (const value of [
      'http://github.com/juan294/sutura', 'https://user:pw@github.com/juan294/sutura', 'https://example.com/x',
      'https://github.com.evil.com/x', 'https://github.com/x#frag', 'https://github.com/x?query=1', 'ftp://github.com/x', '', 42,
    ]) {
      expect(() => publicGitHubUrl(value, 'link')).toThrow(CaseLabResultError);
    }
    expect(() => createCaseLabResult(recordedBase({ links: { workflowRun: 'https://example.com/run' } })))
      .toThrow('links.workflowRun must be a public https://github.com URL');
    expect(() => createCaseLabResult(recordedBase({ links: { homepage: 'https://github.com/x' } as never })))
      .toThrow('links.homepage is not an allowed link');
  });

  it('keeps the pull request comment anchor GitHub uses for a refusal comment', () => {
    const comment = 'https://github.com/juan294/sutura-demo/pull/25#issuecomment-5550104917';
    expect(publicGitHubUrl(comment, 'links.refusalComment')).toBe(comment);
    for (const rejected of [
      'https://github.com/juan294/sutura-demo/pull/25#readme',
      'https://github.com/juan294/sutura-demo/pull/25#issuecomment-',
      'https://github.com/juan294/sutura-demo/pull/25?tab=1#issuecomment-1',
      'https://raw.githubusercontent.com/juan294/sutura-demo/main/x.json#issuecomment-1',
    ]) {
      expect(() => publicGitHubUrl(rejected, 'links.refusalComment'))
        .toThrow('links.refusalComment must be a public https://github.com URL');
    }
  });

  it('rejects credentials and private paths anywhere in the document', () => {
    for (const poison of [
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'github_pat_11ABCDEFG0123456789abcdefghijklmnop',
      'Authorization: Bearer abc.def',
      '/Users/juan/code/sutura',
      'C:\\Users\\juan\\code',
      'sk-abcdefghijklmnopqrstuvwxyz',
    ]) {
      const poisoned = recordedBase({
        caseFile: { ...recordedCaseFile('repair-off-by-one'), repo: `local/${poison}` },
      });
      expect(() => createCaseLabResult(poisoned)).toThrow('result contains a credential or private local path');
    }
    expect(() => assertCaseLabResultPublicSafe({ note: 'contains SECRETVALUE123' }, ['SECRETVALUE123']))
      .toThrow('result contains a credential or private local path');
    expect(assertCaseLabResultPublicSafe({ note: 'clean' }, ['SECRETVALUE123', undefined, ''])).toEqual({ note: 'clean' });
    expect(() => assertCaseLabResultPublicSafe({ note: 'tok"en\\x' }, ['tok"en\\x']))
      .toThrow('result contains a credential or private local path');
  });

  it('validates the stored case file structure', () => {
    const file = recordedCaseFile('trap-weakened-expect');
    expect(() => createCaseLabResult(recordedBase({
      requestId: 'recorded-greenwash-trap', caseId: 'greenwash-trap', outcome: 'refused', expectedOutcome: 'refused',
      caseFile: { ...file, runtime: 'ruby' as never },
    }))).toThrow('caseFile.runtime must be node or python');
    expect(() => createCaseLabResult(recordedBase({
      requestId: 'recorded-greenwash-trap', caseId: 'greenwash-trap', outcome: 'refused', expectedOutcome: 'refused',
      caseFile: { ...file, cost: { entries: [{ ...file.cost.entries[0]!, role: 'mega' as never }] } },
    }))).toThrow('caseFile.cost.entries[0].role must be nano, super, or ultra');
    expect(() => createCaseLabResult(recordedBase({
      requestId: 'recorded-greenwash-trap', caseId: 'greenwash-trap', outcome: 'refused', expectedOutcome: 'refused',
      caseFile: { ...file, stages: [{ ...file.stages[0]!, network: 'open' as never }] },
    }))).toThrow('caseFile.stages[0].network must be disabled or enabled');
  });

  it('accepts only https grounding citations and the ATIF trajectory link', () => {
    const file = recordedCaseFile('repair-off-by-one');
    const withCitation = (url: string): CaseLabCaseFile => ({
      ...file,
      diagnosis: { ...file.diagnosis, grounding: { citations: [{ url, title: 'release note', snippet: '' }], query: 'q', reason: 'ok', skipped: false } },
    }) as unknown as CaseLabCaseFile;
    expect(createCaseLabResult(recordedBase({ caseFile: withCitation('https://github.com/node-fetch/node-fetch') })).caseFile?.diagnosis.grounding?.citations)
      .toHaveLength(1);
    expect(() => createCaseLabResult(recordedBase({ caseFile: withCitation('javascript:alert(1)') })))
      .toThrow('caseFile.diagnosis.grounding.citations[0].url must be an https URL');
    expect(() => createCaseLabResult(recordedBase({ caseFile: withCitation('http://example.com') })))
      .toThrow('caseFile.diagnosis.grounding.citations[0].url must be an https URL');
    const result = createCaseLabResult(recordedBase({ links: { atifTrajectory: 'https://github.com/juan294/sutura/blob/develop/docs/demo/sutura-trajectory-v1.atif.json' } }));
    expect(result.links.atifTrajectory).toContain('atif.json');
  });

  it('labels the three modes with fixed strings', () => {
    expect(modeLabel('live')).toBe('Live run');
    expect(modeLabel('replay')).toBe('Deterministic replay');
    expect(modeLabel('recorded')).toBe('Recorded live result');
  });
});

describe('counterfactual evidence at the published-result boundary', () => {
  const ALTERNATIVE = {
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

  function withCounterfactual(overrides: Record<string, unknown> = {}): CaseLabResultBase {
    return recordedBase({
      caseFile: {
        ...recordedCaseFile('repair-off-by-one'),
        counterfactual: {
          acceptedCandidateId: 'repair-1',
          cost: { inferenceUsd: 0, sandboxOperations: 1, elapsedTimeSec: 2 },
          alternatives: [ALTERNATIVE],
          ...overrides,
        },
      } as unknown as CaseLabCaseFile,
    });
  }

  it('accepts and preserves well-formed counterfactual evidence', () => {
    const validated = validateCaseLabResult(createCaseLabResult(withCounterfactual()));

    expect(validated.caseFile?.counterfactual?.alternatives).toHaveLength(1);
    expect(validated.caseFile?.counterfactual?.alternatives[0]).toMatchObject({
      id: 'loosen-type',
      rejectedBy: { gate: 'mechanical', rule: 'loosened-type' },
    });
  });

  it.each([
    ['an unknown gate', { alternatives: [{ ...ALTERNATIVE, rejectedBy: { gate: 'vibes', rule: 'r', evidence: 'e' } }] }],
    ['an unknown intent', { alternatives: [{ ...ALTERNATIVE, intent: 'clever' }] }],
    ['a malformed diff hash', { alternatives: [{ ...ALTERNATIVE, diffHash: 'not-a-hash' }] }],
    ['a negative cost', { cost: { inferenceUsd: -1, sandboxOperations: 1, elapsedTimeSec: 2 } }],
    ['an approved alternative that still names a rejecting gate', { alternatives: [{ ...ALTERNATIVE, approved: true }] }],
    ['a rejected alternative with no rejecting gate', { alternatives: [{ ...ALTERNATIVE, rejectedBy: undefined }] }],
    ['more alternatives than the bound permits', {
      alternatives: Array.from({ length: 9 }, (_value, index) => ({ ...ALTERNATIVE, id: `alt-${index}` })),
    }],
  ])('refuses counterfactual evidence with %s', (_case, overrides) => {
    expect(() => createCaseLabResult(withCounterfactual(overrides as Record<string, unknown>)))
      .toThrow(CaseLabResultError);
  });

  it('keeps the published result public-safe with counterfactual evidence attached', () => {
    const result = createCaseLabResult(withCounterfactual());

    expect(() => assertCaseLabResultPublicSafe(result)).not.toThrow();
  });
});
