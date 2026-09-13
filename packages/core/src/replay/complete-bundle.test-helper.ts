import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_MODELS } from '../config.js';
import { TavilyClient, type TavilyHttpResponse } from '../diagnose/tavily.js';
import type {
  CancellationResult,
  Executor,
  ImageId,
  OperationCapacity,
  RunResult,
} from '../executor/types.js';
import { GitHubAdapter } from '../github/adapter.js';
import type { GitHubApi, TextArtifactPort } from '../github/types.js';
import type { HttpResponse } from '../llm/nebius.js';
import { DEFAULT_ROUTING_PROFILE_ID } from '../llm/router.js';
import { createTokenFactoryClient } from '../llm/token-factory.js';
import { orchestrate, type RepositoryPort } from '../orchestrate.js';
import {
  REPLAY_BUNDLE_SCHEMA_VERSION,
  ReplayRecorder,
  type ReplayBundle,
  type ReplayOrchestrationConfig,
} from './bundle.js';
import { recordingExecutor } from './record-executor.js';
import { recordingNebiusFetch, recordingTavilyFetch } from './record-fetch.js';
import { recordingGitHubApi } from './record-github.js';
import { recordedErrorResult } from './recorded-error.js';

const RUN_ID = '77';
const HEAD_SHA = 'a'.repeat(40);
const REPOSITORY = 'acme/widget';
const PACKAGE_JSON = '{"scripts":{"test":"vitest run"}}\n';
const ARTIFACT_URL = 'https://github.com/acme/widget/actions/runs/88/artifacts/99';

const CONFIGURATION = {
  triageN: 1,
  raceK: 1,
  models: DEFAULT_MODELS,
  routingProfileId: DEFAULT_ROUTING_PROFILE_ID,
  maxOps: 20,
  runtimeId: 'node',
} satisfies ReplayOrchestrationConfig;

function bytesResponse(body: unknown): HttpResponse & { arrayBuffer(): Promise<ArrayBuffer> } {
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

function tavilyResponse(body: unknown): TavilyHttpResponse & { arrayBuffer(): Promise<ArrayBuffer> } {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return {
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

function runResult(imageId: string, exitCode: number): RunResult {
  return {
    imageId,
    exitCode,
    stdout: '',
    stderr: exitCode === 0 ? '' : 'Error: build failed',
    truncated: false,
    metrics: { elapsedTimeSec: 0.1, cost: 0.001 },
  };
}

class CompleteReplayExecutor implements Executor {
  private snapshotCount = 0;
  private runCount = 0;

  importImage(): Promise<ImageId> {
    return Promise.resolve('image-1');
  }

  snapshot(): Promise<ImageId> {
    this.snapshotCount += 1;
    return Promise.resolve(this.snapshotCount === 1 ? 'image-2' : 'image-4');
  }

  run(_parent: ImageId, command: string): Promise<RunResult> {
    if (command.startsWith('SUTURA_TRIAGE_ATTEMPT=')) return Promise.resolve(runResult('image-7', 0));
    this.runCount += 1;
    if (this.runCount === 1) return Promise.resolve(runResult('image-3', 0));
    if (this.runCount === 2) return Promise.resolve(runResult('image-5', 0));
    return Promise.resolve(runResult('image-6', 1));
  }

  runMany(...[, commands]: Parameters<Executor['runMany']>): Promise<RunResult[]> {
    return Promise.resolve(commands.map(() => runResult('image-7', 0)));
  }

  operationCapacity(): OperationCapacity {
    return { limit: 2, active: 0, available: 2 };
  }

  cancel(operationId: string): Promise<CancellationResult> {
    return Promise.resolve({ operationId, requested: true });
  }
}

function githubApi(): GitHubApi {
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
        startedAt: '2026-08-30T10:00:00Z',
        completedAt: '2026-08-30T10:00:01Z',
      }],
    }],
    downloadJobLogs: async () => [
      '2026-08-30T10:00:00Z ##[group]Run tests',
      '2026-08-30T10:00:00Z Run pnpm test',
      '2026-08-30T10:00:01Z Error: build failed',
    ].join('\n'),
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

function recordingRepository(
  checkoutDir: string,
  recorder: ReplayRecorder,
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
            files: [{ path: 'package.json', content: PACKAGE_JSON }],
          },
        }),
      );
    },
    readSourceExcerpts(dir, references, limits) {
      return record('readSourceExcerpts', [dir, references, limits], async () => []);
    },
    publishFix(input) {
      return record('publishFix', [input], async () => undefined);
    },
  };
}

const artifact: TextArtifactPort = {
  uploadTextArtifact: async () => ({ url: ARTIFACT_URL }),
};

export async function createCompleteReplayBundleForTest(): Promise<ReplayBundle> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'sutura-complete-replay-'));
  const checkoutDir = join(temporaryRoot, 'checkout');
  await mkdir(checkoutDir);
  await writeFile(join(checkoutDir, 'package.json'), PACKAGE_JSON, 'utf8');
  const recorder = new ReplayRecorder(RUN_ID, REPOSITORY, HEAD_SHA, CONFIGURATION);
  recorder.recordHttp({
    boundary: 'contree',
    request: { method: 'POST', url: 'https://contree.invalid/logical', headers: {}, body: null },
    response: { status: 200, headers: {}, body: '{}' },
    latencyMs: 0,
  });
  const llm = createTokenFactoryClient({
    apiKey: 'capture-only',
    models: CONFIGURATION.models,
    routingProfileId: CONFIGURATION.routingProfileId,
  }, {
    fetch: recordingNebiusFetch(recorder, async () => bytesResponse({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            class: 'build',
            confidence: 0.9,
            signals: ['captured-integration'],
            failingCmd: 'pnpm test',
            errorExcerpt: 'Error: build failed',
          }),
        },
      }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    })),
  });
  const tavily = new TavilyClient('capture-only', {
    fetch: recordingTavilyFetch(recorder, async () => tavilyResponse({ results: [] })),
  });
  try {
    const caseFile = await orchestrate({
      runId: RUN_ID,
      github: new GitHubAdapter(recordingGitHubApi(githubApi(), recorder), {
        owner: 'acme',
        repo: 'widget',
        runId: RUN_ID,
        artifact,
      }),
      repository: recordingRepository(checkoutDir, recorder),
      executor: recordingExecutor(new CompleteReplayExecutor(), recorder),
      llm,
      cost: llm.ledger,
      triageN: CONFIGURATION.triageN,
      raceK: CONFIGURATION.raceK,
      tavily,
      runtimeId: 'node',
    });
    const bundle = recorder.finish(caseFile.outcome);
    if (bundle.schemaVersion !== REPLAY_BUNDLE_SCHEMA_VERSION || !bundle.completeness.complete) {
      throw new Error('Complete replay fixture capture did not record every boundary');
    }
    return bundle;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
