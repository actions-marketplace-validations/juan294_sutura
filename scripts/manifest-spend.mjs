/** Local cumulative accounting, separate from replaceable result ledgers.
 * An unknown dispatch cost stays pending. Never infer zero from a failed job.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { acquireProcessLock } from './live-process-lock.mjs';
import { join } from 'node:path';
import { validateRunManifest } from './verified-program-evidence.mjs';

function amount(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error('Manifest spend amount must be between USD 0 and 100');
  return Math.round(value * 1_000_000);
}

function identity(options) {
  const manifest = validateRunManifest(options.manifest);
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(manifest.manifestId ?? '') || manifest.mode !== 'live') {
    throw new Error('Manifest spend requires a valid live manifest id');
  }
  const cap = amount(options.capUsd);
  if (cap <= 0 || options.capUsd > manifest.caps.inferenceUsd) throw new Error('Manifest spend cap exceeds manifest cap');
  return { manifest, cap, path: join(options.directory, `${manifest.manifestId}.json`) };
}

export async function initializeManifestSpend(options) {
  const { manifest, cap, path } = identity(options);
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  // Exclusive creation: restarting or copying a result ledger cannot reset spend.
  await writeFile(path, JSON.stringify({
    schemaVersion: 'sutura-manifest-spend-v1', manifestHash: manifest.manifestHash,
    cap, entries: [], pending: null,
  }), { flag: 'wx', mode: 0o600 });
  return { manifestId: manifest.manifestId, capUsd: cap / 1_000_000 };
}

async function save(path, state) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

async function readState(path, manifest, cap) {
  const state = JSON.parse(await readFile(path, 'utf8'));
  if (!state || state.schemaVersion !== 'sutura-manifest-spend-v1' || state.manifestHash !== manifest.manifestHash || state.cap !== cap) {
    throw new Error('Manifest spend identity or cap differs from initialized account');
  }
  if (!Array.isArray(state.entries) || state.entries.some((entry) =>
    !entry || !Number.isSafeInteger(entry.microUsd) || entry.microUsd < 0 ||
    !manifest.subjects.includes(entry.caseId) || typeof entry.runId !== 'string' || !/^[1-9]\d{0,19}$/u.test(entry.runId ?? '')) ||
    new Set(state.entries.map((entry) => entry.runId)).size !== state.entries.length) {
    throw new Error('Manifest spend entries are invalid');
  }
  const pending = state.pending;
  if (pending !== null && (!pending || !manifest.subjects.includes(pending.caseId) ||
      typeof pending.controllerId !== 'string' || !/^pl-[a-zA-Z0-9-]+$/u.test(pending.controllerId) ||
      !Number.isSafeInteger(pending.reserveMicroUsd) || pending.reserveMicroUsd <= 0 || pending.reserveMicroUsd > cap ||
      typeof pending.startedAt !== 'string' || !Number.isFinite(Date.parse(pending.startedAt)) ||
      (pending.runId !== undefined && (typeof pending.runId !== 'string' || !/^[1-9]\d{0,19}$/u.test(pending.runId) || state.entries.some((entry) => entry.runId === pending.runId))) ||
      (pending.controllerSha !== undefined && pending.controllerSha !== manifest.identity.candidateCommit) ||
      (pending.subjectSha !== undefined && pending.subjectSha !== manifest.identity.candidateCommit))) {
    throw new Error('Manifest spend pending state is invalid');
  }
  return state;
}

export async function readManifestPending(options) {
  const { manifest, cap, path } = identity(options);
  for (const candidate of [options.controllerSha, options.subjectSha]) {
    if (candidate !== undefined && candidate !== manifest.identity.candidateCommit) throw new Error('Manifest spend candidate differs from manifest');
  }
  return (await readState(path, manifest, cap)).pending;
}

export async function withManifestSpend(options, operation) {
  const { manifest, cap, path } = identity(options);
  if (options.controllerSha !== manifest.identity.candidateCommit ||
      options.subjectSha !== manifest.identity.candidateCommit || !manifest.subjects.includes(options.caseId)) {
    throw new Error('Manifest spend candidate or subject differs from manifest');
  }
  const initialReserve = amount(options.initialReserveUsd);
  if (initialReserve <= 0 || initialReserve > cap) throw new Error('Manifest spend requires a positive reserve within cap');
  const lockPath = `${path}.lock`;
  const release = await acquireProcessLock(lockPath);
  try {
    const state = await readState(path, manifest, cap);
    const resumed = state.pending !== null;
    if (!resumed && options.recoverPending === true) throw new Error('Manifest spend recovery has no pending dispatch');
    if (resumed) {
      if (options.recoverPending !== true) throw new Error('Manifest spend has an unsettled dispatch; reconcile its cost before continuing');
      if (state.pending.caseId !== options.caseId) throw new Error('Manifest spend pending subject differs from requested subject');
    } else {
      const spent = state.entries.reduce((sum, entry) => sum + entry.microUsd, 0);
      const reserve = Math.max(initialReserve, ...state.entries.map((entry) => entry.microUsd));
      if (spent + reserve > cap) throw new Error('Manifest spend stopped for cap-reserve');
      if (state.entries.some((entry) => entry.caseId === options.caseId)) throw new Error('Manifest spend subject is already settled');
      state.pending = { caseId: options.caseId, controllerId: `pl-${Date.now()}-${randomUUID().slice(0, 8)}`,
        controllerSha: options.controllerSha, subjectSha: options.subjectSha,
        reserveMicroUsd: reserve, startedAt: new Date().toISOString() };
      await save(path, state);
    }
    const checkpointRun = async (runId) => {
      if (typeof runId !== 'string' || !/^[1-9]\d{0,19}$/u.test(runId) ||
          (state.pending.runId !== undefined && state.pending.runId !== runId) ||
          state.entries.some((entry) => entry.runId === runId)) throw new Error('Manifest spend checkpoint run id is invalid or changed');
      state.pending.runId = runId;
      await save(path, state);
    };
    const completed = await operation({ ...state.pending, resumed, checkpointRun });
    for (const key of ['caseId', 'controllerSha', 'subjectSha']) {
      if (completed?.artifact?.[key] !== undefined && completed.artifact[key] !== options[key]) {
        throw new Error('Manifest spend completion identity differs from pending dispatch');
      }
    }
    // Runtime exceptions can lose telemetry, including after a paid operation.
    // Keep the reservation pending until provider billing is reconciled.
    if (completed?.artifact?.results?.some(({ caseFile }) => caseFile?.outcome === 'infra-stop')) {
      throw new Error('Infrastructure-stop cost requires reconciliation; manifest reservation remains pending');
    }
    const microUsd = amount(completed?.artifact?.totalUsd);
    const runId = completed?.artifact?.githubRunId;
    if (typeof runId !== 'string' || (state.pending.runId !== undefined && state.pending.runId !== runId) || !/^[1-9]\d{0,19}$/u.test(runId ?? '') || state.entries.some((entry) => entry.runId === runId)) {
      throw new Error('Manifest spend completed run id is invalid or duplicate');
    }
    state.entries.push({ caseId: options.caseId, runId, microUsd });
    state.pending = null;
    await save(path, state);
    return completed;
  } finally {
    await release();
  }
}
