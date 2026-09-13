import type { VerificationChallengeSubject } from '../verification/types.js';
import { CHALLENGE_REPETITIONS, type ChallengeProposal, type FrozenChallengeSet } from './generate.js';

export type ChallengeObservationStatus = 'passed' | 'failed' | 'insufficient';

export interface ChallengeObservation {
  challengeId: string;
  subject: 'baseline' | 'candidate';
  repetition: number;
  status: ChallengeObservationStatus;
  reasonCode: string;
  /**
   * Digest of the bytes this repetition observed. Absent when the repetition
   * produced no observation, because it was cancelled or could not run.
   */
  observationSha256?: string;
}

export interface ChallengeQualification {
  challengeId: string;
  qualified: boolean;
  reasonCode: string;
  observations: ChallengeObservation[];
}

export interface ChallengeRunResult {
  status: 'passed' | 'failed' | 'insufficient';
  reasonCode: string;
  qualified: ChallengeQualification[];
  observations: ChallengeObservation[];
}

/**
 * Runs one repetition of one challenge against one subject, always from a
 * fresh branch. The controller supplies this; a candidate cannot influence
 * which branch a repetition starts from.
 */
export type ChallengeProbeRunner = (input: {
  challenge: ChallengeProposal;
  subject: 'baseline' | 'candidate';
  repetition: number;
}) => Promise<{
  status: ChallengeObservationStatus;
  reasonCode?: string;
  observationSha256?: string;
}>;

async function observe(
  run: ChallengeProbeRunner,
  challenge: ChallengeProposal,
  subject: 'baseline' | 'candidate',
): Promise<ChallengeObservation[]> {
  const observations: ChallengeObservation[] = [];
  for (let repetition = 1; repetition <= CHALLENGE_REPETITIONS; repetition += 1) {
    const result = await run({ challenge, subject, repetition });
    observations.push({
      challengeId: challenge.id,
      subject,
      repetition,
      status: result.status,
      reasonCode: result.reasonCode ?? (result.status === 'passed' ? 'passed' : 'observation'),
      ...(result.observationSha256 === undefined ? {} : { observationSha256: result.observationSha256 }),
    });
  }
  return observations;
}

function consistent(
  observations: readonly ChallengeObservation[],
  status: ChallengeObservationStatus,
): boolean {
  return observations.length === CHALLENGE_REPETITIONS &&
    observations.every((item) => item.status === status);
}

/**
 * Qualifies each frozen challenge on the baseline, then runs the qualified
 * ones against the candidate.
 *
 * A preservation challenge must pass the baseline in every repetition; a
 * bug-regression challenge must fail it in every repetition through its
 * intended assertion. Anything else is `insufficient` and is excluded with a
 * reason, because a challenge that does not behave predictably on the
 * baseline cannot say anything about a candidate. A candidate passing an
 * unqualified challenge never counts as assurance.
 */
export async function runFrozenChallenges(input: {
  set: FrozenChallengeSet;
  run: ChallengeProbeRunner;
}): Promise<ChallengeRunResult> {
  const observations: ChallengeObservation[] = [];
  const qualified: ChallengeQualification[] = [];

  for (const challenge of input.set.challenges) {
    const baseline = await observe(input.run, challenge, 'baseline');
    observations.push(...baseline);
    const expected: ChallengeObservationStatus =
      challenge.kind === 'preservation' ? 'passed' : 'failed';
    if (!consistent(baseline, expected)) {
      qualified.push({
        challengeId: challenge.id,
        qualified: false,
        reasonCode: challenge.kind === 'preservation'
          ? 'baseline-not-consistently-passing'
          : 'baseline-not-consistently-failing',
        observations: baseline,
      });
      continue;
    }
    const candidate = await observe(input.run, challenge, 'candidate');
    observations.push(...candidate);
    qualified.push({
      challengeId: challenge.id,
      qualified: true,
      reasonCode: consistent(candidate, 'passed') ? 'passed' : 'candidate-observation',
      observations: [...baseline, ...candidate],
    });
  }

  const usable = qualified.filter(({ qualified: ok }) => ok);
  if (usable.length === 0) {
    return {
      status: 'insufficient',
      reasonCode: input.set.challenges.length === 0 ? 'no-frozen-challenges' : 'no-qualified-challenge',
      qualified,
      observations,
    };
  }
  const failing = usable.find(({ observations: items }) =>
    !consistent(items.filter(({ subject }) => subject === 'candidate'), 'passed'));
  if (failing !== undefined) {
    return { status: 'failed', reasonCode: failing.challengeId, qualified, observations };
  }
  return { status: 'passed', reasonCode: 'passed', qualified, observations };
}

/**
 * The per-repetition record a replay compares against.
 *
 * Only repetitions that were actually reached appear, in execution order, so a
 * missing record reads as a repetition that did not happen rather than as one
 * that passed. A repetition that observed something carries the digest of what
 * it observed; a cancelled or unrunnable one carries null and keeps its reason.
 */
export function challengeSubjectRecords(
  result: Pick<ChallengeRunResult, 'observations'>,
): VerificationChallengeSubject[] {
  return result.observations.map((observation) => ({
    challengeId: observation.challengeId,
    subject: observation.subject,
    repetition: observation.repetition,
    status: observation.status,
    observationSha256: observation.observationSha256 ?? null,
    reasonCode: observation.reasonCode,
  }));
}
