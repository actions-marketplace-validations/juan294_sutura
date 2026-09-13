// Shared by api/dispatch.js and api/health.js. Vercel does not route files that start with an underscore.
import release from '../release.json' with { type: 'json' };
// Import the dispatcher modules directly, not the package barrel: the barrel
// re-exports the site builder, which would drag esbuild into the function bundle.
import { caseLabEnvironment, createCaseLabHandler, DEMO_REPOSITORY } from '../dist/dispatcher.js';
import { createGitHubDispatchClient } from '../dist/github.js';

let cached;

/**
 * The environment is read on every invocation so a changed CASE_LAB_ENABLED
 * takes effect at the next request of a warm instance. The handler itself is
 * reused while the configuration is unchanged, so its check-then-dispatch
 * serialization holds across the requests of one instance.
 */
export function handlerFor(env) {
  const environment = caseLabEnvironment(env, release);
  const key = JSON.stringify([environment.token, environment.enabled, environment.siteOrigin]);
  if (!cached || cached.key !== key) {
    cached = {
      key,
      handler: createCaseLabHandler(environment, {
        github: createGitHubDispatchClient({ repository: DEMO_REPOSITORY, token: environment.token }),
      }),
    };
  }
  return cached.handler;
}

export function send(response, result) {
  response.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(result.body));
}

export const UNAVAILABLE = Object.freeze({
  status: 500,
  headers: { 'Cache-Control': 'no-store' },
  body: { error: 'dispatcher unavailable' },
});

export async function answer(path, request, response, body) {
  let result;
  try {
    result = await handlerFor(process.env)({
      method: request.method ?? 'GET',
      path,
      contentType: request.headers['content-type'],
      body,
    });
  } catch {
    result = UNAVAILABLE;
  }
  send(response, result);
}
