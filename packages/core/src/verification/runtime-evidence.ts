import type { VerificationChallengeSubject } from './types.js';
import { VERIFICATION_REASONS, VERIFICATION_STATUSES } from './types.js';
import { VERIFICATION_GATE_ORDER, type SharedVerificationOutcome } from './evaluate.js';
export interface RuntimeCandidateEvidence {
  schemaVersion: 'sutura-runtime-candidate-v1';
  candidateId: string;
  diffHash: string;
  setHash: string | null;
  verification: SharedVerificationOutcome;
  subjects: VerificationChallengeSubject[];
}
function invalid(): never { throw new Error('Invalid runtime candidate evidence'); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
    return invalid();
  return value as Record<string, unknown>;
}
function hash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}
/** Public observations only. Unknown nested fields cannot carry private controller assertions. */
export function parseRuntimeCandidateEvidence(value: unknown): RuntimeCandidateEvidence {
  const item = object(value, ['schemaVersion', 'candidateId', 'diffHash', 'setHash', 'verification', 'subjects']);
  if (item.schemaVersion !== 'sutura-runtime-candidate-v1'
    || typeof item.candidateId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(item.candidateId)
    || !hash(item.diffHash) || (item.setHash !== null && !hash(item.setHash)))
    invalid();
  const verification = object(item.verification, ['status', 'blockingGate', 'challengeMode', 'challengeAssurance', 'observations']);
  if (!['required', 'optional', 'disabled'].includes(String(verification.challengeMode))
    || typeof verification.challengeAssurance !== 'boolean'
    || !['passed', 'failed', 'insufficient', 'infra-stop'].includes(String(verification.status))
    || !Array.isArray(verification.observations)
    || verification.observations.length !== VERIFICATION_GATE_ORDER.length)
    invalid();
  const observations = verification.observations as unknown[];
  for (const [index, raw] of observations.entries()) {
    const observation = object(raw, ['gate', 'status', 'reasons', 'artifacts']);
    if (observation.gate !== VERIFICATION_GATE_ORDER[index]
      || !VERIFICATION_STATUSES.includes(observation.status as never)
      || !Array.isArray(observation.reasons) || observation.reasons.length > 16
      || !observation.reasons.every(reason => VERIFICATION_REASONS.includes(reason as never))
      || !Array.isArray(observation.artifacts) || observation.artifacts.length > 16)
      invalid();
    const artifactIds = new Set<string>();
    for (const rawArtifact of observation.artifacts as unknown[]) {
      const artifact = object(rawArtifact, ['id', 'sha256']);
      if (typeof artifact.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(artifact.id)
        || !hash(artifact.sha256) || artifactIds.has(artifact.id))
        invalid();
      artifactIds.add(artifact.id as string);
    }
  }
  const outcome = verification as unknown as SharedVerificationOutcome;
  const blockingIndex = outcome.blockingGate === null ? -1 : VERIFICATION_GATE_ORDER.indexOf(outcome.blockingGate);
  if (outcome.blockingGate !== null && blockingIndex < 0)
    invalid();
  const challenge = outcome.observations.find(observation => observation.gate === 'challenges')!;
  if (outcome.challengeAssurance !== (challenge.status === 'passed'))
    invalid();
  if (outcome.challengeAssurance && (item.setHash === null || outcome.challengeMode === 'disabled'))
    invalid();
  if (outcome.status === 'passed') {
    if (outcome.blockingGate !== null || (outcome.challengeMode === 'required' && !outcome.challengeAssurance))
      invalid();
    for (const observation of outcome.observations) {
      if (observation.status === 'passed')
        continue;
      const omittedChallenge = observation.gate === 'challenges' && observation.status === 'not-run'
        && outcome.challengeMode !== 'required'
        && observation.reasons.length > 0
        && observation.reasons.every(reason => reason === 'missing-contract' || reason === 'not-executed');
      if (!omittedChallenge)
        invalid();
    }
  }
  else {
    if (blockingIndex < 0)
      invalid();
    const blocking = outcome.observations[blockingIndex]!;
    if (blocking.status !== outcome.status && !(outcome.status === 'insufficient' && blocking.status === 'not-run'))
      invalid();
    for (const [index, observation] of outcome.observations.entries()) {
      if (index < blockingIndex && !['passed', 'not-run'].includes(observation.status))
        invalid();
      if (index > blockingIndex && observation.status !== 'not-run')
        invalid();
    }
  }
  if (!Array.isArray(item.subjects) || item.subjects.length > 12 || (item.setHash === null && item.subjects.length > 0))
    invalid();
  const seen = new Set<string>();
  for (const raw of item.subjects as unknown[]) {
    const subject = object(raw, ['challengeId', 'subject', 'repetition', 'status', 'observationSha256', 'reasonCode']);
    const key = `${subject.challengeId}:${subject.subject}:${subject.repetition}`;
    if (typeof subject.challengeId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(subject.challengeId)
      || !['baseline', 'candidate'].includes(String(subject.subject)) || ![1, 2].includes(subject.repetition as number)
      || !['passed', 'failed', 'insufficient'].includes(String(subject.status))
      || (subject.observationSha256 !== null && !hash(subject.observationSha256))
      || typeof subject.reasonCode !== 'string' || !/^[a-z0-9-]{1,128}$/u.test(subject.reasonCode)
      || seen.has(key))
      invalid();
    seen.add(key);
  }
  const subjects = item.subjects as VerificationChallengeSubject[];
  if (outcome.challengeAssurance) {
    if (subjects.length === 0 || !challenge.artifacts.some(artifact => artifact.id === 'challenge-set' && artifact.sha256 === item.setHash))
      invalid();
    for (const id of new Set(subjects.map(subject => subject.challengeId))) {
      const baseline = subjects.filter(subject => subject.challengeId === id && subject.subject === 'baseline');
      const candidate = subjects.filter(subject => subject.challengeId === id && subject.subject === 'candidate');
      if (baseline.length !== 2 || candidate.length !== 2
        || baseline[0]!.status === 'insufficient' || baseline[0]!.status !== baseline[1]!.status
        || candidate.some(subject => subject.status !== 'passed')
        || [...baseline, ...candidate].some(subject => subject.observationSha256 === null))
        invalid();
    }
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 32768)
    invalid();
  return structuredClone(value) as RuntimeCandidateEvidence;
}
