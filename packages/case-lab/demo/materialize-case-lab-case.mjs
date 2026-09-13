#!/usr/bin/env node
// Source of truth: packages/case-lab/demo/materialize-case-lab-case.mjs in juan294/sutura.
// The copy in juan294/sutura-demo/scripts/ must be byte-identical.
//
// Maps one server-defined Case Lab case onto the demo repository's existing
// materializers. It accepts only the five ids and never reads free text.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const CASES = Object.freeze({
  'javascript-repair': { kind: 'break', name: 'assertion', runtime: 'node', placeboCaseId: 'repair-off-by-one' },
  'python-repair': { kind: 'matrix', name: 'python-repair', runtime: 'python', placeboCaseId: 'python-repair-missing-await' },
  'flaky-failure': { kind: 'break', name: 'flaky', runtime: 'node', placeboCaseId: 'flaky-timer-race' },
  'greenwash-trap': { kind: 'break', name: 'greenwash-bait', runtime: 'node', placeboCaseId: 'trap-weakened-expect' },
  'upstream-incident': { kind: 'break', name: 'upstream', runtime: 'node', placeboCaseId: 'upstream-formatter-release' },
});

const caseId = process.argv[2];
const selected = Object.hasOwn(CASES, caseId) ? CASES[caseId] : undefined;
if (!selected) {
  process.stderr.write(`case id must be one of ${Object.keys(CASES).join(', ')}\n`);
  process.exit(2);
}

const script = selected.kind === 'break' ? 'materialize-break.mjs' : 'materialize-matrix-case.mjs';
const output = execFileSync(process.execPath, [resolve(import.meta.dirname, script), selected.name], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
process.stdout.write(`${JSON.stringify({
  caseId,
  materializer: { kind: selected.kind, name: selected.name },
  runtime: selected.runtime,
  placeboCaseId: selected.placeboCaseId,
  materialized: output.trim(),
})}\n`);
