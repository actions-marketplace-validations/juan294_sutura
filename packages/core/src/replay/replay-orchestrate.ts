import { createTokenFactoryClient } from '../llm/token-factory.js';
import { TavilyClient } from '../diagnose/tavily.js';
import type { CaseFile } from '../domain.js';
import type { Executor } from '../executor/types.js';
import { GitHubAdapter } from '../github/adapter.js';
import type { TextArtifactPort } from '../github/types.js';
import { orchestrate } from '../orchestrate.js';
import type { RuntimeId } from '../runtime/types.js';
import type { RecordedHttpExchange, ReplayBundle } from './bundle.js';
import { describeMethodCall, RecordedCallCursor } from './recorded-call-cursor.js';
import { EXECUTOR_CURSOR_OPTIONS, RecordedExecutor } from './replay-executor.js';
import { replayFetch } from './replay-fetch.js';
import {
  replayingGitHubApi,
  type RecordedGitHubMutation,
  type RecordedPortCall,
} from './replay-github.js';
import { RecordedRepository } from './replay-repository.js';
import { parseReplayBundle, ReplayValidationError } from './validate.js';

export interface ReplayBundleOptions {
  executor?: Executor;
  artifact?: TextArtifactPort;
  runtimeId?: RuntimeId;
}

export interface ReplayBundleResult {
  caseFile: CaseFile;
  mutations: RecordedGitHubMutation[];
}

interface ReplayCursor {
  assertConsumed(): void;
  rethrowMismatch(): void;
}

function recordedCaseFileUrl(bundle: ReplayBundle): string | undefined {
  for (const call of bundle.github) {
    for (const arg of call.args) {
      if (typeof arg !== 'object' || arg === null) continue;
      const detailsUrl = (arg as { detailsUrl?: unknown }).detailsUrl;
      if (typeof detailsUrl === 'string' && detailsUrl.length > 0) return detailsUrl;
    }
  }
  return undefined;
}

class ReplayTextArtifactPort implements TextArtifactPort {
  private readonly caseFileUrl: string | undefined;

  constructor(bundle: ReplayBundle) {
    this.caseFileUrl = recordedCaseFileUrl(bundle);
  }

  uploadTextArtifact(
    name: string,
    _content: string,
    extension: 'html' | 'json',
  ): Promise<{ url: string }> {
    if (extension === 'html' && this.caseFileUrl) {
      return Promise.resolve({ url: this.caseFileUrl });
    }
    return Promise.resolve({ url: `replay://artifact/${encodeURIComponent(name)}` });
  }
}

export async function replayBundle(
  bundle: ReplayBundle,
  options: ReplayBundleOptions = {},
): Promise<ReplayBundleResult> {
  const validated = parseReplayBundle(bundle);
  if (!validated.completeness.complete) {
    throw new ReplayValidationError(
      'bundle',
      'is partial; complete provider, repository, and sandbox recordings are required',
    );
  }
  const [owner, repo] = validated.repo.split('/');
  if (!owner || !repo) throw new ReplayValidationError('bundle.repo', 'must use owner/repo format');
  const portCursor = new RecordedCallCursor<RecordedPortCall>(
    [...validated.github, ...validated.repository],
    describeMethodCall,
    'port',
  );
  const httpCursor = new RecordedCallCursor<RecordedHttpExchange>(
    validated.http.filter(({ boundary }) => boundary !== 'contree'),
    (exchange) => ({ method: exchange.boundary, args: [] }),
    'HTTP',
  );
  const executorCursor = options.executor === undefined
    ? new RecordedCallCursor(validated.executor, describeMethodCall, 'executor', EXECUTOR_CURSOR_OPTIONS)
    : undefined;
  const githubReplay = replayingGitHubApi(validated, portCursor);
  const repository = new RecordedRepository(validated.repository, portCursor);
  const executor = options.executor ?? new RecordedExecutor(
    validated.executor,
    (args) => repository.normalizeArgs(args),
    executorCursor,
  );
  const github = new GitHubAdapter(githubReplay.api, {
    owner,
    repo,
    runId: validated.runId,
    artifact: options.artifact ?? new ReplayTextArtifactPort(validated),
  });
  const llm = createTokenFactoryClient({
    apiKey: 'replay-only',
    models: validated.configuration.models,
    routingProfileId: validated.configuration.routingProfileId,
  }, { fetch: replayFetch(validated, 'nebius', httpCursor) });
  const tavily = new TavilyClient('replay-only', {
    fetch: replayFetch(validated, 'tavily', httpCursor),
  });
  const cursors: ReplayCursor[] = [portCursor, httpCursor];
  if (executorCursor) cursors.push(executorCursor);
  try {
    try {
      const caseFile = await orchestrate({
        runId: validated.runId,
        evidenceMode: 'replay',
        github,
        repository,
        executor,
        llm,
        cost: llm.ledger,
        triageN: validated.configuration.triageN,
        raceK: validated.configuration.raceK,
        ...(validated.configuration.repairBudgets === undefined
          ? {}
          : { repairBudgets: validated.configuration.repairBudgets }),
        ...(validated.configuration.search === undefined
          ? {}
          : { search: validated.configuration.search }),
        tavily,
        ...(validated.configuration.imageRef === undefined
          ? {}
          : { imageRef: validated.configuration.imageRef }),
        ...(options.runtimeId ?? validated.configuration.runtimeId
          ? { runtimeId: options.runtimeId ?? validated.configuration.runtimeId }
          : {}),
        ...(validated.configuration.sourceReferenceOrder === undefined
          ? {}
          : { sourceReferenceOrder: validated.configuration.sourceReferenceOrder }),
        repairVerificationScope:
          validated.configuration.repairVerificationScope ?? 'full',
      });
      for (const cursor of cursors) cursor.assertConsumed();
      return { caseFile, mutations: githubReplay.mutations };
    } catch (error) {
      for (const cursor of cursors) cursor.rethrowMismatch();
      throw error;
    }
  } finally {
    await repository.cleanup();
  }
}
