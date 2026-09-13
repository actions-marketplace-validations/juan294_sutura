import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notifyMacos } from './evaluation-notify-macos.mjs';

const event = { eventId: 'event-1', manifestId: 'development-validation-v7', status: 'failed', completedCases: 14, totalCases: 80, pendingCaseId: null, recordedUsd: null, reason: 'runner-failed' };
test('macOS notifier uses static AppleScript and argv without a shell', async () => {
  const calls = [];
  await notifyMacos(event, { platform: 'darwin', exec: async (...args) => { calls.push(args); } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/usr/bin/osascript');
  assert.equal(calls[0][1][0], '-e');
  assert.ok(calls[0][1][1].includes('item 2 of argv'));
  assert.ok(!calls[0][1][1].includes(event.manifestId));
  assert.equal(calls[0][1][3], 'Sutura evaluation failed');
  assert.equal(calls[0][1][4], 'development-validation-v7: 14/80 cases recorded. Reason: runner-failed.');
  assert.equal(calls[0][2].shell, false);
});
test('notifier rejects injected payload and unsupported platform before execution', async () => {
  const exec = async () => assert.fail('must not execute');
  await assert.rejects(notifyMacos({ ...event, manifestId: 'run" & do shell script "bad' }, { platform: 'darwin', exec }), /event/);
  await assert.rejects(notifyMacos({ ...event, details: 'private' }, { platform: 'darwin', exec }), /event/);
  await assert.rejects(notifyMacos(event, { platform: 'linux', exec }), /macOS/);
});
