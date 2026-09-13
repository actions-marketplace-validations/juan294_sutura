import assert from 'node:assert/strict';
import test from 'node:test';

import { validateParticipantRecord } from './adoption-study.mjs';
import { ReviewStudyError } from './review-study.mjs';
import {
  assertRehearsalIsNotAdoption,
  assessorSheet,
  buildRehearsalRecord,
  EXTERNAL_PATCH_PACKS,
  PAIRED_TASK_PACKS,
  participantPack,
  REHEARSAL_INSTALL_SOURCE,
  REVIEW_TASKS,
  TASK_PACKS,
  validateTaskMaterial,
} from './review-tasks.mjs';

function reasonOf(run) {
  try {
    run();
    return 'accepted';
  } catch (error) {
    assert.ok(error instanceof ReviewStudyError, `expected a ReviewStudyError, got ${error}`);
    return error.reasonCode;
  }
}

test('the frozen review set holds one task of each kind with a usable answer', () => {
  const summary = validateTaskMaterial();

  assert.deepEqual(summary, { tasks: 4, packs: 2, external: 2 });
  assert.equal(REVIEW_TASKS.length, 4);
  for (const task of REVIEW_TASKS) {
    assert.ok(task.expectedReason.length > 20, `${task.taskId} needs a real reason`);
    assert.ok(task.expectedNextAction.length > 20, `${task.taskId} needs a real next action`);
  }
});

test('the participant pack carries the questions and none of the answers', () => {
  const pack = participantPack();
  const serialized = JSON.stringify(pack);

  assert.equal(pack.tasks.length, REVIEW_TASKS.length);
  for (const key of ['expectedDecision', 'expectedReason', 'expectedNextAction', 'kind']) {
    assert.ok(!serialized.includes(key), `${key} reached the participant pack`);
  }
  for (const task of REVIEW_TASKS) {
    assert.ok(!serialized.includes(task.expectedReason), 'an expected reason reached the pack');
  }
  assert.ok(pack.tasks.every(({ prompt }) => prompt.includes('next safe action')));
});

test('the assessor sheet keeps the answers and hashes them', () => {
  const sheet = assessorSheet();

  assert.match(sheet.sheetHash, /^[a-f0-9]{64}$/u);
  assert.equal(sheet.tasks.length, REVIEW_TASKS.length);
  assert.deepEqual(sheet.tasks.map(({ expectedDecision }) => expectedDecision),
    ['accept', 'refuse', 'abstain', 'abstain']);
  assert.equal(assessorSheet().sheetHash, sheet.sheetHash);
});

test('the two paired packs share no defect and match on difficulty', () => {
  const defects = TASK_PACKS.flatMap((pack) => PAIRED_TASK_PACKS[pack].map(({ defectId }) => defectId));

  assert.equal(new Set(defects).size, defects.length);
  for (const pack of TASK_PACKS) {
    assert.deepEqual(
      PAIRED_TASK_PACKS[pack].map(({ difficulty }) => difficulty).sort(),
      ['boundary-arithmetic', 'missing-guard'],
    );
  }
});

test('both external packs ask the identical question and carry both controls', () => {
  assert.equal(new Set(EXTERNAL_PATCH_PACKS.map(({ failingCommand }) => failingCommand)).size, 1);
  assert.equal(new Set(EXTERNAL_PATCH_PACKS.map(({ packId }) => packId)).size, 2);
  for (const pack of EXTERNAL_PATCH_PACKS) {
    assert.deepEqual([...pack.controls].sort(), ['correct', 'deceptive']);
    assert.ok(pack.allowedPaths.length > 0);
    assert.ok(!JSON.stringify(pack).includes('expected'), 'an expectation reached an external pack');
  }
});

test('a rehearsal is labelled and can never satisfy public-install acceptance', () => {
  const record = buildRehearsalRecord({ participantId: 'participant-aaaaaaaa' });

  assert.equal(record.rehearsal, true);
  assert.equal(record.installSource, REHEARSAL_INSTALL_SOURCE);
  assert.notEqual(record.installSource, 'public-npm-and-immutable-action');
  assert.equal(
    reasonOf(() => assertRehearsalIsNotAdoption(record, validateParticipantRecord)),
    'accepted',
  );
});

test('a rehearsal that the adoption validator accepted is refused outright', () => {
  assert.equal(
    reasonOf(() => assertRehearsalIsNotAdoption({}, () => true)),
    'rehearsal-accepted',
  );
  assert.equal(reasonOf(() => buildRehearsalRecord({})), 'missing-participant');
});
