import { caseLabCase, CaseLabRequestError, type CaseLabCaseId } from './cases.js';
import { isRecord } from './util.js';

/** A request is one small JSON text. Anything larger is not a case selection. */
export const MAX_REQUEST_BYTES = 256;
/** Longer than any server-defined id; the object form is bounded here before the id is compared. */
export const MAX_CASE_ID_LENGTH = 64;

export interface CaseLabRequest {
  readonly caseId: CaseLabCaseId;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/**
 * Accept exactly `{ caseId: <server-defined id> }`. Every other key, including
 * repository names, refs, commands, patches, and free text, is rejected before
 * any I/O happens.
 */
export function parseCaseLabRequest(body: unknown): CaseLabRequest {
  if (!isPlainObject(body)) {
    throw new CaseLabRequestError('request must be a JSON object with one caseId field');
  }
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'caseId') {
    throw new CaseLabRequestError('request accepts only caseId');
  }
  if (typeof body.caseId !== 'string') {
    throw new CaseLabRequestError('caseId must be a string');
  }
  if (body.caseId.length > MAX_CASE_ID_LENGTH) {
    throw new CaseLabRequestError(`caseId exceeds ${MAX_CASE_ID_LENGTH} characters`);
  }
  return { caseId: caseLabCase(body.caseId).id };
}

export function parseCaseLabRequestText(text: string): CaseLabRequest {
  if (typeof text !== 'string') {
    throw new CaseLabRequestError('request must be a JSON object with one caseId field');
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_REQUEST_BYTES) {
    throw new CaseLabRequestError(`request exceeds ${MAX_REQUEST_BYTES} bytes`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CaseLabRequestError('request must be a JSON object with one caseId field');
  }
  return parseCaseLabRequest(value);
}
