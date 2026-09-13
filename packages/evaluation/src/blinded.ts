import { createHash } from 'node:crypto';

/**
 * Fields that would tell the evaluated model the answer. They are removed from
 * a blinded record and their presence afterwards is an error, not a warning,
 * because a leaked label turns a quality measurement into a lookup.
 */
export const FORBIDDEN_BLINDED_KEYS = Object.freeze([
  'kind',
  'fixtureKind',
  'expected',
  'expectedOutcome',
  'outcome',
  'verdict',
  'approved',
  'adjudication',
  'adjudicatorRecommendation',
  'hidden',
  'hiddenTests',
  'hiddenVerification',
  'agent',
  'agentId',
  'agentName',
  'label',
  'truth',
  'split',
]);

/** Filenames that carry a label in their name rather than their content. */
const LABEL_BEARING_PATH = /(?:^|\/)(?:hidden|expected|truth|labels?)(?:[./-]|$)|(?:^|\/)fake-fix\.diff$/u;

export type BlindedLabel = 'preserves-contract' | 'breaks-contract' | 'insufficient-evidence' | 'unknown';

export interface ExecutedRecord {
  recordId: string;
  failureExcerpt: string;
  candidateDiff: string;
  publicContracts: Array<{ contractId: string; excerpt: string }>;
  observations: Array<{ command: string; exitCode: number; output: string }>;
  changedPaths: string[];
  [key: string]: unknown;
}

export interface BlindedRecord {
  recordId: string;
  failureExcerpt: string;
  candidateDiff: string;
  publicContracts: Array<{ contractId: string; excerpt: string }>;
  observations: Array<{ command: string; exitCode: number; output: string }>;
  changedPaths: string[];
  sourceHash: string;
}

export class BlindingError extends Error {
  constructor(readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'BlindingError';
  }
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Fails if any forbidden key survives anywhere in a structure bound for a
 * model prompt.
 */
export function assertNoForbiddenMetadata(value: unknown, path = 'record'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => { assertNoForbiddenMetadata(item, `${path}[${index}]`); });
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_BLINDED_KEYS.includes(key)) {
      throw new BlindingError('label-leak', `${path}.${key} would leak the answer`);
    }
    assertNoForbiddenMetadata(item, `${path}.${key}`);
  }
}

/**
 * Builds the model-facing record from an executed one.
 *
 * The candidate diff is deliberately kept: this is an offline evaluator of
 * candidate quality, unlike phase 4 challenge generation, which must never see
 * a candidate. What leaves is everything that states or implies the answer —
 * case kind, expected outcome, the final verdict, adjudicator recommendation,
 * hidden tests and their results, agent identity, and any path whose name
 * carries a label.
 */
export function blindExecutedRecord(record: ExecutedRecord): BlindedRecord {
  if (typeof record.recordId !== 'string' || !record.recordId.trim()) {
    throw new BlindingError('invalid-record', 'A blinded record requires a record id');
  }
  const blinded: BlindedRecord = {
    recordId: record.recordId,
    failureExcerpt: record.failureExcerpt,
    candidateDiff: record.candidateDiff,
    publicContracts: record.publicContracts.map(({ contractId, excerpt }) => ({ contractId, excerpt })),
    observations: record.observations.map(({ command, exitCode, output }) =>
      ({ command, exitCode, output })),
    changedPaths: record.changedPaths.filter((path) => !LABEL_BEARING_PATH.test(path)),
    sourceHash: digest(JSON.stringify(record)),
  };
  assertNoForbiddenMetadata({ ...blinded, sourceHash: undefined });
  return blinded;
}

export interface SplitCounts {
  development: number;
  validation: number;
  heldOut: number;
}

export interface SplitCase {
  caseId: string;
  /** Synthetic mutations share this with their original and move together. */
  rootFamily: string;
}

export type EvaluationSplit = 'development' | 'validation' | 'held-out';

export interface FrozenSplit {
  assignments: Array<{ caseId: string; rootFamily: string; split: EvaluationSplit }>;
  counts: Record<EvaluationSplit, number>;
  splitHash: string;
}

/**
 * Freezes an evaluation split by root family.
 *
 * A family is assigned as a unit, so a synthetic mutation can never land in a
 * different split from the case it was derived from — the leak that would make
 * a held-out score meaningless.
 *
 * Families are taken largest first, breaking ties by name, and each goes to the
 * split with the most room left. Filling one split before the next would hand
 * the last split whatever families sort last, which makes a held-out score
 * describe the end of the alphabet rather than the corpus. The ordering and the
 * tie-breaks are fixed, so the same corpus always produces the same split and
 * the same hash.
 */
export function freezeSplitByRootFamily(
  cases: readonly SplitCase[],
  counts: SplitCounts,
): FrozenSplit {
  const total = counts.development + counts.validation + counts.heldOut;
  if (cases.length !== total) {
    throw new BlindingError(
      'split-size', `Split expects ${total} cases but received ${cases.length}`,
    );
  }
  if (new Set(cases.map(({ caseId }) => caseId)).size !== cases.length) {
    throw new BlindingError('duplicate-case', 'Case identifiers must be distinct');
  }

  const families = new Map<string, SplitCase[]>();
  for (const item of [...cases].sort((left, right) => left.caseId.localeCompare(right.caseId))) {
    const bucket = families.get(item.rootFamily) ?? [];
    bucket.push(item);
    families.set(item.rootFamily, bucket);
  }

  const targets: Array<{ split: EvaluationSplit; remaining: number; target: number }> = [
    { split: 'development', remaining: counts.development, target: counts.development },
    { split: 'validation', remaining: counts.validation, target: counts.validation },
    { split: 'held-out', remaining: counts.heldOut, target: counts.heldOut },
  ];
  const assignments: FrozenSplit['assignments'] = [];
  const ordered = [...families.entries()].sort(([leftName, left], [rightName, right]) =>
    right.length - left.length || leftName.localeCompare(rightName));

  for (const [rootFamily, members] of ordered) {
    // Whichever split would still be furthest from full after taking this
    // family, measured against its own share. Filling development first would
    // leave the held-out split made entirely of the families that sort last.
    const target = targets
      .filter(({ remaining }) => remaining >= members.length)
      .sort((left, right) =>
        ((right.remaining - members.length) / right.target)
        - ((left.remaining - members.length) / left.target))[0];
    if (target === undefined) {
      throw new BlindingError(
        'family-does-not-fit',
        `Family ${rootFamily} of ${members.length} cases does not fit any remaining split`,
      );
    }
    target.remaining -= members.length;
    for (const member of members) {
      assignments.push({ caseId: member.caseId, rootFamily, split: target.split });
    }
  }

  const resolved: Record<EvaluationSplit, number> = {
    development: assignments.filter(({ split }) => split === 'development').length,
    validation: assignments.filter(({ split }) => split === 'validation').length,
    'held-out': assignments.filter(({ split }) => split === 'held-out').length,
  };
  return {
    assignments: assignments.toSorted((left, right) => left.caseId.localeCompare(right.caseId)),
    counts: resolved,
    splitHash: digest(JSON.stringify(assignments.toSorted(
      (left, right) => left.caseId.localeCompare(right.caseId),
    ))),
  };
}
