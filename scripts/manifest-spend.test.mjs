import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initializeManifestSpend, readManifestPending, withManifestSpend } from './manifest-spend.mjs';
import { validateRunManifest } from './verified-program-evidence.mjs';
const source = JSON.parse(await readFile(new URL('../docs/demo/run-manifests/development-validation-v1.json', import.meta.url)));
const manifest = validateRunManifest(source);
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'manifest-spend-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { directory, manifest, capUsd: 1, initialReserveUsd: 0.4, caseId: manifest.subjects[0], controllerSha: manifest.identity.candidateCommit, subjectSha: manifest.identity.candidateCommit };
  await initializeManifestSpend(options);
  return options;
}
test('restart with an empty case ledger still counts earlier manifest spending', async (t) => {
  const options = await fixture(t);
  await withManifestSpend(options, async () => ({ artifact: { totalUsd: 0.7, githubRunId: '123' } }));
  await assert.rejects(withManifestSpend(options, () => assert.fail('must not dispatch')), /cap-reserve/);
  await assert.rejects(initializeManifestSpend(options), /EEXIST/);
});
test('unknown cost survives an interrupted dispatch and blocks a restart', async (t) => {
  const options = await fixture(t);
  await assert.rejects(withManifestSpend(options, async () => { throw new Error('download failed'); }), /download failed/);
  await assert.rejects(withManifestSpend(options, () => assert.fail('must not dispatch')), /unsettled/);
});
test('missing spend state fails closed, and changing cap or manifest cannot reset it', async (t) => {
  const options = await fixture(t);
  await assert.rejects(withManifestSpend({ ...options, capUsd: 2 }, () => assert.fail()), /identity or cap/);
  await assert.rejects(withManifestSpend({ ...options, manifest: validateRunManifest({ ...manifest, purpose: 'changed' }) }, () => assert.fail()), /identity or cap/);
  await assert.rejects(withManifestSpend({ ...options, manifest: validateRunManifest({ ...manifest, manifestId: 'missing' }) }, () => assert.fail()), /ENOENT/);
});
test('concurrent controllers cannot spend the same reserve', async (t) => {
  const options = await fixture(t);
  await withManifestSpend(options, async () => {
    await assert.rejects(withManifestSpend(options, () => assert.fail()), /EEXIST/);
    return { artifact: { totalUsd: 0.1, githubRunId: '123' } };
  });
});
test('candidate and subjects are checked before dispatch', async (t) => {
  const options = await fixture(t);
  for (const change of [{ caseId: 'unlisted' }, { controllerSha: 'a'.repeat(40) }]) {
    await assert.rejects(withManifestSpend({ ...options, ...change }, () => assert.fail()), /candidate or subject/);
  }
});
test('invalid or unexpectedly high completion cost cannot restore budget', async (t) => {
  const options = await fixture(t);
  await withManifestSpend(options, async (pending) => {
    assert.match(pending.controllerId, /^pl-/);
    return { artifact: { totalUsd: 1.2, githubRunId: '123' } };
  });
  await assert.rejects(withManifestSpend(options, () => assert.fail()), /cap-reserve/);
});
test('missing completion cost stays unsettled', async (t) => {
  const options = await fixture(t);
  await assert.rejects(withManifestSpend(options, async () => ({ artifact: { githubRunId: '123' } })), /amount/);
  await assert.rejects(withManifestSpend(options, () => assert.fail()), /unsettled/);
});
for (const totalUsd of [0, 0.2]) test(`infrastructure-stop telemetry (${totalUsd}) cannot settle unknown provider charges`, async (t) => {
  const options = await fixture(t);
  await assert.rejects(withManifestSpend(options, async () => ({ artifact: {
    githubRunId: '123', totalUsd,
    results: [{ caseFile: { outcome: 'infra-stop', cost: { entries: [] } } }],
  } })), /Infrastructure-stop cost requires reconciliation/);
  const account = JSON.parse(await readFile(join(options.directory, `${manifest.manifestId}.json`), 'utf8'));
  assert.deepEqual(account.entries, []);
  assert.equal(account.pending.caseId, options.caseId);
  assert.equal(account.pending.reserveMicroUsd, 400000);
  await assert.rejects(withManifestSpend(options, () => assert.fail('must not redispatch')), /unsettled/);
});

test('recovery reuses a durable job and reserve without allocating another dispatch', async (t) => {
  const options = await fixture(t);
  let previous;
  await assert.rejects(withManifestSpend(options, async (pending) => {
    previous = pending;
    await pending.checkpointRun('456');
    throw new Error('TLS timeout');
  }), /TLS timeout/);
  await withManifestSpend({ ...options, recoverPending: true }, async (pending) => {
    assert.equal(pending.resumed, true);
    assert.equal(pending.runId, '456');
    assert.equal(pending.controllerId, previous.controllerId);
    assert.equal(pending.reserveMicroUsd, previous.reserveMicroUsd);
    await pending.checkpointRun('456');
    await assert.rejects(pending.checkpointRun('789'), /run id/);
    return { artifact: { totalUsd: 0.3, githubRunId: '456' } };
  });
  const state = JSON.parse(await readFile(join(options.directory, `${manifest.manifestId}.json`), 'utf8'));
  assert.deepEqual(state.entries, [{ caseId: options.caseId, runId: '456', microUsd: 300000 }]);
  assert.equal(state.pending, null);
});

test('recovery refuses another subject and conflicting completion identity', async (t) => {
  const options = await fixture(t);
  await assert.rejects(withManifestSpend(options, async (pending) => {
    await pending.checkpointRun('456');
    throw new Error('interrupted');
  }), /interrupted/);
  await assert.rejects(withManifestSpend({ ...options, recoverPending: true, caseId: manifest.subjects[1] }, () => assert.fail()), /pending.*subject/);
  await assert.rejects(withManifestSpend({ ...options, recoverPending: true }, async () => ({ artifact: { totalUsd: 0.1, githubRunId: '789' } })), /run id/);
});


test('a killed controller recovers its checkpoint and accounts for the remote run once', async (t) => {
  const options = await fixture(t);
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { withManifestSpend } from ${JSON.stringify(new URL('./manifest-spend.mjs', import.meta.url).href)};
    await withManifestSpend(JSON.parse(process.argv[1]), async (pending) => {
      await pending.checkpointRun('456');
      process.stdout.write('ready');
      await new Promise(() => setInterval(() => {}, 1000));
    });`, JSON.stringify(options)], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  await once(child.stdout, 'data');
  const saved = await readManifestPending(options);
  await assert.rejects(withManifestSpend({ ...options, recoverPending: true }, () => assert.fail()), /EEXIST/);
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  await withManifestSpend({ ...options, recoverPending: true }, async (pending) => {
    assert.equal(pending.controllerId, saved.controllerId);
    assert.equal(pending.resumed, true);
    assert.equal(pending.runId, '456');
    return { artifact: { totalUsd: 0.7, githubRunId: '456' } };
  });
  assert.equal(await readManifestPending(options), null);
  await assert.rejects(withManifestSpend(options, () => assert.fail('must not allocate another reserve')), /cap-reserve/);
});

test('pending readers validate identity, cap and state without changing the account', async (t) => {
  const options = await fixture(t);
  await assert.rejects(readManifestPending({ ...options, capUsd: 2 }), /identity or cap/);
  await assert.rejects(readManifestPending({ ...options, controllerSha: 'a'.repeat(40) }), /candidate/);
  const path = join(options.directory, `${manifest.manifestId}.json`);
  const state = JSON.parse(await readFile(path, 'utf8'));
  for (const pending of [{}, { caseId: options.caseId, controllerId: 'pl-1', reserveMicroUsd: 1, startedAt: new Date().toISOString(), runId: 'invalid' }]) {
    await writeFile(path, JSON.stringify({ ...state, pending }));
    await assert.rejects(readManifestPending(options), /pending state/);
  }
});

test('recovery does not settle a completion for another candidate or subject', async (t) => {
  const options = await fixture(t);
  await assert.rejects(withManifestSpend(options, async () => { throw new Error('interrupted'); }), /interrupted/);
  for (const identity of [{ caseId: manifest.subjects[1] }, { controllerSha: 'a'.repeat(40) }, { subjectSha: 'a'.repeat(40) }]) {
    await assert.rejects(withManifestSpend({ ...options, recoverPending: true }, async () => ({ artifact: { totalUsd: 0.1, githubRunId: '456', ...identity } })), /completion identity/);
    assert.equal((await readManifestPending(options)).caseId, options.caseId);
  }
});

test('recovery cannot allocate a new dispatch after another controller settles it', async (t) => {
  const options = await fixture(t);
  await assert.rejects(withManifestSpend(options, async () => { throw new Error('interrupted'); }), /interrupted/);
  assert.ok(await readManifestPending(options));
  await withManifestSpend({ ...options, recoverPending: true }, async () => ({ artifact: { totalUsd: 0.1, githubRunId: '456' } }));
  await assert.rejects(withManifestSpend({ ...options, recoverPending: true }, () => assert.fail('stale recovery must not dispatch')), /no pending dispatch/);
  assert.equal(await readManifestPending(options), null);
});

test('a missing local ledger cannot redispatch a subject already settled in the account', async (t) => {
  const options = await fixture(t);
  await withManifestSpend(options, async () => ({ artifact: { totalUsd: 0.1, githubRunId: '456' } }));
  await assert.rejects(withManifestSpend(options, () => assert.fail('settled subject must not dispatch')), /already settled/);
  assert.equal(await readManifestPending(options), null);
});
