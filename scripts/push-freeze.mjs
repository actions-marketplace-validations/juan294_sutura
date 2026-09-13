#!/usr/bin/env node
// Push freeze for the shared `develop` integration branch.
//
// A paid live run (Placebo benchmark, external matrix) requires the controller
// SHA to equal `origin/develop` HEAD at every case dispatch. While such a run is
// in progress, no worktree may push. The freeze marker lives in the Git common
// directory, so every worktree of this repository sees the same state.
//
//   node scripts/push-freeze.mjs on --reason "<why>"   start a freeze
//   node scripts/push-freeze.mjs off                     end the freeze
//   node scripts/push-freeze.mjs status                  print the state
//   node scripts/push-freeze.mjs check                   exit 1 when frozen (used by .husky/pre-push)
//
// Set SUTURA_PUSH_FREEZE_FILE to override the marker path (tests only).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export function freezeFilePath(env = process.env, cwd = process.cwd()) {
  const override = env.SUTURA_PUSH_FREEZE_FILE;
  if (override) return resolve(cwd, override);
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
  return join(isAbsolute(common) ? common : resolve(cwd, common), 'sutura-push-freeze.json');
}

export function readFreeze(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { reason: 'unreadable freeze marker', startedAt: null, by: null };
  }
}

export function requireActivePushFreeze(env = process.env, cwd = process.cwd()) {
  const file = freezeFilePath(env, cwd);
  if (!existsSync(file)) {
    throw new Error(`Paid live dispatch requires an active push freeze (${file})`);
  }
  let state;
  try {
    state = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`Active push freeze marker is malformed (${file})`);
  }
  const startedAt = typeof state?.startedAt === 'string' ? new Date(state.startedAt) : null;
  if (state === null || typeof state !== 'object' || Array.isArray(state) ||
      typeof state.reason !== 'string' || state.reason.trim().length === 0 ||
      state.reason.length > 500 || startedAt === null || Number.isNaN(startedAt.valueOf()) ||
      startedAt.toISOString() !== state.startedAt ||
      (state.by !== null && (typeof state.by !== 'string' || state.by.length > 200))) {
    throw new Error(`Active push freeze marker is malformed (${file})`);
  }
  return state;
}

function gitUser(cwd) {
  try {
    return execFileSync('git', ['config', 'user.name'], { cwd, encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

export function freezeMessage(file, state) {
  return [
    `BLOCKED: push freeze on develop (${file})`,
    `Reason: ${state.reason ?? 'not recorded'}`,
    `Since: ${state.startedAt ?? 'unknown'}${state.by ? ` by ${state.by}` : ''}`,
    'A paid live run binds every dispatch to origin/develop HEAD. Keep committing in your worktree and push after the freeze ends.',
    'Do not bypass with --no-verify. The owner ends the freeze with: node scripts/push-freeze.mjs off',
  ].join('\n');
}

export function run(argv, { env = process.env, cwd = process.cwd(), stdout = console.log, stderr = console.error } = {}) {
  const [command, ...rest] = argv;
  const file = freezeFilePath(env, cwd);
  const state = readFreeze(file);

  switch (command) {
    case 'on': {
      const index = rest.indexOf('--reason');
      const reason = index >= 0 ? rest[index + 1] : undefined;
      if (!reason) {
        stderr('push-freeze on requires --reason "<why>"');
        return 2;
      }
      if (state) {
        stderr(`A freeze is already active (${file}): ${state.reason}`);
        return 1;
      }
      writeFileSync(file, `${JSON.stringify({ reason, startedAt: new Date().toISOString(), by: gitUser(cwd) }, null, 2)}\n`);
      stdout(`Push freeze ON (${file}): ${reason}`);
      return 0;
    }
    case 'off': {
      if (!state) {
        stdout(`No push freeze active (${file})`);
        return 0;
      }
      rmSync(file, { force: true });
      stdout(`Push freeze OFF (${file})`);
      return 0;
    }
    case 'status': {
      stdout(state ? freezeMessage(file, state) : `No push freeze active (${file})`);
      return 0;
    }
    case 'check': {
      if (!state) return 0;
      stderr(freezeMessage(file, state));
      return 1;
    }
    default:
      stderr('Usage: push-freeze.mjs on --reason "<why>" | off | status | check');
      return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  process.exitCode = run(process.argv.slice(2));
}
