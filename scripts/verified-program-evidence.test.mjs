import assert from 'node:assert/strict';
import test from 'node:test';

import {
  manifestMaximumUsd,
  REQUIRED_CAPS,
  RUN_EVIDENCE_SCHEMA,
  RUN_MANIFEST_SCHEMA,
  RunEvidenceError,
  validateRunEvidence,
  validateRunManifest,
} from './verified-program-evidence.mjs';

const SHA = 'a'.repeat(64);
const COMMIT = 'b'.repeat(40);

function manifest(overrides = {}) {
  return {
    schemaVersion: RUN_MANIFEST_SCHEMA,
    mode: 'live',
    identity: {
      candidateCommit: COMMIT,
      imageDigest: `sha256:${SHA}`,
      corpusHash: SHA,
      splitHash: 'c'.repeat(64),
      configHash: 'd'.repeat(64),
    },
    models: [{
      modelId: 'nemotron-super',
      inputPerMillionUsd: 0.5,
      outputPerMillionUsd: 1.5,
      priceAsOf: '2026-09-06',
    }],
    caps: {
      subjects: 2, repetitions: 1, modelTurnsPerSubject: 8, maxOutputTokens: 1_000,
      sandboxOperations: 20, elapsedTimeSec: 600, inferenceUsd: 1,
      rawSandboxUnits: 100, concurrency: 1,
    },
    stopPolicy: 'Stop on the first mandatory gate failure or on any cap.',
    subjects: ['case-a', 'case-b'],
    ...overrides,
  };
}

function result(subjectId, overrides = {}) {
  return {
    subjectId,
    modelId: 'nemotron-super',
    price: { inputPerMillionUsd: 0.5, outputPerMillionUsd: 1.5 },
    mode: 'live',
    disposition: 'terminal',
    identity: { ...manifest().identity },
    cost: { inferenceUsd: 0.01, rawSandboxUnits: 2, rawSandboxUnit: 'credits' },
    ...overrides,
  };
}

function evidence(overrides = {}) {
  const base = manifest(overrides.manifest);
  return {
    schemaVersion: RUN_EVIDENCE_SCHEMA,
    manifest: base,
    manifestHash: validateRunManifest(base).manifestHash,
    results: [result('case-a'), result('case-b')],
    ...overrides,
  };
}

function reasonOf(run) {
  try {
    run();
    return 'accepted';
  } catch (error) {
    assert.ok(error instanceof RunEvidenceError, `expected a RunEvidenceError, got ${error}`);
    return error.reasonCode;
  }
}

test('a manifest states every cap; none has a default', () => {
  const valid = validateRunManifest(manifest());

  assert.match(valid.manifestHash, /^[a-f0-9]{64}$/u);
  for (const cap of REQUIRED_CAPS) {
    const caps = { ...manifest().caps };
    delete caps[cap];
    assert.equal(reasonOf(() => validateRunManifest(manifest({ caps }))), 'unbounded-cap', cap);
  }
});

test('a manifest refuses a zero, negative or absent cap value', () => {
  for (const value of [0, -1, Number.POSITIVE_INFINITY, null]) {
    assert.equal(
      reasonOf(() => validateRunManifest(manifest({ caps: { ...manifest().caps, inferenceUsd: value } }))),
      'unbounded-cap',
    );
  }
});

test('a manifest needs exact identities, models with prices and a stop policy', () => {
  assert.equal(reasonOf(() => validateRunManifest(manifest({
    identity: { ...manifest().identity, candidateCommit: 'main' },
  }))), 'invalid-identity');
  assert.equal(reasonOf(() => validateRunManifest(manifest({
    identity: { ...manifest().identity, corpusHash: 'short' },
  }))), 'invalid-identity');
  assert.equal(reasonOf(() => validateRunManifest(manifest({ models: [] }))), 'missing-models');
  assert.equal(reasonOf(() => validateRunManifest(manifest({
    models: [{ modelId: 'm', inputPerMillionUsd: 0.5, outputPerMillionUsd: 1.5 }],
  }))), 'missing-price-date');
  assert.equal(reasonOf(() => validateRunManifest(manifest({ stopPolicy: '  ' }))), 'missing-stop-policy');
});

test('a manifest cannot list more subjects than it capped, or list one twice', () => {
  assert.equal(reasonOf(() => validateRunManifest(manifest({
    subjects: ['case-a', 'case-b', 'case-c'],
  }))), 'over-cap');
  assert.equal(reasonOf(() => validateRunManifest(manifest({
    subjects: ['case-a', 'case-a'],
  }))), 'duplicate-subject');
});

test('the priced maximum prices every permitted turn, not one per subject', () => {
  const base = manifest();
  const maximum = manifestMaximumUsd(base);

  // 2 subjects x 1 repetition x 8 turns at (0.5 + 1.5)/million x 1000 tokens.
  assert.ok(Math.abs(maximum - 0.032) < 1e-9, `unexpected ceiling ${maximum}`);
  // Allowing more turns per subject costs more; pricing one turn would not move.
  assert.ok(manifestMaximumUsd(manifest({
    caps: { ...base.caps, modelTurnsPerSubject: 16 },
  })) > maximum);
  // The spend cap is still the ceiling of the ceiling.
  assert.ok(manifestMaximumUsd(manifest({
    caps: { ...base.caps, subjects: 100, inferenceUsd: 1 },
  })) <= 1);
});

test('evidence that matches its manifest is accepted and totals its costs', () => {
  const summary = validateRunEvidence(evidence());

  assert.equal(summary.subjects, 2);
  assert.equal(summary.cancelled, 0);
  assert.ok(Math.abs(summary.inferenceUsd - 0.02) < 1e-9);
  assert.equal(summary.unconfirmedSandboxUnits, 0);
  assert.match(summary.evidenceHash, /^[a-f0-9]{64}$/u);
});

test('a changed candidate, corpus, split or config is refused', () => {
  for (const [field, value] of [
    ['candidateCommit', 'c'.repeat(40)],
    ['corpusHash', 'e'.repeat(64)],
    ['splitHash', 'f'.repeat(64)],
    ['configHash', '0'.repeat(64)],
    ['imageDigest', `sha256:${'1'.repeat(64)}`],
  ]) {
    assert.equal(reasonOf(() => validateRunEvidence(evidence({
      results: [result('case-a', { identity: { ...manifest().identity, [field]: value } }), result('case-b')],
    }))), 'identity-mismatch', field);
  }
});

test('a changed model or a changed price is refused', () => {
  assert.equal(reasonOf(() => validateRunEvidence(evidence({
    results: [result('case-a', { modelId: 'other-model' }), result('case-b')],
  }))), 'identity-mismatch');
  assert.equal(reasonOf(() => validateRunEvidence(evidence({
    results: [result('case-a', { price: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 1.5 } }), result('case-b')],
  }))), 'identity-mismatch');
});

test('a missing, duplicated or unauthorized result is refused', () => {
  assert.equal(reasonOf(() => validateRunEvidence(evidence({ results: [result('case-a')] }))),
    'missing-result');
  assert.equal(reasonOf(() => validateRunEvidence(evidence({
    results: [result('case-a'), result('case-a'), result('case-b')],
  }))), 'duplicate-result');
  assert.equal(reasonOf(() => validateRunEvidence(evidence({
    results: [result('case-a'), result('case-b'), result('case-z')],
  }))), 'unauthorized-expansion');
});

test('a recorded result cannot be presented as a live one', () => {
  assert.equal(reasonOf(() => validateRunEvidence(evidence({
    results: [result('case-a', { mode: 'recorded' }), result('case-b')],
  }))), 'relabeled-mode');
});

test('a result that never reached a terminal state is refused', () => {
  assert.equal(reasonOf(() => validateRunEvidence(evidence({
    results: [result('case-a', { disposition: 'running' }), result('case-b')],
  }))), 'non-terminal-result');
  // An explicit cancellation is evidence; it is counted and kept.
  assert.equal(validateRunEvidence(evidence({
    results: [result('case-a', { disposition: 'cancelled' }), result('case-b')],
  })).cancelled, 1);
});

test('an unknown or negative cost is never counted as zero', () => {
  assert.equal(reasonOf(() => validateRunEvidence(evidence({
    results: [result('case-a', { cost: { inferenceUsd: null, rawSandboxUnits: 1, rawSandboxUnit: 'credits' } }), result('case-b')],
  }))), 'unknown-cost');
  assert.equal(reasonOf(() => validateRunEvidence(evidence({
    results: [result('case-a', { cost: { inferenceUsd: -1, rawSandboxUnits: 1, rawSandboxUnit: 'credits' } }), result('case-b')],
  }))), 'negative-cost');
  assert.equal(reasonOf(() => validateRunEvidence(evidence({
    results: [result('case-a', { cost: { inferenceUsd: 0.01, rawSandboxUnits: 1 } }), result('case-b')],
  }))), 'unconfirmed-unit');
});

test('an unconfirmed sandbox amount is reported separately, not folded into a total', () => {
  const summary = validateRunEvidence(evidence({
    results: [
      result('case-a', { cost: { inferenceUsd: 0.01, rawSandboxUnits: null, rawSandboxUnit: null } }),
      result('case-b'),
    ],
  }));

  assert.equal(summary.unconfirmedSandboxUnits, 1);
  assert.ok(Math.abs(summary.inferenceUsd - 0.02) < 1e-9);
});

test('evidence recorded against a different manifest is refused', () => {
  assert.equal(reasonOf(() => validateRunEvidence(evidence({ manifestHash: 'a'.repeat(64) }))),
    'manifest-mismatch');
});

test('a run that spent past its own cap is refused', () => {
  assert.equal(reasonOf(() => validateRunEvidence(evidence({
    results: [
      result('case-a', { cost: { inferenceUsd: 0.9, rawSandboxUnits: 1, rawSandboxUnit: 'credits' } }),
      result('case-b', { cost: { inferenceUsd: 0.9, rawSandboxUnits: 1, rawSandboxUnit: 'credits' } }),
    ],
  }))), 'over-cap');
});
