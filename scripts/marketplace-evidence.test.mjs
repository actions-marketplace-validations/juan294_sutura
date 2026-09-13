import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { contentHash } from './evidence-contract.mjs';
import {
  marketplacePreflight,
  recordMarketplaceInstall,
  verifyMarketplaceEvidence,
} from './marketplace-evidence.mjs';

const SHA = 'a'.repeat(40);
const METADATA = `name: Sutura Verified Self-Healing CI
description: Verify failed CI, filter flaky failures, reject unsafe shortcuts, and open an evidence-backed repair PR.
author: Sutura
runs:
  using: node24
  main: packages/action/dist/index.cjs
branding:
  icon: activity
  color: red
`;

function participant(index, language, classification) {
  const repository = `https://github.com/example/repo-${index}`;
  return {
    schemaVersion: 'sutura-adoption-participant-v1', participantId: `participant-a1b2c3d${index}`,
    participantBuiltSutura: false, participationConsent: true,
    repository: { url: repository, familiarToParticipant: true, familiarToSuturaBuilders: false, language },
    artifact: { packageVersion: '0.2.1', actionCommit: SHA, installSource: 'public-npm-and-immutable-action' },
    measurements: {
      sessionStartedAt: `2026-09-0${index}T10:00:00.000Z`, timeToFirstValidResultMs: index * 1000,
      setupFailures: [], unclearInstructions: [], manualInterventions: [],
    },
    result: {
      classification,
      targetRunUrl: `${repository}/actions/runs/${index}`,
      suturaRunUrl: `${repository}/actions/runs/${index + 10}`,
      checkRunUrl: `${repository}/runs/${index + 20}`,
      valid: true,
    },
    releaseBlockingDefects: [], publicReviewConfirmed: true,
    feedbackPermission: false, feedbackQuote: null, feedbackDisplayName: null,
  };
}

function adoptionEvidence() {
  const records = [participant(1, 'javascript', 'repair'), participant(2, 'python', 'refusal'), participant(3, 'typescript', 'flake')];
  const base = {
    schemaVersion: 'sutura-external-adoption-evidence-v1', candidateCommit: SHA,
    packageVersion: '0.2.1', ready: true, participantCount: 3, repositoryCount: 3,
    languages: ['javascript', 'python', 'typescript'], classifications: { flake: 1, refusal: 1, repair: 1 },
    measurements: {
      timeToFirstValidResultMs: [1000, 2000, 3000], setupFailureCount: 0,
      unclearInstructionCount: 0, manualInterventionCount: 0,
    },
    records,
  };
  return { ...base, resultHash: contentHash(base) };
}

function marketplaceInstallEvidence() {
  const base = {
    schemaVersion: 'sutura-marketplace-install-evidence-v1',
    listing: 'https://github.com/marketplace/actions/sutura-verified-self-healing-ci',
    release: 'v0.2.1', candidate: SHA,
    repositoryUrl: 'https://github.com/example/marketplace-install',
    runUrl: 'https://github.com/example/marketplace-install/actions/runs/42',
    installedFromMarketplace: true, publicReviewConfirmed: true,
  };
  return { ...base, resultHash: contentHash(base) };
}

const PUBLIC_RELEASE = async () => ({ status: 200, body: { tag_name: 'v0.2.1', draft: false } });

test('Marketplace install record requires the literal human confirmation', async () => {
  const request = {
    candidate: SHA, release: 'v0.2.1',
    repositoryUrl: 'https://github.com/example/marketplace-install',
    runUrl: 'https://github.com/example/marketplace-install/actions/runs/42',
  };
  await assert.rejects(() => recordMarketplaceInstall(request), /confirmation/u);
  const evidence = await recordMarketplaceInstall({ ...request, authorization: 'MARKETPLACE-INSTALL-CONFIRMED' });
  assert.equal(evidence.installedFromMarketplace, true);
  assert.match(evidence.resultHash, /^[a-f0-9]{64}$/u);
});

test('Marketplace preflight validates exact candidate, public repository, and metadata', async () => {
  const result = await marketplacePreflight({ candidate: SHA }, {
    readRootMetadata: async () => METADATA,
    readPackageMetadata: async () => METADATA.replace(
      'main: packages/action/dist/index.cjs', 'main: dist/index.cjs',
    ),
    repository: async () => ({ visibility: 'public', defaultBranch: 'develop' }),
    head: async () => SHA,
    integrated: async () => SHA,
    status: async () => '',
  });

  assert.equal(result.ready, true);
  assert.equal(result.candidate, SHA);
  assert.equal(result.name, 'Sutura Verified Self-Healing CI');
  assert.equal(result.branding.icon, 'activity');
  assert.match(result.resultHash, /^[a-f0-9]{64}$/u);
});

test('Marketplace preflight rejects mutable identity and invalid Marketplace metadata', async () => {
  const dependencies = {
    readRootMetadata: async () => METADATA,
    readPackageMetadata: async () => METADATA.replace(
      'main: packages/action/dist/index.cjs', 'main: dist/index.cjs',
    ),
    repository: async () => ({ visibility: 'public', defaultBranch: 'develop' }),
    head: async () => SHA,
    integrated: async () => SHA,
    status: async () => '',
  };
  await assert.rejects(() => marketplacePreflight({ candidate: 'develop' }, dependencies), /exact/u);
  await assert.rejects(() => marketplacePreflight({ candidate: SHA }, {
    ...dependencies,
    readRootMetadata: async () => METADATA.replace('icon: activity', 'icon: coffee'),
    readPackageMetadata: async () => METADATA
      .replace('main: packages/action/dist/index.cjs', 'main: dist/index.cjs')
      .replace('icon: activity', 'icon: coffee'),
  }), /branding icon/u);
  await assert.rejects(() => marketplacePreflight({ candidate: SHA }, {
    ...dependencies,
    repository: async () => ({ visibility: 'private', defaultBranch: 'develop' }),
  }), /public/u);
});

test('post-publication evidence binds listing, release commit, and adoption evidence', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'sutura-marketplace-'));
  try {
    const installEvidence = join(temporary, 'adoption.json');
    const marketplaceInstall = join(temporary, 'marketplace-install.json');
    await writeFile(installEvidence, JSON.stringify(adoptionEvidence()));
    await writeFile(marketplaceInstall, JSON.stringify(marketplaceInstallEvidence()));
    const result = await verifyMarketplaceEvidence({
      candidate: SHA,
      release: 'v0.2.1',
      listing: 'https://github.com/marketplace/actions/sutura-verified-self-healing-ci',
      installEvidence,
      marketplaceInstallEvidence: marketplaceInstall,
    }, {
      resolveRelease: async () => SHA,
      fetchRelease: PUBLIC_RELEASE,
      fetchListing: async () => ({
        status: 200,
        body: '<title>Sutura Verified Self-Healing CI · Actions</title>',
      }),
      now: () => '2026-09-04T12:00:00.000Z',
      verifyMarketplaceInstall: async () => undefined,
    });

    assert.equal(result.ready, true);
    assert.equal(result.candidate, SHA);
    assert.equal(result.release, 'v0.2.1');
    assert.match(result.installEvidenceHash, /^[a-f0-9]{64}$/u);
    assert.match(result.resultHash, /^[a-f0-9]{64}$/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('post-publication evidence rejects missing listings and candidate drift', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'sutura-marketplace-invalid-'));
  try {
    const installEvidence = join(temporary, 'adoption.json');
    const marketplaceInstall = join(temporary, 'marketplace-install.json');
    await writeFile(marketplaceInstall, JSON.stringify(marketplaceInstallEvidence()));
    await writeFile(installEvidence, JSON.stringify({
      schemaVersion: 'sutura-external-adoption-evidence-v1', candidate: SHA,
      ready: true, resultHash: 'b'.repeat(64),
    }));
    const request = {
      candidate: SHA, release: 'v0.2.1',
      listing: 'https://github.com/marketplace/actions/sutura-verified-self-healing-ci',
      installEvidence,
      marketplaceInstallEvidence: marketplaceInstall,
    };
    await assert.rejects(() => verifyMarketplaceEvidence(request, {
      resolveRelease: async () => 'c'.repeat(40),
      fetchRelease: PUBLIC_RELEASE,
      fetchListing: async () => ({ status: 200, body: 'Sutura Verified Self-Healing CI' }),
      verifyMarketplaceInstall: async () => undefined,
    }), /release commit/u);
    await assert.rejects(() => verifyMarketplaceEvidence(request, {
      resolveRelease: async () => SHA,
      fetchRelease: PUBLIC_RELEASE,
      fetchListing: async () => ({ status: 404, body: '' }),
      verifyMarketplaceInstall: async () => undefined,
    }), /listing/u);
    await writeFile(installEvidence, JSON.stringify({
      schemaVersion: 'sutura-external-adoption-evidence-v1', candidate: SHA,
      ready: false, resultHash: 'b'.repeat(64),
    }));
    await assert.rejects(() => verifyMarketplaceEvidence(request, {
      resolveRelease: async () => SHA,
      fetchRelease: PUBLIC_RELEASE,
      fetchListing: async () => ({ status: 200, body: 'Sutura Verified Self-Healing CI' }),
      verifyMarketplaceInstall: async () => undefined,
    }), /adoption evidence/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
