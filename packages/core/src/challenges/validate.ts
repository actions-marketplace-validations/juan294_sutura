import { posix } from 'node:path';

import { isSensitiveRepositoryPath, isVerificationPrivatePath } from '../security/repository-path.js';
import { policyAllowsSourceRead } from '../policy/evaluate.js';
import type { RepositoryPolicy } from '../policy/schema.js';
import type { ChallengeProposal } from './generate.js';

/** Relations the controller can evaluate; anything else is unsupported, not guessed. */
export const SUPPORTED_RELATIONS = Object.freeze([
  'equals', 'not-equals', 'greater-than', 'less-than', 'is-true', 'is-false',
]);

/** A relation that holds for every value tells us nothing about a candidate. */
export const TAUTOLOGICAL_RELATIONS = Object.freeze(['always-true', 'any', 'exists']);

export const MAX_CHALLENGE_INPUT_BYTES = 4_096;

export type ChallengeRejectionCode =
  | 'absolute-target'
  | 'traversal-target'
  | 'symlink-target'
  | 'reserved-target'
  | 'denied-source'
  | 'source-hash-mismatch'
  | 'oversized-inputs'
  | 'unknown-relation'
  | 'tautological-relation'
  | 'unknown-contract'
  | 'executable-override';

export interface ChallengeValidationContext {
  policy: RepositoryPolicy;
  /** Exact baseline source hashes the controller holds, by path. */
  sourceHashes: ReadonlyMap<string, string>;
  /** Paths the controller resolved to a symbolic link. */
  symlinkPaths?: ReadonlySet<string>;
  /** Contract identifiers the operator-trusted policy declares. */
  trustedContractIds: ReadonlySet<string>;
}

export type ChallengeValidation =
  | { ok: true }
  | { ok: false; reasonCode: ChallengeRejectionCode; detail: string };

function reject(reasonCode: ChallengeRejectionCode, detail: string): ChallengeValidation {
  return { ok: false, reasonCode, detail };
}

/**
 * Validates one proposal's targets, inputs and relation against the controller's
 * own view of the baseline.
 *
 * Every check here answers the same question: can the controller evaluate this
 * itself, from something it already trusts? A path it cannot resolve to an
 * exact known source hash, a relation it cannot compute, or a contract the
 * trusted policy does not declare all abstain rather than being interpreted
 * generously.
 */
export function validateChallengeProposal(
  proposal: ChallengeProposal,
  context: ChallengeValidationContext,
): ChallengeValidation {
  if (!context.trustedContractIds.has(proposal.contractId)) {
    return reject('unknown-contract', `${proposal.contractId} is not declared by the trusted policy`);
  }
  if (TAUTOLOGICAL_RELATIONS.includes(proposal.relationId)) {
    return reject('tautological-relation', `${proposal.relationId} holds for every value`);
  }
  if (!SUPPORTED_RELATIONS.includes(proposal.relationId)) {
    return reject('unknown-relation', `${proposal.relationId} is not a supported relation`);
  }

  for (const ref of proposal.contractRefs) {
    const path = ref.path;
    if (path.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(path)) {
      return reject('absolute-target', `${path} is an absolute path`);
    }
    if (path.split('/').includes('..') || posix.normalize(path) !== path) {
      return reject('traversal-target', `${path} escapes the repository root`);
    }
    if (context.symlinkPaths?.has(path) === true) {
      return reject('symlink-target', `${path} resolves through a symbolic link`);
    }
    if (isVerificationPrivatePath(path) || isSensitiveRepositoryPath(path)) {
      return reject('reserved-target', `${path} is reserved or sensitive`);
    }
    if (!policyAllowsSourceRead(path, context.policy)) {
      return reject('denied-source', `Repository policy denies reading ${path}`);
    }
    const known = context.sourceHashes.get(path);
    if (known === undefined || known !== ref.sha256) {
      return reject('source-hash-mismatch', `${path} does not match the controller's baseline source`);
    }
  }

  const inputBytes = Buffer.byteLength(JSON.stringify(proposal.inputs), 'utf8');
  if (inputBytes > MAX_CHALLENGE_INPUT_BYTES) {
    return reject('oversized-inputs', `Inputs are ${inputBytes} bytes; at most ${MAX_CHALLENGE_INPUT_BYTES}`);
  }
  for (const input of proposal.inputs) {
    if (typeof input === 'function' || typeof input === 'symbol' || input === undefined) {
      return reject('executable-override', 'Inputs must be bounded typed values');
    }
  }
  return { ok: true };
}
