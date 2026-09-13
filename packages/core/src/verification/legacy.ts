import { parseRuntimeCandidateEvidence, type RuntimeCandidateEvidence } from './runtime-evidence.js';
import type { DiagnosisRecoveryEvidence } from '../diagnose/hypotheses.js';
import { parseDiagnosisRecoveryEvidence } from './recovery.js';
import { createHash } from 'node:crypto';
import { VerificationEvidenceError } from './codec.js';

export interface LegacyVerificationEvidence {
  schemaVersion: 'sutura-legacy-verification-adapter-v1';
  sourceSchema: 'case-file-v0' | 'audit-file-v0';
  originalBytes: string;
  originalIntegritySha256: string;
  originalOutcome: string;
  challengeStatus: 'absent';
  assurance: 'baseline-only' | 'reduced-log-only';
  datasetTruth: 'unknown';
  sandboxRawAmounts: Array<number | null>;
  sandboxUnit: null;
  recovery?: DiagnosisRecoveryEvidence;
  verificationRuns?: RuntimeCandidateEvidence[];
}

/** This view is not v1 evidence and never fills missing identity or oracle data. */
export function adaptLegacyVerification(bytes: string, sourceSchema: LegacyVerificationEvidence['sourceSchema']): LegacyVerificationEvidence {
  if (sourceSchema !== 'case-file-v0' && sourceSchema !== 'audit-file-v0') throw new VerificationEvidenceError('legacy.schema', 'unsupported schema discriminator');
  if (typeof bytes !== 'string' || Buffer.byteLength(bytes) > 2_000_000) throw new VerificationEvidenceError('legacy', 'invalid byte limit');
  let decoded: unknown;
  try { decoded = JSON.parse(bytes); } catch { throw new VerificationEvidenceError('legacy', 'invalid JSON'); }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new VerificationEvidenceError('legacy', 'must be an object');
  const record = decoded as Record<string, unknown>;
  const allowed = sourceSchema === 'case-file-v0'
    ? ['fixed', 'refused', 'gave-up', 'infra-stop', 'flaky-no-patch']
    : ['audit-approved', 'audit-refused'];
  if (!allowed.includes(String(record.outcome)) || (sourceSchema === 'audit-file-v0' && record.assurance !== 'reduced')) throw new VerificationEvidenceError('legacy.outcome', 'unsupported legacy record');
  const stages = record.stages ?? [];
  if (!Array.isArray(stages) || stages.length > 1024) throw new VerificationEvidenceError('legacy.stages', 'must be bounded');
  const sandboxRawAmounts = stages.map((stage: unknown) => {
    const cost = (stage as { metrics?: { cost?: unknown } } | null)?.metrics?.cost;
    if (cost === undefined) return null;
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) throw new VerificationEvidenceError('legacy.cost', 'invalid raw amount');
    return cost;
  });
  const diagnosis = record.diagnosis && typeof record.diagnosis === 'object' ? record.diagnosis as Record<string, unknown> : undefined;
  const policy = record.policy && typeof record.policy === 'object' ? record.policy as Record<string, unknown> : undefined;
  const recovery = Object.hasOwn(record, 'recovery') ? parseDiagnosisRecoveryEvidence(record.recovery, {
    ...(typeof diagnosis?.class === 'string' ? { initialClass: diagnosis.class } : {}),
    ...(typeof diagnosis?.failingCmd === 'string' ? { observedCommand: diagnosis.failingCmd } : {}),
    ...(typeof policy?.baseSha === 'string' && /^[a-f0-9]{40}$/u.test(policy.baseSha) ? { policyBaseSha: policy.baseSha } : {}),
    ...(typeof policy?.policySha === 'string' && /^[a-f0-9]{64}$/u.test(policy.policySha) ? { policySha256: policy.policySha } : {}),
  }) : undefined;
  const verificationRuns = record.verificationRuns === undefined ? undefined : Array.isArray(record.verificationRuns) && record.verificationRuns.length <= 12 ? record.verificationRuns.map(parseRuntimeCandidateEvidence) : (() => {throw new VerificationEvidenceError('legacy.verificationRuns','invalid bounded array');})();
  return {
    ...(verificationRuns===undefined?{}:{verificationRuns}),
    schemaVersion: 'sutura-legacy-verification-adapter-v1', sourceSchema,
    originalBytes: bytes, originalIntegritySha256: createHash('sha256').update(bytes).digest('hex'),
    originalOutcome: String(record.outcome), challengeStatus: 'absent',
    assurance: sourceSchema === 'audit-file-v0' ? 'reduced-log-only' : 'baseline-only',
    datasetTruth: 'unknown', sandboxRawAmounts, sandboxUnit: null,
    ...(recovery === undefined ? {} : { recovery }),
  };
}
