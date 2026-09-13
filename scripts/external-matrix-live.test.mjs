import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendExternalMatrixLedger,
  cleanupExternalMatrixLive,
  createExternalMatrixCaseArtifact,
  createExternalMatrixLedger,
  dispatchExternalMatrixWorkflow,
  finalizeExternalMatrixLive,
  main,
  runExternalMatrixStreak,
  runSingleExternalMatrixCase,
  validateExternalMatrixCaseArtifact,
  validateExternalMatrixLedger,
} from './external-matrix-live.mjs';
import { EXTERNAL_MATRIX_CASES } from './test-external-matrix.mjs';

const ACTION_SHA = 'a943ded4c734aed75c5c63f2b2dd63a2f44556c2';
const CONTROLLER_SHA = 'a'.repeat(40);
const DEMO_SHA = 'b'.repeat(40);
const PACKAGE_HASH = '52d323125e48e88096ad74768516d259c5b25fcb6c0aa739b4b38f17185adfd4';

function artifact(definition, mode = 'candidate', overrides = {}) {
  const runId = String(20_000 + EXTERNAL_MATRIX_CASES.indexOf(definition));
  const base = {
    schemaVersion: 'sutura-external-matrix-case-v1',
    caseId: definition.caseId,
    fixtureId: definition.fixtureId,
    language: definition.language,
    expectedOutcome: definition.expectedOutcome,
    actualOutcome: definition.expectedOutcome,
    auditApproved: ['fixed', 'audit-approved'].includes(definition.expectedOutcome),
    packageVersion: '0.2.1',
    packageMode: mode,
    packageContentHash: PACKAGE_HASH,
    actionCommit: ACTION_SHA,
    demoRunId: runId,
    demoCommit: DEMO_SHA,
    controllerId: `matrix-${definition.caseId}`,
    fixtureCommit: 'c'.repeat(40),
    evidenceHash: 'd'.repeat(64),
    setupDurationMs: 100,
    outcomeLinks: [`https://github.com/juan294/sutura-demo/actions/runs/${runId}`],
    inferenceCostUsd: 0.01,
    sandboxCostUsd: 0.02,
    stages: [{ stage: 'triage', operationId: 'op-1' }],
    ...overrides,
  };
  return { ...base, resultHash: 'placeholder' };
}

function normalizedArtifact(definition, mode = 'candidate', overrides = {}) {
  const value = artifact(definition, mode, overrides);
  return createExternalMatrixCaseArtifact(value, { mode, actionSha: ACTION_SHA });
}

function append(ledger, value, index) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  return appendExternalMatrixLedger(ledger, value, {
    artifactBytes: bytes,
    runUrl: `https://github.com/juan294/sutura-demo/actions/runs/${value.demoRunId}`,
    controllerSha: CONTROLLER_SHA,
    recordedAt: new Date(Date.parse('2026-08-31T12:00:00.000Z') + index).toISOString(),
  }, { mode: value.packageMode, actionSha: ACTION_SHA });
}

test('case artifacts require live identities and deterministic hashes', () => {
  const value = normalizedArtifact(EXTERNAL_MATRIX_CASES[0]);
  assert.match(value.resultHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(validateExternalMatrixCaseArtifact(value, {
    mode: 'candidate', actionSha: ACTION_SHA,
  }), value);
  assert.throws(() => validateExternalMatrixCaseArtifact({ ...value, packageMode: 'public' }, {
    mode: 'candidate', actionSha: ACTION_SHA,
  }), /mode|resultHash/u);
});

test('mode-specific ledger resumes and rejects duplicates or identity drift', () => {
  const first = normalizedArtifact(EXTERNAL_MATRIX_CASES[0]);
  const second = normalizedArtifact(EXTERNAL_MATRIX_CASES[1]);
  const once = append(createExternalMatrixLedger('candidate', []), first, 1);
  const twice = append(once, second, 2);
  assert.deepEqual(validateExternalMatrixLedger(twice), twice);
  assert.throws(() => append(twice, first, 3), /duplicate/u);
  assert.throws(() => validateExternalMatrixLedger({ ...twice, mode: 'public' }), /resultHash|mode/u);
});

test('cleanup closes and deletes only recorded controller-owned resources', async () => {
  const definition = EXTERNAL_MATRIX_CASES[0];
  const value = normalizedArtifact(definition, 'candidate', {
    controllerId: 'matrix-cleanup-1',
    cleanupBranch: `matrix/matrix-cleanup-1/${definition.caseId}`,
    cleanupPullRequests: [
      'https://github.com/juan294/sutura-demo/pull/71',
      'https://github.com/juan294/sutura-demo/pull/72',
    ],
  });
  const ledger = append(createExternalMatrixLedger('candidate', []), value, 1);
  const closed = [];
  const deleted = [];
  const result = await cleanupExternalMatrixLive(ledger, {
    readPullRequest: async (url) => ({
      state: 'OPEN',
      headRefName: url.endsWith('/72') ? `sutura/fix-${value.demoRunId}` : value.cleanupBranch,
    }),
    closePullRequest: async (url) => { closed.push(url); },
    branchExists: async () => true,
    deleteBranch: async (branch) => { deleted.push(branch); },
  });
  assert.deepEqual(result.closedPullRequests, closed);
  assert.deepEqual(result.deletedBranches, deleted);
  assert.deepEqual(deleted, [
    value.cleanupBranch,
    `sutura/fix-${value.demoRunId}`,
  ].sort());
  assert.throws(() => createExternalMatrixCaseArtifact({
    ...artifact(definition), cleanupBranch: 'main',
  }, { mode: 'candidate', actionSha: ACTION_SHA }), /controller-owned/u);
});

test('streak resumes, enforces reserve, and stops on false approval', async () => {
  let ledger = createExternalMatrixLedger('candidate', []);
  const seen = [];
  const completed = await runExternalMatrixStreak({
    mode: 'candidate', controllerSha: CONTROLLER_SHA, actionSha: ACTION_SHA,
    authorize: true, capUsd: 1, initialReserveUsd: 0.1,
  }, {
    readLedger: async () => ledger,
    runCase: async (definition) => {
      seen.push(definition.caseId);
      const value = normalizedArtifact(definition, 'candidate', definition.caseId === 'unsafe-repair-refusal'
        ? { actualOutcome: 'fixed', auditApproved: true } : {});
      ledger = append(ledger, value, seen.length);
      return { artifact: value, ledger };
    },
  });
  assert.deepEqual(seen, ['javascript-repair', 'javascript-flake', 'unsafe-repair-refusal']);
  assert.equal(completed.stoppedFor, 'false-approval');
});

test('streak resumes after a subset and stops before dispatch when reserve reaches the cap', async () => {
  let ledger = createExternalMatrixLedger('public', []);
  for (let index = 0; index < 2; index += 1) {
    ledger = append(ledger, normalizedArtifact(EXTERNAL_MATRIX_CASES[index], 'public'), index);
  }
  let dispatches = 0;
  const completed = await runExternalMatrixStreak({
    mode: 'public', controllerSha: CONTROLLER_SHA, actionSha: ACTION_SHA,
    authorize: true, capUsd: 0.159, initialReserveUsd: 0.1,
  }, {
    readLedger: async () => ledger,
    runCase: async () => { dispatches += 1; throw new Error('must not dispatch'); },
  });
  assert.equal(dispatches, 0);
  assert.equal(completed.ledger.entries.length, 2);
  assert.equal(completed.stoppedFor, 'cap-reserve');
});

test('streak retains one infra-stop with unavailable cost and stops without calling it zero spend', async () => {
  let ledger = createExternalMatrixLedger('candidate', []);
  const completed = await runExternalMatrixStreak({
    mode: 'candidate', controllerSha: CONTROLLER_SHA, actionSha: ACTION_SHA,
    authorize: true, capUsd: 1, initialReserveUsd: 0.1,
  }, {
    readLedger: async () => ledger,
    runCase: async (definition) => {
      const value = normalizedArtifact(definition, 'candidate', {
        actualOutcome: 'infra-stop', auditApproved: false, costStatus: 'unavailable',
        inferenceCostUsd: null, sandboxCostUsd: null, stages: [],
      });
      ledger = append(ledger, value, 1);
      return { artifact: value, ledger };
    },
  });
  assert.equal(completed.stoppedFor, 'infra-stop');
  assert.equal(completed.spentUsd, 0);
  assert.equal(completed.ledger.entries[0].costStatus, 'unavailable');
  assert.equal(completed.ledger.entries[0].totalUsd, null);
});

test('single run rejects missing or excessive reserve before entering the live path', async () => {
  const base = [
    'run', '--mode', 'candidate', '--controller-sha', CONTROLLER_SHA,
    '--action-sha', ACTION_SHA, '--demo-sha', DEMO_SHA,
    '--case', EXTERNAL_MATRIX_CASES[0].caseId, '--authorize',
  ];
  await assert.rejects(() => main(base), /--cap-usd requires a value/u);
  await assert.rejects(
    () => main([...base, '--cap-usd', '0.25', '--initial-reserve-usd', '0.30']),
    /reserve must not exceed cap/u,
  );
});

test('single run gates before reading the ledger and refuses cap-reserve before dispatch', async () => {
  const existing = append(
    createExternalMatrixLedger('candidate', []),
    normalizedArtifact(EXTERNAL_MATRIX_CASES[0]),
    1,
  );
  const events = [];
  await assert.rejects(() => runSingleExternalMatrixCase({
    mode: 'candidate', controllerSha: CONTROLLER_SHA, actionSha: ACTION_SHA,
    demoSha: DEMO_SHA, definition: EXTERNAL_MATRIX_CASES[1],
    capUsd: 0.05, initialReserveUsd: 0.03,
  }, {
    gate: async () => { events.push('gate'); },
    readLedger: async () => { events.push('ledger'); return existing; },
    runCase: async () => { events.push('dispatch'); },
  }), /cap-reserve/u);
  assert.deepEqual(events, ['gate', 'ledger']);
});

test('single run refuses a duplicate case before dispatch', async () => {
  const definition = EXTERNAL_MATRIX_CASES[0];
  const existing = append(
    createExternalMatrixLedger('candidate', []), normalizedArtifact(definition), 1,
  );
  let dispatched = false;
  await assert.rejects(() => runSingleExternalMatrixCase({
    mode: 'candidate', controllerSha: CONTROLLER_SHA, actionSha: ACTION_SHA,
    demoSha: DEMO_SHA, definition, capUsd: 1, initialReserveUsd: 0.1,
  }, {
    gate: async () => {},
    readLedger: async () => existing,
    runCase: async () => { dispatched = true; },
  }), /duplicate case/u);
  assert.equal(dispatched, false);
});

test('single run refuses an existing false approval before dispatch', async () => {
  const existing = append(
    createExternalMatrixLedger('candidate', []),
    normalizedArtifact(EXTERNAL_MATRIX_CASES[2], 'candidate', {
      actualOutcome: 'fixed', auditApproved: true,
    }),
    1,
  );
  let dispatched = false;
  await assert.rejects(() => runSingleExternalMatrixCase({
    mode: 'candidate', controllerSha: CONTROLLER_SHA, actionSha: ACTION_SHA,
    demoSha: DEMO_SHA, definition: EXTERNAL_MATRIX_CASES[0],
    capUsd: 10, initialReserveUsd: 0.5,
  }, {
    gate: async () => {},
    readLedger: async () => existing,
    runCase: async () => { dispatched = true; },
  }), /false-approval ledger/u);
  assert.equal(dispatched, false);
});

test('workflow dispatch checks the active freeze at the final dispatch edge', async () => {
  const events = [];
  await dispatchExternalMatrixWorkflow({
    mode: 'candidate', actionSha: ACTION_SHA, demoSha: DEMO_SHA,
    definition: EXTERNAL_MATRIX_CASES[0], controllerId: 'mx-test-controller',
  }, {
    requireActivePushFreeze: () => { events.push('freeze'); },
    command: async (name, args) => { events.push(`${name}:${args.slice(0, 2).join(' ')}`); },
  });
  assert.deepEqual(events, ['freeze', 'gh:workflow run']);

  let dispatched = false;
  await assert.rejects(() => dispatchExternalMatrixWorkflow({
    mode: 'candidate', actionSha: ACTION_SHA, demoSha: DEMO_SHA,
    definition: EXTERNAL_MATRIX_CASES[0], controllerId: 'mx-test-controller',
  }, {
    requireActivePushFreeze: () => { throw new Error('freeze missing'); },
    command: async () => { dispatched = true; },
  }), /freeze missing/u);
  assert.equal(dispatched, false);
});

test('streak rechecks the freeze before each eligible case', async () => {
  let ledger = createExternalMatrixLedger('candidate', []);
  let checks = 0;
  let dispatches = 0;
  await assert.rejects(() => runExternalMatrixStreak({
    mode: 'candidate', controllerSha: CONTROLLER_SHA, actionSha: ACTION_SHA,
    authorize: true, capUsd: 1, initialReserveUsd: 0.1,
  }, {
    readLedger: async () => ledger,
    runCase: async (definition) => {
      await dispatchExternalMatrixWorkflow({
        mode: 'candidate', actionSha: ACTION_SHA, demoSha: DEMO_SHA,
        definition, controllerId: `mx-streak-${definition.caseId}`,
      }, {
        requireActivePushFreeze: () => {
          checks += 1;
          if (checks === 2) throw new Error('freeze ended');
        },
        command: async () => { dispatches += 1; },
      });
      const value = normalizedArtifact(definition);
      ledger = append(ledger, value, dispatches);
      return { artifact: value, ledger };
    },
  }), /freeze ended/u);
  assert.equal(checks, 2);
  assert.equal(dispatches, 1);
});

test('candidate and public finalization keep all eight cases and call the authoritative analyzer', () => {
  for (const selectedMode of ['candidate', 'public']) {
    const artifacts = EXTERNAL_MATRIX_CASES.map((definition) => normalizedArtifact(definition, selectedMode));
    let ledger = createExternalMatrixLedger(selectedMode, []);
    artifacts.forEach((value, index) => { ledger = append(ledger, value, index); });
    const manifest = finalizeExternalMatrixLive(ledger, artifacts, {
      mode: selectedMode, actionSha: ACTION_SHA,
    });
    assert.equal(manifest.passedCount, 8);
    assert.equal(manifest.of, 8);
    assert.equal(manifest.falseApprovalCount, 0);
    assert.equal(manifest.ready, true);
    assert.throws(() => finalizeExternalMatrixLive(
      createExternalMatrixLedger(selectedMode, ledger.entries.slice(1)), artifacts.slice(1), {
        mode: selectedMode, actionSha: ACTION_SHA,
      },
    ), /eight cases/u);
  }
});
