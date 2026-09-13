/** Process-owned locks. Only a provably dead owner on this host is reclaimed.
 * Empty legacy files, foreign owners and interrupted recovery guards fail closed.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { hostname } from 'node:os';

function busy(path) {
  return Object.assign(new Error(`EEXIST: process lock is held or needs reconciliation: ${path}`), { code: 'EEXIST' });
}
async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function owner(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}
function dead(value) {
  if (!value || value.hostname !== hostname() || !Number.isSafeInteger(value.pid) || value.pid <= 0 ||
      typeof value.token !== 'string' || !value.token) return false;
  try { process.kill(value.pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
}
export async function acquireProcessLock(path) {
  const guard = `${path}.recovery`;
  if (await exists(guard)) throw busy(path);
  let handle;
  try { handle = await open(path, 'wx', 0o600); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = await owner(path);
    if (!dead(previous)) throw busy(path);
    try { await mkdir(guard, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') throw busy(path); throw error; }
    try {
      const current = await owner(path);
      if (!dead(current) || current.token !== previous.token) throw busy(path);
      await rm(path);
      handle = await open(path, 'wx', 0o600);
    } finally { await rm(guard, { recursive: true, force: true }); }
  }
  const value = { pid: process.pid, hostname: hostname(), token: randomUUID() };
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  // A concurrent recovery can only observe our live PID (or an empty file and
  // refuse). Release checks ownership so it never removes another process's lock.
  return async () => {
    if ((await owner(path))?.token !== value.token) throw busy(path);
    await rm(path);
  };
}
