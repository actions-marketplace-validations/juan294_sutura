/**
 * The run manifest and the evidence contract for a paid measurement.
 *
 * A manifest is written before any job is dispatched and names exactly what
 * will run, under what identities and inside what caps. There is no default
 * unlimited value anywhere in it: a missing cap is a refusal, not an implied
 * infinity, because a run that could not have been costed in advance cannot be
 * authorized in advance either.
 *
 * Nothing here dispatches, spends or contacts a provider. It validates what a
 * request would be and what a completed run must show.
 */
import { createHash } from 'node:crypto';

export const RUN_MANIFEST_SCHEMA = 'sutura-verified-program-manifest-v1';
export const RUN_EVIDENCE_SCHEMA = 'sutura-verified-program-evidence-v1';

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const SUBJECT_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

/** Every cap a manifest must state. None has a default. */
export const REQUIRED_CAPS = Object.freeze([
  'subjects', 'repetitions', 'modelTurnsPerSubject', 'maxOutputTokens',
  'sandboxOperations', 'elapsedTimeSec', 'inferenceUsd', 'rawSandboxUnits',
  'concurrency',
]);

/** The identities a result must agree with, one by one. */
export const RUN_IDENTITY_FIELDS = Object.freeze([
  'candidateCommit', 'imageDigest', 'corpusHash', 'splitHash', 'configHash',
]);

export const RUN_MODES = Object.freeze(['live', 'replay', 'recorded']);

export class RunEvidenceError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'RunEvidenceError';
    this.reasonCode = reasonCode;
  }
}

function refuse(reasonCode, message) {
  throw new RunEvidenceError(reasonCode, message);
}

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    refuse('unbounded-cap', `${name} must be a stated positive whole number`);
  }
  return value;
}

function positiveAmount(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    refuse('unbounded-cap', `${name} must be a stated positive amount`);
  }
  return value;
}

/**
 * Validates a run manifest.
 *
 * The stop policy is required because a run with no stated stop is a run that
 * can only end by exhausting a cap, and the price ceiling is required because
 * an authorization that cannot be priced cannot be given.
 */
export function validateRunManifest(manifest) {
  if (manifest?.schemaVersion !== RUN_MANIFEST_SCHEMA) {
    refuse('invalid-schema', 'A run manifest names its schema version');
  }
  if (!COMMIT.test(manifest.identity?.candidateCommit ?? '')) {
    refuse('invalid-identity', 'identity.candidateCommit must be an exact 40-character commit');
  }
  for (const field of ['imageDigest', 'corpusHash', 'splitHash', 'configHash']) {
    const value = manifest.identity?.[field] ?? '';
    if (!SHA256.test(String(value).replace(/^sha256:/u, ''))) {
      refuse('invalid-identity', `identity.${field} must be a sha256 digest`);
    }
  }
  if (!Array.isArray(manifest.models) || manifest.models.length === 0) {
    refuse('missing-models', 'A manifest names the models it will use');
  }
  for (const model of manifest.models) {
    if (!model?.modelId?.trim()) refuse('missing-models', 'Each model needs an exact id');
    positiveAmount(model.inputPerMillionUsd, `models.${model.modelId}.inputPerMillionUsd`);
    positiveAmount(model.outputPerMillionUsd, `models.${model.modelId}.outputPerMillionUsd`);
    if (!model.priceAsOf?.trim()) refuse('missing-price-date', `models.${model.modelId} needs a price date`);
  }

  const caps = manifest.caps ?? {};
  for (const cap of REQUIRED_CAPS) {
    if (!Object.hasOwn(caps, cap)) refuse('unbounded-cap', `caps.${cap} has no default and must be stated`);
  }
  for (const cap of [
    'subjects', 'repetitions', 'modelTurnsPerSubject', 'maxOutputTokens',
    'sandboxOperations', 'concurrency',
  ]) {
    positiveInteger(caps[cap], `caps.${cap}`);
  }
  for (const cap of ['elapsedTimeSec', 'inferenceUsd', 'rawSandboxUnits']) {
    positiveAmount(caps[cap], `caps.${cap}`);
  }
  if (!manifest.stopPolicy?.trim()) refuse('missing-stop-policy', 'A manifest states how the run stops');
  if (!Array.isArray(manifest.subjects) || manifest.subjects.length === 0) {
    refuse('missing-subjects', 'A manifest lists the subjects it will run');
  }
  const seen = new Set();
  for (const subject of manifest.subjects) {
    if (!SUBJECT_ID.test(subject ?? '')) refuse('invalid-subject', `${String(subject)} is not a bounded subject id`);
    if (seen.has(subject)) refuse('duplicate-subject', `${subject} is listed more than once`);
    seen.add(subject);
  }
  if (manifest.subjects.length > caps.subjects) {
    refuse('over-cap', `The manifest lists ${manifest.subjects.length} subjects against a cap of ${caps.subjects}`);
  }
  if (!RUN_MODES.includes(manifest.mode)) refuse('invalid-mode', 'mode must be live, replay or recorded');
  return { ...manifest, manifestHash: digest({ ...manifest, manifestHash: undefined }) };
}

/**
 * The priced worst case for a manifest, from its own caps and prices.
 *
 * This is what an authorization is given against. It is deliberately the
 * ceiling rather than an estimate: a request that can only be approved on an
 * optimistic average is not a bounded request.
 *
 * Every turn is priced at the most expensive model the manifest names, with
 * the full input and output allowance, and a subject may take
 * `modelTurnsPerSubject` of them in each repetition. Pricing one turn per
 * subject would understate a repair that is allowed eight.
 */
export function manifestMaximumUsd(manifest) {
  const valid = validateRunManifest(manifest);
  const perTurnUsd = Math.max(...valid.models.map(({ inputPerMillionUsd, outputPerMillionUsd }) =>
    (inputPerMillionUsd + outputPerMillionUsd) * (valid.caps.maxOutputTokens / 1_000_000)));
  const turns = valid.caps.subjects * valid.caps.repetitions * valid.caps.modelTurnsPerSubject;
  return Math.min(perTurnUsd * turns, valid.caps.inferenceUsd);
}

function costOf(result, name) {
  const cost = result.cost ?? {};
  if (cost.inferenceUsd === null || cost.inferenceUsd === undefined) {
    refuse('unknown-cost', `${name} reports no inference cost; unknown is not zero`);
  }
  if (typeof cost.inferenceUsd !== 'number' || !Number.isFinite(cost.inferenceUsd) || cost.inferenceUsd < 0) {
    refuse('negative-cost', `${name} reports an impossible inference cost`);
  }
  if (cost.rawSandboxUnits !== null && (typeof cost.rawSandboxUnits !== 'number' || cost.rawSandboxUnits < 0)) {
    refuse('negative-cost', `${name} reports an impossible sandbox amount`);
  }
  if (cost.rawSandboxUnits !== null && !cost.rawSandboxUnit?.trim()) {
    refuse('unconfirmed-unit', `${name} reports a sandbox amount with no unit`);
  }
  return cost;
}

/**
 * Validates the evidence a completed run produced against its own manifest.
 *
 * Every check here answers one question: does this evidence describe the run
 * that was authorized? A result under a different candidate, model, price,
 * corpus or split describes a different experiment; a missing or duplicated
 * subject changes the denominator; a recorded result presented as live claims
 * execution that did not happen; a subject outside the manifest is an
 * expansion nobody approved; and an unknown cost counted as zero makes a run
 * look cheaper than it can be shown to be.
 */
export function validateRunEvidence(input) {
  const manifest = validateRunManifest(input.manifest);
  if (input.schemaVersion !== RUN_EVIDENCE_SCHEMA) {
    refuse('invalid-schema', 'Run evidence names its schema version');
  }
  if (input.manifestHash !== manifest.manifestHash) {
    refuse('manifest-mismatch', 'The evidence was recorded against a different manifest');
  }

  const results = Array.isArray(input.results) ? input.results : [];
  const expected = new Set(manifest.subjects);
  const seen = new Set();
  let inferenceUsd = 0;
  let unconfirmedUnits = 0;

  for (const result of results) {
    const name = `result ${String(result?.subjectId)}`;
    if (!expected.has(result?.subjectId)) {
      refuse('unauthorized-expansion', `${name} is not a subject this manifest authorized`);
    }
    if (seen.has(result.subjectId)) refuse('duplicate-result', `${name} appears more than once`);
    seen.add(result.subjectId);

    for (const field of RUN_IDENTITY_FIELDS) {
      if (result.identity?.[field] !== manifest.identity[field]) {
        refuse('identity-mismatch', `${name} ran under a different ${field}`);
      }
    }
    if (!manifest.models.some(({ modelId }) => modelId === result.modelId)) {
      refuse('identity-mismatch', `${name} used a model the manifest does not name`);
    }
    const priced = manifest.models.find(({ modelId }) => modelId === result.modelId);
    if (result.price?.inputPerMillionUsd !== priced.inputPerMillionUsd ||
      result.price?.outputPerMillionUsd !== priced.outputPerMillionUsd) {
      refuse('identity-mismatch', `${name} was priced differently from the manifest`);
    }
    if (result.mode !== manifest.mode) {
      refuse('relabeled-mode', `${name} is a ${String(result.mode)} result in a ${manifest.mode} run`);
    }
    if (!['terminal', 'cancelled'].includes(result.disposition)) {
      refuse('non-terminal-result', `${name} is neither terminal nor explicitly cancelled`);
    }

    const cost = costOf(result, name);
    inferenceUsd += cost.inferenceUsd;
    if (cost.rawSandboxUnits === null) unconfirmedUnits += 1;
  }

  const missing = [...expected].filter((subject) => !seen.has(subject));
  if (missing.length > 0) {
    refuse('missing-result', `The run has no result for ${missing.join(', ')}`);
  }
  if (inferenceUsd > manifest.caps.inferenceUsd) {
    refuse('over-cap', `The run spent ${inferenceUsd} against a cap of ${manifest.caps.inferenceUsd}`);
  }

  return {
    schemaVersion: RUN_EVIDENCE_SCHEMA,
    manifestHash: manifest.manifestHash,
    subjects: results.length,
    cancelled: results.filter(({ disposition }) => disposition === 'cancelled').length,
    inferenceUsd,
    /** Results whose provider gave no confirmed billing unit; never folded into a total. */
    unconfirmedSandboxUnits: unconfirmedUnits,
    evidenceHash: digest({ manifestHash: manifest.manifestHash, results }),
  };
}
