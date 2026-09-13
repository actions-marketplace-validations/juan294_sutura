import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { exactReleaseVersion, RELEASE_VERSION, verifyInstall } from './install-test-lib.mjs';

export function parseReleaseVersion(args) {
  if (args.length === 0) return RELEASE_VERSION;
  if (args.length !== 2 || args[0] !== '--release') {
    throw new Error('Usage: node scripts/test-public-install.mjs [--release <exact semver>]');
  }
  return exactReleaseVersion(args[1]);
}

export function parsePublicInstallOptions(args) {
  const options = { releaseVersion: RELEASE_VERSION, candidateEvidence: undefined };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith('--') || seen.has(flag)) throw new Error('Public install options require unique values');
    seen.add(flag);
    if (flag === '--release') {
      options.releaseVersion = exactReleaseVersion(value);
    } else if (flag === '--candidate-evidence') {
      options.candidateEvidence = value;
    } else {
      throw new Error('Usage: node scripts/test-public-install.mjs [--release <exact semver>] [--candidate-evidence <file>]');
    }
  }
  return options;
}

export async function runPublicInstall(releaseVersion = RELEASE_VERSION, dependencies, expectedPackageContentHash) {
  if (typeof releaseVersion !== 'string') {
    dependencies = releaseVersion;
    releaseVersion = RELEASE_VERSION;
  }
  exactReleaseVersion(releaseVersion);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { verify = verifyInstall, ...installDependencies } = dependencies ?? {};
  return verify({
    mode: 'public', root, releaseVersion, dependencies: installDependencies,
    ...(expectedPackageContentHash === undefined ? {} : { expectedPackageContentHash }),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parsePublicInstallOptions(process.argv.slice(2));
  let expectedPackageContentHash;
  if (options.candidateEvidence !== undefined) {
    const candidate = JSON.parse(await readFile(options.candidateEvidence, 'utf8'));
    if (!/^[a-f0-9]{64}$/u.test(candidate.packageContentHash ?? '')) {
      throw new Error('Candidate install evidence has no valid package content hash');
    }
    expectedPackageContentHash = candidate.packageContentHash;
  }
  const result = await runPublicInstall(options.releaseVersion, undefined, expectedPackageContentHash);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
