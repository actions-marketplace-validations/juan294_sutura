/** Durable, opt-in evaluation alerts. Transport acceptance is not a read receipt. */
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { acquireProcessLock } from './live-process-lock.mjs';

const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
const fields = ['eventId', 'manifestId', 'status', 'completedCases', 'totalCases', 'pendingCaseId', 'reason', 'recordedUsd'];
export function validateEvent(event) {
  if (!event || Object.keys(event).some((key) => !fields.includes(key)) ||
      !identifier.test(event.eventId ?? '') || !identifier.test(event.manifestId ?? '') ||
      !['complete', 'stopped', 'failed'].includes(event.status) ||
      !Number.isSafeInteger(event.completedCases) || event.completedCases < 0 ||
      !Number.isSafeInteger(event.totalCases) || event.totalCases < event.completedCases ||
      !(event.pendingCaseId === null || identifier.test(event.pendingCaseId ?? '')) ||
      !/^[a-z][a-z0-9-]{0,63}$/u.test(event.reason ?? '') ||
      !(event.recordedUsd === null || (Number.isFinite(event.recordedUsd) && event.recordedUsd >= 0))) throw new Error('Invalid evaluation alert event');
  return Object.fromEntries(fields.map((key) => [key, event[key]]));
}
function alertPath({ stateDir, eventId }) {
  if (!identifier.test(eventId ?? '')) throw new Error('Invalid evaluation alert event id');
  return join(stateDir, `${eventId}.json`);
}
async function persist(path, record, exclusive = false) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (exclusive) await link(temporary, path);
    else await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
export async function readAlert(options) {
  const record = JSON.parse(await readFile(alertPath(options), 'utf8'));
  validateEvent(record.event);
  if (record.schemaVersion !== 'sutura-evaluation-alert-v1' || record.event.eventId !== options.eventId ||
      !['pending', 'transport-accepted', 'acknowledged'].includes(record.delivery?.status)) throw new Error('Invalid evaluation alert record');
  return record;
}
export async function writeTerminalAlert({ stateDir, event }) {
  event = validateEvent(event);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const path = alertPath({ stateDir, eventId: event.eventId });
  const record = { schemaVersion: 'sutura-evaluation-alert-v1', event, createdAt: new Date().toISOString(),
    delivery: { status: 'pending', attempts: 0, acceptedAt: null, acknowledgedAt: null, lastFailure: null } };
  try { await persist(path, record, true); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await readAlert({ stateDir, eventId: event.eventId });
    if (JSON.stringify(validateEvent(existing.event)) !== JSON.stringify(event)) throw new Error('Evaluation alert identity already has different content');
    return existing;
  }
  return record;
}
async function update(options, operation) {
  const path = alertPath(options);
  // Recover dead senders on this host. A send interrupted before acceptance was
  // recorded can repeat, always retaining the same event ID for deduplication.
  const release = await acquireProcessLock(`${path}.lock`);
  try { return await operation(path, await readAlert(options)); }
  finally { await release(); }
}
export async function deliverAlert(options) {
  if (!options.deliver) return readAlert(options);
  return update(options, async (path, record) => {
    if (record.delivery.status !== 'pending') return record;
    record.delivery.attempts += 1;
    await persist(path, record);
    try {
      await options.deliver(record.event);
      record.delivery.status = 'transport-accepted';
      record.delivery.acceptedAt = new Date().toISOString();
      record.delivery.lastFailure = null;
    } catch {
      // Never copy transport errors: they may include webhook credentials.
      record.delivery.lastFailure = 'delivery-failed';
    }
    await persist(path, record);
    return record;
  });
}
export async function acknowledgeAlert(options) {
  return update(options, async (path, record) => {
    record.delivery.status = 'acknowledged';
    record.delivery.acknowledgedAt = new Date().toISOString();
    await persist(path, record);
    return record;
  });
}
export function createCommandDelivery(command, args = [], { timeoutMs = 10_000 } = {}) {
  if (!isAbsolute(command) || !Array.isArray(args) || args.some((arg) => typeof arg !== 'string') ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid evaluation alert command');
  return async (event) => {
    const payload = JSON.stringify(validateEvent(event));
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'], shell: false, timeout: timeoutMs, killSignal: 'SIGKILL' });
      child.on('error', () => reject(new Error('Evaluation alert command failed')));
      child.stdin.on('error', () => reject(new Error('Evaluation alert command input failed')));
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error('Evaluation alert command failed')));
      child.stdin.end(`${payload}\n`);
    });
  };
}

/** Await terminal alert persistence before returning or rethrowing the run error. */
export async function runWithTerminalAlert({ stateDir, manifestId, totalCases, run, readProgress, deliver }) {
  let result;
  let alert;
  let runFailed = false;
  let runError;
  try {
    result = await run();
  } catch (error) {
    runFailed = true;
    runError = error;
  } finally {
    try {
      let progress;
      let progressFailed = false;
      try { progress = await readProgress(); }
      catch {
        progressFailed = true;
        progress = { completedCases: 0, pendingCaseId: null, recordedUsd: null };
      }
      const status = (runFailed || progressFailed) ? 'failed' : result?.stoppedFor && result.stoppedFor !== 'complete' ? 'stopped' : 'complete';
      const event = {
        eventId: randomUUID(), manifestId, status, totalCases,
        completedCases: progress.completedCases,
        pendingCaseId: progress.pendingCaseId,
        recordedUsd: progress.recordedUsd,
        reason: progressFailed ? 'progress-unavailable' : runFailed ? 'runner-failed' : status === 'stopped' ? 'runner-stopped' : 'complete',
      };
      alert = await writeTerminalAlert({ stateDir, event });
      alert = await deliverAlert({ stateDir, eventId: event.eventId, deliver });
    } catch (error) {
      // A reporting failure must never replace the failure being reported.
      if (!runFailed) throw error;
    }
  }
  if (runFailed) throw runError;
  return { result, alert };
}
