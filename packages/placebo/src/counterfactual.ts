import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  authorizeRepairCandidate,
  COUNTERFACTUAL_GATES,
  COUNTERFACTUAL_INTENTS,
  createDefaultRepositoryPolicy,
  createRepairAuthorizationSession,
  deriveRepairAuthorization,
  runMechanicalChecks,
  validateCandidateDiff,
  type ControllerBaselineBinding,
  type CounterfactualGate,
  type CounterfactualIntent,
  type Diagnosis,
  type FailureClass,
  type RepairAuthorizationContext,
  type RepairAuthorizationKind,
  type RepairSourceExcerpt,
} from '@sutura/core';
import { canonicalJson } from '@sutura/evaluation';

import {
  applyPatch,
  copyPortableTestRuntime,
  createCorpusManifest,
  createPlaceboTemporaryDirectory,
  createPortableTestRuntime,
  discoverCases,
  installFixture,
  observeFixtureSuite,
  runFixtureSuite,
  verifyCandidateWithHiddenTests,
  type PortableTestRuntime,
} from './corpus.js';
import type {
  CorpusCase,
  FixtureLanguage,
  HiddenVerificationResult,
} from './types.js';

export const COUNTERFACTUAL_SCHEMA_VERSION = 'sutura-counterfactual-v1' as const;
export const COUNTERFACTUAL_SET_VERSION = '0.2' as const;

const DEFAULT_COUNTERFACTUAL_DIRECTORY = fileURLToPath(
  new URL('../counterfactual', import.meta.url),
);
const ALTERNATIVE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const DIFF_FILE = /^[a-z0-9][a-z0-9-]{0,63}\.diff$/u;
const GATES = new Set<string>(COUNTERFACTUAL_GATES);
const INTENTS = new Set<string>(COUNTERFACTUAL_INTENTS);
const AUTHORIZATION_KINDS = ['await-operation', 'await-setup', 'restore-strict-config'] as const;
const KINDS = new Set<string>(AUTHORIZATION_KINDS);
const STRICT_KEYS = ['strict', 'noUncheckedIndexedAccess'] as const;
const STRICT_KEY_NAMES = new Set<string>(STRICT_KEYS);
const SOURCE_PATH = /^[a-z0-9][a-z0-9_-]*(?:[./][a-z0-9][a-z0-9_-]*)*$/u;
const MAX_PROBE_OUTPUT_BYTES = 16_384;

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/**
 * The gates the offline harness can reach with no provider, in the production
 * order the audit applies them. `suite-rerun`, `adjudication`, and
 * `repository-policy` are recorded as not reached with their reason.
 */
export const DETERMINISTIC_GATES = ['patch-policy', 'mechanical', 'verification'] as const;
const PROVIDER_GATE_REASONS: Readonly<Record<string, string>> = {
  'suite-rerun': 'The offline harness runs the visible suite once; there is no second image to rerun.',
  adjudication: 'The adversarial Ultra audit requires an authorized provider.',
  'repository-policy': 'The Placebo fixtures declare no repository policy commands.',
};

function notReachedGates(
  reached: readonly CounterfactualGate[],
  rejectedAt: CounterfactualGate | null,
): Array<{ gate: CounterfactualGate; reason: string }> {
  return COUNTERFACTUAL_GATES.filter((gate) => !reached.includes(gate)).map((gate) => ({
    gate,
    reason: PROVIDER_GATE_REASONS[gate] ??
      `An earlier gate refused the alternative at ${rejectedAt ?? 'an earlier gate'}.`,
  }));
}

export interface CounterfactualAlternativeDeclaration {
  id: string;
  intent: CounterfactualIntent;
  rationale: string;
  file: string;
  expectedRejection: { gate: CounterfactualGate; rule: string } | null;
}

export interface CounterfactualAcceptedDeclaration {
  outcome: 'fixed' | 'refused';
  patch: string;
  evidence: string;
}

/**
 * The narrow controller grant this case needs before any candidate may touch a
 * conventional test or tool configuration file. The harness derives it through
 * the production `deriveRepairAuthorization` contract from the broken fixture's
 * own source and suite output; it never asserts a grant the controller refuses.
 */
export interface CounterfactualAuthorizationDeclaration {
  kind: RepairAuthorizationKind;
  path: string;
  strictKey?: typeof STRICT_KEYS[number];
  evidenceSources?: string[];
}

export interface CounterfactualCaseDeclaration {
  version: typeof COUNTERFACTUAL_SET_VERSION;
  caseId: string;
  accepted: CounterfactualAcceptedDeclaration;
  authorization?: CounterfactualAuthorizationDeclaration;
  alternatives: CounterfactualAlternativeDeclaration[];
}

export interface CounterfactualCase {
  declaration: CounterfactualCaseDeclaration;
  directory: string;
  corpusCase: CorpusCase;
  diffs: Map<string, string>;
  acceptedDiff: string;
}

export interface CounterfactualObservation {
  gate: CounterfactualGate;
  rule: string;
  evidence: string;
}

export interface CounterfactualAlternativeReport {
  id: string;
  intent: CounterfactualIntent;
  rationale: string;
  diffHash: string;
  rejected: boolean;
  observed: CounterfactualObservation | null;
  expected: { gate: CounterfactualGate; rule: string } | null;
  matchesExpectation: boolean;
  reachedGates: CounterfactualGate[];
  notReached: Array<{ gate: CounterfactualGate; reason: string }>;
  visibleSuiteExitCode: number | null;
  hiddenVerification?: HiddenVerificationResult;
  cost: { inferenceUsd: 0; sandboxOperations: number; elapsedTimeSec: number };
}

export interface CounterfactualAuthorizationReport {
  kind: RepairAuthorizationKind;
  path: string;
  strictKey?: typeof STRICT_KEYS[number];
  probeId: string;
  probeExitCode: number;
}

export interface CounterfactualCaseReport {
  caseId: string;
  kind: CorpusCase['metadata']['kind'];
  language: FixtureLanguage;
  failureClass: FailureClass;
  authorization: CounterfactualAuthorizationReport | null;
  accepted: CounterfactualAcceptedDeclaration & {
    diffHash: string;
    visibleSuiteExitCode: number;
    deterministicGatesPassed: boolean;
    hiddenVerification?: HiddenVerificationResult;
  };
  alternatives: CounterfactualAlternativeReport[];
}

export interface CounterfactualReport {
  schemaVersion: typeof COUNTERFACTUAL_SCHEMA_VERSION;
  corpusVersion: string;
  corpusHash: string;
  counterfactualHash: string;
  cases: CounterfactualCaseReport[];
  totals: {
    cases: number;
    alternatives: number;
    rejected: number;
    shortcuts: number;
    shortcutsRejected: number;
    expectationMismatches: number;
    inferenceUsd: 0;
    sandboxOperations: number;
    elapsedTimeSec: number;
  };
  resultHash: string;
}

function refuse(message: string): never {
  throw new Error(message);
}

function parseAuthorization(
  value: unknown,
  caseId: string,
): CounterfactualAuthorizationDeclaration | undefined {
  if (value === undefined) return undefined;
  const name = `${caseId}.authorization`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    refuse(`${name} must be an object`);
  }
  const item = value as Record<string, unknown>;
  for (const key of Object.keys(item)) {
    if (!['kind', 'path', 'strictKey', 'evidenceSources'].includes(key)) {
      refuse(`${name} has an unsupported field: ${key}`);
    }
  }
  if (typeof item.kind !== 'string' || !KINDS.has(item.kind)) {
    refuse(`${name}.kind must be one of ${AUTHORIZATION_KINDS.join(', ')}`);
  }
  if (item.evidenceSources !== undefined &&
    (!Array.isArray(item.evidenceSources) || item.evidenceSources.length > 4)) {
    refuse(`${name}.evidenceSources must be an array of at most four paths`);
  }
  const paths: unknown[] = [item.path, ...(item.evidenceSources as unknown[] | undefined ?? [])];
  for (const path of paths) {
    if (typeof path !== 'string' || !SOURCE_PATH.test(path)) {
      refuse(`${name} paths must be bounded relative repository paths`);
    }
  }
  if (new Set(paths).size !== paths.length) {
    refuse(`${name} paths must be distinct`);
  }
  const strictKey = item.strictKey;
  if (item.kind === 'restore-strict-config') {
    if (typeof strictKey !== 'string' || !STRICT_KEY_NAMES.has(strictKey)) {
      refuse(`${name}.strictKey must be one of ${STRICT_KEYS.join(', ')}`);
    }
  } else if (strictKey !== undefined) {
    refuse(`${name}.strictKey applies only to restore-strict-config`);
  }
  return {
    kind: item.kind as RepairAuthorizationKind,
    path: item.path as string,
    ...(strictKey === undefined ? {} : { strictKey: strictKey as typeof STRICT_KEYS[number] }),
    ...(item.evidenceSources === undefined
      ? {}
      : { evidenceSources: item.evidenceSources as string[] }),
  };
}

function parseDeclaration(text: string, caseId: string): CounterfactualCaseDeclaration {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    refuse(`Counterfactual set ${caseId} is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    refuse(`Counterfactual set ${caseId} must be an object`);
  }
  const declaration = value as Record<string, unknown>;
  if (declaration.version !== COUNTERFACTUAL_SET_VERSION) {
    refuse(`Counterfactual set ${caseId} must declare version ${COUNTERFACTUAL_SET_VERSION}`);
  }
  if (declaration.caseId !== caseId) {
    refuse(`Counterfactual set ${caseId} declares a different caseId`);
  }
  const accepted = declaration.accepted as Record<string, unknown> | undefined;
  if (
    typeof accepted !== 'object' || accepted === null ||
    (accepted.outcome !== 'fixed' && accepted.outcome !== 'refused') ||
    typeof accepted.patch !== 'string' || !accepted.patch.trim() ||
    typeof accepted.evidence !== 'string' || !accepted.evidence.trim()
  ) refuse(`Counterfactual set ${caseId} must declare an accepted outcome, patch, and evidence`);
  const authorization = parseAuthorization(declaration.authorization, caseId);
  if (!Array.isArray(declaration.alternatives)) {
    refuse(`Counterfactual set ${caseId} must declare an alternatives array`);
  }
  const alternatives = declaration.alternatives.map((entry, index): CounterfactualAlternativeDeclaration => {
    const name = `${caseId}.alternatives[${index}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      refuse(`${name} must be an object`);
    }
    const item = entry as Record<string, unknown>;
    for (const key of Object.keys(item)) {
      if (!['id', 'intent', 'rationale', 'file', 'expectedRejection'].includes(key)) {
        refuse(`${name} has an unsupported field: ${key}`);
      }
    }
    if (typeof item.id !== 'string' || !ALTERNATIVE_ID.test(item.id)) {
      refuse(`${name}.id must match ${ALTERNATIVE_ID.source}`);
    }
    if (typeof item.intent !== 'string' || !INTENTS.has(item.intent)) {
      refuse(`${name}.intent must be one of ${[...INTENTS].join(', ')}`);
    }
    if (typeof item.rationale !== 'string' || !item.rationale.trim() || item.rationale.length > 240) {
      refuse(`${name}.rationale must be a non-empty string of at most 240 characters`);
    }
    if (typeof item.file !== 'string' || !DIFF_FILE.test(item.file)) {
      refuse(`${name}.file must be a bounded .diff name inside the case directory`);
    }
    const expected = item.expectedRejection;
    if (expected !== null) {
      if (typeof expected !== 'object' || expected === null || Array.isArray(expected)) {
        refuse(`${name}.expectedRejection must be an object or null`);
      }
      const rejection = expected as Record<string, unknown>;
      if (typeof rejection.gate !== 'string' || !GATES.has(rejection.gate)) {
        refuse(`${name}.expectedRejection.gate must be a counterfactual gate`);
      }
      if (typeof rejection.rule !== 'string' || !rejection.rule.trim()) {
        refuse(`${name}.expectedRejection.rule must be non-empty`);
      }
    }
    return {
      id: item.id,
      intent: item.intent as CounterfactualIntent,
      rationale: item.rationale,
      file: item.file,
      expectedRejection: expected === null
        ? null
        : expected as CounterfactualAlternativeDeclaration['expectedRejection'],
    };
  });
  if (alternatives.length < 2 || alternatives.length > 3) {
    refuse(`Counterfactual set ${caseId} must declare two or three alternatives`);
  }
  if (new Set(alternatives.map(({ id }) => id)).size !== alternatives.length) {
    refuse(`Counterfactual set ${caseId} alternative ids must be distinct`);
  }
  if (!alternatives.some(({ intent }) => intent === 'shortcut')) {
    refuse(`Counterfactual set ${caseId} must include at least one shortcut`);
  }
  return {
    version: COUNTERFACTUAL_SET_VERSION,
    caseId,
    accepted: accepted as unknown as CounterfactualAcceptedDeclaration,
    ...(authorization === undefined ? {} : { authorization }),
    alternatives,
  };
}

export async function discoverCounterfactualCases(
  counterfactualDirectory = DEFAULT_COUNTERFACTUAL_DIRECTORY,
  corpusCases?: CorpusCase[],
): Promise<CounterfactualCase[]> {
  const corpus = new Map(
    (corpusCases ?? await discoverCases()).map((item) => [item.id, item] as const),
  );
  const entries = await readdir(counterfactualDirectory, { withFileTypes: true });
  const cases = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async ({ name }) => {
      const directory = join(counterfactualDirectory, name);
      const declaration = parseDeclaration(
        await readFile(join(directory, 'alternatives.json'), 'utf8'),
        name,
      );
      const corpusCase = corpus.get(name);
      if (corpusCase === undefined) {
        refuse(`Counterfactual set ${name} names a case that is not in the corpus`);
      }
      const diffs = new Map<string, string>();
      for (const alternative of declaration.alternatives) {
        diffs.set(alternative.id, await readFile(join(directory, alternative.file), 'utf8'));
      }
      if (new Set(diffs.values()).size !== diffs.size) {
        refuse(`Counterfactual set ${name} alternative diffs must be distinct`);
      }
      return {
        declaration,
        directory,
        corpusCase,
        diffs,
        acceptedDiff: await readFile(join(directory, declaration.accepted.patch), 'utf8'),
      };
    }));
  return cases.sort((left, right) =>
    left.declaration.caseId.localeCompare(right.declaration.caseId));
}

async function treeHash(directory: string): Promise<string> {
  const files: Array<{ path: string; sha256: string }> = [];
  async function visit(current: string, prefix = ''): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path, relative);
      else if (entry.isFile()) {
        files.push({
          path: relative,
          sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
        });
      } else refuse(`Counterfactual set contains an unsupported entry: ${relative}`);
    }
  }
  await visit(directory);
  return sha256(canonicalJson(files));
}

export function createCounterfactualManifestHash(
  directory = DEFAULT_COUNTERFACTUAL_DIRECTORY,
): Promise<string> {
  return treeHash(directory);
}

function mechanicalDiagnosis(benchmarkCase: CorpusCase): Diagnosis {
  return {
    class: benchmarkCase.metadata.class,
    confidence: 1,
    signals: [`placebo:${benchmarkCase.metadata.riskClass}`],
    failingCmd: benchmarkCase.metadata.expectedChecks[0] ?? 'pnpm test',
    errorExcerpt: benchmarkCase.metadata.description,
  };
}

interface GateOutcome {
  observed: CounterfactualObservation | null;
  reachedGates: CounterfactualGate[];
  visibleSuiteExitCode: number | null;
  sandboxOperations: number;
  elapsedTimeSec: number;
}

interface CaseAuthorization {
  context: RepairAuthorizationContext;
  report: CounterfactualAuthorizationReport;
}

/** Keeps the tail of a probe observation inside the controller evidence bound. */
function boundedProbeOutput(output: string): string {
  let text = output;
  while (Buffer.byteLength(text, 'utf8') > MAX_PROBE_OUTPUT_BYTES) {
    text = text.slice(Math.ceil(text.length / 2));
  }
  return text;
}

/**
 * Derives the case's declared controller grant from the broken fixture itself:
 * its complete baseline source and the real failing suite output stand in for
 * the controller probe. `deriveRepairAuthorization` is the production contract,
 * so a declared grant the controller would refuse fails the set instead of
 * quietly widening what the gates admit.
 */
async function deriveCaseAuthorization(
  benchmarkCase: CorpusCase,
  declared: CounterfactualAuthorizationDeclaration,
  portableRuntime: PortableTestRuntime,
): Promise<CaseAuthorization> {
  const temporaryRoot = await createPlaceboTemporaryDirectory(`cf-grant-${benchmarkCase.id}-`);
  const fixture = join(temporaryRoot, 'fixture');
  try {
    await cp(benchmarkCase.fixtureDirectory, fixture, { recursive: true });
    if (benchmarkCase.metadata.language !== 'python') {
      await copyPortableTestRuntime(fixture, portableRuntime);
    }
    await applyPatch(fixture, benchmarkCase.breakPatch);
    if (benchmarkCase.metadata.language !== 'python') {
      await installFixture(fixture, portableRuntime.storeDirectory);
    }
    const probe = await observeFixtureSuite(fixture);
    if (probe.exitCode === 0) {
      refuse(`Counterfactual set ${benchmarkCase.id} cannot authorize a repair: the broken fixture suite passed`);
    }
    const sources: RepairSourceExcerpt[] = [];
    for (const path of [declared.path, ...(declared.evidenceSources ?? [])]) {
      sources.push({
        path,
        startLine: 1,
        truncated: false,
        content: await readFile(join(fixture, path), 'utf8'),
      });
    }
    const policy = createDefaultRepositoryPolicy();
    const failingCommand = mechanicalDiagnosis(benchmarkCase).failingCmd;
    const baseline: ControllerBaselineBinding = {
      kind: 'local-snapshot',
      sourceSha: null,
      policyBaseSha: null,
      policySha256: sha256(canonicalJson(policy)),
      baselineImageId: `placebo-counterfactual:${benchmarkCase.id}`,
      snapshotSha256: sha256(canonicalJson(sources)),
    };
    const session = createRepairAuthorizationSession({ baseline, failingCommand, policy, sources });
    const probeId = declared.kind === 'restore-strict-config' ? 'strict-json' : 'async-completion';
    const grant = await deriveRepairAuthorization(session, {
      kind: declared.kind,
      path: declared.path,
      evidenceReferences: [`placebo:${benchmarkCase.id}`, `probe:${probeId}`],
      controllerProbe: {
        id: probeId,
        imageId: baseline.baselineImageId,
        exitCode: probe.exitCode,
        output: boundedProbeOutput(probe.output),
        sourceSha256: sha256(sources[0]!.content),
        failingCommand,
      },
      ...(declared.strictKey === undefined ? {} : { strictKey: declared.strictKey }),
    });
    if (!grant.ok) {
      refuse(`Counterfactual set ${benchmarkCase.id} declares an authorization the controller refuses: ${grant.reason}`);
    }
    return {
      context: { session, baseline },
      report: {
        kind: declared.kind,
        path: declared.path,
        ...(declared.strictKey === undefined ? {} : { strictKey: declared.strictKey }),
        probeId,
        probeExitCode: probe.exitCode,
      },
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

/**
 * Applies one patch to a fresh copy of the broken fixture and walks the
 * deterministic gates in the production order: the repository and built-in
 * patch policy, then the mechanical green-washing checks, then the visible
 * verification suite. The first gate that refuses is the recorded one, which
 * is the same rule `evaluateCounterfactuals` records on the live path. A case
 * grant is offered to the same `authorizeRepairCandidate` seam production uses,
 * so only the exact authorized edit shape passes the built-in test and tool
 * configuration rules.
 */
async function runDeterministicGates(
  benchmarkCase: CorpusCase,
  diff: string,
  portableRuntime: PortableTestRuntime,
  clock: () => number,
  authorization?: CaseAuthorization,
): Promise<GateOutcome> {
  const startedAt = clock();
  const reachedGates: CounterfactualGate[] = ['patch-policy'];
  const policy = createDefaultRepositoryPolicy();
  const certificate = authorization === undefined
    ? undefined
    : await authorizeRepairCandidate(
      authorization.context.session, authorization.context.baseline, diff,
    );
  const validation = validateCandidateDiff(
    diff,
    mechanicalDiagnosis(benchmarkCase),
    policy,
    policy.maxDiffBytes,
    authorization?.context,
  );
  if (!validation.ok) {
    return {
      observed: {
        gate: 'patch-policy',
        rule: validation.violations[0]!,
        evidence: [
          validation.violations.join('; '),
          ...(certificate === undefined || certificate.ok
            ? []
            : [`the controller grant does not cover this candidate: ${certificate.violations.join('; ')}`]),
        ].join('; '),
      },
      reachedGates,
      visibleSuiteExitCode: null,
      sandboxOperations: 0,
      elapsedTimeSec: Math.max(0, (clock() - startedAt) / 1_000),
    };
  }
  reachedGates.push('mechanical');
  const mechanical = runMechanicalChecks(diff).find(({ passed }) => !passed);
  if (mechanical !== undefined) {
    return {
      observed: {
        gate: 'mechanical',
        rule: mechanical.name,
        evidence: mechanical.evidence ?? 'No evidence recorded',
      },
      reachedGates,
      visibleSuiteExitCode: null,
      sandboxOperations: 0,
      elapsedTimeSec: Math.max(0, (clock() - startedAt) / 1_000),
    };
  }
  reachedGates.push('verification');
  const temporaryRoot = await createPlaceboTemporaryDirectory(`cf-${benchmarkCase.id}-`);
  const fixture = join(temporaryRoot, 'fixture');
  let sandboxOperations = 0;
  try {
    await cp(benchmarkCase.fixtureDirectory, fixture, { recursive: true });
    if (benchmarkCase.metadata.language !== 'python') {
      await copyPortableTestRuntime(fixture, portableRuntime);
    }
    await applyPatch(fixture, benchmarkCase.breakPatch);
    const patchFile = join(temporaryRoot, 'alternative.diff');
    await writeFile(patchFile, diff);
    await applyPatch(fixture, patchFile);
    sandboxOperations += 1;
    if (benchmarkCase.metadata.language !== 'python') {
      await installFixture(fixture, portableRuntime.storeDirectory);
      sandboxOperations += 1;
    }
    const exitCode = await runFixtureSuite(fixture);
    sandboxOperations += 1;
    return {
      observed: exitCode === 0 ? null : {
        gate: 'verification',
        rule: 'verification-command',
        evidence: `The diagnosed verification command exited ${exitCode}`,
      },
      reachedGates,
      visibleSuiteExitCode: exitCode,
      sandboxOperations,
      elapsedTimeSec: Math.max(0, (clock() - startedAt) / 1_000),
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export interface CounterfactualCheckOptions {
  caseId?: string;
  counterfactualDirectory?: string;
  storeDirectory?: string;
  clock?: () => number;
}

function normalizedForHash(report: Omit<CounterfactualReport, 'resultHash'>): unknown {
  return {
    ...report,
    totals: { ...report.totals, elapsedTimeSec: 0 },
    cases: report.cases.map((item) => ({
      ...item,
      alternatives: item.alternatives.map((alternative) => ({
        ...alternative,
        cost: { ...alternative.cost, elapsedTimeSec: 0 },
      })),
    })),
  };
}

export async function runCounterfactualCheck(
  options: CounterfactualCheckOptions = {},
): Promise<CounterfactualReport> {
  const clock = options.clock ?? (() => Date.now());
  const corpusCases = await discoverCases();
  const discovered = await discoverCounterfactualCases(
    options.counterfactualDirectory ?? DEFAULT_COUNTERFACTUAL_DIRECTORY,
    corpusCases,
  );
  const selected = options.caseId === undefined
    ? discovered
    : discovered.filter(({ declaration }) => declaration.caseId === options.caseId);
  if (options.caseId !== undefined && selected.length !== 1) {
    refuse(`Unknown counterfactual case: ${options.caseId}`);
  }
  const portableRuntime = await createPortableTestRuntime(options.storeDirectory);
  const cases: CounterfactualCaseReport[] = [];
  try {
    for (const item of selected) {
      const { corpusCase, declaration } = item;
      const authorization = declaration.authorization === undefined
        ? undefined
        : await deriveCaseAuthorization(corpusCase, declaration.authorization, portableRuntime);
      const accepted = await runDeterministicGates(
        corpusCase, item.acceptedDiff, portableRuntime, clock, authorization,
      );
      const acceptedHidden = await verifyCandidateWithHiddenTests(
        corpusCase, item.acceptedDiff, portableRuntime,
      );
      const alternatives: CounterfactualAlternativeReport[] = [];
      for (const alternative of declaration.alternatives) {
        const diff = item.diffs.get(alternative.id)!;
        const outcome = await runDeterministicGates(
          corpusCase, diff, portableRuntime, clock, authorization,
        );
        const hidden = await verifyCandidateWithHiddenTests(corpusCase, diff, portableRuntime);
        const expected = alternative.expectedRejection;
        alternatives.push({
          id: alternative.id,
          intent: alternative.intent,
          rationale: alternative.rationale,
          diffHash: sha256(diff),
          rejected: outcome.observed !== null,
          observed: outcome.observed,
          expected,
          matchesExpectation: expected === null
            ? outcome.observed === null
            : outcome.observed !== null &&
              outcome.observed.gate === expected.gate &&
              outcome.observed.rule === expected.rule,
          reachedGates: outcome.reachedGates,
          notReached: notReachedGates(outcome.reachedGates, outcome.observed?.gate ?? null),
          visibleSuiteExitCode: outcome.visibleSuiteExitCode,
          ...(hidden ? { hiddenVerification: hidden } : {}),
          cost: {
            inferenceUsd: 0,
            sandboxOperations: outcome.sandboxOperations,
            elapsedTimeSec: outcome.elapsedTimeSec,
          },
        });
      }
      cases.push({
        caseId: declaration.caseId,
        kind: corpusCase.metadata.kind,
        language: corpusCase.metadata.language,
        failureClass: corpusCase.metadata.class,
        authorization: authorization?.report ?? null,
        accepted: {
          ...declaration.accepted,
          diffHash: sha256(item.acceptedDiff),
          visibleSuiteExitCode: accepted.visibleSuiteExitCode ?? -1,
          deterministicGatesPassed: accepted.observed === null,
          ...(acceptedHidden ? { hiddenVerification: acceptedHidden } : {}),
        },
        alternatives,
      });
    }
  } finally {
    await portableRuntime.cleanup();
  }

  const everyAlternative = cases.flatMap(({ alternatives }) => alternatives);
  const shortcuts = everyAlternative.filter(({ intent }) => intent === 'shortcut');
  const base = {
    schemaVersion: COUNTERFACTUAL_SCHEMA_VERSION,
    corpusVersion: corpusCases[0]?.metadata.version ?? '0.2',
    corpusHash: (await createCorpusManifest(corpusCases)).corpusHash,
    counterfactualHash: await treeHash(
      options.counterfactualDirectory ?? DEFAULT_COUNTERFACTUAL_DIRECTORY,
    ),
    cases,
    totals: {
      cases: cases.length,
      alternatives: everyAlternative.length,
      rejected: everyAlternative.filter(({ rejected }) => rejected).length,
      shortcuts: shortcuts.length,
      shortcutsRejected: shortcuts.filter(({ rejected }) => rejected).length,
      expectationMismatches: everyAlternative.filter(({ matchesExpectation }) => !matchesExpectation).length,
      inferenceUsd: 0 as const,
      sandboxOperations: everyAlternative.reduce((total, { cost }) => total + cost.sandboxOperations, 0),
      elapsedTimeSec: everyAlternative.reduce((total, { cost }) => total + cost.elapsedTimeSec, 0),
    },
  };
  return {
    ...base,
    resultHash: sha256(canonicalJson(normalizedForHash(base))),
  };
}
