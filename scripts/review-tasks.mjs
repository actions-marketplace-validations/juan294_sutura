/**
 * The frozen task material for the phase 9 studies.
 *
 * Everything a participant sees and everything an assessor holds live in the
 * same file so they cannot drift apart, and are separated by a function rather
 * than by discipline: `participantPack` refuses to return material that still
 * carries an answer. No participant has been contacted and no session has been
 * scheduled; this is prepared material.
 */
import { createHash } from 'node:crypto';

import { ReviewStudyError, REVIEW_DECISIONS, REVIEW_TASK_KINDS } from './review-study.mjs';

export const REVIEW_TASK_SET_VERSION = 'sutura-review-task-set-v1';
export const TASK_PACKS = Object.freeze(['pack-a', 'pack-b']);

/** Fields that would tell a participant the answer, wherever they appear. */
const ASSESSOR_ONLY_KEYS = Object.freeze([
  'expectedDecision', 'expectedReason', 'expectedNextAction', 'kind', 'truth', 'answer',
]);

function refuse(reasonCode, message) {
  throw new ReviewStudyError(reasonCode, message);
}

/**
 * The four comprehension tasks. Each names the case a reviewer reads, what
 * they are asked, and — for the assessor only — the decision that is correct
 * and the reason that makes it correct.
 */
export const REVIEW_TASKS = Object.freeze([
  {
    taskId: 'valid-repair-1',
    kind: 'valid-repair',
    caseId: 'repair-off-by-one-preservation',
    prompt: 'Read this result. State your verdict, why, what actually ran, and the next safe action.',
    expectedDecision: 'accept',
    expectedReason: 'The repair restores the ceiling boundary and the independent checks agree at 21/10 and 20/10.',
    expectedNextAction: 'Review the diff and the behaviour tested, then merge if it matches intent.',
  },
  {
    taskId: 'deceptive-green-1',
    kind: 'deceptive-green',
    caseId: 'greenwash-trap',
    prompt: 'Read this result. State your verdict, why, what actually ran, and the next safe action.',
    expectedDecision: 'refuse',
    expectedReason: 'The patch made the original test pass by weakening it; the boundary behaviour is unchanged.',
    expectedNextAction: 'Send it back for a repair that restores behaviour rather than changing the test.',
  },
  {
    taskId: 'flake-1',
    kind: 'flake',
    caseId: 'flaky-failure',
    prompt: 'Read this result. State your verdict, why, what actually ran, and the next safe action.',
    expectedDecision: 'abstain',
    expectedReason: 'The failure did not reproduce consistently, so no patch can be judged against it.',
    expectedNextAction: 'Stabilise the test before asking for a repair.',
  },
  {
    taskId: 'insufficient-evidence-1',
    kind: 'insufficient-evidence',
    caseId: 'upstream-incident',
    prompt: 'Read this result. State your verdict, why, what actually ran, and the next safe action.',
    expectedDecision: 'abstain',
    expectedReason: 'The run stopped before deciding, so nothing about the patch was established.',
    expectedNextAction: 'Retry once the infrastructure is available; draw no conclusion from this run.',
  },
]);

/**
 * Two packs of matched defects for the paired exercise.
 *
 * A participant sees one defect under ordinary CI and a different one under
 * Sutura evidence, so the second decision is never a memory of the first. The
 * packs are of comparable difficulty by construction: each pairs one
 * boundary-arithmetic defect with one missing-guard defect.
 */
export const PAIRED_TASK_PACKS = Object.freeze({
  'pack-a': Object.freeze([
    { defectId: 'off-by-one', caseId: 'repair-off-by-one-preservation', difficulty: 'boundary-arithmetic' },
    { defectId: 'null-guard', caseId: 'repair-null-guard', difficulty: 'missing-guard' },
  ]),
  'pack-b': Object.freeze([
    { defectId: 'percent-rounding', caseId: 'repair-percent-rounding-preservation', difficulty: 'boundary-arithmetic' },
    { defectId: 'empty-catch', caseId: 'trap-empty-catch', difficulty: 'missing-guard' },
  ]),
});

/**
 * Two external-agent patch-source packs.
 *
 * Both name the same clean source, the same failing command and the same
 * allowed scope, so two agents are asked the identical question and the
 * verifier sees only their bytes. Each pack carries a correct and a deceptive
 * control, so the verifier can be calibrated whether or not either agent
 * succeeds. No hidden expectation is included: the answer lives with the
 * assessor, never in the pack.
 */
export const EXTERNAL_PATCH_PACKS = Object.freeze([
  {
    packId: 'external-a',
    caseId: 'repair-off-by-one-preservation',
    sourceSha: null,
    failingCommand: 'diagnosed',
    allowedPaths: ['page-count.js'],
    controls: Object.freeze(['correct', 'deceptive']),
  },
  {
    packId: 'external-b',
    caseId: 'python-repair-integer-division',
    sourceSha: null,
    failingCommand: 'diagnosed',
    allowedPaths: ['paging.py'],
    controls: Object.freeze(['correct', 'deceptive']),
  },
]);

function stripAssessorFields(value) {
  if (Array.isArray(value)) return value.map(stripAssessorFields);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !ASSESSOR_ONLY_KEYS.includes(key))
    .map(([key, item]) => [key, stripAssessorFields(item)]));
}

function assertNoAnswer(value, path = 'pack') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => { assertNoAnswer(item, `${path}[${index}]`); });
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (ASSESSOR_ONLY_KEYS.includes(key)) {
      refuse('answer-leak', `${path}.${key} would tell the participant the answer`);
    }
    assertNoAnswer(item, `${path}.${key}`);
  }
}

/** What a participant receives: the tasks with every assessor field removed. */
export function participantPack() {
  const pack = {
    schemaVersion: REVIEW_TASK_SET_VERSION,
    tasks: stripAssessorFields([...REVIEW_TASKS]),
  };
  assertNoAnswer(pack);
  return pack;
}

/** What the assessor holds: the same tasks with the correct decisions. */
export function assessorSheet() {
  return {
    schemaVersion: REVIEW_TASK_SET_VERSION,
    tasks: REVIEW_TASKS.map((task) => ({ ...task })),
    sheetHash: createHash('sha256').update(JSON.stringify(REVIEW_TASKS)).digest('hex'),
  };
}

/**
 * Validates the frozen task set before it is used.
 *
 * Each of the four kinds appears exactly once, every expected decision is one
 * of the three a reviewer may give, and both paired packs cover the same
 * difficulty mix with no defect shared between them.
 */
export function validateTaskMaterial() {
  const kinds = REVIEW_TASKS.map(({ kind }) => kind);
  if (new Set(kinds).size !== REVIEW_TASK_KINDS.length || kinds.length !== REVIEW_TASK_KINDS.length) {
    refuse('task-set-shape', 'The frozen review set holds exactly one task of each kind');
  }
  for (const task of REVIEW_TASKS) {
    if (!REVIEW_TASK_KINDS.includes(task.kind)) refuse('unknown-kind', `${task.taskId} has an unknown kind`);
    if (!REVIEW_DECISIONS.includes(task.expectedDecision)) {
      refuse('unknown-decision', `${task.taskId} expects a decision a reviewer cannot give`);
    }
    if (!task.expectedReason.trim() || !task.expectedNextAction.trim()) {
      refuse('incomplete-task', `${task.taskId} needs an expected reason and next action`);
    }
  }

  const defects = new Map();
  for (const pack of TASK_PACKS) {
    const entries = PAIRED_TASK_PACKS[pack];
    if (entries === undefined || entries.length !== 2) refuse('pack-shape', `${pack} needs two defects`);
    if (new Set(entries.map(({ difficulty }) => difficulty)).size !== 2) {
      refuse('pack-difficulty', `${pack} must pair two different difficulties`);
    }
    for (const entry of entries) {
      if (defects.has(entry.defectId)) {
        refuse('defect-reuse', `${entry.defectId} appears in more than one pack`);
      }
      defects.set(entry.defectId, pack);
    }
  }

  const commands = new Set(EXTERNAL_PATCH_PACKS.map(({ failingCommand }) => failingCommand));
  if (commands.size !== 1) refuse('pack-command-drift', 'Both external packs must ask the identical question');
  for (const pack of EXTERNAL_PATCH_PACKS) {
    if (!pack.controls.includes('correct') || !pack.controls.includes('deceptive')) {
      refuse('missing-control', `${pack.packId} needs a correct and a deceptive control`);
    }
    assertNoAnswer(pack, pack.packId);
  }
  return { tasks: REVIEW_TASKS.length, packs: TASK_PACKS.length, external: EXTERNAL_PATCH_PACKS.length };
}

export const REHEARSAL_INSTALL_SOURCE = 'local-packed-artifact';

/**
 * A rehearsal record, labelled as one.
 *
 * A rehearsal proves the instructions can be followed; it proves nothing about
 * adoption, because the builder packed the artifact. The label is a field the
 * adoption validator does not accept, so a rehearsal cannot be counted toward
 * the three installs by editing a number.
 */
export function buildRehearsalRecord(input) {
  if (!input?.participantId) refuse('missing-participant', 'A rehearsal record still names who ran it');
  return {
    schemaVersion: 'sutura-adoption-rehearsal-v1',
    rehearsal: true,
    participantId: input.participantId,
    installSource: REHEARSAL_INSTALL_SOURCE,
    packedArtifact: input.packedArtifact ?? 'sutura-local.tgz',
    notes: input.notes ?? [],
  };
}

/**
 * Confirms a rehearsal cannot satisfy public-install acceptance.
 *
 * The adoption validator is called with the rehearsal and must refuse it. A
 * rehearsal that passed would mean the acceptance contract had been weakened.
 */
export function assertRehearsalIsNotAdoption(record, validateParticipantRecord) {
  let accepted = false;
  try {
    validateParticipantRecord(record);
    accepted = true;
  } catch {
    accepted = false;
  }
  if (accepted) refuse('rehearsal-accepted', 'A rehearsal must never satisfy public-install acceptance');
}
