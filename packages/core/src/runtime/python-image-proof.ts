import { shellQuote } from '../engine/shell.js';
import type { Executor, RunResult } from '../executor/types.js';

import {
  PYTHON_IMAGE_INDEX_DIGEST,
  PYTHON_IMAGE_LINUX_AMD64_DIGEST,
  PYTHON_IMAGE_REF,
  PYTHON_REQUIRED_TOOLS,
} from './python.js';

export const PYTHON_IMAGE_PROOF_SCHEMA_VERSION = 'sutura-python-image-proof-v2';

export class PythonImageProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PythonImageProofError';
  }
}

export interface ExactImageReference {
  repository: string;
  digest: `sha256:${string}`;
}

export interface PythonImageProof {
  schemaVersion: typeof PYTHON_IMAGE_PROOF_SCHEMA_VERSION;
  imageRef: string;
  expectedIndexDigest: string;
  expectedLinuxAmd64Digest: string;
  importedImageId: string;
  requiredTools: readonly string[];
  operationId: string;
}

export function parseExactImageReference(reference: string): ExactImageReference {
  const match = /^([^@\s]+)@(sha256:[a-f0-9]{64})$/u.exec(reference);
  if (!match) {
    throw new PythonImageProofError('Python runtime image must use one exact SHA-256 digest');
  }
  const repository = match[1] ?? '';
  const finalSegment = repository.slice(repository.lastIndexOf('/') + 1);
  if (!repository.includes('/') || finalSegment.includes(':')) {
    throw new PythonImageProofError('Python runtime image must not contain a mutable tag');
  }
  return {
    repository,
    digest: match[2] as `sha256:${string}`,
  };
}

export function pythonImageProofCommand(): string {
  const commands = [
    'set -eu',
    `test "$(python --version 2>&1)" = ${shellQuote(PYTHON_REQUIRED_TOOLS[0] ?? '')}`,
    `test "$(uv --version)" = ${shellQuote(PYTHON_REQUIRED_TOOLS[1] ?? '')}`,
    `test "$(git --version)" = ${shellQuote(PYTHON_REQUIRED_TOOLS[2] ?? '')}`,
    `test "$(tar --version | head -1)" = ${shellQuote(PYTHON_REQUIRED_TOOLS[3] ?? '')}`,
    'sutura_tmp="$(mktemp -d)"',
    'trap \'rm -rf "$sutura_tmp"\' EXIT',
    'cd "$sutura_tmp"',
    `printf ${shellQuote('[project]\nname = "sutura-runtime-proof"\nversion = "0.0.0"\nrequires-python = ">=3.13"\n')} > pyproject.toml`,
    `printf ${shellQuote('version = 1\nrevision = 3\nrequires-python = ">=3.13"\n\n[[package]]\nname = "sutura-runtime-proof"\nversion = "0.0.0"\nsource = { virtual = "." }\n')} > uv.lock`,
    'uv sync --frozen --offline --no-install-project --no-build',
    'git init --quiet',
    `printf ${shellQuote('print("sutura-python-runtime-ok")\n')} > proof.py`,
    'python proof.py',
    'tar -cf proof.tar proof.py',
    'tar -tf proof.tar >/dev/null',
    `printf ${shellQuote(`${PYTHON_IMAGE_PROOF_SCHEMA_VERSION}\n`)}`,
  ];
  return `sh -lc ${shellQuote(commands.join('\n'))}`;
}

function assertSuccessfulProof(result: RunResult): void {
  if (result.exitCode !== 0 || result.truncated) {
    throw new PythonImageProofError(
      `Python runtime image proof failed with exit code ${result.exitCode}: ${result.stderr.slice(0, 1_000)}`,
    );
  }
  const lines = result.stdout.trim().split(/\r?\n/u);
  if (!lines.includes('sutura-python-runtime-ok') || lines.at(-1) !== PYTHON_IMAGE_PROOF_SCHEMA_VERSION) {
    throw new PythonImageProofError('Python runtime image proof returned an invalid terminal marker');
  }
}

export async function provePythonRuntimeImage(
  executor: Executor,
  imageRef = PYTHON_IMAGE_REF,
): Promise<PythonImageProof> {
  if (imageRef !== PYTHON_IMAGE_REF) {
    throw new PythonImageProofError('Python runtime image must use the verified ConTree versioned tag');
  }
  const importedImageId = await executor.importImage(imageRef);
  const operationId = 'sutura-python-runtime-image-proof';
  const result = await executor.run(importedImageId, pythonImageProofCommand(), {
    network: 'disabled', timeoutSec: 120, operationId,
  });
  assertSuccessfulProof(result);
  return {
    schemaVersion: PYTHON_IMAGE_PROOF_SCHEMA_VERSION,
    imageRef,
    expectedIndexDigest: PYTHON_IMAGE_INDEX_DIGEST,
    expectedLinuxAmd64Digest: PYTHON_IMAGE_LINUX_AMD64_DIGEST,
    importedImageId,
    requiredTools: [...PYTHON_REQUIRED_TOOLS],
    operationId,
  };
}
