import { createHash } from 'node:crypto';

import { type AuditLlm } from '../audit/audit.js';
import { evaluateRuntimeCandidate } from '../verification/runtime.js';
import { prepareRuntimeChallenges, type PreparedRuntimeChallenges } from '../challenges/runtime.js';
import type { HealLlm } from '../heal.js';
import type {
  AuditVerdict,
  CostLedger,
  Diagnosis,
  GreenwashCheck,
  RaceResult,
  StageEvidence,
} from '../domain.js';
import { BudgetExceededError } from '../engine/repair-budget.js';
import { validateCandidateDiff } from '../engine/candidate-validation.js';
import { race } from '../engine/repair.js';
import type { ImageId, Executor, RunResult } from '../executor/types.js';
import type { RepositoryPolicy } from '../policy/schema.js';
import type { RuntimeAdapter } from '../runtime/types.js';
import { boundedTail } from '../text/bounded-tail.js';
import type { TraceRecorder } from '../trace/recorder.js';
import {
  type CounterfactualAlternative,
  type CounterfactualCost,
  type CounterfactualEvidence,
  type CounterfactualRejection,
  type CounterfactualResult,
} from './types.js';

const MECHANICAL_CHECKS = new Set<GreenwashCheck>([
  'deleted-test',
  'skipped-test',
  'pass-with-no-tests',
  'weakened-assertion',
  'loosened-type',
  'relaxed-config',
  'module-syntax',
]);

const EVIDENCE_BOUNDS = { maxLines: 20, maxCharacters: 500, maxBytes: 500 };

/**
 * The subset of `StageLedger` the counterfactual gate needs. Declaring it
 * structurally keeps this module free of a `heal.ts` import, so the gate stack
 * has no cycle.
 */
export interface CounterfactualStageLedger {
  record(input: {
    stage: 'audit';
    attempt: number;
    network: 'disabled';
    result?: RunResult;
    imageId?: ImageId;
    parentImageId?: ImageId;
    note?: string;
  }): string;
  entries(): StageEvidence[];
}

export interface CounterfactualEvaluationInput {
  executor: Executor;
  llm: AuditLlm;
  prepared?: PreparedRuntimeChallenges;
  baselineImageId: ImageId;
  diagnosis: Diagnosis;
  policy: RepositoryPolicy;
  runtime?: RuntimeAdapter;
  beforeLog: string;
  verificationCommand: string;
  diffBytesLimit: number;
  alternatives: readonly CounterfactualAlternative[];
  acceptedCandidateId?: string;
  cost: CostLedger;
  ledger: CounterfactualStageLedger;
  trace?: TraceRecorder;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function bounded(value: string): string {
  return boundedTail(value, EVIDENCE_BOUNDS).trim();
}

function refusedVerdict(reasoning: string, checks: AuditVerdict['checks'] = []): AuditVerdict {
  return { approved: false, checks, reasoning };
}

/**
 * Names the first production gate that refused the alternative. The producers
 * are `audit` and `enforceRepositoryPolicy`, whose refusal paths are: a failed
 * mechanical check, a candidate that did not hold, an empty suite command, a
 * failed fresh suite rerun, a refusing adjudication, and a failed repository
 * policy command or resource threshold. Every one is mapped here.
 */
function classifyRejection(
  verdict: AuditVerdict,
  raceResult: Pick<RaceResult, 'held' | 'exitCode'>,
): CounterfactualRejection | undefined {
  if (verdict.approved) return undefined;
  const mechanical = verdict.checks.find(
    ({ name, passed }) => !passed && MECHANICAL_CHECKS.has(name),
  );
  if (mechanical) {
    return {
      gate: 'mechanical',
      rule: mechanical.name,
      evidence: bounded(mechanical.evidence ?? verdict.reasoning),
    };
  }
  if (!raceResult.held || raceResult.exitCode !== 0) {
    return {
      gate: 'verification',
      rule: 'verification-command',
      evidence: `The diagnosed verification command exited ${raceResult.exitCode}`,
    };
  }
  const adjudication = verdict.checks.find(({ name }) => name === 'llm-adjudication');
  if (adjudication && !adjudication.passed) {
    const evidence = adjudication.evidence ?? verdict.reasoning;
    if (evidence.startsWith('Not run: the fresh suite rerun failed')) {
      return {
        gate: 'suite-rerun',
        rule: 'fresh-suite-rerun',
        evidence: bounded(verdict.reasoning),
      };
    }
    if (evidence.startsWith('Not run:')) {
      return { gate: 'verification', rule: 'suite-command', evidence: bounded(evidence) };
    }
    return { gate: 'adjudication', rule: 'llm-adjudication', evidence: bounded(evidence) };
  }
  const repositoryPolicy = verdict.checks.find(
    ({ name, passed }) =>
      !passed && (name === 'policy-required-command' || name === 'policy-resource-limit'),
  );
  if (repositoryPolicy) {
    return {
      gate: 'repository-policy',
      rule: repositoryPolicy.name,
      evidence: bounded(repositoryPolicy.evidence ?? verdict.reasoning),
    };
  }
  return undefined;
}

function costBetween(
  before: readonly StageEvidence[],
  after: readonly StageEvidence[],
  inferenceUsd: number,
): CounterfactualCost {
  const added = after.slice(before.length);
  return {
    inferenceUsd,
    sandboxOperations: added.filter(({ exitCode }) => exitCode !== undefined).length,
    elapsedTimeSec: added.reduce((total, { metrics }) => total + (metrics.elapsedTimeSec ?? 0), 0),
  };
}

/**
 * Runs every supplied alternative through the same gate stack the accepted
 * patch passes, from the same baseline sandbox image, and records the exact
 * gate and rule that rejected each one plus its added cost, latency, and
 * sandbox operations.
 *
 * The order is the production order: repository and built-in patch policy,
 * then the verification race, then the audit (mechanical checks, the held
 * check, the fresh suite rerun, and the adversarial adjudication), then the
 * repository policy commands and resource thresholds.
 */
export async function evaluateCounterfactuals(
  input: CounterfactualEvaluationInput,
): Promise<CounterfactualEvidence> {
  const alternatives: CounterfactualResult[] = [];
  let attempt = 0;
  let exhausted = false;
  const allEntriesBefore = input.ledger.entries();
  const allUsdBefore = input.cost.totalUsd();
  for (const alternative of input.alternatives) {
    try {
      const entriesBefore = input.ledger.entries();
      const usdBefore = input.cost.totalUsd();
      const diffHash = digest(alternative.diff);
      const record = (
        verdict: AuditVerdict,
        raceResult: Pick<RaceResult, 'held' | 'exitCode'>,
        nodeId: string,
      ): void => {
        const rejectedBy = classifyRejection(verdict, raceResult);
        const result: CounterfactualResult = {
          id: alternative.id,
          intent: alternative.intent,
          rationale: alternative.rationale,
          diffHash,
          nodeId,
          approved: verdict.approved,
          testExitCode: raceResult.exitCode,
          checks: verdict.checks,
          reasoning: verdict.reasoning,
          ...(rejectedBy === undefined ? {} : { rejectedBy }),
          cost: costBetween(
            entriesBefore,
            input.ledger.entries(),
            input.cost.totalUsd() - usdBefore,
          ),
        };
        alternatives.push(result);
        input.trace?.record({
          type: 'counterfactual-result',
          stage: 'audit',
          alternativeId: result.id,
          intent: result.intent,
          approved: result.approved,
          gate: rejectedBy?.gate ?? '',
          rule: rejectedBy?.rule ?? '',
          summary: result.reasoning,
          childNodeId: nodeId,
        });
      };

      const validation = validateCandidateDiff(
        alternative.diff,
        input.diagnosis,
        input.policy,
        input.diffBytesLimit,
      );
      if (!validation.ok) {
        const evidence = validation.violations.join('; ');
        const nodeId = input.ledger.record({
          stage: 'audit',
          attempt: (attempt += 1),
          network: 'disabled',
          note: `Counterfactual ${alternative.id} refused before execution: ${evidence}`,
        });
        const verdict = refusedVerdict(`REFUSED: ${evidence}`, [{
          name: 'policy-patch',
          passed: false,
          evidence: bounded(evidence),
        }]);
        alternatives.push({
          id: alternative.id,
          intent: alternative.intent,
          rationale: alternative.rationale,
          diffHash,
          nodeId,
          approved: false,
          testExitCode: 1,
          checks: verdict.checks,
          reasoning: verdict.reasoning,
          rejectedBy: {
            gate: 'patch-policy',
            rule: validation.violations[0]!,
            evidence: bounded(evidence),
          },
          cost: costBetween(entriesBefore, input.ledger.entries(), input.cost.totalUsd() - usdBefore),
        });
        input.trace?.record({
          type: 'counterfactual-result',
          stage: 'audit',
          alternativeId: alternative.id,
          intent: alternative.intent,
          approved: false,
          gate: 'patch-policy',
          rule: validation.violations[0]!,
          summary: verdict.reasoning,
          childNodeId: nodeId,
        });
        continue;
      }

      const [raceResult] = await race(
        input.executor,
        input.baselineImageId,
        [{ id: alternative.id, rationale: alternative.rationale, diff: alternative.diff }],
        input.verificationCommand,
        (result) => input.ledger.record({
          stage: 'audit',
          attempt: (attempt += 1),
          network: 'disabled',
          result,
          parentImageId: input.baselineImageId,
          note: `Counterfactual ${alternative.id} verification race`,
        }),
      );
      if (raceResult === undefined) {
        throw new Error(`Counterfactual race returned no result for ${alternative.id}`);
      }

      // Legacy direct callers without trusted contracts retain baseline-only verification.
      // A challenge-bearing caller must pass the original pre-candidate context.
      if (input.prepared === undefined && input.policy.verification?.contracts.length) {
        record(refusedVerdict('INSUFFICIENT: original frozen challenge context unavailable'),raceResult,raceResult.nodeId);
        continue;
      }
      const prepared = input.prepared ?? await prepareRuntimeChallenges({executor:input.executor,llm:input.llm as HealLlm,policy:input.policy,baselineImage:input.baselineImageId,policyBaseSha:'',policyHash:'',baselineSnapshotHash:'',failureExcerpt:input.beforeLog,baselineSources:[]});
      const {verdict} = await evaluateRuntimeCandidate({
        executor:input.executor,llm:input.llm,winner:raceResult,baselineImage:input.baselineImageId,
        diagnosis:input.diagnosis,policy:input.policy,prepared,beforeLog:input.beforeLog,suiteCommand:input.verificationCommand,
        ...(input.runtime===undefined?{}:{runtime:input.runtime}),
        observe:(result,parentImageId,note)=>{input.ledger.record({stage:'audit',attempt:++attempt,network:'disabled',result,parentImageId,note:`Counterfactual ${alternative.id} ${note}`});},
      });
      record(verdict, raceResult, raceResult.nodeId);
    } catch (error) {
      if (!(error instanceof BudgetExceededError)) throw error;
      exhausted = true;
      input.ledger.record({ stage: 'audit', attempt: ++attempt, network: 'disabled',
        note: `Counterfactual ${alternative.id} stopped: ${error.message}` });
      break;
    }
  }

  return {
    ...(input.acceptedCandidateId === undefined
      ? {}
      : { acceptedCandidateId: input.acceptedCandidateId }),
    alternatives,
    ...(exhausted ? { status: 'insufficient' as const, reason: 'budget-exhausted' as const } : {}),
    cost: costBetween(allEntriesBefore, input.ledger.entries(), input.cost.totalUsd() - allUsdBefore),
  };
}
