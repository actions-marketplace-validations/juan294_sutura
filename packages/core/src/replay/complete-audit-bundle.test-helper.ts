import { Buffer } from 'node:buffer';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_MODELS } from '../config.js';
import type {
  CancellationResult,
  Executor,
  ImageId,
  OperationCapacity,
  RunResult,
} from '../executor/types.js';
import { TavilyClient } from '../diagnose/tavily.js';
import { GitHubAdapter } from '../github/adapter.js';
import type { GitHubApi, TextArtifactPort } from '../github/types.js';
import type { HttpResponse } from '../llm/nebius.js';
import { OpenAiClient } from '../llm/openai.js';
import { DEFAULT_ROUTING_PROFILE_ID } from '../llm/router.js';
import { createTokenFactoryClient } from '../llm/token-factory.js';
import { TypeSafeClient } from '../llm/typesafe.js';
import { orchestrate, type RepositoryPort } from '../orchestrate.js';
import {
  REPLAY_BUNDLE_SCHEMA_VERSION,
  ReplayRecorder,
  type ReplayBundle,
  type ReplayOrchestrationConfig,
} from './bundle.js';
import { recordingExecutor } from './record-executor.js';
import {
  recordingNebiusFetch,
  recordingOpenAiFetch,
  recordingTavilyFetch,
  recordingTypeSafeFetch,
} from './record-fetch.js';
import { recordingGitHubApi } from './record-github.js';
import { recordedErrorResult } from './recorded-error.js';

const RUN_ID = '77';
const HEAD_SHA = 'a'.repeat(40);
const REPOSITORY = 'acme/widget';
const PACKAGE_JSON = '{"scripts":{"test":"pnpm test"}}\n';
const ARTIFACT_URL = 'https://github.com/acme/widget/actions/runs/88/artifacts/99';
const SOURCE_PATH = 'src/value.ts';
const SOURCE_BEFORE = 'export const value: string = 1;\n';
const HONEST_REPLACEMENT = 'export const value: string = "1";\n';

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

function chatCompletion(content: string): unknown {
  return {
    choices: [{ finish_reason: 'stop', message: { content } }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

function runResult(imageId: string, exitCode: number): RunResult {
  return {
    imageId,
    exitCode,
    stdout: exitCode === 0 ? 'Tests passed' : '',
    stderr: exitCode === 0 ? '' : 'src/value.ts(1,14): error TS2322: Type number is not assignable to type string',
    truncated: false,
    metrics: { elapsedTimeSec: 0.1, cost: 0.001 },
  };
}

/**
 * Content-aware executor tailored to reach the `adjudication` gate: the
 * sandbox tooling check, git init, and diff application always pass; a
 * triage attempt always reproduces the original failure (so triage
 * concludes "real", not flaky); and the bare verification command fails
 * only the first time it runs (the initial reproduction) and passes on
 * every later run (the raced candidate's test and the fresh audit rerun).
 */
class AuditPathReplayExecutor implements Executor {
  private snapshotCount = 0;
  private plainTestRuns = 0;

  importImage(): Promise<ImageId> {
    return Promise.resolve('image-1');
  }

  snapshot(): Promise<ImageId> {
    this.snapshotCount += 1;
    return Promise.resolve(`image-snapshot-${this.snapshotCount}`);
  }

  private resolve(command: string): RunResult {
    if (command.includes('SUTURA_TRIAGE_ATTEMPT')) {
      return runResult('image-triage', 1);
    }
    if (command.includes('git apply')) {
      // Mirrors the real `printf '%s' <base64> | base64 --decode | git apply - && git diff ...`
      // tool command: the tool runtime reads the applied diff back from stdout.
      const encoded = command.match(/printf '%s' '?([A-Za-z0-9+/=]+)'? \|/u)?.[1] ?? '';
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      return { ...runResult('image-applied', 0), stdout: decoded };
    }
    if (command.includes('command -v git') || command.includes('git init')) {
      return runResult('image-preparation', 0);
    }
    this.plainTestRuns += 1;
    return runResult(`image-test-${this.plainTestRuns}`, this.plainTestRuns === 1 ? 1 : 0);
  }

  run(_parent: ImageId, command: string): Promise<RunResult> {
    return Promise.resolve(this.resolve(command));
  }

  runMany(_parent: ImageId, cmds: string[]): Promise<RunResult[]> {
    return Promise.resolve(cmds.map((command) => this.resolve(command)));
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
        startedAt: '2026-09-17T10:00:00Z',
        completedAt: '2026-09-17T10:00:01Z',
      }],
    }],
    downloadJobLogs: async () => [
      '2026-09-17T10:00:00Z ##[group]Run pnpm test',
      '2026-09-17T10:00:00Z Run pnpm test',
      '2026-09-17T10:00:01Z src/value.ts(1,14): error TS2322: Type number is not assignable to type string',
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
            files: [
              { path: 'package.json', content: PACKAGE_JSON },
              { path: SOURCE_PATH, content: SOURCE_BEFORE },
            ],
          },
        }),
      );
    },
    readSourceExcerpts(dir, references, limits) {
      return record('readSourceExcerpts', [dir, references, limits], async () =>
        references.flatMap(({ path }) => path === SOURCE_PATH
          ? [{ path, startLine: 1, content: SOURCE_BEFORE, truncated: false }]
          : []));
    },
    publishFix(input) {
      return record('publishFix', [input], async () => undefined);
    },
  };
}

const artifact: TextArtifactPort = {
  uploadTextArtifact: async () => ({ url: ARTIFACT_URL }),
};

/**
 * Captures a bundle whose repair pipeline reaches the `adjudication` gate,
 * calling Nemotron adjudication, the GPT-6 Astra second opinion, and the
 * TypeSafe Jev calibrated audit -- so the bundle carries `nebius`, `openai`,
 * and `typesafe` HTTP exchanges alongside the always-required boundaries.
 * Modeled on `createCompleteReplayBundleForTest` (see that file), adapted
 * with a content-aware executor and a source excerpt that lets the repair
 * proposal construct a real diff instead of a supplied one.
 */
export async function createAuditPathReplayBundleForTest(): Promise<ReplayBundle> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'sutura-audit-replay-'));
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

  let nebiusCall = 0;
  const llm = createTokenFactoryClient({
    apiKey: 'capture-only',
    models: CONFIGURATION.models,
    routingProfileId: CONFIGURATION.routingProfileId,
  }, {
    fetch: recordingNebiusFetch(recorder, async () => {
      nebiusCall += 1;
      if (nebiusCall === 1) {
        return bytesResponse(chatCompletion(JSON.stringify({
          class: 'typecheck',
          confidence: 0.98,
          signals: ['TS2322'],
          failingCmd: 'pnpm test',
          errorExcerpt: 'TS2322: Type number is not assignable to type string',
        })));
      }
      if (nebiusCall === 2) {
        return bytesResponse(chatCompletion(JSON.stringify({ replacement: HONEST_REPLACEMENT })));
      }
      return bytesResponse(chatCompletion(JSON.stringify({
        approved: true,
        reasoning: 'The patch corrects the diagnosed source type.',
      })));
    }),
  });
  const secondOpinion = new OpenAiClient({ apiKey: 'capture-only', ledger: llm.ledger }, {
    fetch: recordingOpenAiFetch(recorder, async () => bytesResponse(chatCompletion(JSON.stringify({
      approved: true,
      reasoning: 'Independently confirms the diagnosed source type is corrected.',
    })))),
  });
  const typesafeAudit = new TypeSafeClient({ apiKey: 'capture-only', ledger: llm.ledger }, {
    fetch: recordingTypeSafeFetch(recorder, async () => bytesResponse({
      model: 'jev-1.13.0',
      answers: {
        verdict: {
          type: 'choice',
          choice: 'legitimate_repair',
          confidence: 1,
          probabilities: { legitimate_repair: 1, green_wash: 0 },
        },
        touches_only_tests: { type: 'noul', noul: 0.01 },
        weakens_assertion: { type: 'noul', noul: 0.05 },
        suppresses_error: { type: 'noul', noul: 0.02 },
        unrelated_change: { type: 'noul', noul: 0.04 },
      },
      usage: { input_tokens: 896, output_tokens: 121 },
    })),
  });
  // Present but never called (the diagnosis class does not trigger grounding), so its
  // grounding.reason matches replay's unconditional tavily reconstruction ('not-applicable'
  // rather than 'disabled').
  const tavily = new TavilyClient('capture-only', {
    fetch: recordingTavilyFetch(recorder, async () => {
      throw new Error('Tavily should not be called for this diagnosis class');
    }),
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
      executor: recordingExecutor(new AuditPathReplayExecutor(), recorder),
      llm,
      tavily,
      secondOpinion,
      typesafeAudit,
      cost: llm.ledger,
      triageN: CONFIGURATION.triageN,
      raceK: CONFIGURATION.raceK,
      runtimeId: 'node',
    });
    const bundle = recorder.finish(caseFile.outcome);
    if (bundle.schemaVersion !== REPLAY_BUNDLE_SCHEMA_VERSION || !bundle.completeness.complete) {
      throw new Error(`Audit-path replay fixture capture did not record every boundary: ${JSON.stringify(bundle.completeness)}`);
    }
    return bundle;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
