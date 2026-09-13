import { describe, expect, it } from 'vitest';

import {
  capturedDogfoodReplayBundle,
  decodedRecordedBody,
} from '../__fixtures__/captured/live-dogfood-replay.test-helper.js';
import { DEFAULT_MODELS } from '../config.js';
import { SUPER_REPAIR_PROVIDER_CONTRACT_VERSION } from '../llm/provider-contract-canary.js';
import { DEFAULT_ROUTING_PROFILE_ID } from '../llm/router.js';
import { REPLAY_BUNDLE_SCHEMA_VERSION, type ReplayBundle } from './bundle.js';
import { createCompleteReplayBundleForTest } from './complete-bundle.test-helper.js';
import { ReplayMismatchError } from './replay-fetch.js';
import { replayBundle } from './replay-orchestrate.js';

const SHA = 'a'.repeat(40);

function baseBundle(): ReplayBundle {
  return {
    schemaVersion: REPLAY_BUNDLE_SCHEMA_VERSION,
    runId: '77',
    repo: 'acme/widget',
    actionSha: SHA,
    capturedAt: '2026-08-30T10:00:00.000Z',
    github: [],
    repository: [],
    executor: [],
    http: [],
    configuration: {
      triageN: 1,
      raceK: 1,
      models: DEFAULT_MODELS,
      routingProfileId: DEFAULT_ROUTING_PROFILE_ID,
      maxOps: 10,
    },
    completeness: {
      complete: false,
      overflowedBoundaries: [],
      pendingBoundaries: ['repository'],
    },
  };
}

function recordedReport(bundle: ReplayBundle): string {
  const report = bundle.github.findLast(({ method }) => method === 'updateCommitComment')?.args[1];
  if (typeof report !== 'string') throw new Error('Captured replay bundle lacks its final report');
  return report;
}

function recordedProviderRequestIncludes(bundle: ReplayBundle, expected: string): boolean {
  return bundle.http.some(({ boundary, request }) =>
    boundary === 'nebius' && decodedRecordedBody(request.body).includes(expected)
  );
}

function capturedSuperRequestBodies(bundle: ReplayBundle): Array<Record<string, unknown>> {
  return bundle.http.flatMap(({ boundary, request }) => {
    if (boundary !== 'nebius') return [];
    const body = JSON.parse(decodedRecordedBody(request.body)) as Record<string, unknown>;
    return body.model === DEFAULT_MODELS.super ? [body] : [];
  });
}

async function captureReplayMismatch(bundle: ReplayBundle): Promise<ReplayMismatchError> {
  try {
    await replayBundle(bundle);
  } catch (error) {
    if (error instanceof ReplayMismatchError) return error;
    throw error;
  }
  throw new Error('Current replay unexpectedly accepted a historical runtime contract');
}

describe('replayBundle', () => {
  it('rejects a partial bundle before constructing replay dependencies', async () => {
    await expect(replayBundle(baseBundle())).rejects.toThrow(
      'bundle is partial; complete provider, repository, and sandbox recordings are required',
    );
  });

  it('replays every recorded boundary through the real offline orchestration path', async () => {
    const bundle = await createCompleteReplayBundleForTest();

    const result = await replayBundle(bundle);

    expect(bundle.completeness.complete).toBe(true);
    expect(new Set(bundle.http.map(({ boundary }) => boundary)))
      .toEqual(new Set(['nebius', 'tavily', 'contree']));
    expect(result.caseFile.outcome).toBe('flaky-no-patch');
    expect(result.caseFile.outcome).toBe(bundle.outcome);
    expect(result.caseFile.diagnosis.grounding).toMatchObject({ skipped: false });
    expect(result.mutations.map(({ method }) => method)).toEqual([
      'createRef',
      'createCheckRun',
      'createCommitComment',
      'deleteRef',
      'updateCommitComment',
      'updateCheckRun',
    ]);
  });

  it('preserves live run 33321172589 while current replay fails closed on contract drift', async () => {
    const bundle = await capturedDogfoodReplayBundle();
    const report = recordedReport(bundle);
    const originalBundle = JSON.stringify(bundle);

    expect(bundle).toMatchObject({
      runId: '33321106629',
      outcome: 'gave-up',
    });
    expect(report.match(/^\| search-/gmu)).toHaveLength(7);
    expect(recordedProviderRequestIncludes(bundle, 'invalid: Repair proposal must be valid JSON'))
      .toBe(true);
    expect(SUPER_REPAIR_PROVIDER_CONTRACT_VERSION).toBe('sutura-super-repair-v5');
    expect(capturedSuperRequestBodies(bundle).map(({ chat_template_kwargs }) => chat_template_kwargs))
      .toEqual(Array.from({ length: 7 }, () => ({ enable_thinking: false })));

    const error = await captureReplayMismatch(bundle);
    expect(error.sequence).toBe(7);
    expect(error.path).toBe('$.method');
    expect(error.expected).toBe('runMany');
    expect(error.actual).toBe('run');
    expect(JSON.stringify(bundle)).toBe(originalBundle);
  });

  it('preserves live run 33323856253 while current replay fails closed on contract drift', async () => {
    const bundle = await capturedDogfoodReplayBundle('33323765566');
    const report = recordedReport(bundle);
    const originalBundle = JSON.stringify(bundle);

    expect(bundle).toMatchObject({
      runId: '33323765566',
      outcome: 'gave-up',
    });
    expect(report).toContain('Failing command: <code>pnpm -r test</code>');
    expect(recordedProviderRequestIncludes(
      bundle,
      'sandbox: Automatic trusted test did not produce valid evidence',
    )).toBe(true);
    expect(SUPER_REPAIR_PROVIDER_CONTRACT_VERSION).toBe('sutura-super-repair-v5');
    expect(capturedSuperRequestBodies(bundle).map(({ chat_template_kwargs }) => chat_template_kwargs))
      .toEqual(Array.from({ length: 6 }, () => ({ enable_thinking: false })));

    // Historical triage batches predate individually budgeted operations and identities.
    const error = await captureReplayMismatch(bundle);
    expect(error.sequence).toBe(7);
    expect(error.path).toBe('$.method');
    expect(error.expected).toBe('runMany');
    expect(error.actual).toBe('run');
    expect(JSON.stringify(bundle)).toBe(originalBundle);
  });

  it.each(['github', 'repository', 'executor', 'nebius', 'tavily'] as const)(
    'fails closed when a recorded %s tail is not consumed',
    async (boundary) => {
      const bundle = await createCompleteReplayBundleForTest();
      if (boundary === 'github' || boundary === 'repository') {
        const sequence = Math.max(
          ...bundle.github.map((call) => call.sequence),
          ...bundle.repository.map((call) => call.sequence),
        ) + 1;
        const calls = bundle[boundary];
        calls.push({ ...structuredClone(calls.at(-1)!), sequence } as never);
      } else if (boundary === 'executor') {
        const sequence = Math.max(...bundle.executor.map((call) => call.sequence)) + 1;
        bundle.executor.push({ ...structuredClone(bundle.executor.at(-1)!), sequence });
      } else {
        const sequence = Math.max(...bundle.http.map((exchange) => exchange.sequence)) + 1;
        const exchange = bundle.http.findLast((item) => item.boundary === boundary)!;
        bundle.http.push({ ...structuredClone(exchange), sequence });
      }

      await expect(replayBundle(bundle)).rejects.toBeInstanceOf(ReplayMismatchError);
    },
  );

  it('replays an executor stream whose concurrent calls were recorded in another order', async () => {
    const bundle = await createCompleteReplayBundleForTest();
    const first = bundle.executor[0]!;
    const second = bundle.executor[1]!;
    [first.sequence, second.sequence] = [second.sequence, first.sequence];

    await expect(replayBundle(bundle)).resolves.toMatchObject({
      caseFile: { outcome: bundle.outcome },
    });
  });

  it('fails closed when shared port boundaries are reordered', async () => {
    const bundle = await createCompleteReplayBundleForTest();
    const github = bundle.github[0]!;
    const repository = bundle.repository[0]!;
    [github.sequence, repository.sequence] = [repository.sequence, github.sequence];

    await expect(replayBundle(bundle)).rejects.toBeInstanceOf(ReplayMismatchError);
  });

  it('fails closed when shared provider HTTP boundaries are reordered', async () => {
    const bundle = await createCompleteReplayBundleForTest();
    const nebius = bundle.http.find((exchange) => exchange.boundary === 'nebius')!;
    const tavily = bundle.http.find((exchange) => exchange.boundary === 'tavily')!;
    [nebius.sequence, tavily.sequence] = [tavily.sequence, nebius.sequence];

    await expect(replayBundle(bundle)).rejects.toBeInstanceOf(ReplayMismatchError);
  });

  it('does not require diagnostic ConTree HTTP records to be consumed', async () => {
    const bundle = await createCompleteReplayBundleForTest();
    const sequence = Math.max(...bundle.http.map((exchange) => exchange.sequence)) + 1;
    const contree = bundle.http.findLast((exchange) => exchange.boundary === 'contree')!;
    bundle.http.push({ ...structuredClone(contree), sequence });

    await expect(replayBundle(bundle)).resolves.toMatchObject({
      caseFile: { outcome: bundle.outcome },
    });
  });
});

it('retains exact recorded operation identities and deadlines', async () => {
  for (const key of ['operationId', 'timeoutSec'] as const) {
    const bundle = await createCompleteReplayBundleForTest();
    const operation = bundle.executor.find(({ method, args }) => method === 'run' && typeof args[2] === 'object' && args[2] !== null && 'operationId' in args[2])!;
    expect(operation).toBeDefined();
    const options = operation.args[2] as Record<string, unknown>;
    options[key] = key === 'operationId' ? 'substituted-operation' : 999;
    await expect(replayBundle(bundle)).rejects.toBeInstanceOf(ReplayMismatchError);
  }
});
