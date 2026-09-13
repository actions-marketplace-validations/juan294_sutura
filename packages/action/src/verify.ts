import {
  createDefaultRepositoryPolicy,
  trustedCommandsFromPolicy,
  validateVerifyRequest,
  VerifyRequestError,
  type RepositoryPolicy,
  type ValidatedVerifyRequest,
} from '@sutura/core';

import type { InputReader } from './input.js';

const EXACT_SHA = /^[a-f0-9]{40}$/u;

export class VerifyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerifyInputError';
  }
}

export interface ActionVerifyInputs {
  sourceSha: string;
  policyBaseSha: string;
  candidateDiff: string;
  failingCommandId: string;
  runtimeId?: 'node' | 'python';
}

function required(read: InputReader, name: string): string {
  const value = read(name).trim();
  if (!value) throw new VerifyInputError(`${name} is required for verification`);
  return value;
}

/**
 * A patch is kept byte for byte. Trimming it would strip the trailing newline a
 * unified diff needs, so presence is checked without altering the bytes that
 * will be verified.
 */
function requiredPatch(read: InputReader, name: string): string {
  const value = read(name);
  if (!value.trim()) throw new VerifyInputError(`${name} is required for verification`);
  return value;
}

/**
 * Reads the verification inputs.
 *
 * The trusted policy commit comes from the workflow's own configuration, so a
 * pull request cannot ask for a more permissive policy by supplying one in its
 * patch. A short sha or branch name is refused: verification is tied to the
 * exact commit that failed.
 */
export function mapVerifyInputs(read: InputReader): ActionVerifyInputs {
  const sourceSha = required(read, 'source-sha');
  const policyBaseSha = required(read, 'policy-base-sha');
  for (const [name, value] of [['source-sha', sourceSha], ['policy-base-sha', policyBaseSha]]) {
    if (!EXACT_SHA.test(value!)) {
      throw new VerifyInputError(`${name} must be an exact lowercase 40-character commit`);
    }
  }
  const runtime = read('runtime').trim();
  if (runtime && !['auto', 'node', 'python'].includes(runtime)) {
    throw new VerifyInputError('runtime must be auto, node, or python');
  }
  return {
    sourceSha,
    policyBaseSha,
    candidateDiff: requiredPatch(read, 'candidate-diff'),
    failingCommandId: required(read, 'failing-command'),
    ...(runtime === 'node' || runtime === 'python' ? { runtimeId: runtime } : {}),
  };
}

/**
 * What this route treats as trusted.
 *
 * The policy is the one the workflow resolved from the operator's chosen
 * commit, never one the patch carries. The command map is derived from that
 * policy unless the caller supplies one, so the Action and the CLI resolve a
 * failing command the same way.
 */
export interface ActionVerifyTrust {
  policy?: RepositoryPolicy;
  commands?: Readonly<Record<string, string>>;
}

export interface ActionVerifyResult {
  status: 'validated';
  request: ValidatedVerifyRequest;
  /** The command map the trusted policy declared for this run. */
  trustedCommands: Readonly<Record<string, string>>;
  /**
   * Structural facts about this route, asserted rather than described: it never
   * writes to the repository and never authors a replacement.
   */
  repositoryMutation: false;
  generatedReplacement: false;
}

/**
 * The Action's verification route.
 *
 * It takes no repository port and returns no pull-request intent, so there is
 * no path from here to a branch, commit, comment or check-run write. That is a
 * property of the signature, not a rule this function remembers to follow.
 */
export function verifyActionRequest(
  inputs: ActionVerifyInputs,
  caseDir: string,
  trust: ActionVerifyTrust = {},
): ActionVerifyResult {
  const policy = trust.policy ?? createDefaultRepositoryPolicy();
  const trustedCommands = trust.commands ?? trustedCommandsFromPolicy(policy);
  let request: ValidatedVerifyRequest;
  try {
    request = validateVerifyRequest({
      caseDir,
      sourceSha: inputs.sourceSha,
      policyBaseSha: inputs.policyBaseSha,
      candidateDiff: inputs.candidateDiff,
      failureCommandId: inputs.failingCommandId,
      ...(inputs.runtimeId === undefined ? {} : { runtimeId: inputs.runtimeId }),
    }, policy, trustedCommands);
  } catch (error) {
    if (error instanceof VerifyRequestError) {
      throw new VerifyInputError(`Verification refused the request: ${error.reasonCode}`);
    }
    throw error;
  }
  return {
    status: 'validated',
    request,
    trustedCommands,
    repositoryMutation: false,
    generatedReplacement: false,
  };
}
