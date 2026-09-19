import {
  VERSION,
  redactExternalText,
  type ReplayBundle,
} from '@sutura/core';

export const TERMINAL_FAILURE_SCHEMA_VERSION = 'sutura-terminal-failure-v2';

export type ActionShaSource =
  | 'runner-action-ref'
  | 'runner-action-path'
  | 'self-repository'
  | 'unavailable';
const ACTION_SHA_PATTERN = /^[a-f0-9]{40}$/u;

export interface TerminalFailureContext {
  actionRunId: string;
  targetRunId: string;
  repository: string;
  actionSha: string;
  actionShaSource?: ActionShaSource;
  replay?: ReplayBundle;
}

export function resolveActionIdentity(
  environment: Readonly<Record<string, string | undefined>>,
): { sha: string | null; source: ActionShaSource } {
  const actionRef = environment.GITHUB_ACTION_REF;
  if (actionRef && ACTION_SHA_PATTERN.test(actionRef)) {
    return { sha: actionRef, source: 'runner-action-ref' };
  }
  const actionPath = environment.GITHUB_ACTION_PATH?.replace(/\/+$/u, '');
  const pathCommit = actionPath?.split('/').at(-1);
  if (environment.GITHUB_ACTION_REPOSITORY && pathCommit && ACTION_SHA_PATTERN.test(pathCommit)) {
    return { sha: pathCommit, source: 'runner-action-path' };
  }
  const workflowSha = environment.GITHUB_SHA;
  if (
    environment.GITHUB_REPOSITORY?.toLowerCase() === 'juan294/sutura' &&
    workflowSha && ACTION_SHA_PATTERN.test(workflowSha)
  ) {
    return { sha: workflowSha, source: 'self-repository' };
  }
  return { sha: null, source: 'unavailable' };
}

function boundedIdentifier(value: string, fallback: string): string {
  return /^[A-Za-z0-9._:/-]{1,160}$/u.test(value) ? value : fallback;
}

function publicErrorMessage(value: string): string {
  return redactExternalText(value).text
    .replace(/\/Users\/[^/\s]+\/[^\s]*/gu, '[redacted local path]')
    .replace(/[A-Z]:\\Users\\[^\\\s]+\\[^\s]*/giu, '[redacted local path]')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .slice(0, 1_000);
}

function workflowRunResult(bundle: ReplayBundle | undefined): Record<string, unknown> | undefined {
  for (const call of bundle?.github ?? []) {
    if (call.method !== 'getWorkflowRun' || typeof call.result !== 'object' || call.result === null) continue;
    return call.result as Record<string, unknown>;
  }
  return undefined;
}

function fixtureCommit(workflowRun: Record<string, unknown> | undefined): string | null {
  const headSha = workflowRun?.headSha;
  if (typeof headSha === 'string' && ACTION_SHA_PATTERN.test(headSha)) return headSha;
  return null;
}

function pullRequestNumber(workflowRun: Record<string, unknown> | undefined): number | null {
  const pullRequests = workflowRun?.pullRequests;
  if (!Array.isArray(pullRequests) || pullRequests.length !== 1) return null;
  const number = (pullRequests[0] as { number?: unknown } | undefined)?.number;
  if (Number.isSafeInteger(number) && (number as number) > 0) return number as number;
  return null;
}

function sandboxEvidence(bundle: ReplayBundle | undefined): {
  observedSandboxUsd: number | null;
  operationIds: string[];
} {
  let observed = 0;
  let hasObserved = false;
  const operationIds = new Set<string>();
  for (const call of bundle?.executor ?? []) {
    if (typeof call.result !== 'object' || call.result === null || 'error' in call.result) continue;
    const result = call.result as {
      metrics?: { cost?: unknown };
      operation?: { operationId?: unknown };
    };
    if (typeof result.metrics?.cost === 'number' && Number.isFinite(result.metrics.cost) && result.metrics.cost >= 0) {
      observed += result.metrics.cost;
      hasObserved = true;
    }
    const operationId = result.operation?.operationId;
    if (typeof operationId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(operationId)) {
      operationIds.add(operationId);
    }
  }
  return {
    observedSandboxUsd: hasObserved ? Number(observed.toFixed(6)) : null,
    operationIds: [...operationIds].sort(),
  };
}

function failureIdentity(error: unknown): {
  code: string;
  stage: string;
  class: string;
  details?: Record<string, number | string>;
} {
  const record = typeof error === 'object' && error !== null
    ? error as { code?: unknown; stage?: unknown; name?: unknown; details?: unknown }
    : {};
  const errorClass = typeof record.name === 'string' ? record.name : 'UnknownError';
  const fallbackCode = errorClass.replace(/([a-z])([A-Z])/gu, '$1-$2')
    .toLowerCase() || 'unknown-error';
  const fallbackStage = errorClass.startsWith('Nebius') ? 'provider'
    : errorClass.startsWith('Contree') ? 'sandbox'
      : errorClass.startsWith('GitHub') ? 'github'
        : errorClass.startsWith('Policy') ? 'policy'
          : errorClass.startsWith('RuntimeDetection') ? 'runtime-detection'
            : 'unknown';
  const details = typeof record.details === 'object' && record.details !== null && !Array.isArray(record.details)
    ? Object.fromEntries(Object.entries(record.details as Record<string, unknown>).flatMap(([key, value]) =>
        /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(key) &&
        ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'string')
          ? [[key, typeof value === 'string' ? publicErrorMessage(value).slice(0, 160) : value]]
          : []))
    : undefined;
  return {
    code: boundedIdentifier(typeof record.code === 'string' ? record.code : fallbackCode, 'unknown-error'),
    stage: boundedIdentifier(typeof record.stage === 'string' ? record.stage : fallbackStage, 'unknown'),
    class: boundedIdentifier(errorClass, 'UnknownError'),
    ...(details && Object.keys(details).length > 0 ? { details } : {}),
  };
}

function executionEvidence(
  bundle: ReplayBundle | undefined,
  operationIds: readonly string[],
): Record<string, unknown> {
  if (bundle === undefined) {
    return {
      claimState: 'not-observed',
      providerInvocations: null,
      sandboxOperations: null,
      searchStarted: null,
      terminalCommentState: 'not-recorded',
    };
  }
  const claimed = (bundle?.github ?? []).some(({ method, result }) =>
    ['createCheckRun', 'createIssueComment', 'createCommitComment'].includes(method) &&
    !(typeof result === 'object' && result !== null && 'error' in result));
  const terminalCommentUpdated = (bundle?.github ?? []).some(({ method, result }) =>
    ['updateIssueComment', 'updateCommitComment'].includes(method) &&
    !(typeof result === 'object' && result !== null && 'error' in result));
  return {
    claimState: claimed ? 'claimed' : 'not-observed',
    providerInvocations: bundle.http.filter(({ boundary }) => boundary === 'nebius').length,
    sandboxOperations: operationIds.length,
    searchStarted: operationIds.some((id) => id.startsWith('search-')) ? true : null,
    terminalCommentState: terminalCommentUpdated ? 'updated' : 'not-recorded',
  };
}

function runtimeDetectionEvidence(bundle: ReplayBundle | undefined): Record<string, unknown> | null {
  const observation = bundle?.runtimeDetection;
  if (observation === undefined) return null;
  return {
    runtime: observation.runtime,
    evidenceSource: observation.evidenceSource,
    evidenceCount: observation.evidencePaths.length,
    visitedEntries: observation.visitedEntries,
  };
}

export function createTerminalFailureEvidence(
  error: unknown,
  context: TerminalFailureContext,
): Record<string, unknown> {
  const detail = error instanceof Error ? error.message : String(error);
  const errorClass = error instanceof Error ? error.name : 'UnknownError';
  const sandbox = sandboxEvidence(context.replay);
  const workflowRun = workflowRunResult(context.replay);
  return {
    schemaVersion: TERMINAL_FAILURE_SCHEMA_VERSION,
    outcome: 'infra-stop',
    errorClass: boundedIdentifier(errorClass, 'UnknownError'),
    errorMessage: publicErrorMessage(detail),
    costStatus: 'unavailable',
    observedCosts: {
      inferenceUsd: null,
      sandboxUsd: sandbox.observedSandboxUsd,
    },
    fixtureIdentity: {
      repository: boundedIdentifier(context.repository, 'unknown/unknown'),
      targetRunId: boundedIdentifier(context.targetRunId, 'unknown'),
      fixtureCommit: fixtureCommit(workflowRun),
      pullRequestNumber: pullRequestNumber(workflowRun),
    },
    packageIdentity: {
      name: 'sutura',
      version: VERSION,
      actionSha: ACTION_SHA_PATTERN.test(context.actionSha) ? context.actionSha : null,
      actionShaSource: context.actionShaSource ?? 'unavailable',
    },
    actionRunId: boundedIdentifier(context.actionRunId, 'unknown'),
    operationIds: sandbox.operationIds,
    replayComplete: context.replay?.completeness.complete ?? false,
    execution: executionEvidence(context.replay, sandbox.operationIds),
    runtimeDetection: runtimeDetectionEvidence(context.replay),
    failure: failureIdentity(error),
  };
}
