import { isRecord } from './util.js';

const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1_024 * 1_024;

export type WorkflowRunStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'waiting'
  | 'requested'
  | 'pending'
  | string;

export interface WorkflowRunSummary {
  readonly id: number;
  readonly displayTitle: string;
  readonly status: WorkflowRunStatus;
  readonly conclusion: string | null;
  readonly createdAt: string;
  readonly htmlUrl: string;
}

export interface GitHubDispatchClient {
  listWorkflowRuns(workflowFile: string, options: { since: Date }): Promise<WorkflowRunSummary[]>;
  dispatchWorkflow(workflowFile: string, ref: string, inputs: Readonly<Record<string, string>>): Promise<void>;
}

/** Never carries the response body or the token: bodies can name the token owner. */
export class GitHubDispatchError extends Error {
  constructor(
    readonly operation: 'list-runs' | 'dispatch',
    readonly status: number | 'timeout' | 'network' | 'invalid-response',
  ) {
    super(`GitHub ${operation} failed with ${status}`);
    this.name = 'GitHubDispatchError';
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface GitHubDispatchClientOptions {
  readonly repository: string;
  readonly token: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

function summarize(value: unknown): WorkflowRunSummary {
  if (
    !isRecord(value)
    || typeof value.id !== 'number'
    || typeof value.display_title !== 'string'
    || typeof value.status !== 'string'
    || (value.conclusion !== null && typeof value.conclusion !== 'string')
    || typeof value.created_at !== 'string'
    || typeof value.html_url !== 'string'
  ) {
    throw new GitHubDispatchError('list-runs', 'invalid-response');
  }
  return {
    id: value.id,
    displayTitle: value.display_title,
    status: value.status,
    conclusion: value.conclusion,
    createdAt: value.created_at,
    htmlUrl: value.html_url,
  };
}

export function createGitHubDispatchClient(options: GitHubDispatchClientOptions): GitHubDispatchClient {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/u.test(options.repository)) {
    throw new RangeError('repository must be owner/name');
  }
  if (typeof options.token !== 'string' || options.token.length === 0) {
    throw new RangeError('token must be a non-empty string');
  }
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const headers = Object.freeze({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${options.token}`,
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': 'sutura-case-lab',
  });

  async function request(
    operation: 'list-runs' | 'dispatch',
    method: 'GET' | 'POST',
    path: string,
    body?: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const init: RequestInit = {
        method,
        headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
        signal: controller.signal,
        ...(body === undefined ? {} : { body }),
      };
      const response = await fetchImpl(`${API_BASE}${path}`, init);
      if (!response.ok) throw new GitHubDispatchError(operation, response.status);
      return response;
    } catch (error) {
      if (error instanceof GitHubDispatchError) throw error;
      const name = (error as { name?: unknown }).name;
      throw new GitHubDispatchError(operation, name === 'AbortError' ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async listWorkflowRuns(workflowFile, { since }) {
      const created = `>=${since.toISOString()}`;
      const query = new URLSearchParams({ per_page: '100', created });
      const response = await request(
        'list-runs',
        'GET',
        `/repos/${options.repository}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?${query.toString()}`,
      );
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new GitHubDispatchError('list-runs', 'invalid-response');
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new GitHubDispatchError('list-runs', 'invalid-response');
      }
      if (!isRecord(parsed) || !Array.isArray(parsed.workflow_runs)) {
        throw new GitHubDispatchError('list-runs', 'invalid-response');
      }
      return parsed.workflow_runs.map(summarize);
    },
    async dispatchWorkflow(workflowFile, ref, inputs) {
      await request(
        'dispatch',
        'POST',
        `/repos/${options.repository}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`,
        JSON.stringify({ ref, inputs }),
      );
    },
  };
}
