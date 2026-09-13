import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { acquireProcessLock } from './live-process-lock.mjs';

test('a killed owner can be reclaimed but a live owner cannot', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'live-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'lock');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { acquireProcessLock } from ${JSON.stringify(new URL('./live-process-lock.mjs', import.meta.url).href)}; await acquireProcessLock(process.argv[1]); process.stdout.write('ready'); setInterval(()=>{},1000);`, path], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  await once(child.stdout, 'data');
  await assert.rejects(acquireProcessLock(path), /EEXIST/);
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  const release = await acquireProcessLock(path);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).pid, process.pid);
  await assert.rejects(acquireProcessLock(path), /EEXIST/);
  await release();
});

test('unknown, foreign and legacy lock owners fail closed', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'live-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'lock');
  for (const text of ['', '{}', JSON.stringify({ pid: process.pid, hostname: `${hostname()}-foreign`, token: 'x' })]) {
    await writeFile(path, text);
    await assert.rejects(acquireProcessLock(path), /EEXIST/);
    assert.equal(await readFile(path, 'utf8'), text);
  }
});
