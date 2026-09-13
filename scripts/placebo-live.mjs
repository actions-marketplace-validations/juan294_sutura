import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  canonicalJson, contentHash, exactSha, publicGitHubUrl, SHA256_PATTERN,
} from './evidence-contract.mjs';
import { RELEASE_VERSION } from './install-test-lib.mjs';
import { requireActivePushFreeze } from './push-freeze.mjs';
import { initializeManifestSpend, withManifestSpend, readManifestPending } from './manifest-spend.mjs';
import { acquireProcessLock } from './live-process-lock.mjs';
import { runWithTerminalAlert, createCommandDelivery, readAlert, deliverAlert, acknowledgeAlert } from './evaluation-alerts.mjs';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const CORPUS_PATH = resolve(ROOT, 'docs/demo/placebo-v0.2-corpus.json');
/**
 * The expanded selection: the frozen 51 plus every versioned case. It is a
 * separate committed manifest with its own hash, so opting into it can never
 * change what the frozen slice means or what a historical score refers to.
 */
const EXPANDED_CORPUS_PATH = resolve(ROOT, 'docs/demo/placebo-v0.2-expanded-corpus.json');
const LEDGER_PATH = resolve(ROOT, '.sutura/placebo-v0.2.1-live-ledger.json');
const LOCK_PATH = resolve(ROOT, '.sutura/placebo-v0.2.1-live.lock');
const ARTIFACT_ROOT = resolve(ROOT, '.sutura/placebo-v0.2.1-live-artifacts');
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const OUTCOMES = new Set(['fixed', 'flaky-no-patch', 'refused', 'gave-up', 'infra-stop']);
const KIND_ORDER = new Map([['flaky', 0], ['trap', 1], ['upstream', 2], ['repairable', 3]]);
const CORPUS_HASH = '785cfc70359935a0f04a9a9cda39e8fb6ff4b05cc8fea3738fb24b70bcda101f';
const EXPANDED_CORPUS_HASH = 'd4757a557e3376b8610c7e0ecc3b6660f5f2ca10d2fbee43e04ebaa617e4d136';
const FROZEN_CASE_COUNT = 51;
const EXPANDED_CASE_COUNT = 100;
const PUBLIC_REDACTION = Object.freeze({
  credential: '[REDACTED_CREDENTIAL]',
  privatePath: '[REDACTED_PRIVATE_PATH]',
});

function boundedUsd(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be a bounded nonnegative USD amount`);
  }
  return value;
}

export function validateLiveSpendBounds(capUsd, initialReserveUsd, label) {
  const cap = boundedUsd(capUsd, `${label} cap`);
  const reserve = boundedUsd(initialReserveUsd, `${label} initial reserve`);
  if (reserve <= 0) throw new Error(`${label} initial reserve must be greater than zero`);
  if (reserve > cap) throw new Error(`${label} initial reserve must not exceed cap`);
  return { capUsd: cap, initialReserveUsd: reserve };
}

function exactSha256(value, label) {
  if (!SHA256_PATTERN.test(value ?? '')) throw new Error(`${label} must be an exact SHA-256 digest`);
  return value;
}

function runId(value, label = 'GitHub run') {
  const text = String(value ?? '');
  if (!/^[1-9]\d{0,19}$/u.test(text)) throw new Error(`${label} must be a workflow run id`);
  return text;
}

function artifactName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new Error('Placebo artifact name is invalid');
  }
  return value;
}

function loadCorpusSync(expanded = false) {
  const value = JSON.parse(Buffer.from(requireCorpusBytes(expanded)).toString('utf8'));
  return validateCorpus(value, expanded);
}

let corpusBytes;
let expandedCorpusBytes;
function requireCorpusBytes(expanded = false) {
  if (expanded) {
    expandedCorpusBytes ??= readFileSync(EXPANDED_CORPUS_PATH);
    return expandedCorpusBytes;
  }
  corpusBytes ??= readFileSync(CORPUS_PATH);
  return corpusBytes;
}

/**
 * Each selection is pinned to its own exact count and hash, so neither can be
 * served in place of the other and the frozen slice keeps its identity.
 */
function validateCorpus(value, expanded = false) {
  const count = expanded ? EXPANDED_CASE_COUNT : FROZEN_CASE_COUNT;
  const hash = expanded ? EXPANDED_CORPUS_HASH : CORPUS_HASH;
  if (value?.schemaVersion !== 'placebo-corpus-manifest-v1' || value.corpusVersion !== '0.2' ||
      !Array.isArray(value.cases) || value.cases.length !== count ||
      value.corpusHash !== hash ||
      new Set(value.cases.map(({ id }) => id)).size !== count) {
    throw new Error(`Placebo canonical corpus must contain ${count} unique cases`);
  }
  return value;
}

/** True when the case exists only in the expanded selection. */
function needsExpandedSelection(caseId) {
  return !loadCorpusSync().cases.some(({ id }) => id === caseId);
}

function corpusCase(corpus, caseId) {
  const matches = corpus.cases.filter(({ id }) => id === caseId);
  if (matches.length !== 1) throw new Error(`Placebo case is not one canonical case: ${caseId}`);
  return matches[0];
}

function normalizeResult(value, expectedCase) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      value.caseId !== expectedCase.id || value.kind !== expectedCase.metadata.kind ||
      value.language !== expectedCase.metadata.language || typeof value.tavilyEnabled !== 'boolean' ||
      typeof value.elapsedTimeMs !== 'number' || !Number.isFinite(value.elapsedTimeMs) || value.elapsedTimeMs < 0) {
    throw new Error(`Placebo result differs from canonical case ${expectedCase.id}`);
  }
  const caseFile = value.caseFile;
  if (caseFile === null || typeof caseFile !== 'object' || Array.isArray(caseFile) ||
      !OUTCOMES.has(caseFile.outcome) || !Array.isArray(caseFile.cost?.entries) ||
      !Array.isArray(caseFile.stages) || caseFile.stages.length > 128 ||
      !Array.isArray(caseFile.trace) || caseFile.trace.length > 10_000) {
    throw new Error(`Placebo result contract is invalid for ${expectedCase.id}`);
  }
  for (const entry of caseFile.cost.entries) boundedUsd(entry?.usd, 'Placebo inference cost');
  for (const stage of caseFile.stages) {
    if (stage?.operationId !== undefined &&
        (typeof stage.operationId !== 'string' || stage.operationId.length === 0 || stage.operationId.length > 240)) {
      throw new Error(`Placebo operation ID is invalid for ${expectedCase.id}`);
    }
    if (stage?.metrics?.cost !== undefined) boundedUsd(stage.metrics.cost, 'Placebo sandbox cost');
  }
  return value;
}

function validateResultSet(results, expectedCase) {
  if (!Array.isArray(results)) throw new Error('Placebo case results must be an array');
  const normalized = results.map((result) => normalizeResult(result, expectedCase));
  if (expectedCase.metadata.kind === 'upstream') {
    if (normalized.length !== 2 || normalized[0].tavilyEnabled !== true ||
        normalized[1].tavilyEnabled !== false) {
      throw new Error(`Upstream case ${expectedCase.id} requires its exact Tavily pair`);
    }
  } else if (normalized.length !== 1) {
    throw new Error(`Placebo case ${expectedCase.id} requires one evaluation`);
  }
  return normalized;
}

function artifactBase(input, options = {}) {
  const corpus = options.corpus === undefined
    ? loadCorpusSync(needsExpandedSelection(input.caseId))
    : validateCorpus(options.corpus, options.corpus.cases?.length === EXPANDED_CASE_COUNT);
  const expectedCase = corpusCase(corpus, input.caseId);
  const results = validateResultSet(input.results, expectedCase);
  const controllerSha = exactSha(input.controllerSha, 'Placebo controller');
  const subjectSha = exactSha(input.subjectSha, 'Placebo subject');
  if (input.subjectVersion !== RELEASE_VERSION) {
    throw new Error('Placebo subject identity is invalid');
  }
  if (!SHA256_PATTERN.test(input.packageContentHash ?? '') ||
      !SHA256_PATTERN.test(input.packageIntegrity ?? '') ||
      !SHA256_PATTERN.test(input.evaluationManifestHash ?? '')) {
    throw new Error('Placebo package or evaluation identity is invalid');
  }
  const inferenceUsd = results.reduce((total, result) => total +
    result.caseFile.cost.entries.reduce((subtotal, entry) => subtotal + entry.usd, 0), 0);
  const sandboxUsd = results.reduce((total, result) => total +
    result.caseFile.stages.reduce((subtotal, stage) => subtotal + (stage.metrics?.cost ?? 0), 0), 0);
  const redactions = input.redactions === undefined ? undefined : validateRedactionSummary(input.redactions);
  return {
    schemaVersion: 'sutura-placebo-live-case-v1',
    controllerSha,
    githubRunId: runId(input.githubRunId),
    subjectVersion: RELEASE_VERSION,
    subjectSha,
    packageContentHash: input.packageContentHash,
    packageIntegrity: input.packageIntegrity,
    corpusVersion: corpus.corpusVersion,
    corpusHash: corpus.corpusHash,
    caseId: expectedCase.id,
    caseContentHash: expectedCase.contentHash,
    kind: expectedCase.metadata.kind,
    results,
    evaluationManifestHash: input.evaluationManifestHash,
    inferenceUsd,
    sandboxUsd,
    totalUsd: inferenceUsd + sandboxUsd,
    evaluationCount: results.length,
    artifactName: artifactName(input.artifactName),
    ...(redactions === undefined ? {} : { redactions }),
  };
}

export function createPlaceboCaseArtifact(input, options = {}) {
  const expectedEvaluationCaseIds = (input.results ?? []).map((result) =>
    `${input.caseId}:${result.tavilyEnabled ? 'with-tavily' : 'without-tavily'}`).sort();
  const actualEvaluationCaseIds = Array.isArray(input.evaluationManifest?.cases)
    ? input.evaluationManifest.cases.map(({ caseId }) => caseId).sort() : [];
  if (input.evaluationManifest === null || typeof input.evaluationManifest !== 'object' ||
      Array.isArray(input.evaluationManifest) ||
      input.evaluationManifest.schemaVersion !== 'sutura-evaluation-v1' ||
      input.evaluationManifest.suturaCommit !== input.controllerSha ||
      input.evaluationManifest.corpusHash !== (options.corpus ?? loadCorpusSync()).corpusHash ||
      !Array.isArray(input.evaluationManifest.cases) ||
      input.evaluationManifest.cases.length !== input.results?.length ||
      JSON.stringify(actualEvaluationCaseIds) !== JSON.stringify(expectedEvaluationCaseIds)) {
    throw new Error('Placebo evaluation manifest identity is invalid');
  }
  const evaluationManifestHash = contentHash(input.evaluationManifest);
  const base = artifactBase({ ...input, evaluationManifestHash }, options);
  const artifact = { ...base, resultHash: contentHash(base) };
  if (Buffer.byteLength(canonicalJson(artifact)) > MAX_ARTIFACT_BYTES) {
    throw new Error(`Placebo case artifact exceeds ${MAX_ARTIFACT_BYTES} bytes`);
  }
  return artifact;
}

export function assertPublicArtifactSafe(value, secrets = []) {
  const serialized = canonicalJson(value);
  const forbidden = /(?:\/Users\/|[A-Z]:\\Users\\|Authorization:\s*(?:Bearer|Basic)|github_pat_|ghp_|sk-[A-Za-z0-9]{20,})/u;
  if (forbidden.test(serialized) || secrets.some((secret) =>
    typeof secret === 'string' && secret.length > 0 && serialized.includes(secret))) {
    throw new Error('Placebo public artifact contains a credential or private local path');
  }
  return value;
}

function validateRedactionSummary(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      !Number.isSafeInteger(value.credentialValues) || value.credentialValues < 0 ||
      !Number.isSafeInteger(value.privatePaths) || value.privatePaths < 0) {
    throw new Error('Placebo public artifact redaction summary is invalid');
  }
  return { credentialValues: value.credentialValues, privatePaths: value.privatePaths };
}

function replaceCount(value, pattern, replacement) {
  let count = 0;
  return {
    value: value.replace(pattern, () => {
      count += 1;
      return replacement;
    }),
    count,
  };
}

export function redactPublicArtifact(value, secrets = []) {
  const summary = { credentialValues: 0, privatePaths: 0 };
  const knownSecrets = [...new Set(secrets.filter((secret) =>
    typeof secret === 'string' && secret.length > 0))].sort((left, right) => right.length - left.length);

  function redactString(input) {
    let output = input;
    for (const secret of knownSecrets) {
      const pieces = output.split(secret);
      if (pieces.length > 1) {
        summary.credentialValues += pieces.length - 1;
        output = pieces.join(PUBLIC_REDACTION.credential);
      }
    }
    for (const [pattern, replacement, category] of [
      [/Authorization:\s*(?:Bearer|Basic)\s+[^\s"']+/giu, `Authorization: ${PUBLIC_REDACTION.credential}`, 'credentialValues'],
      [/(?:github_pat_|ghp_)[A-Za-z0-9_]+/gu, PUBLIC_REDACTION.credential, 'credentialValues'],
      [/sk-[A-Za-z0-9]{20,}/gu, PUBLIC_REDACTION.credential, 'credentialValues'],
      [/\/Users\/[^\\\s"'<>]+/gu, PUBLIC_REDACTION.privatePath, 'privatePaths'],
      [/[A-Z]:\\Users\\[^\s"'<>]+/giu, PUBLIC_REDACTION.privatePath, 'privatePaths'],
    ]) {
      const redacted = replaceCount(output, pattern, replacement);
      output = redacted.value;
      summary[category] += redacted.count;
    }
    return output;
  }

  function visit(input) {
    if (typeof input === 'string') return redactString(input);
    if (Array.isArray(input)) return input.map(visit);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).map(([key, child]) => [key, visit(child)]));
    }
    return input;
  }

  return { value: visit(value), summary };
}

export function validatePlaceboCaseArtifact(value, options = {}) {
  if (value?.schemaVersion !== 'sutura-placebo-live-case-v1') {
    throw new Error('Placebo case artifact schema is invalid');
  }
  const base = artifactBase(value, options);
  if (value.resultHash !== contentHash(base)) throw new Error('Placebo case artifact resultHash is invalid');
  const artifact = { ...base, resultHash: value.resultHash };
  if (Buffer.byteLength(canonicalJson(artifact)) > MAX_ARTIFACT_BYTES) {
    throw new Error(`Placebo case artifact exceeds ${MAX_ARTIFACT_BYTES} bytes`);
  }
  return assertPublicArtifactSafe(artifact);
}

export function createPlaceboLedger(entries) {
  return {
    schemaVersion: 'sutura-placebo-live-ledger-v1',
    entries,
    resultHash: contentHash(entries),
  };
}

export function validatePlaceboLedger(value) {
  // A ledger may hold one entry per case in the largest selection, not only
  // the frozen slice; an 80-case run cannot record its results otherwise.
  if (value?.schemaVersion !== 'sutura-placebo-live-ledger-v1' || !Array.isArray(value.entries) ||
      value.entries.length > EXPANDED_CASE_COUNT || value.resultHash !== contentHash(value.entries)) {
    throw new Error('Placebo live ledger schema or resultHash is invalid');
  }
  const caseIds = new Set();
  const runIds = new Set();
  const entries = value.entries.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry) ||
        (entry.falseApproval !== undefined && typeof entry.falseApproval !== 'boolean') ||
        typeof entry.caseId !== 'string' || caseIds.has(entry.caseId) ||
        runIds.has(entry.runId) || !SHA256_PATTERN.test(entry.artifactSha256 ?? '') ||
        !SHA256_PATTERN.test(entry.resultHash ?? '') || !Array.isArray(entry.outcomes) ||
        !entry.outcomes.every((outcome) => OUTCOMES.has(outcome)) ||
        !Number.isSafeInteger(entry.evaluationCount) || ![1, 2].includes(entry.evaluationCount) ||
        entry.outcomes.length !== entry.evaluationCount) {
      throw new Error(`Placebo live ledger entry ${index + 1} is invalid or duplicate`);
    }
    caseIds.add(entry.caseId);
    runIds.add(entry.runId);
    const normalizedRunId = runId(entry.runId);
    const url = new URL(publicGitHubUrl(entry.runUrl, 'Placebo workflow run'));
    if (url.pathname !== `/juan294/sutura/actions/runs/${normalizedRunId}` || url.search || url.hash) {
      throw new Error(`Placebo live ledger entry ${index + 1} run URL is invalid`);
    }
    const recorded = new Date(entry.recordedAt);
    if (Number.isNaN(recorded.valueOf()) || recorded.toISOString() !== entry.recordedAt) {
      throw new Error(`Placebo live ledger entry ${index + 1} timestamp is invalid`);
    }
    boundedUsd(entry.inferenceUsd, 'Placebo ledger inference cost');
    boundedUsd(entry.sandboxUsd, 'Placebo ledger sandbox cost');
    boundedUsd(entry.totalUsd, 'Placebo ledger total cost');
    if (Math.abs(entry.inferenceUsd + entry.sandboxUsd - entry.totalUsd) > 1e-9) {
      throw new Error(`Placebo live ledger entry ${index + 1} cost is inconsistent`);
    }
    return {
      caseId: entry.caseId,
      ...(entry.falseApproval === undefined ? {} : { falseApproval: entry.falseApproval }),
      runId: normalizedRunId,
      runUrl: url.toString(),
      artifactName: artifactName(entry.artifactName),
      artifactSha256: entry.artifactSha256,
      controllerSha: exactSha(entry.controllerSha, 'Placebo ledger controller'),
      subjectSha: exactSha(entry.subjectSha, 'Placebo ledger subject'),
      packageContentHash: exactSha256(entry.packageContentHash, 'Placebo package content hash'),
      packageIntegrity: exactSha256(entry.packageIntegrity, 'Placebo package integrity'),
      resultHash: entry.resultHash,
      outcomes: [...entry.outcomes],
      evaluationCount: entry.evaluationCount,
      inferenceUsd: entry.inferenceUsd,
      sandboxUsd: entry.sandboxUsd,
      totalUsd: entry.totalUsd,
      recordedAt: entry.recordedAt,
    };
  });
  return createPlaceboLedger(entries);
}

export function appendPlaceboLedger(ledgerInput, artifactInput, metadata, options = {}) {
  const ledger = validatePlaceboLedger(ledgerInput);
  const artifact = validatePlaceboCaseArtifact(artifactInput, options);
  if (ledger.entries.some(({ caseId, runId }) =>
    caseId === artifact.caseId || runId === artifact.githubRunId)) {
    throw new Error('Placebo ledger cannot append a duplicate case or workflow run');
  }
  const bytes = metadata.artifactBytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error('Placebo downloaded artifact is invalid or too large');
  }
  const entry = {
    caseId: artifact.caseId,
    falseApproval: hasFalseApproval(artifact),
    runId: artifact.githubRunId,
    runUrl: metadata.runUrl,
    artifactName: artifact.artifactName,
    artifactSha256: createHash('sha256').update(bytes).digest('hex'),
    controllerSha: artifact.controllerSha,
    subjectSha: artifact.subjectSha,
    packageContentHash: artifact.packageContentHash,
    packageIntegrity: artifact.packageIntegrity,
    resultHash: artifact.resultHash,
    outcomes: artifact.results.map(({ caseFile }) => caseFile.outcome),
    evaluationCount: artifact.evaluationCount,
    inferenceUsd: artifact.inferenceUsd,
    sandboxUsd: artifact.sandboxUsd,
    totalUsd: artifact.totalUsd,
    recordedAt: metadata.recordedAt,
  };
  return validatePlaceboLedger(createPlaceboLedger([...ledger.entries, entry]));
}

export function placeboSpendDecision({ spentUsd, observedMaximumUsd, initialReserveUsd, capUsd }) {
  for (const [value, label] of [
    [spentUsd, 'Placebo spent'], [observedMaximumUsd, 'Placebo observed maximum'],
    [initialReserveUsd, 'Placebo initial reserve'], [capUsd, 'Placebo cap'],
  ]) boundedUsd(value, label);
  const reserveUsd = Math.max(initialReserveUsd, observedMaximumUsd);
  const mayDispatch = Math.round((spentUsd + reserveUsd) * 1_000_000) <=
    Math.round(capUsd * 1_000_000);
  return { reserveUsd, mayDispatch };
}

export function orderedPlaceboCaseIds(corpusInput = loadCorpusSync()) {
  const corpus = validateCorpus(corpusInput);
  return [...corpus.cases].sort((left, right) =>
    (KIND_ORDER.get(left.metadata.kind) ?? 99) - (KIND_ORDER.get(right.metadata.kind) ?? 99) ||
    left.id.localeCompare(right.id)).map(({ id }) => id);
}

function hasFalseApproval(artifact) {
  return artifact.kind === 'trap' && artifact.results.some(({ caseFile }) =>
    caseFile.audit?.approved === true);
}

function hasInfraStop(artifact) {
  return artifact.results.some(({ caseFile }) => caseFile.outcome === 'infra-stop');
}

export async function runPlaceboStreak(options, dependencies) {
  if (options.authorize !== true) throw new Error('Placebo live streak requires literal --authorize');
  exactSha(options.controllerSha, 'Placebo controller');
  exactSha(options.subjectSha, 'Placebo subject');
  const { capUsd, initialReserveUsd } = validateLiveSpendBounds(
    options.capUsd, options.initialReserveUsd, 'Placebo',
  );
  let ledger = validatePlaceboLedger(await dependencies.readLedger());
  if (ledger.entries.some((entry) => entry.controllerSha !== options.controllerSha ||
      entry.subjectSha !== options.subjectSha)) {
    throw new Error('Placebo ledger identity differs from requested identity');
  }
  const caseIds = options.caseIds ?? orderedPlaceboCaseIds();
  let spentUsd = ledger.entries.reduce((sum, entry) => sum + entry.totalUsd, 0);
  let observedMaximumUsd = ledger.entries.reduce((maximum, entry) => Math.max(maximum, entry.totalUsd), 0);
  let stoppedFor = ledger.entries.some((entry) => entry.outcomes.includes('infra-stop'))
    ? 'infra-stop' : ledger.entries.some(entry => entry.falseApproval === true || corpusCase(loadCorpusSync(needsExpandedSelection(entry.caseId)), entry.caseId).metadata.kind === 'trap' && entry.outcomes.includes('fixed'))
      ? 'false-approval' : 'complete';
  for (const caseId of caseIds) {
    if (stoppedFor !== 'complete') break;
    if (ledger.entries.some((entry) => entry.caseId === caseId)) continue;
    const decision = placeboSpendDecision({ spentUsd, observedMaximumUsd, initialReserveUsd, capUsd });
    if (!decision.mayDispatch) { stoppedFor = 'cap-reserve'; break; }
    const completed = await dependencies.runCase(caseId);
    ledger = validatePlaceboLedger(completed.ledger);
    const artifact = validatePlaceboCaseArtifact(completed.artifact, dependencies);
    spentUsd += artifact.totalUsd;
    observedMaximumUsd = Math.max(observedMaximumUsd, artifact.totalUsd);
    if (hasFalseApproval(artifact)) { stoppedFor = 'false-approval'; break; }
    if (hasInfraStop(artifact)) { stoppedFor = 'infra-stop'; break; }
  }
  return {
    ledger, spentUsd, reserveUsd: Math.max(initialReserveUsd, observedMaximumUsd), stoppedFor,
  };
}

export async function runSinglePlaceboCase(options, dependencies) {
  const { capUsd, initialReserveUsd } = validateLiveSpendBounds(
    options.capUsd, options.initialReserveUsd, 'Placebo',
  );
  await dependencies.gate(options.controllerSha, options.subjectSha);
  const ledger = validatePlaceboLedger(await dependencies.readLedger());
  if (ledger.entries.some((entry) => entry.controllerSha !== options.controllerSha ||
      entry.subjectSha !== options.subjectSha)) {
    throw new Error('Placebo ledger identity differs from requested identity');
  }
  if (ledger.entries.some(({ caseId }) => caseId === options.caseId)) {
    throw new Error(`Placebo single run refuses duplicate case: ${options.caseId}`);
  }
  if (ledger.entries.some((entry) => entry.outcomes.includes('infra-stop'))) {
    // The guard exists so a degraded environment cannot quietly produce more
    // results. A single recorded transient provider error is a different
    // thing, and continuing past it needs a deliberate operator decision
    // rather than a silent default. The infra-stop entry itself is never
    // removed: it is the honest result for that case.
    if (process.env.SUTURA_ALLOW_INFRA_STOP_LEDGER !== '1') {
      throw new Error('Placebo single run refuses to continue an infrastructure-stop ledger');
    }
  }
  // Ledger entries may name a versioned case, so each is resolved through the
  // selection that actually holds it.
  if (ledger.entries.some((entry) =>
    entry.falseApproval === true || corpusCase(loadCorpusSync(needsExpandedSelection(entry.caseId)), entry.caseId)
      .metadata.kind === 'trap' && entry.outcomes.includes('fixed'))) {
    throw new Error('Placebo single run refuses to continue a false-approval ledger');
  }
  const spentUsd = ledger.entries.reduce((sum, entry) => sum + entry.totalUsd, 0);
  const observedMaximumUsd = ledger.entries.reduce(
    (maximum, entry) => Math.max(maximum, entry.totalUsd),
    0,
  );
  const decision = placeboSpendDecision({
    spentUsd, observedMaximumUsd, initialReserveUsd, capUsd,
  });
  if (!decision.mayDispatch) throw new Error('Placebo single run stopped for cap-reserve');
  const completed = await dependencies.runCase(options.caseId);
  if (completed?.artifact && hasFalseApproval(completed.artifact)) return { ...completed, stoppedFor: 'false-approval' };
  return completed;
}

export async function finalizePlaceboEvidence(ledgerInput, artifactInputs, options = {}) {
  const corpus = validateCorpus(options.corpus ?? loadCorpusSync());
  const ledger = validatePlaceboLedger(ledgerInput);
  const artifacts = artifactInputs.map((value) => validatePlaceboCaseArtifact(value, { corpus }));
  const expectedIds = orderedPlaceboCaseIds(corpus);
  if (ledger.entries.length !== 51 || artifacts.length !== 51 ||
      new Set(ledger.entries.map(({ caseId }) => caseId)).size !== 51 ||
      expectedIds.some((id) => !ledger.entries.some((entry) => entry.caseId === id)) ||
      expectedIds.some((id) => !artifacts.some((artifact) => artifact.caseId === id))) {
    throw new Error('Placebo finalization requires all 51 canonical cases');
  }
  if (new Set(ledger.entries.map(({ controllerSha }) => controllerSha)).size !== 1 ||
      new Set(ledger.entries.map(({ subjectSha }) => subjectSha)).size !== 1 ||
      new Set(ledger.entries.map(({ packageContentHash }) => packageContentHash)).size !== 1 ||
      new Set(ledger.entries.map(({ packageIntegrity }) => packageIntegrity)).size !== 1) {
    throw new Error('Placebo finalization requires one exact controller and subject identity');
  }
  for (const entry of ledger.entries) {
    const artifact = artifacts.find(({ caseId }) => caseId === entry.caseId);
    if (!artifact || artifact.resultHash !== entry.resultHash ||
        artifact.githubRunId !== entry.runId || artifact.controllerSha !== entry.controllerSha ||
        artifact.subjectSha !== entry.subjectSha) {
      throw new Error(`Placebo finalization identity mismatch for ${entry.caseId}`);
    }
  }
  const results = expectedIds.flatMap((id) =>
    artifacts.find((artifact) => artifact.caseId === id).results);
  if (results.length !== 55) throw new Error('Placebo finalization requires 55 evaluations');
  const scoreResults = options.scoreResults ?? await import('../packages/placebo/dist/score.js')
    .then(({ score }) => score);
  const base = {
    schemaVersion: 'sutura-placebo-live-result-v1',
    controllerSha: ledger.entries[0].controllerSha,
    subjectSha: ledger.entries[0].subjectSha,
    subjectVersion: RELEASE_VERSION,
    corpusHash: corpus.corpusHash,
    caseCount: 51,
    evaluationCount: 55,
    inferenceUsd: ledger.entries.reduce((sum, entry) => sum + entry.inferenceUsd, 0),
    sandboxUsd: ledger.entries.reduce((sum, entry) => sum + entry.sandboxUsd, 0),
    totalUsd: ledger.entries.reduce((sum, entry) => sum + entry.totalUsd, 0),
    results,
    score: scoreResults(results),
    ledgerHash: ledger.resultHash,
  };
  return { ...base, resultHash: contentHash(base) };
}

async function command(commandName, args, options = {}) {
  const result = await execFileAsync(commandName, args, {
    cwd: options.cwd ?? ROOT,
    encoding: options.binary ? null : 'utf8',
    maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
    timeout: options.timeout ?? 120_000,
  });
  return options.binary ? result.stdout : result.stdout.trim();
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function withLock(operation) {
  await mkdir(dirname(LOCK_PATH), { recursive: true, mode: 0o700 });
  const release = await acquireProcessLock(LOCK_PATH);
  try { return await operation(); } finally { await release(); }
}

async function readLedgerDefault(path = LEDGER_PATH) {
  if (!await exists(path)) return createPlaceboLedger([]);
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error('Placebo ledger is too large');
  return validatePlaceboLedger(JSON.parse(bytes.toString('utf8')));
}

async function ghApi(endpoint, binary = false) {
  return command('gh', ['api', '-X', 'GET', endpoint], { binary, maxBuffer: MAX_ARTIFACT_BYTES });
}

export async function gatePlaceboLive(controllerSha, subjectSha) {
  const controller = exactSha(controllerSha, 'Placebo controller');
  const subject = exactSha(subjectSha, 'Placebo subject');
  if (subject !== controller) throw new Error('Placebo candidate controller and subject must be the same exact commit');
  const { gateDogfood } = await import('./dogfood.mjs');
  await gateDogfood(controller);
  const corpus = validateCorpus(JSON.parse(await readFile(CORPUS_PATH, 'utf8')));
  return {
    controllerSha: controller,
    subjectSha: subject,
    corpusHash: corpus.corpusHash,
  };
}

function transientTransportError(error) {
  const detail = `${error?.code ?? ''} ${error?.cause?.code ?? ''} ${error?.message ?? ''} ${error?.stderr ?? ''}`;
  return /unexpected EOF|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|EPIPE|connection reset by peer|socket hang up|TLS handshake timeout|i\/o timeout|HTTP 50[234]\b/iu.test(detail) ||
    (error?.killed === true && error?.signal === 'SIGTERM');
}

/** Retry observations only; dispatch remains a single, durably reserved operation. */
export async function retryRead(operation, dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  const deadline = dependencies.deadline ?? now() + 5 * 60_000;
  let delay = 1_000;
  for (;;) {
    try { return await operation(Math.max(1, Math.min(120_000, deadline - now()))); }
    catch (error) {
      if (!transientTransportError(error)) throw error;
      if (now() >= deadline) throw new Error('Read recovery deadline exceeded; existing job remains reserved', { cause: error });
      await sleep(Math.min(delay, deadline - now()));
      delay = Math.min(delay * 2, 30_000);
    }
  }
}

export async function pollRun(controllerId, caseId, controllerSha, dependencies = {}) {
  const runCommand = dependencies.command ?? command;
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  const deadline = now() + (dependencies.timeoutMs ?? 35 * 60_000);
  const expectedTitle = `Placebo live ${controllerId} ${caseId}`;
  let savedRunId = dependencies.runId;
  let identityConfirmed = false;
  let titleDeadline;
  if (savedRunId !== undefined && !/^[1-9]\d{0,19}$/u.test(String(savedRunId))) throw new Error('Invalid saved workflow run ID');
  do {
    const output = await retryRead((timeout) => runCommand('gh', savedRunId
      ? ['run', 'view', String(savedRunId), '--json', 'databaseId,displayTitle,status,conclusion,url,headSha']
      : ['run', 'list', '--workflow', 'placebo-live-case.yml', '--limit', '100',
        '--json', 'databaseId,displayTitle,status,conclusion,url,headSha'], { timeout }),
    { now, sleep, deadline: Math.min(deadline, titleDeadline ?? deadline) });
    const parsed = JSON.parse(output);
    const matches = savedRunId ? [parsed] : parsed.filter((run) => run?.displayTitle === expectedTitle);
    if (matches.length > 1) throw new Error(`Multiple Placebo runs match ${controllerId}`);
    const current = matches[0];
    if (current) {
      if (current.headSha !== controllerSha) throw new Error('Placebo run controller SHA differs from dispatch');
      if (savedRunId && String(current.databaseId) !== String(savedRunId)) {
        throw new Error(`Placebo run identity differs from saved dispatch: expected ${savedRunId}, observed ${JSON.stringify(current.databaseId)}`);
      }
      if (current.displayTitle !== expectedTitle) {
        const pendingStatuses = ['queued', 'in_progress', 'requested', 'waiting', 'pending'];
        const observation = {
          runId: String(current.databaseId),
          status: [...pendingStatuses, 'completed'].includes(current.status) ? current.status : 'unknown',
          titleState: typeof current.displayTitle !== 'string' ? 'missing' : current.displayTitle.length === 0 ? 'empty' : 'different',
          observedTitleSha256: createHash('sha256').update(JSON.stringify(current.displayTitle) ?? 'undefined').digest('hex'),
        };
        // Allow for a dispatch ID arriving before its run-name is ready. Observe only;
        // acceptance still requires the exact title, ID, SHA and artifact.
        titleDeadline ??= Math.min(deadline, now() + 60_000);
        if (identityConfirmed || !pendingStatuses.includes(current.status) || now() >= titleDeadline) {
          throw new Error(`Placebo run title differs from saved dispatch: ${JSON.stringify(observation)}`);
        }
        (dependencies.onIdentityPending ?? ((value) => console.error(`Placebo run title pending: ${JSON.stringify(value)}`)))(observation);
        await sleep(Math.min(10_000, titleDeadline - now()));
        continue;
      }
      identityConfirmed = true;
      titleDeadline = undefined;
      if (!savedRunId) {
        savedRunId = String(current.databaseId);
        if (!/^[1-9]\d{0,19}$/u.test(savedRunId)) throw new Error('Invalid discovered workflow run ID');
        await dependencies.checkpointRun?.(savedRunId);
      }
      if (current.status === 'completed') {
        if (current.conclusion !== 'success') throw new Error(`Placebo run ${current.databaseId} failed`);
        return current;
      }
    }
    if (now() >= deadline) break;
    await sleep(Math.min(10_000, deadline - now()));
  } while (now() <= deadline);
  throw new Error(`Timed out waiting for Placebo case ${caseId}; existing job remains reserved`);
}

async function findArtifactJson(directory) {
  const files = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) await visit(next);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(next);
    }
  }
  await visit(directory);
  if (files.length !== 1) throw new Error(`Placebo download must contain one JSON file, found ${files.length}`);
  return files[0];
}

export async function dispatchPlaceboWorkflow(input, dependencies = {}) {
  const assertFreeze = dependencies.requireActivePushFreeze ?? requireActivePushFreeze;
  const runCommand = dependencies.command ?? command;
  await assertFreeze();
  return runCommand('gh', [
    'workflow', 'run', 'placebo-live-case.yml', '--ref', 'develop',
    '-f', `controller-sha=${input.controllerSha}`, '-f', `subject-sha=${input.subjectSha}`,
    '-f', `case-id=${input.caseId}`, '-f', `controller-id=${input.controllerId}`,
    '-f', `counterfactual=${input.counterfactual === true ? 'true' : 'false'}`,
  ]);
}

export async function recordRemoteArtifact({ artifact, bytes, run, stateDirectory = dirname(LEDGER_PATH) }, dependencies = {}) {
  const ledgerPath = join(stateDirectory, basename(LEDGER_PATH));
  const artifactPath = join(stateDirectory, basename(ARTIFACT_ROOT), `${artifact.caseId}.json`);
  const ledger = await readLedgerDefault(ledgerPath);
  const existing = ledger.entries.find(entry => entry.caseId === artifact.caseId || entry.runId === artifact.githubRunId);
  if (existing && (existing.caseId !== artifact.caseId || existing.runId !== artifact.githubRunId ||
      existing.artifactSha256 !== createHash('sha256').update(bytes).digest('hex') || existing.resultHash !== artifact.resultHash)) {
    throw new Error('Recovered artifact conflicts with saved case ledger');
  }
  const next = existing ? (hasFalseApproval(artifact) && existing.falseApproval !== true
    ? createPlaceboLedger(ledger.entries.map(entry => entry === existing ? { ...entry, falseApproval: true } : entry)) : ledger)
    : appendPlaceboLedger(ledger, artifact, {
    artifactBytes: bytes, runUrl: run.url, recordedAt: new Date().toISOString(),
  }, { corpus: loadCorpusSync(needsExpandedSelection(artifact.caseId)) });
  // Save the exact validated bytes before the ledger. Restart may repeat this safely.
  await atomicWrite(artifactPath, bytes);
  await dependencies.afterArtifactWrite?.();
  await atomicWrite(ledgerPath, `${canonicalJson(next)}\n`);
  return next;
}

export async function runRemoteCase({ controllerSha, subjectSha, caseId, skipGate = false, counterfactual = false,
  controllerId = `pl-${Date.now()}-${randomUUID().slice(0, 8)}`, resumed = false, runId: savedRunId, checkpointRun }, dependencies = {}) {
  if (!skipGate) await gatePlaceboLive(controllerSha, subjectSha);
  const runCommand = dependencies.command ?? command;
  const corpus = loadCorpusSync(needsExpandedSelection(caseId));
  corpusCase(corpus, caseId);
  if (!resumed) {
    try {
      const response = await dispatchPlaceboWorkflow({ controllerSha, subjectSha, caseId, controllerId, counterfactual }, {
        command: runCommand, requireActivePushFreeze: dependencies.requireActivePushFreeze,
      });
      const match = response?.match(/https:\/\/github\.com\/juan294\/sutura\/actions\/runs\/([1-9]\d*)/u);
      if (match) { savedRunId = match[1]; await checkpointRun?.(savedRunId); }
    } catch (error) {
      if (!transientTransportError(error)) throw error;
      // The request may have succeeded. Observe its unique title, never send it twice.
    }
  }
  const run = await (dependencies.pollRun ?? pollRun)(controllerId, caseId, controllerSha, {
    command: runCommand, runId: savedRunId, checkpointRun,
  });
  const expectedArtifactName = `sutura-placebo-${controllerId}-${caseId}`;
  const directory = await mkdtemp(join(tmpdir(), 'sutura-placebo-live-'));
  try {
    await retryRead(async (timeout) => {
      // A failed download may leave partial files; retry into an empty directory.
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory, { mode: 0o700 });
      await runCommand('gh', [
        'run', 'download', String(run.databaseId), '--name', expectedArtifactName, '--dir', directory,
      ], { timeout });
    }, { sleep: dependencies.sleep, now: dependencies.now });
    const path = await findArtifactJson(directory);
    const bytes = await readFile(path);
    const artifact = validatePlaceboCaseArtifact(JSON.parse(bytes.toString('utf8')), { corpus });
    assertPublicArtifactSafe(artifact, [process.env.NEBIUS_API_KEY, process.env.TAVILY_API_KEY, process.env.CONTREE_TOKEN]);
    if (artifact.controllerSha !== controllerSha || artifact.subjectSha !== subjectSha ||
        artifact.githubRunId !== String(run.databaseId) || artifact.caseId !== caseId ||
        artifact.artifactName !== expectedArtifactName) {
      throw new Error('Placebo downloaded artifact identity differs from dispatch');
    }
    const ledger = await recordRemoteArtifact({ artifact, bytes, run, stateDirectory: dependencies.stateDirectory });
    return { artifact, ledger };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

async function artifactCommand(args) {
  const report = JSON.parse(await readFile(valueAfter(args, '--report'), 'utf8'));
  const evaluationManifest = JSON.parse(await readFile(valueAfter(args, '--manifest'), 'utf8'));
  const installEvidence = JSON.parse(await readFile(valueAfter(args, '--install-evidence'), 'utf8'));
  const controllerId = valueAfter(args, '--controller-id');
  const caseId = valueAfter(args, '--case');
  const subjectSha = valueAfter(args, '--subject-sha');
  if (installEvidence?.schemaVersion !== 'sutura-install-evidence-v1' ||
      installEvidence.mode !== 'candidate' || installEvidence.packageVersion !== RELEASE_VERSION ||
      installEvidence.actionCommit !== subjectSha || installEvidence.outcome !== 'passed' ||
      !SHA256_PATTERN.test(installEvidence.packageContentHash ?? '') ||
      !SHA256_PATTERN.test(installEvidence.packageIntegrity ?? '')) {
    throw new Error('Placebo candidate install evidence is invalid');
  }
  const secrets = [process.env.NEBIUS_API_KEY, process.env.TAVILY_API_KEY, process.env.CONTREE_TOKEN];
  const sanitized = redactPublicArtifact({ results: report.results, evaluationManifest }, secrets);
  const artifact = createPlaceboCaseArtifact({
    controllerSha: valueAfter(args, '--controller-sha'),
    githubRunId: valueAfter(args, '--run-id'),
    subjectVersion: RELEASE_VERSION,
    subjectSha,
    packageContentHash: installEvidence.packageContentHash,
    packageIntegrity: installEvidence.packageIntegrity,
    caseId,
    results: sanitized.value.results,
    evaluationManifest: sanitized.value.evaluationManifest,
    artifactName: `sutura-placebo-${controllerId}-${caseId}`,
    redactions: sanitized.summary,
  });
  assertPublicArtifactSafe(artifact, secrets);
  await writeFile(valueAfter(args, '--output'), `${canonicalJson(artifact)}\n`, { encoding: 'utf8', flag: 'wx' });
  return artifact;
}

export async function recoverPendingPlaceboCase(options, dependencies = {}) {
  const pending = await (dependencies.readPending ?? readManifestPending)(options);
  if (!pending) return null;
  return (dependencies.withSpend ?? withManifestSpend)({ ...options, caseId: pending.caseId, recoverPending: true },
    (saved) => (dependencies.runCase ?? runRemoteCase)({
      ...saved, controllerSha: options.controllerSha, subjectSha: options.subjectSha, skipGate: true,
    }));
}

export async function main(args = process.argv.slice(2)) {
  const commandName = args[0];
  if (['run', 'streak'].includes(commandName) && !args.includes('--authorize')) throw new Error('Placebo live run requires literal --authorize');
  if (commandName === 'artifact') return artifactCommand(args);
  let spendOptions;
  if (['init-spend', 'run', 'streak'].includes(commandName)) {
    const bounds = validateLiveSpendBounds(Number(valueAfter(args, '--cap-usd')),
      Number(valueAfter(args, '--initial-reserve-usd')), 'Placebo');
    const commonDirectory = await command('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    spendOptions = {
      directory: join(commonDirectory, 'sutura-manifest-spend'),
      manifest: JSON.parse(await readFile(valueAfter(args, '--run-manifest'), 'utf8')),
      ...bounds,
    };
    if (commandName === 'init-spend') return initializeManifestSpend(spendOptions);
  }
  const controllerSha = valueAfter(args, '--controller-sha');
  const subjectSha = valueAfter(args, '--subject-sha');
  if (commandName === 'gate') return gatePlaceboLive(controllerSha, subjectSha);
  if (commandName === 'run') {
    if (!args.includes('--authorize')) throw new Error('Placebo live run requires literal --authorize');
    const caseId = valueAfter(args, '--case');
    const capUsd = Number(valueAfter(args, '--cap-usd'));
    const initialReserveUsd = Number(valueAfter(args, '--initial-reserve-usd'));
    const counterfactual = args.includes('--counterfactual');
    return withLock(async () => {
      const recovered = await recoverPendingPlaceboCase({ ...spendOptions, controllerSha, subjectSha });
      if (recovered && hasFalseApproval(recovered.artifact)) return { ...recovered, stoppedFor: 'false-approval' };
      if (recovered?.artifact.caseId === caseId) return recovered;
      await gatePlaceboLive(controllerSha, subjectSha);
      return runSinglePlaceboCase({ controllerSha, subjectSha, caseId, capUsd, initialReserveUsd }, {
        gate: async () => {},
        readLedger: readLedgerDefault,
        runCase: () => withManifestSpend({ ...spendOptions, controllerSha, subjectSha, caseId },
          (pending) => runRemoteCase({ ...pending, controllerSha, subjectSha, caseId, skipGate: true, counterfactual })),
      });
    });
  }
  if (commandName === 'streak') {
    return withLock(async () => {
      const recovered = await recoverPendingPlaceboCase({ ...spendOptions, controllerSha, subjectSha });
      if (recovered && hasFalseApproval(recovered.artifact)) return { ...recovered, stoppedFor: 'false-approval' };
      const ledger = await readLedgerDefault();
      if (spendOptions.manifest.subjects.some(id => !ledger.entries.some(entry => entry.caseId === id))) {
        await gatePlaceboLive(controllerSha, subjectSha);
      }
      return runPlaceboStreak({
        controllerSha, subjectSha, authorize: args.includes('--authorize'),
        capUsd: Number(valueAfter(args, '--cap-usd')),
        initialReserveUsd: Number(valueAfter(args, '--initial-reserve-usd')),
        caseIds: spendOptions.manifest.subjects,
      }, {
        readLedger: readLedgerDefault,
        runCase: (caseId) => withManifestSpend({ ...spendOptions, controllerSha, subjectSha, caseId },
          (pending) => runRemoteCase({ ...pending, controllerSha, subjectSha, caseId, skipGate: true })),
      });
    });
  }
  if (commandName === 'finalize') {
    const outputDirectory = valueAfter(args, '--output-dir');
    await mkdir(outputDirectory, { recursive: false });
    const artifactFiles = (await readdir(ARTIFACT_ROOT)).filter((name) => name.endsWith('.json')).sort();
    const artifacts = await Promise.all(artifactFiles.map(async (name) =>
      JSON.parse(await readFile(join(ARTIFACT_ROOT, name), 'utf8'))));
    const finalized = await finalizePlaceboEvidence(await readLedgerDefault(), artifacts);
    await writeFile(join(outputDirectory, 'placebo-v0.2.1-live.json'), `${canonicalJson(finalized)}\n`, {
      encoding: 'utf8', flag: 'wx',
    });
    return finalized;
  }
  throw new Error('Usage: placebo-live.mjs init-spend|gate|run|streak|finalize with exact controller and subject SHAs');
}

export async function cli(args = process.argv.slice(2)) {
  const name = args[0];
  if (!['run', 'streak', 'alert-test', 'alert-status', 'alert-retry', 'alert-ack'].includes(name)) return main(args);
  const commonDirectory = await command('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const stateDir = join(commonDirectory, 'sutura-evaluation-alerts');
  const notifierConfig = join(commonDirectory, 'sutura-evaluation-notifier.json');
  const savedNotifier = await exists(notifierConfig) ? JSON.parse(await readFile(notifierConfig, 'utf8')) : null;
  const notifyCommand = process.env.SUTURA_EVALUATION_NOTIFY_COMMAND ?? savedNotifier?.command;
  const deliver = notifyCommand ? createCommandDelivery(notifyCommand) : undefined;
  if (['alert-status', 'alert-retry', 'alert-ack'].includes(name)) {
    const options = { stateDir, eventId: valueAfter(args, '--event-id'), deliver };
    const record = await (name === 'alert-status' ? readAlert : name === 'alert-retry' ? deliverAlert : acknowledgeAlert)(options);
    console.log(JSON.stringify(record)); return record;
  }
  if (name === 'alert-test') {
    try {
      await runWithTerminalAlert({ stateDir, manifestId: 'local-notification-test', totalCases: 1, deliver,
        readProgress: async () => ({ completedCases: 0, pendingCaseId: null, recordedUsd: 0 }),
        run: async () => { throw new Error('Deliberate local notification test failure'); },
      });
    } finally { console.error(`Notification test outbox: ${stateDir}`); }
    return;
  }
  const manifest = JSON.parse(await readFile(valueAfter(args, '--run-manifest'), 'utf8'));
  const { result, alert } = await runWithTerminalAlert({ stateDir, manifestId: manifest.manifestId,
    totalCases: manifest.subjects.length, deliver,
    readProgress: async () => {
      const account = JSON.parse(await readFile(join(commonDirectory, 'sutura-manifest-spend', `${manifest.manifestId}.json`), 'utf8'));
      return { completedCases: account.entries.length, pendingCaseId: account.pending?.caseId ?? null,
        recordedUsd: account.entries.reduce((sum,entry) => sum + entry.microUsd, 0) / 1_000_000 };
    },
    run: () => main(args),
  });
  console.log(JSON.stringify({ stoppedFor: result?.stoppedFor ?? 'complete', alertId: alert.event.eventId, delivery: alert.delivery.status }));
  if (result?.stoppedFor && result.stoppedFor !== 'complete') process.exitCode = 2;
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await cli();
