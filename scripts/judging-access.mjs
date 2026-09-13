/**
 * The judging-availability checker.
 *
 * It answers one question about artifacts a judge would open: are they
 * reachable, are they the exact ones the submission named, and is the live
 * path available or honestly unavailable. It never starts a run: a checker
 * that dispatched to prove liveness would spend money to answer a question
 * about availability.
 */
const COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export class JudgingAccessError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'JudgingAccessError';
    this.reasonCode = reasonCode;
  }
}

function refuse(reasonCode, message) {
  throw new JudgingAccessError(reasonCode, message);
}

/** Only read-only methods are part of this protocol. */
const CHECK_METHODS = Object.freeze(['GET', 'HEAD']);

/**
 * Checks one artifact a judge would open.
 *
 * HTTP success is not the answer on its own: a page that loads while serving a
 * different pin, a stale result or an expired record answers the wrong
 * question. A 401 or 403 is reported as a private artifact rather than as an
 * outage, because a judge without an account would see exactly that.
 */
export function checkArtifact(observation, now) {
  const { name, status, method = 'GET' } = observation;
  if (!name?.trim()) refuse('unnamed-artifact', 'Each checked artifact needs a name');
  if (!CHECK_METHODS.includes(method)) {
    refuse('implicit-dispatch', `${name} would be checked with ${method}, which is not a check`);
  }
  if (status === 401 || status === 403) {
    return { name, available: false, reason: 'private-artifact' };
  }
  if (status === 429) return { name, available: false, reason: 'quota-exhausted' };
  if (typeof status !== 'number' || status >= 500) {
    return { name, available: false, reason: 'service-unavailable' };
  }
  if (status !== 200) return { name, available: false, reason: 'not-found' };

  if (observation.expectedPin !== undefined) {
    if (!COMMIT.test(observation.expectedPin)) refuse('invalid-pin', `${name} declares a pin that is not a commit`);
    if (observation.servedPin !== observation.expectedPin) {
      return { name, available: false, reason: 'wrong-pin' };
    }
  }
  if (observation.expectedResultHash !== undefined) {
    if (!SHA256.test(observation.expectedResultHash)) {
      refuse('invalid-result-hash', `${name} declares a result hash that is not a digest`);
    }
    if (observation.servedResultHash !== observation.expectedResultHash) {
      return { name, available: false, reason: 'stale-result' };
    }
  }
  if (observation.expiresAt !== undefined) {
    const expiry = Date.parse(observation.expiresAt);
    if (!Number.isFinite(expiry)) refuse('invalid-expiry', `${name} declares an unreadable expiry`);
    if (expiry <= now.getTime()) return { name, available: false, reason: 'expired-metadata' };
  }
  return { name, available: true, reason: 'ok' };
}

/**
 * Checks every artifact and reports what a judge would find.
 *
 * The live path is allowed to be unavailable: what is refused is a report that
 * calls it available when it is not, or one that mints a new permission to
 * make it available. The labelled recorded fallback is what a judge sees
 * instead, and its own availability is checked like anything else.
 */
export function checkJudgingAccess(input) {
  const now = input.now ?? new Date();
  if (input.grantedScopes !== undefined) {
    const extra = input.grantedScopes.filter((scope) => !(input.authorizedScopes ?? []).includes(scope));
    if (extra.length > 0) {
      refuse('unauthorized-scope', `The check would use scopes nobody authorized: ${extra.join(', ')}`);
    }
  }
  const results = (input.artifacts ?? []).map((observation) => checkArtifact(observation, now));
  if (results.length === 0) refuse('no-artifacts', 'A judging check names the artifacts it checked');

  const unavailable = results.filter(({ available }) => !available);
  const live = results.find(({ name }) => name === input.liveArtifactName);
  const fallback = results.find(({ name }) => name === input.fallbackArtifactName);
  if (live !== undefined && !live.available && fallback === undefined) {
    refuse('missing-fallback', 'An unavailable live path needs a labelled recorded fallback');
  }
  if (live !== undefined && !live.available && !fallback.available) {
    refuse('no-usable-path', 'Neither the live path nor its recorded fallback is available');
  }

  return {
    checkedAt: now.toISOString(),
    artifacts: results,
    available: unavailable.length === 0,
    unavailable: unavailable.map(({ name, reason }) => ({ name, reason })),
    /** What a judge would actually use, once the live path is accounted for. */
    servedPath: live === undefined ? 'durable-only' : live.available ? 'live' : 'recorded-fallback',
  };
}
