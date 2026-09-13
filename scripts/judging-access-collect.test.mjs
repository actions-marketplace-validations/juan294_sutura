import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { collectJudgingAccess } from './judging-access-collect.mjs';
import { checkArtifact } from './judging-access.mjs';
const hash = text => createHash('sha256').update(text).digest('hex');
const now = new Date('2026-09-08T12:00:00Z');
const manifest = artifacts => ({ artifacts, fallbackArtifactName: 'recording' });
test('collects bounded anonymous bytes, checks identities, and archives independently of login', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sutura-access-'));
  try {
    const body = JSON.stringify({ sourceSha: 'a'.repeat(40) });
    const calls = [];
    const result = await collectJudgingAccess(manifest([{ name: 'recording', url: 'https://example.org/evidence.json', expectedPin: 'a'.repeat(40), pinField: 'sourceSha', expectedResultHash: hash(body) }]), {
      now, archiveDir: dir, fetch: async (url, options) => { calls.push({ url, options }); return new Response(body); },
    });
    assert.equal(result.available, true);
    assert.equal(calls[0].options.credentials, 'omit');
    assert.equal(calls[0].options.redirect, 'error');
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.headers.Authorization, undefined);
    assert.equal(await readFile(join(dir, `${hash(body)}.bin`), 'utf8'), body);
    assert.equal(result.observations[0].servedResultHash, hash(body));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('rejects every method except exact GET or HEAD, including lowercase post', async () => {
  for (const method of ['post', 'OPTIONS', 'PATCH', 'TRACE']) {
    assert.throws(() => checkArtifact({ name: 'page', status: 200, method }, now), /not a check/);
  }
  await assert.rejects(collectJudgingAccess(manifest([{ name: 'page', url: 'https://example.org', method: 'post' }]), { fetch: () => { throw new Error('must not fetch'); } }), /not a check/);
});
test('refuses credential-bearing or non-HTTPS URLs before fetching', async () => {
  for (const url of ['https://user:password@example.org/', 'http://example.org/', 'file:///tmp/token']) {
    await assert.rejects(collectJudgingAccess(manifest([{ name: 'page', url }]), { fetch: () => { throw new Error('must not fetch'); } }), /public HTTPS/);
  }
});
test('reports oversized bodies and transport failures without false success', async () => {
  const input = manifest([{ name: 'page', url: 'https://example.org/', expectedResultHash: hash('exact') }]);
  const large = await collectJudgingAccess(input, { maxBytes: 4, fetch: async () => new Response('too long') });
  assert.equal(large.available, false);
  assert.equal(large.observations[0].error, 'body-limit');
  const offline = await collectJudgingAccess(input, { fetch: async () => { throw new Error('private credential must not be recorded'); } });
  assert.equal(offline.available, false);
  assert.equal(JSON.stringify(offline).includes('private credential'), false);
});
test('HEAD cannot pretend it observed archive bytes or a served source pin', async () => {
  await assert.rejects(collectJudgingAccess(manifest([{ name: 'archive', url: 'https://example.org/', method: 'HEAD', expectedResultHash: hash('x') }]), {}), /GET/);
});
test('retains observations when both live and recorded paths are unavailable', async () => {
  const result = await collectJudgingAccess({ artifacts: [{ name: 'live', url: 'https://example.org/live' }, { name: 'recording', url: 'https://example.org/recording' }], liveArtifactName: 'live', fallbackArtifactName: 'recording' }, { fetch: async () => new Response('', { status: 503 }) });
  assert.equal(result.available, false);
  assert.equal(result.reasonCode, 'no-usable-path');
  assert.equal(result.observations.length, 2);
});
test('enforces a local deadline even if the transport ignores cancellation', async () => {
  const result = await collectJudgingAccess(manifest([{ name: 'page', url: 'https://example.org/' }]), { timeoutMs: 5, fetch: () => new Promise(() => {}) });
  assert.equal(result.available, false);
  assert.equal(result.observations[0].error, 'timeout');
});

test('does not archive a response that arrives after the local timeout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sutura-access-late-'));
  try {
    let deliver;
    const response = new Promise(resolve => { deliver = resolve; });
    const report = await collectJudgingAccess(manifest([{ name:'page', url:'https://example.org/' }]), {timeoutMs:5,archiveDir:dir,fetch:()=>response});
    assert.equal(report.observations[0].error,'timeout');
    deliver(new Response('late bytes'));
    await new Promise(resolve => setTimeout(resolve,20));
    assert.deepEqual(await readdir(dir),[]);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
