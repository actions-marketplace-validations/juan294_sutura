import { describe, expect, it } from 'vitest';

import {
  completedTriageVerdict,
  notRunTriageVerdict,
  type CaseFile,
} from '@sutura/core';

import { checkOutput, runtimeEvidence } from './evidence.js';

function caseFile(overrides: Partial<CaseFile> = {}): CaseFile {
  const entries = [{ role: 'nano' as const, model: 'nvidia/nemotron-nano', inTok: 10, outTok: 5, reasoningTok: 0, usd: 0.001 }];
  return {
    runId: '1',
    repo: 'owner/repo',
    runtime: 'node',
    diagnosis: {
      class: 'build',
      confidence: 1,
      signals: [],
      failingCmd: 'pnpm build',
      errorExcerpt: 'red',
      grounding: { query: '', citations: [], skipped: true, reason: 'not-applicable' },
    },
    triage: completedTriageVerdict([1, 1, 1, 1], 5),
    race: [],
    outcome: 'gave-up',
    cost: { entries, totalUsd: () => 0.001 },
    policy: { baseRef: 'develop', baseSha: 'a'.repeat(40), policySha: 'default' },
    stages: [],
    ...overrides,
  };
}

describe('runtimeEvidence', () => {
  it('creates bounded public check output', () => {
    expect(checkOutput(caseFile())).toEqual({
      title: 'Sutura outcome: gave-up',
      summary: expect.stringContaining('Policy SHA: default'),
    });
  });
  it('reports actual Nemotron calls, cost, and ConTree results', () => {
    expect(runtimeEvidence(caseFile())).toEqual([
      'Model runtime: nano=nvidia/nemotron-nano calls=1; inference cost USD=0.001000',
      'ConTree runtime: sandbox reproduction attempted; triage=4/4 max=5 stop=failure-boundary method=sprt-p20-p80-a05-b05-v1; search-nodes=0; outcome=gave-up',
      'Sandbox evidence: operations=0; elapsed=0.000s; cpu=0.000s; max-rss=0KB; sandbox cost USD=0.000000',
      `Policy evidence: base-ref=develop; base-sha=${'a'.repeat(40)}; policy-sha=default`,
    ]);
  });

  it('does not claim Tavily runtime evidence when grounding was only configured or skipped', () => {
    expect(runtimeEvidence(caseFile()).join('\n')).not.toContain('Tavily');
  });

  it('reports only actual Tavily query and citation counts without snippets', () => {
    const value = caseFile();
    value.diagnosis.grounding = {
      query: 'sensitive source text',
      citations: [{ title: 'Title', url: 'https://example.test', snippet: 'private snippet' }],
      skipped: false,
    };
    const evidence = runtimeEvidence(value).join('\n');

    expect(evidence).toContain('Tavily runtime: queries=1; citations=1');
    expect(evidence).not.toContain('sensitive source text');
    expect(evidence).not.toContain('private snippet');
  });

  it('does not claim reproduction when dependency preparation failed', () => {
    const value = caseFile({
      outcome: 'infra-stop',
      diagnosis: {
        class: 'infra',
        confidence: 1,
        signals: ['sandbox-preparation:failed'],
        failingCmd: 'pnpm test',
        errorExcerpt: 'pnpm install failed',
      },
      triage: notRunTriageVerdict(),
      cost: { entries: [], totalUsd: () => 0 },
    });

    expect(runtimeEvidence(value)).toEqual([
      'ConTree runtime: sandbox preparation failed before reproduction; triage=0/0 max=0 stop=not-run method=sprt-p20-p80-a05-b05-v1; search-nodes=0; outcome=infra-stop',
      'Sandbox evidence: operations=0; elapsed=0.000s; cpu=0.000s; max-rss=0KB; sandbox cost USD=0.000000',
      `Policy evidence: base-ref=develop; base-sha=${'a'.repeat(40)}; policy-sha=default`,
    ]);
  });
});
