import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifyInstall } from './install-test-lib.mjs';
import { parsePublicInstallOptions, parseReleaseVersion, runPublicInstall } from './test-public-install.mjs';

const ACTION_SHA = 'b'.repeat(40);

function doctorOutput(commit) {
  return [
    'Sutura workflow exists.', `Workflow uses juan294/sutura@${commit}.`,
    'Workflow grants checks: write.', 'Workflow wires github-token.',
    'Workflow wires run-id.', 'Workflow wires runtime.',
    'Workflow wires nebius-api-key.', 'Workflow wires contree-token.',
    'Workflow wires contree-project.', 'GitHub secret NEBIUS_API_KEY is configured.',
    'GitHub secret CONTREE_TOKEN is configured.', 'GitHub variable CONTREE_PROJECT is configured.',
  ].map((line) => `[PASS] ${line}`).join('\n');
}

test('public install uses only sutura@0.2.1 and verifies the independently resolved release SHA', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'sutura-public-unit-'));
  const calls = [];
  try {
    await writeFile(join(temporary, 'LICENSE'), 'MIT fixture\n');
    const result = await verifyInstall({
      mode: 'public', root: temporary, releaseVersion: '0.2.1',
      now: (() => { let value = 100; return () => value += 25; })(),
      dependencies: {
        resolvePublicCommit: async (version) => {
          calls.push(['resolve', version]);
          return ACTION_SHA;
        },
        pack: async (source, destination) => {
          calls.push(['pack', source]);
          const tarball = join(destination, 'sutura-0.2.1.tgz');
          await writeFile(tarball, 'public');
          return tarball;
        },
        install: async (_tarball, consumer) => {
          await mkdir(join(consumer, 'node_modules', 'sutura'), { recursive: true });
          await writeFile(join(consumer, 'node_modules', 'sutura', 'package.json'), JSON.stringify({
            name: 'sutura', version: '0.2.1', dependencies: {},
          }));
          await writeFile(join(consumer, 'node_modules', 'sutura', 'LICENSE'), 'MIT fixture\n');
        },
        invoke: async (_binary, args, consumer, environment) => {
          calls.push(args);
          assert.deepEqual(Object.keys(environment).sort(), ['CI', 'NO_COLOR', 'PATH']);
          if (args[0] === 'init') {
            await mkdir(join(consumer, '.github', 'workflows'), { recursive: true });
            await writeFile(join(consumer, '.github', 'workflows', 'sutura.yml'),
              `jobs:\n  repair:\n    steps:\n      - uses: juan294/sutura@${ACTION_SHA}\n`);
            return '';
          }
          if (args[0] === 'doctor') return doctorOutput(ACTION_SHA);
          if (args[0] === '--version') return '0.2.1\n';
          throw new Error(`unexpected invocation ${args.join(' ')}`);
        },
      },
    });

    assert.equal(result.mode, 'public');
    assert.equal(result.actionCommit, ACTION_SHA);
    assert.equal(result.repository, 'sutura/install-smoke');
    assert.equal(result.setupDurationMs, 25);
    assert.equal(result.doctorDurationMs, 25);
    assert.equal(result.doctorOutcome, 'passed');
    assert.deepEqual(result.setupFailures, []);
    assert.deepEqual(result.unclearInstructions, []);
    assert.deepEqual(result.manualInterventions, []);
    assert.deepEqual(calls[0], ['resolve', '0.2.1']);
    assert.deepEqual(calls[1], ['pack', 'sutura@0.2.1']);
    assert.ok(!JSON.stringify(calls).includes('@latest'));
    assert.ok(!JSON.stringify(calls).includes('--action-sha'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('public wrapper accepts one explicit exact semver and rejects mutable or ranged releases', async () => {
  assert.equal(parseReleaseVersion([]), '0.2.1');
  assert.equal(parseReleaseVersion(['--release', '1.2.3']), '1.2.3');
  assert.deepEqual(parsePublicInstallOptions([
    '--candidate-evidence', '/tmp/candidate.json', '--release', '1.2.3',
  ]), { releaseVersion: '1.2.3', candidateEvidence: '/tmp/candidate.json' });
  assert.throws(() => parsePublicInstallOptions([
    '--release', '0.2.1', '--release', '0.2.1',
  ]), /unique/u);
  for (const args of [
    ['--release', 'latest'],
    ['--release', '^1.2.3'],
    ['--release', 'v1.2.3'],
    ['--release', '1.2'],
    ['--release', '01.2.3'],
    ['--release', '1.2.3-01'],
    ['1.2.3'],
    ['--release', '1.2.3', 'extra'],
  ]) {
    assert.throws(() => parseReleaseVersion(args), /exact semver|Usage/u);
  }

  let received;
  await runPublicInstall('1.2.3', {
    verify: async (options) => { received = options; return { packageVersion: options.releaseVersion }; },
  });
  assert.equal(received.mode, 'public');
  assert.equal(received.releaseVersion, '1.2.3');
  await assert.rejects(() => runPublicInstall('latest', { verify: async () => ({}) }), /exact semver/u);
});

test('public install fails when the generated workflow differs from the release tag commit', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'sutura-public-mismatch-'));
  try {
    await writeFile(join(temporary, 'LICENSE'), 'MIT fixture\n');
    await assert.rejects(() => verifyInstall({
      mode: 'public', root: temporary,
      dependencies: {
        resolvePublicCommit: async () => ACTION_SHA,
        pack: async (_source, destination) => {
          const tarball = join(destination, 'sutura.tgz');
          await writeFile(tarball, 'public');
          return tarball;
        },
        install: async (_tarball, consumer) => {
          await mkdir(join(consumer, 'node_modules', 'sutura'), { recursive: true });
          await writeFile(join(consumer, 'node_modules', 'sutura', 'package.json'), JSON.stringify({
            name: 'sutura', version: '0.2.1', dependencies: {},
          }));
          await writeFile(join(consumer, 'node_modules', 'sutura', 'LICENSE'), 'MIT fixture\n');
        },
        invoke: async (_binary, args, consumer) => {
          if (args[0] === 'init') {
            await mkdir(join(consumer, '.github', 'workflows'), { recursive: true });
            await writeFile(join(consumer, '.github', 'workflows', 'sutura.yml'),
              `jobs:\n  repair:\n    steps:\n      - uses: juan294/sutura@${'c'.repeat(40)}\n`);
          }
          if (args[0] === '--version') return '0.2.1\n';
          return '[PASS]\n';
        },
      },
    }), /exactly one active Sutura step/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('public package content must match candidate evidence before any installed binary executes', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'sutura-public-hash-'));
  let invoked = false;
  try {
    await writeFile(join(temporary, 'LICENSE'), 'MIT fixture\n');
    await assert.rejects(() => verifyInstall({
      mode: 'public', root: temporary, expectedPackageContentHash: '0'.repeat(64),
      dependencies: {
        resolvePublicCommit: async () => ACTION_SHA,
        pack: async (_source, destination) => {
          const tarball = join(destination, 'sutura.tgz');
          await writeFile(tarball, 'public');
          return tarball;
        },
        install: async (_tarball, consumer) => {
          await mkdir(join(consumer, 'node_modules', 'sutura'), { recursive: true });
          await writeFile(join(consumer, 'node_modules', 'sutura', 'package.json'), JSON.stringify({
            name: 'sutura', version: '0.2.1', dependencies: {},
          }));
          await writeFile(join(consumer, 'node_modules', 'sutura', 'LICENSE'), 'MIT fixture\n');
        },
        invoke: async () => { invoked = true; return ''; },
      },
    }), /differs from trusted candidate/u);
    assert.equal(invoked, false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
