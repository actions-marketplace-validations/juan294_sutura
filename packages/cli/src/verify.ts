
import {
  ContreeExecutor,
  readBoundedRegularFile,
  executeExternalVerification,
  createTokenFactoryClient,
  trustedCommandsFromPolicy,
  validateVerifyRequest,
  type HealLlm,
  type ExternalVerificationResult,
  type Executor,
  type RepositoryPolicy,
  type SharedVerificationOutcome,
  type ValidatedVerifyRequest,
  type VerifyReproduction,
  type VerificationMode,
} from '@sutura/core';

import type { VerifyArguments } from './args.js';
import { assertCleanCheckoutAt, readTrustedPolicyAtCommit, snapshotCleanSourceAt } from './verify-source.js';

/** A supplied patch is bounded well below the policy diff limit before reading. */
export const MAX_CANDIDATE_DIFF_FILE_BYTES = 1024 * 1024;

export class VerifyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerifyInputError';
  }
}

/**
 * Reads the candidate patch once, from a regular file, without following a
 * symbolic link or racing a replacement.
 *
 * The handle is opened first and every check is made against that same handle,
 * so the bytes verified are the bytes measured. A directory, device, symlink or
 * oversized file is refused before any content is read into memory.
 */
export async function readCandidateDiffFile(path: string): Promise<string> {
  try {
    return (await readBoundedRegularFile(path, MAX_CANDIDATE_DIFF_FILE_BYTES)).toString('utf8');
  } catch (error) {
    throw new VerifyInputError(`Candidate diff file could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface VerifyPreparation {
  request: ValidatedVerifyRequest;
  policy: RepositoryPolicy;
  /** Where the trusted policy came from: the chosen commit, or built-in defaults. */
  policySource: 'repository' | 'default';
  policySha: string;
  /** The trusted command map this policy declares. */
  trustedCommands: Readonly<Record<string, string>>;
}

/**
 * Turns parsed arguments into a validated verification request.
 *
 * The order matters. The checkout is confirmed to sit exactly on the declared
 * source, the trusted policy is read from the operator's chosen commit rather
 * than from the working tree or the patch, and only then is the candidate
 * validated against it. All of that happens before anything executes, so an
 * untrusted command, an unparseable patch or a protected path is refused
 * without a sandbox ever starting.
 */
export async function prepareVerify(
  request: VerifyArguments,
  overrides: { skipCheckout?: boolean; trustedCommands?: Readonly<Record<string, string>> } = {},
): Promise<VerifyPreparation> {
  if (overrides.skipCheckout !== true) {
    await assertCleanCheckoutAt(request.caseDir, request.sourceSha);
  }
  const loaded = await readTrustedPolicyAtCommit(request.caseDir, request.policyBaseSha);
  const trustedCommands = overrides.trustedCommands ?? trustedCommandsFromPolicy(loaded.policy);
  const candidateDiff = await readCandidateDiffFile(request.candidateDiff);
  const validated = validateVerifyRequest({
    caseDir: request.caseDir,
    sourceSha: request.sourceSha,
    policyBaseSha: request.policyBaseSha,
    candidateDiff,
    failureCommandId: request.failingCommand,
    ...(request.runtime === undefined ? {} : { runtimeId: request.runtime }),
  }, loaded.policy, trustedCommands);
  return {
    request: validated,
    policy: loaded.policy,
    policySource: loaded.source,
    policySha: loaded.sha,
    trustedCommands,
  };
}

export interface VerifyExecutionResult {
  status: 'verified-supplied-patch' | 'refused' | 'insufficient' | 'infra-stop';
  request: ValidatedVerifyRequest;
  policySource: 'repository' | 'default';
  policySha: string;
  /** The immutable copy that executed, bound by hash. */
  source: { sourceSha: string; snapshotSha256: string; files: number };
  reproduction: VerifyReproduction['status'];
  challenges: ExternalVerificationResult['challenges'];
  budget: ExternalVerificationResult['budget'];
  evidence: ExternalVerificationResult['evidence'];
  verificationArtifact: ExternalVerificationResult['verificationArtifact'];
  observations: SharedVerificationOutcome['observations'];
  blockingGate: SharedVerificationOutcome['blockingGate'];
  challengeAssurance: boolean;
  /** Always false: verification never authors or applies a replacement. */
  generatedReplacement: false;
}

export interface VerifyRuntime {
  mode?: VerificationMode;
  executor: Executor;
  llm: HealLlm;
}

/**
 * Runs a supplied patch through preparation, reproduction and the shared gate
 * stack, against an immutable copy of the declared source.
 *
 * The copy is what executes, so nothing that happens to the developer's
 * checkout afterwards changes what this run verified. Nothing is generated and
 * nothing is written back: the result is evidence about the supplied bytes.
 */
export async function executeVerify(
  request: VerifyArguments,
  runtime: VerifyRuntime,
): Promise<VerifyExecutionResult> {
  const prepared = await prepareVerify(request);
  const snapshot = await snapshotCleanSourceAt(request.caseDir, request.sourceSha);
  try {
    const executed = await executeExternalVerification({
      request: prepared.request, policy: prepared.policy,
      executor: runtime.executor, llm: runtime.llm, sourceDir: snapshot.dir,
      snapshotSha256: snapshot.snapshotSha256, policySha256: prepared.policySha,
      mode: runtime.mode ?? 'local',
    });
    const outcome = executed.verification;
    return {
      status: executed.status,
      request: prepared.request,
      policySource: prepared.policySource,
      policySha: prepared.policySha,
      source: {
        sourceSha: snapshot.sourceSha,
        snapshotSha256: snapshot.snapshotSha256,
        files: snapshot.files.length,
      },
      reproduction: executed.reproduction.status,
      challenges: executed.challenges,
      budget: executed.budget,
      evidence: executed.evidence,
      verificationArtifact: executed.verificationArtifact,
      observations: outcome.observations,
      blockingGate: outcome.blockingGate,
      challengeAssurance: outcome.challengeAssurance,
      generatedReplacement: false,
    };
  } finally {
    await snapshot.cleanup();
  }
}

/** Builds the sandbox client from the environment, as `sutura heal` does. */
export function verifyRuntimeFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): VerifyRuntime {
  const token = environment.CONTREE_TOKEN;
  const project = environment.CONTREE_PROJECT;
  if (!token) throw new VerifyInputError('CONTREE_TOKEN is required to execute a verification');
  if (!project) throw new VerifyInputError('CONTREE_PROJECT is required to execute a verification');
  const apiKey = environment.NEBIUS_API_KEY;
  if (!apiKey) throw new VerifyInputError('NEBIUS_API_KEY is required to execute a verification');
  return { mode: 'live', executor: new ContreeExecutor({ token, project }), llm: createTokenFactoryClient({ apiKey }) };
}
