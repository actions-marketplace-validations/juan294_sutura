import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SUPER_REPAIR_PROVIDER_CONTRACT_VERSION,
  runSuperRepairProviderContractCanary,
} from '../packages/core/dist/index.js';

function gitDefault(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

export async function runProviderContractCanary(options = {}) {
  const apiKey = (options.apiKey ?? process.env.NEBIUS_API_KEY)?.trim();
  if (!apiKey) throw new Error('NEBIUS_API_KEY is required');
  const git = options.git ?? gitDefault;
  if (git(['status', '--porcelain']).trim()) {
    throw new Error('Provider contract canary requires a clean tree');
  }
  const headSha = git(['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/u.test(headSha)) throw new Error('Provider contract canary requires an exact HEAD SHA');
  const run = options.run ?? runSuperRepairProviderContractCanary;
  const result = await run({ apiKey });
  const artifact = {
    schemaVersion: 'sutura-provider-contract-canary-v1',
    contractVersion: SUPER_REPAIR_PROVIDER_CONTRACT_VERSION,
    headSha,
    capturedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
    result,
  };
  const outputPath = resolve(options.outputDirectory ?? '.', `provider-contract-canary-${headSha}.json`);
  await (options.writeFile ?? writeFile)(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: 'utf8', flag: 'wx',
  });
  return { result, artifact, outputPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { result } = await runProviderContractCanary({
    outputDirectory: process.env.SUTURA_CANARY_OUTPUT_DIRECTORY,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
