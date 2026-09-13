import { parseReplayBundle } from '@sutura/core';

import { CaseLabRequestError, caseLabCase, expectedOutcomeFor, isCaseLabOutcome, type CaseLabOutcome } from './cases.js';
import type { ReleaseIdentity } from './dispatcher.js';
import { caseFileCost, loadRelease, plainCaseFile, readReplayBundleFile } from './replay.js';
import {
  createCaseLabResult,
  expectationMet,
  validateCaseLabCaseFile,
  type CaseLabCaseFile,
  type CaseLabResult,
  type CaseLabResultLinks,
} from './result.js';
import { readBoundedJson } from './util.js';

export interface PublishInputs {
  readonly requestId: string;
  readonly caseId: string;
  /** The Action's outcome output. Empty means the Action never reached a verdict: infra-stop. */
  readonly outcome: string;
  readonly demoSha: string;
  readonly controllerSha: string;
  readonly caseFilePath?: string;
  readonly replayBundlePath?: string;
  readonly links: CaseLabResultLinks;
  /** Paths the repair pull request changed; required when the case guards its tests and the outcome is fixed. */
  readonly repairPaths?: readonly string[];
  readonly elapsedMs?: number;
  readonly release?: ReleaseIdentity;
  readonly now?: () => Date;
  readonly secrets?: readonly (string | undefined)[];
}

const MAX_CASE_FILE_BYTES = 4 * 1_024 * 1_024;

export function normalizeOutcome(value: string): CaseLabOutcome {
  const outcome = value.trim() === '' ? 'infra-stop' : value.trim();
  if (!isCaseLabOutcome(outcome)) throw new CaseLabRequestError(`outcome must be empty or one of fixed, flaky-no-patch, refused, gave-up, infra-stop`);
  return outcome;
}

function readCaseFile(path: string, outcome: CaseLabOutcome): CaseLabCaseFile {
  const { value } = readBoundedJson(path, MAX_CASE_FILE_BYTES, `case file ${path}`, (message) => new CaseLabRequestError(message));
  return validateCaseLabCaseFile(plainCaseFile(value as CaseLabCaseFile), outcome);
}

function withoutEmpty(links: CaseLabResultLinks): CaseLabResultLinks {
  return Object.fromEntries(
    Object.entries(links).filter(([, value]) => typeof value === 'string' && value.length > 0),
  ) as CaseLabResultLinks;
}

/**
 * Assemble the live result document inside the demo workflow. It never
 * replays anything itself: the case file comes from the released CLI, and
 * the replay bundle is only cross-checked for identity and outcome.
 */
export function publishResult(inputs: PublishInputs): CaseLabResult {
  const item = caseLabCase(inputs.caseId);
  const release = inputs.release ?? loadRelease();
  const outcome = normalizeOutcome(inputs.outcome);
  if (inputs.replayBundlePath !== undefined && inputs.replayBundlePath !== '') {
    const bundle = parseReplayBundle(readReplayBundleFile(inputs.replayBundlePath).value);
    // The Action records the commit of the repository that ran the workflow, which is the demo commit.
    if (bundle.actionSha !== inputs.demoSha) {
      throw new CaseLabRequestError(`replay bundle actionSha ${bundle.actionSha} must equal the demo commit ${inputs.demoSha}`);
    }
    if (bundle.outcome !== undefined && bundle.outcome !== outcome) {
      throw new CaseLabRequestError(`replay bundle outcome ${bundle.outcome} must equal the Action outcome ${outcome}`);
    }
  }
  const caseFile = inputs.caseFilePath === undefined || inputs.caseFilePath === ''
    ? undefined
    : readCaseFile(inputs.caseFilePath, outcome);
  const cost = caseFile === undefined
    ? { inferenceUsd: 0, sandboxUsd: 0, status: 'unavailable' as const }
    : caseFileCost(caseFile);
  const expectedOutcome = expectedOutcomeFor(item, 'live');
  if (item.repairMustKeepTests === true && outcome === 'fixed' && inputs.repairPaths === undefined) {
    throw new CaseLabRequestError(`${item.id} guards its test file: a fixed result needs the repair pull request paths (--repair-paths)`);
  }
  return createCaseLabResult({
    schemaVersion: 'sutura-case-lab-result-v1',
    requestId: inputs.requestId,
    caseId: item.id,
    mode: 'live',
    release,
    identity: { controllerSha: inputs.controllerSha, demoSha: inputs.demoSha },
    outcome,
    expectedOutcome,
    matchesExpectation: expectationMet(item.id, outcome, expectedOutcome, inputs.repairPaths),
    links: withoutEmpty(inputs.links),
    ...(inputs.repairPaths === undefined ? {} : { repairPaths: inputs.repairPaths }),
    ...(caseFile === undefined ? {} : { caseFile }),
    cost,
    ...(inputs.elapsedMs === undefined ? {} : { elapsedMs: inputs.elapsedMs }),
    createdAt: (inputs.now ?? (() => new Date()))().toISOString(),
  }, inputs.secrets ?? []);
}
