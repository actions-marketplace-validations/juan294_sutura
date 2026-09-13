import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import {
  createDefaultRepositoryPolicy,
  loadRepositoryPolicy,
  type LoadedRepositoryPolicy,
} from '../policy/load.js';
import { isSensitiveRepositoryPath, isVerificationPrivatePath } from '../security/repository-path.js';

const exec = promisify(execFile);

/** The trusted policy declaration is small; a larger object is refused unread. */
export const MAX_POLICY_OBJECT_BYTES = 65_536;
export const TRUSTED_POLICY_PATH = '.sutura.json';

export class VerifySourceError extends Error {
  constructor(readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'VerifySourceError';
  }
}

async function git(caseDir: string, args: readonly string[]): Promise<string> {
  const result = await exec('git', ['-C', caseDir, ...args], {
    maxBuffer: MAX_POLICY_OBJECT_BYTES * 4,
    timeout: 15_000,
  });
  return result.stdout;
}

/**
 * Confirms the checkout is exactly the commit whose failure is being verified,
 * with nothing else in the working tree.
 *
 * A patch is verified against a specific source state. If the checkout has
 * moved, or carries tracked or untracked product changes, the bytes that would
 * execute are not the bytes the identity names, so the run stops rather than
 * verifying something it cannot describe.
 */
export async function assertCleanCheckoutAt(
  caseDir: string,
  sourceSha: string,
): Promise<void> {
  let head: string;
  try {
    head = (await git(caseDir, ['rev-parse', 'HEAD'])).trim();
  } catch {
    throw new VerifySourceError('not-a-repository', `${caseDir} is not a Git checkout`);
  }
  if (head !== sourceSha) {
    throw new VerifySourceError(
      'source-sha-mismatch',
      `Checkout is at ${head}, not the declared source ${sourceSha}`,
    );
  }
  const status = (await git(caseDir, ['status', '--porcelain', '--untracked-files=all'])).trim();
  if (status) {
    throw new VerifySourceError(
      'dirty-checkout',
      'Checkout has tracked or untracked changes; verification needs the exact failed source',
    );
  }
}

/**
 * Reads the trusted repository policy from the operator's chosen commit.
 *
 * The commit is resolved through a bounded Git object read, never from the
 * working tree and never from the candidate patch, so a patch cannot supply a
 * more permissive policy by including one. An absent declaration means the
 * versioned built-in defaults; an unavailable or ambiguous commit, a
 * non-blob path and an oversized object are refused rather than guessed.
 */
export async function readTrustedPolicyAtCommit(
  caseDir: string,
  policyBaseSha: string,
): Promise<LoadedRepositoryPolicy> {
  let objectType: string;
  try {
    objectType = (await git(caseDir, ['cat-file', '-t', `${policyBaseSha}^{commit}`])).trim();
  } catch {
    throw new VerifySourceError(
      'policy-commit-unavailable',
      `Trusted policy commit ${policyBaseSha} is not available in this checkout`,
    );
  }
  if (objectType !== 'commit') {
    throw new VerifySourceError(
      'policy-commit-unavailable',
      `${policyBaseSha} does not name a commit`,
    );
  }

  let declaration: string;
  try {
    // ls-tree distinguishes an absent declaration from an unreadable blob.
    const entry = await git(caseDir, ['ls-tree', '-z', policyBaseSha, '--', TRUSTED_POLICY_PATH]);
    if (!entry) return { policy: createDefaultRepositoryPolicy(), sha: 'default', source: 'default' };
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t\.sutura\.json\u0000$/u.exec(entry);
    if (!match) {
      throw new VerifySourceError('policy-not-a-file', 'Trusted policy must be a regular Git blob');
    }
    const object = match[2]!;
    const size = Number((await git(caseDir, ['cat-file', '-s', object])).trim());
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid Git object size');
    if (size > MAX_POLICY_OBJECT_BYTES) {
      throw new VerifySourceError('policy-too-large', `Trusted policy exceeds ${MAX_POLICY_OBJECT_BYTES} bytes`);
    }
    declaration = await git(caseDir, ['cat-file', 'blob', object]);
    if (Buffer.byteLength(declaration, 'utf8') !== size) throw new Error('Git object size mismatch');
  } catch (error) {
    if (error instanceof VerifySourceError) throw error;
    throw new VerifySourceError('policy-read-failed', 'The declared trusted policy could not be read');
  }
  try {
    return loadRepositoryPolicy(declaration);
  } catch (error) {
    throw new VerifySourceError(
      'policy-invalid',
      `Trusted policy at ${policyBaseSha} is not valid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** A checkout larger than this is refused rather than copied file by file. */
export const MAX_SNAPSHOT_FILES = 20_000;
/** One tracked file larger than this is refused; the snapshot is source, not artifacts. */
export const MAX_SNAPSHOT_FILE_BYTES = 8 * 1024 * 1024;

export interface SourceSnapshot {
  /** The immutable temporary copy. Its files and directories are read-only. */
  dir: string;
  sourceSha: string;
  /** Digest over every copied path, executable bits and bytes, in path order. */
  snapshotSha256: string;
  files: string[];
  /** Restores permissions and removes the copy. Safe to call more than once. */
  cleanup: () => Promise<void>;
}

function digestOf(entries: ReadonlyArray<readonly [string, string]>): string {
  const hash = createHash('sha256');
  for (const [path, contentSha] of entries) hash.update(`${path}\u0000${contentSha}\u0000`);
  return hash.digest('hex');
}

async function trackedFiles(caseDir: string): Promise<string[]> {
  const listing = await git(caseDir, ['ls-files', '-z']);
  const paths = listing.split('\u0000').filter((path) => path.length > 0);
  if (paths.length > MAX_SNAPSHOT_FILES) {
    throw new VerifySourceError(
      'source-too-large',
      `Checkout tracks ${paths.length} files; at most ${MAX_SNAPSHOT_FILES} are snapshotted`,
    );
  }
  return paths.filter((path) => !isVerificationPrivatePath(path) && !isSensitiveRepositoryPath(path));
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

/** Bounded read from one stable regular-file handle; symlinks and changes fail closed. */
export async function readBoundedRegularFile(path: string, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid file read limit');
  const absolute = resolve(path);
  const parent = await realpath(dirname(absolute));
  const before = await lstat(absolute);
  if (before.isSymbolicLink()) throw new VerifySourceError('input-not-a-file', 'Input must not be a symbolic link');
  if (!before.isFile()) throw new VerifySourceError('input-not-a-file', 'Input must be a regular file');
  if (before.size > maxBytes) {
    throw new VerifySourceError('input-too-large', `Input is ${before.size} bytes; at most ${maxBytes} are read`);
  }
  // NONBLOCK prevents a raced-in FIFO from blocking before fstat can refuse it.
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFile(before, opened)) {
      throw new VerifySourceError('input-changed', 'Input changed while it was being opened');
    }
    const bytes = Buffer.alloc(before.size + 1);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(absolute);
    if (total !== before.size || !sameFile(opened, after) || !sameFile(opened, current)
      || current.isSymbolicLink() || parent !== await realpath(dirname(absolute))) {
      throw new VerifySourceError('input-changed', 'Input changed while it was being read');
    }
    return bytes.subarray(0, total);
  } finally {
    await handle.close();
  }
}

/** Reads one tracked file without traversing a symlink outside the checkout. */
async function readTracked(caseDir: string, path: string): Promise<{ bytes: Buffer; sha256: string; executable: number }> {
  const root = await realpath(caseDir);
  const absolute = resolve(root, path);
  if (!absolute.startsWith(root + sep)) {
    throw new VerifySourceError('source-path-escape', `Tracked path escapes the checkout: ${path}`);
  }
  if (await realpath(dirname(absolute)) !== dirname(absolute)) {
    throw new VerifySourceError('source-path-escape', `Tracked path traverses a symbolic link: ${path}`);
  }
  const executable = (await lstat(absolute)).mode & 0o111;
  let bytes: Buffer;
  try {
    bytes = await readBoundedRegularFile(absolute, MAX_SNAPSHOT_FILE_BYTES);
  } catch (error) {
    if (error instanceof VerifySourceError) {
      const reason = error.reasonCode === 'input-too-large' ? 'source-file-too-large'
        : error.reasonCode === 'input-not-a-file' ? 'source-not-a-file' : 'source-changed-during-snapshot';
      throw new VerifySourceError(reason, error.message);
    }
    throw error;
  }
  return { bytes, executable, sha256: createHash('sha256').update(`${executable}\u0000`).update(bytes).digest('hex') };
}

/**
 * Copies the clean checkout into an immutable temporary directory and binds
 * its hash.
 *
 * The copy is what executes, so nothing that happens to the developer's
 * checkout afterwards can change the bytes this run verified. Controller and
 * evaluator storage, hidden tests and sensitive paths are excluded by the same
 * rules the sandbox snapshot uses, and `.git` never travels with the copy.
 *
 * Every file is read once for the copy and read again afterwards. A file that
 * changed while the copy was being made, or a checkout that moved or became
 * dirty, refuses the run: a snapshot taken across a moving source describes
 * neither state.
 */
export async function snapshotCleanSourceAt(
  caseDir: string,
  sourceSha: string,
): Promise<SourceSnapshot> {
  await assertCleanCheckoutAt(caseDir, sourceSha);
  const paths = (await trackedFiles(caseDir)).sort();
  return { ...(await snapshotSelectedSource(caseDir, paths, () => assertCleanCheckoutAt(caseDir, sourceSha))), sourceSha };
}

/** Freeze the exact controller-selected upload manifest, including non-Git local cases. */
export async function snapshotSelectedSource(
  caseDir: string,
  selectedPaths: readonly string[],
  validateSource: () => Promise<void>,
): Promise<Omit<SourceSnapshot, 'sourceSha'>> {
  const paths = [...new Set(selectedPaths)].sort();
  if (paths.length > MAX_SNAPSHOT_FILES || paths.some(path => isSensitiveRepositoryPath(path))) {
    throw new VerifySourceError('source-path-escape', 'Snapshot manifest exceeds limits or includes a private path');
  }
  const dir = await mkdtemp(join(tmpdir(), 'sutura-verify-source-'));
  let restored = false;
  const cleanup = async (): Promise<void> => {
    if (restored) return;
    restored = true;
    await chmod(dir, 0o755).catch(() => undefined);
    for (const path of paths) {
      for (let parent = dirname(join(dir, path)); parent.startsWith(dir + sep); parent = dirname(parent)) {
        await chmod(parent, 0o755).catch(() => undefined);
      }
      await chmod(join(dir, path), 0o644).catch(() => undefined);
    }
    await rm(dir, { recursive: true, force: true });
  };
  try {
    const before: Array<readonly [string, string]> = [];
    const executableModes = new Map<string, number>();
    for (const path of paths) {
      const { bytes, sha256, executable } = await readTracked(caseDir, path);
      executableModes.set(path, executable);
      const target = join(dir, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      before.push([path, sha256]);
    }

    await validateSource();
    const after: Array<readonly [string, string]> = [];
    for (const path of paths) after.push([path, (await readTracked(caseDir, path)).sha256]);
    if (digestOf(before) !== digestOf(after)) {
      throw new VerifySourceError(
        'source-changed-during-snapshot',
        'The checkout changed while it was being copied; the snapshot describes no single source state',
      );
    }

    const directories = new Set<string>();
    for (const path of paths) {
      await chmod(join(dir, path), 0o444 | executableModes.get(path)!);
      for (let parent = dirname(join(dir, path)); parent.startsWith(dir + sep); parent = dirname(parent)) {
        directories.add(parent);
      }
    }
    for (const directory of [...directories].sort().reverse()) await chmod(directory, 0o555);
    await chmod(dir, 0o555);

    return { dir, snapshotSha256: digestOf(before), files: paths, cleanup };
  } catch (error) {
    await chmod(dir, 0o755).catch(() => undefined);
    await cleanup();
    throw error;
  }
}
