import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { StudyExportError, validateStudyExport } from './study-export.mjs';

const COMMIT = 'a'.repeat(40);
const QUOTE = 'The refusal explained itself in one line.';

function exportDocument(overrides = {}) {
  return {
    schemaVersion: 'sutura-study-export-v1',
    releaseCommit: COMMIT,
    sourceCommit: 'b'.repeat(40),
    records: [{ participantId: 'participant-aaaaaaaa', outcome: 'completed' }],
    quotes: [{ participantId: 'participant-aaaaaaaa', text: QUOTE }],
    quoteConsents: [{
      participantId: 'participant-aaaaaaaa',
      quoteHash: createHash('sha256').update(QUOTE).digest('hex'),
    }],
    ...overrides,
  };
}

function reasonOf(run) {
  try {
    run();
    return 'accepted';
  } catch (error) {
    assert.ok(error instanceof StudyExportError, `expected a StudyExportError, got ${error}`);
    return error.reasonCode;
  }
}

test('a consented export validates and hashes itself', () => {
  const summary = validateStudyExport(exportDocument());

  assert.equal(summary.records, 1);
  assert.equal(summary.quotes, 1);
  assert.match(summary.exportHash, /^[a-f0-9]{64}$/u);
});

test('a credential anywhere in the export is refused', () => {
  for (const secret of [
    'ghp_abcdefghijklmnopqrstuvwxyz0123',
    'sk-abcdefghijklmnopqrstuvwx',
    'AKIAIOSFODNN7EXAMPLE',
    '-----BEGIN RSA PRIVATE KEY-----',
    'xoxb-1234567890-abcdefghij',
  ]) {
    assert.equal(reasonOf(() => validateStudyExport(exportDocument({
      records: [{ participantId: 'participant-aaaaaaaa', notes: secret }],
    }))), 'secret-in-export', secret.slice(0, 8));
  }
});

test('a private contact detail is refused wherever it appears', () => {
  for (const contact of [
    'reviewer@example.com',
    '+1 555 123 4567',
    'https://linkedin.com/in/someone',
  ]) {
    assert.equal(reasonOf(() => validateStudyExport(exportDocument({
      records: [{ participantId: 'participant-aaaaaaaa', contact }],
    }))), 'contact-in-export', contact);
  }
  // Nested inside an array of objects, not only at the top level.
  assert.equal(reasonOf(() => validateStudyExport(exportDocument({
    records: [{ participantId: 'participant-aaaaaaaa', notes: ['fine', { deep: 'a@b.co' }] }],
  }))), 'contact-in-export');
});

test('a quote nobody consented to, or a different quote, is refused', () => {
  assert.equal(reasonOf(() => validateStudyExport(exportDocument({ quoteConsents: [] }))),
    'unconsented-quote');
  assert.equal(reasonOf(() => validateStudyExport(exportDocument({
    quotes: [{ participantId: 'participant-aaaaaaaa', text: `${QUOTE} And another sentence.` }],
  }))), 'unconsented-quote');
  assert.equal(reasonOf(() => validateStudyExport(exportDocument({
    quotes: [{ participantId: 'participant-bbbbbbbb', text: QUOTE }],
  }))), 'unconsented-quote');
});

test('a broken release or source identity is refused', () => {
  assert.equal(reasonOf(() => validateStudyExport(exportDocument({ releaseCommit: 'v0.3.0' }))),
    'invalid-release-identity');
  assert.equal(reasonOf(() => validateStudyExport(exportDocument({ sourceCommit: 'main' }))),
    'invalid-source-identity');
  assert.equal(reasonOf(() => validateStudyExport({ ...exportDocument(), schemaVersion: 'other' })),
    'invalid-schema');
});

test('a real name in place of a participant id is refused', () => {
  assert.equal(reasonOf(() => validateStudyExport(exportDocument({
    records: [{ participantId: 'ada-lovelace', outcome: 'completed' }],
  }))), 'invalid-participant');
  assert.equal(reasonOf(() => validateStudyExport(exportDocument({
    records: [
      { participantId: 'participant-aaaaaaaa', outcome: 'completed' },
      { participantId: 'participant-aaaaaaaa', outcome: 'withdrawn' },
    ],
  }))), 'duplicate-record');
});
