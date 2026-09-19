import type { GitHubApi } from '../github/types.js';
import type { RecordedGitHubCall, RecordedRepositoryCall, ReplayBundle } from './bundle.js';
import {
  RecordedCallCursor,
  type RecordedCallDescription,
} from './recorded-call-cursor.js';
import { throwRecordedErrorResult } from './recorded-error.js';

const MUTATING_METHODS = new Set<keyof GitHubApi>([
  'createRef',
  'deleteRef',
  'createIssueComment',
  'createCommitComment',
  'updateIssueComment',
  'updateCommitComment',
  'createPullRequest',
  'createCheckRun',
  'updateCheckRun',
]);

export interface RecordedGitHubMutation {
  sequence: number;
  method: keyof GitHubApi;
  args: unknown[];
}

export interface ReplayingGitHubApi {
  api: GitHubApi;
  mutations: RecordedGitHubMutation[];
}

export type RecordedPortCall = RecordedGitHubCall | RecordedRepositoryCall;

/**
 * Check annotations are derived from the live checkout's git object store
 * (`checkAnnotations` reads the tracked file at the head commit), which no
 * replay has, so a replayed `updateCheckRun` always carries none. They
 * decorate the check run; the conclusion, title and summary that state the
 * repair decision are still compared exactly.
 */
function withoutCheckAnnotations(method: string, args: unknown[]): unknown[] {
  if (method !== 'updateCheckRun') return args;
  const [input, ...rest] = args;
  if (typeof input !== 'object' || input === null) return args;
  const compared: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  delete compared.annotations;
  return [compared, ...rest];
}

/** Describe a recorded port call the way a replayed call is compared. */
export const describePortCall = (record: RecordedPortCall): RecordedCallDescription => ({
  method: record.method,
  args: withoutCheckAnnotations(record.method, record.args),
});

function returnedResult(call: RecordedGitHubCall): unknown {
  throwRecordedErrorResult(call.result);
  return call.result === null ? undefined : call.result;
}

export function replayingGitHubApi(
  bundle: ReplayBundle,
  cursor = new RecordedCallCursor<RecordedPortCall>(
    bundle.github,
    describePortCall,
    'port',
  ),
): ReplayingGitHubApi {
  const mutations: RecordedGitHubMutation[] = [];
  const api = new Proxy({} as GitHubApi, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined;
      return async (...args: unknown[]): Promise<unknown> => {
        const call = cursor.next(
          property,
          args,
          (value) => withoutCheckAnnotations(property, value),
        ) as RecordedGitHubCall;
        if (MUTATING_METHODS.has(property as keyof GitHubApi)) {
          mutations.push({
            sequence: call.sequence,
            method: property as keyof GitHubApi,
            args,
          });
        }
        return returnedResult(call);
      };
    },
  });
  return { api, mutations };
}
