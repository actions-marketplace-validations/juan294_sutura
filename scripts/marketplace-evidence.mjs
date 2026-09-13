#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { canonicalJson, contentHash, exactSha, publicGitHubUrl } from './evidence-contract.mjs';
import { exactReleaseVersion } from './install-test-lib.mjs';
import { validateStudyEvidence, verifyPublicSuturaRun } from './adoption-study.mjs';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'Sutura Verified Self-Healing CI';
const LISTING = 'https://github.com/marketplace/actions/sutura-verified-self-healing-ci';

async function execute(command, args, cwd = ROOT) {
  const { stdout } = await execFileAsync(command, args, {
    cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

function field(metadata, name) {
  const match = new RegExp(`^${name}:\\s*(.+)$`, 'mu').exec(metadata);
  const value = match?.[1]?.trim();
  if (!value) throw new Error(`Action metadata ${name} must be non-empty`);
  return value.replace(/^['"]|['"]$/gu, '');
}

function marketplaceMetadata(rootMetadata, packageMetadata) {
  if (rootMetadata !== packageMetadata.replace(
    'main: dist/index.cjs', 'main: packages/action/dist/index.cjs',
  )) throw new Error('Root and packaged Action metadata differ');
  const name = field(rootMetadata, 'name');
  const description = field(rootMetadata, 'description');
  const author = field(rootMetadata, 'author');
  if (name !== NAME) throw new Error(`Marketplace name must be ${NAME}`);
  if (description.length < 40 || description.length > 125) {
    throw new Error('Marketplace description must contain 40 to 125 characters');
  }
  if (author !== 'Sutura') throw new Error('Marketplace author must be Sutura');
  if (!/^runs:\n  using: node24\n  main: packages\/action\/dist\/index\.cjs$/mu.test(rootMetadata)) {
    throw new Error('Marketplace Action runtime must use the committed Node 24 bundle');
  }
  const icon = /^branding:\n  icon:\s*([^\r\n]+)$/mu.exec(rootMetadata)?.[1]?.trim();
  const color = /^branding:\n  icon:[^\r\n]+\n  color:\s*([^\r\n]+)$/mu.exec(rootMetadata)?.[1]?.trim();
  if (icon !== 'activity') throw new Error('Marketplace branding icon must be activity');
  if (color !== 'red') throw new Error('Marketplace branding color must be red');
  return { name, description, author, branding: { icon, color } };
}

const defaultPreflightDependencies = {
  readRootMetadata: () => readFile(resolve(ROOT, 'action.yml'), 'utf8'),
  readPackageMetadata: () => readFile(resolve(ROOT, 'packages/action/action.yml'), 'utf8'),
  repository: async () => JSON.parse(await execute(
    'gh', ['api', 'repos/juan294/sutura', '--jq', '{visibility,defaultBranch:.default_branch}'],
  )),
  head: () => execute('git', ['rev-parse', 'HEAD']),
  integrated: async () => {
    const output = await execute('git', [
      'ls-remote', 'https://github.com/juan294/sutura.git', 'refs/heads/develop',
    ]);
    const rows = output.split(/\r?\n/u).filter(Boolean).map((line) => line.split('\t'));
    if (rows.length !== 1 || rows[0]?.[1] !== 'refs/heads/develop') {
      throw new Error('Remote develop did not resolve uniquely');
    }
    return exactSha(rows[0][0], 'Remote develop');
  },
  status: () => execute('git', [
    'status', '--porcelain', '--', 'action.yml', 'packages/action/action.yml',
  ]),
};

export async function marketplacePreflight(request, dependencies = {}) {
  const candidate = exactSha(request.candidate, 'Marketplace candidate');
  const run = { ...defaultPreflightDependencies, ...dependencies };
  const [rootMetadata, packageMetadata, repository, head, integrated, status] = await Promise.all([
    run.readRootMetadata(), run.readPackageMetadata(), run.repository(), run.head(), run.integrated(), run.status(),
  ]);
  if (head !== candidate) throw new Error('Marketplace candidate differs from checkout HEAD');
  if (integrated !== candidate) throw new Error('Marketplace candidate is not the integrated origin/develop commit');
  if (status) throw new Error('Marketplace Action metadata differs from checkout candidate');
  if (repository?.visibility !== 'public') throw new Error('Marketplace repository must be public');
  if (repository?.defaultBranch !== 'develop') throw new Error('Marketplace repository default branch must be develop');
  const metadata = marketplaceMetadata(rootMetadata, packageMetadata);
  const base = {
    schemaVersion: 'sutura-marketplace-preflight-v1',
    candidate,
    repository: 'juan294/sutura',
    visibility: 'public',
    defaultBranch: 'develop',
    listing: LISTING,
    ...metadata,
    ready: true,
  };
  return { ...base, resultHash: contentHash(base) };
}

const defaultVerifyDependencies = {
  resolveRelease: async (release) => {
    const output = await execute('git', [
      'ls-remote', 'https://github.com/juan294/sutura.git',
      `refs/tags/${release}`, `refs/tags/${release}^{}`,
    ]);
    const rows = output.split(/\r?\n/u).filter(Boolean).map((line) => line.split('\t'));
    const direct = rows.filter(([, ref]) => ref === `refs/tags/${release}`).map(([sha]) => sha);
    const peeled = rows.filter(([, ref]) => ref === `refs/tags/${release}^{}`).map(([sha]) => sha);
    if (direct.length !== 1 || peeled.length > 1) throw new Error('Marketplace release tag did not resolve uniquely');
    return exactSha(peeled[0] ?? direct[0], 'Marketplace remote release');
  },
  fetchRelease: async (release) => {
    const response = await fetch(`https://api.github.com/repos/juan294/sutura/releases/tags/${release}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'sutura-marketplace-evidence' },
      signal: AbortSignal.timeout(30_000),
    });
    return { status: response.status, body: await response.json() };
  },
  fetchListing: async (listing) => {
    const response = await fetch(listing, {
      redirect: 'follow', headers: { 'user-agent': 'sutura-marketplace-evidence' },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > 2 * 1024 * 1024) {
      throw new Error('Marketplace listing response exceeds 2097152 bytes');
    }
    return { status: response.status, body };
  },
  now: () => new Date().toISOString(),
  verifyMarketplaceInstall: (evidence) => verifyPublicSuturaRun({
    repositoryUrl: evidence.repositoryUrl,
    runUrl: evidence.runUrl,
    actionCommit: evidence.candidate,
  }),
};

function validateMarketplaceInstallEvidence(input, request) {
  const keys = [
    'schemaVersion', 'listing', 'release', 'candidate', 'repositoryUrl', 'runUrl',
    'installedFromMarketplace', 'publicReviewConfirmed', 'resultHash',
  ];
  if (input === null || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).sort().join('\0') !== keys.sort().join('\0')) {
    throw new Error('Marketplace install evidence has invalid fields');
  }
  if (input.schemaVersion !== 'sutura-marketplace-install-evidence-v1' ||
      input.listing !== request.listing || input.release !== request.release ||
      input.candidate !== request.candidate || input.installedFromMarketplace !== true ||
      input.publicReviewConfirmed !== true) throw new Error('Marketplace installation is not confirmed for this release');
  const repository = new URL(publicGitHubUrl(input.repositoryUrl, 'Marketplace repositoryUrl'));
  const run = new URL(publicGitHubUrl(input.runUrl, 'Marketplace runUrl'));
  if (!/^\/[^/]+\/[^/]+\/?$/u.test(repository.pathname) ||
      !/^\/[^/]+\/[^/]+\/actions\/runs\/[1-9]\d*\/?$/u.test(run.pathname) ||
      !run.pathname.toLowerCase().startsWith(`${repository.pathname.replace(/\/$/u, '').toLowerCase()}/actions/runs/`)) {
    throw new Error('Marketplace install repository and run URLs do not match');
  }
  const { resultHash, ...base } = input;
  if (contentHash(base) !== resultHash) throw new Error('Marketplace install evidence hash is invalid');
  return input;
}

export async function verifyMarketplaceEvidence(request, dependencies = {}) {
  const candidate = exactSha(request.candidate, 'Marketplace candidate');
  if (!request.release?.startsWith('v')) throw new Error('Marketplace release must be exact semver tag');
  exactReleaseVersion(request.release.slice(1));
  if (request.listing !== LISTING) throw new Error(`Marketplace listing must be ${LISTING}`);
  const run = { ...defaultVerifyDependencies, ...dependencies };
  const [releaseCommit, releaseResponse, listingResponse, installBytes, marketplaceInstallBytes] = await Promise.all([
    run.resolveRelease(request.release),
    run.fetchRelease(request.release),
    run.fetchListing(request.listing),
    readFile(request.installEvidence),
    readFile(request.marketplaceInstallEvidence),
  ]);
  if (releaseCommit !== candidate) throw new Error('Marketplace release commit differs from candidate');
  if (releaseResponse.status !== 200 || releaseResponse.body?.tag_name !== request.release ||
      releaseResponse.body?.draft !== false) throw new Error('Marketplace GitHub release is not public or does not match');
  if (listingResponse.status !== 200 || !listingResponse.body.includes(NAME)) {
    throw new Error('Marketplace listing is not publicly available with the expected Action name');
  }
  if (installBytes.byteLength > 1024 * 1024) throw new Error('Marketplace install evidence exceeds 1048576 bytes');
  if (marketplaceInstallBytes.byteLength > 128 * 1024) throw new Error('Marketplace verification record exceeds 131072 bytes');
  let install;
  try {
    install = JSON.parse(installBytes.toString('utf8'));
  } catch (error) {
    throw new Error('Marketplace install evidence must be valid JSON', { cause: error });
  }
  try {
    validateStudyEvidence(install);
  } catch (error) {
    throw new Error('Marketplace adoption evidence is incomplete or invalid', { cause: error });
  }
  if (install.candidateCommit !== candidate) throw new Error('Marketplace adoption evidence has different identity');
  let marketplaceInstall;
  try {
    marketplaceInstall = validateMarketplaceInstallEvidence(
      JSON.parse(marketplaceInstallBytes.toString('utf8')), request,
    );
    await run.verifyMarketplaceInstall(marketplaceInstall);
  } catch (error) {
    throw new Error('Marketplace installation evidence is invalid', { cause: error });
  }
  const base = {
    schemaVersion: 'sutura-marketplace-evidence-v1',
    candidate,
    release: request.release,
    listing: request.listing,
    installEvidence: request.installEvidence,
    installEvidenceHash: createHash('sha256').update(installBytes).digest('hex'),
    marketplaceInstallEvidence: request.marketplaceInstallEvidence,
    marketplaceInstallEvidenceHash: createHash('sha256').update(marketplaceInstallBytes).digest('hex'),
    verifiedAt: run.now(),
    ready: true,
  };
  return { ...base, resultHash: contentHash(base) };
}

export async function recordMarketplaceInstall(request) {
  const candidate = exactSha(request.candidate, 'Marketplace candidate');
  if (!request.release?.startsWith('v')) throw new Error('Marketplace release must be exact semver tag');
  exactReleaseVersion(request.release.slice(1));
  if (request.authorization !== 'MARKETPLACE-INSTALL-CONFIRMED') {
    throw new Error('Marketplace installation confirmation is missing');
  }
  const base = {
    schemaVersion: 'sutura-marketplace-install-evidence-v1', listing: LISTING,
    release: request.release, candidate, repositoryUrl: request.repositoryUrl,
    runUrl: request.runUrl, installedFromMarketplace: true, publicReviewConfirmed: true,
  };
  return validateMarketplaceInstallEvidence({ ...base, resultHash: contentHash(base) }, {
    candidate, release: request.release, listing: LISTING,
  });
}

function values(args) {
  const result = new Map();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || !value || value.startsWith('--') || result.has(flag)) {
      throw new Error(`Invalid Marketplace argument: ${flag ?? '(missing)'}`);
    }
    result.set(flag, value);
  }
  return result;
}

export async function main(args = process.argv.slice(2)) {
  const operation = args[0];
  const options = values(args);
  if (operation === 'preflight' && options.size === 1 && options.has('--candidate')) {
    const result = await marketplacePreflight({ candidate: options.get('--candidate') });
    process.stdout.write(`${canonicalJson(result)}\n`);
    return result;
  }
  if (operation === 'record-install' && options.size === 6 && [
    '--candidate', '--release', '--repository', '--run', '--output', '--authorization',
  ].every((flag) => options.has(flag))) {
    const result = await recordMarketplaceInstall({
      candidate: options.get('--candidate'), release: options.get('--release'),
      repositoryUrl: options.get('--repository'), runUrl: options.get('--run'),
      authorization: options.get('--authorization'),
    });
    await writeFile(options.get('--output'), `${canonicalJson(result)}\n`, { encoding: 'utf8', flag: 'wx' });
    return result;
  }
  if (operation === 'verify' && options.size === 6 && [
    '--candidate', '--release', '--listing', '--install-evidence', '--marketplace-install-evidence', '--output',
  ].every((flag) => options.has(flag))) {
    const result = await verifyMarketplaceEvidence({
      candidate: options.get('--candidate'), release: options.get('--release'),
      listing: options.get('--listing'), installEvidence: options.get('--install-evidence'),
      marketplaceInstallEvidence: options.get('--marketplace-install-evidence'),
    });
    await writeFile(options.get('--output'), `${canonicalJson(result)}\n`, {
      encoding: 'utf8', flag: 'wx',
    });
    return result;
  }
  throw new Error('Usage: marketplace-evidence.mjs preflight|record-install|verify with exact documented options');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
