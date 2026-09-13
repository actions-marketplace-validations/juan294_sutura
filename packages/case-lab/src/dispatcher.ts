import { randomBytes } from 'node:crypto';

import { CaseLabRequestError } from './cases.js';
import { GitHubDispatchError, type GitHubDispatchClient, type WorkflowRunSummary } from './github.js';
import {
  CASE_LAB_LIMITS,
  caseLabDispatchDecision,
  retryAfterSeconds,
  runsInLastHour,
  runsToday,
  type CaseLabRefusalReason,
} from './limits.js';
import { parseCaseLabRequestText } from './request.js';

export const DEMO_REPOSITORY = 'juan294/sutura-demo';
export const CASE_LAB_WORKFLOW_FILE = 'case-lab.yml';
export const CASE_LAB_WORKFLOW_REF = 'main';

/** Names that must never be configured where the public dispatcher runs. */
export const FORBIDDEN_DISPATCHER_ENV = Object.freeze([
  'NEBIUS_API_KEY',
  'CONTREE_TOKEN',
  'CONTREE_PROJECT',
  'TAVILY_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
] as const);

const ACTIVE_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);
const DAY_MS = 24 * 60 * 60 * 1_000;

export class CaseLabConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseLabConfigurationError';
  }
}

export interface CaseLabEnvironment {
  readonly token: string;
  readonly enabled: boolean;
  readonly release: { readonly version: string; readonly actionSha: string };
  readonly siteOrigin: string | undefined;
}

export interface ReleaseIdentity {
  readonly version: string;
  readonly actionSha: string;
}

export function caseLabEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  release: ReleaseIdentity,
): CaseLabEnvironment {
  for (const name of FORBIDDEN_DISPATCHER_ENV) {
    if (env[name] !== undefined) {
      throw new CaseLabConfigurationError(`${name} must not be configured on the Case Lab dispatcher`);
    }
  }
  const token = env.CASE_LAB_GITHUB_TOKEN;
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new CaseLabConfigurationError('CASE_LAB_GITHUB_TOKEN must be set');
  }
  if (!/^[a-f0-9]{40}$/u.test(release.actionSha) || release.version.length === 0) {
    throw new CaseLabConfigurationError('release.json must name a version and an exact 40-character actionSha');
  }
  const siteOrigin = env.CASE_LAB_SITE_ORIGIN;
  if (siteOrigin !== undefined && !/^https:\/\/[A-Za-z0-9.-]+$/u.test(siteOrigin)) {
    throw new CaseLabConfigurationError('CASE_LAB_SITE_ORIGIN must be an https origin without a path');
  }
  return {
    token,
    enabled: env.CASE_LAB_ENABLED === 'true',
    release,
    siteOrigin,
  };
}

export interface CaseLabHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly contentType: string | undefined;
  readonly body: string;
}

export interface CaseLabHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown>;
}

export interface CaseLabHandlerDependencies {
  readonly github: GitHubDispatchClient;
  readonly now?: () => Date;
  readonly randomId?: () => string;
}

export type CaseLabHandler = (request: CaseLabHttpRequest) => Promise<CaseLabHttpResponse>;

function defaultRandomId(): string {
  return randomBytes(4).toString('hex');
}

const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

function reply(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}): CaseLabHttpResponse {
  return { status, headers: { ...NO_STORE, ...extra }, body };
}

function refusalStatus(reason: CaseLabRefusalReason): number {
  return reason === 'disabled' ? 503 : 429;
}

function isActive(run: WorkflowRunSummary): boolean {
  return ACTIVE_STATUSES.has(run.status);
}

export function liveRequestId(now: Date, randomId: () => string): string {
  const random = randomId();
  if (!/^[a-f0-9]{8}$/u.test(random)) throw new RangeError('randomId must return 8 lowercase hex characters');
  return `cl-${String(now.getTime()).padStart(13, '0')}-${random}`;
}

/**
 * The only public write path. Validation happens before any I/O, every limit
 * is checked before the dispatch call, and refusals never reach GitHub.
 */
export function createCaseLabHandler(
  environment: CaseLabEnvironment,
  dependencies: CaseLabHandlerDependencies,
): CaseLabHandler {
  const now = dependencies.now ?? (() => new Date());
  const randomId = dependencies.randomId ?? defaultRandomId;
  const cors: Record<string, string> = environment.siteOrigin === undefined
    ? {}
    : { 'Access-Control-Allow-Origin': environment.siteOrigin, Vary: 'Origin' };
  /** Serializes the check-then-dispatch section so two requests on one instance cannot both pass a limit. */
  let queue: Promise<unknown> = Promise.resolve();
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
    return next;
  }

  return async function handle(request) {
    if (request.path === '/api/health' && request.method === 'GET') {
      return reply(200, {
        enabled: environment.enabled,
        limits: CASE_LAB_LIMITS,
        release: environment.release,
        demoRepository: DEMO_REPOSITORY,
        workflow: CASE_LAB_WORKFLOW_FILE,
      }, cors);
    }
    if (request.path !== '/api/dispatch') return reply(404, { error: 'not found' }, cors);
    if (request.method === 'OPTIONS') {
      return reply(204, {}, {
        ...cors,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
    }
    if (request.method !== 'POST') return reply(405, { error: 'method must be POST' }, { ...cors, Allow: 'POST' });
    const contentType = request.contentType?.split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') {
      return reply(415, { error: 'content-type must be application/json' }, cors);
    }

    let caseId: string;
    try {
      ({ caseId } = parseCaseLabRequestText(request.body));
    } catch (error) {
      if (error instanceof CaseLabRequestError) return reply(400, { error: error.message }, cors);
      throw error;
    }

    return serialized(async () => {
      const current = now();
      let runs: WorkflowRunSummary[];
      try {
        runs = await dependencies.github.listWorkflowRuns(CASE_LAB_WORKFLOW_FILE, {
          since: new Date(current.getTime() - DAY_MS),
        });
      } catch (error) {
        if (error instanceof GitHubDispatchError) {
          return reply(502, { error: 'run accounting is unavailable; no run was started' }, cors);
        }
        throw error;
      }

      const decision = caseLabDispatchDecision({
        enabled: environment.enabled,
        activeRuns: runs.filter(isActive).length,
        runsInLastHour: runsInLastHour(runs, current),
        runsToday: runsToday(runs, current),
      });
      if (!decision.allowed) {
        const retryAfter = retryAfterSeconds(decision.reason, current);
        return reply(
          refusalStatus(decision.reason),
          { error: decision.reason, retryAfterSeconds: retryAfter, caseId },
          { ...cors, 'Retry-After': String(retryAfter) },
        );
      }

      const requestId = liveRequestId(current, randomId);
      try {
        await dependencies.github.dispatchWorkflow(CASE_LAB_WORKFLOW_FILE, CASE_LAB_WORKFLOW_REF, {
          'case-id': caseId,
          'request-id': requestId,
        });
      } catch (error) {
        if (error instanceof GitHubDispatchError) {
          return reply(502, { error: 'dispatch failed; no run was started', caseId }, cors);
        }
        throw error;
      }
      return reply(202, {
        requestId,
        caseId,
        mode: 'live',
        resultPath: `/result/?id=${requestId}`,
        runsListUrl: `https://github.com/${DEMO_REPOSITORY}/actions/workflows/${CASE_LAB_WORKFLOW_FILE}`,
      }, cors);
    });
  };
}
