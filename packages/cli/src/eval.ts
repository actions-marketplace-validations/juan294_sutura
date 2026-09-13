import { createHash, randomUUID } from 'node:crypto';
import {
  access, link, readFile, rename, stat, unlink, writeFile,
} from 'node:fs/promises';

import {
  canonicalJson,
  exportAtif,
  exportJsonl,
  validateEvaluationManifest,
  type EvaluationManifest,
} from '@sutura/evaluation';

import { trimEdges } from '@sutura/core';

import type { EvalExportArguments, EvalValidateArguments } from './args.js';

export const MAX_EVALUATION_MANIFEST_BYTES = 5 * 1024 * 1024;

export interface EvaluationFileSystem {
  access: typeof access;
  link: typeof link;
  readFile: typeof readFile;
  rename: typeof rename;
  stat: typeof stat;
  unlink: typeof unlink;
  writeFile: typeof writeFile;
}

const DEFAULT_FILE_SYSTEM: EvaluationFileSystem = {
  access, link, readFile, rename, stat, unlink, writeFile,
};

async function readManifest(path: string, fileSystem: EvaluationFileSystem): Promise<EvaluationManifest> {
  const details = await fileSystem.stat(path);
  if (!details.isFile()) throw new Error('Evaluation manifest must be a regular file');
  if (details.size > MAX_EVALUATION_MANIFEST_BYTES) {
    throw new Error(`Evaluation manifest exceeds ${MAX_EVALUATION_MANIFEST_BYTES} bytes`);
  }
  const bytes = await fileSystem.readFile(path);
  if (bytes.byteLength > MAX_EVALUATION_MANIFEST_BYTES) {
    throw new Error(`Evaluation manifest exceeds ${MAX_EVALUATION_MANIFEST_BYTES} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error('Evaluation manifest must be valid JSON', { cause: error });
  }
  return validateEvaluationManifest(parsed);
}

function safeCaseName(caseId: string): string {
  const slug = caseId.toLowerCase().replace(/[^a-z0-9._-]+/gu, '-');
  const stem = trimEdges(slug, '-').slice(0, 40) || 'case';
  const digest = createHash('sha256').update(caseId).digest('hex').slice(0, 8);
  return `${stem}-${digest}`;
}

export function atifOutputPaths(output: string, caseIds: readonly string[]): string[] {
  if (caseIds.length === 1) return [output];
  const suffix = '.atif.json';
  const stem = output.endsWith(suffix) ? output.slice(0, -suffix.length) : output;
  return caseIds.map((caseId, index) =>
    `${stem}.${String(index + 1).padStart(3, '0')}-${safeCaseName(caseId)}${suffix}`,
  );
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function ensureOutputsAvailable(
  paths: readonly string[],
  fileSystem: EvaluationFileSystem,
): Promise<void> {
  for (const path of paths) {
    try {
      await fileSystem.access(path);
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    throw new Error(`Output already exists: ${path}`);
  }
}

async function cleanPaths(paths: readonly string[], fileSystem: EvaluationFileSystem): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const path of paths) {
    try {
      await fileSystem.unlink(path);
    } catch (error) {
      if (!isMissing(error)) failures.push(error);
    }
  }
  return failures;
}

async function writeOutputs(
  paths: readonly string[],
  outputs: readonly string[],
  force: boolean,
  fileSystem: EvaluationFileSystem,
): Promise<void> {
  if (!force) await ensureOutputsAvailable(paths, fileSystem);
  const taskId = randomUUID();
  const temporaryPaths = paths.map((path, index) => `${path}.sutura-eval-${taskId}-${index}.tmp`);
  const published: string[] = [];
  try {
    for (let index = 0; index < temporaryPaths.length; index += 1) {
      await fileSystem.writeFile(temporaryPaths[index]!, outputs[index]!, {
        encoding: 'utf8', flag: 'wx',
      });
    }
    for (let index = 0; index < paths.length; index += 1) {
      if (force) {
        await fileSystem.rename(temporaryPaths[index]!, paths[index]!);
      } else {
        await fileSystem.link(temporaryPaths[index]!, paths[index]!);
        published.push(paths[index]!);
      }
    }
  } catch (error) {
    const rollbackFailures = await cleanPaths(published, fileSystem);
    const cleanupFailures = await cleanPaths(temporaryPaths, fileSystem);
    const failures = [...rollbackFailures, ...cleanupFailures];
    if (failures.length > 0) {
      throw new AggregateError([error, ...failures], 'Evaluation export failed and rollback was incomplete');
    }
    throw error;
  }
  const cleanupFailures = await cleanPaths(temporaryPaths, fileSystem);
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, 'Evaluation export succeeded but temporary cleanup failed');
  }
}

export async function runEvaluationCommand(
  request: EvalValidateArguments | EvalExportArguments,
  dependencies: Partial<EvaluationFileSystem> = {},
): Promise<string[]> {
  const fileSystem = { ...DEFAULT_FILE_SYSTEM, ...dependencies };
  const manifest = await readManifest(request.manifest, fileSystem);
  if (request.command === 'eval-validate') {
    return [`Valid evaluation manifest: ${manifest.evaluationId}`];
  }
  if (request.format === 'jsonl') {
    const output = exportJsonl(manifest);
    await writeOutputs([request.output], [output], request.force, fileSystem);
    return [`Exported ${manifest.cases.length} evaluation cases to ${request.output}`];
  }
  const exports = exportAtif(manifest);
  const paths = atifOutputPaths(request.output, exports.map(({ caseId }) => caseId));
  const outputs = exports.map(({ trajectory }) => `${canonicalJson(trajectory)}\n`);
  await writeOutputs(paths, outputs, request.force, fileSystem);
  return paths.map((path) => `Exported ATIF trajectory to ${path}`);
}
