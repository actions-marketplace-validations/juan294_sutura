import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assertCandidateCheckout } from './test-candidate-install.mjs';
import { packedFilename, verifyInstall } from './install-test-lib.mjs';

const ACTION_SHA = 'a'.repeat(40);

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

test('candidate pack accepts npm 11 and npm 12 JSON output only when one package is present', () => {
  assert.equal(packedFilename('[{"filename":"sutura-0.2.1.tgz"}]'), 'sutura-0.2.1.tgz');
  assert.equal(packedFilename('{"filename":"sutura-0.2.1.tgz"}'), 'sutura-0.2.1.tgz');
  assert.equal(packedFilename('{"sutura":{"filename":"sutura-0.2.1.tgz"}}'),
    'sutura-0.2.1.tgz');
  assert.throws(() => packedFilename('{}'), /did not return one filename/u);
  assert.throws(() => packedFilename('{"one":{"filename":"one.tgz"},"two":{"filename":"two.tgz"}}'),
    /did not return one filename/u);
});

test('candidate install uses the local tarball and exact candidate Action SHA without network', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'sutura-candidate-unit-'));
  const calls = [];
  try {
    await writeFile(join(temporary, 'LICENSE'), 'MIT fixture\n');
    const result = await verifyInstall({
      mode: 'candidate',
      root: temporary,
      actionCommit: ACTION_SHA,
      now: (() => { let value = 100; return () => value += 25; })(),
      dependencies: {
        pack: async (source, destination) => {
          calls.push(['pack', source]);
          const tarball = join(destination, 'sutura-0.2.1.tgz');
          await writeFile(tarball, 'candidate');
          return tarball;
        },
        install: async (_tarball, consumer) => {
          calls.push(['install']);
          await mkdir(join(consumer, 'node_modules', 'sutura'), { recursive: true });
          await writeFile(join(consumer, 'node_modules', 'sutura', 'package.json'), JSON.stringify({
            name: 'sutura', version: '0.2.1', dependencies: {},
          }));
          await writeFile(join(consumer, 'node_modules', 'sutura', 'LICENSE'), 'MIT fixture\n');
        },
        invoke: async (_binary, args, consumer) => {
          calls.push(args);
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

    assert.equal(result.mode, 'candidate');
    assert.equal(result.actionCommit, ACTION_SHA);
    assert.equal(result.packageVersion, '0.2.1');
    assert.equal(result.setupDurationMs, 25);
    assert.match(result.packageIntegrity, /^[a-f0-9]{64}$/u);
    assert.deepEqual(calls[0], ['pack', join(temporary, 'packages', 'cli')]);
    assert.ok(calls.some((entry) => Array.isArray(entry) && entry.includes('--action-sha')));
    assert.ok(!JSON.stringify(calls).includes('sutura@0.2.1'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('candidate install rejects a mutable or malformed Action ref before packing', async () => {
  let packed = false;
  await assert.rejects(() => verifyInstall({
    mode: 'candidate', root: '/tmp/unused', actionCommit: 'main',
    dependencies: {
      pack: async () => { packed = true; return ''; },
      install: async () => undefined,
      invoke: async () => '',
    },
  }), /exact 40-character/u);
  assert.equal(packed, false);
});

test('candidate wrapper rejects a different HEAD or relevant dirty files', async () => {
  const clean = async (_command, args) => {
    if (args[0] === 'rev-parse') return `${ACTION_SHA}\n`;
    if (args[0] === 'diff') return '';
    if (args[0] === 'ls-files') return '';
    throw new Error('unexpected command');
  };
  await assert.doesNotReject(() => assertCandidateCheckout('/repo', ACTION_SHA, clean));
  await assert.rejects(() => assertCandidateCheckout('/repo', 'main', clean), /exact 40-character/u);
  await assert.rejects(() => assertCandidateCheckout('/repo', 'b'.repeat(40), clean), /HEAD/u);
  await assert.rejects(() => assertCandidateCheckout('/repo', ACTION_SHA, async (command, args, options) => {
    if (args[0] === 'diff') throw new Error('dirty');
    if (args[0] === 'status') return ' M packages/action/dist/index.cjs\n';
    return clean(command, args, options);
  }), /differs from the candidate commit; changed paths:\n M packages\/action\/dist\/index\.cjs/u);
  await assert.rejects(() => assertCandidateCheckout('/repo', ACTION_SHA, async (command, args, options) => {
    if (args[0] === 'ls-files') return 'packages/cli/src/untracked.ts\n';
    return clean(command, args, options);
  }), /untracked/u);
});
