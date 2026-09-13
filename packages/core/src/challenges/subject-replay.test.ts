/**
 * Per-repetition challenge records and their replay.
 *
 * A replay has to show that a rerun observed the same things, not only that it
 * reached the same verdict. These tests hold the runner's per-repetition
 * records against the evidence codec: order, subject, repetition, the digest of
 * what each repetition observed, and the reason a cancelled repetition
 * observed nothing.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decodeVerificationEvidence, encodeVerificationEvidence } from '../verification/codec.js';
import type { VerificationChallengeSubject, VerificationEvidence } from '../verification/types.js';
import { CHALLENGE_REPETITIONS, type ChallengeProposal, type FrozenChallengeSet } from './generate.js';
import { challengeSubjectRecords, runFrozenChallenges, type ChallengeProbeRunner } from './runner.js';

const SET_HASH = 'f'.repeat(64);

function challenge(overrides: Partial<ChallengeProposal> = {}): ChallengeProposal {
  return {
    id: 'ceiling-preserved',
    kind: 'preservation',
    contractRefs: [{ path: '.sutura.json', sha256: 'a'.repeat(64), startLine: 1, endLine: 2 }],
    rationale: 'boundary stays at two pages',
    probeId: 'page-count',
    inputs: [20, 10],
    contractId: 'page-count-ceiling',
    relationId: 'equals',
    ...overrides,
  };
}

function frozen(challenges: ChallengeProposal[]): FrozenChallengeSet {
  return {
    version: 'sutura-challenges-v1',
    baselineSnapshotHash: 'b'.repeat(64),
    trustedPolicySha: 'c'.repeat(64),
    contextHash: 'd'.repeat(64),
    promptHash: 'e'.repeat(64),
    setHash: SET_HASH,
    challenges,
    excluded: [],
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Observes a value per subject and reports the digest of the bytes it saw. */
function observing(values: Record<'baseline' | 'candidate', string>): ChallengeProbeRunner {
  return ({ subject }) => Promise.resolve({
    status: 'passed', observationSha256: sha256(values[subject]),
  });
}

/** Cancels every candidate repetition, as an operation cancellation does. */
const cancelCandidate: ChallengeProbeRunner = ({ subject }) => Promise.resolve(
  subject === 'baseline'
    ? { status: 'passed', observationSha256: sha256('{"version":1,"value":2}') }
    : { status: 'insufficient', reasonCode: 'cancelled' },
);

const HASH = 'a'.repeat(64);

function evidence(subjects: VerificationChallengeSubject[]): VerificationEvidence {
  return {
    schemaVersion: 'sutura-verification-evidence-v1',
    mode: 'local', outcome: 'insufficient', assurance: 'baseline-only',
    identity: {
      sourceSha: 'b'.repeat(40), snapshotSha256: HASH,
      policyBaseSha: 'c'.repeat(40), policySha256: HASH, diffSha256: HASH,
      corpusRevision: null, fixtureRevision: null, imageDigest: `sha256:${HASH}`,
      routingVersion: 'fixed-v1', challengeVersion: 'protocol-v1',
    },
    startedAt: '2026-09-06T10:00:00.000Z', finishedAt: '2026-09-06T10:00:02.000Z',
    commands: ['node --test'], models: [],
    challenges: { mode: 'optional', qualifiedProbeCount: 1, setHash: SET_HASH, subjects },
    gates: [
      { gate: 'policy', status: 'passed', reasons: [], artifacts: [{ id: 'policy', sha256: HASH }] },
      { gate: 'visible', status: 'passed', reasons: [], artifacts: [{ id: 'visible', sha256: HASH }] },
      { gate: 'audit', status: 'not-run', reasons: ['not-executed'], artifacts: [] },
      { gate: 'challenges', status: 'insufficient', reasons: ['not-executed'], artifacts: [] },
    ],
    costs: {
      schemaVersion: 'sutura-verification-cost-v1', inference: [], wallTimeMs: 2_000,
      sandbox: [{ operationId: 'run-1', rawAmount: 0.1, rawUnit: null, unitSource: null, billed: null }],
    },
  };
}

describe('per-repetition challenge records', () => {
  it('records every repetition of every subject in execution order', async () => {
    const result = await runFrozenChallenges({
      set: frozen([challenge()]),
      run: observing({ baseline: '{"version":1,"value":2}', candidate: '{"version":1,"value":2}' }),
    });
    const records = challengeSubjectRecords(result);

    expect(records).toHaveLength(2 * CHALLENGE_REPETITIONS);
    expect(records.map(({ subject, repetition }) => `${subject}-${repetition}`))
      .toEqual(['baseline-1', 'baseline-2', 'candidate-1', 'candidate-2']);
    expect(new Set(records.map(({ observationSha256 }) => observationSha256)).size).toBe(1);
  });

  it('separates a candidate that observed something else from one that observed the same', async () => {
    const same = challengeSubjectRecords(await runFrozenChallenges({
      set: frozen([challenge()]),
      run: observing({ baseline: '{"version":1,"value":2}', candidate: '{"version":1,"value":2}' }),
    }));
    const different = challengeSubjectRecords(await runFrozenChallenges({
      set: frozen([challenge()]),
      run: observing({ baseline: '{"version":1,"value":2}', candidate: '{"version":1,"value":3}' }),
    }));

    expect(same.map(({ status }) => status)).toEqual(different.map(({ status }) => status));
    expect(encodeVerificationEvidence(evidence(same)).normalizedComparisonSha256)
      .not.toBe(encodeVerificationEvidence(evidence(different)).normalizedComparisonSha256);
  });

  it('records a cancelled repetition as observing nothing, with its reason', async () => {
    const result = await runFrozenChallenges({ set: frozen([challenge()]), run: cancelCandidate });
    const records = challengeSubjectRecords(result);
    const candidates = records.filter(({ subject }) => subject === 'candidate');

    expect(result.status).toBe('failed');
    expect(candidates).toHaveLength(CHALLENGE_REPETITIONS);
    for (const record of candidates) {
      expect(record.status).toBe('insufficient');
      expect(record.observationSha256).toBeNull();
      expect(record.reasonCode).toBe('cancelled');
    }
    expect(records.filter(({ subject }) => subject === 'baseline')
      .every(({ observationSha256 }) => observationSha256 !== null)).toBe(true);
  });

  it('keeps a baseline that never qualified without any candidate record', async () => {
    const result = await runFrozenChallenges({
      set: frozen([challenge()]),
      run: ({ repetition }) => Promise.resolve(repetition === 1
        ? { status: 'passed', observationSha256: sha256('a') }
        : { status: 'failed', observationSha256: sha256('b') }),
    });
    const records = challengeSubjectRecords(result);

    expect(result.status).toBe('insufficient');
    expect(records.every(({ subject }) => subject === 'baseline')).toBe(true);
    expect(records).toHaveLength(CHALLENGE_REPETITIONS);
  });
});

describe('replaying per-repetition records', () => {
  it('round trips through the evidence codec byte for byte', async () => {
    const records = challengeSubjectRecords(await runFrozenChallenges({
      set: frozen([challenge()]),
      run: observing({ baseline: '{"version":1,"value":2}', candidate: '{"version":1,"value":2}' }),
    }));
    const recorded = evidence(records);
    const artifact = encodeVerificationEvidence(recorded);

    expect(decodeVerificationEvidence(artifact, recorded.identity)).toEqual(recorded);
    expect(decodeVerificationEvidence(artifact, recorded.identity).challenges.subjects)
      .toEqual(records);
  });

  it('still decodes evidence recorded before per-repetition records existed', () => {
    const older = evidence([]);
    delete older.challenges.subjects;
    const artifact = encodeVerificationEvidence(older);

    expect(decodeVerificationEvidence(artifact, older.identity).challenges)
      .not.toHaveProperty('subjects');
  });

  const base: VerificationChallengeSubject = {
    challengeId: 'ceiling-preserved', subject: 'baseline', repetition: 1,
    status: 'passed', observationSha256: HASH, reasonCode: 'passed',
  };
  const secondBaseline: VerificationChallengeSubject = { ...base, repetition: 2 };

  it.each([
    ['a duplicate repetition', [base, base]],
    ['a repetition outside the frozen count', [{ ...base, repetition: 3 }]],
    ['a repetition zero', [{ ...base, repetition: 0 }]],
    ['a decided repetition with no observation', [{ ...base, observationSha256: null }]],
    ['a malformed observation digest', [{ ...base, observationSha256: 'short' }]],
    ['an unknown subject', [{ ...base, subject: 'oracle' as VerificationChallengeSubject['subject'] }]],
    ['a candidate with no baseline', [{ ...base, subject: 'candidate' as const }]],
    ['a candidate with an incomplete baseline', [base, { ...base, subject: 'candidate' as const }]],
  ])('refuses %s', (_name, subjects) => {
    expect(() => encodeVerificationEvidence(evidence(subjects as VerificationChallengeSubject[])))
      .toThrow(/challenges/u);
  });

  it('accepts a candidate whose baseline completed every repetition', () => {
    const complete: VerificationChallengeSubject[] = [
      base, secondBaseline,
      { ...base, subject: 'candidate' }, { ...secondBaseline, subject: 'candidate' },
    ];

    expect(() => encodeVerificationEvidence(evidence(complete))).not.toThrow();
  });

  it('refuses subject records from a run that froze no challenge set', () => {
    const unfrozen = evidence([base, secondBaseline]);
    delete unfrozen.challenges.setHash;

    expect(() => encodeVerificationEvidence(unfrozen)).toThrow(/frozen set hash/u);
  });
});
