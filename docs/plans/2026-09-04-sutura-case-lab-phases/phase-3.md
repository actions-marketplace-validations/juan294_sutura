# Phase 3: Dispatcher and service identity

Issues: #62 (protected service identity, minimum GitHub permissions), #61 (throttling, concurrency, daily spend stop, emergency disable), #63 (provider secrets outside ConTree and outside the dispatcher)

Depends on: Phase 2

## Goal

One stateless HTTP handler that a signed-out visitor can call, that holds one fine-grained token with Actions read and write on `juan294/sutura-demo` only, that enforces the Phase 2 limits before every dispatch, and that refuses to start when a provider secret is present in its environment.

## Files

```
packages/case-lab/src/github.ts        GitHubDispatchClient: listWorkflowRuns(), dispatchWorkflow()  (fetch, Bearer token, api.github.com, 15 s timeout)
packages/case-lab/src/dispatcher.ts    createCaseLabHandler(env, deps) -> handle(request) ; caseLabEnvironment(env)
packages/case-lab/api/dispatch.js      Vercel Node function adapter: export default async (req, res) => ...
packages/case-lab/api/health.js        GET -> { enabled, limits, release, demoRepository }
packages/case-lab/vercel.json          { "buildCommand": "...", "outputDirectory": "dist/site", "functions": {"api/*.js": {"maxDuration": 15}} }
packages/case-lab/README.md            service identity, permissions, environment allowlist, threat model for the public trigger
packages/case-lab/src/*.test.ts
```

## Pseudocode

```ts
// dispatcher.ts
const DEMO_REPOSITORY = 'juan294/sutura-demo';
const WORKFLOW_FILE = 'case-lab.yml';
const FORBIDDEN_ENV = ['NEBIUS_API_KEY', 'CONTREE_TOKEN', 'CONTREE_PROJECT', 'TAVILY_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN'];

export function caseLabEnvironment(env: Record<string, string|undefined>): CaseLabEnvironment
  // throws CaseLabConfigurationError('CASE_LAB_GITHUB_TOKEN must be set') when missing
  // throws CaseLabConfigurationError(`${name} must not be configured on the Case Lab dispatcher`) for any FORBIDDEN_ENV present  (#63)
  // enabled = env.CASE_LAB_ENABLED === 'true'  (anything else is disabled)

export function createCaseLabHandler(environment, deps: { github: GitHubDispatchClient; now(): Date; randomId(): string })
  return async function handle(request: { method; path; body: string; headers }): Promise<{ status; body: object }>
    if path === '/api/health' && GET -> 200 { enabled, limits: CASE_LAB_LIMITS, release, demoRepository }
    if path !== '/api/dispatch' or method !== 'POST' -> 404 { error: 'not found' }
    if content-type not application/json -> 415
    const { caseId } = parseCaseLabRequestText(body)            // 400 with error message on CaseLabRequestError
    const runs = await github.listWorkflowRuns(WORKFLOW_FILE, { since: now - 24h })   // Actions read
    const decision = caseLabDispatchDecision({ enabled, activeRuns: runs.filter(queued|in_progress).length, runsInLastHour, runsToday })
    if !decision.allowed -> 429 (throttle/concurrency/daily) or 503 (disabled) { error: reason, retryAfterSeconds }
    const requestId = `cl-${Date.now()}-${randomId()}`         // ^cl-[0-9]{13}-[a-f0-9]{8}$
    await github.dispatchWorkflow(WORKFLOW_FILE, 'main', { 'case-id': caseId, 'request-id': requestId })   // Actions write
    return 202 { requestId, caseId, mode: 'live', resultPath: `/result/?id=${requestId}`, runsListUrl: `https://github.com/${DEMO_REPOSITORY}/actions/workflows/${WORKFLOW_FILE}` }
```

`github.ts` uses `fetch` with `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, an `AbortController` timeout of 15 s, and maps non-2xx to `GitHubDispatchError(status)` without echoing response bodies into client responses (bodies may contain the token owner's identifiers). It never logs the token.

`api/dispatch.js` reads the raw body (bounded at 1 KiB), builds the request object, calls the handler, and writes JSON with `Cache-Control: no-store` and `Access-Control-Allow-Origin` restricted to the site origin. No other CORS origins.

## Service identity (#62), documented in `packages/case-lab/README.md`

- Token: fine-grained PAT `sutura-case-lab-dispatcher`, resource owner `juan294`, repository access only `juan294/sutura-demo`, permissions Actions: Read and write, Metadata: Read. Nothing else. Expiry 90 days. Stored only as the Vercel environment variable `CASE_LAB_GITHUB_TOKEN`.
- Workflow permissions in `sutura-demo/case-lab.yml` (Phase 6): `actions: write`, `checks: write`, `contents: write`, `pull-requests: write`; `id-token` never granted (source: `docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-11.md:109-111`).
- Provider secrets: exist only as `sutura-demo` Actions secrets and are passed only to the Action step (`docs/security/private-repositories.md:19`). The dispatcher refuses to start if any provider secret name is set in its environment.

## Tests (`dispatcher.test.ts`, `github.test.ts`)

- Environment: missing token throws; each forbidden name throws with the name; `CASE_LAB_ENABLED=TRUE`, `1`, `yes` are all disabled.
- Handler with a fake GitHub client: disabled → 503 and no dispatch call; one active run → 429 `concurrency`, no dispatch; four runs in the last hour → 429 `hourly-throttle`; eight today → 429 `daily-spend-stop`; valid → 202 with a `requestId` matching the pattern and exactly one dispatch call with exactly the two inputs; invalid body → 400 and no run listing call (validation precedes I/O); GitHub 5xx on listing → 502 and no dispatch (fail closed).
- `GitHubDispatchClient` with a fake `fetch`: correct URL, headers, query (`created=>=<iso>`, `per_page=100`), timeout abort, and that the error object never contains the token.
- A test asserts `api/dispatch.js` and `api/health.js` import only from `../dist/index.js` and `node:` modules (no third-party runtime dependency).

## Verification

```bash
pnpm --filter @sutura/case-lab test && pnpm run typecheck && pnpm run lint && pnpm run build
```

## Success criteria

- [x] All four limits and the disable switch are enforced before the dispatch call, with tests.
- [x] The dispatcher's environment allowlist excludes provider secrets, with tests.
- [x] README documents the exact token permissions and the workflow permission set.
