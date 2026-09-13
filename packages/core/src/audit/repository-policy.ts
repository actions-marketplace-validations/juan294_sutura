import type { AuditVerdict, RaceResult } from '../domain.js';
import { sandboxTargetCommand } from '../engine/sandbox-command.js';
import {
  SNAPSHOT_CWD,
  type Executor,
  type ImageId,
  type RunResult,
} from '../executor/types.js';
import { evaluateResourceThresholds } from '../policy/evaluate.js';
import type { RepositoryPolicy } from '../policy/schema.js';
import { NODE_RUNTIME } from '../runtime/node.js';
import type { RuntimeAdapter } from '../runtime/types.js';

export interface RepositoryPolicyGateObservation {
  attempt: number;
  result: RunResult;
  parentImageId: ImageId;
  note: string;
}

export interface RepositoryPolicyGateInput {
  executor: Executor;
  baselineImageId: ImageId;
  policy: RepositoryPolicy;
  runtime?: RuntimeAdapter;
  observe?: (observation: RepositoryPolicyGateObservation) => void;
}

/**
 * Runs every repository policy required command twice, once on the baseline
 * image and once on the candidate image, then appends the
 * `policy-required-command` and `policy-resource-limit` checks. An approved
 * verdict becomes a refusal when any command fails or any paired resource
 * threshold is exceeded.
 */
export async function enforceRepositoryPolicy(
  input: RepositoryPolicyGateInput,
  winner: RaceResult,
  verdict: AuditVerdict,
): Promise<AuditVerdict> {
  if (!verdict.approved) return verdict;
  const runtime = input.runtime ?? NODE_RUNTIME;
  const { policy } = input;
  const checks = [...verdict.checks];
  const commandFailures: string[] = [];
  const resourceFailures: string[] = [];
  for (const [index, command] of policy.requiredCommands.entries()) {
    const executable = sandboxTargetCommand(command, runtime);
    const baseline = await input.executor.run(input.baselineImageId, executable, {
      cwd: SNAPSHOT_CWD,
    });
    input.observe?.({
      attempt: index * 2 + 2,
      result: baseline,
      parentImageId: input.baselineImageId,
      note: `Required command ${index + 1} baseline`,
    });
    const candidate = await input.executor.run(winner.imageId, executable, {
      cwd: SNAPSHOT_CWD,
    });
    input.observe?.({
      attempt: index * 2 + 3,
      result: candidate,
      parentImageId: winner.imageId,
      note: `Required command ${index + 1} candidate`,
    });
    if (candidate.exitCode !== 0) {
      commandFailures.push(`required command ${index + 1} exited ${candidate.exitCode}`);
    }
    resourceFailures.push(...evaluateResourceThresholds(
      `required command ${index + 1}`,
      baseline.metrics,
      candidate.metrics,
      policy.resourceLimits,
    ));
  }
  checks.push({
    name: 'policy-required-command',
    passed: commandFailures.length === 0,
    evidence: commandFailures.length === 0
      ? `Passed ${policy.requiredCommands.length} repository policy commands`
      : commandFailures.join('; '),
  });
  if (Object.keys(policy.resourceLimits).length > 0) {
    checks.push({
      name: 'policy-resource-limit',
      passed: resourceFailures.length === 0,
      evidence: resourceFailures.length === 0
        ? 'Paired resource thresholds passed'
        : resourceFailures.join('; '),
    });
  }
  const violations = [...commandFailures, ...resourceFailures];
  return violations.length === 0
    ? { ...verdict, checks }
    : {
        approved: false,
        checks,
        reasoning: `REFUSED: repository policy failed (${violations.join('; ')})`,
      };
}
