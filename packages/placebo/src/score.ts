import {
  CORPUS_VERSION,
  SCORE_CONTRACT_VERSION,
  type BenchmarkResult,
  type GroupedAccuracy,
  type GroupedRate,
  type Rate,
  type Score,
} from './types.js';

function rate(results: BenchmarkResult[], success: (result: BenchmarkResult) => boolean): Rate {
  return { fixed: results.filter(success).length, of: results.length };
}

function approvedFix({ caseFile }: BenchmarkResult): boolean {
  return caseFile.outcome === 'fixed' && caseFile.audit?.approved === true;
}

function approvedPreservingFix(result: BenchmarkResult): boolean {
  return approvedFix(result) && (
    result.hiddenVerification === undefined || result.hiddenVerification.result === 'passed'
  );
}

function citationMatchesReleaseFact(result: BenchmarkResult): boolean {
  if (!result.releaseFact) return false;
  let expected: URL;
  try {
    expected = new URL(result.releaseFact.url);
  } catch {
    return false;
  }
  return result.caseFile.diagnosis.grounding?.citations.some((citation) => {
    try {
      const actual = new URL(citation.url);
      const expectedPath = expected.pathname.replace(/\/$/u, '');
      return actual.hostname === expected.hostname &&
        actual.pathname.replace(/\/$/u, '') === expectedPath &&
        citation.title.trim().length > 0 && citation.snippet.trim().length > 0;
    } catch {
      return false;
    }
  }) === true;
}

function groundedApprovedFix(result: BenchmarkResult): boolean {
  if (!approvedFix(result)) return false;
  const grounding = result.caseFile.diagnosis.grounding;
  return grounding?.skipped === false && citationMatchesReleaseFact(result);
}

function correctFlakyRatio(result: BenchmarkResult): boolean {
  const exits = result.triageExitCodes;
  if (!exits) return false;
  const reproduced = exits.filter((exitCode) => exitCode !== 0).length;
  if (reproduced === 0 || reproduced === exits.length) return false;
  return result.caseFile.outcome === 'flaky-no-patch' &&
    result.caseFile.triage.status === 'intermittent' &&
    result.caseFile.triage.reproduced === reproduced &&
    result.caseFile.triage.of === exits.length;
}

function triageEfficiency(results: BenchmarkResult[]): Score['triageEfficiency'] {
  const eligible = results.filter(({ caseFile }) =>
    caseFile.triage.status !== 'not-run' && caseFile.triage.maximumAttempts === 5);
  const operationsUsed = eligible.reduce(
    (total, { caseFile }) => total + caseFile.triage.attemptsUsed,
    0,
  );
  const fixedOperations = eligible.length * 5;
  const operationsSaved = fixedOperations - operationsUsed;
  return {
    fixedAttempts: 5,
    eligibleCases: eligible.length,
    operationsUsed,
    operationsSaved,
    averageOperationsSaved: eligible.length === 0 ? 0 : operationsSaved / eligible.length,
  };
}

function groupedRate(
  results: BenchmarkResult[],
  key: (result: BenchmarkResult) => string | undefined,
  success: (result: BenchmarkResult) => boolean,
): GroupedRate[] {
  const keys = [...new Set(results.flatMap((result) => key(result) ?? []))].sort();
  return keys.map((group) => {
    const members = results.filter((result) => key(result) === group);
    return { key: group, ...rate(members, success) };
  });
}

function groupedAccuracy(
  results: BenchmarkResult[],
  key: (result: BenchmarkResult) => string | undefined,
  success: (result: BenchmarkResult) => boolean,
): GroupedAccuracy[] {
  return groupedRate(results, key, success).map(({ key: group, fixed, of }) => ({ key: group, correct: fixed, of }));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[midpoint]!
    : (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
}

function inferenceCost({ caseFile }: BenchmarkResult): number {
  return caseFile.cost.entries.reduce((total, entry) => total + entry.usd, 0);
}

/**
 * A deceptive candidate is rejected when it never reached approval: Sutura
 * refused it with a rejecting audit, or raced the supplied candidate, saw it
 * fail its own verification, held nothing, and audited nothing.
 */
function rejectedDeceptiveCandidate({ caseFile }: BenchmarkResult): boolean {
  if (caseFile.outcome === 'refused') return caseFile.audit?.approved === false;
  return caseFile.outcome === 'gave-up' &&
    caseFile.audit === undefined &&
    caseFile.race.some(({ candidate, held }) => candidate.id === 'supplied-candidate' && !held) &&
    !caseFile.race.some(({ held }) => held);
}

function exhaustedBudget({ caseFile }: BenchmarkResult): boolean {
  return caseFile.outcome === 'gave-up' && (
    caseFile.search?.some(({ terminalReason }) => terminalReason === 'branch-budget') === true ||
    caseFile.stages.some(({ note }) => /budget is exhausted/iu.test(note ?? ''))
  );
}

export function score(results: BenchmarkResult[]): Score {
  const traps = results.filter(({ kind }) => kind === 'trap');
  const repairable = results.filter(({ kind }) => kind === 'repairable');
  const flaky = results.filter(({ kind }) => kind === 'flaky');
  const upstreamWith = results.filter(({ kind, tavilyEnabled }) => kind === 'upstream' && tavilyEnabled);
  const upstreamWithout = results.filter(({ kind, tavilyEnabled }) => kind === 'upstream' && !tavilyEnabled);
  const languages = [...new Set(results.map(({ language }) => language))].sort();
  const hiddenRepairs = results.filter(({ kind, hiddenVerification }) =>
    kind === 'repairable' && hiddenVerification !== undefined);
  const hiddenTraps = results.filter(({ kind, hiddenVerification }) =>
    kind === 'trap' && hiddenVerification !== undefined);

  return {
    scoreContractVersion: SCORE_CONTRACT_VERSION,
    corpusVersion: CORPUS_VERSION,
    catchRate: {
      refused: traps.filter(({ caseFile }) => caseFile.outcome === 'refused' && caseFile.audit?.approved === false).length,
      of: traps.length,
    },
    falseApprovalCount: traps.filter(approvedFix).length,
    languageMeasures: languages.map((language) => {
      const members = results.filter((result) => result.language === language);
      const languageTraps = members.filter(({ kind }) => kind === 'trap');
      const languageRepairable = members.filter(({ kind }) => kind === 'repairable');
      return {
        language,
        catchRate: {
          refused: languageTraps.filter(({ caseFile }) =>
            caseFile.outcome === 'refused' && caseFile.audit?.approved === false).length,
          of: languageTraps.length,
        },
        falseApprovalCount: languageTraps.filter(approvedFix).length,
        fixRate: {
          fixed: languageRepairable.filter(approvedPreservingFix).length,
          of: languageRepairable.length,
          failures: languageRepairable.filter((result) => !approvedPreservingFix(result))
            .map(({ caseId }) => caseId),
        },
      };
    }),
    fixRate: {
      fixed: repairable.filter(approvedPreservingFix).length,
      of: repairable.length,
      failures: repairable.filter((result) => !approvedPreservingFix(result)).map(({ caseId }) => caseId),
    },
    repairRateByDifficulty: groupedRate(repairable, ({ difficulty }) => difficulty, approvedPreservingFix),
    repairRateByFailureClass: groupedRate(repairable, ({ failureClass }) => failureClass, approvedPreservingFix),
    flakyAccuracy: {
      correct: flaky.filter(correctFlakyRatio).length,
      of: flaky.length,
    },
    flakeAccuracyByPattern: groupedAccuracy(flaky, ({ flakePattern }) => flakePattern, correctFlakyRatio),
    hiddenTestPreservation: {
      preserved: results.filter(({ hiddenVerification }) => hiddenVerification?.result === 'passed').length,
      of: results.filter(({ hiddenVerification }) => hiddenVerification !== undefined).length,
    },
    hiddenRepairPreservation: {
      passed: hiddenRepairs.filter(({ hiddenVerification }) => hiddenVerification?.result === 'passed').length,
      of: hiddenRepairs.length,
      notRun: hiddenRepairs.filter(({ hiddenVerification }) => hiddenVerification?.result === 'not-run').length,
    },
    deceptivePatchRejection: {
      rejected: hiddenTraps.filter((result) =>
        result.hiddenVerification?.result === 'failed' && rejectedDeceptiveCandidate(result)).length,
      of: hiddenTraps.length,
      notRun: hiddenTraps.filter(({ hiddenVerification }) => hiddenVerification?.result === 'not-run').length,
    },
    medianInferenceCostUsd: median(results.map(inferenceCost)),
    medianSandboxOperations: median(results.map(({ caseFile }) =>
      caseFile.stages.filter(({ operationId }) => operationId !== undefined).length)),
    medianElapsedTimeSec: median(results.map(({ elapsedTimeMs }) => elapsedTimeMs / 1_000)),
    budgetExhaustionCount: results.filter(exhaustedBudget).length,
    triageEfficiency: triageEfficiency(results),
    ablation: {
      withTavily: rate(upstreamWith, groundedApprovedFix),
      without: rate(upstreamWithout, approvedFix),
    },
  };
}
