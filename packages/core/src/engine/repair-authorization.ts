import { createHash } from 'node:crypto';
import { basename, dirname, posix } from 'node:path';
import { canonicalJson } from '../replay/canonical-json.js';
import { parseUnifiedDiff } from '../diff/unified.js';
import { evaluatePatchPolicy, policyAllowsPatchPath, policyAllowsSourceRead } from '../policy/evaluate.js';
import type { RepositoryPolicy } from '../policy/schema.js';
import { isSensitiveRepositoryPath } from '../security/repository-path.js';
import type { RepairSourceExcerpt } from './repair.js';
import type { PatchVerdict } from './patch-rules.js';
import { existingStrictRequirement, strictJson, validateAwaitEdit, validateAwaitSource, validateStrictConfigEdit } from './repair-authorization-syntax.js';

interface BaselineFields { policySha256: string; baselineImageId: string; snapshotSha256: string | null }
export type ControllerBaselineBinding = BaselineFields & (
  | { kind: 'git'; sourceSha: string; policyBaseSha: string }
  | { kind: 'local-snapshot'; sourceSha: string | null; policyBaseSha: string | null }
);
export type RepairAuthorizationBaseline = ControllerBaselineBinding;
export interface RepairAuthorizationSession { readonly version: 'sutura-repair-authorization-v1' }
export interface RepairAuthorizationContext { session: RepairAuthorizationSession; baseline: ControllerBaselineBinding }
export type RepairAuthorizationKind = 'await-operation' | 'await-setup' | 'restore-strict-config';
export interface RepairAuthorizationEvidence {
  kind: RepairAuthorizationKind; path: string; excerptSha256: string;
  baseline: ControllerBaselineBinding; failingCommand: string;
  evidenceReferences: string[]; probeId: string; probeOutputSha256: string;
  strictKey?: 'strict' | 'noUncheckedIndexedAccess';
}
export interface RepairAuthorizationInput {
  kind: RepairAuthorizationKind; path: string; evidenceReferences: string[];
  controllerProbe: { id: string; imageId: string; exitCode: number; output: string; sourceSha256: string; failingCommand: string };
  strictKey?: 'strict' | 'noUncheckedIndexedAccess';
}
interface State {
  baseline: ControllerBaselineBinding; failingCommand: string; policy: RepositoryPolicy;
  sources: RepairSourceExcerpt[]; grants: Map<string, RepairAuthorizationEvidence>;
  certificates: Map<string, Set<string>>;
}
const sessions = new WeakMap<RepairAuthorizationSession, State>();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (reason: string): PatchVerdict => ({ ok: false, violations: [reason] });
function validBinding(binding: ControllerBaselineBinding): boolean {
  if (!binding || !['git', 'local-snapshot'].includes(binding.kind) || !/^[a-f0-9]{64}$/u.test(binding.policySha256) || typeof binding.baselineImageId !== 'string' || !binding.baselineImageId || binding.baselineImageId.length > 256) return false;
  if (binding.snapshotSha256 !== null && !/^[a-f0-9]{64}$/u.test(binding.snapshotSha256)) return false;
  return [binding.sourceSha, binding.policyBaseSha].every((sha) => sha === null ? binding.kind === 'local-snapshot' : /^[a-f0-9]{40}$/u.test(sha));
}
function bound(session: RepairAuthorizationSession, baseline: ControllerBaselineBinding): State | undefined {
  const state = sessions.get(session);
  return state && validBinding(baseline) && canonicalJson(state.baseline) === canonicalJson(baseline) ? state : undefined;
}
export function createRepairAuthorizationSession(input: { baseline: ControllerBaselineBinding; failingCommand: string; policy: RepositoryPolicy; sources: readonly RepairSourceExcerpt[] }): RepairAuthorizationSession {
  if (!validBinding(input.baseline) || !input.failingCommand.trim() || input.failingCommand.length > 4096 || input.sources.length > 8) throw new Error('invalid controller repair binding');
  const session = Object.freeze({ version: 'sutura-repair-authorization-v1' as const });
  sessions.set(session, { baseline: structuredClone(input.baseline), failingCommand: input.failingCommand, policy: structuredClone(input.policy), sources: structuredClone([...input.sources]), grants: new Map(), certificates: new Map() });
  return session;
}

export async function deriveRepairAuthorization(session: RepairAuthorizationSession, input: RepairAuthorizationInput): Promise<{ ok: true } | { ok: false; reason: string }> {
  const state = sessions.get(session);
  if (!state) return { ok: false, reason: 'fabricated authorization session' };
  const source = state.sources.find((s) => s.path === input.path);
  const probe = input.controllerProbe;
  if (!source || source.startLine !== 1 || source.truncated || !source.content || Buffer.byteLength(source.content) > 16_000 || isSensitiveRepositoryPath(input.path) || !policyAllowsSourceRead(input.path, state.policy) || !policyAllowsPatchPath(input.path, state.policy)) return { ok: false, reason: 'source is incomplete, unsupported, or policy-protected' };
  if (!probe || probe.sourceSha256 !== digest(source.content) || probe.failingCommand !== state.failingCommand || probe.id !== (input.kind === 'restore-strict-config' ? 'strict-json' : 'async-completion') || probe.imageId !== state.baseline.baselineImageId || !Number.isSafeInteger(probe.exitCode) || probe.exitCode === 0 || typeof probe.output !== 'string' || Buffer.byteLength(probe.output) > 16_384 || input.evidenceReferences.length === 0 || input.evidenceReferences.length > 8 || input.evidenceReferences.some((ref) => typeof ref !== 'string' || !ref || ref.length > 256)) return { ok: false, reason: 'missing baseline controller probe evidence' };
  if (input.kind === 'restore-strict-config') {
    const key = input.strictKey;
    if (!key || !['strict', 'noUncheckedIndexedAccess'].includes(key) || !/(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/u.test(input.path)) return { ok: false, reason: 'unsupported strict configuration target' };
    const declared = state.policy.verification?.contracts.some((c) => c.kind === 'json-property' && c.target.path === input.path && canonicalJson(c.property) === canonicalJson(['compilerOptions', key]) && c.expected === true) === true;
    const existing = state.sources.some((s) => !s.truncated && s.startLine === 1 && Buffer.byteLength(s.content) <= 16_000 && policyAllowsSourceRead(s.path, state.policy) && dirname(s.path) === dirname(input.path) && /\.test\.[cm]?js$/u.test(s.path) && existingStrictRequirement(s.content, basename(input.path), key));
    if (!declared && !existing) return { ok: false, reason: 'strict key has no trusted contract or recognized existing check' };
    try {
      const config = strictJson(source.content);
      const options = config.compilerOptions;
      if (!options || typeof options !== 'object' || Array.isArray(options) || (Object.hasOwn(options, key) && (options as Record<string, unknown>)[key] !== false)) return { ok: false, reason: 'strict key is not missing or false' };
    } catch { return { ok: false, reason: 'unsupported strict JSON source' }; }
  } else if (!['await-operation', 'await-setup'].includes(input.kind) || !/promise|coroutine|await|asynchronous|async setup/iu.test(probe.output)) return { ok: false, reason: 'probe does not support an async completion repair' };
  else {
    try { await validateAwaitSource(source.content, input.path); }
    catch { return { ok: false, reason: 'unsupported or invalid complete async source' }; }
  }
  if (state.grants.size >= 3 && !state.grants.has(input.path)) return { ok: false, reason: 'grant limit reached' };
  state.grants.set(input.path, { kind: input.kind, path: input.path, excerptSha256: digest(source.content), baseline: structuredClone(state.baseline), failingCommand: state.failingCommand, evidenceReferences: [...input.evidenceReferences], probeId: probe.id, probeOutputSha256: digest(probe.output), ...(input.strictKey === undefined ? {} : { strictKey: input.strictKey }) });
  state.certificates.clear();
  return { ok: true };
}

export function isAuthorizedRepairTarget(session: RepairAuthorizationSession, baseline: ControllerBaselineBinding, source: RepairSourceExcerpt): boolean {
  const state = bound(session, baseline); const grant = state?.grants.get(source.path);
  return grant !== undefined && source.startLine === 1 && !source.truncated && digest(source.content) === grant.excerptSha256;
}

/**
 * The single position at or after `from` whose lines equal the hunk's baseline
 * context. Locating by content rather than by the declared line number matches
 * what `git apply` searches for, so a correct repair is not refused over a hunk
 * header offset. An absent or repeated context is refused, which keeps the
 * application unique and independent of any number the candidate supplies.
 */
function hunkPosition(lines: readonly string[], old: readonly string[], from: number): number {
  let found = -1;
  for (let index = from; index + old.length <= lines.length; index += 1) {
    if (!old.every((line, offset) => lines[index + offset] === line)) continue;
    if (found !== -1) throw new Error('diff matches more than one baseline position');
    found = index;
  }
  if (found === -1) throw new Error('diff does not match exact baseline source');
  return found;
}

/** Apply only exact-context non-overlapping hunks to the controller-held complete baseline. */
function patchedSource(source: string, diff: string, path: string): string {
  const parsed = parseUnifiedDiff(diff);
  if (!parsed.valid || parsed.files.length !== 1) throw new Error('grant requires exactly one complete file change');
  const file = parsed.files[0]!;
  if (file.deleted || file.renamed || file.oldPath !== path || file.newPath !== path) throw new Error('grant cannot authorize file creation, rename, or deletion');
  const newline = source.endsWith('\n'); const lines = source.split('\n'); if (newline) lines.pop();
  let cursor = 0;
  for (const hunk of file.hunks) {
    if (hunk.lines.some((line) => line.startsWith('\\'))) throw new Error('unsupported newline change');
    const old: string[] = []; const next: string[] = [];
    for (const line of hunk.lines) { if (line[0] === ' ' || line[0] === '-') old.push(line.slice(1)); if (line[0] === ' ' || line[0] === '+') next.push(line.slice(1)); }
    if (old.length === 0) throw new Error('hunk declares no baseline context to locate');
    const at = hunkPosition(lines, old, cursor);
    lines.splice(at, old.length, ...next); cursor = at + next.length;
  }
  return lines.join('\n') + (newline ? '\n' : '');
}

export async function authorizeRepairCandidate(session: RepairAuthorizationSession, baseline: ControllerBaselineBinding, diff: string): Promise<PatchVerdict> {
  const state = bound(session, baseline); if (!state) return fail('fabricated or stale repair authorization');
  try {
    const policy = evaluatePatchPolicy(diff, state.policy); if (!policy.ok) return policy;
    const parsed = parseUnifiedDiff(diff); if (!parsed.valid || parsed.files.length !== 1) return fail('grant requires one exact authorized path');
    const path = parsed.files[0]!.newPath; const grant = path ? state.grants.get(path) : undefined;
    if (!path || !grant || posix.normalize(path) !== path) return fail('candidate path has no controller grant');
    const source = state.sources.find((s) => s.path === path)!; const after = patchedSource(source.content, diff, path);
    if (grant.kind === 'restore-strict-config') validateStrictConfigEdit(source.content, after, grant.strictKey!);
    else await validateAwaitEdit(source.content, after, path);
    if (state.certificates.size >= 64) return fail('authorization certificate limit reached');
    state.certificates.set(digest(diff), new Set([path])); return { ok: true, violations: [] };
  } catch (error) { return fail(`repair shape refused: ${error instanceof Error ? error.message : String(error)}`); }
}

export function checkRepairAuthorization(session: RepairAuthorizationSession, baseline: ControllerBaselineBinding, diff: string, path: string): boolean {
  return bound(session, baseline)?.certificates.get(digest(diff))?.has(path) === true;
}
export function repairAuthorizationCommandMatches(context: RepairAuthorizationContext, command: string): boolean {
  return bound(context.session, context.baseline)?.failingCommand === command;
}
export function repairAuthorizationEvidence(session: RepairAuthorizationSession): readonly RepairAuthorizationEvidence[] {
  return structuredClone([...(sessions.get(session)?.grants.values() ?? [])]);
}
