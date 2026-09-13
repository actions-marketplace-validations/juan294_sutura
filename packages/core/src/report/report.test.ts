import { grantedRecovery } from '../verification/recovery.test-helper.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { CaseFile, CostLedger, GreenwashCheck } from '../domain.js';
import { renderCaseFile } from './casefile.js';
import { renderComment } from './markdown.js';

const FIXTURES = ['fixed', 'flaky-no-patch', 'refused', 'gave-up', 'infra-stop'] as const;
const ARTIFACT_URL = 'https://github.com/acme/repo/actions/runs/42/artifacts/7';

type SerializedCaseFile = Omit<CaseFile, 'cost'> & {
  cost: Pick<CostLedger, 'entries'>;
};

const FAILURE_CLASSES = new Set<CaseFile['diagnosis']['class']>([
  'typecheck',
  'lint',
  'build',
  'test-assertion',
  'test-bug',
  'flaky-timing',
  'dep-upstream-breaking',
  'env-config',
  'infra',
]);
const OUTCOMES = new Set<CaseFile['outcome']>([
  'fixed',
  'flaky-no-patch',
  'refused',
  'gave-up',
  'infra-stop',
]);
const TRIAGE_STATUSES = new Set<CaseFile['triage']['status']>([
  'real',
  'flaky',
  'intermittent',
  'not-run',
]);
const TRIAGE_STOP_REASONS = new Set<CaseFile['triage']['stopReason']>([
  'failure-boundary',
  'pass-boundary',
  'maximum-attempts',
  'not-run',
]);
const MODEL_ROLES = new Set(['nano', 'super', 'ultra']);
const AUDIT_CHECKS = new Set<GreenwashCheck>([
  'deleted-test',
  'skipped-test',
  'weakened-assertion',
  'loosened-type',
  'relaxed-config',
  'pass-with-no-tests',
  'module-syntax',
  'llm-adjudication',
  'policy-required-command',
  'policy-resource-limit',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isGrounding(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || typeof value.query !== 'string') return false;
  if (typeof value.skipped !== 'boolean' || !Array.isArray(value.citations)) {
    return false;
  }
  if (
    value.reason !== undefined &&
    value.reason !== 'disabled' &&
    value.reason !== 'not-applicable'
  ) {
    return false;
  }
  return value.citations.every(
    (citation) =>
      isRecord(citation) &&
      typeof citation.title === 'string' &&
      typeof citation.url === 'string' &&
      typeof citation.snippet === 'string',
  );
}

function isRaceResult(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.candidate)) return false;
  return (
    typeof value.candidate.id === 'string' &&
    typeof value.candidate.rationale === 'string' &&
    typeof value.candidate.diff === 'string' &&
    typeof value.imageId === 'string' &&
    typeof value.nodeId === 'string' &&
    value.imageId === value.nodeId &&
    typeof value.exitCode === 'number' &&
    typeof value.held === 'boolean'
  );
}

function isAudit(value: unknown): boolean {
  if (value === undefined) return true;
  if (
    !isRecord(value) ||
    typeof value.approved !== 'boolean' ||
    typeof value.reasoning !== 'string' ||
    !Array.isArray(value.checks)
  ) {
    return false;
  }
  return value.checks.every(
    (check) =>
      isRecord(check) &&
      AUDIT_CHECKS.has(check.name as GreenwashCheck) &&
      typeof check.passed === 'boolean' &&
      (check.evidence === undefined || typeof check.evidence === 'string'),
  );
}

function isCostEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    MODEL_ROLES.has(value.role as string) &&
    typeof value.model === 'string' &&
    typeof value.inTok === 'number' &&
    typeof value.outTok === 'number' &&
    typeof value.reasoningTok === 'number' &&
    typeof value.usd === 'number'
  );
}

function isTriage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const { reproduced, of, attemptsUsed, maximumAttempts } = value;
  const { reproductionProbability, confidenceLower, confidenceUpper } = value;
  if (
    ![reproduced, of, attemptsUsed, maximumAttempts].every(
      (entry) => Number.isSafeInteger(entry) && Number(entry) >= 0,
    ) ||
    ![reproductionProbability, confidenceLower, confidenceUpper].every(
      (entry) => typeof entry === 'number' && entry >= 0 && entry <= 1,
    )
  ) return false;
  return TRIAGE_STATUSES.has(value.status as CaseFile['triage']['status']) &&
    Number(reproduced) <= Number(of) &&
    of === attemptsUsed &&
    Number(attemptsUsed) <= Number(maximumAttempts) &&
    Number(confidenceLower) <= Number(reproductionProbability) &&
    Number(reproductionProbability) <= Number(confidenceUpper) &&
    TRIAGE_STOP_REASONS.has(value.stopReason as CaseFile['triage']['stopReason']) &&
    value.methodVersion === 'sprt-p20-p80-a05-b05-v1' &&
    ((value.status === 'not-run' && value.stopReason === 'not-run' && attemptsUsed === 0) ||
      (value.status !== 'not-run' && value.stopReason !== 'not-run' && Number(attemptsUsed) > 0));
}

function isPolicyEvidence(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.baseRef === 'string' &&
    typeof value.baseSha === 'string' &&
    typeof value.policySha === 'string';
}

function isStageEvidence(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.stage === 'string' &&
    Number.isSafeInteger(value.attempt) &&
    typeof value.nodeId === 'string' &&
    isRecord(value.metrics) &&
    (value.network === 'disabled' || value.network === 'enabled');
}

function isSearchEvidence(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.nodeId === 'string' &&
    Number.isSafeInteger(value.depth) &&
    typeof value.errorFingerprint === 'string' &&
    typeof value.transcriptReference === 'string' &&
    Number.isSafeInteger(value.testExitCode) &&
    typeof value.policyValid === 'boolean' &&
    Number.isSafeInteger(value.changedFiles) &&
    Number.isSafeInteger(value.diffBytes);
}

function assertSerializedCaseFile(value: unknown): asserts value is SerializedCaseFile {
  if (!isRecord(value)) {
    throw new TypeError('fixture must be an object');
  }
  const fixture = value;
  const diagnosis = fixture.diagnosis;
  const triage = fixture.triage;
  const cost = fixture.cost;
  if (
    typeof fixture.runId !== 'string' ||
    typeof fixture.repo !== 'string' ||
    (fixture.runtime !== 'node' && fixture.runtime !== 'python') ||
    !isRecord(diagnosis) ||
    !FAILURE_CLASSES.has(diagnosis.class as CaseFile['diagnosis']['class']) ||
    typeof diagnosis.confidence !== 'number' ||
    !isStringArray(diagnosis.signals) ||
    typeof diagnosis.failingCmd !== 'string' ||
    typeof diagnosis.errorExcerpt !== 'string' ||
    !isGrounding(diagnosis.grounding) ||
    !isTriage(triage) ||
    !Array.isArray(fixture.race) ||
    !fixture.race.every(isRaceResult) ||
    !isAudit(fixture.audit) ||
    !OUTCOMES.has(fixture.outcome as CaseFile['outcome']) ||
    !isRecord(cost) ||
    !Array.isArray(cost.entries) ||
    !cost.entries.every(isCostEntry)
    || !isPolicyEvidence(fixture.policy)
    || !Array.isArray(fixture.stages)
    || !fixture.stages.every(isStageEvidence)
    || (fixture.search !== undefined && (!Array.isArray(fixture.search) || !fixture.search.every(isSearchEvidence)))
  ) {
    throw new TypeError('fixture does not match the CaseFile contract');
  }
}

async function loadFixture(name: (typeof FIXTURES)[number]): Promise<CaseFile> {
  const path = new URL(`./fixtures/${name}.json`, import.meta.url);
  const serialized: unknown = JSON.parse(await readFile(path, 'utf8'));
  assertSerializedCaseFile(serialized);

  return {
    ...serialized,
    cost: {
      entries: serialized.cost.entries,
      totalUsd: () =>
        serialized.cost.entries.reduce((total, entry) => total + entry.usd, 0),
    },
  };
}

describe.each(FIXTURES)('%s report', (fixtureName) => {
  it('renders stable markdown', async () => {
    expect(renderComment(await loadFixture(fixtureName), ARTIFACT_URL)).toMatchSnapshot();
  });

  it('renders a stable single-file case file', async () => {
    expect(renderCaseFile(await loadFixture(fixtureName))).toMatchSnapshot();
  });
});

describe('fixture contract', () => {
  it('rejects invalid nested CaseFile fields', async () => {
    const path = new URL('./fixtures/fixed.json', import.meta.url);
    const fixture: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!isRecord(fixture)) throw new TypeError('expected object fixture');
    const diagnosis = isRecord(fixture.diagnosis) ? fixture.diagnosis : {};
    const audit = isRecord(fixture.audit) ? fixture.audit : {};

    const invalidFixtures = [
      { ...fixture, diagnosis: { ...diagnosis, signals: [1] } },
      { ...fixture, race: [null] },
      {
        ...fixture,
        audit: {
          ...audit,
          checks: [{ name: 'invented-check', passed: true }],
        },
      },
      { ...fixture, cost: { entries: [{ role: 'nano', model: 'nano', usd: 'free' }] } },
      { ...fixture, triage: { ...(isRecord(fixture.triage) ? fixture.triage : {}), methodVersion: 'unknown' } },
    ];

    for (const invalid of invalidFixtures) {
      expect(() => assertSerializedCaseFile(invalid)).toThrow(
        'fixture does not match the CaseFile contract',
      );
    }
  });
});

describe('markdown report contract', () => {
  it('uses the explicit ledger role for routed model stage labels', async () => {
    const caseFile = await loadFixture('fixed');
    caseFile.cost.entries = [{
      role: 'nano',
      model: 'nvidia/NVIDIA-Nemotron-3-Super-49B-v1.5',
      inTok: 10,
      outTok: 5,
      reasoningTok: 0,
      usd: 0.001,
    }];

    const report = renderComment(caseFile);

    expect(report).toContain('Diagnosis (nano): <code>nvidia/NVIDIA-Nemotron-3-Super-49B-v1.5</code>');
    expect(report).not.toContain('Procedure (super): <code>nvidia/NVIDIA-Nemotron-3-Super-49B-v1.5</code>');
  });

  it('renders stable adaptive node lineage without provider image identifiers', async () => {
    const caseFile = await loadFixture('fixed');
    caseFile.search = [{
      nodeId: 'search-002', parentNodeId: 'search-001', depth: 2,
      errorFingerprint: 'abc', transcriptReference: 'trace-2', terminalReason: 'passed',
      testExitCode: 0, policyValid: true, changedFiles: 1, diffBytes: 42,
    }];
    const markdown = renderComment(caseFile);
    const html = renderCaseFile(caseFile);
    expect(markdown).toContain('| search-002 | search-001 | 2 | 0 | PASS | passed |');
    expect(html).toContain('Adaptive checkpoint lineage');
    expect(html).toContain('<code>search-002</code>');
    expect(html).not.toContain('image-child');
  });
  it('reports the exact audited candidate when a smaller held diff exists', async () => {
    const caseFile = await loadFixture('fixed');
    const originalWinner = caseFile.race[0]!;
    caseFile.selectedCandidate = {
      id: originalWinner.candidate.id,
      diffHash: createHash('sha256').update(originalWinner.candidate.diff).digest('hex'),
    };
    caseFile.race[1] = {
      ...caseFile.race[1]!,
      exitCode: 0,
      held: true,
      candidate: {
        ...caseFile.race[1]!.candidate,
        diff: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b',
      },
    };

    const report = renderComment(caseFile);

    expect(report).toContain('**Diff summary:** candidate-a: +1 / −1 lines');
  });

  it('stops after triage for a flaky outcome', async () => {
    const report = renderComment(await loadFixture('flaky-no-patch'));

    expect(report).toContain('### Triage');
    expect(report).not.toContain('### Procedure');
    expect(report).not.toContain('### Pathology');
    expect(report).toContain('### Discharge');
    expect(report).toContain('Sandbox cost:');
    expect(report).toContain('Policy:');
  });

  it('reports a preparation failure before reproduction honestly', async () => {
    const caseFile = await loadFixture('infra-stop');

    const report = renderComment(caseFile);

    expect(report).toContain(
      'Sandbox dependency preparation failed. Sutura stopped before reproduction and inference.',
    );
    expect(report).not.toContain('passed in a clean sandbox reproduction');
    expect(report).toContain('Sandbox cost:');
    expect(report).toContain('Policy:');
  });

  it('shows refused evidence and the ledger-derived inference cost', async () => {
    const caseFile = await loadFixture('refused');
    const report = renderComment(caseFile);

    expect(report).toContain('FAIL');
    expect(report).toContain(
      'A hard-coded fee charges exempt orders and ignores currency-specific rules',
    );
    expect(report).toContain('Inference cost: $0.0108');
    expect(report).not.toMatch(/(?:^|\W)total cost(?:\W|$)/i);
  });

  it('escapes table syntax and blocks unsafe citation links', async () => {
    const caseFile = await loadFixture('fixed');
    caseFile.diagnosis.signals = ['pipe | newline\nnext'];
    caseFile.diagnosis.grounding = {
      query: 'unsafe',
      skipped: false,
      citations: [
        {
          title: '[source](spoof)',
          url: 'javascript:alert(1)',
          snippet: 'unsafe link',
        },
      ],
    };

    const report = renderComment(caseFile);

    expect(report).toContain('pipe \\| newline next');
    expect(report).not.toContain('javascript:');
    expect(report).toContain('- \\[source\\](spoof) — unsafe link');
  });

  it('renders only an explicit safe workflow artifact URL', async () => {
    const caseFile = await loadFixture('fixed');

    expect(renderComment(caseFile, ARTIFACT_URL)).toContain(
      `[Open case-file artifact](<${ARTIFACT_URL}>)`,
    );
    expect(renderComment(caseFile, 'javascript:alert(1)')).toContain(
      'Case-file artifact link pending workflow upload.',
    );
    expect(renderComment(caseFile, 'javascript:alert(1)')).not.toContain(
      'javascript:',
    );
  });
});

describe('HTML case-file contract', () => {
  it.each(FIXTURES)('is structural, responsive, and self-contained: %s', async (name) => {
    const html = renderCaseFile(await loadFixture(name));

    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toMatch(/<html lang="en">[\s\S]*<\/html>$/);
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toMatch(/--paper:\s*#[\da-f]{6}/i);
    expect(html).toMatch(/--ink:\s*#[\da-f]{6}/i);
    expect(html).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*--paper:[\s\S]*--ink:/);
    expect(html).toMatch(/overflow-x:\s*auto/);
    expect(html).not.toMatch(/<(?:script|link|img|iframe)\b/i);
    expect(html).not.toMatch(/(?:src\s*=|url\()\s*["']?https?:\/\//i);
  });

  it('places the outcome verdict in the opening docket', async () => {
    const html = renderCaseFile(await loadFixture('refused'));
    const docketEnd = html.indexOf('</header>');
    const verdictAt = html.indexOf('PATCH REFUSED');

    expect(verdictAt).toBeGreaterThan(0);
    expect(verdictAt).toBeLessThan(docketEnd);
  });

  it('escapes untrusted report content as text', async () => {
    const caseFile = await loadFixture('fixed');
    caseFile.race[0]!.candidate.diff = '</style><script>alert("x")</script>';
    caseFile.audit!.reasoning = '<img src=x onerror=alert(1)>';
    caseFile.policy.baseRef = '<script>policy()</script>';
    caseFile.stages[0]!.note = '<img src=x onerror=stage()>';

    const html = renderCaseFile(caseFile);

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;/style&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;policy()&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=stage()&gt;');
  });
});

const COUNTERFACTUAL: NonNullable<CaseFile['counterfactual']> = {
  acceptedCandidateId: 'repair-1',
  alternatives: [
    {
      id: 'loosen-type',
      intent: 'shortcut',
      rationale: 'Casts the result to any.',
      diffHash: 'a'.repeat(64),
      nodeId: 'node-020',
      approved: false,
      testExitCode: 0,
      checks: [{ name: 'loosened-type', passed: false, evidence: '+const total = x as any;' }],
      reasoning: 'REFUSED: deterministic checks found green-washing (loosened-type).',
      rejectedBy: {
        gate: 'mechanical',
        rule: 'loosened-type',
        evidence: '+const total = x as any;',
      },
      cost: { inferenceUsd: 0, sandboxOperations: 1, elapsedTimeSec: 2.5 },
    },
    {
      id: 'wrong-boundary',
      intent: 'plausible',
      rationale: 'Rounds instead of taking the ceiling.',
      diffHash: 'b'.repeat(64),
      nodeId: 'node-021',
      approved: false,
      testExitCode: 1,
      checks: [{ name: 'llm-adjudication', passed: false, evidence: 'Not run: the selected candidate did not hold' }],
      reasoning: 'REFUSED: the selected candidate did not pass its repair race.',
      rejectedBy: {
        gate: 'verification',
        rule: 'verification-command',
        evidence: 'The diagnosed verification command exited 1',
      },
      cost: { inferenceUsd: 0, sandboxOperations: 1, elapsedTimeSec: 3.5 },
    },
  ],
  cost: { inferenceUsd: 0, sandboxOperations: 2, elapsedTimeSec: 6 },
};

describe('counterfactual reporting', () => {
  it('omits the counterfactual section when a case has no alternatives', async () => {
    const caseFile = await loadFixture('fixed');

    expect(renderCaseFile(caseFile)).not.toContain('Counterfactual');
    expect(renderComment(caseFile, ARTIFACT_URL)).not.toContain('### Counterfactual');
  });

  it('renders every alternative with its gate, rule, and added cost', async () => {
    const caseFile: CaseFile = { ...await loadFixture('fixed'), counterfactual: COUNTERFACTUAL };

    const html = renderCaseFile(caseFile);

    expect(html).toContain('id="counterfactual-title"');
    for (const item of COUNTERFACTUAL.alternatives) {
      expect(html).toContain(item.id);
      expect(html).toContain(item.rejectedBy!.gate);
      expect(html).toContain(item.rejectedBy!.rule);
    }
    expect(html).toContain('2 sandbox operations');
    expect(html).toContain('6.000 s elapsed');
    expect(html).toContain('2 of 2 alternatives were rejected');
    expect(html).toContain('including 1 declared shortcut');
    expect(html).toContain('1 of them made the diagnosed command exit 0 and were still refused');
  });

  it('summarizes counterfactual evidence in the pull request comment', async () => {
    const caseFile: CaseFile = { ...await loadFixture('fixed'), counterfactual: COUNTERFACTUAL };

    const comment = renderComment(caseFile, ARTIFACT_URL);

    expect(comment).toContain('### Counterfactual');
    expect(comment).toContain('loosen-type');
    expect(comment).toContain('mechanical');
    expect(comment).toContain('**Added cost:** 2 sandbox operations');
  });

  it('escapes untrusted counterfactual text', async () => {
    const caseFile: CaseFile = {
      ...await loadFixture('fixed'),
      counterfactual: {
        ...COUNTERFACTUAL,
        alternatives: [{
          ...COUNTERFACTUAL.alternatives[0]!,
          rejectedBy: {
            gate: 'mechanical',
            rule: 'loosened-type',
            evidence: '<script>alert("cf")</script>',
          },
        }],
      },
    };

    const html = renderCaseFile(caseFile);

    expect(html).not.toContain('<script>alert("cf")</script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;cf&quot;)&lt;/script&gt;');
  });
});

it('renders retained initial diagnosis, alternatives and controller grants with escaped reasons', async () => {
  const file = await loadFixture('fixed'); file.recovery = grantedRecovery();
  file.recovery.hypotheses[1]!.reason = '<script>not executable</script>';
  for (const report of [renderComment(file), renderCaseFile(file)]) {
    expect(report).toContain('Diagnosis recovery');
    expect(report).toContain('typecheck'); expect(report).toContain('test-bug');
    expect(report).toContain('await-operation'); expect(report).toContain('test/async.test.ts');
    expect(report).toContain('&lt;script&gt;'); expect(report).not.toContain('<script>not executable');
    expect(report).toContain('live repair quality');
  }
});
