/**
 * The check a study export passes before anything is published.
 *
 * Participants agreed to a specific thing. This refuses an export that would
 * publish more than that: a secret, a private contact detail, a quote nobody
 * consented to, or a record whose release and source identities do not hold.
 * Nothing here writes or uploads; it validates the bytes a caller intends to
 * publish.
 */
import { createHash } from 'node:crypto';

const COMMIT = /^[a-f0-9]{40}$/u;
const PARTICIPANT_ID = /^participant-[a-f0-9]{8}$/u;

/** Shapes that are a credential wherever they appear. */
const SECRET_PATTERNS = Object.freeze([
  /\bgh[pousr]_[A-Za-z0-9]{16,}/u,
  /\bsk-[A-Za-z0-9]{16,}/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bxox[abps]-[A-Za-z0-9-]{10,}/u,
]);

/** Shapes that identify a person rather than a pseudonymous participant. */
const CONTACT_PATTERNS = Object.freeze([
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u,
  /\+\d[\d ()-]{7,}\d/u,
  /\bhttps:\/\/(?:www\.)?(?:linkedin|x|twitter)\.com\/[A-Za-z0-9_%-]+/u,
]);

export class StudyExportError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'StudyExportError';
    this.reasonCode = reasonCode;
  }
}

function refuse(reasonCode, message) {
  throw new StudyExportError(reasonCode, message);
}

function walk(value, visit, path = 'export') {
  if (typeof value === 'string') {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => { walk(item, visit, `${path}[${index}]`); });
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    visit(key, `${path}.${key}`);
    walk(item, visit, `${path}.${key}`);
  }
}

/**
 * Validates an export.
 *
 * A quote is publishable only when the participant it came from consented to
 * that specific quote, matched by its own hash: consent to take part is not
 * consent to be quoted, and consent to one quote is not consent to another.
 */
export function validateStudyExport(input) {
  if (input?.schemaVersion !== 'sutura-study-export-v1') {
    refuse('invalid-schema', 'A study export names its schema version');
  }
  if (!COMMIT.test(input.releaseCommit ?? '')) {
    refuse('invalid-release-identity', 'releaseCommit must be an exact 40-character commit');
  }
  if (!COMMIT.test(input.sourceCommit ?? '')) {
    refuse('invalid-source-identity', 'sourceCommit must be an exact 40-character commit');
  }

  walk(input, (text, path) => {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) refuse('secret-in-export', `${path} contains something shaped like a credential`);
    }
    for (const pattern of CONTACT_PATTERNS) {
      if (pattern.test(text)) refuse('contact-in-export', `${path} contains a private contact detail`);
    }
  });

  const consented = new Map();
  for (const grant of input.quoteConsents ?? []) {
    if (!PARTICIPANT_ID.test(grant?.participantId ?? '')) {
      refuse('invalid-participant', 'A quote consent names a pseudonymous participant id');
    }
    if (!/^[a-f0-9]{64}$/u.test(grant.quoteHash ?? '')) {
      refuse('invalid-consent', `${grant.participantId} consented to no identified quote`);
    }
    consented.set(`${grant.participantId}:${grant.quoteHash}`, true);
  }

  for (const quote of input.quotes ?? []) {
    if (!PARTICIPANT_ID.test(quote?.participantId ?? '')) {
      refuse('invalid-participant', 'A published quote names a pseudonymous participant id');
    }
    const hash = createHash('sha256').update(quote.text ?? '').digest('hex');
    if (!consented.has(`${quote.participantId}:${hash}`)) {
      refuse('unconsented-quote', `${quote.participantId} did not consent to this exact quote`);
    }
  }

  const ids = (input.records ?? []).map(({ participantId }) => participantId);
  for (const id of ids) {
    if (!PARTICIPANT_ID.test(id ?? '')) refuse('invalid-participant', `${String(id)} is not pseudonymous`);
  }
  if (new Set(ids).size !== ids.length) refuse('duplicate-record', 'A participant appears twice in the export');

  return {
    records: ids.length,
    quotes: (input.quotes ?? []).length,
    exportHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
  };
}
