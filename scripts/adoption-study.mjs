import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertPublicEvidenceText,
  canonicalJson,
  contentHash,
  exactSha,
  nonnegativeInteger,
  publicGitHubUrl,
  workflowActionReferences,
} from './evidence-contract.mjs';
import { exactReleaseVersion, resolvePublicActionCommit } from './install-test-lib.mjs';

const PARTICIPANT_SCHEMA = 'sutura-adoption-participant-v1';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUDY_SCHEMA = 'sutura-external-adoption-evidence-v1';
const PARTICIPANT_ID = /^participant-[a-f0-9]{8}$/u;
const REPOSITORY_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/u;
const RUN_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/[1-9]\d*\/?$/u;
const CHECK_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/runs\/[1-9]\d*\/?$/u;
const LANGUAGES = new Set(['javascript', 'typescript', 'python']);
const CLASSIFICATIONS = new Set(['repair', 'refusal', 'flake']);
const DEFECT_CATEGORIES = new Set(['installation', 'documentation', 'permission', 'result-clarity']);
const MAX_RECORD_BYTES = 128 * 1024;

const RECORD_KEYS = [
  'schemaVersion', 'participantId', 'participantBuiltSutura', 'participationConsent',
  'repository', 'artifact', 'measurements', 'result', 'releaseBlockingDefects',
  'publicReviewConfirmed', 'feedbackPermission', 'feedbackQuote', 'feedbackDisplayName',
];
const REPOSITORY_KEYS = ['url', 'familiarToParticipant', 'familiarToSuturaBuilders', 'language'];
const ARTIFACT_KEYS = ['packageVersion', 'actionCommit', 'installSource'];
const MEASUREMENT_KEYS = [
  'sessionStartedAt', 'timeToFirstValidResultMs', 'setupFailures',
  'unclearInstructions', 'manualInterventions',
];
const RESULT_KEYS = ['classification', 'targetRunUrl', 'suturaRunUrl', 'checkRunUrl', 'valid'];
const DEFECT_KEYS = ['category', 'description', 'blocking', 'resolved', 'resolution'];

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  object(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} keys must be exactly: ${keys.join(', ')}`);
  }
}

function nonEmptyString(value, label, maximum = 500) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > maximum) {
    throw new Error(`${label} must be a non-empty trimmed string of at most ${maximum} characters`);
  }
  return assertPublicEvidenceText(value, label);
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.length > 100) throw new Error(`${label} must be an array of at most 100 strings`);
  return value.map((item, index) => nonEmptyString(item, `${label}[${index}]`));
}

function boolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
  return value;
}

function isoInstant(value, label) {
  nonEmptyString(value, label);
  const parsed = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
      Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be an ISO-8601 UTC instant with milliseconds`);
  }
  return value;
}

function validateTemplateNull(value, label) {
  if (value !== null) throw new Error(`${label} must be null in the unfilled template`);
}

export function validateParticipantTemplate(input) {
  exactKeys(input, RECORD_KEYS, 'Participant template');
  if (input.schemaVersion !== PARTICIPANT_SCHEMA) throw new Error('Participant template schemaVersion is invalid');
  validateTemplateNull(input.participantId, 'participantId');
  if (input.participantBuiltSutura !== false || input.participationConsent !== false) {
    throw new Error('Participant template eligibility and consent must default to false');
  }
  exactKeys(input.repository, REPOSITORY_KEYS, 'repository');
  validateTemplateNull(input.repository.url, 'repository.url');
  validateTemplateNull(input.repository.familiarToParticipant, 'repository.familiarToParticipant');
  if (input.repository.familiarToSuturaBuilders !== false) {
    throw new Error('repository.familiarToSuturaBuilders must default to false');
  }
  validateTemplateNull(input.repository.language, 'repository.language');
  exactKeys(input.artifact, ARTIFACT_KEYS, 'artifact');
  validateTemplateNull(input.artifact.packageVersion, 'artifact.packageVersion');
  validateTemplateNull(input.artifact.actionCommit, 'artifact.actionCommit');
  if (input.artifact.installSource !== 'public-npm-and-immutable-action') {
    throw new Error('artifact.installSource is invalid');
  }
  exactKeys(input.measurements, MEASUREMENT_KEYS, 'measurements');
  validateTemplateNull(input.measurements.sessionStartedAt, 'measurements.sessionStartedAt');
  validateTemplateNull(input.measurements.timeToFirstValidResultMs, 'measurements.timeToFirstValidResultMs');
  for (const key of ['setupFailures', 'unclearInstructions', 'manualInterventions']) {
    if (!Array.isArray(input.measurements[key]) || input.measurements[key].length !== 0) {
      throw new Error(`measurements.${key} must start empty`);
    }
  }
  exactKeys(input.result, RESULT_KEYS, 'result');
  validateTemplateNull(input.result.classification, 'result.classification');
  validateTemplateNull(input.result.targetRunUrl, 'result.targetRunUrl');
  validateTemplateNull(input.result.suturaRunUrl, 'result.suturaRunUrl');
  validateTemplateNull(input.result.checkRunUrl, 'result.checkRunUrl');
  if (input.result.valid !== false || !Array.isArray(input.releaseBlockingDefects) ||
      input.releaseBlockingDefects.length !== 0 || input.publicReviewConfirmed !== false ||
      input.feedbackPermission !== false ||
      input.feedbackQuote !== null || input.feedbackDisplayName !== null) {
    throw new Error('Participant template result, defects, and feedback must use safe empty defaults');
  }
  return input;
}

export function validateParticipantRecord(input) {
  exactKeys(input, RECORD_KEYS, 'Participant record');
  if (Buffer.byteLength(canonicalJson(input)) > MAX_RECORD_BYTES) throw new Error('Participant record exceeds 131072 bytes');
  if (input.schemaVersion !== PARTICIPANT_SCHEMA) throw new Error('Participant record schemaVersion is invalid');
  if (!PARTICIPANT_ID.test(input.participantId ?? '')) throw new Error('participantId must be pseudonymous participant- plus eight lowercase hex characters');
  if (input.participantBuiltSutura !== false) throw new Error('Participant must not have built Sutura');
  if (input.participationConsent !== true) throw new Error('Participation consent must be recorded');
  if (input.publicReviewConfirmed !== true) throw new Error('Participant record must be reviewed for public evidence');

  exactKeys(input.repository, REPOSITORY_KEYS, 'repository');
  const repositoryUrl = publicGitHubUrl(input.repository.url, 'repository.url');
  if (!REPOSITORY_URL.test(repositoryUrl)) throw new Error('repository.url must identify one public GitHub repository');
  if (input.repository.familiarToParticipant !== true || input.repository.familiarToSuturaBuilders !== false) {
    throw new Error('Repository must be familiar to the participant and unfamiliar to Sutura builders');
  }
  if (!LANGUAGES.has(input.repository.language)) throw new Error('repository.language must be javascript, typescript, or python');

  exactKeys(input.artifact, ARTIFACT_KEYS, 'artifact');
  exactReleaseVersion(input.artifact.packageVersion);
  exactSha(input.artifact.actionCommit, 'artifact.actionCommit');
  if (input.artifact.installSource !== 'public-npm-and-immutable-action') {
    throw new Error('artifact.installSource must use public npm and an immutable Action');
  }

  exactKeys(input.measurements, MEASUREMENT_KEYS, 'measurements');
  isoInstant(input.measurements.sessionStartedAt, 'measurements.sessionStartedAt');
  nonnegativeInteger(input.measurements.timeToFirstValidResultMs, 'measurements.timeToFirstValidResultMs');
  stringArray(input.measurements.setupFailures, 'measurements.setupFailures');
  stringArray(input.measurements.unclearInstructions, 'measurements.unclearInstructions');
  stringArray(input.measurements.manualInterventions, 'measurements.manualInterventions');

  exactKeys(input.result, RESULT_KEYS, 'result');
  if (!CLASSIFICATIONS.has(input.result.classification)) throw new Error('result.classification must be repair, refusal, or flake');
  const targetRunUrl = publicGitHubUrl(input.result.targetRunUrl, 'result.targetRunUrl');
  const suturaRunUrl = publicGitHubUrl(input.result.suturaRunUrl, 'result.suturaRunUrl');
  const checkRunUrl = publicGitHubUrl(input.result.checkRunUrl, 'result.checkRunUrl');
  if (!RUN_URL.test(targetRunUrl) || !RUN_URL.test(suturaRunUrl)) {
    throw new Error('result run URLs must be exact public GitHub Actions run URLs');
  }
  if (!CHECK_URL.test(checkRunUrl)) throw new Error('result.checkRunUrl must be an exact public GitHub check-run URL');
  const repositoryPath = new URL(repositoryUrl).pathname.replace(/\/$/u, '').toLowerCase();
  const evidencePaths = [targetRunUrl, suturaRunUrl, checkRunUrl]
    .map((value) => new URL(value).pathname.toLowerCase());
  if (!evidencePaths.every((path) => path.startsWith(`${repositoryPath}/`)) || targetRunUrl === suturaRunUrl) {
    throw new Error('result evidence URLs must be distinct where required and belong to repository.url');
  }
  if (input.result.valid !== true) throw new Error('result.valid must be true');

  if (!Array.isArray(input.releaseBlockingDefects) || input.releaseBlockingDefects.length > 100) {
    throw new Error('releaseBlockingDefects must be an array of at most 100 defects');
  }
  for (const [index, defect] of input.releaseBlockingDefects.entries()) {
    exactKeys(defect, DEFECT_KEYS, `releaseBlockingDefects[${index}]`);
    if (!DEFECT_CATEGORIES.has(defect.category)) throw new Error(`releaseBlockingDefects[${index}].category is invalid`);
    nonEmptyString(defect.description, `releaseBlockingDefects[${index}].description`);
    boolean(defect.blocking, `releaseBlockingDefects[${index}].blocking`);
    boolean(defect.resolved, `releaseBlockingDefects[${index}].resolved`);
    if (defect.resolved) nonEmptyString(defect.resolution, `releaseBlockingDefects[${index}].resolution`);
    else if (defect.resolution !== null) throw new Error(`releaseBlockingDefects[${index}].resolution must be null until resolved`);
    if (defect.blocking && !defect.resolved) throw new Error('Participant record has an unresolved release-blocking defect');
  }

  boolean(input.feedbackPermission, 'feedbackPermission');
  if (input.feedbackPermission) {
    nonEmptyString(input.feedbackQuote, 'feedbackQuote', 1000);
    nonEmptyString(input.feedbackDisplayName, 'feedbackDisplayName', 100);
  } else if (input.feedbackQuote !== null || input.feedbackDisplayName !== null) {
    throw new Error('feedbackPermission must be true before feedbackQuote or feedbackDisplayName is stored');
  }
  return input;
}

async function readRecords(recordsDirectory) {
  const names = (await readdir(recordsDirectory)).filter((name) => name.endsWith('.json')).sort();
  if (names.length !== 3) throw new Error('Adoption study requires exactly three participant JSON records');
  return Promise.all(names.map(async (name) => {
    const bytes = await readFile(resolve(recordsDirectory, name));
    if (bytes.byteLength > MAX_RECORD_BYTES) throw new Error(`Participant record ${name} exceeds 131072 bytes`);
    let value;
    try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error(`Participant record ${name} is not JSON`); }
    return validateParticipantRecord(value);
  }));
}

async function githubJson(url, label, fetchImplementation) {
  const response = await fetchImplementation(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'sutura-adoption-evidence' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${label} is not public: HTTP ${response.status}`);
  return response.json();
}

export async function verifyPublicSuturaRun({ repositoryUrl, runUrl, actionCommit }, fetchImplementation = fetch) {
  const parsedRepositoryUrl = new URL(repositoryUrl);
  const [owner, repository] = parsedRepositoryUrl.pathname.split('/').filter(Boolean);
  const runId = new URL(runUrl).pathname.split('/').filter(Boolean).at(-1);
  const repositoryBody = await githubJson(
    `https://api.github.com/repos/${owner}/${repository}`, 'Participant repository', fetchImplementation,
  );
  if (repositoryBody.private !== false || repositoryBody.full_name?.toLowerCase() !== `${owner}/${repository}`.toLowerCase()) {
    throw new Error('Participant repository identity is not public or does not match');
  }
  const run = await githubJson(
    `https://api.github.com/repos/${owner}/${repository}/actions/runs/${runId}`,
    'Participant Sutura run', fetchImplementation,
  );
  if (run.repository?.full_name?.toLowerCase() !== `${owner}/${repository}`.toLowerCase() ||
      !/^[a-f0-9]{40}$/u.test(run.head_sha ?? '') || run.path !== '.github/workflows/sutura.yml' ||
      run.event !== 'workflow_run' || run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error('Participant Sutura run identity does not match');
  }
  const workflow = await githubJson(
    `https://api.github.com/repos/${owner}/${repository}/contents/.github/workflows/sutura.yml?ref=${run.head_sha}`,
    'Participant workflow', fetchImplementation,
  );
  const text = Buffer.from(workflow.content ?? '', 'base64').toString('utf8');
  const references = workflowActionReferences(text, 'Participant Sutura workflow');
  if (references.length !== 1 || references[0] !== `juan294/sutura@${actionCommit}`) {
    throw new Error('Participant workflow does not use the recorded immutable Action commit');
  }
  return run;
}

export async function verifyParticipantPublicEvidence(record, fetchImplementation = fetch) {
  const repositoryUrl = new URL(record.repository.url);
  const [owner, repository] = repositoryUrl.pathname.split('/').filter(Boolean);
  const targetRunId = new URL(record.result.targetRunUrl).pathname.split('/').filter(Boolean).at(-1);
  const checkRunId = new URL(record.result.checkRunUrl).pathname.split('/').filter(Boolean).at(-1);
  const suturaRun = await verifyPublicSuturaRun({
    repositoryUrl: record.repository.url,
    runUrl: record.result.suturaRunUrl,
    actionCommit: record.artifact.actionCommit,
  }, fetchImplementation);
  const [targetRun, checkRun] = await Promise.all([
    githubJson(`https://api.github.com/repos/${owner}/${repository}/actions/runs/${targetRunId}`,
      'Participant target run', fetchImplementation),
    githubJson(`https://api.github.com/repos/${owner}/${repository}/check-runs/${checkRunId}`,
      'Participant Sutura check run', fetchImplementation),
  ]);
  if (targetRun.repository?.full_name?.toLowerCase() !== `${owner}/${repository}`.toLowerCase() ||
      !['failure', 'timed_out'].includes(targetRun.conclusion) || targetRun.status !== 'completed' ||
      !/^[a-f0-9]{40}$/u.test(targetRun.head_sha ?? '')) {
    throw new Error('Participant target run identity does not match');
  }
  const outcomes = { repair: 'fixed', refusal: 'refused', flake: 'flaky-no-patch' };
  if (checkRun.name !== 'Sutura repair audit' || checkRun.status !== 'completed' ||
      checkRun.head_sha !== targetRun.head_sha ||
      checkRun.external_id !== `sutura:${owner}/${repository}:workflow-run:${targetRunId}` ||
      checkRun.output?.title !== `Sutura outcome: ${outcomes[record.result.classification]}`) {
    throw new Error('Participant check run does not prove the recorded Sutura classification');
  }
  const runStarted = Date.parse(suturaRun.run_started_at);
  const runFinished = Date.parse(suturaRun.updated_at);
  const checkStarted = Date.parse(checkRun.started_at);
  const checkFinished = Date.parse(checkRun.completed_at);
  if ([runStarted, runFinished, checkStarted, checkFinished].some(Number.isNaN) ||
      checkStarted < runStarted - 5_000 || checkFinished > runFinished + 5_000 || checkFinished < checkStarted) {
    throw new Error('Participant check run timing does not match the Sutura workflow run');
  }
}

export async function verifyPublicRelease(packageVersion, candidate, dependencies = {}) {
  const fetchImplementation = dependencies.fetch ?? fetch;
  const resolveCommit = dependencies.resolveCommit ?? resolvePublicActionCommit;
  const [actionCommit, response] = await Promise.all([
    resolveCommit(packageVersion, ROOT),
    fetchImplementation(`https://registry.npmjs.org/sutura/${packageVersion}`, {
      headers: { accept: 'application/json', 'user-agent': 'sutura-adoption-evidence' },
      signal: AbortSignal.timeout(30_000),
    }),
  ]);
  if (actionCommit !== candidate) throw new Error('Public package release tag differs from candidate');
  if (!response.ok) throw new Error(`Public npm release is unavailable: HTTP ${response.status}`);
  const metadata = await response.json();
  if (metadata.name !== 'sutura' || metadata.version !== packageVersion || !metadata.dist?.integrity) {
    throw new Error('Public npm release metadata does not match');
  }
}

function validateStudyAggregate(records, candidate) {
  if (new Set(records.map(({ participantId }) => participantId)).size !== 3) {
    throw new Error('Adoption study requires three distinct participants');
  }
  const repositoryIdentities = records.map(({ repository }) => {
    const url = new URL(repository.url);
    return url.pathname.replace(/\/$/u, '').toLowerCase();
  });
  if (new Set(repositoryIdentities).size !== 3) throw new Error('Adoption study requires three distinct repositories');
  if (records.some((record) => record.artifact.actionCommit !== candidate)) {
    throw new Error('Every participant must use the release candidate Action commit');
  }
  const packageVersions = [...new Set(records.map((record) => record.artifact.packageVersion))];
  if (packageVersions.length !== 1) throw new Error('Every participant must use one identical public package release');
  const languages = [...new Set(records.map(({ repository }) => repository.language))].sort();
  if (!languages.some((language) => language === 'javascript' || language === 'typescript')) {
    throw new Error('Adoption study requires JavaScript or TypeScript');
  }
  if (!languages.includes('python')) throw new Error('Adoption study requires Python');
  const classifications = { flake: 0, refusal: 0, repair: 0 };
  for (const record of records) classifications[record.result.classification] += 1;
  if (Object.values(classifications).some((count) => count === 0)) {
    throw new Error('Adoption study requires one repair, one refusal, and one flake classification');
  }
  return { packageVersion: packageVersions[0], languages, classifications };
}

export async function finalizeStudy({
  candidate,
  recordsDirectory,
  verifyPublicEvidence = verifyParticipantPublicEvidence,
  verifyRelease = verifyPublicRelease,
}) {
  exactSha(candidate, 'candidate');
  const records = (await readRecords(recordsDirectory))
    .sort((left, right) => left.participantId.localeCompare(right.participantId));
  const { packageVersion, languages, classifications } = validateStudyAggregate(records, candidate);
  await verifyRelease(packageVersion, candidate);
  await Promise.all(records.map((record) => verifyPublicEvidence(record)));
  const base = {
    schemaVersion: STUDY_SCHEMA,
    candidateCommit: candidate,
    packageVersion,
    ready: true,
    participantCount: 3,
    repositoryCount: 3,
    languages,
    classifications,
    measurements: {
      timeToFirstValidResultMs: records.map(({ measurements }) => measurements.timeToFirstValidResultMs),
      setupFailureCount: records.reduce((count, record) => count + record.measurements.setupFailures.length, 0),
      unclearInstructionCount: records.reduce((count, record) => count + record.measurements.unclearInstructions.length, 0),
      manualInterventionCount: records.reduce((count, record) => count + record.measurements.manualInterventions.length, 0),
    },
    records,
  };
  return { ...base, resultHash: contentHash(base) };
}

export function validateStudyEvidence(input) {
  exactKeys(input, [
    'schemaVersion', 'candidateCommit', 'packageVersion', 'ready', 'participantCount',
    'repositoryCount', 'languages', 'classifications', 'measurements', 'records', 'resultHash',
  ], 'Adoption evidence');
  if (input.schemaVersion !== STUDY_SCHEMA || input.ready !== true || input.participantCount !== 3 ||
      input.repositoryCount !== 3 || !Array.isArray(input.records) || input.records.length !== 3) {
    throw new Error('Adoption evidence is incomplete');
  }
  exactSha(input.candidateCommit, 'candidateCommit');
  const records = input.records.map(validateParticipantRecord)
    .sort((left, right) => left.participantId.localeCompare(right.participantId));
  const aggregate = validateStudyAggregate(records, input.candidateCommit);
  if (aggregate.packageVersion !== input.packageVersion ||
      canonicalJson(aggregate.languages) !== canonicalJson(input.languages) ||
      canonicalJson(aggregate.classifications) !== canonicalJson(input.classifications)) {
    throw new Error('Adoption evidence aggregate fields do not match records');
  }
  const measurements = {
    timeToFirstValidResultMs: records.map((record) => record.measurements.timeToFirstValidResultMs),
    setupFailureCount: records.reduce((count, record) => count + record.measurements.setupFailures.length, 0),
    unclearInstructionCount: records.reduce((count, record) => count + record.measurements.unclearInstructions.length, 0),
    manualInterventionCount: records.reduce((count, record) => count + record.measurements.manualInterventions.length, 0),
  };
  if (canonicalJson(measurements) !== canonicalJson(input.measurements)) {
    throw new Error('Adoption evidence measurements do not match records');
  }
  const { resultHash, ...base } = input;
  if (contentHash(base) !== resultHash) throw new Error('Adoption evidence resultHash is invalid');
  return input;
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1] || args.indexOf(flag, index + 1) >= 0) throw new Error(`Missing or duplicate ${flag}`);
  return args[index + 1];
}

export async function main(args, output = process.stdout) {
  const command = args[0];
  if (command === 'validate-template' && args.length === 3) {
    const path = valueAfter(args, '--template');
    validateParticipantTemplate(JSON.parse(await readFile(path, 'utf8')));
    output.write('Participant record template: PASS\n');
    return;
  }
  if (command === 'print-recruitment' && args.length === 3) {
    output.write(await readFile(valueAfter(args, '--kit'), 'utf8'));
    return;
  }
  if (command === 'finalize' && args.length === 7) {
    const result = await finalizeStudy({
      candidate: valueAfter(args, '--candidate'),
      recordsDirectory: valueAfter(args, '--records'),
    });
    await writeFile(valueAfter(args, '--output'), `${canonicalJson(result)}\n`, { encoding: 'utf8', flag: 'wx' });
    output.write(`Adoption evidence: PASS (${result.resultHash})\n`);
    return;
  }
  throw new Error('Usage: adoption-study.mjs validate-template --template <file> | print-recruitment --kit <file> | finalize --candidate <sha> --records <directory> --output <file>');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
