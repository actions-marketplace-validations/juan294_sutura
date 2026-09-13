import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseReplayBundle,
  summarizeVerificationCosts,
  type VerificationCostSummary,
  replayBundle,
  type CaseFile,
  type ReplayBundle,
  type ReplayBundleOptions,
} from '@sutura/core';

import { CASE_LAB_CASES, caseLabCase, type CaseLabCase, type CaseLabCaseId } from './cases.js';
import type { ReleaseIdentity } from './dispatcher.js';
import { loadRecordedEvidence, recordedEvaluation, type RecordedEvidence, RECORDED_RESULT_FILE } from './evidence.js';
import {
  createCaseLabResult,
  type CaseLabCaseFile,
  type CaseLabResult,
} from './result.js';
import { SHA_PATTERN, isRecord, readBoundedJson } from './util.js';

export const PACKAGE_DIR = resolve(import.meta.dirname, '..');
export const REPOSITORY_ROOT = resolve(PACKAGE_DIR, '../..');
export const REPLAY_DIR = resolve(PACKAGE_DIR, 'replay');
const MAX_BUNDLE_BYTES = 16 * 1_024 * 1_024;
const EVIDENCE_URL = 'https://github.com/juan294/sutura/blob/develop/docs/demo/placebo-v0.2-live-2026-09.json';

export class CaseLabReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseLabReplayError';
  }
}

export const REPLAY_FIXTURE_SCHEMA_VERSION = 'sutura-case-lab-replay-fixture-v1' as const;

/**
 * A committed replay fixture: the bundle plus the identities it binds to. The
 * bundle's own `actionSha` is the commit of the repository that ran the
 * workflow (the demo commit); the Sutura release that ran is recorded here.
 */
export interface ReplayFixture {
  readonly schemaVersion: typeof REPLAY_FIXTURE_SCHEMA_VERSION;
  readonly release: ReleaseIdentity;
  readonly demoSha: string;
  readonly capturedRunUrl: string;
  readonly bundle: unknown;
}

export function parseReplayFixture(value: unknown): ReplayFixture {
  if (!isRecord(value) || value.schemaVersion !== REPLAY_FIXTURE_SCHEMA_VERSION) {
    throw new CaseLabReplayError(`replay fixture must be a ${REPLAY_FIXTURE_SCHEMA_VERSION} document`);
  }
  const release = value.release;
  if (!isRecord(release) || typeof release.version !== 'string' || typeof release.actionSha !== 'string' || !SHA_PATTERN.test(release.actionSha)) {
    throw new CaseLabReplayError('replay fixture release must name a version and an exact 40-character actionSha');
  }
  if (typeof value.demoSha !== 'string' || !SHA_PATTERN.test(value.demoSha)) {
    throw new CaseLabReplayError('replay fixture demoSha must be an exact lowercase 40-character commit');
  }
  if (typeof value.capturedRunUrl !== 'string' || !value.capturedRunUrl.startsWith('https://github.com/')) {
    throw new CaseLabReplayError('replay fixture capturedRunUrl must be a public GitHub run URL');
  }
  if (!isRecord(value.bundle)) throw new CaseLabReplayError('replay fixture bundle must be an object');
  return {
    schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
    release: { version: release.version, actionSha: release.actionSha },
    demoSha: value.demoSha,
    capturedRunUrl: value.capturedRunUrl,
    bundle: value.bundle,
  };
}

export function loadRelease(packageDir = PACKAGE_DIR): ReleaseIdentity {
  const { value } = readBoundedJson(resolve(packageDir, 'release.json'), 4_096, 'release.json', (message) => new CaseLabReplayError(message));
  if (!isRecord(value) || typeof value.version !== 'string' || typeof value.actionSha !== 'string' || !SHA_PATTERN.test(value.actionSha)) {
    throw new CaseLabReplayError('release.json must contain a version and an exact 40-character actionSha');
  }
  return { version: value.version, actionSha: value.actionSha };
}

/** Strip the ledger method and the trace so the case file is plain JSON data. */
export function plainCaseFile(caseFile: CaseFile | CaseLabCaseFile): CaseLabCaseFile {
  const { cost, ...rest } = caseFile as CaseFile;
  const withoutTrace = { ...rest } as Record<string, unknown>;
  delete withoutTrace.trace;
  return { ...(withoutTrace as Omit<CaseLabCaseFile, 'cost'>), cost: { entries: cost.entries } };
}

export function caseFileCost(caseFile: CaseLabCaseFile): VerificationCostSummary {
  if (caseFile.verification) return summarizeVerificationCosts(caseFile.verification.costs);
  const inferenceUsd = caseFile.cost.entries.reduce((sum, entry) => sum + entry.usd, 0);
  const sandboxUsd = caseFile.stages.reduce((sum, stage) => sum + (stage.metrics.cost ?? 0), 0);
  return { inferenceUsd, sandboxUsd, status: 'observed' };
}

export interface RecordedResultOptions {
  readonly release: ReleaseIdentity;
  readonly now: () => Date;
  /** Set when a replay bundle existed but could not be replayed. */
  readonly replayFallbackReason?: string;
}

export function recordedResult(
  item: CaseLabCase,
  evidence: RecordedEvidence,
  options: RecordedResultOptions,
): CaseLabResult {
  const { evaluation, ledgerEntry } = recordedEvaluation(evidence, item.placeboCaseId, item.tavilyEnabled);
  const caseFile = plainCaseFile(evaluation.caseFile);
  const cost = caseFileCost(caseFile);
  return createCaseLabResult({
    schemaVersion: 'sutura-case-lab-result-v1',
    requestId: `recorded-${item.id}`,
    caseId: item.id,
    mode: 'recorded',
    release: options.release,
    identity: { controllerSha: evidence.result.controllerSha },
    outcome: caseFile.outcome,
    expectedOutcome: item.expectedOutcome,
    matchesExpectation: caseFile.outcome === item.expectedOutcome,
    links: { workflowRun: ledgerEntry.runUrl, evidence: EVIDENCE_URL },
    caseFile,
    recordedFrom: {
      file: RECORDED_RESULT_FILE,
      resultHash: evidence.result.resultHash,
      runUrl: ledgerEntry.runUrl,
      subjectSha: evidence.result.subjectSha,
      recordedAt: ledgerEntry.recordedAt,
      ...(options.replayFallbackReason === undefined
        ? {}
        : { replayFallbackReason: options.replayFallbackReason }),
    },
    cost,
    elapsedMs: evaluation.elapsedTimeMs,
    createdAt: options.now().toISOString(),
  });
}

export interface ReplayedResultOptions extends RecordedResultOptions {
  readonly fixtureSha256: string;
  readonly replay?: (bundle: ReplayBundle, options?: ReplayBundleOptions) => ReturnType<typeof replayBundle>;
}

export async function replayedResult(
  item: CaseLabCase,
  fixtureValue: unknown,
  options: ReplayedResultOptions,
): Promise<CaseLabResult> {
  const fixture = parseReplayFixture(fixtureValue);
  if (fixture.release.actionSha !== options.release.actionSha) {
    throw new CaseLabReplayError(
      `replay fixture release actionSha ${fixture.release.actionSha} must equal release.json actionSha ${options.release.actionSha}`,
    );
  }
  const bundle = parseReplayBundle(fixture.bundle);
  if (bundle.actionSha !== fixture.demoSha) {
    throw new CaseLabReplayError(
      `replay bundle actionSha ${bundle.actionSha} must equal the fixture demoSha ${fixture.demoSha}`,
    );
  }
  if (!bundle.completeness.complete) {
    throw new CaseLabReplayError('replay bundle must be complete; partial bundles cannot produce a Case Lab result');
  }
  const replayed = await (options.replay ?? replayBundle)(bundle, { runtimeId: item.runtime });
  const caseFile = plainCaseFile(replayed.caseFile);
  if (bundle.outcome === undefined || caseFile.outcome !== bundle.outcome) {
    throw new CaseLabReplayError(
      `replay outcome mismatch: recorded ${String(bundle.outcome)}, replayed ${caseFile.outcome}`,
    );
  }
  const cost = caseFileCost(caseFile);
  return createCaseLabResult({
    schemaVersion: 'sutura-case-lab-result-v1',
    requestId: `replay-${item.id}`,
    caseId: item.id,
    mode: 'replay',
    release: options.release,
    identity: { controllerSha: options.release.actionSha, demoSha: fixture.demoSha },
    outcome: caseFile.outcome,
    expectedOutcome: item.expectedOutcome,
    matchesExpectation: caseFile.outcome === item.expectedOutcome,
    links: {
      workflowRun: fixture.capturedRunUrl,
      ciRun: `https://github.com/${bundle.repo}/actions/runs/${bundle.runId}`,
    },
    caseFile,
    replayedFrom: {
      bundleSha256: options.fixtureSha256,
      capturedRunUrl: fixture.capturedRunUrl,
      actionSha: options.release.actionSha,
    },
    cost,
    createdAt: options.now().toISOString(),
  });
}

export interface ReplayCatalogOptions {
  readonly rootDir?: string;
  readonly replayDir?: string;
  readonly release?: ReleaseIdentity;
  readonly now?: () => Date;
  readonly replay?: ReplayedResultOptions['replay'];
}

export function readReplayBundleFile(path: string): { value: unknown; sha256: string } {
  const { value, bytes } = readBoundedJson(path, MAX_BUNDLE_BYTES, `replay bundle ${path}`, (message) => new CaseLabReplayError(message));
  return { value, sha256: createHash('sha256').update(bytes).digest('hex') };
}

interface ResolvedCatalogOptions {
  readonly release: ReleaseIdentity;
  readonly now: () => Date;
  readonly replayDir: string;
  readonly rootDir: string;
  readonly replay: ReplayedResultOptions['replay'];
  /** Loaded and hash-verified once per catalog, on first use. */
  evidence?: RecordedEvidence;
}

function resolveOptions(options: ReplayCatalogOptions): ResolvedCatalogOptions {
  return {
    release: options.release ?? loadRelease(),
    now: options.now ?? (() => new Date()),
    replayDir: options.replayDir ?? REPLAY_DIR,
    rootDir: options.rootDir ?? REPOSITORY_ROOT,
    replay: options.replay,
  };
}

async function resultFor(item: CaseLabCase, resolved: ResolvedCatalogOptions): Promise<CaseLabResult> {
  const bundlePath = resolve(resolved.replayDir, `${item.id}.json`);
  let replayFallbackReason: string | undefined;
  if (existsSync(bundlePath)) {
    try {
      const { value, sha256 } = readReplayBundleFile(bundlePath);
      return await replayedResult(item, value, {
        release: resolved.release, now: resolved.now, fixtureSha256: sha256,
        ...(resolved.replay === undefined ? {} : { replay: resolved.replay }),
      });
    } catch (error) {
      // A bundle that cannot replay becomes a labelled recorded view, never a
      // result quietly relabelled as a replay.
      replayFallbackReason = error instanceof Error ? error.message.slice(0, 240) : String(error);
    }
  }
  resolved.evidence ??= loadRecordedEvidence(resolved.rootDir);
  return recordedResult(item, resolved.evidence, {
    release: resolved.release,
    now: resolved.now,
    ...(replayFallbackReason === undefined ? {} : { replayFallbackReason }),
  });
}

/** One deterministic result for one case: a complete replay bundle when present, else the recorded live result. */
export async function deterministicResult(
  caseId: CaseLabCaseId | string,
  options: ReplayCatalogOptions = {},
): Promise<CaseLabResult> {
  return resultFor(caseLabCase(caseId), resolveOptions(options));
}

/** Every case, in the roadmap order, each validated; the recorded evidence is read once. */
export async function replayCatalog(options: ReplayCatalogOptions = {}): Promise<CaseLabResult[]> {
  const resolved = resolveOptions(options);
  const results: CaseLabResult[] = [];
  for (const item of CASE_LAB_CASES) results.push(await resultFor(item, resolved));
  return results;
}
