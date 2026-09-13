import {
  VERIFICATION_GATES,
  type VerificationGateObservation,
  type VerificationGateStatus,
  type VerificationReason,
} from './types.js';

type Gate = typeof VERIFICATION_GATES[number];

/**
 * The production order every candidate path walks, whether it came from repair
 * search, an externally supplied patch, or a counterfactual alternative. These
 * are phase 1's gate names in the sequence the controller applies them; the
 * order is the contract, so a later gate never carries an observation without
 * every earlier gate having one.
 *
 * `counterfactual` is deliberately absent: it records alternatives beside an
 * accepted patch rather than gating the patch itself.
 */
export const VERIFICATION_GATE_ORDER = [
  'reproduction',
  'policy',
  'mechanical',
  'visible',
  'audit',
  'challenges',
  'adjudication',
  'repository-policy',
  'resources',
] as const satisfies readonly Gate[];

export type OrderedVerificationGate = typeof VERIFICATION_GATE_ORDER[number];

export type ChallengeMode = 'disabled' | 'optional' | 'required';

export interface VerificationGateResult {
  status: VerificationGateStatus;
  reasons?: VerificationReason[];
  artifacts?: Array<{ id: string; sha256: string }>;
}

export type VerificationGateRunner = (
  gate: OrderedVerificationGate,
) => Promise<VerificationGateResult> | VerificationGateResult;

export interface SharedVerificationRequest {
  challengeMode: ChallengeMode;
  /**
   * Gates this subject cannot reach at all, with the reason. An offline
   * harness names its omitted gates here instead of silently skipping them.
   */
  unsupportedGates?: Partial<Record<OrderedVerificationGate, VerificationReason>>;
  runGate: VerificationGateRunner;
}

export interface SharedVerificationOutcome {
  status: VerificationGateStatus;
  /** The first gate that refused, abstained or stopped; null when all passed. */
  blockingGate: OrderedVerificationGate | null;
  observations: VerificationGateObservation[];
  challengeMode: ChallengeMode;
  /** True only when a qualified contract-backed challenge gate passed. */
  challengeAssurance: boolean;
}

const TERMINAL: ReadonlySet<VerificationGateStatus> =
  new Set<VerificationGateStatus>(['failed', 'insufficient', 'infra-stop']);

function observed(
  gate: OrderedVerificationGate,
  result: VerificationGateResult,
): VerificationGateObservation {
  return {
    gate,
    status: result.status,
    reasons: result.reasons ?? [],
    artifacts: result.artifacts ?? [],
  };
}

function unreached(
  gate: OrderedVerificationGate,
  reason: VerificationReason,
): VerificationGateObservation {
  return { gate, status: 'not-run', reasons: [reason], artifacts: [] };
}

/**
 * Walks the shared gate stack once and returns an observation for every gate.
 *
 * An early refusal does not truncate the record: the remaining gates stay
 * `not-run` with `not-executed`, so an omitted suite, policy command, challenge
 * or adjudication can never read as a pass. A gate the runner itself reports as
 * `not-run` stops the walk as missing evidence, which is `insufficient` rather
 * than a refusal: the gate did not decide against the subject, it did not
 * happen. Only a gate declared unsupported for this subject, or the challenge
 * gate in `disabled` mode, is skipped without stopping. In `required` challenge
 * mode a subject that reaches the end without qualified challenge assurance is
 * `insufficient`, not approved.
 */
export async function evaluateVerification(
  request: SharedVerificationRequest,
): Promise<SharedVerificationOutcome> {
  const observations: VerificationGateObservation[] = [];
  const unsupported = request.unsupportedGates ?? {};
  let blockingGate: OrderedVerificationGate | null = null;
  let missingEvidence = false;
  let challengeAssurance = false;

  for (const gate of VERIFICATION_GATE_ORDER) {
    if (blockingGate !== null) {
      observations.push(unreached(gate, 'not-executed'));
      continue;
    }
    const omitted = unsupported[gate];
    if (omitted !== undefined) {
      observations.push(unreached(gate, omitted));
      continue;
    }
    if (gate === 'challenges' && request.challengeMode === 'disabled') {
      observations.push(unreached(gate, 'not-executed'));
      continue;
    }
    const result = observed(gate, await request.runGate(gate));
    observations.push(result);
    if (gate === 'challenges' && result.status === 'passed') challengeAssurance = true;
    if (result.status === 'not-run') {
      blockingGate = gate;
      missingEvidence = true;
    } else if (TERMINAL.has(result.status)) blockingGate = gate;
  }

  if (blockingGate !== null) {
    return {
      status: missingEvidence
        ? 'insufficient'
        : observations.find(({ gate }) => gate === blockingGate)!.status,
      blockingGate,
      observations,
      challengeMode: request.challengeMode,
      challengeAssurance,
    };
  }
  if (request.challengeMode === 'required' && !challengeAssurance) {
    return {
      status: 'insufficient',
      blockingGate: 'challenges',
      observations,
      challengeMode: request.challengeMode,
      challengeAssurance,
    };
  }
  return {
    status: 'passed',
    blockingGate: null,
    observations,
    challengeMode: request.challengeMode,
    challengeAssurance,
  };
}

/**
 * True only for a fully accepted subject. Search may cancel siblings and
 * terminate successfully on this alone, and on nothing weaker.
 */
export function verificationApproved(outcome: SharedVerificationOutcome): boolean {
  return outcome.status === 'passed' && outcome.blockingGate === null &&
    (outcome.challengeMode !== 'required' || outcome.challengeAssurance);
}
