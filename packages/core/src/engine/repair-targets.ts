import { createHash } from 'node:crypto';
import { posix } from 'node:path';

import { policyAllowsPatchPath } from '../policy/evaluate.js';
import type { RepositoryPolicy } from '../policy/schema.js';
import type { RuntimeId } from '../runtime/types.js';
import type { RepairSourceExcerpt } from './repair.js';
import { sourceDependencyGroups } from './source-context.js';

/**
 * The total changed-file cap for one repair transaction, including any
 * controller-generated artifact. A repository policy may be stricter; it can
 * never widen this bound.
 */
export const MAX_REPAIR_TARGET_FILES = 2;
/** At most this many pair candidates join the existing bounded single-file search. */
export const MAX_REPAIR_PAIR_TARGETS = 2;

export const NODE_MANIFEST_PATH = 'package.json';
export const NODE_LOCKFILE_PATH = 'pnpm-lock.yaml';

export type RepairTargetKind = 'single' | 'related-source' | 'manifest-lockfile';

export interface RepairTargetSlot {
  /** Stable within a target set; the model names this, never a path or range. */
  slotId: string;
  path: string;
  startLine: number;
  endLine: number;
  contentSha256: string;
  /**
   * The controller produces this file with a pinned tool rather than asking the
   * model for its content. A generated slot is never offered for completion and
   * never accepts model-authored text.
   */
  generated: boolean;
}

export interface RepairTargetRelationship {
  /** The import specifier that resolved one slot's path to the other. */
  specifier: string;
  from: string;
  to: string;
}

export interface RepairTargetSet {
  /** Stable across a run for the same paths, ranges and content. */
  setId: string;
  kind: RepairTargetKind;
  slots: RepairTargetSlot[];
  relationship?: RepairTargetRelationship;
}

/** The per-source facts target selection needs, as `sourceEvidence` already computes them. */
export interface RepairTargetSource {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  editable: boolean;
}

export function repairTargetFileCap(policy: RepositoryPolicy): number {
  return Math.min(MAX_REPAIR_TARGET_FILES, policy.maxChangedFiles);
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function slot(source: RepairTargetSource, index: number, generated = false): RepairTargetSlot {
  return {
    slotId: `slot-${index + 1}`,
    path: source.path,
    startLine: source.startLine,
    endLine: source.endLine,
    contentSha256: digest(source.content),
    generated,
  };
}

/** The slots the model may complete; a generated slot is controller-owned. */
export function modelRepairSlots(set: RepairTargetSet): RepairTargetSlot[] {
  return set.slots.filter(({ generated }) => !generated);
}

function setId(kind: RepairTargetKind, slots: readonly RepairTargetSlot[]): string {
  return `${kind}:${digest(slots
    .map(({ path, startLine, endLine, contentSha256, generated }) =>
      `${path}:${startLine}:${endLine}:${contentSha256}:${generated ? 'generated' : 'completed'}`)
    .join('\n')).slice(0, 16)}`;
}

function targetSet(
  kind: RepairTargetKind,
  sources: readonly RepairTargetSource[],
  relationship?: RepairTargetRelationship,
): RepairTargetSet {
  const slots = sources.map((source, index) =>
    slot(source, index, kind === 'manifest-lockfile' && index === 1));
  return {
    setId: setId(kind, slots),
    kind,
    slots,
    ...(relationship === undefined ? {} : { relationship }),
  };
}

/**
 * The one source in `sources` a specifier resolves to. An import whose
 * candidate list matches more than one supplied source is ambiguous and
 * contributes no pair, which keeps a pair from resting on a guessed
 * resolution.
 */
function resolvedDependency(
  candidates: readonly string[],
  byPath: ReadonlyMap<string, RepairTargetSource>,
): RepairTargetSource | undefined {
  const resolved = candidates.flatMap((path) => {
    const source = byPath.get(path);
    return source === undefined ? [] : [source];
  });
  return resolved.length === 1 ? resolved[0] : undefined;
}

function isRootPath(path: string, name: string): boolean {
  return posix.normalize(path) === name;
}

/**
 * Bounded coherent target sets for one attempt: every editable source on its
 * own, then at most `MAX_REPAIR_PAIR_TARGETS` related pairs. A pair is only
 * a resolved import relationship between two supplied editable sources, or the
 * root Node manifest with its matching lockfile. Unrelated, ambiguous and
 * duplicate pairs are not offered at all, so no later gate has to recognize
 * them.
 */
export function selectRepairTargetSets(input: {
  sources: readonly RepairTargetSource[];
  runtimeId: RuntimeId;
  policy: RepositoryPolicy;
}): RepairTargetSet[] {
  const editable = input.sources.filter(({ editable }) => editable);
  const singles = editable.map((source) => targetSet('single', [source]));
  if (repairTargetFileCap(input.policy) < 2) return singles;

  const byPath = new Map<string, RepairTargetSource>();
  for (const source of editable) {
    if (!byPath.has(source.path)) byPath.set(source.path, source);
  }

  const pairs: RepairTargetSet[] = [];
  const seen = new Set<string>();
  const addPair = (
    left: RepairTargetSource,
    right: RepairTargetSource,
    kind: RepairTargetKind,
    relationship?: RepairTargetRelationship,
  ): void => {
    if (left.path === right.path || pairs.length >= MAX_REPAIR_PAIR_TARGETS) return;
    const key = [left.path, right.path].toSorted().join('\0');
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push(targetSet(kind, [left, right], relationship));
  };

  const excerpts: RepairSourceExcerpt[] = editable.map(({ path, startLine, content }) => ({
    path, startLine, content, truncated: false,
  }));
  for (const group of sourceDependencyGroups(excerpts, input.runtimeId)) {
    const from = byPath.get(group.sourcePath);
    const to = resolvedDependency(group.candidates, byPath);
    if (from === undefined || to === undefined) continue;
    addPair(from, to, 'related-source', {
      specifier: group.specifier, from: from.path, to: to.path,
    });
  }

  const manifest = editable.find(({ path }) => isRootPath(path, NODE_MANIFEST_PATH));
  const lockfile = editable.find(({ path }) => isRootPath(path, NODE_LOCKFILE_PATH));
  if (
    input.runtimeId === 'node' && manifest !== undefined && lockfile !== undefined &&
    policyAllowsPatchPath(manifest.path, input.policy) &&
    policyAllowsPatchPath(lockfile.path, input.policy)
  ) {
    addPair(manifest, lockfile, 'manifest-lockfile');
  }

  return [...singles, ...pairs];
}
