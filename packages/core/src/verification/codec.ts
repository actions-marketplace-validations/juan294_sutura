import { parseDiagnosisRecoveryEvidence } from './recovery.js';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../replay/canonical-json.js';
import { VERIFICATION_COST_VERSION, VERIFICATION_EVIDENCE_VERSION, VERIFICATION_EXECUTION_EVIDENCE_VERSION, VERIFICATION_GATES, VERIFICATION_REASONS, VERIFICATION_STATUSES } from './types.js';
import type { VerificationArtifact, VerificationEvidence, VerificationIdentity } from './types.js';

const MAX_BYTES = 1_000_000;
const SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const FORBIDDEN = /(?:\/Users\/|[A-Z]:\\Users\\|Authorization:\s*(?:Bearer|Basic)|github_pat_|ghp_|sk-[A-Za-z0-9]{20,})/u;

export class VerificationEvidenceError extends Error {
  constructor(path: string, cause: string) {
    super(`verification.${path}: ${cause}`);
    this.name = 'VerificationEvidenceError';
  }
}

function object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new VerificationEvidenceError(path, 'must be an object');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) {
    throw new VerificationEvidenceError(path, `requires exactly ${keys.join(', ')}`);
  }
  return record;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096 || FORBIDDEN.test(value)) {
    throw new VerificationEvidenceError(path, 'must be bounded public text');
  }
  return value;
}

function pattern(value: unknown, path: string, expression: RegExp): string {
  const result = text(value, path);
  if (!expression.test(result)) throw new VerificationEvidenceError(path, 'has invalid format');
  return result;
}

function choice(value: unknown, path: string, choices: readonly string[]): void {
  if (typeof value !== 'string' || !choices.includes(value)) throw new VerificationEvidenceError(path, 'is missing or unsupported');
}

function number(value: unknown, path: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    throw new VerificationEvidenceError(path, 'must be nonnegative and finite');
  }
  return value;
}

function array(value: unknown, path: string, max = 512): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new VerificationEvidenceError(path, 'must be a bounded array');
  return value;
}

function date(value: unknown, path: string, dayOnly = false): void {
  const raw = pattern(value, path, dayOnly ? /^\d{4}-\d{2}-\d{2}$/u : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  if (!Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString().slice(0, dayOnly ? 10 : 24) !== raw) {
    throw new VerificationEvidenceError(path, 'must be an exact UTC date');
  }
}

function source(value: unknown, path: string): void {
  const raw = text(value, path);
  let url: URL;
  try { url = new URL(raw); } catch { throw new VerificationEvidenceError(path, 'must be an https provenance URL'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new VerificationEvidenceError(path, 'must be an https provenance URL');
}

function validateCosts(value: unknown, modelCount: number): void {
  const costs = object(value, 'costs', ['schemaVersion', 'inference', 'sandbox', 'wallTimeMs']);
  choice(costs.schemaVersion, 'costs.schemaVersion', [VERIFICATION_COST_VERSION]);
  if (costs.wallTimeMs !== null) number(costs.wallTimeMs, 'costs.wallTimeMs');
  if (costs.inference !== null) array(costs.inference, 'costs.inference').forEach((entry, index) => {
    const path = `costs.inference[${index}]`;
    const item = object(entry, path, ['modelIndex', 'inputTokens', 'outputTokens', 'reasoningTokens', 'estimateUsd', 'price']);
    if (number(item.modelIndex, `${path}.modelIndex`, true) >= modelCount) throw new VerificationEvidenceError(path, 'modelIndex is not recorded');
    const input = number(item.inputTokens, `${path}.inputTokens`, true);
    const output = number(item.outputTokens, `${path}.outputTokens`, true);
    const reasoning = number(item.reasoningTokens, `${path}.reasoningTokens`, true);
    if (item.price === null) {
      if (item.estimateUsd !== null) throw new VerificationEvidenceError(path, 'estimate needs dated price provenance');
    } else {
      const price = object(item.price, `${path}.price`, ['inputPerMillionUsd', 'outputPerMillionUsd', 'asOf', 'source']);
      const inputPrice = number(price.inputPerMillionUsd, `${path}.price.inputPerMillionUsd`);
      const outputPrice = number(price.outputPerMillionUsd, `${path}.price.outputPerMillionUsd`);
      date(price.asOf, `${path}.price.asOf`, true); source(price.source, `${path}.price.source`);
      const estimate = number(item.estimateUsd, `${path}.estimateUsd`);
      const expected = (input * inputPrice + (output + reasoning) * outputPrice) / 1_000_000;
      if (!Number.isFinite(expected) || Math.abs(estimate - expected) > 0.000000500001) throw new VerificationEvidenceError(path, 'estimate does not match recorded usage and price');
    }
  });
  const operationIds = new Set<string>();
  if (costs.sandbox !== null) array(costs.sandbox, 'costs.sandbox').forEach((entry, index) => {
    const path = `costs.sandbox[${index}]`;
    const item = object(entry, path, ['operationId', 'rawAmount', 'rawUnit', 'unitSource', 'billed']);
    const id = text(item.operationId, `${path}.operationId`);
    if (operationIds.has(id)) throw new VerificationEvidenceError(path, 'duplicate operation');
    operationIds.add(id);
    if (item.rawAmount !== null) number(item.rawAmount, `${path}.rawAmount`);
    if (item.rawUnit === null) {
      if (item.unitSource !== null) throw new VerificationEvidenceError(path, 'unknown unit cannot carry unit provenance');
    } else { text(item.rawUnit, `${path}.rawUnit`); source(item.unitSource, `${path}.unitSource`); }
    if (item.billed !== null) {
      const billed = object(item.billed, `${path}.billed`, ['amount', 'currency', 'source', 'asOf']);
      number(billed.amount, `${path}.billed.amount`);
      pattern(billed.currency, `${path}.billed.currency`, /^[A-Z]{3}$/u);
      source(billed.source, `${path}.billed.source`); date(billed.asOf, `${path}.billed.asOf`, true);
    }
  });
}

/** Strict allowlists exclude raw oracle tables and arbitrary metadata from public evidence. */
/** At most three challenges, two subjects, two repetitions each. */
const MAX_CHALLENGE_SUBJECT_RECORDS = 12;
const MAX_CHALLENGE_REPETITION = 2;

/**
 * Per-repetition challenge records.
 *
 * A record exists only for a repetition that was actually reached, so the
 * absence of one is not a pass. A candidate record cannot appear without the
 * baseline records for the same challenge, because a challenge that never
 * qualified on the baseline says nothing about a candidate. A repetition that
 * observed something carries the digest of what it observed; one that was
 * cancelled or could not run carries null and states its reason.
 */
function validateChallengeSubjects(value: unknown, hasSetHash: boolean): void {
  if (!hasSetHash) throw new VerificationEvidenceError('challenges', 'subject records require the frozen set hash');
  const entries = array(value, 'challenges.subjects', MAX_CHALLENGE_SUBJECT_RECORDS);
  const seen = new Set<string>();
  const baselineRepetitions = new Map<string, number>();
  const candidates: string[] = [];
  for (const entry of entries) {
    const record = object(entry, 'challenges.subjects', [
      'challengeId', 'subject', 'repetition', 'status', 'observationSha256', 'reasonCode',
    ]);
    const challengeId = text(record.challengeId, 'challenges.subjects.challengeId');
    choice(record.subject, 'challenges.subjects.subject', ['baseline', 'candidate']);
    const repetition = number(record.repetition, 'challenges.subjects.repetition', true);
    if (repetition < 1 || repetition > MAX_CHALLENGE_REPETITION) {
      throw new VerificationEvidenceError('challenges.subjects', 'repetition is outside the frozen repetition count');
    }
    choice(record.status, 'challenges.subjects.status', ['passed', 'failed', 'insufficient']);
    text(record.reasonCode, 'challenges.subjects.reasonCode');
    const key = `${challengeId}:${String(record.subject)}:${repetition}`;
    if (seen.has(key)) throw new VerificationEvidenceError('challenges.subjects', 'duplicate repetition record');
    seen.add(key);
    if (record.observationSha256 === null) {
      if (record.status !== 'insufficient') {
        throw new VerificationEvidenceError('challenges.subjects', 'a decided repetition must carry its observation digest');
      }
    } else pattern(record.observationSha256, 'challenges.subjects.observationSha256', /^[a-f0-9]{64}$/u);
    if (record.subject === 'baseline') {
      baselineRepetitions.set(challengeId, (baselineRepetitions.get(challengeId) ?? 0) + 1);
    } else candidates.push(challengeId);
  }
  for (const challengeId of candidates) {
    if ((baselineRepetitions.get(challengeId) ?? 0) !== MAX_CHALLENGE_REPETITION) {
      throw new VerificationEvidenceError('challenges.subjects', 'a candidate repetition requires every baseline repetition');
    }
  }
}

export function parseVerificationEvidence(value: unknown): VerificationEvidence {
  const hasRecovery = value !== null && typeof value === 'object' && Object.hasOwn(value, 'recovery');
  const item = object(value, 'evidence', ['schemaVersion', 'mode', 'outcome', 'assurance', 'identity', 'startedAt', 'finishedAt', 'commands', 'models', 'challenges', 'gates', 'costs', ...(hasRecovery ? ['recovery'] : [])]);
  choice(item.schemaVersion, 'schemaVersion', [VERIFICATION_EVIDENCE_VERSION, VERIFICATION_EXECUTION_EVIDENCE_VERSION]);
  choice(item.mode, 'mode', ['live', 'replay', 'recorded', 'local']);
  choice(item.outcome, 'outcome', ['repaired', 'verified-supplied-patch', 'refused', 'flaky-no-patch', 'insufficient', 'infra-stop']);
  choice(item.assurance, 'assurance', ['contract-verified', 'baseline-only']);
  const executorIdentity = item.schemaVersion === VERIFICATION_EXECUTION_EVIDENCE_VERSION;
  const identity = object(item.identity, 'identity', ['sourceSha', 'snapshotSha256', 'policyBaseSha', 'policySha256', 'diffSha256', 'corpusRevision', 'fixtureRevision', 'imageDigest', 'routingVersion', 'challengeVersion', ...(executorIdentity ? ['executorImageId', 'sourceKind'] : [])]);
  if (executorIdentity && identity.executorImageId !== null) text(identity.executorImageId, 'identity.executorImageId');
  if (executorIdentity) choice(identity.sourceKind, 'identity.sourceKind', ['git', 'local-snapshot']);
  for (const key of ['sourceSha', 'policyBaseSha']) {
    if (executorIdentity && identity.sourceKind === 'local-snapshot' && identity[key] === null) continue;
    pattern(identity[key], `identity.${key}`, SHA);
  }
  pattern(identity.policySha256, 'identity.policySha256', SHA256);
  for (const key of ['snapshotSha256', 'diffSha256']) if (identity[key] !== null) pattern(identity[key], `identity.${key}`, SHA256);
  for (const key of ['corpusRevision', 'fixtureRevision']) if (identity[key] !== null) text(identity[key], `identity.${key}`);
  if (identity.imageDigest !== null) pattern(identity.imageDigest, 'identity.imageDigest', /^sha256:[a-f0-9]{64}$/u);
  for (const key of ['routingVersion', 'challengeVersion']) text(identity[key], `identity.${key}`);
  date(item.startedAt, 'startedAt'); date(item.finishedAt, 'finishedAt');
  if (String(item.finishedAt) < String(item.startedAt)) throw new VerificationEvidenceError('finishedAt', 'precedes start');
  array(item.commands, 'commands', 64).forEach((command) => text(command, 'commands'));
  if (hasRecovery) {
    const recovery = parseDiagnosisRecoveryEvidence(item.recovery, identity as unknown as VerificationIdentity);
    if (!(item.commands as string[]).includes(recovery.executedCommand)) throw new VerificationEvidenceError('recovery', 'executed recovery command is not recorded');
  }
  const models = array(item.models, 'models');
  models.forEach((entry) => {
    const model = object(entry, 'models', ['purpose', 'tier', 'requestedModel', 'returnedModel']);
    choice(model.purpose, 'models.purpose', ['diagnosis', 'repair', 'challenge-generation', 'adjudication', 'terminal-evidence']);
    choice(model.tier, 'models.tier', ['nano', 'super', 'ultra']);
    text(model.requestedModel, 'models.requestedModel');
    if (model.returnedModel !== null) text(model.returnedModel, 'models.returnedModel');
  });
  validateCosts(item.costs, models.length);
  const declared = typeof item.challenges === 'object' && item.challenges !== null
    ? (item.challenges as Record<string, unknown>) : {};
  const hasSetHash = 'setHash' in declared;
  const hasSubjects = 'subjects' in declared;
  const challenge = object(item.challenges, 'challenges', [
    'mode', 'qualifiedProbeCount', ...(hasSetHash ? ['setHash'] : []), ...(hasSubjects ? ['subjects'] : []),
  ]);
  if (hasSetHash &&
    (typeof challenge.setHash !== 'string' || !/^[a-f0-9]{64}$/u.test(challenge.setHash))) {
    throw new VerificationEvidenceError('challenges', 'setHash must be a sha256 digest');
  }
  if (hasSetHash && challenge.mode === 'disabled') {
    throw new VerificationEvidenceError('challenges', 'disabled mode has no frozen challenge set');
  }
  if (hasSubjects) validateChallengeSubjects(challenge.subjects, hasSetHash);
  choice(challenge.mode, 'challenges.mode', ['required', 'optional', 'disabled']);
  if (number(challenge.qualifiedProbeCount, 'challenges.qualifiedProbeCount', true) > 3) throw new VerificationEvidenceError('challenges', 'at most three qualified probes');
  const gates = array(item.gates, 'gates', VERIFICATION_GATES.length);
  const statuses = new Map<string, unknown>();
  gates.forEach((entry) => {
    const gate = object(entry, 'gates', ['gate', 'status', 'reasons', 'artifacts']);
    choice(gate.gate, 'gates.gate', VERIFICATION_GATES); choice(gate.status, 'gates.status', VERIFICATION_STATUSES);
    const id = String(gate.gate);
    if (statuses.has(id)) throw new VerificationEvidenceError('gates', 'duplicate gate');
    statuses.set(id, gate.status);
    const reasons = array(gate.reasons, 'gates.reasons', 16);
    reasons.forEach((reason) => choice(reason, 'gates.reasons', VERIFICATION_REASONS));
    if ((gate.status === 'passed') !== (reasons.length === 0)) throw new VerificationEvidenceError('gates.reasons', 'blocking states require reasons; passed states cannot carry blockers');
    const artifacts = array(gate.artifacts, 'gates.artifacts', 64);
    artifacts.forEach((entry) => {
      const artifact = object(entry, 'gates.artifacts', ['id', 'sha256']);
      text(artifact.id, 'gates.artifacts.id'); pattern(artifact.sha256, 'gates.artifacts.sha256', SHA256);
    });
    if (gate.status === 'passed' && artifacts.length === 0) throw new VerificationEvidenceError('gates.artifacts', 'passed gate needs an executed observation');
  });
  for (const gate of ['policy', 'visible', 'audit', 'challenges']) if (!statuses.has(gate)) throw new VerificationEvidenceError('gates', `missing ${gate} status`);
  const accepted = item.outcome === 'repaired' || item.outcome === 'verified-supplied-patch';
  const challenged = statuses.get('challenges') === 'passed' && (challenge.qualifiedProbeCount as number) > 0;
  if (statuses.get('challenges') === 'passed' && !challenged) throw new VerificationEvidenceError('challenges', 'passed challenges require at least one qualified probe');
  if (challenge.mode === 'disabled' && (challenge.qualifiedProbeCount !== 0 || statuses.get('challenges') !== 'not-run' || item.assurance !== 'baseline-only')) throw new VerificationEvidenceError('challenges', 'disabled mode requires absent probes and an explicit not-run observation');
  if (item.assurance === 'contract-verified' && (!accepted || !challenged)) throw new VerificationEvidenceError('assurance', 'requires an accepted outcome with qualified challenges');
  if (accepted) {
    if (['snapshotSha256', 'diffSha256', executorIdentity ? 'executorImageId' : 'imageDigest'].some((key) => identity[key] === null)) throw new VerificationEvidenceError('identity', 'accepted results require exact snapshot, candidate diff and image identities');
    if (gates.some((entry) => { const gate = entry as Record<string, unknown>; return gate.gate !== 'challenges' && gate.status !== 'passed'; })) throw new VerificationEvidenceError('outcome', 'acceptance requires every retained gate passed');
    if (challenge.mode === 'required' && (!challenged || item.assurance !== 'contract-verified')) throw new VerificationEvidenceError('outcome', 'required challenges are incomplete');
    if (challenge.mode === 'optional' && !challenged) {
      const challengeGate = gates.find((entry) => (entry as Record<string, unknown>).gate === 'challenges') as Record<string, unknown>;
      const status = statuses.get('challenges');
      const baselineOnly = challenge.qualifiedProbeCount === 0 &&
        (status === 'not-run' || status === 'insufficient') &&
        (challengeGate.reasons as string[]).every((reason) => ['not-executed', 'missing-contract', 'unsupported-contract'].includes(reason));
      if (!baselineOnly) throw new VerificationEvidenceError('challenges', 'incomplete retained optional probes cannot be ignored');
    }
    if (array(item.commands, 'commands').length === 0) throw new VerificationEvidenceError('commands', 'acceptance requires executed commands');
  }
  if (Buffer.byteLength(canonicalJson(item)) > MAX_BYTES) throw new VerificationEvidenceError('evidence', 'exceeds byte limit');
  return JSON.parse(canonicalJson(item)) as VerificationEvidence;
}

function digest(bytes: string): string { return createHash('sha256').update(bytes, 'utf8').digest('hex'); }

/** Only timing is normalized; identity, costs and observations remain comparison inputs. */
function comparison(evidence: VerificationEvidence): string {
  return digest(canonicalJson({ ...evidence, startedAt: null, finishedAt: null, costs: { ...evidence.costs, wallTimeMs: null } }));
}

export function encodeVerificationEvidence(value: VerificationEvidence): VerificationArtifact {
  const evidence = parseVerificationEvidence(value);
  const bytes = canonicalJson(evidence);
  return { bytes, integritySha256: digest(bytes), normalizedComparisonSha256: comparison(evidence) };
}

/** Caller supplies the trusted expected identity; an artifact cannot choose its own subject. */
export function decodeVerificationEvidence(artifact: VerificationArtifact, expectedIdentity: VerificationIdentity): VerificationEvidence {
  if (typeof artifact.bytes !== 'string' || Buffer.byteLength(artifact.bytes) > MAX_BYTES) throw new VerificationEvidenceError('bytes', 'exceeds byte limit');
  if (digest(artifact.bytes) !== artifact.integritySha256) throw new VerificationEvidenceError('integritySha256', 'does not match stored bytes');
  let decoded: unknown;
  try { decoded = JSON.parse(artifact.bytes); } catch { throw new VerificationEvidenceError('bytes', 'invalid JSON'); }
  const evidence = parseVerificationEvidence(decoded);
  if (canonicalJson(evidence) !== artifact.bytes) throw new VerificationEvidenceError('bytes', 'must use canonical JSON without duplicate fields');
  if (canonicalJson(evidence.identity) !== canonicalJson(expectedIdentity)) throw new VerificationEvidenceError('identity', 'does not match trusted expected identity');
  if (comparison(evidence) !== artifact.normalizedComparisonSha256) throw new VerificationEvidenceError('normalizedComparisonSha256', 'does not match evidence');
  return evidence;
}
