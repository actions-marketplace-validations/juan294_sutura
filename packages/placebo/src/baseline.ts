import { DEFAULT_SEARCH_LIMITS, type SearchLimits } from '@sutura/core';

import type { ComparisonArm, ComparisonObservation } from './comparison.js';
import type { BenchmarkResult } from './types.js';

export type ExecutedComparisonArm = Exclude<ComparisonArm, 'first-green-wins'>;

/**
 * The three executed arms, expressed only through the search limits the engine
 * already validates. `sutura` equals `DEFAULT_SEARCH_LIMITS`, so the beam arm
 * cannot drift from the shipped default.
 */
export const ARM_SEARCH_LIMITS: Readonly<Record<ExecutedComparisonArm, SearchLimits>> =
  Object.freeze({
    'sutura': { ...DEFAULT_SEARCH_LIMITS },
    'single-branch': {
      initialBranches: 1, beamWidth: 1, maximumDepth: 1, maximumTotalBranches: 1,
    },
    'fixed-parallel': {
      initialBranches: 4, beamWidth: 1, maximumDepth: 1, maximumTotalBranches: 4,
    },
  });

/**
 * The only environment names an arm may set. An arm can select a search shape
 * and nothing else, so a comparison can never quietly change a model, a budget,
 * or a provider.
 */
export const ARM_ENVIRONMENT_ALLOWLIST = Object.freeze([
  'SUTURA_SEARCH_INITIAL_BRANCHES',
  'SUTURA_SEARCH_BEAM_WIDTH',
  'SUTURA_SEARCH_MAX_DEPTH',
  'SUTURA_SEARCH_MAX_TOTAL_BRANCHES',
] as const);

export class BaselineArmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BaselineArmError';
  }
}

export function armEnvironment(arm: ExecutedComparisonArm): Record<string, string> {
  const limits = ARM_SEARCH_LIMITS[arm];
  if (limits === undefined) throw new BaselineArmError(`Unsupported executed arm: ${arm}`);
  return {
    SUTURA_SEARCH_INITIAL_BRANCHES: String(limits.initialBranches),
    SUTURA_SEARCH_BEAM_WIDTH: String(limits.beamWidth),
    SUTURA_SEARCH_MAX_DEPTH: String(limits.maximumDepth),
    SUTURA_SEARCH_MAX_TOTAL_BRANCHES: String(limits.maximumTotalBranches),
  };
}

export function assertArmEnvironment(env: Readonly<Record<string, string>>): void {
  const allowed = new Set<string>(ARM_ENVIRONMENT_ALLOWLIST);
  for (const name of Object.keys(env)) {
    if (!allowed.has(name)) {
      throw new BaselineArmError(`A comparison arm may not set ${name}`);
    }
  }
}

const PRE_EXECUTION_REFUSAL = /^Patch vet refused:/u;

export interface FirstGreenWinsInput {
  result: BenchmarkResult;
  /**
   * The visible-suite result of the case's supplied candidate, from the
   * offline counterfactual or self-check evidence. Needed only when Sutura
   * refused the candidate before executing it, because that refusal is
   * Sutura's gate and not this baseline's.
   */
  placeboVisibleSuiteGreen?: boolean;
}

/**
 * Projects what a "first green patch wins" tool would have concluded from the
 * same recorded run: accept the first candidate whose diagnosed verification
 * command exited 0, with no mechanical check, no fresh rerun, and no
 * adjudication.
 *
 * This is a measurement projection over recorded evidence. It never reaches
 * `repairFailure`, never produces a CaseFile, and costs no inference.
 */
export function projectFirstGreenWins(input: FirstGreenWinsInput): ComparisonObservation {
  const { result } = input;
  const base = {
    caseId: result.caseId,
    kind: result.kind,
    language: result.language,
    failureClass: result.failureClass ?? result.caseFile.diagnosis.class,
    inferenceUsd: 0,
    sandboxOperations: 0,
    elapsedTimeSec: 0,
    hiddenVerification: result.hiddenVerification?.result ?? 'not-run',
  } as const;

  const held = result.caseFile.race.some(({ held: candidateHeld }) => candidateHeld);
  if (held) {
    return {
      ...base,
      outcome: 'fixed',
      approved: true,
      falseApproval: result.kind === 'trap',
    };
  }

  const refusedBeforeExecution = result.caseFile.race.length > 0 &&
    result.caseFile.race.every(({ note }) => PRE_EXECUTION_REFUSAL.test(note ?? ''));
  if (refusedBeforeExecution) {
    if (input.placeboVisibleSuiteGreen === undefined) {
      return { ...base, outcome: 'not-run', approved: false, falseApproval: false };
    }
    return input.placeboVisibleSuiteGreen
      ? { ...base, outcome: 'fixed', approved: true, falseApproval: result.kind === 'trap' }
      : { ...base, outcome: 'gave-up', approved: false, falseApproval: false };
  }

  return { ...base, outcome: 'gave-up', approved: false, falseApproval: false };
}

/**
 * Projects a recorded benchmark result into an executed arm's observation.
 */
export function executedObservation(result: BenchmarkResult): ComparisonObservation {
  const approved = result.caseFile.outcome === 'fixed' &&
    result.caseFile.audit?.approved === true;
  return {
    caseId: result.caseId,
    kind: result.kind,
    language: result.language,
    failureClass: result.failureClass ?? result.caseFile.diagnosis.class,
    outcome: result.caseFile.outcome,
    approved,
    falseApproval: approved && result.kind === 'trap',
    hiddenVerification: result.hiddenVerification?.result ?? 'not-run',
    inferenceUsd: result.caseFile.cost.entries.reduce((total, entry) => total + entry.usd, 0),
    sandboxOperations: result.caseFile.stages
      .filter(({ operationId }) => operationId !== undefined).length,
    elapsedTimeSec: result.elapsedTimeMs / 1_000,
  };
}
