/**
 * Materializes the 37 root defects that complete the 100-case evaluation
 * inventory.
 *
 * Every generated case carries `evaluationRevision`, so the frozen v0.2
 * default selection and its committed `corpusHash` are unchanged; only a run
 * that opts into versioned cases sees them. Patches are produced with
 * `git diff --no-index`, so the committed bytes are the bytes Git itself
 * writes rather than a hand-assembled approximation.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { CASES, nodePackage, pyproject, TSCONFIG, uvLock } from './inventory-cases.mjs';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(here, '..', 'corpus');
const NODE_LOCK = join(CORPUS, 'repair-await-helper-preservation', 'fixture', 'pnpm-lock.yaml');

export const EVALUATION_REVISION = 'inventory-v1';

/** Splits are assigned round-robin over the sorted ids so the mix is stable and even. */
export function splitFor(index) {
  return index % 5 === 3 ? 'validation' : index % 5 === 4 ? 'held-out' : 'development';
}

function fingerprint(id) {
  return createHash('sha256').update(`placebo-inventory-${id}`).digest('hex');
}

async function writeTree(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

/** Base fixture files every case of a language carries. */
async function baseFiles(entry) {
  if (entry.language === 'python') {
    return { 'pyproject.toml': pyproject(entry.id), 'uv.lock': uvLock(entry.id) };
  }
  const lock = await readFile(NODE_LOCK, 'utf8');
  const files = { 'package.json': nodePackage(entry.id, entry.language === 'typescript'), 'pnpm-lock.yaml': lock };
  if (entry.language === 'typescript') {
    files['tsconfig.json'] = entry.tsconfigOverrides === undefined
      ? TSCONFIG
      : `${JSON.stringify({
        compilerOptions: {
          module: 'NodeNext', moduleResolution: 'NodeNext', noEmit: true, strict: true,
          types: ['vitest/globals'], ...entry.tsconfigOverrides,
        },
        include: ['*.ts'],
      }, null, 2)}\n`;
  }
  return files;
}

/**
 * A unified diff from one tree to another, produced by Git.
 *
 * Only the files that differ appear, so a patch names exactly what the defect
 * or the repair touches.
 */
async function diffTrees(before, after) {
  const root = await mkdtemp(join(tmpdir(), 'placebo-inventory-diff-'));
  try {
    const left = join(root, 'left');
    const right = join(root, 'right');
    await writeTree(left, before);
    await writeTree(right, after);
    try {
      await exec('git', ['diff', '--no-index', '--src-prefix=a/', '--dst-prefix=b/', left, right], {
        maxBuffer: 4 * 1024 * 1024,
      });
      throw new Error('trees are identical; a patch would be empty');
    } catch (error) {
      if (typeof error.stdout !== 'string' || error.stdout.length === 0) throw error;
      return error.stdout
        .replaceAll(`a${left}/`, 'a/')
        .replaceAll(`b${right}/`, 'b/')
        .replaceAll(`${left}/`, '')
        .replaceAll(`${right}/`, '');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function metadataFor(entry, split) {
  return {
    version: '0.2',
    kind: entry.kind,
    class: entry.class,
    expected: entry.expected,
    description: entry.description,
    riskClass: entry.riskClass,
    language: entry.language,
    failureFingerprint: fingerprint(entry.id),
    expectedChecks: entry.language === 'python'
      ? ['python -m unittest']
      : entry.language === 'typescript' ? ['pnpm test', 'tsc --noEmit'] : ['pnpm test'],
    source: `Public synthetic Placebo inventory fixture ${entry.id}.`,
    ...(entry.kind === 'trap' ? { placebo: 'fake-fix.diff' } : {}),
    ...(entry.kind === 'flaky'
      ? { triageExitCodes: entry.triageExitCodes, flakePattern: entry.flakePattern }
      : {}),
    ...(entry.kind === 'upstream'
      ? { releaseFact: entry.releaseFact, expectedWithoutTavily: entry.expectedWithoutTavily }
      : {}),
    ...(entry.hidden === undefined ? {} : { hiddenVerification: true }),
    evaluationRevision: EVALUATION_REVISION,
    lineage: { rootCaseId: entry.id, family: entry.family },
    split,
  };
}

export async function generateInventoryCases(corpusDirectory = CORPUS) {
  const ordered = [...CASES].sort((left, right) => left.id.localeCompare(right.id));
  const written = [];
  for (const [index, entry] of ordered.entries()) {
    const directory = join(corpusDirectory, entry.id);
    await rm(directory, { recursive: true, force: true });
    const base = await baseFiles(entry);
    const clean = { ...base, ...entry.clean };
    const broken = { ...clean, ...entry.broken };
    await writeTree(join(directory, 'fixture'), clean);
    await writeFile(join(directory, 'break.diff'), await diffTrees(clean, broken));
    if (entry.kind !== 'flaky') {
      const repaired = entry.repairFiles === undefined ? clean : { ...broken, ...entry.repairFiles };
      await writeFile(join(directory, 'repair.diff'), await diffTrees(broken, repaired));
    }
    if (entry.fake !== undefined) {
      await writeFile(join(directory, 'fake-fix.diff'), await diffTrees(broken, { ...broken, ...entry.fake }));
    }
    if (entry.hidden !== undefined) await writeTree(join(directory, 'hidden'), entry.hidden);
    await writeFile(
      join(directory, 'metadata.json'),
      `${JSON.stringify(metadataFor(entry, splitFor(index)), null, 2)}\n`,
    );
    written.push(entry.id);
  }
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const written = await generateInventoryCases();
  process.stdout.write(`${written.length} inventory cases written\n`);
}
