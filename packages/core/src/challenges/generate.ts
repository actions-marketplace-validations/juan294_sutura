import { createHash } from 'node:crypto';

import { canonicalJson } from '../replay/canonical-json.js';
import { redactExternalJsonValue } from '../security/external-text.js';
import type { ChatMessage } from '../llm/types.js';
import type { VerificationPolicy } from './contracts.js';

export const CHALLENGE_SET_VERSION = 'sutura-challenges-v1' as const;
export const CHALLENGE_GENERATION_PURPOSE = 'challenge-generation' as const;
/** At most three challenges are retained; each runs two repetitions per subject. */
export const MAX_RETAINED_CHALLENGES = 3;
export const CHALLENGE_REPETITIONS = 2;

export type ChallengeKind = 'preservation' | 'bug-regression';

export interface ChallengeContractRef {
  path: string;
  sha256: string;
  startLine: number;
  endLine: number;
}

export interface ChallengeProposal {
  id: string;
  kind: ChallengeKind;
  contractRefs: ChallengeContractRef[];
  rationale: string;
  probeId: string;
  inputs: unknown[];
  contractId: string;
  relationId: string;
}

export interface FrozenChallengeSet {
  version: typeof CHALLENGE_SET_VERSION;
  baselineSnapshotHash: string;
  trustedPolicySha: string;
  contextHash: string;
  promptHash: string;
  setHash: string;
  challenges: ChallengeProposal[];
  excluded: Array<{ id: string; reasonCode: string }>;
}

/**
 * Everything the challenge generator is allowed to see. The candidate diff,
 * the repair transcript, alternatives, agent provenance, expected benchmark
 * outcomes, fixture kinds, hidden tests and known-good patches are absent by
 * construction rather than filtered afterwards, so a new caller cannot leak
 * them by passing an extra field.
 */
export interface ChallengeGenerationContext {
  failureExcerpt: string;
  baselineSources: Array<{ path: string; startLine: number; content: string }>;
  contractExcerpts: Array<{ contractId: string; path: string; excerpt: string }>;
  baselineSnapshotHash: string;
  trustedPolicySha: string;
}

/** Field names that must never reach the challenge generator. */
export const FORBIDDEN_CHALLENGE_CONTEXT_KEYS = Object.freeze([
  'diff', 'candidate', 'candidateDiff', 'patch', 'transcript', 'alternatives',
  'agent', 'provenance', 'expected', 'expectedOutcome', 'kind', 'hidden',
  'hiddenTests', 'knownGoodPatch', 'oracle', 'fixtureKind',
]);

export class ChallengeGenerationError extends Error {
  constructor(readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'ChallengeGenerationError';
  }
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

const CHALLENGE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function assertNoForbiddenKeys(value: unknown, path = 'context'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => { assertNoForbiddenKeys(item, `${path}[${index}]`); });
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_CHALLENGE_CONTEXT_KEYS.includes(key)) {
      throw new ChallengeGenerationError(
        'context-leak', `${path}.${key} must not reach the challenge generator`,
      );
    }
    assertNoForbiddenKeys(item, `${path}.${key}`);
  }
}

/**
 * Builds the generation prompt from baseline evidence only.
 *
 * The generator proposes a target, bounded inputs and a declared relation; it
 * never supplies an expected value, executable test source, a command, or a
 * new trusted oracle. Expected values are derived from the trusted policy by
 * the controller after freezing.
 */
export function buildChallengeGenerationPrompt(
  context: ChallengeGenerationContext,
): { messages: ChatMessage[]; contextHash: string; promptHash: string } {
  assertNoForbiddenKeys(context);
  const system: ChatMessage = {
    role: 'system',
    content: [
      'Propose behavioral challenges for the baseline source as strict JSON.',
      'A preservation challenge must already hold on the baseline. A bug-regression challenge must fail on the baseline through the cited contract.',
      'Name only a controller-supplied probe identifier, bounded typed inputs, a declared contract identifier and one of its declared relations.',
      'You cannot supply an expected value, test source, a shell command, a dependency, a runner flag or a new contract. Expected values come from the trusted policy.',
      'Cite the contract excerpt each challenge relies on. A citation does not establish semantics.',
      'Do not include analysis or markdown.',
    ].join('\n'),
  };
  const payload = redactExternalJsonValue({
    failureExcerpt: context.failureExcerpt,
    baselineSources: context.baselineSources,
    contractExcerpts: context.contractExcerpts,
  });
  const messages: ChatMessage[] = [system, { role: 'user', content: JSON.stringify(payload) }];
  return {
    messages,
    contextHash: digest(canonicalJson(payload)),
    promptHash: digest(canonicalJson(messages)),
  };
}

function validProposal(
  value: unknown,
  policy: VerificationPolicy,
): { ok: true; proposal: ChallengeProposal } | { ok: false; id: string; reasonCode: string } {
  const id = typeof (value as { id?: unknown } | null)?.id === 'string'
    ? (value as { id: string }).id
    : 'unknown';
  const fail = (reasonCode: string): { ok: false; id: string; reasonCode: string } =>
    ({ ok: false, id, reasonCode });
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('malformed');
  const item = value as Record<string, unknown>;
  const allowed = ['id', 'kind', 'contractRefs', 'rationale', 'probeId', 'inputs', 'contractId', 'relationId'];
  if (Object.keys(item).some((key) => !allowed.includes(key))) return fail('unsupported-field');
  if (typeof item.id !== 'string' || !CHALLENGE_ID.test(item.id)) return fail('invalid-id');
  if (item.kind !== 'preservation' && item.kind !== 'bug-regression') return fail('invalid-kind');
  if (typeof item.rationale !== 'string' || !item.rationale.trim() || item.rationale.length > 240) {
    return fail('invalid-rationale');
  }
  if (typeof item.probeId !== 'string' || !CHALLENGE_ID.test(item.probeId)) return fail('invalid-probe');
  if (!Array.isArray(item.inputs) || item.inputs.length > 8) return fail('invalid-inputs');
  if (typeof item.contractId !== 'string' || !item.contractId.trim()) return fail('invalid-contract');
  if (typeof item.relationId !== 'string' || !item.relationId.trim()) return fail('invalid-relation');
  if (!Array.isArray(item.contractRefs) || item.contractRefs.length === 0 || item.contractRefs.length > 4) {
    return fail('invalid-contract-refs');
  }
  for (const ref of item.contractRefs) {
    if (typeof ref !== 'object' || ref === null || Array.isArray(ref)) return fail('invalid-contract-refs');
    const record = ref as Record<string, unknown>;
    if (
      typeof record.path !== 'string' || !record.path ||
      typeof record.sha256 !== 'string' || !SHA256.test(record.sha256) ||
      !Number.isSafeInteger(record.startLine) || Number(record.startLine) < 1 ||
      !Number.isSafeInteger(record.endLine) || Number(record.endLine) < Number(record.startLine)
    ) return fail('invalid-contract-refs');
  }
  if (!policy.contracts.some((contract) => contract.id === item.contractId)) {
    return fail('untrusted-contract');
  }
  return { ok: true, proposal: item as unknown as ChallengeProposal };
}

/**
 * Validates proposals against the operator-trusted policy and freezes at most
 * three of them.
 *
 * A proposal naming a contract the trusted policy does not declare is excluded
 * with a reason rather than accepted on the strength of its citation. Freezing
 * happens before any candidate exists, and the set hash covers everything a
 * later run would need to reproduce it.
 */
export function freezeChallengeSet(input: {
  proposals: readonly unknown[];
  policy: VerificationPolicy;
  baselineSnapshotHash: string;
  trustedPolicySha: string;
  contextHash: string;
  promptHash: string;
}): FrozenChallengeSet {
  const challenges: ChallengeProposal[] = [];
  const excluded: Array<{ id: string; reasonCode: string }> = [];
  const seen = new Set<string>();
  for (const value of input.proposals) {
    const result = validProposal(value, input.policy);
    if (!result.ok) {
      excluded.push({ id: result.id, reasonCode: result.reasonCode });
      continue;
    }
    if (seen.has(result.proposal.id)) {
      excluded.push({ id: result.proposal.id, reasonCode: 'duplicate-id' });
      continue;
    }
    if (challenges.length >= MAX_RETAINED_CHALLENGES) {
      excluded.push({ id: result.proposal.id, reasonCode: 'retention-limit' });
      continue;
    }
    seen.add(result.proposal.id);
    challenges.push(result.proposal);
  }
  const base = {
    version: CHALLENGE_SET_VERSION,
    baselineSnapshotHash: input.baselineSnapshotHash,
    trustedPolicySha: input.trustedPolicySha,
    contextHash: input.contextHash,
    promptHash: input.promptHash,
    challenges,
    excluded,
  };
  return { ...base, setHash: digest(canonicalJson(base)) };
}
