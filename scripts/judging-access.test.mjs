import assert from 'node:assert/strict';
import test from 'node:test';

import { checkArtifact, checkJudgingAccess, JudgingAccessError } from './judging-access.mjs';

const NOW = new Date('2026-12-10T00:00:00.000Z');
const PIN = 'a'.repeat(40);
const HASH = 'b'.repeat(64);

function reasonOf(run) {
  try {
    run();
    return 'accepted';
  } catch (error) {
    assert.ok(error instanceof JudgingAccessError, `expected a JudgingAccessError, got ${error}`);
    return error.reasonCode;
  }
}

test('HTTP success alone is not availability', () => {
  assert.deepEqual(
    checkArtifact({ name: 'case-lab', status: 200, expectedPin: PIN, servedPin: PIN }, NOW),
    { name: 'case-lab', available: true, reason: 'ok' },
  );
  assert.equal(
    checkArtifact({ name: 'case-lab', status: 200, expectedPin: PIN, servedPin: 'c'.repeat(40) }, NOW).reason,
    'wrong-pin',
  );
  assert.equal(
    checkArtifact({
      name: 'result', status: 200, expectedResultHash: HASH, servedResultHash: 'd'.repeat(64),
    }, NOW).reason,
    'stale-result',
  );
});

test('a private artifact is not an outage, and a quota is neither', () => {
  assert.equal(checkArtifact({ name: 'artifact', status: 403 }, NOW).reason, 'private-artifact');
  assert.equal(checkArtifact({ name: 'artifact', status: 401 }, NOW).reason, 'private-artifact');
  assert.equal(checkArtifact({ name: 'live', status: 429 }, NOW).reason, 'quota-exhausted');
  assert.equal(checkArtifact({ name: 'live', status: 503 }, NOW).reason, 'service-unavailable');
  assert.equal(checkArtifact({ name: 'page', status: 404 }, NOW).reason, 'not-found');
});

test('expired metadata is reported even when the page loads', () => {
  assert.equal(
    checkArtifact({ name: 'token', status: 200, expiresAt: '2026-12-01T00:00:00.000Z' }, NOW).reason,
    'expired-metadata',
  );
  assert.equal(
    checkArtifact({ name: 'token', status: 200, expiresAt: '2026-12-31T00:00:00.000Z' }, NOW).available,
    true,
  );
});

test('the checker never dispatches, whatever it is asked to check', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(reasonOf(() => checkArtifact({ name: 'live', status: 200, method }, NOW)),
      'implicit-dispatch', method);
  }
  assert.equal(checkArtifact({ name: 'live', status: 200, method: 'HEAD' }, NOW).available, true);
});

test('an unavailable live path falls back to a labelled recording', () => {
  const report = checkJudgingAccess({
    now: NOW,
    liveArtifactName: 'live-run',
    fallbackArtifactName: 'recorded-run',
    artifacts: [
      { name: 'live-run', status: 429 },
      { name: 'recorded-run', status: 200, expectedResultHash: HASH, servedResultHash: HASH },
    ],
  });

  assert.equal(report.servedPath, 'recorded-fallback');
  assert.equal(report.available, false);
  assert.deepEqual(report.unavailable, [{ name: 'live-run', reason: 'quota-exhausted' }]);
});

test('an unavailable live path with no usable fallback is refused, not smoothed over', () => {
  assert.equal(reasonOf(() => checkJudgingAccess({
    now: NOW,
    liveArtifactName: 'live-run',
    artifacts: [{ name: 'live-run', status: 503 }],
  })), 'missing-fallback');

  assert.equal(reasonOf(() => checkJudgingAccess({
    now: NOW,
    liveArtifactName: 'live-run',
    fallbackArtifactName: 'recorded-run',
    artifacts: [{ name: 'live-run', status: 503 }, { name: 'recorded-run', status: 404 }],
  })), 'no-usable-path');
});

test('the check cannot mint a scope nobody authorized', () => {
  assert.equal(reasonOf(() => checkJudgingAccess({
    now: NOW,
    authorizedScopes: ['public:read'],
    grantedScopes: ['public:read', 'repo:write'],
    artifacts: [{ name: 'page', status: 200 }],
  })), 'unauthorized-scope');

  assert.equal(checkJudgingAccess({
    now: NOW,
    authorizedScopes: ['public:read'],
    grantedScopes: ['public:read'],
    artifacts: [{ name: 'page', status: 200 }],
  }).available, true);
});

test('a check with no artifacts, an unnamed one or a malformed identity is refused', () => {
  assert.equal(reasonOf(() => checkJudgingAccess({ now: NOW, artifacts: [] })), 'no-artifacts');
  assert.equal(reasonOf(() => checkArtifact({ status: 200 }, NOW)), 'unnamed-artifact');
  assert.equal(reasonOf(() => checkArtifact({ name: 'x', status: 200, expectedPin: 'v1' }, NOW)),
    'invalid-pin');
  assert.equal(reasonOf(() => checkArtifact({
    name: 'x', status: 200, expectedResultHash: 'short',
  }, NOW)), 'invalid-result-hash');
  assert.equal(reasonOf(() => checkArtifact({ name: 'x', status: 200, expiresAt: 'soon' }, NOW)),
    'invalid-expiry');
});
