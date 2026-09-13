import { Buffer } from 'node:buffer';

import { parseUnifiedDiff } from './diff/unified.js';
import { evaluatePatchPolicy, policyAllowsPatchPath } from './policy/evaluate.js';
import type { RepositoryPolicy } from './policy/schema.js';
import { isSensitiveRepositoryPath, isVerificationPrivatePath } from './security/repository-path.js';
import type { RuntimeId } from './runtime/types.js';
import { repairTargetFileCap } from './engine/repair-targets.js';
import {
  evaluateVerification,
  verificationApproved,
  type ChallengeMode,
  type SharedVerificationOutcome,
  type VerificationGateRunner,
} from './verification/evaluate.js';

const EXACT_SHA = /^[a-f0-9]{40}$/u;

/** Paths a supplied patch may never touch, whatever the repository policy says. */
export const VERIFY_RESERVED_PATHS = Object.freeze(['.sutura.json']);

export interface VerifyRequest {
  caseDir: string;
  sourceSha: string;
  policyBaseSha: string;
  /** The supplied patch bytes; the CLI reads them from a file. */
  candidateDiff: string;
  failureCommandId: string;
  runtimeId?: RuntimeId;
}

export class VerifyRequestError extends Error {
  constructor(readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'VerifyRequestError';
  }
}

export interface ValidatedVerifyRequest {
  caseDir: string;
  sourceSha: string;
  policyBaseSha: string;
  candidateDiff: string;
  failureCommandId: string;
  failingCommand: string;
  runtimeId: RuntimeId | 'auto';
  changedFiles: string[];
  diffBytes: number;
}

function refuse(reasonCode: string, message: string): never {
  throw new VerifyRequestError(reasonCode, message);
}

/**
 * Validates every identity and trust input before anything executes and before
 * any provider is called.
 *
 * The trusted policy commit is chosen by the operator, never by the patch or
 * the failing checkout, and the failing command must resolve to a
 * controller-owned or policy-allowlisted command rather than merely looking
 * like printable text. A patch that reaches the trusted policy declaration,
 * harness storage or any sensitive path is refused here, not later.
 */
export function validateVerifyRequest(
  request: VerifyRequest,
  policy: RepositoryPolicy,
  trustedCommands: Readonly<Record<string, string>>,
): ValidatedVerifyRequest {
  if (typeof request.caseDir !== 'string' || !request.caseDir.trim()) {
    refuse('invalid-case-dir', 'A clean source checkout directory is required');
  }
  if (!EXACT_SHA.test(request.sourceSha)) {
    refuse('invalid-source-sha', 'source-sha must be an exact 40-character commit');
  }
  if (!EXACT_SHA.test(request.policyBaseSha)) {
    refuse('invalid-policy-base-sha', 'policy-base-sha must be an exact 40-character commit');
  }
  if (request.runtimeId !== undefined && !['node', 'python'].includes(request.runtimeId)) {
    refuse('unsupported-runtime', `Unsupported runtime: ${String(request.runtimeId)}`);
  }
  const failingCommand = trustedCommands[request.failureCommandId];
  if (failingCommand === undefined || !failingCommand.trim()) {
    refuse('untrusted-command', `Failing command ${request.failureCommandId} is not trusted`);
  }

  const diff = request.candidateDiff;
  if (typeof diff !== 'string' || !diff.trim()) {
    refuse('empty-candidate', 'A non-empty candidate diff is required');
  }
  const diffBytes = Buffer.byteLength(diff, 'utf8');
  if (diffBytes > policy.maxDiffBytes) {
    refuse('candidate-too-large', `Candidate diff is ${diffBytes} bytes; policy permits ${policy.maxDiffBytes}`);
  }
  const parsed = parseUnifiedDiff(diff);
  if (!parsed.valid || parsed.files.length === 0) {
    refuse('unparsable-candidate', 'Candidate diff is not a complete unified diff');
  }
  const changedFiles = [...new Set(parsed.files.flatMap(({ oldPath, newPath }) =>
    [oldPath, newPath].filter((path): path is string => path !== null)))];
  const cap = repairTargetFileCap(policy);
  if (changedFiles.length > cap) {
    refuse('too-many-files', `Candidate changes ${changedFiles.length} files; at most ${cap} are permitted`);
  }
  for (const path of changedFiles) {
    if (VERIFY_RESERVED_PATHS.includes(path)) {
      refuse('protected-path', `Candidate may not change the trusted policy declaration: ${path}`);
    }
    if (isVerificationPrivatePath(path) || isSensitiveRepositoryPath(path)) {
      refuse('protected-path', `Candidate may not change a reserved or sensitive path: ${path}`);
    }
    if (!policyAllowsPatchPath(path, policy)) {
      refuse('policy-denied', `Repository policy denies changes to ${path}`);
    }
  }
  const policyVerdict = evaluatePatchPolicy(diff, policy);
  if (!policyVerdict.ok) {
    refuse('policy-denied', policyVerdict.violations.join('; '));
  }

  return {
    caseDir: request.caseDir,
    sourceSha: request.sourceSha,
    policyBaseSha: request.policyBaseSha,
    candidateDiff: diff,
    failureCommandId: request.failureCommandId,
    failingCommand,
    runtimeId: request.runtimeId ?? 'auto',
    changedFiles,
    diffBytes,
  };
}

/**
 * The command map a trusted policy declares.
 *
 * The first required command is the diagnosed failure; the rest keep stable
 * identifiers so a request names a command the operator's policy already
 * declares rather than supplying command text of its own.
 */
export function trustedCommandsFromPolicy(
  policy: Pick<RepositoryPolicy, 'requiredCommands'>,
): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(policy.requiredCommands.map((command, index) =>
    [index === 0 ? 'diagnosed' : `required-${index}`, command])));
}

export type VerifyOutcomeStatus =
  | 'verified-supplied-patch' | 'refused' | 'insufficient' | 'infra-stop';

export interface VerifyResult {
  status: VerifyOutcomeStatus;
  request: ValidatedVerifyRequest;
  verification: SharedVerificationOutcome;
  /** Always false: verification never authors or proposes a replacement. */
  generatedReplacement: false;
}

export interface VerifyPorts {
  /** Runs one gate of the shared stack against the supplied patch. */
  runGate: VerificationGateRunner;
  challengeMode?: ChallengeMode;
}

/**
 * Verifies a supplied patch through the same shared gate stack a generated
 * repair walks.
 *
 * This route never generates a replacement, never opens a pull request and
 * never accepts an uploaded log in place of sandbox execution. Challenge
 * verification defaults to `required`, so a missing contract abstains as
 * `insufficient` rather than approving on the visible suite alone.
 */
export async function verifyExternalPatch(
  request: VerifyRequest,
  policy: RepositoryPolicy,
  trustedCommands: Readonly<Record<string, string>>,
  ports: VerifyPorts,
): Promise<VerifyResult> {
  const validated = validateVerifyRequest(request, policy, trustedCommands);
  const verification = await evaluateVerification({
    challengeMode: ports.challengeMode ?? 'required',
    runGate: ports.runGate,
  });
  const status: VerifyOutcomeStatus = verificationApproved(verification)
    ? 'verified-supplied-patch'
    : verification.status === 'infra-stop'
      ? 'infra-stop'
      : verification.status === 'insufficient'
        ? 'insufficient'
        : 'refused';
  return { status, request: validated, verification, generatedReplacement: false };
}
