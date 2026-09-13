import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ATTEMPT_LEDGER_SCHEMA,
  COMPREHENSION_TARGET_MS,
  PAIRED_SESSION_SCHEMA,
  REVIEW_SESSION_SCHEMA,
  ReviewStudyError,
  scoreReviewSessions,
  validateAttemptLedger,
  validatePairedSessions,
} from './review-study.mjs';

const P = (n) => `participant-${String(n).repeat(8)}`;

function attempt(overrides = {}) {
  return {
    schemaVersion: ATTEMPT_LEDGER_SCHEMA,
    participantId: P('a'),
    consent: true,
    outcome: 'completed',
    taskId: 'install-unfamiliar-repo',
    ...overrides,
  };
}

function session(overrides = {}) {
  return {
    schemaVersion: REVIEW_SESSION_SCHEMA,
    participantId: P('a'),
    taskId: 'valid-repair-1',
    taskKind: 'valid-repair',
    answer: 'Accept: the repair restores the ceiling and the checks agree.',
    hintsGiven: 0,
    unaided: true,
    elapsedMs: 30_000,
    correct: true,
    ...overrides,
  };
}

function paired(overrides = {}) {
  return {
    schemaVersion: PAIRED_SESSION_SCHEMA,
    participantId: P('a'),
    condition: 'ordinary-ci',
    decision: 'refuse',
    defectId: 'off-by-one',
    order: 1,
    suturaVerdictShown: false,
    correct: true,
    elapsedMs: 45_000,
    ...overrides,
  };
}

/** Both conditions for one participant, on two different defects. */
function pair(id, firstCondition, overrides = {}) {
  const second = firstCondition === 'ordinary-ci' ? 'sutura-evidence' : 'ordinary-ci';
  return [
    paired({ participantId: id, condition: firstCondition, order: 1, defectId: 'off-by-one', ...overrides }),
    paired({
      participantId: id, condition: second, order: 2, defectId: 'null-guard',
      suturaVerdictShown: second === 'sutura-evidence', ...overrides,
    }),
  ];
}

function reasonOf(run) {
  try {
    run();
    return 'accepted';
  } catch (error) {
    assert.ok(error instanceof ReviewStudyError, `expected a ReviewStudyError, got ${error}`);
    return error.reasonCode;
  }
}

test('attempt ledger keeps every invited person', () => {
  const summary = validateAttemptLedger([
    attempt({ participantId: P('a'), outcome: 'completed' }),
    attempt({ participantId: P('b'), outcome: 'withdrawn' }),
    attempt({ participantId: P('c'), outcome: 'failed' }),
    attempt({ participantId: P('d'), outcome: 'invited', consent: false }),
  ]);

  assert.equal(summary.attempts, 4);
  assert.equal(summary.counts.completed, 1);
  assert.equal(summary.counts.withdrawn, 1);
  assert.equal(summary.counts.failed, 1);
  assert.match(summary.ledgerHash, /^[a-f0-9]{64}$/u);
});

test('attempt ledger refuses a duplicate participant', () => {
  assert.equal(
    reasonOf(() => validateAttemptLedger([attempt(), attempt()])),
    'duplicate-participant',
  );
});

test('attempt ledger refuses a missing consent decision', () => {
  assert.equal(
    reasonOf(() => validateAttemptLedger([attempt({ consent: undefined })])),
    'missing-consent',
  );
});

test('attempt ledger refuses progress without consent', () => {
  assert.equal(
    reasonOf(() => validateAttemptLedger([attempt({ consent: false, outcome: 'completed' })])),
    'consent-required',
  );
});

test('attempt ledger refuses an unknown outcome and an empty ledger', () => {
  assert.equal(reasonOf(() => validateAttemptLedger([attempt({ outcome: 'great' })])), 'unknown-outcome');
  assert.equal(reasonOf(() => validateAttemptLedger([])), 'empty-ledger');
});

test('ledger hash changes when a failed attempt is dropped', () => {
  const full = validateAttemptLedger([
    attempt({ participantId: P('a') }),
    attempt({ participantId: P('b'), outcome: 'failed' }),
  ]);
  const trimmed = validateAttemptLedger([attempt({ participantId: P('a') })]);

  assert.notEqual(trimmed.ledgerHash, full.ledgerHash);
  assert.equal(trimmed.attempts, 1);
});

test('review scoring counts only answers given before any hint', () => {
  const score = scoreReviewSessions([
    session({ participantId: P('a'), unaided: true, hintsGiven: 0, correct: true }),
    session({ participantId: P('b'), unaided: false, hintsGiven: 2, correct: true }),
  ]);

  assert.equal(score.unaided, 1);
  assert.equal(score.assisted, 1);
  assert.equal(score.correctUnaided, 1);
});

test('review scoring refuses an assisted answer labelled unaided', () => {
  assert.equal(
    reasonOf(() => scoreReviewSessions([session({ hintsGiven: 1, unaided: true })])),
    'mislabeled-unaided',
  );
});

test('review scoring refuses an empty answer, invalid timing and a missing grade', () => {
  assert.equal(reasonOf(() => scoreReviewSessions([session({ answer: '   ' })])), 'empty-answer');
  assert.equal(reasonOf(() => scoreReviewSessions([session({ elapsedMs: 0 })])), 'invalid-timing');
  assert.equal(reasonOf(() => scoreReviewSessions([session({ elapsedMs: -1 })])), 'invalid-timing');
  assert.equal(reasonOf(() => scoreReviewSessions([session({ correct: undefined })])), 'missing-grade');
});

test('review scoring refuses a repeated task for one participant', () => {
  assert.equal(
    reasonOf(() => scoreReviewSessions([session(), session()])),
    'duplicate-session',
  );
});

test('review scoring separates the sixty-second target from correctness', () => {
  const score = scoreReviewSessions([
    session({ participantId: P('a'), elapsedMs: 30_000, correct: true }),
    session({ participantId: P('b'), elapsedMs: 90_000, correct: true }),
    session({ participantId: P('c'), elapsedMs: 10_000, correct: false }),
  ]);

  assert.equal(score.correctUnaided, 2);
  assert.equal(score.correctUnaidedWithinTarget, 1);
  assert.equal(score.targetMs, COMPREHENSION_TARGET_MS);
});

test('paired exercise accepts a counterbalanced pair of participants', () => {
  const summary = validatePairedSessions([
    ...pair(P('a'), 'ordinary-ci'),
    ...pair(P('b'), 'sutura-evidence'),
  ]);

  assert.equal(summary.participants, 2);
  assert.deepEqual(summary.order, { ordinaryFirst: 1, suturaFirst: 1 });
  assert.equal(summary.perCondition['ordinary-ci'].decisions, 2);
  assert.equal(summary.perCondition['sutura-evidence'].decisions, 2);
});

test('paired exercise refuses showing the Sutura verdict in the ordinary arm', () => {
  assert.equal(
    reasonOf(() => validatePairedSessions(
      pair(P('a'), 'ordinary-ci').map((item) =>
        (item.condition === 'ordinary-ci' ? { ...item, suturaVerdictShown: true } : item)),
    )),
    'condition-leak',
  );
});

test('paired exercise refuses the same defect twice for one participant', () => {
  assert.equal(
    reasonOf(() => validatePairedSessions([
      paired({ condition: 'ordinary-ci', order: 1, defectId: 'off-by-one' }),
      paired({
        condition: 'sutura-evidence', order: 2, defectId: 'off-by-one', suturaVerdictShown: true,
      }),
    ])),
    'task-leakage',
  );
});

test('paired exercise refuses a participant who saw only one condition', () => {
  assert.equal(
    reasonOf(() => validatePairedSessions([paired()])),
    'incomplete-pair',
  );
});

test('paired exercise refuses an unbalanced condition order', () => {
  assert.equal(
    reasonOf(() => validatePairedSessions([
      ...pair(P('a'), 'ordinary-ci'),
      ...pair(P('b'), 'ordinary-ci'),
      ...pair(P('c'), 'ordinary-ci'),
    ])),
    'unbalanced-order',
  );
});

test('paired exercise tolerates an odd participant count by one', () => {
  const summary = validatePairedSessions([
    ...pair(P('a'), 'ordinary-ci'),
    ...pair(P('b'), 'sutura-evidence'),
    ...pair(P('c'), 'ordinary-ci'),
  ]);

  assert.deepEqual(summary.order, { ordinaryFirst: 2, suturaFirst: 1 });
});

test('paired exercise reports correctness beside median time, not instead of it', () => {
  const summary = validatePairedSessions([
    ...pair(P('a'), 'ordinary-ci'),
    ...pair(P('b'), 'sutura-evidence'),
  ]);

  for (const condition of ['ordinary-ci', 'sutura-evidence']) {
    assert.equal(typeof summary.perCondition[condition].correct, 'number');
    assert.equal(typeof summary.perCondition[condition].medianElapsedMs, 'number');
  }
  assert.match(summary.note, /small sample/u);
});
