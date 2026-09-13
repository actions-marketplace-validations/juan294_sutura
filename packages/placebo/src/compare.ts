import { DEFAULT_MODELS, DEFAULT_REPAIR_BUDGET_LIMITS, DEFAULT_ROUTING_PROFILE_ID } from '@sutura/core';

import { CliAdapter, SuturaAdapter } from './adapters.js';
import {
  ARM_SEARCH_LIMITS,
  armEnvironment,
  executedObservation,
  projectFirstGreenWins,
  type ExecutedComparisonArm,
} from './baseline.js';
import {
  budgetProfileHash,
  createComparison,
  SCORE_CONTRACT_VERSION,
  type ComparisonArm,
  type ComparisonArmRecord,
  type ComparisonInvariants,
  type ComparisonManifest,
} from './comparison.js';
import { createCorpusManifest, discoverBenchmarkCases } from './corpus.js';
import { runBenchmark, type BenchmarkOptions } from './harness.js';
import { score } from './score.js';
import { CORPUS_VERSION, type Adapter, type BenchmarkReport } from './types.js';

export interface CompareRunOptions {
  comparisonId: string;
  suturaCommit: string;
  arms: readonly ComparisonArm[];
  adapterName: string;
  suturaCommand?: string;
  noTavily?: boolean;
  /**
   * Per-case visible-suite results for the supplied trap candidates, from the
   * offline counterfactual or self-check evidence. Only used by the derived
   * `first-green-wins` arm, and only for cases Sutura refused before execution.
   */
  placeboVisibleSuite?: Readonly<Record<string, boolean>>;
  benchmark?: (adapter: Adapter, options: BenchmarkOptions) => Promise<BenchmarkReport>;
}

function adapterFor(
  name: string,
  arm: ExecutedComparisonArm,
  suturaCommand?: string,
): Adapter {
  const env = armEnvironment(arm);
  if (name === 'sutura') {
    return new SuturaAdapter({ ...(suturaCommand ? { command: suturaCommand } : {}), env });
  }
  if (name.startsWith('cli:') && name.length > 4) {
    return new CliAdapter({ command: name.slice(4), env });
  }
  throw new Error(`A comparison needs an executable adapter, not ${name}`);
}

/**
 * Runs one comparison. Every executed arm shares the same case selection,
 * models, routing profile, budget profile, and score contract; the only thing
 * an arm changes is its search shape. The `first-green-wins` arm is projected
 * from the `sutura` arm's recorded evidence and costs no inference.
 */
export async function runComparison(options: CompareRunOptions): Promise<ComparisonManifest> {
  const benchmark = options.benchmark ?? runBenchmark;
  const caseIds = (await discoverBenchmarkCases()).map(({ id }) => id).sort();
  const invariants: ComparisonInvariants = {
    caseIds,
    corpusName: 'placebo',
    corpusVersion: CORPUS_VERSION,
    corpusHash: (await createCorpusManifest()).corpusHash,
    models: { ...DEFAULT_MODELS },
    routingProfile: DEFAULT_ROUTING_PROFILE_ID,
    budgetProfileHash: budgetProfileHash(DEFAULT_REPAIR_BUDGET_LIMITS),
    scoreContractVersion: SCORE_CONTRACT_VERSION,
    tavilyEnabled: options.noTavily !== true,
    suturaCommit: options.suturaCommit,
  };

  const executedArms = options.arms.filter((arm) => arm !== 'first-green-wins');
  const reports = new Map<ComparisonArm, BenchmarkReport>();
  const arms: ComparisonArmRecord[] = [];
  for (const arm of executedArms) {
    const report = await benchmark(
      adapterFor(options.adapterName, arm as ExecutedComparisonArm, options.suturaCommand),
      { noTavily: options.noTavily === true },
    );
    reports.set(arm, report);
    const observations = report.results.map(executedObservation);
    arms.push({
      arm,
      searchLimits: { ...ARM_SEARCH_LIMITS[arm as ExecutedComparisonArm] },
      auditEnabled: true,
      derived: false,
      observations,
      score: report.score,
      totals: {
        inferenceUsd: observations.reduce((total, item) => total + item.inferenceUsd, 0),
        sandboxOperations: observations.reduce((total, item) => total + item.sandboxOperations, 0),
        elapsedTimeSec: observations.reduce((total, item) => total + item.elapsedTimeSec, 0),
      },
    });
  }

  if (options.arms.includes('first-green-wins')) {
    const source = reports.get('sutura');
    if (source === undefined) {
      throw new Error('The first-green-wins arm is projected from the sutura arm, which was not run');
    }
    const observations = source.results.map((result) => projectFirstGreenWins({
      result,
      ...(options.placeboVisibleSuite?.[result.caseId] === undefined
        ? {}
        : { placeboVisibleSuiteGreen: options.placeboVisibleSuite[result.caseId]! }),
    }));
    arms.push({
      arm: 'first-green-wins',
      searchLimits: null,
      auditEnabled: false,
      derived: true,
      observations,
      score: score(source.results.map((result, index) => ({
        ...result,
        caseFile: {
          ...result.caseFile,
          outcome: observations[index]!.outcome === 'not-run'
            ? 'gave-up'
            : observations[index]!.outcome,
          audit: {
            approved: observations[index]!.approved,
            checks: [],
            reasoning: observations[index]!.approved
              ? 'ACCEPTED: the diagnosed verification command exited 0.'
              : 'REFUSED: no candidate made the diagnosed verification command exit 0.',
          },
        },
      }))),
      totals: { inferenceUsd: 0, sandboxOperations: 0, elapsedTimeSec: 0 },
    });
  }

  return createComparison({
    comparisonId: options.comparisonId,
    invariants,
    arms,
  });
}
