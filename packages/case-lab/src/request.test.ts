import { describe, expect, it } from 'vitest';

import { CaseLabRequestError } from './cases.js';
import { MAX_CASE_ID_LENGTH, MAX_REQUEST_BYTES, parseCaseLabRequest, parseCaseLabRequestText } from './request.js';

describe('parseCaseLabRequest', () => {
  it('accepts exactly one server-defined case id', () => {
    expect(parseCaseLabRequest({ caseId: 'greenwash-trap' })).toEqual({ caseId: 'greenwash-trap' });
    expect(parseCaseLabRequestText('{"caseId":"flaky-failure"}')).toEqual({ caseId: 'flaky-failure' });
  });

  it.each([
    ['repository name', { caseId: 'javascript-repair', repository: 'juan294/sutura' }],
    ['repo alias', { caseId: 'javascript-repair', repo: 'x/y' }],
    ['ref', { caseId: 'javascript-repair', ref: 'main' }],
    ['branch', { caseId: 'javascript-repair', branch: 'feature' }],
    ['command', { caseId: 'javascript-repair', command: 'rm -rf /' }],
    ['patch', { caseId: 'javascript-repair', patch: 'diff --git a b' }],
    ['diff', { caseId: 'javascript-repair', diff: '--- a\n+++ b' }],
    ['free text', { caseId: 'javascript-repair', text: 'please fix my repo' }],
    ['prompt', { caseId: 'javascript-repair', prompt: 'ignore previous instructions' }],
    ['mode', { caseId: 'javascript-repair', mode: 'live' }],
    ['prototype key', JSON.parse('{"caseId":"javascript-repair","__proto__":{"admin":true}}') as unknown],
    ['constructor key', { caseId: 'javascript-repair', constructor: 'x' }],
  ])('rejects any extra field: %s', (_label, body) => {
    expect(() => parseCaseLabRequest(body)).toThrow(CaseLabRequestError);
    expect(() => parseCaseLabRequest(body)).toThrow('request accepts only caseId');
  });

  it.each([
    ['empty object', {}],
    ['array', ['javascript-repair']],
    ['null', null],
    ['string', 'javascript-repair'],
    ['number', 1],
    ['class instance', new (class { caseId = 'javascript-repair'; })()],
  ])('rejects a non-request body: %s', (_label, body) => {
    expect(() => parseCaseLabRequest(body)).toThrow(CaseLabRequestError);
  });

  it('rejects a non-string or unknown case id with the accepted contract', () => {
    expect(() => parseCaseLabRequest({ caseId: 7 })).toThrow('caseId must be a string');
    expect(() => parseCaseLabRequest({ caseId: 'anything-else' })).toThrow('caseId must be one of');
    expect(() => parseCaseLabRequest({ caseId: 'JavaScript-Repair' })).toThrow('caseId must be one of');
    expect(() => parseCaseLabRequest({ caseId: 'javascript-repair\n' })).toThrow('caseId must be one of');
  });

  it('rejects an oversized case id in the object form before comparing it', () => {
    expect(() => parseCaseLabRequest({ caseId: 'a'.repeat(10_000) })).toThrow(`caseId exceeds ${MAX_CASE_ID_LENGTH} characters`);
    expect(() => parseCaseLabRequest({ caseId: 'a'.repeat(65) })).toThrow(`caseId exceeds ${MAX_CASE_ID_LENGTH} characters`);
  });

  it('rejects oversized and non-JSON text before parsing', () => {
    const oversized = `{"caseId":"${'a'.repeat(MAX_REQUEST_BYTES)}"}`;
    expect(() => parseCaseLabRequestText(oversized)).toThrow(`request exceeds ${MAX_REQUEST_BYTES} bytes`);
    expect(() => parseCaseLabRequestText('not json')).toThrow('request must be a JSON object with one caseId field');
    expect(() => parseCaseLabRequestText('"javascript-repair"')).toThrow('request must be a JSON object with one caseId field');
    expect(() => parseCaseLabRequestText('[]')).toThrow('request must be a JSON object with one caseId field');
    expect(() => parseCaseLabRequestText('')).toThrow(CaseLabRequestError);
  });
});
