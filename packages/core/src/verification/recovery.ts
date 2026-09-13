import { canonicalJson } from '../replay/canonical-json.js';
import type { DiagnosisRecoveryEvidence } from '../diagnose/hypotheses.js';
import { FAILURE_TAXONOMY } from '../taxonomy.js';
import { isSensitiveRepositoryPath } from '../security/repository-path.js';
import { redactExternalText } from '../security/external-text.js';
import { VERIFICATION_STATUSES } from './types.js';

function invalid(): never { throw new Error('Invalid public diagnosis recovery evidence'); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  if (Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum = 4096): string {
  if (typeof value !== 'string' || !value || value.length > maximum || /(?:\/Users\/|Authorization:\s*(?:Bearer|Basic))/iu.test(value) || redactExternalText(value).count) return invalid();
  return value;
}
function hash(value: unknown, size: 40 | 64): void { if (!(size === 40 ? /^[a-f0-9]{40}$/u : /^[a-f0-9]{64}$/u).test(text(value))) invalid(); }
function status(value: unknown): void { if (!VERIFICATION_STATUSES.includes(value as never)) invalid(); }
function path(value: unknown): void { if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u.test(text(value)) || isSensitiveRepositoryPath(value as string) || (value as string).split('/').some((part) => part === '.' || part === '..')) invalid(); }

/** Known controller identity fields only; unknown identities are never invented. */
export interface DiagnosisRecoveryBinding {
  initialClass?: string;
  observedCommand?: string;
  executedCommand?: string;
  sourceSha?: string | null;
  snapshotSha256?: string | null;
  policyBaseSha?: string | null;
  policySha256?: string;
}

/** Public observations cannot deserialize an edit capability. */
export function parseDiagnosisRecoveryEvidence(value: unknown, expected: DiagnosisRecoveryBinding = {}): DiagnosisRecoveryEvidence {
  const record = object(value, ['schemaVersion', 'status', 'reason', 'initialClass', 'observedCommand', 'executedCommand', 'hypotheses', 'authorizations']);
  if (record.schemaVersion !== 'sutura-diagnosis-recovery-v1' || !Object.hasOwn(FAILURE_TAXONOMY, text(record.initialClass))) invalid();
  for (const key of ['initialClass', 'observedCommand', 'executedCommand'] as const) if (expected[key] !== undefined && record[key] !== expected[key]) invalid();
  status(record.status); text(record.reason); text(record.observedCommand); text(record.executedCommand);
  if (!Array.isArray(record.hypotheses) || record.hypotheses.length < 1 || record.hypotheses.length > 3 || !Array.isArray(record.authorizations) || record.authorizations.length > 2) invalid();
  const hypotheses = record.hypotheses.map((item, index) => {
    const h = object(item, ['id', 'class', 'intent', 'path', 'sourceSha256', 'signal', 'probeId', 'status', 'reason', 'probeOutputSha256']);
    if (h.id !== `hypothesis-${index + 1}` || !Object.hasOwn(FAILURE_TAXONOMY, text(h.class))) invalid();
    status(h.status); text(h.signal); text(h.reason);
    if (index === 0) {
      if (h.intent !== 'repair-source' || h.class !== record.initialClass || h.path !== null || h.sourceSha256 !== null || h.probeId !== null || h.status !== 'not-run' || h.probeOutputSha256 !== null) invalid();
    } else {
      path(h.path); hash(h.sourceSha256, 64);
      if (!['await-operation', 'await-setup', 'restore-strict-config'].includes(text(h.intent))) invalid();
      if (h.class !== (h.intent === 'restore-strict-config' ? 'env-config' : 'test-bug')) invalid();
      if (h.probeId !== (h.intent === 'restore-strict-config' ? 'strict-json' : 'async-completion')) invalid();
      if (h.probeOutputSha256 !== null) hash(h.probeOutputSha256, 64);
      if (h.status === 'passed' && h.probeOutputSha256 === null) invalid();
    }
    return h;
  });
  const matched = new Set<unknown>();
  let baselineIdentity: string | undefined;
  for (const item of record.authorizations) {
    const hasStrict = item && typeof item === 'object' && Object.hasOwn(item, 'strictKey');
    const grant = object(item, ['kind', 'path', 'excerptSha256', 'baseline', 'failingCommand', 'evidenceReferences', 'probeId', 'probeOutputSha256', ...(hasStrict ? ['strictKey'] : [])]);
    path(grant.path); hash(grant.excerptSha256, 64); hash(grant.probeOutputSha256, 64);
    if (grant.failingCommand !== record.observedCommand || !Array.isArray(grant.evidenceReferences) || grant.evidenceReferences.length < 1 || grant.evidenceReferences.length > 8) invalid();
    grant.evidenceReferences.forEach((reference) => text(reference, 256));
    const baseline = object(grant.baseline, ['kind', 'sourceSha', 'policyBaseSha', 'policySha256', 'baselineImageId', 'snapshotSha256']);
    if (!['git', 'local-snapshot'].includes(text(baseline.kind))) invalid();
    text(baseline.baselineImageId, 256); hash(baseline.policySha256, 64);
    for (const key of ['sourceSha', 'policyBaseSha']) { if (baseline[key] === null) { if (baseline.kind !== 'local-snapshot') invalid(); } else hash(baseline[key], 40); }
    if (baseline.snapshotSha256 !== null) hash(baseline.snapshotSha256, 64);
    for (const key of ['sourceSha', 'snapshotSha256', 'policyBaseSha', 'policySha256'] as const) if (expected[key] !== undefined && baseline[key] !== expected[key]) invalid();
    const binding = canonicalJson(baseline);
    if (baselineIdentity !== undefined && baselineIdentity !== binding) invalid();
    baselineIdentity = binding;
    if (grant.kind === 'restore-strict-config' ? !['strict', 'noUncheckedIndexedAccess'].includes(String(grant.strictKey)) : hasStrict) invalid();
    const matches = hypotheses.filter((h) => h.status === 'passed' && h.path === grant.path && h.intent === grant.kind && h.sourceSha256 === grant.excerptSha256 && h.probeId === grant.probeId);
    if (matches.length !== 1 || matched.has(matches[0])) invalid();
    matched.add(matches[0]);
  }
  const passed = hypotheses.filter((h) => h.status === 'passed');
  if (passed.length !== record.authorizations.length || (record.status === 'passed') !== (passed.length > 0)) invalid();
  if (Buffer.byteLength(JSON.stringify(value)) > 65_536) invalid();
  return structuredClone(value) as DiagnosisRecoveryEvidence;
}
