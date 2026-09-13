import { createHash } from 'node:crypto';
import { canonicalJson } from '../replay/canonical-json.js';
import type { AuditVerdict, Diagnosis, RaceResult } from '../domain.js';
import type { Executor, ImageId, RunResult } from '../executor/types.js';
import type { AuditLlm } from '../audit/audit.js';
import { adjudicate } from '../audit/adjudicate.js';
import { runMechanicalChecks } from '../audit/mechanical.js';
import { enforceRepositoryPolicy } from '../audit/repository-policy.js';
import { validateCandidateDiff } from '../engine/candidate-validation.js';
import { BudgetExceededError } from '../engine/repair-budget.js';
import type { RepairAuthorizationContext } from '../engine/repair-authorization.js';
import type { RepositoryPolicy } from '../policy/schema.js';
import type { RuntimeAdapter } from '../runtime/types.js';
import { boundedTail } from '../text/bounded-tail.js';
import { runRuntimeChallenges, type PreparedRuntimeChallenges } from '../challenges/runtime.js';
import type { ChallengeRunResult } from '../challenges/runner.js';
import { evaluateVerification, type SharedVerificationOutcome, type VerificationGateResult } from './evaluate.js';
export interface RuntimeCandidateInput {
  executor: Executor;
  llm: AuditLlm;
  winner: RaceResult;
  baselineImage: ImageId;
  diagnosis: Diagnosis;
  beforeLog: string;
  suiteCommand: string;
  policy: RepositoryPolicy;
  prepared: PreparedRuntimeChallenges;
  authorization?: RepairAuthorizationContext;
  runtime?: RuntimeAdapter;
  observe?: (result: RunResult, parent: ImageId, note: string) => void;
}
export interface RuntimeCandidateResult {
  verdict: AuditVerdict;
  verification: SharedVerificationOutcome;
  challenges: ChallengeRunResult | null;
}
/** All candidate origins use this ordered production stack. Supplied callers validate reproduction first. */
export async function evaluateRuntimeCandidate(input: RuntimeCandidateInput): Promise<RuntimeCandidateResult> {
  let verdict: AuditVerdict = { approved: true, checks: [], reasoning: 'All executed gates passed' };
  let afterLog = '';
  let challenges: ChallengeRunResult | null = null;
  const passed: VerificationGateResult = { status: 'passed' };
  const artifact = (id: string, value: unknown) => [{ id, sha256: createHash('sha256').update(canonicalJson(value)).digest('hex') }];
  const verification = await evaluateVerification({ challengeMode: input.prepared.mode,
    ...(input.prepared.mode === 'optional' && input.prepared.set === null && input.prepared.reason === 'missing-contract' ? { unsupportedGates: { challenges: 'missing-contract' as const } } : {}),
    runGate: async (gate): Promise<VerificationGateResult> => {
      try {
        switch (gate) {
          case 'reproduction': return { ...passed, artifacts: artifact('reproduction', { baselineImage: input.baselineImage, beforeLog: input.beforeLog }) };
          case 'policy': {
            const result = validateCandidateDiff(input.winner.candidate.diff, input.diagnosis, input.policy, input.policy.maxDiffBytes, input.authorization);
            if (!result.ok) {
              verdict.reasoning = result.violations.join('; ');
              return { status: 'failed', reasons: ['policy-denied'] };
            }
            return { ...passed, artifacts: artifact('trusted-policy', input.policy) };
          }
          case 'mechanical': {
            const checks = runMechanicalChecks(input.winner.candidate.diff);
            verdict.checks.push(...checks);
            return { ...(checks.every(c => c.passed) ? passed : { status: 'failed' as const, reasons: ['policy-denied' as const] }), artifacts: artifact('mechanical-checks', checks) };
          }
          case 'visible': return { ...(input.winner.held && input.winner.exitCode === 0 ? passed : { status: 'failed' as const, reasons: ['assertion-failed' as const] }), artifacts: artifact('visible-result', { image: input.winner.imageId, exitCode: input.winner.exitCode, diff: input.winner.candidate.diff }) };
          case 'audit': {
            if (!input.suiteCommand.trim())
              return { status: 'insufficient', reasons: ['not-executed'] };
            const result = await input.executor.run(input.winner.imageId, input.suiteCommand, { cwd: '/workspace', network: 'disabled' });
            input.observe?.(result, input.winner.imageId, 'Fresh suite rerun');
            afterLog = boundedTail(`${result.stdout}\n${result.stderr}`, { maxLines: 100, maxCharacters: 2000, maxBytes: 2000 });
            if (result.exitCode !== 0) {
              verdict.reasoning = `REFUSED: fresh suite rerun exited ${result.exitCode}: ${afterLog}`;
              verdict.checks.push({ name: 'llm-adjudication', passed: false, evidence: 'Not run: the fresh suite rerun failed' });
            }
            return { ...(result.exitCode === 0 ? passed : { status: 'failed' as const, reasons: ['command-failed' as const] }), artifacts: artifact('fresh-suite', { command: input.suiteCommand, parentImage: input.winner.imageId, result }) };
          }
          case 'challenges': {
            challenges = await runRuntimeChallenges(input.prepared, input.executor, input.winner.imageId, (result, parent) => input.observe?.(result, parent, 'Frozen candidate challenge'));
            return { status: challenges.status, reasons: challenges.status === 'passed' ? [] : [challenges.status === 'failed' ? 'assertion-failed' : 'invalid-probe'], ...(input.prepared.set === null ? {} : { artifacts: [{ id: 'challenge-set', sha256: input.prepared.set.setHash }] }) };
          }
          case 'adjudication': {
            const result = await adjudicate(input.llm, { diagnosis: input.diagnosis, diff: input.winner.candidate.diff, beforeLog: input.beforeLog, afterLog, ...(challenges === null ? {} : { challengeEvidence: { setHash: input.prepared.set?.setHash ?? null, status: challenges.status, observations: challenges.observations } }) });
            verdict.checks.push({ name: 'llm-adjudication', passed: result.approved, evidence: result.reasoning });
            verdict.reasoning = result.reasoning;
            return { ...(result.approved ? passed : { status: 'failed' as const, reasons: ['audit-refused' as const] }), artifacts: artifact('adjudication', result) };
          }
          case 'repository-policy': {
            verdict = await enforceRepositoryPolicy({ executor: input.executor, baselineImageId: input.baselineImage, policy: input.policy, ...(input.runtime === undefined ? {} : { runtime: input.runtime }), observe: o => input.observe?.(o.result, o.parentImageId, o.note) }, input.winner, verdict);
            return { ...(verdict.checks.some(c => c.name === 'policy-required-command' && !c.passed) ? { status: 'failed' as const, reasons: ['command-failed' as const] } : passed), artifacts: artifact('required-commands', verdict.checks.filter(check => check.name === 'policy-required-command')) };
          }
          case 'resources': return { ...(verdict.checks.some(c => c.name === 'policy-resource-limit' && !c.passed) ? { status: 'failed' as const, reasons: ['resource-limit' as const] } : passed), artifacts: artifact('resource-checks', verdict.checks.filter(check => check.name === 'policy-resource-limit')) };
        }
      }
      catch (error) {
        return error instanceof BudgetExceededError ? { status: 'insufficient', reasons: ['budget-exhausted'] } : { status: 'infra-stop', reasons: ['provider-error'] };
      }
    } });
  verdict.approved = verification.status === 'passed';
  if (!verdict.approved && !verdict.reasoning.startsWith('REFUSED:'))
    verdict.reasoning = `${verification.status.toUpperCase()}: ${verification.blockingGate}: ${verification.observations.find(o => o.gate === verification.blockingGate)?.reasons.join(', ')}`;
  return { verdict, verification, challenges };
}
