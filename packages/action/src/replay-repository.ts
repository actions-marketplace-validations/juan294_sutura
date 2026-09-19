import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import {
  MAX_POLICY_BYTES,
  isSensitiveRepositoryPath,
  loadRepositoryPolicy,
  recordedErrorResult,
  runtimeEvidencePaths,
  type ReplayRecorder,
  type RepositoryPort,
} from '@sutura/core';

const MAX_SNAPSHOT_FILE_BYTES = 1 * 1_024 * 1_024;
const MAX_SNAPSHOT_TOTAL_BYTES = 8 * MAX_SNAPSHOT_FILE_BYTES;
const SNAPSHOT_CONTENT_PATHS = new Set([
  '.sutura.json',
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pyproject.toml',
  'uv.lock',
  'requirements.txt',
  'requirements-dev.txt',
  'poetry.lock',
  'pytest.ini',
  'ruff.toml',
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

async function boundedSnapshotFile(
  root: string,
  path: string,
): Promise<string | null> {
  const requested = resolve(root, path);
  let metadata;
  try {
    metadata = await lstat(requested);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    throw new Error(`Replay snapshot path must not be a symlink: ${path}`);
  }
  const maximumBytes = path === '.sutura.json' ? MAX_POLICY_BYTES : MAX_SNAPSHOT_FILE_BYTES;
  if (!metadata.isFile() || metadata.size > maximumBytes) {
    throw new Error(`Replay snapshot file exceeds its byte bound: ${path}`);
  }
  const canonical = await realpath(requested);
  if (!inside(root, canonical)) {
    throw new Error(`Replay snapshot path escapes the checkout: ${path}`);
  }
  const handle = await open(canonical, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.size !== metadata.size || current.size > maximumBytes) {
      throw new Error(`Replay snapshot file changed during capture: ${path}`);
    }
    const bytes = Buffer.alloc(current.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== current.size || bytes.subarray(0, bytesRead).includes(0)) {
      throw new Error(`Replay snapshot file is not bounded UTF-8 text: ${path}`);
    }
    const captured = bytes.subarray(0, bytesRead);
    const content = captured.toString('utf8');
    if (!Buffer.from(content, 'utf8').equals(captured)) {
      throw new Error(`Replay snapshot file is not valid UTF-8 text: ${path}`);
    }
    return content;
  } finally {
    await handle.close();
  }
}

async function checkoutSnapshot(checkoutDir: string): Promise<{
  runtimeEvidencePaths: string[];
  files: Array<{ path: string; content: string }>;
}> {
  const root = await realpath(checkoutDir);
  const policyContent = await boundedSnapshotFile(root, '.sutura.json');
  const configuredRuntime = policyContent === null
    ? undefined
    : loadRepositoryPolicy(policyContent).policy.runtime;
  const files: Array<{ path: string; content: string }> = [];
  let totalBytes = 0;
  for (const path of SNAPSHOT_CONTENT_PATHS) {
    if (isSensitiveRepositoryPath(path)) continue;
    const content = path === '.sutura.json'
      ? policyContent
      : await boundedSnapshotFile(root, path);
    if (content === null) continue;
    totalBytes += Buffer.byteLength(content, 'utf8');
    if (totalBytes > MAX_SNAPSHOT_TOTAL_BYTES) {
      throw new Error('Replay checkout snapshot exceeds its total byte bound');
    }
    files.push({ path, content });
  }
  const rootEvidencePaths = files
    .map(({ path }) => path)
    .filter((path) => path !== '.sutura.json');
  const evidencePaths = configuredRuntime === undefined
    ? (rootEvidencePaths.length > 0 ? rootEvidencePaths : await runtimeEvidencePaths(root))
      .filter((path) => !isSensitiveRepositoryPath(path))
      .sort()
    : [];
  return { runtimeEvidencePaths: evidencePaths, files };
}

export function recordingRepositoryPort(
  port: RepositoryPort,
  recorder: ReplayRecorder,
): RepositoryPort {
  const record = async <T>(
    method: keyof RepositoryPort,
    args: unknown[],
    operation: () => Promise<T>,
    captureResult: (result: T) => Promise<unknown> = async (result) => result,
    captureFailure: (result: T, error: unknown) => unknown = (result, error) => ({
      result,
      captureError: errorMessage(error),
    }),
  ): Promise<T> => {
    const sequence = recorder.reservePortSequence('repository');
    try {
      const result = await operation();
      let recordedResult: unknown = result;
      try {
        recordedResult = await captureResult(result);
      } catch (error) {
        recorder.markOverflow('repository');
        recordedResult = captureFailure(result, error);
      }
      recorder.recordRepository({ method, args, result: recordedResult }, sequence);
      return result;
    } catch (error) {
      recorder.recordRepository({
        method,
        args,
        result: recordedErrorResult(error),
      }, sequence);
      throw error;
    }
  };

  return {
    readPolicyAtSha(repo, sha) {
      return record('readPolicyAtSha', [repo, sha], () =>
        port.readPolicyAtSha(repo, sha),
      );
    },
    checkoutHead(repo, sha, headRef, prNumber) {
      return record('checkoutHead', [repo, sha, headRef, prNumber], () =>
        port.checkoutHead(repo, sha, headRef, prNumber),
      async (checkoutDir) => ({
        checkoutId: recorder.registerCheckoutPath(checkoutDir),
        snapshot: await checkoutSnapshot(checkoutDir),
      }),
      (checkoutDir, error) => ({
        checkoutId: recorder.registerCheckoutPath(checkoutDir),
        snapshot: { runtimeEvidencePaths: [], files: [] },
        captureError: errorMessage(error),
      }),
      );
    },
    readSourceExcerpts(checkoutDir, references, limits) {
      return record('readSourceExcerpts', [checkoutDir, references, limits], () =>
        port.readSourceExcerpts(checkoutDir, references, limits),
      );
    },
    publishFix(input) {
      return record('publishFix', [input], () => port.publishFix(input));
    },
  };
}
