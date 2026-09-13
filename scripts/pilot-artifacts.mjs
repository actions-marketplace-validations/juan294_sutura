/**
 * Validators for the public artifacts a pilot depends on.
 *
 * Nothing here publishes, tags, deploys or contacts a registry. Each function
 * takes what a caller already observed and answers whether the artifacts
 * identify the same release, so the checks can be written and tested before
 * anything is published and reused unchanged afterwards.
 */
const EXACT_SEMVER = /^\d+\.\d+\.\d+$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/u;

export class PilotArtifactError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'PilotArtifactError';
    this.reasonCode = reasonCode;
  }
}

function refuse(reasonCode, message) {
  throw new PilotArtifactError(reasonCode, message);
}

/**
 * The published package must be the exact version the release claims, under
 * the exact name, from the registry that name belongs to.
 *
 * A package that resolves to a different name is a redirect: the bytes a user
 * installs then come from somewhere the release never named.
 */
export function validatePublishedPackage(input) {
  if (!EXACT_SEMVER.test(input.declaredVersion ?? '')) {
    refuse('invalid-version', 'The release declares an exact three-part version');
  }
  if (input.publishedName !== input.declaredName) {
    refuse('redirected-identity', `The registry serves ${String(input.publishedName)} for ${String(input.declaredName)}`);
  }
  if (!Array.isArray(input.publishedVersions) || input.publishedVersions.length === 0) {
    refuse('unpublished-package', `${input.declaredName} has no published version`);
  }
  if (!input.publishedVersions.includes(input.declaredVersion)) {
    refuse('version-mismatch', `${input.declaredVersion} is not published for ${input.declaredName}`);
  }
  if (input.tarballUrl !== undefined && !String(input.tarballUrl).startsWith(`https://registry.npmjs.org/${input.declaredName}/`)) {
    refuse('redirected-identity', 'The tarball does not come from the declared package path');
  }
  if (input.integrity !== undefined && !SHA512_INTEGRITY.test(input.integrity)) {
    refuse('invalid-integrity', 'The published tarball needs an exact sha512 integrity value');
  }
  return { name: input.declaredName, version: input.declaredVersion };
}

/**
 * The Action a workflow pins must be the exact commit the release names.
 *
 * A tag is not an identity: it can move. The pin is accepted only when it is a
 * 40-character commit and that commit is the one the release published.
 */
export function validateActionPin(input) {
  if (!COMMIT.test(input.declaredActionSha ?? '')) {
    refuse('invalid-action-sha', 'The release names the Action by an exact 40-character commit');
  }
  if (!COMMIT.test(input.pinnedActionSha ?? '')) {
    refuse('mutable-action-pin', `The workflow pins ${String(input.pinnedActionSha)}, which is not an immutable commit`);
  }
  if (input.pinnedActionSha !== input.declaredActionSha) {
    refuse('action-sha-mismatch', `The workflow pins ${input.pinnedActionSha}, the release published ${input.declaredActionSha}`);
  }
  if (input.resolvedTagSha !== undefined && input.resolvedTagSha !== input.declaredActionSha) {
    refuse('action-sha-mismatch', 'The release tag resolves to a different commit from the published Action');
  }
  return { actionSha: input.declaredActionSha };
}

/**
 * The demo repository pin must be the commit the pilot actually ran against.
 *
 * A stale pin makes the published evidence describe a demo state that no
 * longer exists, so it is refused rather than refreshed silently.
 */
export function validateDemoPin(input) {
  if (!COMMIT.test(input.pinnedDemoSha ?? '')) {
    refuse('invalid-demo-pin', 'The demo pin must be an exact 40-character commit');
  }
  if (!COMMIT.test(input.observedDemoSha ?? '')) {
    refuse('invalid-demo-pin', 'The observed demo commit must be exact');
  }
  if (input.pinnedDemoSha !== input.observedDemoSha) {
    refuse('stale-demo-pin', `The pin names ${input.pinnedDemoSha} and the demo is at ${input.observedDemoSha}`);
  }
  return { demoSha: input.pinnedDemoSha };
}

/** The eight public matrix cases a pilot must pass before trials may start. */
export const PUBLIC_MATRIX_SIZE = 8;

/**
 * A pilot is acceptable only when every matrix case reached a decided,
 * behaviour-preserving result.
 *
 * A failed or incomplete case blocks acceptance rather than being averaged
 * away, because a trial run against an artifact that could not pass its own
 * matrix would measure the wrong thing.
 */
export function validatePublicMatrix(cases) {
  if (!Array.isArray(cases) || cases.length !== PUBLIC_MATRIX_SIZE) {
    refuse('matrix-size', `The public matrix runs exactly ${PUBLIC_MATRIX_SIZE} cases`);
  }
  const seen = new Set();
  for (const item of cases) {
    if (!item?.caseId?.trim()) refuse('matrix-case', 'Each matrix case needs an id');
    if (seen.has(item.caseId)) refuse('duplicate-case', `${item.caseId} appears more than once`);
    seen.add(item.caseId);
    if (item.status !== 'passed') {
      refuse('matrix-incomplete', `${item.caseId} is ${String(item.status)}; a pilot needs every case passed`);
    }
    if (item.behaviourPreserved !== true) {
      refuse('behaviour-not-preserved', `${item.caseId} passed without preserving behaviour`);
    }
  }
  return { cases: cases.length };
}

/**
 * Validates a whole pilot's artifacts together.
 *
 * Readiness is false whenever any part is missing, and the reason is the first
 * refusal rather than a summary, so a caller is told what to fix.
 */
export function validatePilotArtifacts(input) {
  const pkg = validatePublishedPackage(input.package);
  const action = validateActionPin(input.action);
  const demo = validateDemoPin(input.demo);
  const matrix = validatePublicMatrix(input.matrix);
  return {
    ready: true,
    package: pkg,
    action,
    demo,
    matrix,
    /** Publication and outreach stay separate decisions; this asserts neither. */
    submissionReady: false,
  };
}
