import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DefaultArtifactClient } from '@actions/artifact';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { ContreeExecutor, createTokenFactoryClient, executeExternalVerification, readTrustedPolicyAtCommit, snapshotCleanSourceAt, type Config, type ExternalVerificationResult, } from '@sutura/core';
import { GitRepository } from './repository.js';
import { verifyActionRequest, type ActionVerifyInputs } from './verify.js';
interface WorkflowIdentity {
  id: number;
  head_sha: string;
  repository: {
    full_name: string;
  };
  head_repository: {
    full_name: string;
  } | null;
  conclusion: string | null;
}
/** This authentication boundary accepts GET only, with no repository mutation port. */
export async function authenticateVerifyRun(api: {
  getWorkflowRun(input: {
    owner: string;
    repo: string;
    run_id: number;
  }): Promise<{
    data: WorkflowIdentity;
  }>;
}, owner: string, repo: string, runId: string, sourceSha: string): Promise<void> {
  if (!/^[1-9]\d*$/u.test(runId) || !Number.isSafeInteger(Number(runId)))
    throw Error('Verification run id is invalid');
  const { data } = await api.getWorkflowRun({ owner, repo, run_id: Number(runId) });
  const repository = `${owner}/${repo}`;
  if (data.id !== Number(runId) || data.head_sha !== sourceSha || data.repository.full_name !== repository || data.head_repository?.full_name !== repository || !['failure', 'timed_out'].includes(data.conclusion ?? '')) {
    throw Error('Verification requires an authenticated failed run at the exact source in this repository; fork and identity mismatches are refused');
  }
}
export interface ActionVerificationContext {
  owner: string;
  repo: string;
  runId: string;
  githubToken: string;
  config: Config;
}
export type ActionVerificationOutcome = Pick<ExternalVerificationResult, 'status'>;
async function execute(inputs: ActionVerifyInputs, context: ActionVerificationContext): Promise<ActionVerificationOutcome> {
  const octokit = github.getOctokit(context.githubToken);
  await authenticateVerifyRun(octokit.rest.actions, context.owner, context.repo, context.runId, inputs.sourceSha);
  const root = await mkdtemp(join(tmpdir(), 'sutura-verify-action-'));
  const repository = new GitRepository({ token: context.githubToken, workspaceRoot: root });
  let snapshot: Awaited<ReturnType<typeof snapshotCleanSourceAt>> | undefined;
  try {
    const name = `${context.owner}/${context.repo}`;
    const source = await repository.checkoutHead(name, inputs.sourceSha);
    const policySource = inputs.policyBaseSha === inputs.sourceSha ? source : await repository.checkoutHead(name, inputs.policyBaseSha);
    const trusted = await readTrustedPolicyAtCommit(policySource, inputs.policyBaseSha);
    const validated = verifyActionRequest(inputs, source, { policy: trusted.policy });
    snapshot = await snapshotCleanSourceAt(source, inputs.sourceSha);
    const config = context.config;
    if (!config.contreeToken || !config.contreeProject)
      throw Error('Verification needs ConTree configuration');
    const llm = createTokenFactoryClient({ apiKey: config.nebiusApiKey, models: config.models, routingProfileId: config.routingProfileId });
    const executor = new ContreeExecutor({ token: config.contreeToken, project: config.contreeProject, maxOps: config.maxOps });
    const result = await executeExternalVerification({ mode: 'live', request: validated.request, policy: trusted.policy, executor, llm, sourceDir: snapshot.dir, snapshotSha256: snapshot.snapshotSha256, policySha256: trusted.sha === 'default' ? createHash('sha256').update(JSON.stringify(trusted.policy)).digest('hex') : trusted.sha, budgets: config.repairBudgets });
    const evidence = { schemaVersion: 'sutura-action-verification-v1', repository: name, runId: context.runId, sourceSha: inputs.sourceSha, policyBaseSha: inputs.policyBaseSha, snapshotSha256: snapshot.snapshotSha256, diffSha256: createHash('sha256').update(inputs.candidateDiff).digest('hex'), ...result, repositoryMutation: false };
    const file = join(root, 'verification.json');
    await writeFile(file, JSON.stringify(evidence, null, 2), 'utf8');
    await new DefaultArtifactClient().uploadArtifact(`sutura-verification-${context.runId}`, [file], root);
    await core.summary.addHeading('Sutura supplied patch verification').addCodeBlock(JSON.stringify({ status: result.status, blockingGate: result.verification.blockingGate, challengeAssurance: result.verification.challengeAssurance, sourceSha: inputs.sourceSha, policyBaseSha: inputs.policyBaseSha }, null, 2), 'json').write();
    core.setOutput('verification-status', result.status);
    return { status: result.status };
  }
  finally {
    await snapshot?.cleanup();
    await rm(root, { recursive: true, force: true });
  }
}
export async function runActionVerification(inputs: ActionVerifyInputs, context: ActionVerificationContext, dependencies: {
  execute: typeof execute;
} = { execute }): Promise<ActionVerificationOutcome> {
  return dependencies.execute(inputs, context);
}
