import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ContreeExecutor,
  PYTHON_IMAGE_INDEX_DIGEST,
  PYTHON_IMAGE_LINUX_AMD64_DIGEST,
  PYTHON_IMAGE_REF,
  provePythonRuntimeImage,
} from '../packages/core/dist/index.js';

export const RUNTIME_IMAGE_CANARY_SCHEMA_VERSION = 'sutura-runtime-image-canary-v2';

export function parseRegistryResolution(value) {
  if (value?.digest !== PYTHON_IMAGE_INDEX_DIGEST || !Array.isArray(value.manifests)) {
    throw new Error('Python runtime image index digest differs from the verified digest');
  }
  const linuxAmd64 = value.manifests.filter((manifest) =>
    manifest?.platform?.os === 'linux' && manifest?.platform?.architecture === 'amd64');
  if (linuxAmd64.length !== 1 || linuxAmd64[0]?.digest !== PYTHON_IMAGE_LINUX_AMD64_DIGEST) {
    throw new Error('Python runtime Linux AMD64 manifest differs from the verified digest');
  }
  return {
    imageRef: PYTHON_IMAGE_REF,
    indexDigest: value.digest,
    linuxAmd64Digest: linuxAmd64[0].digest,
  };
}

function resolveRegistryDefault(reference) {
  const output = execFileSync('docker', [
    'buildx', 'imagetools', 'inspect', reference, '--format', '{{json .Manifest}}',
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  return parseRegistryResolution(JSON.parse(output));
}

function gitDefault(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

export async function runRuntimeImageCanary(options = {}) {
  const token = (options.token ?? process.env.CONTREE_TOKEN)?.trim();
  const project = (options.project ?? process.env.CONTREE_PROJECT)?.trim();
  if (!token) throw new Error('CONTREE_TOKEN is required');
  if (!project) throw new Error('CONTREE_PROJECT is required');
  const git = options.git ?? gitDefault;
  if (git(['status', '--porcelain']).trim()) {
    throw new Error('Runtime image canary requires a clean tree');
  }
  const headSha = git(['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/u.test(headSha)) throw new Error('Runtime image canary requires an exact HEAD SHA');
  const registryResolution = await (options.resolveImage ?? resolveRegistryDefault)(PYTHON_IMAGE_REF);
  if (registryResolution?.imageRef !== PYTHON_IMAGE_REF ||
      registryResolution?.indexDigest !== PYTHON_IMAGE_INDEX_DIGEST ||
      registryResolution?.linuxAmd64Digest !== PYTHON_IMAGE_LINUX_AMD64_DIGEST) {
    throw new Error('Python runtime registry resolution is invalid');
  }
  const executor = options.executor ?? new ContreeExecutor({
    token,
    project,
    maxOps: 1,
    operationTimeoutMs: 10 * 60 * 1_000,
  });
  const proof = await (options.prove ?? provePythonRuntimeImage)(executor, PYTHON_IMAGE_REF);
  const artifact = {
    schemaVersion: RUNTIME_IMAGE_CANARY_SCHEMA_VERSION,
    headSha,
    capturedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
    registryResolution,
    proof,
  };
  const outputPath = resolve(options.outputDirectory ?? '.', `runtime-image-canary-${headSha}.json`);
  await (options.writeFile ?? writeFile)(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: 'utf8', flag: 'wx',
  });
  return { artifact, outputPath, proof };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { proof } = await runRuntimeImageCanary({
    outputDirectory: process.env.SUTURA_CANARY_OUTPUT_DIRECTORY,
  });
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
}
