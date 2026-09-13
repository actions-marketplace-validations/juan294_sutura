import { createHash, randomUUID } from 'node:crypto';
import { VerificationExecutionRecorder } from './execution-record.js';
import type { VerificationArtifact, VerificationEvidence, VerificationMode } from './types.js';
import type { PreparedRuntimeChallenges } from '../challenges/runtime.js';
import { join } from 'node:path';
import { prepareRuntimeChallenges } from '../challenges/runtime.js';
import type { ChallengeRunResult } from '../challenges/runner.js';
import { classifyMechanically } from '../diagnose/classify.js';
import { budgetedRecoveryPorts, reserveRecoveryAudit, withinRecoveryDeadline } from '../diagnose/hypotheses-budget.js';
import { BudgetExceededError, RepairBudget, type RepairBudgetOverrides } from '../engine/repair-budget.js';
import type { Executor } from '../executor/types.js';
import { AllowlistedExecutor, type HealLlm } from '../heal.js';
import { policyAllowsSourceRead } from '../policy/evaluate.js';
import type { RepositoryPolicy } from '../policy/schema.js';
import { detectRuntimeAtPath } from '../runtime/detect.js';
import { applyAndRun, prepareAndReproduce, type VerifyReproduction } from '../verify-execution.js';
import type { ValidatedVerifyRequest } from '../verify.js';
import { VERIFICATION_GATE_ORDER, verificationApproved, type SharedVerificationOutcome, type VerificationGateResult, type OrderedVerificationGate } from './evaluate.js';
import { evaluateRuntimeCandidate } from './runtime.js';
import { readBoundedRegularFile } from './source.js';
export interface ExternalVerificationInput {
  request: ValidatedVerifyRequest;
  policy: RepositoryPolicy;
  executor: Executor;
  llm: HealLlm;
  sourceDir: string;
  snapshotSha256: string;
  policySha256: string;
  budgets?: RepairBudgetOverrides;
  mode?: VerificationMode;
}
export interface ExternalVerificationResult {
  status: 'verified-supplied-patch' | 'refused' | 'insufficient' | 'infra-stop';
  reproduction: VerifyReproduction;
  verification: SharedVerificationOutcome;
  challenges: ChallengeRunResult | null;
  budget: ReturnType<RepairBudget['snapshot']>;
  generatedReplacement: false;
  evidence: VerificationEvidence;
  verificationArtifact: VerificationArtifact;
}
/** Budget preparation separately so only the allowlisted dependency installer can enable network. */
function preparationExecutor(executor: Executor, budget: RepairBudget): Executor {
  let sequence = 0;
  const prefix = `verify-${randomUUID()}`;
  const charged: Executor = {
    importImage: (ref) => {
      budget.reserveSandboxOperation();
      return withinRecoveryDeadline(budget.remainingElapsedTimeSec(), undefined, () => executor.importImage(ref));
    },
    snapshot: (dir, base, options) => {
      budget.reserveSandboxOperation();
      return withinRecoveryDeadline(budget.remainingElapsedTimeSec(), undefined, () => executor.snapshot(dir, base, options));
    },
    operationCapacity: () => executor.operationCapacity(),
    cancel: (id) => executor.cancel(id),
    run: (parent, command, options) => {
      budget.reserveSandboxOperation();
      const operationId = `${prefix}-${++sequence}`;
      const timeoutSec = Math.min(options?.timeoutSec ?? 120, budget.remainingElapsedTimeSec());
      return withinRecoveryDeadline(timeoutSec, undefined, () => executor.run(parent, command, { ...options, operationId, timeoutSec }), () => executor.cancel(operationId));
    },
    runMany: async (parent, commands, options) => {
      const results = [];
      for (const command of commands)
        results.push(await charged.run(parent, command, options));
      return results;
    },
  };
  return charged;
}
/** Runs supplied bytes through the same frozen challenge and full audit stack as generated repairs. */
export async function executeExternalVerification(input: ExternalVerificationInput): Promise<ExternalVerificationResult> {
  const recorder = new VerificationExecutionRecorder(input);
  input = { ...input, executor: recorder.executor, llm: recorder.llm };
  const budget = new RepairBudget(input.budgets);
  // External verification requires a declared contract to support an acceptance.
  const policy = { ...input.policy, verification: { ...input.policy.verification, mode: 'required' as const, contracts: input.policy.verification?.contracts ?? [] } };
  let reproduction: VerifyReproduction = { status: 'infra-stop', exitCodes: [] };
  let challenges: ChallengeRunResult | null = null;
  let prepared: PreparedRuntimeChallenges | null = null;
  let audit: ReturnType<typeof reserveRecoveryAudit> | undefined;
  let phase: OrderedVerificationGate = 'reproduction';
  const finish = (verification: SharedVerificationOutcome): ExternalVerificationResult => {
    const status = verificationApproved(verification) ? 'verified-supplied-patch' : verification.status === 'infra-stop' ? 'infra-stop' : verification.status === 'insufficient' ? 'insufficient' : 'refused';
    const record = recorder.finish({
      identity: { sourceSha: input.request.sourceSha, policyBaseSha: input.request.policyBaseSha,
        snapshotSha256: input.snapshotSha256, policySha256: input.policySha256,
        diffSha256: createHash('sha256').update(input.request.candidateDiff).digest('hex'),
        corpusRevision: null, fixtureRevision: null },
      ...(reproduction.baselineImage === undefined ? {} : { baselineImageId: reproduction.baselineImage }),
      outcome: status, verification, prepared, challenges,
    });
    return { status, reproduction, verification, challenges, budget: budget.snapshot(), generatedReplacement: false, ...record };
  };
  const stopped = async (gate: OrderedVerificationGate, result: VerificationGateResult) => finish({
    status: result.status, blockingGate: gate, challengeMode: 'required', challengeAssurance: false,
    observations: VERIFICATION_GATE_ORDER.map(current => ({
      gate: current,
      status: current === gate ? result.status : current === 'reproduction' && reproduction.status === 'reproduced' ? 'passed' : 'not-run',
      reasons: current === gate ? result.reasons ?? [] : current === 'reproduction' && reproduction.status === 'reproduced' ? [] : ['not-executed'],
      artifacts: current === 'reproduction' && reproduction.status === 'reproduced'
        ? [{ id: 'reproduction', sha256: createHash('sha256').update(JSON.stringify(reproduction)).digest('hex') }] : [],
    })),
  });
  try {
    audit = reserveRecoveryAudit({ ...input, budget, policy });
    const runtime = await detectRuntimeAtPath(input.sourceDir, input.request.failingCommand, input.request.runtimeId === 'auto' ? undefined : input.request.runtimeId);
    const preparation = preparationExecutor(input.executor, budget);
    reproduction = await prepareAndReproduce(input.request, { executor: preparation, sourceDir: input.sourceDir, runtime });
    if (reproduction.status !== 'reproduced' || !reproduction.baselineImage) {
      return await stopped('reproduction', { status: reproduction.status === 'infra-stop' ? 'infra-stop' : 'insufficient', reasons: [reproduction.status === 'intermittent' ? 'flaky' : 'no-candidate'] });
    }
    const charged = budgetedRecoveryPorts({ ...input, executor: new AllowlistedExecutor(input.executor), budget });
    const baselineSources = [];
    const paths = [...new Set(policy.verification.contracts.map(contract => contract.target.path))];
    for (const path of paths.slice(0, 8)) {
      if (!policyAllowsSourceRead(path, policy))
        continue;
      baselineSources.push({ path, startLine: 1, content: (await readBoundedRegularFile(join(input.sourceDir, path), 16000)).toString('utf8') });
    }
    phase = 'challenges';
    prepared = await prepareRuntimeChallenges({ ...charged, policy, baselineImage: reproduction.baselineImage,
      policyBaseSha: input.request.policyBaseSha, policyHash: input.policySha256,
      baselineSnapshotHash: input.snapshotSha256, failureExcerpt: reproduction.output ?? '', baselineSources });
    phase = 'visible';
    const visible = await applyAndRun(input.request, reproduction.baselineImage, { executor: charged.executor, sourceDir: input.sourceDir, runtime });
    if (!visible.candidateImage || visible.status === 'infra-stop' || visible.status === 'not-applicable') {
      return await stopped('visible', { status: visible.status === 'infra-stop' ? 'infra-stop' : 'insufficient', reasons: ['command-failed'] });
    }
    phase = 'audit';
    const result = await evaluateRuntimeCandidate({ ...audit, policy, prepared, runtime,
      baselineImage: reproduction.baselineImage,
      winner: { candidate: { id: 'supplied-candidate', rationale: 'Externally supplied patch', diff: input.request.candidateDiff }, imageId: visible.candidateImage, nodeId: 'supplied-candidate', held: visible.status === 'passed', exitCode: visible.testExitCode ?? -1 },
      diagnosis: { ...classifyMechanically(reproduction.output ?? ''), failingCmd: input.request.failingCommand },
      beforeLog: reproduction.output ?? '', suiteCommand: input.request.failingCommand });
    challenges = result.challenges;
    return finish(result.verification);
  }
  catch (error) {
    return await stopped(phase, { status: error instanceof BudgetExceededError ? 'insufficient' : 'infra-stop', reasons: [error instanceof BudgetExceededError ? 'budget-exhausted' : 'provider-error'] });
  }
  finally {
    audit?.finish();
  }
}
