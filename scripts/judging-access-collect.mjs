import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkArtifact, checkJudgingAccess, JudgingAccessError } from './judging-access.mjs';

const MAX_BYTES = 16 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const refuse = (code, text) => { throw new JudgingAccessError(code, text); };

function validateArtifact(artifact, now) {
  if (!artifact || typeof artifact !== 'object') refuse('invalid-artifact', 'Artifact must be an object');
  const method = artifact.method ?? 'GET';
  // Reuse the pure protocol's exact method, pin, hash and expiry validation.
  checkArtifact({ ...artifact, method, status: 200, servedPin: artifact.expectedPin, servedResultHash: artifact.expectedResultHash }, now);
  let url;
  try { url = new URL(artifact.url); } catch { refuse('invalid-url', 'Artifact needs a public HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) refuse('invalid-url', 'Artifact needs a public HTTPS URL without credentials or fragment');
  if (method !== 'GET' && (artifact.expectedPin !== undefined || artifact.expectedResultHash !== undefined)) refuse('unobserved-identity', 'Pin and archive integrity checks require GET bytes');
  if (artifact.expectedPin !== undefined && (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(artifact.pinField ?? '') || ['constructor', 'prototype', '__proto__'].includes(artifact.pinField))) refuse('invalid-pin-field', 'Pinned JSON artifact needs an explicit top-level pinField');
  return { ...artifact, method, url: url.href };
}

async function readBounded(response, maximum) {
  if (Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel();
    throw new JudgingAccessError('body-limit', 'Response exceeds byte limit');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new JudgingAccessError('body-limit', 'Response exceeds byte limit');
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Collect actual anonymous HTTP observations; never dispatch a run or attach credentials. */
export async function collectJudgingAccess(manifest, options = {}) {
  const now = options.now ?? new Date();
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TIMEOUT_MS) refuse('invalid-limit', 'Read limits may only be lowered');
  if (!Array.isArray(manifest?.artifacts) || !manifest.artifacts.length || manifest.artifacts.length > 32) refuse('no-artifacts', 'Manifest needs 1 to 32 actual public artifacts');
  const artifacts = manifest.artifacts.map(artifact => validateArtifact(artifact, now));
  if (new Set(artifacts.map(artifact => artifact.name)).size !== artifacts.length) refuse('duplicate-artifact', 'Artifact names must be unique');
  const fetcher = options.fetch ?? globalThis.fetch;
  const observations = [];
  for (const artifact of artifacts) {
    const controller = new AbortController();
    let timer;
    let errorCode = 'transport-error';
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { errorCode = 'timeout'; controller.abort(); reject(new Error('timeout')); }, timeoutMs);
      });
      const collected = await Promise.race([timeout, (async () => {
        const response = await fetcher(artifact.url, { method: artifact.method, redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { Accept: '*/*' }, signal: controller.signal });
        if (controller.signal.aborted) {
          await response.body?.cancel().catch(() => {});
          throw new Error('timeout');
        }
        const bytes = artifact.method === 'HEAD' ? null : await readBounded(response, maxBytes);
        if (controller.signal.aborted) throw new Error('timeout');
        let servedPin;
        if (artifact.pinField && bytes !== null) {
          try {
            const parsed = JSON.parse(bytes.toString('utf8'));
            if (parsed && Object.hasOwn(parsed, artifact.pinField) && typeof parsed[artifact.pinField] === 'string') servedPin = parsed[artifact.pinField];
          } catch { /* A non-JSON response cannot establish the declared pin. */ }
        }
        const servedResultHash = bytes === null ? undefined : digest(bytes);
        return { bytes, observation: { name: artifact.name, url: artifact.url, method: artifact.method, status: response.status,
          ...(artifact.expectedPin === undefined ? {} : { expectedPin: artifact.expectedPin, servedPin }),
          ...(artifact.expectedResultHash === undefined ? {} : { expectedResultHash: artifact.expectedResultHash }),
          ...(servedResultHash === undefined ? {} : { servedResultHash, bytes: bytes.length }),
          ...(artifact.expiresAt === undefined ? {} : { expiresAt: artifact.expiresAt }),
        } };
      })()]);
      // Only the transport worker that won the deadline can retain bytes.
      // A late fetch may still settle, but it has no archive-writing capability.
      clearTimeout(timer);
      if (controller.signal.aborted) throw new Error('timeout');
      const { observation, bytes } = collected;
      if (bytes !== null && observation.status === 200 && options.archiveDir) {
        await mkdir(options.archiveDir, { recursive: true });
        const path = resolve(options.archiveDir, `${observation.servedResultHash}.bin`);
        await writeFile(path, bytes, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        const retained = await readFile(path);
        if (digest(retained) !== observation.servedResultHash) throw new JudgingAccessError('archive-mismatch', 'Existing archive bytes do not match their digest');
      }
      observations.push(observation);
    } catch (error) {
      observations.push({ name: artifact.name, url: artifact.url, method: artifact.method, status: 0, error: error instanceof JudgingAccessError ? error.reasonCode : errorCode });
    } finally { clearTimeout(timer); controller.abort(); }
  }
  try {
    return { ...checkJudgingAccess({ ...manifest, now, artifacts: observations }), observations };
  } catch (error) {
    if (!(error instanceof JudgingAccessError) || error.reasonCode !== 'no-usable-path') throw error;
    const results = observations.map(observation => checkArtifact(observation, now));
    return {
      checkedAt: now.toISOString(), available: false, reasonCode: error.reasonCode,
      artifacts: results,
      unavailable: results.filter(result => !result.available).map(({ name, reason }) => ({ name, reason })),
      servedPath: 'unavailable', observations,
    };
  }
}

async function main(args) {
  if (args.length !== 2) throw new Error('Usage: node scripts/judging-access-collect.mjs <manifest.json> <new-output-directory>');
  const manifest = JSON.parse(await readFile(args[0], 'utf8'));
  const output = resolve(args[1]);
  await mkdir(output); // A dated record is never silently overwritten.
  const report = await collectJudgingAccess(manifest, { archiveDir: resolve(output, 'artifacts') });
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.available) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
