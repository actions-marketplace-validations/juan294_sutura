import { DEFAULT_MODELS } from '../config.js';
import type { GitHubApi, TextArtifactPort } from '../github/types.js';
import type { HttpResponse } from '../llm/nebius.js';
import { DEFAULT_ROUTING_PROFILE_ID } from '../llm/router.js';
import type { RepositoryPort } from '../orchestrate.js';
import type { ReplayOrchestrationConfig, ReplayRecorder } from './bundle.js';
import { recordedErrorResult } from './recorded-error.js';

export const RUN_ID = '77';
export const HEAD_SHA = 'a'.repeat(40);
export const REPOSITORY = 'acme/widget';
export const ARTIFACT_URL = 'https://github.com/acme/widget/actions/runs/88/artifacts/99';

export const CONFIGURATION = {
  triageN: 1,
  raceK: 1,
  models: DEFAULT_MODELS,
  routingProfileId: DEFAULT_ROUTING_PROFILE_ID,
  maxOps: 20,
  runtimeId: 'node',
} satisfies ReplayOrchestrationConfig;

export const artifact: TextArtifactPort = {
  uploadTextArtifact: async () => ({ url: ARTIFACT_URL }),
};

export function bytesResponse(body: unknown): HttpResponse & { arrayBuffer(): Promise<ArrayBuffer> } {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

export interface GitHubApiFixtureOptions {
  logLines: string[];
  startedAt: string;
  completedAt: string;
}

/**
 * Builds a `GitHubApi` fixture shared across the replay-bundle test helpers,
 * parameterised only on the scenario-specific job-log lines and step
 * timestamps.
 */
export function githubApi(options: GitHubApiFixtureOptions): GitHubApi {
  const workflowRun = {
    id: 77,
    headSha: HEAD_SHA,
    repository: REPOSITORY,
    event: 'push',
    conclusion: 'failure',
    headBranch: 'main',
    pullRequests: [],
  };
  return {
    getWorkflowRun: async () => workflowRun,
    listPullRequestsForCommit: async () => [],
    getPullRequest: async () => { throw new Error('unexpected getPullRequest'); },
    listJobsForWorkflowRun: async () => [{
      id: 9,
      name: 'test',
      conclusion: 'failure',
      steps: [{
        name: 'Run tests',
        conclusion: 'failure',
        startedAt: options.startedAt,
        completedAt: options.completedAt,
      }],
    }],
    downloadJobLogs: async () => options.logLines.join('\n'),
    listIssueComments: async () => [],
    listCommitComments: async () => [],
    createRef: async () => undefined,
    deleteRef: async () => undefined,
    createIssueComment: async () => ({ id: 102 }),
    createCommitComment: async () => ({ id: 102 }),
    updateIssueComment: async () => undefined,
    updateCommitComment: async () => undefined,
    getRefSha: async () => HEAD_SHA,
    getCommitParents: async () => [HEAD_SHA],
    getCommitSha: async () => HEAD_SHA,
    createPullRequest: async () => ({ number: 3, url: 'https://github.com/acme/widget/pull/3' }),
    listCheckRunsForRef: async () => [],
    createCheckRun: async () => ({ id: 101 }),
    updateCheckRun: async () => undefined,
  };
}

/**
 * Builds a `RepositoryPort` fixture shared across the replay-bundle test
 * helpers, parameterised only on the scenario-specific checkout files and
 * source-excerpt lookup.
 */
export function recordingRepository(
  checkoutDir: string,
  recorder: ReplayRecorder,
  checkoutFiles: Array<{ path: string; content: string }>,
  readExcerpts: RepositoryPort['readSourceExcerpts'] = async () => [],
): RepositoryPort {
  const record = async <T>(
    method: keyof RepositoryPort,
    args: unknown[],
    operation: () => Promise<T>,
    result: (value: T) => unknown = (value) => value,
  ): Promise<T> => {
    const sequence = recorder.reservePortSequence('repository');
    try {
      const value = await operation();
      recorder.recordRepository({ method, args, result: result(value) }, sequence);
      return value;
    } catch (error) {
      recorder.recordRepository({
        method,
        args,
        result: recordedErrorResult(error),
      }, sequence);
      throw error;
    }
  };
  return {
    readPolicyAtSha(repo, sha) {
      return record('readPolicyAtSha', [repo, sha], async () => null);
    },
    checkoutHead(repo, sha, headRef, prNumber) {
      return record(
        'checkoutHead',
        [repo, sha, headRef, prNumber],
        async () => checkoutDir,
        () => ({
          checkoutId: recorder.registerCheckoutPath(checkoutDir),
          snapshot: {
            runtimeEvidencePaths: ['package.json'],
            files: checkoutFiles,
          },
        }),
      );
    },
    readSourceExcerpts(dir, references, limits) {
      return record('readSourceExcerpts', [dir, references, limits], () => readExcerpts(dir, references, limits));
    },
    publishFix(input) {
      return record('publishFix', [input], async () => undefined);
    },
  };
}
