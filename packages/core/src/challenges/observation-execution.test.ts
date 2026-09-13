/**
 * Execution-level controls for challenge observation. These run the real
 * adapter as a process, so each control is proved by what the adapter does,
 * not by what its source text contains.
 *
 * The controls here are the ones that only appear once a probe actually runs:
 * a candidate that writes to the workspace must not change the next
 * repetition, the environment must be the fixed one rather than the one the
 * host happens to carry, and nothing the controller holds may travel into the
 * sandbox with the command.
 */
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import { parseRepositoryPolicy } from '../policy/schema.js';
import { buildObservationCommand, decodeObservation, evaluateObservation, freezeProbe, observeProbe } from './protocol.js';

const exec = promisify(execFile);
const provenance = { policyBaseSha: 'a'.repeat(40), policyHash: 'b'.repeat(64) };

function probe(contract: unknown, args: unknown[]) {
  const policy = parseRepositoryPolicy(JSON.stringify({
    version: 1, verification: { mode: 'required', contracts: [contract] },
  }));
  return freezeProbe(policy.verification!, provenance, { contractId: 'test', args });
}

function ceilingProbe() {
  return probe({
    id: 'test', kind: 'ceiling-division',
    target: { adapter: 'javascript', path: 'target.mjs', export: 'call' },
    maxItems: 100, maxDivisor: 20,
  }, [21, 10]);
}

/** A target that answers correctly once, then writes a marker and answers wrongly. */
const MUTATING_TARGET = `
import { existsSync, writeFileSync } from 'node:fs';
export const call = (items, divisor) => {
  const seen = existsSync('./seen.marker');
  writeFileSync('./seen.marker', 'x');
  return seen ? Math.floor(items / divisor) : Math.ceil(items / divisor);
};
`;

async function observeIn(dir: string, command: string, env?: Record<string, string>) {
  return exec('/bin/sh', ['-c', command], {
    cwd: dir, timeout: 20_000, ...(env === undefined ? {} : { env }),
  });
}

describe('a candidate cannot change the next repetition', () => {
  it('observes the same value twice when each repetition starts from the frozen workspace', async () => {
    const frozen = await mkdtemp(join(tmpdir(), 'sutura-frozen-workspace-'));
    try {
      await writeFile(join(frozen, 'target.mjs'), MUTATING_TARGET);
      const command = buildObservationCommand(ceilingProbe());
      const observations: number[] = [];

      for (let repetition = 1; repetition <= 2; repetition += 1) {
        const workspace = await mkdtemp(join(tmpdir(), `sutura-repetition-${repetition}-`));
        try {
          await cp(frozen, workspace, { recursive: true });
          const { stdout } = await observeIn(workspace, command);
          observations.push(decodeObservation({ stdout, stderr: '', exitCode: 0, truncated: false }) as number);
        } finally { await rm(workspace, { recursive: true, force: true }); }
      }

      expect(observations).toEqual([3, 3]);
      // The frozen workspace is untouched, so a third repetition would read the same bytes.
      await expect(readFile(join(frozen, 'seen.marker'), 'utf8')).rejects.toThrow();
    } finally { await rm(frozen, { recursive: true, force: true }); }
  }, 60_000);

  it('would observe a different value if repetitions shared one mutable workspace', async () => {
    const shared = await mkdtemp(join(tmpdir(), 'sutura-shared-workspace-'));
    try {
      await writeFile(join(shared, 'target.mjs'), MUTATING_TARGET);
      const command = buildObservationCommand(ceilingProbe());
      const observations: number[] = [];

      for (let repetition = 1; repetition <= 2; repetition += 1) {
        const { stdout } = await observeIn(shared, command);
        observations.push(decodeObservation({ stdout, stderr: '', exitCode: 0, truncated: false }) as number);
      }

      expect(observations).toEqual([3, 2]);
    } finally { await rm(shared, { recursive: true, force: true }); }
  }, 60_000);

  it('runs every repetition against the caller image, never against the previous result', async () => {
    const frozen = ceilingProbe();
    let produced = 0;
    const parents: string[] = [];
    const run = vi.fn(async (parent: string) => {
      parents.push(parent);
      produced += 1;
      return {
        imageId: `result-${produced}`, exitCode: 0, truncated: false, metrics: {},
        stdout: '{"version":1,"value":3}', stderr: '',
      };
    });

    for (let repetition = 1; repetition <= 3; repetition += 1) {
      expect(await observeProbe({ run }, 'baseline-image', frozen)).toBe(3);
    }

    expect(parents).toEqual(['baseline-image', 'baseline-image', 'baseline-image']);
  });
});

describe('the observation environment is the fixed one', () => {
  it('ignores an ambient NODE_OPTIONS that would otherwise change the process', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-fixed-env-'));
    try {
      await writeFile(join(dir, 'target.mjs'), 'export const call = (a, b) => Math.ceil(a / b);\n');
      await writeFile(join(dir, 'noisy.mjs'), "process.stdout.write('AMBIENT_PRELOAD\\n');\n");
      const command = buildObservationCommand(ceilingProbe());
      const ambient = { PATH: process.env.PATH ?? '', NODE_OPTIONS: `--import ${join(dir, 'noisy.mjs')}` };

      const leaked = await observeIn(dir, command, ambient);
      expect(leaked.stdout).toContain('AMBIENT_PRELOAD');
      expect(() => decodeObservation({ ...leaked, exitCode: 0, truncated: false })).toThrow();

      const fixed = await observeIn(dir, command, { ...ambient, NODE_OPTIONS: '' });
      expect(fixed.stdout).not.toContain('AMBIENT_PRELOAD');
      expect(decodeObservation({ ...fixed, exitCode: 0, truncated: false })).toBe(3);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 60_000);

  it('names the fixed environment and disabled network on every observation run', async () => {
    const run = vi.fn().mockResolvedValue({
      imageId: 'image', exitCode: 0, truncated: false, metrics: {},
      stdout: '{"version":1,"value":3}', stderr: '',
    });

    await observeProbe({ run }, 'image', ceilingProbe());

    const options = run.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(options.network).toBe('disabled');
    expect(options.cwd).toBe('/workspace');
    expect(options.timeoutSec).toBe(10);
    expect(options.env).toEqual({
      NODE_OPTIONS: '', NODE_PATH: '', PYTHONPATH: '', PYTHONNOUSERSITE: '1', TZ: 'UTC', LANG: 'C.UTF-8',
    });
  });
});

describe('nothing the controller holds travels with the command', () => {
  it('carries the inputs but never the expected value', () => {
    const frozen = ceilingProbe();
    const command = buildObservationCommand(frozen);
    const invocation = JSON.parse(
      Buffer.from(command.slice(command.lastIndexOf("'", command.length - 2)).replace(/'/gu, ''), 'base64')
        .toString('utf8'),
    ) as Record<string, unknown>;

    expect(invocation).toEqual({ target: frozen.invocation.target, args: [21, 10] });
    expect(Object.keys(invocation)).not.toContain('expected');
    expect(JSON.stringify(frozen)).not.toContain('"expected"');
    // The contract answers 3 for (21, 10); the sandbox is never told so.
    expect(evaluateObservation(frozen, 3)).toEqual({ status: 'passed' });
    expect(invocation.args).toEqual([21, 10]);
  });
});
