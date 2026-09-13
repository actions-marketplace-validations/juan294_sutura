import { parseDiagnosisRecoveryEvidence, findSelectedCandidate, summarizeVerificationCosts, parseVerificationEvidence, type CaseFile, type VerificationCostSummary } from '@sutura/core';

import { canonicalJson, contentHash } from './canonical.js';
import {
  CASE_LAB_OUTCOMES,
  type CaseLabCaseId,
  type CaseLabOutcome,
  caseLabCase,
  isCaseLabCaseId,
  isCaseLabOutcome,
  touchesTests,
} from './cases.js';
import { LIVE_REQUEST_ID_PATTERN, isCaseLabMode, isPublicHttpsUrl, type CaseLabMode } from './labels.js';
import { SHA256_PATTERN, SHA_PATTERN, isRecord, stringLeaves } from './util.js';

export const CASE_LAB_RESULT_SCHEMA_VERSION = 'sutura-case-lab-result-v1' as const;
export const MAX_RESULT_BYTES = 4 * 1_024 * 1_024;

/** A case file as stored in JSON: the same shape as `CaseFile` without the ledger method. */
export type CaseLabCaseFile = Omit<CaseFile, 'cost' | 'trace'> & {
  cost: { entries: CaseFile['cost']['entries'] };
};

export type CaseLabCounterfactual = NonNullable<CaseLabCaseFile['counterfactual']>;
export type CaseLabCounterfactualAlternative = CaseLabCounterfactual['alternatives'][number];

const COUNTERFACTUAL_GATES = new Set([
  'patch-policy', 'verification', 'mechanical', 'suite-rerun', 'adjudication', 'repository-policy',
]);
const COUNTERFACTUAL_INTENTS = new Set(['plausible', 'shortcut']);

export interface CaseLabResultLinks {
  readonly workflowRun?: string;
  readonly ciRun?: string;
  readonly pullRequest?: string;
  readonly repairPullRequest?: string;
  readonly refusalComment?: string;
  readonly check?: string;
  readonly caseFileArtifact?: string;
  readonly replayBundleArtifact?: string;
  readonly evidence?: string;
  readonly atifTrajectory?: string;
}

export interface CaseLabResultBase {
  readonly schemaVersion: typeof CASE_LAB_RESULT_SCHEMA_VERSION;
  readonly requestId: string;
  readonly caseId: CaseLabCaseId;
  readonly mode: CaseLabMode;
  readonly release: { readonly version: string; readonly actionSha: string };
  readonly identity: { readonly controllerSha: string; readonly demoSha?: string };
  readonly outcome: CaseLabOutcome;
  readonly expectedOutcome: CaseLabOutcome;
  /** Outcome equals the expectation and, for a case that guards its tests, the repair touched none. */
  readonly matchesExpectation: boolean;
  readonly links: CaseLabResultLinks;
  /** Repository-relative paths the repair pull request changed, when the workflow could read them. */
  readonly repairPaths?: readonly string[];
  readonly caseFile?: CaseLabCaseFile;
  readonly recordedFrom?: {
    readonly file: string;
    readonly resultHash: string;
    readonly runUrl: string;
    readonly subjectSha: string;
    readonly recordedAt: string;
    /**
     * Why a replay bundle was present but not used. A record shown because
     * replay failed must say so rather than looking like a plain recording.
     */
    readonly replayFallbackReason?: string;
  };
  readonly replayedFrom?: {
    readonly bundleSha256: string;
    readonly capturedRunUrl: string;
    readonly actionSha: string;
  };
  readonly cost: Readonly<VerificationCostSummary>;
  readonly elapsedMs?: number;
  readonly createdAt: string;
}

export interface CaseLabResult extends CaseLabResultBase {
  readonly resultHash: string;
}

export class CaseLabResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseLabResultError';
  }
}

const LINK_KEYS = Object.freeze([
  'workflowRun', 'ciRun', 'pullRequest', 'repairPullRequest', 'refusalComment',
  'check', 'caseFileArtifact', 'replayBundleArtifact', 'evidence', 'atifTrajectory',
] as const);

/** Matched against every decoded string value and key of the document. */
const FORBIDDEN_PUBLIC_TEXT = /(?:\/Users\/|[A-Z]:\\Users\\|Authorization:\s*(?:Bearer|Basic)|github_pat_|ghp_|sk-[A-Za-z0-9]{20,})/u;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new CaseLabResultError(`${label} must be an object`);
  return value;
}

function text(value: unknown, label: string, maximum = 4_096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new CaseLabResultError(`${label} must be a string of 1 to ${maximum} characters`);
  }
  return value;
}

function sha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    throw new CaseLabResultError(`${label} must be an exact lowercase 40-character commit`);
  }
  return value;
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new CaseLabResultError(`${label} must be a SHA-256 digest`);
  }
  return value;
}

function isoTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new CaseLabResultError(`${label} must be an ISO 8601 timestamp`);
  }
  return value;
}

function nonnegative(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new CaseLabResultError(`${label} must be a nonnegative number`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new CaseLabResultError(`${label} must be a boolean`);
  return value;
}

function array(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new CaseLabResultError(`${label} must be an array of at most ${maximum} items`);
  }
  return value;
}

const REPOSITORY_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_.@+\/-]{1,256}$/u;
const MAX_REPAIR_PATHS = 64;

function repositoryPaths(value: unknown, label: string): readonly string[] {
  const items = array(value, label, MAX_REPAIR_PATHS);
  return items.map((item, index) => {
    if (typeof item !== 'string' || !REPOSITORY_PATH.test(item)) {
      throw new CaseLabResultError(`${label}[${index}] must be a repository-relative path`);
    }
    return item;
  });
}

/** The single rule both the publisher and the validator apply to `matchesExpectation`. */
export function expectationMet(
  caseId: CaseLabCaseId,
  actual: CaseLabOutcome,
  expected: CaseLabOutcome,
  repairPaths: readonly string[] | undefined,
): boolean {
  if (actual !== expected) return false;
  const item = caseLabCase(caseId);
  return !(item.repairMustKeepTests === true && actual === 'fixed' && repairPaths !== undefined && touchesTests(repairPaths));
}

/** GitHub addresses a pull request comment by fragment; nothing else may carry one. */
const GITHUB_COMMENT_FRAGMENT = /^#issuecomment-\d{1,20}$/u;

/**
 * Only public GitHub URLs: the shared https rule plus an allowed host, no
 * query, and no fragment other than a pull request comment anchor.
 */
export function publicGitHubUrl(value: unknown, label: string): string {
  const raw = text(value, label, 512);
  const fragmentStart = raw.indexOf('#');
  const fragment = fragmentStart === -1 ? '' : raw.slice(fragmentStart);
  const withoutFragment = fragmentStart === -1 ? raw : raw.slice(0, fragmentStart);
  const host = isPublicHttpsUrl(withoutFragment) ? new URL(withoutFragment).hostname : undefined;
  const url = host === undefined ? undefined : new URL(withoutFragment);
  if (
    url === undefined ||
    (host !== 'github.com' && host !== 'raw.githubusercontent.com') ||
    url.search !== '' ||
    (fragment !== '' && !(host === 'github.com' && GITHUB_COMMENT_FRAGMENT.test(fragment)))
  ) {
    throw new CaseLabResultError(`${label} must be a public https://github.com URL`);
  }
  return `${url.toString()}${fragment}`;
}

function outcome(value: unknown, label: string): CaseLabOutcome {
  if (!isCaseLabOutcome(value)) {
    throw new CaseLabResultError(`${label} must be one of ${CASE_LAB_OUTCOMES.join(', ')}`);
  }
  return value;
}

function mode(value: unknown): CaseLabMode {
  if (isCaseLabMode(value)) return value;
  throw new CaseLabResultError('mode must be live, replay, or recorded');
}

function requestId(value: unknown, resultMode: CaseLabMode, caseId: CaseLabCaseId): string {
  const id = text(value, 'requestId', 64);
  if (resultMode === 'live') {
    if (!LIVE_REQUEST_ID_PATTERN.test(id)) {
      throw new CaseLabResultError('requestId must match cl-<13 digits>-<8 hex> for a live result');
    }
    return id;
  }
  if (id !== `${resultMode}-${caseId}`) {
    throw new CaseLabResultError(`requestId must be ${resultMode}-${caseId} for a ${resultMode} result`);
  }
  return id;
}

function costEntries(value: unknown): CaseLabCaseFile['cost']['entries'] {
  return array(value, 'caseFile.cost.entries', 512).map((entry, index) => {
    const item = record(entry, `caseFile.cost.entries[${index}]`);
    const role = item.role;
    if (role !== 'nano' && role !== 'super' && role !== 'ultra') {
      throw new CaseLabResultError(`caseFile.cost.entries[${index}].role must be nano, super, or ultra`);
    }
    return {
      role,
      model: text(item.model, `caseFile.cost.entries[${index}].model`, 256),
      inTok: nonnegative(item.inTok, `caseFile.cost.entries[${index}].inTok`),
      outTok: nonnegative(item.outTok, `caseFile.cost.entries[${index}].outTok`),
      reasoningTok: nonnegative(item.reasoningTok, `caseFile.cost.entries[${index}].reasoningTok`),
      usd: nonnegative(item.usd, `caseFile.cost.entries[${index}].usd`),
    };
  });
}

/**
 * Structural validation of the stored case file. It checks every field the
 * result view renders and the outcome agreement; nested evidence keeps the
 * shape the orchestrator produced.
 */
/**
 * Bounds the counterfactual evidence a published result may carry. This is a
 * signed-out input boundary, so every field is checked and every string is
 * length-bounded.
 */
function validateCounterfactual(value: unknown): void {
  const evidence = record(value, 'caseFile.counterfactual');
  if ((evidence.status !== undefined && evidence.status !== 'complete' && evidence.status !== 'insufficient') ||
      (evidence.status === 'insufficient' ? evidence.reason !== 'budget-exhausted' : evidence.reason !== undefined)) {
    throw new CaseLabResultError('caseFile.counterfactual has inconsistent completion status');
  }
  if (evidence.acceptedCandidateId !== undefined) {
    text(evidence.acceptedCandidateId, 'caseFile.counterfactual.acceptedCandidateId', 128);
  }
  const cost = record(evidence.cost, 'caseFile.counterfactual.cost');
  for (const key of ['inferenceUsd', 'sandboxOperations', 'elapsedTimeSec'] as const) {
    nonnegative(cost[key], `caseFile.counterfactual.cost.${key}`);
  }
  const alternatives = array(evidence.alternatives, 'caseFile.counterfactual.alternatives', 8);
  for (const [index, entry] of alternatives.entries()) {
    const name = `caseFile.counterfactual.alternatives[${index}]`;
    const item = record(entry, name);
    text(item.id, `${name}.id`, 128);
    if (typeof item.intent !== 'string' || !COUNTERFACTUAL_INTENTS.has(item.intent)) {
      throw new CaseLabResultError(`${name}.intent must be plausible or shortcut`);
    }
    text(item.rationale, `${name}.rationale`, 512);
    const diffHash = text(item.diffHash, `${name}.diffHash`, 64);
    if (!SHA256_PATTERN.test(diffHash)) {
      throw new CaseLabResultError(`${name}.diffHash must be a SHA-256 digest`);
    }
    boolean(item.approved, `${name}.approved`);
    nonnegative(item.testExitCode, `${name}.testExitCode`);
    if (typeof item.reasoning !== 'string') {
      throw new CaseLabResultError(`${name}.reasoning must be a string`);
    }
    if (item.rejectedBy !== undefined) {
      const rejectedBy = record(item.rejectedBy, `${name}.rejectedBy`);
      const gate = text(rejectedBy.gate, `${name}.rejectedBy.gate`, 32);
      if (!COUNTERFACTUAL_GATES.has(gate)) {
        throw new CaseLabResultError(`${name}.rejectedBy.gate must be a counterfactual gate`);
      }
      text(rejectedBy.rule, `${name}.rejectedBy.rule`, 256);
      if (typeof rejectedBy.evidence !== 'string' || rejectedBy.evidence.length > 2_048) {
        throw new CaseLabResultError(`${name}.rejectedBy.evidence must be a bounded string`);
      }
    }
    if (item.approved === (item.rejectedBy !== undefined)) {
      throw new CaseLabResultError(`${name}.rejectedBy must be present exactly when the alternative was rejected`);
    }
    const itemCost = record(item.cost, `${name}.cost`);
    for (const key of ['inferenceUsd', 'sandboxOperations', 'elapsedTimeSec'] as const) {
      nonnegative(itemCost[key], `${name}.cost.${key}`);
    }
  }
}

export function validateCaseLabCaseFile(value: unknown, expectedOutcome: CaseLabOutcome): CaseLabCaseFile {
  const file = record(value, 'caseFile');
  const runtime = file.runtime;
  if (runtime !== 'node' && runtime !== 'python') {
    throw new CaseLabResultError('caseFile.runtime must be node or python');
  }
  const diagnosis = record(file.diagnosis, 'caseFile.diagnosis');
  text(diagnosis.class, 'caseFile.diagnosis.class', 64);
  nonnegative(diagnosis.confidence, 'caseFile.diagnosis.confidence');
  array(diagnosis.signals, 'caseFile.diagnosis.signals', 256);
  if (typeof diagnosis.failingCmd !== 'string') throw new CaseLabResultError('caseFile.diagnosis.failingCmd must be a string');
  if (typeof diagnosis.errorExcerpt !== 'string') throw new CaseLabResultError('caseFile.diagnosis.errorExcerpt must be a string');
  if (diagnosis.grounding !== undefined) {
    const grounding = record(diagnosis.grounding, 'caseFile.diagnosis.grounding');
    for (const [index, entry] of array(grounding.citations ?? [], 'caseFile.diagnosis.grounding.citations', 32).entries()) {
      const citation = record(entry, `caseFile.diagnosis.grounding.citations[${index}]`);
      text(citation.title, `caseFile.diagnosis.grounding.citations[${index}].title`, 512);
      const url = text(citation.url, `caseFile.diagnosis.grounding.citations[${index}].url`, 2_048);
      if (!isPublicHttpsUrl(url)) {
        throw new CaseLabResultError(`caseFile.diagnosis.grounding.citations[${index}].url must be an https URL`);
      }
    }
  }
  const triage = record(file.triage, 'caseFile.triage');
  text(triage.status, 'caseFile.triage.status', 32);
  nonnegative(triage.reproduced, 'caseFile.triage.reproduced');
  nonnegative(triage.of, 'caseFile.triage.of');
  const race = array(file.race, 'caseFile.race', 64);
  for (const [index, entry] of race.entries()) {
    const item = record(entry, `caseFile.race[${index}]`);
    const candidate = record(item.candidate, `caseFile.race[${index}].candidate`);
    text(candidate.id, `caseFile.race[${index}].candidate.id`, 128);
    if (typeof candidate.diff !== 'string') throw new CaseLabResultError(`caseFile.race[${index}].candidate.diff must be a string`);
    boolean(item.held, `caseFile.race[${index}].held`);
  }
  if (file.audit !== undefined) {
    const audit = record(file.audit, 'caseFile.audit');
    boolean(audit.approved, 'caseFile.audit.approved');
    for (const [index, entry] of array(audit.checks, 'caseFile.audit.checks', 64).entries()) {
      const check = record(entry, `caseFile.audit.checks[${index}]`);
      text(check.name, `caseFile.audit.checks[${index}].name`, 64);
      boolean(check.passed, `caseFile.audit.checks[${index}].passed`);
    }
    if (typeof audit.reasoning !== 'string') throw new CaseLabResultError('caseFile.audit.reasoning must be a string');
  }
  const fileOutcome = outcome(file.outcome, 'caseFile.outcome');
  if (fileOutcome !== expectedOutcome) {
    throw new CaseLabResultError(`caseFile.outcome must equal the result outcome ${expectedOutcome}`);
  }
  const cost = record(file.cost, 'caseFile.cost');
  const policy = record(file.policy, 'caseFile.policy');
  text(policy.baseRef, 'caseFile.policy.baseRef', 256);
  text(policy.baseSha, 'caseFile.policy.baseSha', 64);
  text(policy.policySha, 'caseFile.policy.policySha', 64);
  const stages = array(file.stages, 'caseFile.stages', 1_024);
  for (const [index, entry] of stages.entries()) {
    const stage = record(entry, `caseFile.stages[${index}]`);
    text(stage.stage, `caseFile.stages[${index}].stage`, 32);
    text(stage.nodeId, `caseFile.stages[${index}].nodeId`, 128);
    record(stage.metrics, `caseFile.stages[${index}].metrics`);
    if (stage.network !== 'disabled' && stage.network !== 'enabled') {
      throw new CaseLabResultError(`caseFile.stages[${index}].network must be disabled or enabled`);
    }
  }
  if (file.search !== undefined) array(file.search, 'caseFile.search', 256);
  if (file.counterfactual !== undefined) validateCounterfactual(file.counterfactual);
  const verification = file.verification === undefined ? undefined : parseVerificationEvidence(file.verification);
  const recovery = Object.hasOwn(file, 'recovery') ? parseDiagnosisRecoveryEvidence(file.recovery, {
    initialClass: diagnosis.class as string, observedCommand: diagnosis.failingCmd as string,
    ...(SHA_PATTERN.test(String(policy.baseSha)) ? { policyBaseSha: policy.baseSha as string } : {}),
    ...(SHA256_PATTERN.test(String(policy.policySha)) ? { policySha256: policy.policySha as string } : {}),
    ...(verification === undefined ? {} : verification.identity),
  }) : undefined;
  if (verification?.recovery !== undefined) {
    parseDiagnosisRecoveryEvidence(verification.recovery, { initialClass: diagnosis.class as string, observedCommand: diagnosis.failingCmd as string });
    if (recovery !== undefined && canonicalJson(recovery) !== canonicalJson(verification.recovery)) throw new CaseLabResultError('caseFile.recovery differs from verification recovery');
  }
  if (verification !== undefined) {
    const candidateIds = (race as CaseFile['race']).map(({ candidate }) => candidate.id);
    if (new Set(candidateIds).size !== candidateIds.length) {
      throw new CaseLabResultError('caseFile.verification cannot bind duplicate candidate ids');
    }
    const expectedVerificationOutcome = {
      fixed: 'repaired', refused: 'refused', 'gave-up': 'insufficient',
      'flaky-no-patch': 'flaky-no-patch', 'infra-stop': 'infra-stop',
    }[fileOutcome];
    if (verification.outcome !== expectedVerificationOutcome) {
      throw new CaseLabResultError('caseFile.verification outcome differs from the case file');
    }
    if (verification.identity.policyBaseSha !== policy.baseSha || verification.identity.policySha256 !== policy.policySha) {
      throw new CaseLabResultError('caseFile.verification policy identity differs from the case file');
    }
    if (fileOutcome === 'fixed' && file.selectedCandidate === undefined) {
      throw new CaseLabResultError('caseFile.verification repaired outcome requires a selected candidate');
    }
    if (file.selectedCandidate !== undefined) {
      const selected = record(file.selectedCandidate, 'caseFile.selectedCandidate');
      if (file.counterfactual !== undefined) {
        const counterfactual = record(file.counterfactual, 'caseFile.counterfactual');
        if (counterfactual.acceptedCandidateId !== undefined && counterfactual.acceptedCandidateId !== selected.id) {
          throw new CaseLabResultError('caseFile.verification counterfactual selection differs from verified candidate');
        }
      }
      const selectedIdentity = { id: text(selected.id, 'selectedCandidate.id', 128), diffHash: sha256(selected.diffHash, 'selectedCandidate.diffHash') };
      if (verification.identity.diffSha256 !== selected.diffHash ||
          findSelectedCandidate(race as CaseFile['race'], selectedIdentity) === null) {
        throw new CaseLabResultError('caseFile.verification diff identity differs from the selected candidate');
      }
    }
  }

  const rest = Object.fromEntries(
    Object.entries(file).filter(([key]) => key !== 'cost' && key !== 'trace'),
  ) as unknown as Omit<CaseLabCaseFile, 'cost' | 'outcome' | 'runtime'>;
  return {
    ...rest,
    runId: text(file.runId, 'caseFile.runId', 256),
    repo: text(file.repo, 'caseFile.repo', 256),
    runtime,
    outcome: fileOutcome,
    cost: { entries: costEntries(cost.entries) },
    ...(verification === undefined ? {} : { verification }),
    ...(recovery === undefined ? {} : { recovery }),
  };
}

function links(value: unknown): CaseLabResultLinks {
  const raw = record(value, 'links');
  const result: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    if (!(LINK_KEYS as readonly string[]).includes(key)) {
      throw new CaseLabResultError(`links.${key} is not an allowed link`);
    }
    if (raw[key] === undefined) continue;
    result[key] = publicGitHubUrl(raw[key], `links.${key}`);
  }
  return result as CaseLabResultLinks;
}

function base(value: unknown): CaseLabResultBase {
  const raw = record(value, 'result');
  if (raw.schemaVersion !== CASE_LAB_RESULT_SCHEMA_VERSION) {
    throw new CaseLabResultError(`schemaVersion must be ${CASE_LAB_RESULT_SCHEMA_VERSION}`);
  }
  if (!isCaseLabCaseId(raw.caseId)) throw new CaseLabResultError('caseId must be a server-defined Case Lab id');
  const caseId = raw.caseId;
  const resultMode = mode(raw.mode);
  const release = record(raw.release, 'release');
  const identity = record(raw.identity, 'identity');
  const resultOutcome = outcome(raw.outcome, 'outcome');
  const expected = outcome(raw.expectedOutcome, 'expectedOutcome');
  const matches = boolean(raw.matchesExpectation, 'matchesExpectation');
  const repairPaths = raw.repairPaths === undefined ? undefined : repositoryPaths(raw.repairPaths, 'repairPaths');
  if (matches !== expectationMet(caseId, resultOutcome, expected, repairPaths)) {
    throw new CaseLabResultError('matchesExpectation must equal outcome === expectedOutcome with the repair keeping every test file');
  }
  const cost = record(raw.cost, 'cost');
  const validatedFile = raw.caseFile === undefined ? undefined : validateCaseLabCaseFile(raw.caseFile, resultOutcome);
  const verification = validatedFile?.verification;
  if (cost.status !== 'observed' && cost.status !== 'unavailable' && !(verification && cost.status === 'partial')) {
    throw new CaseLabResultError('cost.status must be observed or unavailable');
  }
  const result: {
    -readonly [K in keyof CaseLabResultBase]: CaseLabResultBase[K];
  } = {
    schemaVersion: CASE_LAB_RESULT_SCHEMA_VERSION,
    requestId: requestId(raw.requestId, resultMode, caseId),
    caseId,
    mode: resultMode,
    release: {
      version: text(release.version, 'release.version', 32),
      actionSha: sha(release.actionSha, 'release.actionSha'),
    },
    identity: {
      controllerSha: sha(identity.controllerSha, 'identity.controllerSha'),
      ...(identity.demoSha === undefined ? {} : { demoSha: sha(identity.demoSha, 'identity.demoSha') }),
    },
    outcome: resultOutcome,
    expectedOutcome: expected,
    matchesExpectation: matches,
    links: links(raw.links),
    ...(repairPaths === undefined ? {} : { repairPaths }),
    cost: {
      inferenceUsd: verification && cost.inferenceUsd === null ? null : nonnegative(cost.inferenceUsd, 'cost.inferenceUsd'),
      sandboxUsd: verification && cost.sandboxUsd === null ? null : nonnegative(cost.sandboxUsd, 'cost.sandboxUsd'),
      status: cost.status,
    },
    createdAt: isoTimestamp(raw.createdAt, 'createdAt'),
  };
  if (validatedFile !== undefined) result.caseFile = validatedFile;
  if (validatedFile?.recovery !== undefined && result.identity.demoSha !== undefined) parseDiagnosisRecoveryEvidence(validatedFile.recovery, { sourceSha: result.identity.demoSha });
  if (verification !== undefined) {
    if (verification.identity.sourceSha !== result.identity.demoSha) {
      throw new CaseLabResultError('caseFile.verification source differs from the displayed source identity');
    }
    if (canonicalJson(result.cost) !== canonicalJson(summarizeVerificationCosts(verification.costs))) {
      throw new CaseLabResultError('cost must match typed verification costs; unknown units are not USD or zero');
    }
  }
  if (raw.elapsedMs !== undefined) result.elapsedMs = nonnegative(raw.elapsedMs, 'elapsedMs');
  if (resultMode === 'recorded') {
    const recorded = record(raw.recordedFrom, 'recordedFrom');
    result.recordedFrom = {
      file: text(recorded.file, 'recordedFrom.file', 256),
      resultHash: sha256(recorded.resultHash, 'recordedFrom.resultHash'),
      runUrl: publicGitHubUrl(recorded.runUrl, 'recordedFrom.runUrl'),
      subjectSha: sha(recorded.subjectSha, 'recordedFrom.subjectSha'),
      recordedAt: isoTimestamp(recorded.recordedAt, 'recordedFrom.recordedAt'),
      ...(recorded.replayFallbackReason === undefined
        ? {}
        : { replayFallbackReason: text(recorded.replayFallbackReason, 'recordedFrom.replayFallbackReason', 240) }),
    };
  } else if (raw.recordedFrom !== undefined) {
    throw new CaseLabResultError('recordedFrom is allowed only for a recorded result');
  }
  if (resultMode === 'replay') {
    const replayed = record(raw.replayedFrom, 'replayedFrom');
    result.replayedFrom = {
      bundleSha256: sha256(replayed.bundleSha256, 'replayedFrom.bundleSha256'),
      capturedRunUrl: publicGitHubUrl(replayed.capturedRunUrl, 'replayedFrom.capturedRunUrl'),
      actionSha: sha(replayed.actionSha, 'replayedFrom.actionSha'),
    };
  } else if (raw.replayedFrom !== undefined) {
    throw new CaseLabResultError('replayedFrom is allowed only for a replay result');
  }
  return result;
}

/** Reject any text a public artifact must never carry, scanning decoded strings rather than escaped JSON. */
export function assertCaseLabResultPublicSafe<T>(value: T, secrets: readonly (string | undefined)[] = []): T {
  const known = secrets.filter((secret): secret is string => typeof secret === 'string' && secret.length > 0);
  for (const leaf of stringLeaves(value)) {
    if (FORBIDDEN_PUBLIC_TEXT.test(leaf) || known.some((secret) => leaf.includes(secret))) {
      throw new CaseLabResultError('result contains a credential or private local path');
    }
  }
  return value;
}

/** One pass: size cap on the canonical form, then the public-safety scan. */
function finish(validated: CaseLabResultBase, resultHash: string, secrets: readonly (string | undefined)[]): CaseLabResult {
  const result: CaseLabResult = { ...validated, resultHash };
  if (Buffer.byteLength(canonicalJson(result), 'utf8') > MAX_RESULT_BYTES) {
    throw new CaseLabResultError(`result exceeds ${MAX_RESULT_BYTES} bytes`);
  }
  return assertCaseLabResultPublicSafe(result, secrets);
}

export function createCaseLabResult(
  input: CaseLabResultBase,
  secrets: readonly (string | undefined)[] = [],
): CaseLabResult {
  const validated = base(input);
  return finish(validated, contentHash(validated), secrets);
}

export function validateCaseLabResult(
  value: unknown,
  secrets: readonly (string | undefined)[] = [],
): CaseLabResult {
  const raw = record(value, 'result');
  const validated = base(raw);
  const expectedHash = contentHash(validated);
  if (raw.resultHash !== expectedHash) {
    throw new CaseLabResultError('resultHash does not match the result content');
  }
  return finish(validated, expectedHash, secrets);
}
