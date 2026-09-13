import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  collectFleetMetrics,
  parseCaseFileHtml,
  parseTerminalFailureJson,
  publicFleetSummary,
  writeFleetMetrics,
} from './fleet-dogfood-metrics.mjs';

const FIXED_HTML = `<!doctype html><body class="outcome-fixed">
  <div><span>Inference cost</span><strong>$0.125000</strong></div>
  <p>12 operations · 45.500 s elapsed · 40.000 s CPU · 100 KB peak RSS · $0.375000 sandbox cost</p>
</body>`;

test('case-file parser extracts the terminal outcome, costs, operations, and elapsed time', () => {
  assert.deepEqual(parseCaseFileHtml(FIXED_HTML), {
    outcome: 'fixed',
    inferenceCostUsd: 0.125,
    sandboxCostUsd: 0.375,
    sandboxOperations: 12,
    sandboxElapsedTimeSec: 45.5,
  });
  assert.throws(() => parseCaseFileHtml('<body>missing evidence</body>'), /outcome/u);
});

test('terminal failure parser preserves an infrastructure stop without inventing cost', () => {
  assert.deepEqual(parseTerminalFailureJson(JSON.stringify({
    schemaVersion: 'sutura-terminal-failure-v1',
    outcome: 'infra-stop',
    errorMessage: 'Repository snapshot exceeded its bounded source size',
  })), {
    outcome: 'infra-stop',
    costStatus: 'unavailable',
    evidenceError: 'Repository snapshot exceeded its bounded source size',
  });
  assert.throws(() => parseTerminalFailureJson('{}'), /schema or outcome/u);
});

test('collector keeps every monitor run and distinguishes skipped CI from repair attempts', async () => {
  const client = {
    async listWorkflowRuns(repository) {
      if (repository === 'missing') {
        const error = new Error('not found');
        error.status = 404;
        throw error;
      }
      return [
        { id: 9, conclusion: 'skipped', display_title: 'Repair not triggered: CI #8 (cancelled) on develop', run_started_at: '2026-09-13T07:00:00Z', updated_at: '2026-09-13T07:00:05Z', html_url: 'https://example.test/9' },
        { id: 10, conclusion: 'skipped', display_title: 'No repair needed: CI #9 (success) on develop', run_started_at: '2026-09-13T08:00:00Z', updated_at: '2026-09-13T08:00:05Z', html_url: 'https://example.test/10' },
        { id: 11, conclusion: 'success', run_started_at: '2026-09-13T09:00:00Z', updated_at: '2026-09-13T09:02:00Z', html_url: 'https://example.test/11' },
        { id: 12, conclusion: 'failure', run_started_at: '2026-09-13T10:00:00Z', updated_at: '2026-09-13T10:01:00Z', html_url: 'https://example.test/12' },
      ];
    },
    async listArtifacts(_repository, runId) {
      if (runId === 11) return [{ id: 100, name: 'sutura-case-file-99.html', expired: false }];
      if (runId === 12) return [{ id: 101, name: 'sutura-terminal-failure-12.json', expired: false }];
      return [];
    },
    async downloadArtifact(_repository, _runId, artifact) {
      return artifact.name.endsWith('.html') ? FIXED_HTML : JSON.stringify({
        schemaVersion: 'sutura-terminal-failure-v1',
        outcome: 'infra-stop',
        errorMessage: 'bounded infrastructure stop',
      });
    },
  };
  const result = await collectFleetMetrics({
    schemaVersion: 'sutura-fleet-config-v1',
    owner: 'juan294',
    repositories: ['alpha', 'missing'],
    startedAt: '2026-09-13T00:00:00.000Z',
    actionCommit: 'a'.repeat(40),
  }, client, new Date('2026-09-13T12:00:00.000Z'));

  assert.equal(result.summary.fleetRepositories, 2);
  assert.equal(result.summary.installedRepositories, 1);
  assert.equal(result.summary.monitorRuns, 4);
  assert.equal(result.summary.noRepairNeeded, 1);
  assert.equal(result.summary.notTriggered, 1);
  assert.equal(result.summary.repairAttempts, 2);
  assert.equal(result.summary.outcomes.fixed, 1);
  assert.equal(result.summary.outcomes['infra-stop'], 1);
  assert.equal(result.summary.outcomes.unknown, 0);
  assert.equal(result.summary.repairPrsOpened, 1);
  assert.equal(result.summary.totalCostUsd, 0.5);
  assert.equal(result.summary.medianAttemptDurationSec, 90);
  assert.equal(result.events.length, 4);
});

test('public summary removes repository identities and daily snapshots are idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-fleet-metrics-'));
  try {
    const result = {
      summary: {
        schemaVersion: 'sutura-fleet-summary-v1', collectedAt: '2026-09-13T12:00:00.000Z',
        startedAt: '2026-09-13T00:00:00.000Z', actionCommit: 'a'.repeat(40), fleetRepositories: 1,
        installedRepositories: 1, monitorRuns: 1, noRepairNeeded: 0, notTriggered: 0, repairAttempts: 1,
        outcomes: { fixed: 1, 'flaky-no-patch': 0, refused: 0, 'gave-up': 0, 'infra-stop': 0, unknown: 0 },
        repairPrsOpened: 1, inferenceCostUsd: 0.1, sandboxCostUsd: 0.2, totalCostUsd: 0.3,
        medianAttemptDurationSec: 60,
      },
      events: [{ repository: 'private-project', runId: 1 }],
      installations: [{ repository: 'private-project', installed: true }],
    };
    const publicValue = publicFleetSummary(result.summary);
    assert.equal(JSON.stringify(publicValue).includes('private-project'), false);
    await writeFleetMetrics(result, directory);
    await writeFleetMetrics(result, directory);
    const snapshots = (await readFile(join(directory, 'snapshots.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(snapshots.length, 1);
    assert.equal((await readFile(join(directory, 'events.jsonl'), 'utf8')).includes('private-project'), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
