import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PilotArtifactError,
  PUBLIC_MATRIX_SIZE,
  validateActionPin,
  validateDemoPin,
  validatePilotArtifacts,
  validatePublicMatrix,
  validatePublishedPackage,
} from './pilot-artifacts.mjs';

const ACTION_SHA = 'a'.repeat(40);
const DEMO_SHA = 'b'.repeat(40);

const PACKAGE = {
  declaredName: 'sutura',
  declaredVersion: '0.3.0',
  publishedName: 'sutura',
  publishedVersions: ['0.2.1', '0.3.0'],
  tarballUrl: 'https://registry.npmjs.org/sutura/-/sutura-0.3.0.tgz',
  integrity: `sha512-${'A'.repeat(86)}==`,
};

const matrix = () => Array.from({ length: PUBLIC_MATRIX_SIZE }, (_unused, index) => ({
  caseId: `matrix-${index + 1}`, status: 'passed', behaviourPreserved: true,
}));

function reasonOf(run) {
  try {
    run();
    return 'accepted';
  } catch (error) {
    assert.ok(error instanceof PilotArtifactError, `expected a PilotArtifactError, got ${error}`);
    return error.reasonCode;
  }
}

test('a published package must be the exact declared version under its own name', () => {
  assert.deepEqual(validatePublishedPackage(PACKAGE), { name: 'sutura', version: '0.3.0' });
  assert.equal(reasonOf(() => validatePublishedPackage({ ...PACKAGE, declaredVersion: '0.3' })),
    'invalid-version');
  assert.equal(reasonOf(() => validatePublishedPackage({ ...PACKAGE, publishedVersions: ['0.2.1'] })),
    'version-mismatch');
  assert.equal(reasonOf(() => validatePublishedPackage({ ...PACKAGE, publishedVersions: [] })),
    'unpublished-package');
});

test('a redirected identity or a foreign tarball path is refused', () => {
  assert.equal(reasonOf(() => validatePublishedPackage({ ...PACKAGE, publishedName: 'sutura-cli' })),
    'redirected-identity');
  assert.equal(reasonOf(() => validatePublishedPackage({
    ...PACKAGE, tarballUrl: 'https://registry.npmjs.org/other/-/other-0.3.0.tgz',
  })), 'redirected-identity');
  assert.equal(reasonOf(() => validatePublishedPackage({ ...PACKAGE, integrity: 'sha1-short' })),
    'invalid-integrity');
});

test('the Action pin must be the exact published commit, never a tag', () => {
  assert.deepEqual(
    validateActionPin({ declaredActionSha: ACTION_SHA, pinnedActionSha: ACTION_SHA }),
    { actionSha: ACTION_SHA },
  );
  assert.equal(reasonOf(() => validateActionPin({
    declaredActionSha: ACTION_SHA, pinnedActionSha: 'v0.3.0',
  })), 'mutable-action-pin');
  assert.equal(reasonOf(() => validateActionPin({
    declaredActionSha: ACTION_SHA, pinnedActionSha: 'c'.repeat(40),
  })), 'action-sha-mismatch');
  assert.equal(reasonOf(() => validateActionPin({
    declaredActionSha: ACTION_SHA, pinnedActionSha: ACTION_SHA, resolvedTagSha: 'd'.repeat(40),
  })), 'action-sha-mismatch');
  assert.equal(reasonOf(() => validateActionPin({ declaredActionSha: 'main', pinnedActionSha: ACTION_SHA })),
    'invalid-action-sha');
});

test('a stale demo pin is refused rather than refreshed', () => {
  assert.deepEqual(
    validateDemoPin({ pinnedDemoSha: DEMO_SHA, observedDemoSha: DEMO_SHA }),
    { demoSha: DEMO_SHA },
  );
  assert.equal(reasonOf(() => validateDemoPin({ pinnedDemoSha: DEMO_SHA, observedDemoSha: 'e'.repeat(40) })),
    'stale-demo-pin');
  assert.equal(reasonOf(() => validateDemoPin({ pinnedDemoSha: 'main', observedDemoSha: DEMO_SHA })),
    'invalid-demo-pin');
});

test('a failed or incomplete matrix case blocks pilot acceptance', () => {
  assert.deepEqual(validatePublicMatrix(matrix()), { cases: PUBLIC_MATRIX_SIZE });
  const failed = matrix();
  failed[3].status = 'failed';
  assert.equal(reasonOf(() => validatePublicMatrix(failed)), 'matrix-incomplete');
  const incomplete = matrix();
  incomplete[5].status = 'not-run';
  assert.equal(reasonOf(() => validatePublicMatrix(incomplete)), 'matrix-incomplete');
  const unpreserved = matrix();
  unpreserved[1].behaviourPreserved = false;
  assert.equal(reasonOf(() => validatePublicMatrix(unpreserved)), 'behaviour-not-preserved');
  assert.equal(reasonOf(() => validatePublicMatrix(matrix().slice(0, 7))), 'matrix-size');
  const duplicated = matrix();
  duplicated[7].caseId = duplicated[0].caseId;
  assert.equal(reasonOf(() => validatePublicMatrix(duplicated)), 'duplicate-case');
});

test('a complete pilot validates and still does not claim submission readiness', () => {
  const report = validatePilotArtifacts({
    package: PACKAGE,
    action: { declaredActionSha: ACTION_SHA, pinnedActionSha: ACTION_SHA },
    demo: { pinnedDemoSha: DEMO_SHA, observedDemoSha: DEMO_SHA },
    matrix: matrix(),
  });

  assert.equal(report.ready, true);
  assert.equal(report.submissionReady, false);
  assert.equal(report.matrix.cases, PUBLIC_MATRIX_SIZE);
});

test('one broken part fails the whole pilot with that part as the reason', () => {
  assert.equal(reasonOf(() => validatePilotArtifacts({
    package: PACKAGE,
    action: { declaredActionSha: ACTION_SHA, pinnedActionSha: 'v0.3.0' },
    demo: { pinnedDemoSha: DEMO_SHA, observedDemoSha: DEMO_SHA },
    matrix: matrix(),
  })), 'mutable-action-pin');
});
