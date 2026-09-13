#!/usr/bin/env node
/** Optional local macOS transport; successful exit is not proof of display. */
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { validateEvent } from './evaluation-alerts.mjs';

const program = 'on run argv\n display notification (item 2 of argv) with title (item 1 of argv)\nend run';
export async function notifyMacos(input, { platform = process.platform, exec = promisify(execFile) } = {}) {
  const event = validateEvent(input);
  if (platform !== 'darwin') throw new Error('Evaluation notification requires macOS');
  const title = `Sutura evaluation ${event.status}`;
  const progress = event.reason === 'progress-unavailable' ? 'progress unavailable' : `${event.completedCases}/${event.totalCases} cases recorded`;
  const body = `${event.manifestId}: ${progress}. Reason: ${event.reason}.`;
  await exec('/usr/bin/osascript', ['-e', program, '--', title, body], { shell: false, timeout: 5000, maxBuffer: 4096 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 16_384) throw new Error('Oversized notification');
      chunks.push(chunk);
    }
    await notifyMacos(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch {
    // Avoid copying child-process errors or untrusted payloads into diagnostics.
    process.stderr.write('Evaluation macOS notification failed.\n');
    process.exitCode = 1;
  }
}
