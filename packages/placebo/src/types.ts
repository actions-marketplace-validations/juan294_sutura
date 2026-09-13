import type {
  CaseFile as CoreCaseFile,
  CounterfactualEvidence,
  FailureClass,
} from '@sutura/core';
import type { EvaluationManifest } from '@sutura/evaluation';

export const CORPUS_VERSION = '0.2' as const;

export type CaseFile = CoreCaseFile;
export type CaseKind = 'trap' | 'repairable' | 'flaky' | 'upstream';
export type ExpectedOutcome = 'refused' | 'fixed' | 'flaky-no-patch' | 'fixed-with-grounding';
export type FixtureLanguage = 'javascript' | 'typescript' | 'python';
export type FlakePattern = 'timing' | 'port' | 'order' | 'filesystem' | 'simulated-network' | 'randomness';
export type RepairDifficulty = 'standard' | 'hard';
export type EvaluationSplit = 'development' | 'validation' | 'held-out';

export interface CaseLineage {
  rootCaseId: string;
  family: string;
}

export interface ReleaseFact {
  title: string;
  url: string;
  snippet: string;
}

export interface CaseMetadata {
  version: typeof CORPUS_VERSION;
  kind: CaseKind;
  class: FailureClass;
  expected: ExpectedOutcome;
  description: string;
  riskClass: string;
  language: FixtureLanguage;
  failureFingerprint: string;
  expectedChecks: string[];
  source: string;
  legacyVersion?: '0.1';
  difficulty?: 'hard';
  placebo?: 'fake-fix.diff';
  triageExitCodes?: [number, number, number, number, number];
  flakePattern?: FlakePattern;
  hiddenVerification?: true;
  releaseFact?: ReleaseFact;
  expectedWithoutTavily?: 'fixed' | 'gave-up';
  /** Opt-in revision: never silently changes the frozen v0.2 benchmark slice. */
  evaluationRevision?: string;
  lineage?: CaseLineage;
  split?: EvaluationSplit;
}

export interface CorpusCase {
  id: string;
  directory: string;
  fixtureDirectory: string;
  breakPatch: string;
  metadata: CaseMetadata;
}

export interface CorpusManifestCase {
  id: string;
  contentHash: string;
  metadata: CaseMetadata;
  hiddenTestSetHash?: string;
}

export interface CorpusManifest {
  schemaVersion: 'placebo-corpus-manifest-v1';
  corpusVersion: typeof CORPUS_VERSION;
  cases: CorpusManifestCase[];
  lineage: { version: '0.1'; caseIds: string[] }[];
  corpusHash: string;
}

export interface Adapter {
  readonly name: string;
  heal(caseDir: string, context?: AdapterContext): Promise<CaseFile>;
  withTavily?(enabled: boolean): Adapter;
}

export interface AdapterContext {
  candidateDiff?: string;
  language?: FixtureLanguage;
  /**
   * Path to a JSON alternative set the harness wrote into the per-case
   * temporary directory. A path, never inline diffs, so patch bodies never
   * cross the process boundary as argv values.
   */
  alternativesFile?: string;
  /**
   * The command that fails on the broken fixture and passes on the repaired
   * one, exactly as the harness runs it for hidden verification. The corpus
   * `expectedChecks` label is not runnable on its own: Python fixtures keep
   * their tests in `tests/` without a package marker, so bare `python -m
   * unittest` discovers nothing.
   */
  failingCommand?: string;
}

export interface BenchmarkResult {
  caseId: string;
  kind: CaseKind;
  language: FixtureLanguage;
  caseFile: CaseFile;
  tavilyEnabled: boolean;
  elapsedTimeMs: number;
  triageExitCodes?: CaseMetadata['triageExitCodes'];
  releaseFact?: ReleaseFact;
  difficulty?: RepairDifficulty;
  failureClass?: FailureClass;
  flakePattern?: FlakePattern;
  hiddenVerification?: HiddenVerificationResult;
  counterfactual?: CounterfactualEvidence;
}

export interface HiddenVerificationResult {
  result: 'passed' | 'failed' | 'not-run';
  testSetHash: string;
}

export interface Rate { fixed: number; of: number }
export interface GroupedRate extends Rate { key: string }
export interface GroupedAccuracy { key: string; correct: number; of: number }

/**
 * v3: `deceptivePatchRejection` also counts a supplied trap candidate that
 * raced, failed its own verification, and was never audited. v2 counted only
 * the refused form, so a trap Sutura defeated in the sandbox scored as a miss.
 */
export const SCORE_CONTRACT_VERSION = 'sutura-placebo-score-v3' as const;

export interface Score {
  scoreContractVersion: typeof SCORE_CONTRACT_VERSION;
  corpusVersion: typeof CORPUS_VERSION;
  catchRate: { refused: number; of: number };
  falseApprovalCount: number;
  languageMeasures: Array<{
    language: FixtureLanguage;
    catchRate: { refused: number; of: number };
    falseApprovalCount: number;
    fixRate: Rate & { failures: string[] };
  }>;
  fixRate: Rate & { failures: string[] };
  repairRateByDifficulty: GroupedRate[];
  repairRateByFailureClass: GroupedRate[];
  flakyAccuracy: { correct: number; of: number };
  flakeAccuracyByPattern: GroupedAccuracy[];
  hiddenTestPreservation: { preserved: number; of: number };
  hiddenRepairPreservation: { passed: number; of: number; notRun: number };
  deceptivePatchRejection: { rejected: number; of: number; notRun: number };
  medianInferenceCostUsd: number;
  medianSandboxOperations: number;
  medianElapsedTimeSec: number;
  budgetExhaustionCount: number;
  triageEfficiency: {
    fixedAttempts: 5;
    eligibleCases: number;
    operationsUsed: number;
    operationsSaved: number;
    averageOperationsSaved: number;
  };
  ablation: { withTavily: Rate; without: Rate };
}

export interface BenchmarkManifestOptions {
  evaluationId: string;
  suturaCommit: string;
  repositoryClean: boolean;
  startedAt: string;
  completedAt?: string;
}

export interface BenchmarkReport {
  adapter: string;
  results: BenchmarkResult[];
  score: Score;
  manifest?: EvaluationManifest;
}
