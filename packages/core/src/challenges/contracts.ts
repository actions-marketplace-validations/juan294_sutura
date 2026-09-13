import { Buffer } from 'node:buffer';
import { isVerificationPrivatePath } from '../security/repository-path.js';

export type TypedValue = null | boolean | number | string | TypedValue[] | { [key: string]: TypedValue };
export interface CallableTarget {
  adapter: 'javascript' | 'typescript' | 'python';
  path: string;
  export: string;
}
export interface JsonTarget { adapter: 'json'; path: string }
interface ContractBase { id: string }
export type VerificationContract = ContractBase & (
  | { kind: 'ceiling-division'; target: CallableTarget; maxItems: number; maxDivisor: number }
  | { kind: 'cardinality'; target: CallableTarget; maxItems: number }
  | { kind: 'codec-round-trip'; target: CallableTarget; decodeExport: string; examples: TypedValue[] }
  | { kind: 'exact'; target: CallableTarget; examples: { args: TypedValue[]; expected: TypedValue }[] }
  | { kind: 'json-property'; target: JsonTarget; property: string[]; expected: TypedValue }
);
export interface VerificationPolicy { mode: 'required' | 'optional' | 'disabled'; contracts: VerificationContract[] }
export class ContractValidationError extends Error {}

export function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ContractValidationError(`${name} must be an object`);
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new ContractValidationError(`unknown key: ${unexpected}`);
}
function boundedInteger(value: unknown, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new ContractValidationError('contract limit must be a bounded integer');
  return value as number;
}
export function typedValue(value: unknown): TypedValue {
  const visit = (entry: unknown, depth: number): void => {
    if (depth > 8) throw new ContractValidationError('typed value exceeds depth limit');
    if (entry === null || typeof entry === 'boolean') return;
    if (typeof entry === 'number' && Number.isFinite(entry) && Math.abs(entry) <= Number.MAX_SAFE_INTEGER) return;
    if (typeof entry === 'string' && entry.length <= 2048) return;
    if (Array.isArray(entry)) {
      if (entry.length > 128) throw new ContractValidationError('typed array exceeds limit');
      for (const item of entry) visit(item, depth + 1);
      return;
    }
    if (typeof entry === 'object' && entry !== null && Object.getPrototypeOf(entry) === Object.prototype) {
      const entries = Object.entries(entry);
      if (entries.length > 64) throw new ContractValidationError('typed object exceeds limit');
      for (const [key, item] of entries) {
        propertyKey(key);
        visit(item, depth + 1);
      }
      return;
    }
    throw new ContractValidationError('unsupported typed value');
  };
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > 8192) throw new ContractValidationError('typed value exceeds byte limit');
  return structuredClone(value) as TypedValue;
}
function propertyKey(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 120 || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new ContractValidationError('invalid property key');
  return value;
}
function exportName(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,79}$/u.test(value)) throw new ContractValidationError('invalid callable export');
  return value;
}
function target(value: unknown, json: boolean): CallableTarget | JsonTarget {
  const parsed = record(value, 'contract target');
  keys(parsed, json ? ['adapter', 'path'] : ['adapter', 'path', 'export']);
  if (typeof parsed.path !== 'string' || parsed.path.length > 240 || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u.test(parsed.path) || parsed.path.split('/').some((p) => ['.', '..', '.git'].includes(p)) || isVerificationPrivatePath(parsed.path)) throw new ContractValidationError('invalid trusted target path');
  if (json) {
    if (parsed.adapter !== 'json' || !parsed.path.endsWith('.json')) throw new ContractValidationError('JSON contract requires a JSON target');
    return { adapter: 'json', path: parsed.path };
  }
  if (parsed.adapter !== 'javascript' && parsed.adapter !== 'typescript' && parsed.adapter !== 'python') throw new ContractValidationError('unsupported callable adapter');
  const extensions = { javascript: /\.(?:mjs|cjs|js)$/u, typescript: /\.(?:mts|ts)$/u, python: /\.py$/u };
  if (!extensions[parsed.adapter].test(parsed.path)) throw new ContractValidationError('target extension does not match adapter');
  return { adapter: parsed.adapter, path: parsed.path, export: exportName(parsed.export) };
}
function examples(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) throw new ContractValidationError('contract requires 1–16 examples');
  return value;
}
export function parseVerificationPolicy(input: unknown): VerificationPolicy {
  const value = record(input, 'verification policy');
  keys(value, ['mode', 'contracts']);
  if (value.mode !== 'required' && value.mode !== 'optional' && value.mode !== 'disabled') throw new ContractValidationError('invalid verification mode');
  if (!Array.isArray(value.contracts) || value.contracts.length > 32) throw new ContractValidationError('contracts must be a bounded array');
  const ids = new Set<string>();
  const contracts = value.contracts.map((item): VerificationContract => {
    const c = record(item, 'contract');
    const id = exportName(c.id);
    if (ids.has(id)) throw new ContractValidationError('duplicate contract id');
    ids.add(id);
    const common = ['id', 'kind', 'target'];
    if (c.kind === 'json-property') {
      keys(c, [...common, 'property', 'expected']);
      if (!Array.isArray(c.property) || c.property.length === 0 || c.property.length > 8) throw new ContractValidationError('invalid JSON property path');
      return { id, kind: c.kind, target: target(c.target, true) as JsonTarget, property: c.property.map(propertyKey), expected: typedValue(c.expected) };
    }
    const callable = target(c.target, false) as CallableTarget;
    if (c.kind === 'ceiling-division') {
      keys(c, [...common, 'maxItems', 'maxDivisor']);
      return { id, kind: c.kind, target: callable, maxItems: boundedInteger(c.maxItems, 0), maxDivisor: boundedInteger(c.maxDivisor, 1) };
    }
    if (c.kind === 'cardinality') {
      keys(c, [...common, 'maxItems']);
      const maxItems = boundedInteger(c.maxItems, 0);
      if (maxItems > 128) throw new ContractValidationError('cardinality exceeds typed array limit');
      return { id, kind: c.kind, target: callable, maxItems };
    }
    if (c.kind === 'codec-round-trip') {
      keys(c, [...common, 'decodeExport', 'examples']);
      return { id, kind: c.kind, target: callable, decodeExport: exportName(c.decodeExport), examples: examples(c.examples).map(typedValue) };
    }
    if (c.kind === 'exact') {
      keys(c, [...common, 'examples']);
      return { id, kind: c.kind, target: callable, examples: examples(c.examples).map((example) => {
        const e = record(example, 'example');
        keys(e, ['args', 'expected']);
        const args = typedValue(e.args);
        if (!Array.isArray(args) || args.length > 8) throw new ContractValidationError('invalid example arguments');
        return { args, expected: typedValue(e.expected) };
      }) };
    }
    throw new ContractValidationError('unsupported declarative contract');
  });
  return { mode: value.mode, contracts };
}
