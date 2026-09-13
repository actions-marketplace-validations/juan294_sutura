/**
 * Sandbox-backed verification of a supplied patch.
 *
 * These tests drive the real preparation, reproduction and apply-and-run path
 * against an in-memory sandbox, so what is asserted is the sequence of
 * commands the route issues and the observations it derives from their
 * results.
 */
import { describe, expect, it } from 'vitest';

import { InMemoryExecutor, type InMemoryRunResult } from './executor/memory.js';
import { createDefaultRepositoryPolicy } from './policy/load.js';
import { evaluateVerification } from './verification/evaluate.js';
import { validateVerifyRequest, type VerifyRequest } from './verify.js';
import {
  applyAndRun,
  prepareAndReproduce,
  sandboxVerificationGates,
  VERIFY_REPRODUCTION_RUNS,
} from './verify-execution.js';

const SOURCE_SHA = 'a'.repeat(40);
const POLICY_SHA = 'b'.repeat(40);
const TRUSTED = { diagnosed: 'pnpm test' };

const DIFF = [
  'diff --git a/page-count.js b/page-count.js',
  '--- a/page-count.js',
  '+++ b/page-count.js',
  '@@ -1 +1 @@',
  '-export const pages = (n, per) => Math.floor(n / per);',
  '+export const pages = (n, per) => Math.ceil(n / per);',
  '',
].join('\n');

function request(overrides: Partial<VerifyRequest> = {}) {
  return validateVerifyRequest({
    caseDir: '/tmp/checkout',
    sourceSha: SOURCE_SHA,
    policyBaseSha: POLICY_SHA,
    candidateDiff: DIFF,
    failureCommandId: 'diagnosed',
    ...overrides,
  }, createDefaultRepositoryPolicy(), TRUSTED);
}

function result(exitCode: number, stdout = '', stderr = ''): InMemoryRunResult {
  return { exitCode, stdout, stderr, truncated: false, metrics: {} };
}

/**
 * Answers preparation commands successfully and everything else from the
 * script, so a test only has to describe the runs it cares about.
 */
function sandbox(script: (cmd: string, index: number) => InMemoryRunResult | undefined) {
  return new InMemoryExecutor((cmd, _parent, index) => script(cmd, index) ?? result(0));
}


const ports = (executor: InMemoryExecutor) => ({ executor, sourceDir: '/tmp/source' });

/** Fails the first `VERIFY_REPRODUCTION_RUNS` observations, then passes: the shape of a real repair. */
function repairedByTheCandidate(): InMemoryExecutor {
  let observed = 0;
  return sandbox((cmd) => {
    if (cmd !== 'pnpm test') return undefined;
    observed += 1;
    return result(observed <= VERIFY_REPRODUCTION_RUNS ? 1 : 0);
  });
}

function testRuns(executor: InMemoryExecutor): string[] {
  return executor.calls.filter((call) => call.kind === 'run').map((call) => call.cmd);
}

describe('preparation and reproduction', () => {
  it('reproduces the failure on the untouched baseline before anything is applied', async () => {
    const executor = sandbox((cmd) => (cmd === 'pnpm test' ? result(1, '1 failed') : undefined));

    const reproduction = await prepareAndReproduce(request(), ports(executor));

    expect(reproduction.status).toBe('reproduced');
    expect(reproduction.exitCodes).toHaveLength(VERIFY_REPRODUCTION_RUNS);
    expect(reproduction.baselineImage).toBeDefined();
    expect(testRuns(executor).filter((cmd) => cmd === 'pnpm test')).toHaveLength(VERIFY_REPRODUCTION_RUNS);
    expect(testRuns(executor).some((cmd) => cmd.includes('git apply'))).toBe(false);
  });

  it('reports a baseline that already passes rather than crediting the patch', async () => {
    const executor = sandbox(() => result(0));

    const reproduction = await prepareAndReproduce(request(), ports(executor));

    expect(reproduction.status).toBe('baseline-passes');
    expect(reproduction.exitCodes).toEqual([0, 0]);
  });

  it('reports an intermittent baseline as its own status', async () => {
    let seen = 0;
    const executor = sandbox((cmd) => {
      if (cmd !== 'pnpm test') return undefined;
      seen += 1;
      return result(seen === 1 ? 1 : 0);
    });

    expect((await prepareAndReproduce(request(), ports(executor))).status).toBe('intermittent');
  });

  it('stops on infrastructure rather than reporting a verdict', async () => {
    const executor = new InMemoryExecutor((cmd) => {
      if (cmd === 'pnpm test') throw new Error('sandbox unavailable');
      return result(0);
    });

    const reproduction = await prepareAndReproduce(request(), ports(executor));

    expect(reproduction.status).toBe('infra-stop');
    expect(reproduction.failedCommand).toBe('pnpm test');
  });
});

describe('applying the supplied patch', () => {
  it('applies the patch to the baseline and reruns the failing command', async () => {
    const executor = sandbox((cmd) => (cmd === 'pnpm test' ? result(0, '1 passed') : undefined));

    const visible = await applyAndRun(request(), 'baseline-image', ports(executor));

    expect(visible.status).toBe('passed');
    expect(visible.applyExitCode).toBe(0);
    expect(visible.testExitCode).toBe(0);
    const runs = executor.calls.filter((call) => call.kind === 'run');
    expect(runs[0]!.cmd).toContain('git apply');
    expect(runs[0]!.parent).toBe('baseline-image');
    expect(runs[1]!.cmd).toBe('pnpm test');
    expect(runs[1]!.parent).toBe(runs[0]!.imageId);
  });

  it('treats a patch that does not apply as invalid input, and never runs the command', async () => {
    const executor = sandbox((cmd) => (cmd.includes('git apply') ? result(1, '', 'patch does not apply') : undefined));

    const visible = await applyAndRun(request(), 'baseline-image', ports(executor));

    expect(visible.status).toBe('not-applicable');
    expect(visible.testExitCode).toBeNull();
    expect(testRuns(executor)).toHaveLength(1);
  });

  it('records a patch that applies but leaves the command failing', async () => {
    const executor = sandbox((cmd) => (cmd === 'pnpm test' ? result(1, '1 failed') : undefined));

    expect((await applyAndRun(request(), 'baseline-image', ports(executor))).status).toBe('failed');
  });
});

describe('the shared gate stack over real execution', () => {
  async function evaluate(executor: InMemoryExecutor, challengeMode: 'required' | 'optional' = 'required') {
    const gates = await sandboxVerificationGates(request(), ports(executor));
    return {
      gates,
      outcome: await evaluateVerification({ challengeMode, runGate: gates.runGate }),
    };
  }

  it('passes reproduction, policy, mechanical and visible, then abstains on the missing audit', async () => {
    const executor = repairedByTheCandidate();

    const { outcome } = await evaluate(executor);
    const status = new Map(outcome.observations.map((item) => [item.gate, item.status]));

    expect(status.get('reproduction')).toBe('passed');
    expect(status.get('policy')).toBe('passed');
    expect(status.get('mechanical')).toBe('passed');
    expect(status.get('visible')).toBe('passed');
    expect(status.get('audit')).toBe('not-run');
    // A gate that did not happen is missing evidence, not a verdict against the patch.
    expect(outcome.status).toBe('insufficient');
    expect(outcome.blockingGate).toBe('audit');
    expect(outcome.challengeAssurance).toBe(false);
  });

  it('never runs the patch when the baseline did not reproduce', async () => {
    const executor = sandbox(() => result(0));

    const { gates, outcome } = await evaluate(executor);

    expect(gates.visible).toBeNull();
    expect(outcome.blockingGate).toBe('reproduction');
    expect(testRuns(executor).some((cmd) => cmd.includes('git apply'))).toBe(false);
    const status = new Map(outcome.observations.map((item) => [item.gate, item.status]));
    expect(status.get('visible')).toBe('not-run');
  });

  it('takes a delegated audit observation and refuses when it refuses', async () => {
    const executor = repairedByTheCandidate();
    const gates = await sandboxVerificationGates(request(), ports(executor), {
      audit: () => ({ status: 'failed', reasons: ['audit-refused'] }),
    });

    const outcome = await evaluateVerification({ challengeMode: 'required', runGate: gates.runGate });

    expect(outcome.status).toBe('failed');
    expect(outcome.blockingGate).toBe('audit');
  });

  it('stops at reproduction on infrastructure without claiming a refusal', async () => {
    const executor = new InMemoryExecutor((cmd) => {
      if (cmd === 'pnpm test') throw new Error('sandbox unavailable');
      return result(0);
    });

    const { outcome } = await evaluate(executor);

    expect(outcome.status).toBe('infra-stop');
    expect(outcome.blockingGate).toBe('reproduction');
  });
});
