import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { BudgetExceededError } from './engine/repair-budget.js';
import { boundedTail } from './text/bounded-tail.js';
import { runMechanicalChecks } from './audit/mechanical.js';
import { shellQuote } from './engine/shell.js';
import { SNAPSHOT_CWD, type Executor, type ImageId, type RunResult } from './executor/types.js';
import { AllowlistedExecutor, prepareSandbox, type StageLedger } from './heal.js';
import { NODE_RUNTIME } from './runtime/node.js';
import type { RuntimeAdapter } from './runtime/types.js';
import type {
  OrderedVerificationGate,
  VerificationGateResult,
  VerificationGateRunner,
} from './verification/evaluate.js';
import type { ValidatedVerifyRequest } from './verify.js';

/** How many times the failing command runs on the baseline before a verdict. */
export const VERIFY_REPRODUCTION_RUNS = 2;

export type ReproductionStatus = 'reproduced' | 'baseline-passes' | 'intermittent' | 'infra-stop';

export interface VerifyReproduction {
  status: ReproductionStatus;
  exitCodes: number[];
  output?: string;
  /** The prepared baseline image, absent when preparation itself stopped. */
  baselineImage?: ImageId;
  /** Set only for `infra-stop`, naming the command that could not complete. */
  failedCommand?: string;
}

export interface VerifyExecutionPorts {
  executor: Executor;
  /** Container image the runtime declares; imported once. */
  baseImageRef?: string;
  /** The immutable source snapshot directory, never the developer's checkout. */
  sourceDir: string;
  runtime?: RuntimeAdapter;
  stages?: StageLedger;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function artifact(id: string, value: string): Array<{ id: string; sha256: string }> {
  return [{ id, sha256: digest(value) }];
}

/**
 * Prepares the sandbox from the immutable source snapshot and observes the
 * failing command on the untouched baseline.
 *
 * A baseline that passes, or one that fails only sometimes, is not a subject
 * for verification: a patch cannot be shown to fix a failure that did not
 * happen, or that happens on its own schedule. Both are reported as their own
 * status rather than folded into a refusal.
 */
export async function prepareAndReproduce(
  request: Pick<ValidatedVerifyRequest, 'failingCommand'>,
  ports: VerifyExecutionPorts,
): Promise<VerifyReproduction> {
  const runtime = ports.runtime ?? NODE_RUNTIME;
  const executor = new AllowlistedExecutor(ports.executor);
  let baseImage: ImageId;
  try {
    baseImage = await ports.executor.importImage(ports.baseImageRef ?? runtime.imageRef);
  } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
    return { status: 'infra-stop', exitCodes: [], failedCommand: 'importImage' };
  }
  const prepared = await prepareSandbox(
    executor, ports.sourceDir, baseImage, request.failingCommand, ports.stages, runtime,
  );
  if (!prepared.ok) {
    return { status: 'infra-stop', exitCodes: [], failedCommand: prepared.command };
  }

  const exitCodes: number[] = [];
  let output = '';
  for (let attempt = 1; attempt <= VERIFY_REPRODUCTION_RUNS; attempt += 1) {
    let result: RunResult;
    try {
      result = await ports.executor.run(prepared.imageId, request.failingCommand, { cwd: SNAPSHOT_CWD });
    } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
      return {
        status: 'infra-stop', exitCodes, baselineImage: prepared.imageId,
        failedCommand: request.failingCommand,
      };
    }
    ports.stages?.record({
      stage: 'reproduction',
      attempt,
      network: 'disabled',
      result,
      parentImageId: prepared.imageId,
      note: 'Observed failing command on the untouched baseline',
    });
    output = boundedTail(`${result.stdout}\n${result.stderr}`, { maxLines: 100, maxCharacters: 4000, maxBytes: 4000 });
    exitCodes.push(result.exitCode);
  }

  const failed = exitCodes.filter((code) => code !== 0).length;
  const status: ReproductionStatus = failed === exitCodes.length
    ? 'reproduced'
    : failed === 0 ? 'baseline-passes' : 'intermittent';
  return { status, exitCodes, baselineImage: prepared.imageId, output };
}

export interface VerifyVisibleResult {
  status: 'passed' | 'failed' | 'not-applicable' | 'infra-stop';
  /** Nonzero when the patch did not apply; the run then never happened. */
  applyExitCode: number;
  testExitCode: number | null;
  candidateImage?: ImageId;
  output: string;
}

/**
 * Applies the supplied patch to the baseline and runs the failing command.
 *
 * A patch that does not apply is invalid input rather than a failed repair:
 * an already-applied or unrelated patch says nothing about this source. The
 * candidate is applied to the prepared baseline image, so the bytes that run
 * are the snapshot plus exactly the supplied diff.
 */
export async function applyAndRun(
  request: Pick<ValidatedVerifyRequest, 'candidateDiff' | 'failingCommand'>,
  baselineImage: ImageId,
  ports: VerifyExecutionPorts,
): Promise<VerifyVisibleResult> {
  const encoded = Buffer.from(request.candidateDiff, 'utf8').toString('base64');
  const apply = `printf '%s' ${shellQuote(encoded)} | base64 --decode | git apply -`;
  let applied: RunResult;
  try {
    applied = await ports.executor.run(baselineImage, apply, { cwd: SNAPSHOT_CWD });
  } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
    return { status: 'infra-stop', applyExitCode: -1, testExitCode: null, output: '' };
  }
  ports.stages?.record({
    stage: 'candidate',
    attempt: 1,
    network: 'disabled',
    result: applied,
    parentImageId: baselineImage,
    note: 'Supplied candidate patch applied',
  });
  if (applied.exitCode !== 0) {
    return {
      status: 'not-applicable',
      applyExitCode: applied.exitCode,
      testExitCode: null,
      output: applied.stderr || applied.stdout,
    };
  }

  let tested: RunResult;
  try {
    tested = await ports.executor.run(applied.imageId, request.failingCommand, { cwd: SNAPSHOT_CWD });
  } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
    return {
      status: 'infra-stop', applyExitCode: 0, testExitCode: null,
      candidateImage: applied.imageId, output: '',
    };
  }
  ports.stages?.record({
    stage: 'candidate',
    attempt: 2,
    network: 'disabled',
    result: tested,
    parentImageId: applied.imageId,
    note: 'Failing command rerun with the supplied patch applied',
  });
  return {
    status: tested.exitCode === 0 ? 'passed' : 'failed',
    applyExitCode: 0,
    testExitCode: tested.exitCode,
    candidateImage: applied.imageId,
    output: `${tested.stdout}${tested.stderr}`,
  };
}

export interface SandboxVerificationGates {
  runGate: VerificationGateRunner;
  reproduction: VerifyReproduction;
  visible: VerifyVisibleResult | null;
}

/**
 * Builds the gate runner for a supplied patch from real sandbox execution.
 *
 * Only the gates this route executes return an observation. The audit,
 * challenge, adjudication, repository-policy and resource gates are supplied
 * by the caller; without one, a gate records `not-run` with `not-executed`,
 * which the shared evaluator treats as missing evidence rather than as a pass.
 */
export async function sandboxVerificationGates(
  request: ValidatedVerifyRequest,
  ports: VerifyExecutionPorts,
  delegated: Partial<Record<OrderedVerificationGate, VerificationGateRunner>> = {},
): Promise<SandboxVerificationGates> {
  const reproduction = await prepareAndReproduce(request, ports);
  const visible = reproduction.status === 'reproduced' && reproduction.baselineImage !== undefined
    ? await applyAndRun(request, reproduction.baselineImage, ports)
    : null;

  const reproductionResult: VerificationGateResult = reproduction.status === 'reproduced'
    ? {
      status: 'passed', reasons: [],
      artifacts: artifact('reproduction', reproduction.exitCodes.join(',')),
    }
    : reproduction.status === 'infra-stop'
      ? { status: 'infra-stop', reasons: ['command-failed'] }
      : {
        status: 'insufficient',
        reasons: [reproduction.status === 'intermittent' ? 'flaky' : 'no-candidate'],
      };

  const mechanical = runMechanicalChecks(request.candidateDiff);
  const mechanicalFailures = mechanical.filter((check) => !check.passed);
  const mechanicalResult: VerificationGateResult = mechanicalFailures.length === 0
    ? { status: 'passed', reasons: [], artifacts: artifact('mechanical', request.candidateDiff) }
    : { status: 'failed', reasons: ['policy-denied'] };

  const visibleResult: VerificationGateResult = visible === null
    ? { status: 'not-run', reasons: ['not-executed'] }
    : visible.status === 'passed'
      ? { status: 'passed', reasons: [], artifacts: artifact('visible', visible.output) }
      : visible.status === 'infra-stop'
        ? { status: 'infra-stop', reasons: ['command-failed'] }
        : visible.status === 'not-applicable'
          ? { status: 'insufficient', reasons: ['invalid-probe'] }
          : { status: 'failed', reasons: ['assertion-failed'] };

  const executed: Partial<Record<OrderedVerificationGate, VerificationGateResult>> = {
    reproduction: reproductionResult,
    // Every trust input was validated before anything executed.
    policy: { status: 'passed', reasons: [], artifacts: artifact('policy', request.policyBaseSha) },
    mechanical: mechanicalResult,
    visible: visibleResult,
  };

  return {
    reproduction,
    visible,
    runGate: async (gate) => {
      const own = executed[gate];
      if (own !== undefined) return own;
      const delegate = delegated[gate];
      if (delegate === undefined) return { status: 'not-run', reasons: ['not-executed'] };
      return delegate(gate);
    },
  };
}
