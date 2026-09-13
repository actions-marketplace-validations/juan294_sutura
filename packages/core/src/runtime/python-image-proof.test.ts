import { describe, expect, it } from 'vitest';

import { InMemoryExecutor } from '../executor/memory.js';
import {
  PYTHON_IMAGE_INDEX_DIGEST,
  PYTHON_IMAGE_LINUX_AMD64_DIGEST,
  PYTHON_IMAGE_REF,
} from './python.js';
import {
  PYTHON_IMAGE_PROOF_SCHEMA_VERSION,
  PythonImageProofError,
  parseExactImageReference,
  provePythonRuntimeImage,
} from './python-image-proof.js';

function successfulExecutor(): InMemoryExecutor {
  return new InMemoryExecutor(() => ({
    exitCode: 0,
    stdout: `sutura-python-runtime-ok\n${PYTHON_IMAGE_PROOF_SCHEMA_VERSION}\n`,
    stderr: '',
    truncated: false,
    metrics: {},
  }));
}

describe('Python image proof', () => {
  it('parses exact untagged SHA-256 image references independently', () => {
    expect(parseExactImageReference(`astral/uv@${PYTHON_IMAGE_LINUX_AMD64_DIGEST}`)).toEqual({
      repository: 'astral/uv',
      digest: PYTHON_IMAGE_LINUX_AMD64_DIGEST,
    });
    expect(() => parseExactImageReference('ghcr.io/astral-sh/uv:0.9.30-python3.13-bookworm')).toThrow(PythonImageProofError);
    expect(() => parseExactImageReference('ghcr.io/astral-sh/uv:stable@sha256:35b0aa516fbcf6f18624919cfc38fa02ab3458e0ffcd3c03e932051b37f315db')).toThrow(/mutable tag/u);
    expect(() => parseExactImageReference('ghcr.io/astral-sh/uv@sha256:abc')).toThrow(/exact SHA-256/u);
  });

  it('imports the exact image and proves tools and preparation without network', async () => {
    const executor = successfulExecutor();
    await expect(provePythonRuntimeImage(executor)).resolves.toMatchObject({
      schemaVersion: PYTHON_IMAGE_PROOF_SCHEMA_VERSION,
      imageRef: PYTHON_IMAGE_REF,
      expectedIndexDigest: PYTHON_IMAGE_INDEX_DIGEST,
      expectedLinuxAmd64Digest: PYTHON_IMAGE_LINUX_AMD64_DIGEST,
      importedImageId: 'mem-1',
      operationId: 'sutura-python-runtime-image-proof',
    });
    expect(executor.calls[0]).toEqual({ kind: 'importImage', ref: PYTHON_IMAGE_REF, imageId: 'mem-1' });
    expect(executor.calls[1]).toMatchObject({
      kind: 'run',
      parent: 'mem-1',
      opts: {
        network: 'disabled', timeoutSec: 120,
        operationId: 'sutura-python-runtime-image-proof',
      },
    });
  });

  it('rejects any unverified ConTree tag', async () => {
    await expect(provePythonRuntimeImage(
      successfulExecutor(),
      'astral/uv:latest',
    )).rejects.toThrow(/verified ConTree versioned tag/u);
  });

  it('reproduces the captured unavailable-index failure without accepting a proof', async () => {
    const deletedIndex = PYTHON_IMAGE_REF;
    const executor = successfulExecutor();
    executor.importImage = async () => {
      throw new Error('ConTree image import failed: HTTP 404');
    };
    await expect(provePythonRuntimeImage(executor, deletedIndex)).rejects.toThrow(/HTTP 404/u);
    expect(executor.calls).toEqual([]);
  });

  it.each([
    ['missing tools', { exitCode: 69, stdout: '', stderr: 'git: not found', truncated: false, metrics: {} }],
    ['runtime mismatch', { exitCode: 1, stdout: '', stderr: 'Python version mismatch', truncated: false, metrics: {} }],
    ['truncated evidence', { exitCode: 0, stdout: `${PYTHON_IMAGE_PROOF_SCHEMA_VERSION}\n`, stderr: '', truncated: true, metrics: {} }],
  ])('rejects %s', async (_label, result) => {
    const executor = new InMemoryExecutor(() => result);
    await expect(provePythonRuntimeImage(executor)).rejects.toBeInstanceOf(PythonImageProofError);
  });
});
