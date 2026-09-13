import { Buffer } from 'node:buffer';
import { isDeepStrictEqual } from 'node:util';
import { SNAPSHOT_CWD, type Executor, type ImageId, type RunResult } from '../executor/types.js';
import { shellQuote } from '../engine/shell.js';
import { keys, parseVerificationPolicy, record, typedValue, type TypedValue, type VerificationContract, type VerificationPolicy } from './contracts.js';

export type PolicyProvenance =
  | { policyBaseSha: string; policyHash: string; localSnapshotSha256?: never }
  | { policyBaseSha: null; policyHash: string; localSnapshotSha256: string };
export interface ProbeInvocation {
  target: VerificationContract['target'];
  args: TypedValue[];
  decodeExport?: string;
  property?: string[];
}
export interface FrozenProbe {
  readonly version: 1;
  readonly contractId: string;
  readonly provenance: Readonly<PolicyProvenance>;
  readonly invocation: Readonly<ProbeInvocation>;
}
type Assertion = { kind: 'exact' | 'cardinality'; expected: TypedValue };
// Assertions deliberately never enter commands, candidate snapshots, or serialized probes.
const assertions = new WeakMap<FrozenProbe, Assertion>();
function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function freezeProbe(policy: VerificationPolicy, provenance: PolicyProvenance, proposal: unknown): FrozenProbe {
  const validSource = provenance.policyBaseSha === null
    ? /^[a-f0-9]{64}$/u.test(provenance.localSnapshotSha256)
    : /^[a-f0-9]{40}$/u.test(provenance.policyBaseSha);
  if (!validSource || !/^[a-f0-9]{64}$/u.test(provenance.policyHash)) throw new Error('invalid trusted policy provenance');
  const parsed = record(proposal, 'probe proposal');
  keys(parsed, ['contractId', 'args']);
  const trusted = parseVerificationPolicy(policy);
  const contract = trusted.contracts.find((c) => c.id === parsed.contractId);
  if (!contract || trusted.mode === 'disabled') throw new Error('unsupported or missing contract authority');
  const args = typedValue(parsed.args);
  if (!Array.isArray(args) || args.length > 8) throw new Error('input outside declared domain');
  const invocation: ProbeInvocation = { target: contract.target, args };
  let assertion: Assertion;
  switch (contract.kind) {
    case 'ceiling-division': {
      const [items, divisor] = args;
      if (args.length !== 2 || typeof items !== 'number' || typeof divisor !== 'number' || !Number.isSafeInteger(items) || !Number.isSafeInteger(divisor) || items < 0 || items > contract.maxItems || divisor < 1 || divisor > contract.maxDivisor) throw new Error('input outside ceiling-division domain');
      // Integer arithmetic avoids floating-point rounding near MAX_SAFE_INTEGER.
      assertion = { kind: 'exact', expected: Number((BigInt(items) + BigInt(divisor) - 1n) / BigInt(divisor)) };
      break;
    }
    case 'cardinality':
      if (args.length !== 1 || !Array.isArray(args[0]) || args[0].length > contract.maxItems) throw new Error('input outside cardinality domain');
      assertion = { kind: 'cardinality', expected: args[0].length };
      break;
    case 'codec-round-trip':
      if (args.length !== 1 || !contract.examples.some((e) => isDeepStrictEqual(e, args[0]))) throw new Error('input outside declared codec domain');
      invocation.decodeExport = contract.decodeExport;
      assertion = { kind: 'exact', expected: args[0]! };
      break;
    case 'exact': {
      const example = contract.examples.find((e) => isDeepStrictEqual(e.args, args));
      if (!example) throw new Error('input outside exact example domain');
      assertion = { kind: 'exact', expected: example.expected };
      break;
    }
    case 'json-property':
      if (args.length !== 0) throw new Error('input outside JSON property domain');
      invocation.property = contract.property;
      assertion = { kind: 'exact', expected: contract.expected };
      break;
  }
  const probe = freeze({ version: 1 as const, contractId: contract.id, provenance: { ...provenance }, invocation });
  assertions.set(probe, freeze(assertion));
  return probe;
}

export function evaluateObservation(probe: FrozenProbe, observation: unknown): { status: 'passed' } | { status: 'failed'; reason: 'assertion-mismatch' } {
  const assertion = assertions.get(probe);
  if (!assertion) throw new Error('probe was not frozen by this controller');
  const value = typedValue(observation);
  const actual = assertion.kind === 'cardinality' ? (Array.isArray(value) ? value.length : undefined) : value;
  return isDeepStrictEqual(actual, assertion.expected) ? { status: 'passed' } : { status: 'failed', reason: 'assertion-mismatch' };
}

export const MAX_OBSERVATION_BYTES = 16_384;

function assertUniqueObjectKeys(json: string): void {
  const objects: (Set<string> | null)[] = [];
  for (let index = 0; index < json.length; index += 1) {
    const character = json[index];
    if (character === '{') {
      objects.push(new Set());
      continue;
    }
    if (character === '[') {
      objects.push(null);
      continue;
    }
    if (character === '}' || character === ']') {
      objects.pop();
      continue;
    }
    if (character !== '"') continue;

    const start = index;
    for (index += 1; index < json.length; index += 1) {
      if (json[index] === '\\') index += 1;
      else if (json[index] === '"') break;
    }
    let next = index + 1;
    while (json[next] === ' ' || json[next] === '\n' || json[next] === '\r' || json[next] === '\t') next += 1;
    if (json[next] !== ':') continue;
    const name = JSON.parse(json.slice(start, index + 1)) as string;
    const current = objects.at(-1);
    if (current?.has(name)) throw new Error('duplicate observation key');
    current?.add(name);
  }
}

export function decodeObservation(result: Pick<RunResult, 'stdout' | 'stderr' | 'exitCode' | 'truncated'>): TypedValue {
  if (result.exitCode !== 0) throw new Error('observation command has a nonzero exit code');
  if (result.truncated) throw new Error('observation output was truncated');
  if (Buffer.byteLength(result.stdout) > MAX_OBSERVATION_BYTES || Buffer.byteLength(result.stderr) > MAX_OBSERVATION_BYTES) throw new Error('observation exceeds byte limit');
  let parsed: unknown;
  try { parsed = JSON.parse(result.stdout); } catch { throw new Error('invalid or duplicate observation envelope'); }
  const envelope = record(parsed, 'observation envelope');
  keys(envelope, ['version', 'value']);
  if (envelope.version !== 1) throw new Error('unsupported observation version');
  const value = typedValue(envelope.value);
  // JSON.parse hides duplicate object keys; scan the already-valid JSON tokens too.
  assertUniqueObjectKeys(result.stdout);
  return value;
}

const JS_ADAPTER = `
const fs = await import('node:fs/promises');
const path = await import('node:path');
const url = await import('node:url');
const i = JSON.parse(Buffer.from(process.argv[1], 'base64').toString('utf8'));
const root = await fs.realpath(process.cwd());
const target = await fs.realpath(path.resolve(root, i.target.path));
if (!target.startsWith(root + path.sep)) throw Error('target escapes snapshot');
let current = root;
for (const part of i.target.path.split('/')) {
  current = path.join(current, part);
  if ((await fs.lstat(current)).isSymbolicLink()) throw Error('symlink target is unsupported');
}
let value;
if (i.target.adapter === 'json') {
  if ((await fs.stat(target)).size > 65536) throw Error('JSON target exceeds limit');
  value = JSON.parse(await fs.readFile(target, 'utf8'));
  for (const key of i.property) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value,key)) throw Error('missing JSON property');
    value = value[key];
  }
} else {
  const module = await import(url.pathToFileURL(target).href);
  if (typeof module[i.target.export] !== 'function') throw Error('missing callable');
  value = await module[i.target.export](...i.args);
  if (i.decodeExport) {
    if (typeof module[i.decodeExport] !== 'function') throw Error('missing decoder');
    value = await module[i.decodeExport](value);
  }
}
function validate(v, depth=0) {
  if (depth>8) throw Error('value depth');
  if (v===null || typeof v==='boolean') return;
  if (typeof v==='number' && Number.isFinite(v) && Math.abs(v)<=Number.MAX_SAFE_INTEGER) return;
  if (typeof v==='string' && v.length<=2048) return;
  if (Array.isArray(v) && v.length<=128) { for(const x of v) validate(x,depth+1); return; }
  if (typeof v==='object' && v!==null && Object.getPrototypeOf(v)===Object.prototype && Object.keys(v).length<=64) {
    for(const [k,x] of Object.entries(v)) { if(!k || k.length>120 || ['__proto__','constructor','prototype'].includes(k)) throw Error('invalid key'); validate(x,depth+1); } return;
  }
  throw Error('unsupported observation shape');
}
validate(value);
const output=JSON.stringify({version:1,value});
if(Buffer.byteLength(JSON.stringify(value))>8192) throw Error('observation bytes');
process.stdout.write(output+'\\n');
`;
const PYTHON_ADAPTER = `
import asyncio, base64, importlib.util, inspect, json, math, pathlib, sys
inv=json.loads(base64.b64decode(sys.argv[1]))
root=pathlib.Path.cwd().resolve()
target=(root/inv['target']['path']).resolve()
if root not in target.parents: raise ValueError('target escapes snapshot')
current=root
for part in inv['target']['path'].split('/'):
 current=current/part
 if current.is_symlink(): raise ValueError('symlink target is unsupported')
spec=importlib.util.spec_from_file_location('sutura_probe_target',target)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
async def observe():
 value=getattr(module,inv['target']['export'])(*inv['args'])
 if inspect.isawaitable(value): value=await value
 if 'decodeExport' in inv:
  value=getattr(module,inv['decodeExport'])(value)
  if inspect.isawaitable(value): value=await value
 return value
value=asyncio.run(observe())
def validate(value,depth=0):
 if depth>8: raise ValueError('typed value depth limit')
 if value is None or type(value) is bool: return
 if type(value) in (int,float) and math.isfinite(value) and abs(value)<=9007199254740991: return
 if type(value) is str and len(value)<=2048: return
 if type(value) is list and len(value)<=128:
  for item in value: validate(item,depth+1)
  return
 if type(value) is dict and len(value)<=64:
  for key,item in value.items():
   if type(key) is not str or not key or len(key)>120 or key in ('__proto__','constructor','prototype'): raise ValueError('unsupported typed property')
   validate(item,depth+1)
  return
 raise ValueError('unsupported typed observation')
validate(value)
if len(json.dumps(value,ensure_ascii=False).encode('utf8'))>8192: raise ValueError('typed observation byte limit')
print(json.dumps({'version':1,'value':value},separators=(',',':'),ensure_ascii=False,allow_nan=False))
`;
export function buildObservationCommand(probe: FrozenProbe): string {
  if (!assertions.has(probe)) throw new Error('probe was not frozen by this controller');
  const input = Buffer.from(JSON.stringify(probe.invocation)).toString('base64');
  if (probe.invocation.target.adapter === 'python') return `python3 -I -c ${shellQuote(PYTHON_ADAPTER)} ${shellQuote(input)}`;
  const ts = probe.invocation.target.adapter === 'typescript' ? ' --experimental-strip-types' : '';
  return `node${ts} --input-type=module -e ${shellQuote(JS_ADAPTER)} ${shellQuote(input)}`;
}

/** This uses ordinary executor stdout/exit, not an authenticated sandbox result channel. */
export async function observeProbe(executor: Pick<Executor, 'run'>, image: ImageId, probe: FrozenProbe): Promise<TypedValue> {
  const result = await executor.run(image, buildObservationCommand(probe), { cwd: SNAPSHOT_CWD, timeoutSec: 10, network: 'disabled', env: { NODE_OPTIONS: '', NODE_PATH: '', PYTHONPATH: '', PYTHONNOUSERSITE: '1', TZ: 'UTC', LANG: 'C.UTF-8' } });
  return decodeObservation(result);
}
