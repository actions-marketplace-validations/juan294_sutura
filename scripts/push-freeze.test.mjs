import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { freezeFilePath, requireActivePushFreeze, run } from './push-freeze.mjs';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'push-freeze.mjs');

async function withTempDirectory(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-push-freeze-'));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('freeze marker resolves inside the Git common directory so every worktree shares it', async () => {
  const file = freezeFilePath({}, ROOT);
  const common = (await execFileAsync('git', ['rev-parse', '--git-common-dir'], { cwd: ROOT })).stdout.trim();
  assert.equal(file, join(resolve(ROOT, common), 'sutura-push-freeze.json'));
});

test('on, check, status, and off follow the freeze lifecycle', async () => {
  await withTempDirectory(async (directory) => {
    const file = join(directory, 'freeze.json');
    const env = { SUTURA_PUSH_FREEZE_FILE: file };
    const out = [];
    const err = [];
    const io = { env, cwd: ROOT, stdout: (line) => out.push(line), stderr: (line) => err.push(line) };

    assert.equal(run(['check'], io), 0);
    assert.equal(run(['on'], io), 2, 'on without --reason is rejected');
    assert.equal(run(['on', '--reason', 'v0.2.1 benchmark on abc123'], io), 0);
    assert.equal(existsSync(file), true);
    const state = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(state.reason, 'v0.2.1 benchmark on abc123');
    assert.match(state.startedAt, /^\d{4}-\d{2}-\d{2}T/u);

    assert.equal(run(['on', '--reason', 'second'], io), 1, 'a second freeze does not overwrite the first');
    assert.equal(run(['check'], io), 1);
    const blocked = err.at(-1);
    assert.match(blocked, /BLOCKED: push freeze on develop/u);
    assert.match(blocked, new RegExp(file.replaceAll('\\', '\\\\'), 'u'), 'message names the marker file');
    assert.match(blocked, /v0\.2\.1 benchmark on abc123/u, 'message names the cause');
    assert.match(blocked, /push-freeze\.mjs off/u);

    assert.equal(run(['status'], io), 0);
    assert.match(out.at(-1), /BLOCKED: push freeze/u);

    assert.equal(run(['off'], io), 0);
    assert.equal(existsSync(file), false);
    assert.equal(run(['check'], io), 0);
    assert.equal(run(['off'], io), 0, 'off is idempotent');
  });
});

test('paid dispatch assertion requires one valid active freeze record', async () => {
  await withTempDirectory(async (directory) => {
    const file = join(directory, 'freeze.json');
    const env = { SUTURA_PUSH_FREEZE_FILE: file };

    assert.throws(
      () => requireActivePushFreeze(env, ROOT),
      /requires an active push freeze/u,
    );

    await writeFile(file, '{not-json');
    assert.throws(
      () => requireActivePushFreeze(env, ROOT),
      /marker is malformed/u,
    );

    await writeFile(file, `${JSON.stringify({
      reason: 'v0.2.1 paid evidence',
      startedAt: '2026-09-04T10:00:00.000Z',
      by: 'WS-4',
    })}\n`);
    assert.deepEqual(requireActivePushFreeze(env, ROOT), {
      reason: 'v0.2.1 paid evidence',
      startedAt: '2026-09-04T10:00:00.000Z',
      by: 'WS-4',
    });

    await writeFile(file, `${JSON.stringify({ reason: 'missing timestamp' })}\n`);
    assert.throws(
      () => requireActivePushFreeze(env, ROOT),
      /marker is malformed/u,
    );
  });
});

test('CLI check exits 1 with the freeze message while frozen', async () => {
  await withTempDirectory(async (directory) => {
    const file = join(directory, 'freeze.json');
    const env = { ...process.env, SUTURA_PUSH_FREEZE_FILE: file };
    await execFileAsync('node', [SCRIPT, 'on', '--reason', 'cli test'], { cwd: ROOT, env });
    await assert.rejects(
      execFileAsync('node', [SCRIPT, 'check'], { cwd: ROOT, env }),
      (error) => error.code === 1 && /cli test/u.test(error.stderr),
    );
    await execFileAsync('node', [SCRIPT, 'off'], { cwd: ROOT, env });
    await execFileAsync('node', [SCRIPT, 'check'], { cwd: ROOT, env });
  });
});

test('pre-push refuses to run ci:fast while a freeze is active', async () => {
  await withTempDirectory(async (directory) => {
    const file = join(directory, 'freeze.json');
    const marker = join(directory, 'pnpm-ran.txt');
    const pnpm = join(directory, 'pnpm');
    await writeFile(pnpm, ['#!/bin/sh', 'echo ran > "$SUTURA_PNPM_MARKER"', ''].join('\n'));
    await chmod(pnpm, 0o755);
    const env = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? ''}`,
      SUTURA_PUSH_FREEZE_FILE: file,
      SUTURA_PNPM_MARKER: marker,
    };

    await execFileAsync('node', [SCRIPT, 'on', '--reason', 'hook test'], { cwd: ROOT, env });
    await assert.rejects(
      execFileAsync('sh', ['.husky/pre-push'], { cwd: ROOT, env }),
      (error) => error.code !== 0 && /BLOCKED: push freeze/u.test(error.stderr),
    );
    assert.equal(existsSync(marker), false, 'ci:fast must not start while frozen');

    await execFileAsync('node', [SCRIPT, 'off'], { cwd: ROOT, env });
    await execFileAsync('sh', ['.husky/pre-push'], { cwd: ROOT, env });
    assert.equal(existsSync(marker), true, 'ci:fast runs once the freeze ends');
  });
});
