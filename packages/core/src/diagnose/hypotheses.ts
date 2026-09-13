import { createHash, randomUUID } from 'node:crypto';
import type { Diagnosis, FailureClass } from '../domain.js';
import type { Executor, RunResult } from '../executor/types.js';
import type { ChatOptions } from '../llm/types.js';
import type { HealLlm } from '../heal.js';
import type { RepositoryPolicy } from '../policy/schema.js';
import { policyAllowsPatchPath, policyAllowsSourceRead } from '../policy/evaluate.js';
import { redactExternalMessages, redactExternalText } from '../security/external-text.js';
import { isSensitiveRepositoryPath } from '../security/repository-path.js';
import { boundedTail } from '../text/bounded-tail.js';
import { shellQuote } from '../engine/shell.js';
import { BudgetExceededError, type RepairBudget, type RepairCapacityReservation } from '../engine/repair-budget.js';
import { REPAIR_ATTEMPT_COSTS } from '../engine/repair-attempt.js';
import type { RepairSourceContext, RepairSourceExcerpt } from '../engine/repair.js';
import {
  createRepairAuthorizationSession, deriveRepairAuthorization, repairAuthorizationEvidence,
  type ControllerBaselineBinding, type RepairAuthorizationContext, type RepairAuthorizationEvidence, type RepairAuthorizationKind,
} from '../engine/repair-authorization.js';
import type { VerificationGateStatus } from '../verification/types.js';
import { budgetedRecoveryPorts, reserveRecoveryAudit, type RecoveryAuditPorts } from './hypotheses-budget.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const INTENTS = ['await-operation', 'await-setup', 'restore-strict-config'] as const;
const HYPOTHESIS_FIELDS = ['signalIndex', 'sourceIndex', 'intent', 'probeId'] as const;
const LOG_BOUNDS = { maxLines: 200, maxCharacters: 20_000, maxBytes: 20_000 };
export interface ObservedRecoverySignal { id: string; excerpt: string }
export interface RecoveryHypothesis {
  id: string; class: FailureClass; intent: RepairAuthorizationKind | 'repair-source';
  path: string | null; sourceSha256: string | null; signal: string; probeId: string | null;
}
export interface DiagnosisRecoveryEvidence {
  schemaVersion: 'sutura-diagnosis-recovery-v1'; status: VerificationGateStatus; reason: string;
  initialClass: FailureClass; observedCommand: string; executedCommand: string;
  hypotheses: Array<RecoveryHypothesis & { status: VerificationGateStatus; reason: string; probeOutputSha256: string | null }>;
  authorizations: RepairAuthorizationEvidence[];
}
export interface RecoveryInput {
  initialDiagnosis: Diagnosis; failedLog: string; sourceContext: RepairSourceContext;
  baseline: ControllerBaselineBinding; policy: RepositoryPolicy; executor: Executor; llm: HealLlm;
  budget: RepairBudget; trustedCommand: string; repairReservationUsd: number; signal?: AbortSignal;
  operationIdPrefix?: string;
  observe(input: { result?: RunResult; parentImageId: string; note: string }): void;
}
export interface RecoveryResult {
  hypotheses: RecoveryHypothesis[];
  attempts: Array<{ hypothesisId: string; diagnosis: Diagnosis; authorization?: RepairAuthorizationContext }>;
  evidence: DiagnosisRecoveryEvidence;
  audit?: RecoveryAuditPorts;
}

export function observedRecoverySignals(log: string): ObservedRecoverySignal[] {
  const safe = redactExternalText(boundedTail(log, LOG_BOUNDS)).text;
  const patterns: Array<[string, RegExp]> = [
    ['promise-mismatch', /[^\n]*(?:expected[^\n]*Promise|Promise[^\n]*(?:expected|to be))[^\n]*/iu],
    ['coroutine-mismatch', /[^\n]*coroutine[^\n]*/iu],
    ['async-setup', /[^\n]*(?:asynchronous[^\n]*setup|async[^\n]*setup|expected undefined[^\n]*)/iu],
    ['strict-requirement', /[^\n]*(?:compilerOptions\.(?:strict|noUncheckedIndexedAccess)|strict TypeScript|strictness)[^\n]*/iu],
  ];
  return patterns.flatMap(([id, pattern]) => { const match = pattern.exec(safe); return match ? [{ id, excerpt: match[0].slice(0, 1000) }] : []; });
}
export function recoverySourceClasses(_initial: Diagnosis, failedLog: string): FailureClass[] {
  return [...new Set(observedRecoverySignals(failedLog).map(({ id }): FailureClass => id === 'strict-requirement' ? 'env-config' : 'test-bug'))];
}

function hypothesisError(): never { throw new Error('Diagnosis hypotheses violate the bounded controller proposal contract'); }
export function validateHypotheses(value: unknown, context: { signals: readonly ObservedRecoverySignal[]; sources: readonly RepairSourceExcerpt[] }): RecoveryHypothesis[] {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join(',') !== 'hypotheses') return hypothesisError();
  const proposals = (value as { hypotheses: unknown }).hypotheses;
  if (!Array.isArray(proposals) || proposals.length > 2) return hypothesisError();
  const seen = new Set<string>();
  return proposals.map((proposal, index) => {
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return hypothesisError();
    const record = proposal as Record<string, unknown>;
    if (Object.keys(record).length !== HYPOTHESIS_FIELDS.length || !HYPOTHESIS_FIELDS.every((key) => Object.hasOwn(record, key))) return hypothesisError();
    if (!Number.isSafeInteger(record.signalIndex) || !Number.isSafeInteger(record.sourceIndex)) return hypothesisError();
    const signal = context.signals[record.signalIndex as number]; const source = context.sources[record.sourceIndex as number];
    const intent = record.intent as RepairAuthorizationKind;
    if (!signal || !source || source.truncated || source.startLine !== 1 || !INTENTS.includes(intent)) return hypothesisError();
    const probeId = intent === 'restore-strict-config' ? 'strict-json' : 'async-completion';
    if (record.probeId !== probeId || (intent === 'restore-strict-config') !== (signal.id === 'strict-requirement')) return hypothesisError();
    const key = `${intent}:${source.path}`; if (seen.has(key)) return hypothesisError(); seen.add(key);
    return { id: `hypothesis-${index + 2}`, class: intent === 'restore-strict-config' ? 'env-config' : 'test-bug', intent, path: source.path, sourceSha256: digest(source.content), signal: signal.id, probeId };
  });
}

function probeCommand(source: RepairSourceExcerpt, command: string): string {
  const payload = Buffer.from(JSON.stringify({ path: source.path, maximum: 16_000 })).toString('base64');
  // Both scripts read bounded data only, reject symlink components, and disclose
  // just its digest. Their bytes and command are controller-owned.
  const script = source.path.endsWith('.py')
    ? `import base64,hashlib,json,os,stat\np=json.loads(base64.b64decode('${payload}')); path=p['path']; parts=path.split('/')\nfor n in range(1,len(parts)+1):\n if stat.S_ISLNK(os.lstat('/'.join(parts[:n])).st_mode): raise ValueError('symlink source')\nwith open(path,'rb') as f: data=f.read(p['maximum']+1)\nif len(data)>p['maximum']: raise ValueError('oversized source')\nprint('SUTURA_SOURCE_SHA256='+hashlib.sha256(data).hexdigest(),flush=True)`
    : `const fs=require('node:fs');const crypto=require('node:crypto');const p=JSON.parse(Buffer.from('${payload}','base64'));const parts=p.path.split('/');for(let i=1;i<=parts.length;i++){if(fs.lstatSync(parts.slice(0,i).join('/')).isSymbolicLink())throw Error('symlink source');}const fd=fs.openSync(p.path,'r');const data=Buffer.alloc(p.maximum+1);const n=fs.readSync(fd,data,0,data.length,0);fs.closeSync(fd);if(n>p.maximum)throw Error('oversized source');process.stdout.write('SUTURA_SOURCE_SHA256='+crypto.createHash('sha256').update(data.subarray(0,n)).digest('hex')+'\\n');`;
  return `${source.path.endsWith('.py') ? 'python -I -c' : 'node -e'} ${shellQuote(script)} && ${command}`;
}

function hypothesisOptions(): ChatOptions {
  return {
    purpose: 'diagnosis-recovery',
    maxTokens: 2048,
    temperature: 0,
    responseFormat: {
      type: 'json_schema',
      jsonSchema: {
        name: 'sutura_diagnosis_hypotheses',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            hypotheses: {
              type: 'array', maxItems: 2,
              items: {
                type: 'object',
                properties: {
                  signalIndex: { type: 'integer' },
                  sourceIndex: { type: 'integer' },
                  intent: { type: 'string', enum: INTENTS },
                  probeId: { type: 'string', enum: ['async-completion', 'strict-json'] },
                },
                required: [...HYPOTHESIS_FIELDS],
                additionalProperties: false,
              },
            },
          },
          required: ['hypotheses'],
          additionalProperties: false,
        },
      },
    },
  };
}

function recoveryFailure(
  error: unknown,
  cancelled: boolean,
  infrastructureReason: string,
): Pick<DiagnosisRecoveryEvidence, 'status' | 'reason'> {
  if (cancelled) return { status: 'insufficient', reason: 'cancelled' };
  if (error instanceof BudgetExceededError) return { status: 'insufficient', reason: 'budget-exhausted' };
  return { status: 'infra-stop', reason: infrastructureReason };
}

export async function recoverDiagnosis(input: RecoveryInput): Promise<RecoveryResult> {
  const initial: RecoveryHypothesis = { id: 'hypothesis-1', class: input.initialDiagnosis.class, intent: 'repair-source', path: null, sourceSha256: null, signal: 'initial-diagnosis', probeId: null };
  const evidence: DiagnosisRecoveryEvidence = { schemaVersion: 'sutura-diagnosis-recovery-v1', status: 'not-run', reason: 'no-supported-recovery-signal', initialClass: input.initialDiagnosis.class, observedCommand: input.initialDiagnosis.failingCmd, executedCommand: input.trustedCommand, hypotheses: [{ ...initial, status: 'not-run', reason: 'initial-diagnosis-retained', probeOutputSha256: null }], authorizations: [] };
  const result: RecoveryResult = { hypotheses: [initial], attempts: [], evidence };
  const stopped = () => input.signal?.aborted === true;
  if (stopped()) { evidence.reason = 'cancelled'; return result; }
  const operationIdPrefix = input.operationIdPrefix ?? `recovery-${randomUUID()}`;
  let repairCapacity: RepairCapacityReservation | undefined;
  try {
    // Audit and one subsequent complete repair must fit before recovery starts.
    result.audit = reserveRecoveryAudit({ ...input, operationIdPrefix });
    if (!Number.isFinite(input.repairReservationUsd) || input.repairReservationUsd <= 0) throw new BudgetExceededError('inferenceCostUsd');
    repairCapacity = input.budget.reserveCapacity({ ...REPAIR_ATTEMPT_COSTS, inferenceCostUsd: input.repairReservationUsd, elapsedTimeSec: 30 });
  } catch (error) {
    result.audit?.finish(); delete result.audit;
    evidence.status = 'insufficient';
    evidence.reason = error instanceof BudgetExceededError ? 'budget-exhausted' : 'verification-reservation-unavailable';
    return result;
  }
  try {
    const recoveryPorts = budgetedRecoveryPorts({ ...input, operationIdPrefix: `${operationIdPrefix}-probe` });
    result.attempts.push({ hypothesisId: initial.id, diagnosis: input.initialDiagnosis });
    const signals = observedRecoverySignals(input.failedLog);
    if (signals.length === 0) return result;
    const sources = input.sourceContext.sources;
    const messages = redactExternalMessages([
      { role: 'system' as const, content: 'Investigate at most two alternative diagnoses. Return exactly {"hypotheses":[{"signalIndex":0,"sourceIndex":0,"intent":"await-operation","probeId":"async-completion"}]}. Choose only supplied source and observed signal indices. Intents: await-operation, await-setup (probe async-completion), restore-strict-config (probe strict-json). Do not supply commands, paths, grants, expected values or replacement code. Use an empty array when evidence does not support these narrow repairs.' },
      { role: 'user' as const, content: JSON.stringify({ initialClass: input.initialDiagnosis.class, signals, sources: sources.map((source, sourceIndex) => ({ sourceIndex, ...source })) }) },
    ]);
    const options = hypothesisOptions();
    let hypotheses: RecoveryHypothesis[];
    let reply: Awaited<ReturnType<HealLlm['chat']>>;
    try {
      reply = await recoveryPorts.llm.chat('super', messages, options);
    } catch (error) {
      Object.assign(evidence, recoveryFailure(error, stopped(), 'hypothesis-provider-failed'));
      return result;
    }
    if (stopped()) { evidence.status = 'insufficient'; evidence.reason = 'cancelled'; return result; }
    try {
      if (reply.finishReason === 'length' || Buffer.byteLength(reply.text) > 16_000) throw new Error('Truncated recovery proposal');
      hypotheses = validateHypotheses(JSON.parse(reply.text), { signals, sources });
    } catch { evidence.status = 'insufficient'; evidence.reason = 'invalid-hypotheses'; return result; }
    result.hypotheses.push(...hypotheses);
    evidence.status = hypotheses.length ? 'insufficient' : 'not-run'; evidence.reason = hypotheses.length ? 'no-authorized-recovery' : 'no-supported-hypothesis';
    for (const hypothesis of hypotheses) {
      const observation = { ...hypothesis, status: 'not-run' as VerificationGateStatus, reason: 'not-executed', probeOutputSha256: null as string | null };
      evidence.hypotheses.push(observation);
      if (stopped()) { observation.reason = 'cancelled'; continue; }
      const source = sources.find(({ path }) => path === hypothesis.path)!;
      if (isSensitiveRepositoryPath(source.path) || !policyAllowsSourceRead(source.path, input.policy) || !policyAllowsPatchPath(source.path, input.policy)) { observation.status = 'failed'; observation.reason = 'policy-denied'; continue; }
      try {
        const executed = await recoveryPorts.executor.run(input.baseline.baselineImageId, probeCommand(source, input.trustedCommand), { cwd: '/workspace', network: 'disabled', timeoutSec: 30, env: { CI: 'true', NODE_OPTIONS: '', NODE_PATH: '', PYTHONPATH: '' } });
        const output = `${executed.stdout}\n${executed.stderr}`;
        input.observe({ result: executed, parentImageId: input.baseline.baselineImageId, note: `Recovery ${hypothesis.id}: ${hypothesis.probeId}` });
        observation.probeOutputSha256 = digest(output);
        const matches = [...executed.stdout.matchAll(/^SUTURA_SOURCE_SHA256=([a-f0-9]{64})$/gmu)];
        if (executed.truncated || Buffer.byteLength(output) > 16_384 || matches.length !== 1 || matches[0]?.[1] !== hypothesis.sourceSha256) { observation.status = 'insufficient'; observation.reason = 'source-identity-mismatch'; continue; }
        if (executed.exitCode === 0) { observation.status = 'insufficient'; observation.reason = 'failure-not-reproduced'; continue; }
        if (stopped()) { observation.status = 'insufficient'; observation.reason = 'cancelled'; continue; }
        const session = createRepairAuthorizationSession({ baseline: input.baseline, failingCommand: input.initialDiagnosis.failingCmd, policy: input.policy, sources });
        const strictKey = /noUncheckedIndexedAccess/u.test(signals.find(({ id }) => id === hypothesis.signal)?.excerpt ?? '') ? 'noUncheckedIndexedAccess' as const : 'strict' as const;
        const grant = await deriveRepairAuthorization(session, { kind: hypothesis.intent as RepairAuthorizationKind, path: source.path, evidenceReferences: [hypothesis.signal, `source:${hypothesis.sourceSha256}`], controllerProbe: { id: hypothesis.probeId!, imageId: input.baseline.baselineImageId, exitCode: executed.exitCode, output: output.replace(/^SUTURA_SOURCE_SHA256=.*\n/u, ''), sourceSha256: matches[0]![1]!, failingCommand: input.initialDiagnosis.failingCmd }, ...(hypothesis.intent === 'restore-strict-config' ? { strictKey } : {}) });
        if (!grant.ok) { observation.status = 'insufficient'; observation.reason = grant.reason; continue; }
        observation.status = 'passed'; observation.reason = 'narrow-grant-issued';
        result.attempts.push({ hypothesisId: hypothesis.id, diagnosis: { ...input.initialDiagnosis, class: hypothesis.class, signals: [...input.initialDiagnosis.signals, `recovery:${hypothesis.id}`] }, authorization: { session, baseline: input.baseline } });
        evidence.authorizations.push(...repairAuthorizationEvidence(session));
        evidence.status = 'passed'; evidence.reason = 'controller-authorized-recovery';
      } catch (error) {
        Object.assign(observation, recoveryFailure(error, stopped(), 'probe-failed'));
      }
    }
    return result;
  } finally {
    input.budget.releaseCapacity(repairCapacity);
  }
}
