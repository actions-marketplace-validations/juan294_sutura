import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseRepositoryPolicy } from '../policy/schema.js';
import { buildObservationCommand, decodeObservation, evaluateObservation, freezeProbe, observeProbe } from './protocol.js';
const exec = promisify(execFile);
const provenance = { policyBaseSha: 'a'.repeat(40), policyHash: 'b'.repeat(64) };
function probe(contract: unknown, args: unknown[]) {
  const policy = parseRepositoryPolicy(JSON.stringify({ version: 1, verification: { mode: 'required', contracts: [contract] } }));
  return freezeProbe(policy.verification!, provenance, { contractId: 'test', args });
}
const result = (stdout: string) => ({ stdout, stderr: '', exitCode: 0, truncated: false });

describe('bounded observation protocol', () => {
  it.each([
    '{"version":1,"value":3,"success":true}',
    '{"version":1,"value":3}\n{"version":1,"value":3}',
    '{"version":1,"value":{"success":true}} trailing',
    '{"version":2,"value":3}',
    '{"version":1,"value":1e999}',
    '{"version":1,"value":3,"value":2}',
    '{"version":1,"value":3,"approved":true}',
    '{"version":1,"value":3,"passed":true}',
    '{"version":1,"value":3,"verdict":"passed"}',
    '{"version":1}',
    'x'.repeat(17000),
  ])('rejects forged or malformed observation %s', (stdout) => {
    expect(() => decodeObservation(result(stdout))).toThrow();
  });
  it('rejects truncation and nonzero exits even with a valid value', () => {
    expect(() => decodeObservation({ ...result('{"version":1,"value":3}'), exitCode: 1 })).toThrow(/exit/iu);
    expect(() => decodeObservation({ ...result('{"version":1,"value":3}'), truncated: true })).toThrow(/truncated/iu);
  });
  it('decodes the maximum escaped-string envelope in bounded time', () => {
    const stdout = JSON.stringify({ version: 1, value: '"'.repeat(2_048) });
    const startedAt = performance.now();
    expect(decodeObservation(result(stdout))).toBe('"'.repeat(2_048));
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
  it('keeps declarations and proposed inputs frozen against later mutation', () => {
    const args = [[1, 2]];
    const frozen = probe({ id: 'test', kind: 'cardinality', target: { adapter: 'javascript', path: 'target.mjs', export: 'identity' }, maxItems: 10 }, args);
    args[0]!.push(3);
    expect(evaluateObservation(frozen, ['a', 'b'])).toEqual({ status: 'passed' });
    expect(evaluateObservation(frozen, ['a'])).toHaveProperty('status', 'failed');
  });
  it.each([
    ['javascript', 'target.mjs', 'export const call = (a,b) => Math.ceil(a/b);'],
    ['javascript', 'target.mjs', 'export const call = async (a,b) => Math.ceil(a/b);'],
    ['typescript', 'target.ts', 'export const call = (a: number,b: number): number => Math.ceil(a/b);'],
    ['typescript', 'target.ts', 'export const call = async (a: number,b: number): Promise<number> => Math.ceil(a/b);'],
    ['python', 'target.py', 'import math\ndef call(a,b):\n return math.ceil(a/b)\n'],
    ['python', 'target.py', 'import math\nasync def call(a,b):\n return math.ceil(a/b)\n'],
  ])('executes local %s callable observations', async (adapter, path, source) => {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-protocol-'));
    try {
      await writeFile(join(dir, path), source);
      const frozen = probe({ id: 'test', kind: 'ceiling-division', target: { adapter, path, export: 'call' }, maxItems: 100, maxDivisor: 20 }, [21, 10]);
      const command = buildObservationCommand(frozen);
      expect(command).not.toContain('expected');
      const observed = await exec('/bin/sh', ['-c', command], { cwd: dir, timeout: 10000, maxBuffer: 20000 });
      expect(evaluateObservation(frozen, decodeObservation(result(observed.stdout)))).toEqual({ status: 'passed' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 30000);
  it('reads JSON properties as data and enforces exact trusted values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-json-protocol-'));
    try {
      await writeFile(join(dir, 'config.json'), '{"compilerOptions":{"strict":true}}');
      const frozen = probe({ id: 'test', kind: 'json-property', target: { adapter: 'json', path: 'config.json' }, property: ['compilerOptions', 'strict'], expected: true }, []);
      const observed = await exec('/bin/sh', ['-c', buildObservationCommand(frozen)], { cwd: dir, timeout: 10000 });
      expect(evaluateObservation(frozen, decodeObservation(result(observed.stdout)))).toEqual({ status: 'passed' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 30000);
});

describe('declarative assertion coverage', () => {
  const target = { adapter: 'javascript', path: 'target.mjs', export: 'call' };
  it('requires exact typed example inputs and compares objects independent of key order', () => {
    const frozen = probe({ id: 'test', kind: 'exact', target, examples: [{ args: [1], expected: { a: true, b: 2 } }] }, [1]);
    expect(evaluateObservation(frozen, { b: 2, a: true })).toHaveProperty('status', 'passed');
    expect(evaluateObservation(frozen, { b: 3, a: true })).toHaveProperty('status', 'failed');
    expect(() => probe({ id: 'test', kind: 'exact', target, examples: [{ args: [1], expected: 3 }] }, [2])).toThrow(/domain/iu);
  });
  it('rejects counterfeit controller probes, output shapes, and nested duplicate keys', () => {
    const frozen = probe({ id: 'test', kind: 'cardinality', target, maxItems: 3 }, [[1, 2]]);
    expect(() => evaluateObservation(structuredClone(frozen), [1, 2])).toThrow(/controller/iu);
    expect(() => buildObservationCommand(structuredClone(frozen))).toThrow(/controller/iu);
    expect(evaluateObservation(frozen, { length: 2 })).toHaveProperty('status', 'failed');
    expect(() => evaluateObservation(frozen, Number.NaN)).toThrow(/typed/iu);
    expect(() => decodeObservation(result('{"version":1,"value":{"a":1,"a":2}}'))).toThrow(/duplicate/iu);
    expect(() => decodeObservation(result('{"version":1,"value":{"a":1,"\\u0061":2}}'))).toThrow(/duplicate/iu);
    expect(decodeObservation(result('{"version":1,"value":3.0}'))).toBe(3);
  });
  it('executes the codec round-trip and checks the controller-held input', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-codec-protocol-'));
    try {
      await writeFile(join(dir, 'target.mjs'), 'export const call = JSON.stringify; export const decode = JSON.parse;');
      const frozen = probe({ id: 'test', kind: 'codec-round-trip', target, decodeExport: 'decode', examples: [{ hello: 'world' }] }, [{ hello: 'world' }]);
      const observed = await exec('/bin/sh', ['-c', buildObservationCommand(frozen)], { cwd: dir, timeout: 10000 });
      expect(evaluateObservation(frozen, decodeObservation(result(observed.stdout)))).toHaveProperty('status', 'passed');
      expect(() => probe({ id: 'test', kind: 'codec-round-trip', target, decodeExport: 'decode', examples: [1] }, [2])).toThrow(/domain/iu);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 30000);
  it.each([
    ['wrong arithmetic', 'export const call = (a,b) => Math.floor(a/b);', 'failed'],
    ['forged verdict', 'export const call = () => ({success:true});', 'failed'],
    ['duplicate envelope', 'console.log(JSON.stringify({version:1,value:3})); export const call = () => 3;', 'protocol-error'],
    ['unsupported result', 'export const call = () => undefined;', 'process-error'],
    ['error exit', 'export const call = () => { throw Error("broken"); };', 'process-error'],
  ])('does not approve %s', async (_name, source, expected) => {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-adversarial-protocol-'));
    try {
      await writeFile(join(dir, 'target.mjs'), source);
      const frozen = probe({ id: 'test', kind: 'ceiling-division', target, maxItems: 100, maxDivisor: 20 }, [21, 10]);
      const run = exec('/bin/sh', ['-c', buildObservationCommand(frozen)], { cwd: dir, timeout: 10000, maxBuffer: 20000 });
      if (expected === 'process-error') { await expect(run).rejects.toThrow(); return; }
      const observed = await run;
      if (expected === 'protocol-error') expect(() => decodeObservation(result(observed.stdout))).toThrow();
      else expect(evaluateObservation(frozen, decodeObservation(result(observed.stdout)))).toHaveProperty('status', 'failed');
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 30000);
});


describe('trusted target path confinement', () => {
  it.each(['json', 'javascript', 'python'])('rejects symlink escape for %s', async (adapter) => {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-path-protocol-'));
    const outside = await mkdtemp(join(tmpdir(), 'sutura-outside-protocol-'));
    try {
      const path = adapter === 'json' ? 'config.json' : adapter === 'python' ? 'target.py' : 'target.mjs';
      await writeFile(join(outside, path), adapter === 'json' ? '{"strict":true}' : adapter === 'python' ? 'def call(a,b): return 3' : 'export const call=()=>3;');
      await symlink(join(outside, path), join(dir, path));
      const contract = adapter === 'json'
        ? { id: 'test', kind: 'json-property', target: { adapter, path }, property: ['strict'], expected: true }
        : { id: 'test', kind: 'ceiling-division', target: { adapter, path, export: 'call' }, maxItems: 100, maxDivisor: 20 };
      const frozen = probe(contract, adapter === 'json' ? [] : [21, 10]);
      await expect(exec('/bin/sh', ['-c', buildObservationCommand(frozen)], { cwd: dir, timeout: 10000 })).rejects.toThrow(/target escapes snapshot/iu);
    } finally { await rm(dir, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  }, 30000);
});


it('fixes executor context and environment for observation', async () => {
  const frozen = probe({ id: 'test', kind: 'ceiling-division', target: { adapter: 'javascript', path: 'target.mjs', export: 'call' }, maxItems: 100, maxDivisor: 20 }, [21, 10]);
  const run = vi.fn().mockResolvedValue({ ...result('{"version":1,"value":3}'), imageId: 'image', metrics: {} });
  expect(await observeProbe({ run }, 'image', frozen)).toBe(3);
  expect(run).toHaveBeenCalledWith('image', expect.any(String), expect.objectContaining({ cwd: '/workspace', timeoutSec: 10, network: 'disabled', env: expect.objectContaining({ NODE_OPTIONS: '', NODE_PATH: '', PYTHONPATH: '' }) }));
});

it.each(['javascript', 'python', 'json'])('rejects in-snapshot symlink target for %s', async (adapter) => {
  const dir = await mkdtemp(join(tmpdir(), 'sutura-internal-symlink-'));
  try {
    const path = adapter === 'json' ? 'config.json' : adapter === 'python' ? 'target.py' : 'target.mjs';
    await writeFile(join(dir, 'real-' + path), adapter === 'json' ? '{"strict":true}' : adapter === 'python' ? 'def call(a,b): return 3' : 'export const call=()=>3;');
    await symlink(join(dir, 'real-' + path), join(dir, path));
    const contract = adapter === 'json'
      ? { id: 'test', kind: 'json-property', target: { adapter, path }, property: ['strict'], expected: true }
      : { id: 'test', kind: 'ceiling-division', target: { adapter, path, export: 'call' }, maxItems: 100, maxDivisor: 20 };
    const frozen = probe(contract, adapter === 'json' ? [] : [21, 10]);
    await expect(exec('/bin/sh', ['-c', buildObservationCommand(frozen)], { cwd: dir, timeout: 10000 })).rejects.toThrow(/symlink/iu);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 30000);

it.each([
  ['tuple', 'return (1,2)'],
  ['integer dict key', 'return {1:2}'],
  ['too many entries', 'return list(range(129))'],
  ['nonfinite', 'return float("nan")'],
])('rejects Python %s before lossy JSON serialization', async (_name, statement) => {
  const dir = await mkdtemp(join(tmpdir(), 'sutura-python-shape-'));
  try {
    await writeFile(join(dir, 'target.py'), `def call():\n ${statement}\n`);
    const frozen = probe({ id: 'test', kind: 'exact', target: { adapter: 'python', path: 'target.py', export: 'call' }, examples: [{ args: [], expected: null }] }, []);
    await expect(exec('/bin/sh', ['-c', buildObservationCommand(frozen)], { cwd: dir, timeout: 10000 })).rejects.toThrow(/typed|limit|unsupported/iu);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 30000);
