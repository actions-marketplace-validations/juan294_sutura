import { runActionVerification, type ActionVerificationContext, type ActionVerificationOutcome } from './verify-execution.js';
import { mapVerifyInputs, type ActionVerifyInputs } from './verify.js';
import { DefaultArtifactClient } from '@actions/artifact';
import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  AlreadyAttemptedError,
  ContreeExecutor,
  ReplayRecorder,
  TavilyClient,
  createTokenFactoryClient,
  loadConfig,
  orchestrate,
  recordingContreeFetch,
  recordingExecutor,
  recordingNebiusFetch,
  recordingTavilyFetch,
  type Config,
  type ConfigEnvironment,
  type OrchestrationContext,
} from '@sutura/core';

import { GitHubAdapter } from './github.js';
import { reportOutcome } from './acceptance.js';
import { runtimeEvidence } from './evidence.js';
import { withFailureSafeCheck } from './failure-safe.js';
import { mapActionInputs, type ActionConfiguration } from './input.js';
import { createGitHubApi } from './octokit.js';
import { GitRepository } from './repository.js';
import { recordingGitHubApi } from './replay-github.js';
import { recordingRepositoryPort } from './replay-repository.js';

export interface RunActionDependencies {
  readAction(): ActionConfiguration;
  readVerification(): ActionVerifyInputs;
  verify(inputs: ActionVerifyInputs, context: ActionVerificationContext): Promise<ActionVerificationOutcome>;
  loadConfiguration(environment: ConfigEnvironment): Config;
  repository(): { owner: string; repo: string };
  environment: Readonly<Record<string, string | undefined>>;
  setFailed(message: string): void;
}

const DEFAULT_DEPENDENCIES: RunActionDependencies = {
  readAction: () => mapActionInputs((name) => core.getInput(name)),
  readVerification: () => mapVerifyInputs((name) => core.getInput(name)),
  verify: runActionVerification,
  loadConfiguration: loadConfig,
  repository: () => github.context.repo,
  environment: process.env,
  setFailed: (message) => core.setFailed(message),
};

export async function runAction(
  overrides: Partial<RunActionDependencies> = {},
): Promise<void> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  let requireFixed = false;
  try {
    const action = dependencies.readAction();
    requireFixed = action.requireFixed;
    const config = dependencies.loadConfiguration(action.environment);
    if (!config.contreeToken || !config.contreeProject) {
      throw new Error('ConTree token and project are required by the GitHub Action');
    }
    const { owner, repo } = dependencies.repository();
    const actionRunId = dependencies.environment.GITHUB_RUN_ID;
    if (!actionRunId || !/^[1-9]\d*$/.test(actionRunId)) {
      throw new Error('GITHUB_RUN_ID must be a positive decimal id');
    }
    if (action.mode === 'verify') {
      const result = await dependencies.verify(dependencies.readVerification(), {
        owner, repo, runId: action.runId, githubToken: action.githubToken, config,
      });
      if (result.status !== 'verified-supplied-patch') {
        dependencies.setFailed(`Sutura verification: ${result.status}`);
      }
      return;
    }
    const octokit = github.getOctokit(action.githubToken);
    const orchestrationOptions = {
      triageN: config.triageN,
      raceK: config.raceK,
      repairBudgets: config.repairBudgets,
      search: config.search,
      sourceReferenceOrder: 'latest',
      repairVerificationScope: 'failing-workspace',
      ...(config.runtimeId === undefined ? {} : { runtimeId: config.runtimeId }),
    } satisfies Pick<
      OrchestrationContext,
      'triageN' | 'raceK' | 'repairBudgets' | 'search' | 'runtimeId' |
      'sourceReferenceOrder'
      | 'repairVerificationScope'
    >;
    const recorder = action.captureReplay
      ? new ReplayRecorder(
          action.runId,
          `${owner}/${repo}`,
          dependencies.environment.GITHUB_SHA ?? '',
          {
            ...orchestrationOptions,
            models: config.models,
            routingProfileId: config.routingProfileId,
            maxOps: config.maxOps,
          },
          [
            action.githubToken,
            config.nebiusApiKey,
            config.tavilyApiKey ?? '',
            config.contreeToken,
            config.contreeProject,
          ],
        )
      : undefined;
    const nebius = createTokenFactoryClient({
      apiKey: config.nebiusApiKey,
      models: config.models,
      routingProfileId: config.routingProfileId,
    }, recorder ? {
      fetch: recordingNebiusFetch(
        recorder,
        globalThis.fetch as Parameters<typeof recordingNebiusFetch>[1],
      ),
    } : {});
    const githubApi = createGitHubApi(octokit, owner, repo);
    const adapter = new GitHubAdapter(
      recorder ? recordingGitHubApi(githubApi, recorder) : githubApi,
      {
        owner,
        repo,
        runId: action.runId,
        actionRunId,
        artifact: new DefaultArtifactClient(),
      },
    );
    const baseRepository = new GitRepository({
      token: action.githubToken,
      ...(dependencies.environment.RUNNER_TEMP
        ? { workspaceRoot: dependencies.environment.RUNNER_TEMP }
        : {}),
    });
    const repository = recorder
      ? recordingRepositoryPort(baseRepository, recorder)
      : baseRepository;
    const baseExecutor = new ContreeExecutor({
      token: config.contreeToken,
      project: config.contreeProject,
      maxOps: config.maxOps,
      ...(recorder
        ? { fetch: recordingContreeFetch(recorder, globalThis.fetch) }
        : {}),
    });
    const executor = recorder
      ? recordingExecutor(baseExecutor, recorder)
      : baseExecutor;
    const tavily = config.tavilyApiKey
      ? new TavilyClient(config.tavilyApiKey, recorder ? {
          fetch: recordingTavilyFetch(
            recorder,
            globalThis.fetch as Parameters<typeof recordingTavilyFetch>[1],
          ),
        } : {})
      : undefined;

    const result = await withFailureSafeCheck(adapter, () => orchestrate({
      evidenceMode: 'live',
      runId: action.runId,
      github: adapter,
      repository,
      executor,
      llm: nebius,
      cost: nebius.ledger,
      ...orchestrationOptions,
      ...(tavily ? { tavily } : {}),
      ...(recorder ? { replay: recorder } : {}),
    }), (message) => core.warning(message), recorder, {
      actionRunId,
      targetRunId: action.runId,
      repository: `${owner}/${repo}`,
      actionSha: dependencies.environment.GITHUB_SHA ?? '',
    });
    reportOutcome(result.outcome, action.requireFixed, core);
    for (const evidence of runtimeEvidence(result)) core.info(evidence);
    core.info(`Sutura outcome: ${result.outcome}`);
  } catch (error) {
    if (error instanceof AlreadyAttemptedError) {
      core.info(error.message);
      reportOutcome('already-attempted', requireFixed, core);
      return;
    }
    dependencies.setFailed(error instanceof Error ? error.message : String(error));
  }
}
