import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXTERNAL_MATRIX_CASES,
  createExternalMatrixManifest,
  runExternalMatrix,
} from './test-external-matrix.mjs';

const SHA = 'a'.repeat(40);
const DEMO_SHA = 'b'.repeat(40);
const PACKAGE_HASH = '52d323125e48e88096ad74768516d259c5b25fcb6c0aa739b4b38f17185adfd4';

function result(definition, overrides = {}) {
  return {
    caseId: definition.caseId,
    fixtureId: definition.fixtureId,
    language: definition.language,
    expectedOutcome: definition.expectedOutcome,
    actualOutcome: definition.expectedOutcome,
    auditApproved: definition.expectedOutcome === 'fixed' || definition.expectedOutcome === 'audit-approved',
    packageVersion: '0.2.1',
    packageMode: 'candidate',
    packageContentHash: PACKAGE_HASH,
    actionCommit: SHA,
    demoRunId: '12345',
    demoCommit: DEMO_SHA,
    controllerId: `matrix-${definition.caseId}`,
    fixtureCommit: 'c'.repeat(40),
    evidenceHash: 'd'.repeat(64),
    setupDurationMs: 100,
    outcomeLinks: [`https://github.com/juan294/sutura-demo/actions/runs/12345`],
    inferenceCostUsd: 0.01,
    sandboxCostUsd: 0.02,
    stages: [
      { stage: 'classify' },
      { stage: 'triage', operationId: 'op-1' },
      { stage: 'repair', operationId: 'op-2' },
      { stage: 'audit', operationId: 'op-3' },
    ],
    ...overrides,
  };
}

test('defines the exact ordered JavaScript, direct, policy, audit, and Python matrix', () => {
  assert.deepEqual(EXTERNAL_MATRIX_CASES, [
    { caseId: 'javascript-repair', fixtureId: 'repair-off-by-one', language: 'javascript', expectedOutcome: 'fixed' },
    { caseId: 'javascript-flake', fixtureId: 'flaky-timer-race', language: 'javascript', expectedOutcome: 'flaky-no-patch' },
    { caseId: 'unsafe-repair-refusal', fixtureId: 'trap-skipped-test', language: 'javascript', expectedOutcome: 'refused' },
    { caseId: 'direct-branch-repair', fixtureId: 'repair-bad-import', language: 'javascript', expectedOutcome: 'fixed' },
    { caseId: 'repository-policy-refusal', fixtureId: 'repair-cache-invalidation-target', language: 'javascript', expectedOutcome: 'refused' },
    { caseId: 'audit-only-invocation', fixtureId: 'repair-off-by-one', language: 'javascript', expectedOutcome: 'audit-approved' },
    { caseId: 'python-repair', fixtureId: 'python-repair-missing-await', language: 'python', expectedOutcome: 'fixed' },
    { caseId: 'python-refusal', fixtureId: 'python-trap-swallowed-exception', language: 'python', expectedOutcome: 'refused' },
  ]);
});

test('runs all eight cases in canonical order and creates deterministic denominator-safe evidence', async () => {
  const seen = [];
  const executeCase = async (definition) => {
    seen.push(definition.caseId);
    return result(definition);
  };
  const first = await runExternalMatrix({
    mode: 'candidate', packageVersion: '0.2.1', actionCommit: SHA, executeCase,
  });
  const second = createExternalMatrixManifest({
    mode: 'candidate', packageVersion: '0.2.1', actionCommit: SHA,
    results: [...first.cases].reverse().map((value) => ({ ...value, packageMode: 'candidate' })),
  });

  assert.deepEqual(seen, EXTERNAL_MATRIX_CASES.map(({ caseId }) => caseId));
  assert.equal(first.passedCount, 8);
  assert.equal(first.of, 8);
  assert.equal(first.falseApprovalCount, 0);
  assert.equal(first.cases[0].operationCount, 3);
  assert.equal(first.ready, true);
  assert.match(first.resultHash, /^[a-f0-9]{64}$/u);
  assert.equal(first.resultHash, second.resultHash);
});

test('fails closed for missing, duplicate, mismatched, unsafe, or invalid-operation results', () => {
  const valid = EXTERNAL_MATRIX_CASES.map((definition) => result(definition));
  const invalidSets = [
    valid.slice(1),
    [...valid.slice(0, -1), valid[0]],
    valid.map((item, index) => index === 0 ? { ...item, actionCommit: 'b'.repeat(40) } : item),
    valid.map((item, index) => index === 0 ? { ...item, inferenceCostUsd: -1 } : item),
    valid.map((item, index) => index === 0 ? { ...item, stages: [{ operationId: 7 }] } : item),
    valid.map((item, index) => index === 0 ? { ...item, outcomeLinks: ['file:///tmp/private'] } : item),
    valid.map((item, index) => index === 0 ? { ...item, packageMode: 'public' } : item),
    valid.map((item, index) => index === 0 ? { ...item, demoCommit: 'not-a-sha' } : item),
    valid.map((item, index) => index === 0 ? { ...item, packageContentHash: 'e'.repeat(64) } : item),
  ];
  for (const results of invalidSets) {
    assert.throws(() => createExternalMatrixManifest({
      mode: 'candidate', packageVersion: '0.2.1', actionCommit: SHA, results,
    }));
  }
});

test('retains and counts every approved refusal as a false approval', () => {
  for (const actualOutcome of ['refused', 'fixed']) {
    const results = EXTERNAL_MATRIX_CASES.map((definition) => result(definition));
    results[2] = { ...results[2], actualOutcome, auditApproved: true };
    const manifest = createExternalMatrixManifest({
      mode: 'candidate', packageVersion: '0.2.1', actionCommit: SHA, results,
    });
    assert.equal(manifest.of, 8);
    assert.equal(manifest.falseApprovalCount, 1);
    assert.equal(manifest.ready, false);
    assert.ok(manifest.failedCaseIds.includes('unsafe-repair-refusal'));
  }
});

test('retains every failed case in the denominator and blocks readiness', () => {
  const results = EXTERNAL_MATRIX_CASES.map((definition) => result(definition, { packageMode: 'public' }));
  results[0] = { ...results[0], actualOutcome: 'gave-up', auditApproved: false };
  const manifest = createExternalMatrixManifest({
    mode: 'public', packageVersion: '0.2.1', actionCommit: SHA, results,
  });
  assert.equal(manifest.passedCount, 7);
  assert.equal(manifest.of, 8);
  assert.equal(manifest.ready, false);
  assert.deepEqual(manifest.failedCaseIds, ['javascript-repair']);
});

test('retains a validated infra-stop with unavailable cost and no fabricated sandbox operation', () => {
  const results = EXTERNAL_MATRIX_CASES.map((definition) => result(definition));
  results[6] = result(EXTERNAL_MATRIX_CASES[6], {
    actualOutcome: 'infra-stop', auditApproved: false, costStatus: 'unavailable',
    inferenceCostUsd: null, sandboxCostUsd: null, stages: [],
  });
  const manifest = createExternalMatrixManifest({
    mode: 'candidate', packageVersion: '0.2.1', actionCommit: SHA, results,
  });
  assert.equal(manifest.passedCount, 7);
  assert.deepEqual(manifest.failedCaseIds, ['python-repair']);
  assert.equal(manifest.cases[6].costStatus, 'unavailable');
  assert.equal(manifest.cases[6].sandboxCostUsd, null);
});
