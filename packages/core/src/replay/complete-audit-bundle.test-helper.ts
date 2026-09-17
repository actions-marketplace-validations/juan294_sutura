import { Buffer } from 'node:buffer';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  CancellationResult,
  Executor,
  ImageId,
  OperationCapacity,
  RunResult,
} from '../executor/types.js';
import { TavilyClient } from '../diagnose/tavily.js';
import { GitHubAdapter } from '../github/adapter.js';
import { OpenAiClient } from '../llm/openai.js';
import { createTokenFactoryClient } from '../llm/token-factory.js';
import { TypeSafeClient } from '../llm/typesafe.js';
import { orchestrate } from '../orchestrate.js';
import {
  REPLAY_BUNDLE_SCHEMA_VERSION,
  ReplayRecorder,
  type ReplayBundle,
} from './bundle.js';
import { recordingExecutor } from './record-executor.js';
import {
  recordingNebiusFetch,
  recordingOpenAiFetch,
  recordingTavilyFetch,
  recordingTypeSafeFetch,
} from './record-fetch.js';
import { recordingGitHubApi } from './record-github.js';
import {
  artifact,
  bytesResponse,
  CONFIGURATION,
  githubApi,
  HEAD_SHA,
  recordingRepository,
  REPOSITORY,
  RUN_ID,
} from './replay-fixtures.test-helper.js';

const PACKAGE_JSON = '{"scripts":{"test":"pnpm test"}}\n';
const SOURCE_PATH = 'src/value.ts';
const SOURCE_BEFORE = 'export const value: string = 1;\n';
const HONEST_REPLACEMENT = 'export const value: string = "1";\n';

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
      github: new GitHubAdapter(recordingGitHubApi(githubApi({
        logLines: [
          '2026-09-17T10:00:00Z ##[group]Run pnpm test',
          '2026-09-17T10:00:00Z Run pnpm test',
          '2026-09-17T10:00:01Z src/value.ts(1,14): error TS2322: Type number is not assignable to type string',
        ],
        startedAt: '2026-09-17T10:00:00Z',
        completedAt: '2026-09-17T10:00:01Z',
      }), recorder), {
        owner: 'acme',
        repo: 'widget',
        runId: RUN_ID,
        artifact,
      }),
      repository: recordingRepository(
        checkoutDir,
        recorder,
        [
          { path: 'package.json', content: PACKAGE_JSON },
          { path: SOURCE_PATH, content: SOURCE_BEFORE },
        ],
        async (_dir, references) => references.flatMap(({ path }) => path === SOURCE_PATH
          ? [{ path, startLine: 1, content: SOURCE_BEFORE, truncated: false }]
          : []),
      ),
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
