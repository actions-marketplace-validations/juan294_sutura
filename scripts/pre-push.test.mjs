import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');

test('pre-push clears repository-local Git variables before running tests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-pre-push-'));
  const output = join(directory, 'environment.txt');
  const pnpm = join(directory, 'pnpm');
  const localVariables = (await execFileAsync(
    'git',
    ['rev-parse', '--local-env-vars'],
    { cwd: ROOT },
  )).stdout.trim().split('\n').filter(Boolean);

  try {
    await writeFile(pnpm, [
      '#!/bin/sh',
      'env > "$SUTURA_PRE_PUSH_ENV_OUTPUT"',
      '',
    ].join('\n'));
    await chmod(pnpm, 0o755);

    const environment = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? ''}`,
      SUTURA_PRE_PUSH_ENV_OUTPUT: output,
      // The hook checks the real freeze marker; a live run in progress must not fail this test.
      SUTURA_PUSH_FREEZE_FILE: join(directory, 'no-freeze.json'),
      GIT_PAGER: 'cat',
    };
    for (const name of localVariables) environment[name] = `/sentinel/${name}`;

    await execFileAsync('sh', ['.husky/pre-push'], { cwd: ROOT, env: environment });

    const captured = await readFile(output, 'utf8');
    const capturedNames = new Set(captured.split('\n').map((line) => line.split('=', 1)[0]));
    for (const name of localVariables) {
      assert.equal(capturedNames.has(name), false, name);
    }
    assert.match(captured, /^GIT_PAGER=cat$/mu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
