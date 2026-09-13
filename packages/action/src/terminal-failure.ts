import {
  VERSION,
  redactExternalText,
  type ReplayBundle,
} from '@sutura/core';

export const TERMINAL_FAILURE_SCHEMA_VERSION = 'sutura-terminal-failure-v1';

export interface TerminalFailureContext {
  actionRunId: string;
  targetRunId: string;
  repository: string;
  actionSha: string;
  replay?: ReplayBundle;
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

function fixtureCommit(bundle: ReplayBundle | undefined): string | null {
  for (const call of bundle?.github ?? []) {
    if (call.method !== 'getWorkflowRun' || typeof call.result !== 'object' || call.result === null) continue;
    const headSha = (call.result as { headSha?: unknown }).headSha;
    if (typeof headSha === 'string' && /^[a-f0-9]{40}$/u.test(headSha)) return headSha;
  }
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

export function createTerminalFailureEvidence(
  error: unknown,
  context: TerminalFailureContext,
): Record<string, unknown> {
  const detail = error instanceof Error ? error.message : String(error);
  const errorClass = error instanceof Error ? error.name : 'UnknownError';
  const sandbox = sandboxEvidence(context.replay);
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
      fixtureCommit: fixtureCommit(context.replay),
    },
    packageIdentity: {
      name: 'sutura',
      version: VERSION,
      actionSha: /^[a-f0-9]{40}$/u.test(context.actionSha) ? context.actionSha : null,
    },
    actionRunId: boundedIdentifier(context.actionRunId, 'unknown'),
    operationIds: sandbox.operationIds,
    replayComplete: context.replay?.completeness.complete ?? false,
  };
}
