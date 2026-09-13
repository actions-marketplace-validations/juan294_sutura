import { createHash } from 'node:crypto';

import { canonicalJson } from '../replay/canonical-json.js';
import { NODE_LOCKFILE_PATH, NODE_MANIFEST_PATH } from './repair-targets.js';

/** Dependency sections a repair may change; everything else stays byte-identical. */
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
type DependencySection = typeof DEPENDENCY_SECTIONS[number];

/**
 * An exact pinned release. A range, tag, local path, URL, git reference or
 * alias is refused: the transaction has to resolve to the one version the
 * grounding evidence actually validated.
 */
const PINNED_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const PACKAGE_NAME = /^(?:@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9-][a-z0-9._-]*$/u;

/** Registry origins a generated lockfile may reference. */
export const APPROVED_REGISTRY_ORIGINS = Object.freeze(['https://registry.npmjs.org/']);

export const MAX_GENERATED_LOCKFILE_BYTES = 262_144;

export interface DependencyGrounding {
  packageName: string;
  version: string;
  /** Citation identities the grounding step already validated. */
  evidenceReferences: string[];
}

export interface DependencyManifestChange {
  section: DependencySection;
  packageName: string;
  fromVersion: string;
  toVersion: string;
}

export class DependencyTransactionError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'DependencyTransactionError';
  }
}

function refuse(reason: string): never {
  throw new DependencyTransactionError(reason);
}

function parseManifest(source: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    refuse(`${label} manifest is not valid JSON`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    refuse(`${label} manifest must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function section(manifest: Record<string, unknown>, name: DependencySection): Record<string, string> {
  const value = manifest[name];
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    refuse(`${name} must be an object`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([, specifier]) => typeof specifier !== 'string')) {
    refuse(`${name} versions must be strings`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function withoutDependencySections(manifest: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(manifest).filter(([key]) => !DEPENDENCY_SECTIONS.includes(key as DependencySection)),
  );
}

/**
 * The one exact dependency-version change the repair is allowed to make.
 *
 * Everything outside the dependency sections must stay byte-identical, which
 * keeps a lifecycle script, a registry override or a package-manager pin from
 * riding along with a version bump. Exactly one package in one section may
 * move, both sides must be pinned releases, and the destination must be the
 * version the grounding evidence validated.
 */
export function validateDependencyManifestChange(
  before: string,
  after: string,
  grounding: DependencyGrounding,
): DependencyManifestChange {
  const oldManifest = parseManifest(before, 'baseline');
  const newManifest = parseManifest(after, 'candidate');

  if (canonicalJson(withoutDependencySections(oldManifest)) !==
    canonicalJson(withoutDependencySections(newManifest))) {
    refuse('only dependency versions may change');
  }

  const changes: DependencyManifestChange[] = [];
  for (const name of DEPENDENCY_SECTIONS) {
    const oldSection = section(oldManifest, name);
    const newSection = section(newManifest, name);
    const keys = [...new Set([...Object.keys(oldSection), ...Object.keys(newSection)])];
    for (const key of keys) {
      const fromVersion = oldSection[key];
      const toVersion = newSection[key];
      if (fromVersion === toVersion) continue;
      if (fromVersion === undefined) refuse(`${key} was added; only an existing dependency may change`);
      if (toVersion === undefined) refuse(`${key} was removed; only an existing dependency may change`);
      changes.push({ section: name, packageName: key, fromVersion, toVersion });
    }
  }

  if (changes.length === 0) refuse('no dependency version changed');
  if (changes.length > 1) refuse('exactly one dependency version may change');

  const change = changes[0]!;
  if (!PACKAGE_NAME.test(change.packageName)) refuse(`unsupported package name: ${change.packageName}`);
  if (!PINNED_VERSION.test(change.fromVersion)) {
    refuse(`baseline ${change.packageName} is not a pinned release`);
  }
  if (!PINNED_VERSION.test(change.toVersion)) {
    refuse(`${change.packageName} must move to an exact pinned release`);
  }
  if (change.packageName !== grounding.packageName) {
    refuse(`${change.packageName} is not the grounded package ${grounding.packageName}`);
  }
  if (change.toVersion !== grounding.version) {
    refuse(`${change.packageName}@${change.toVersion} is not the grounded version ${grounding.version}`);
  }
  if (grounding.evidenceReferences.length === 0) {
    refuse('grounded dependency change requires at least one citation identity');
  }
  return change;
}

export interface DependencyResolutionInput {
  /** Only the manifest reaches the preparation lane; no repository source does. */
  files: Record<string, string>;
  command: string;
  scriptsDisabled: true;
}

/**
 * The minimal input the network-enabled preparation lane receives. It carries
 * the candidate manifest and nothing else, so repository source and any
 * model-authored command stay out of the lane that can reach a registry.
 */
export function dependencyResolutionInput(
  candidateManifest: string,
  preparationCommand: string,
): DependencyResolutionInput {
  if (!preparationCommand.trim()) refuse('dependency preparation command is required');
  return {
    files: { [NODE_MANIFEST_PATH]: candidateManifest },
    command: preparationCommand,
    scriptsDisabled: true,
  };
}

export interface GeneratedLockfile {
  path: string;
  content: string;
  sha256: string;
}

function lockfileOrigins(content: string): string[] {
  return [...content.matchAll(/\b(?:https?|git\+ssh|git\+https|file):\/\/[^\s'"]+/gu)]
    .map((match) => match[0]);
}

/**
 * Accepts a lockfile only when the pinned manager produced the same bytes
 * twice from the same inputs and every origin it references is approved. A
 * nondeterministic, oversized, empty or unexpectedly-origined artifact
 * abstains instead of entering the transaction.
 */
export function validateGeneratedLockfile(
  runs: readonly string[],
  options: { approvedOrigins?: readonly string[]; maxBytes?: number } = {},
): GeneratedLockfile {
  const approved = options.approvedOrigins ?? APPROVED_REGISTRY_ORIGINS;
  const maxBytes = options.maxBytes ?? MAX_GENERATED_LOCKFILE_BYTES;
  if (runs.length < 2) refuse('lockfile determinism requires at least two resolution runs');
  const [content] = runs;
  if (content === undefined || !content.trim()) refuse('dependency resolution produced no lockfile');
  if (runs.some((run) => run !== content)) refuse('dependency resolution was not deterministic');
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    refuse(`generated lockfile exceeds the ${maxBytes} byte artifact bound`);
  }
  const unapproved = lockfileOrigins(content)
    .filter((origin) => !approved.some((prefix) => origin.startsWith(prefix)));
  if (unapproved.length > 0) {
    refuse(`generated lockfile references an unapproved origin: ${unapproved[0]}`);
  }
  return {
    path: NODE_LOCKFILE_PATH,
    content,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}
