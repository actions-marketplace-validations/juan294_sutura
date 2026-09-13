import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { acknowledgeAlert, createCommandDelivery, deliverAlert, readAlert, writeTerminalAlert } from './evaluation-alerts.mjs';

async function fixture(t) {
  const stateDir = await mkdtemp(join(tmpdir(), 'sutura-alert-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  return { stateDir, event: { eventId: 'run-1-stopped', manifestId: 'run-1', status: 'stopped', completedCases: 14, totalCases: 80, pendingCaseId: null, recordedUsd: 1.48, reason: 'monitoring-unavailable' } };
}

test('a stopped run persists a pending alert without pretending delivery', async (t) => {
  const options = await fixture(t);
  const created = await writeTerminalAlert(options);
  assert.equal(created.delivery.status, 'pending');
  assert.equal((await deliverAlert({ ...options, eventId: options.event.eventId })).delivery.status, 'pending');
  assert.deepEqual(await writeTerminalAlert(options), created);
  await assert.rejects(writeTerminalAlert({ ...options, event: { ...options.event, totalCases: 81 } }), /identity/);
});

test('failed delivery survives a new caller; a real subprocess receiver gets the stopped event once', async (t) => {
  const options = await fixture(t);
  const eventId = options.event.eventId;
  await writeTerminalAlert(options);
  await deliverAlert({ ...options, eventId, deliver: async () => { throw new Error('secret webhook URL'); } });
  const failed = await readAlert({ ...options, eventId });
  assert.equal(failed.delivery.status, 'pending');
  assert.equal(failed.delivery.attempts, 1);
  assert.ok(!JSON.stringify(failed).includes('secret'));
  const received = join(options.stateDir, 'received.json');
  const deliver = createCommandDelivery(process.execPath, ['-e', 'let s=""; process.stdin.on("data",c=>s+=c); process.stdin.on("end",()=>require("fs").writeFileSync(process.argv[1],s,{flag:"wx"}));', received]);
  const accepted = await deliverAlert({ ...options, eventId, deliver });
  assert.deepEqual(JSON.parse(await readFile(received, 'utf8')), options.event);
  assert.equal(accepted.delivery.status, 'transport-accepted');
  assert.equal(accepted.delivery.attempts, 2);
  assert.equal(accepted.delivery.acknowledgedAt, null);
  await deliverAlert({ ...options, eventId, deliver });
  assert.equal((await acknowledgeAlert({ ...options, eventId })).delivery.status, 'acknowledged');
});

test('command failure and timeout retain retryable pending alerts without command output', async (t) => {
  const options = await fixture(t);
  await writeTerminalAlert(options);
  const eventId = options.event.eventId;
  for (const args of [['-e', 'process.stderr.write("secret");process.exit(1)'], ['-e', 'setTimeout(()=>{},10000)']]) {
    const state = await deliverAlert({ ...options, eventId, deliver: createCommandDelivery(process.execPath, args, { timeoutMs: 50 }) });
    assert.equal(state.delivery.status, 'pending');
    assert.ok(!JSON.stringify(state).includes('secret'));
  }
});

test('event payload excludes arbitrary details and path traversal', async (t) => {
  const options = await fixture(t);
  await assert.rejects(writeTerminalAlert({ ...options, event: { ...options.event, error: 'secret' } }), /event/);
  await assert.rejects(writeTerminalAlert({ ...options, event: { ...options.event, eventId: '../escape' } }), /event/);
  await assert.rejects(writeTerminalAlert({ ...options, event: { ...options.event, completedCases: 81 } }), /event/);
});

test('a throwing runner delivers a real local stop alert then preserves its original error', async (t) => {
  const { runWithTerminalAlert } = await import('./evaluation-alerts.mjs');
  const options = await fixture(t);
  const received = join(options.stateDir, 'runner-received.json');
  const original = new Error('provider token must stay private');
  const deliver = createCommandDelivery(process.execPath, ['-e', 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>require("fs").writeFileSync(process.argv[1],s));', received]);
  await assert.rejects(runWithTerminalAlert({ stateDir: options.stateDir, manifestId: 'run-1', totalCases: 80,
    run: async () => { throw original; }, readProgress: async () => ({ completedCases: 14, pendingCaseId: 'case-15', recordedUsd: 1.48 }), deliver }), (error) => error === original);
  const event = JSON.parse(await readFile(received, 'utf8'));
  assert.equal(event.status, 'failed');
  assert.equal(event.reason, 'runner-failed');
  assert.equal(event.completedCases, 14);
  assert.ok(!JSON.stringify(event).includes('private'));
  assert.equal((await readAlert({ stateDir: options.stateDir, eventId: event.eventId })).delivery.status, 'transport-accepted');
});

test('runner stop retains a pending alert after delivery failure; alert errors never replace runner failure', async (t) => {
  const { runWithTerminalAlert } = await import('./evaluation-alerts.mjs');
  const options = await fixture(t);
  const base = { stateDir: options.stateDir, manifestId: 'run-1', totalCases: 80,
    readProgress: async () => ({ completedCases: 14, pendingCaseId: null, recordedUsd: 1.48 }),
    deliver: async () => { throw new Error('notification unavailable'); } };
  const result = { stoppedFor: 'infrastructure-stop' };
  const outcome = await runWithTerminalAlert({ ...base, run: async () => result });
  assert.equal(outcome.result, result);
  assert.equal(outcome.alert.event.status, 'stopped');
  assert.equal(outcome.alert.delivery.status, 'pending');
  assert.equal(outcome.alert.delivery.lastFailure, 'delivery-failed');
  const original = new Error('original');
  await assert.rejects(runWithTerminalAlert({ ...base, run: async () => { throw original; }, readProgress: async () => { throw new Error('progress unavailable'); } }), (error) => error === original);
});

test('unavailable progress still delivers a failure alert with unknown spend', async (t) => {
  const { runWithTerminalAlert } = await import('./evaluation-alerts.mjs');
  const options = await fixture(t);
  const received = join(options.stateDir, 'unknown-progress.json');
  const original = new Error('original runner failure');
  const deliver = createCommandDelivery(process.execPath, ['-e', 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>require("fs").writeFileSync(process.argv[1],s));', received]);
  await assert.rejects(runWithTerminalAlert({ stateDir: options.stateDir, manifestId: 'run-1', totalCases: 80,
    run: async () => { throw original; }, readProgress: async () => { throw new Error('ledger unavailable'); }, deliver }), (error) => error === original);
  const event = JSON.parse(await readFile(received, 'utf8'));
  assert.equal(event.status, 'failed');
  assert.equal(event.reason, 'progress-unavailable');
  assert.equal(event.recordedUsd, null);
});


test('retry recovers a dead sender lock and retains the same event identity', async (t) => {
  const options = await fixture(t);
  await writeTerminalAlert(options);
  const eventId = options.event.eventId;
  const lockPath = join(options.stateDir, `${eventId}.json.lock`);
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { acquireProcessLock } from ${JSON.stringify(new URL('./live-process-lock.mjs', import.meta.url).href)};await acquireProcessLock(process.argv[1]);process.stdout.write('ready');setInterval(()=>{},1000);`, lockPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  await once(child.stdout, 'data');
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  let received;
  const state = await deliverAlert({ ...options, eventId, deliver: async (event) => { received = event; } });
  assert.equal(received.eventId, eventId);
  assert.equal(state.delivery.status, 'transport-accepted');
});
