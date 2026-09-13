import { describe, expect, it } from 'vitest';
import { parseRepositoryPolicy } from './schema.js';
import { freezeProbe, evaluateObservation } from '../challenges/protocol.js';

export const paginationContract = {
  id: 'pages', kind: 'ceiling-division',
  target: { adapter: 'javascript', path: 'page-count.js', export: 'pageCount' },
  maxItems: 1000, maxDivisor: 100,
};
const provenance = { policyBaseSha: 'a'.repeat(40), policyHash: 'b'.repeat(64) };
const policy = () => parseRepositoryPolicy(JSON.stringify({ version: 1,
  verification: { mode: 'required', contracts: [paginationContract] },
}));

describe('trusted verification contracts', () => {
  it('parses declared contracts and derives ceiling division in the controller', () => {
    const probe = freezeProbe(policy().verification!, provenance, { contractId: 'pages', args: [21, 10] });
    expect(evaluateObservation(probe, 3)).toEqual({ status: 'passed' });
    expect(evaluateObservation(probe, 2)).toEqual({ status: 'failed', reason: 'assertion-mismatch' });
    expect(JSON.stringify(probe)).not.toContain('expected');
  });
  it('rejects a model expected answer even with a genuine policy reference hash', () => {
    expect(() => freezeProbe(policy().verification!, provenance, {
      contractId: 'pages', args: [21, 10], expected: 2, referenceHash: provenance.policyHash,
    })).toThrow(/unknown.*expected/iu);
  });
  it.each([[1, 0], [-1, 10], [1.5, 10], [1001, 10], [1, 101]])('rejects inputs outside trusted domains %j', (...args) => {
    expect(() => freezeProbe(policy().verification!, provenance, { contractId: 'pages', args })).toThrow(/domain/iu);
  });
  it('requires valid immutable policy identities and known contract authority', () => {
    expect(() => freezeProbe(policy().verification!, { ...provenance, policyHash: 'default' }, { contractId: 'pages', args: [1, 10] })).toThrow(/provenance/iu);
    expect(() => freezeProbe(policy().verification!, provenance, { contractId: 'prose-only', args: [] })).toThrow(/unsupported/iu);
  });
  it.each([
    { ...paginationContract, target: { adapter: 'javascript', path: '../secret.js', export: 'pageCount' } },
    { ...paginationContract, maxItems: Number.MAX_SAFE_INTEGER + 1 },
    { ...paginationContract, expected: 3 },
    { ...paginationContract, kind: 'prose', text: 'should round up' },
  ])('rejects unbounded, unsupported or executable declarations', (contract) => {
    expect(() => parseRepositoryPolicy(JSON.stringify({ version: 1, verification: { mode: 'required', contracts: [contract] } }))).toThrow();
  });
  it('retains legacy policy defaults without implying challenge evidence', () => {
    expect(parseRepositoryPolicy('{"version":1}').verification).toBeUndefined();
  });
});

describe('bounded contract declarations', () => {
  const parse = (verification: unknown) => parseRepositoryPolicy(JSON.stringify({ version: 1, verification }));
  it('requires unique target-bound declarations and explicit supported mode', () => {
    expect(() => parse({ mode: 'maybe', contracts: [] })).toThrow();
    expect(() => parse({ mode: 'required', contracts: [paginationContract, paginationContract] })).toThrow(/duplicate/iu);
    expect(() => parse({ mode: 'required', contracts: Array(33).fill(paginationContract) })).toThrow(/bounded/iu);
    expect(() => parse({ mode: 'required', contracts: [{ ...paginationContract, target: { adapter: 'python', path: 'target.js', export: 'call' } }] })).toThrow(/extension/iu);
    expect(() => freezeProbe({ mode: 'disabled', contracts: [] }, provenance, { contractId: 'pages', args: [1, 10] })).toThrow(/authority/iu);
  });
  it.each(['.sutura-controller/oracles.js', '.sutura-evaluator/answers.js', 'nested/hidden/value.js', '.git/objects/value.js', '.sutura/challenges/probes.js'])('rejects controller/hidden target %s', (path) => {
    expect(() => parse({ mode: 'required', contracts: [{ ...paginationContract, target: { ...paginationContract.target, path } }] })).toThrow(/target path/iu);
  });
  it.each([undefined, 'x'.repeat(2049), Array(129).fill(0), { constructor: 'bad' }])('rejects unsupported expected value %j', (expected) => {
    expect(() => parse({ mode: 'required', contracts: [{ id: 'json', kind: 'json-property', target: { adapter: 'json', path: 'config.json' }, property: ['strict'], expected }] })).toThrow();
  });
});
