import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import type { AuditLlm } from '../audit/audit.js';
import type { CostLedger, Diagnosis, StageEvidence } from '../domain.js';
import { BudgetExceededError } from '../engine/repair-budget.js';
import { InMemoryExecutor, type InMemoryRunResult } from '../executor/memory.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import type { RepositoryPolicy } from '../policy/schema.js';
import { TraceRecorder } from '../trace/recorder.js';
import { evaluateCounterfactuals, type CounterfactualStageLedger } from './evaluate.js';
import type { CounterfactualAlternative } from './types.js';

const VERIFICATION_COMMAND = 'pnpm test';

function diagnosis(overrides: Partial<Diagnosis> = {}): Diagnosis {
  return {
    class: 'test-assertion',
    confidence: 0.9,
    signals: ['assertion'],
    failingCmd: VERIFICATION_COMMAND,
    errorExcerpt: 'expected 2 to be 1',
    ...overrides,
  };
}

function unified(path: string, removed: string, added: string[]): string {
  return `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1,1 +1,${added.length} @@
-${removed}
${added.map((line) => `+${line}`).join('\n')}
`;
}

function alternative(
  id: string,
  intent: CounterfactualAlternative['intent'],
  diff: string,
): CounterfactualAlternative {
  return { id, intent, rationale: `Rationale for ${id}`, diff };
}

/** Decodes the diff `race()` base64-encodes into its sandbox command. */
function racedDiff(cmd: string): string | undefined {
  const match = /printf '%s' '([A-Za-z0-9+/=]+)'/u.exec(cmd);
  return match === null ? undefined : Buffer.from(match[1]!, 'base64').toString('utf8');
}

function ok(overrides: Partial<InMemoryRunResult> = {}): InMemoryRunResult {
  return {
    exitCode: 0,
    stdout: 'ok',
    stderr: '',
    truncated: false,
    metrics: { elapsedTimeSec: 2 },
    ...overrides,
  };
}

class TestLedger implements CounterfactualStageLedger {
  readonly recorded: StageEvidence[] = [];

  record(input: {
    stage: 'audit';
    attempt: number;
    result?: { exitCode: number; metrics: { elapsedTimeSec?: number } };
    note?: string;
  }): string {
    const nodeId = `node-${String(this.recorded.length + 1).padStart(3, '0')}`;
    this.recorded.push({
      stage: input.stage,
      attempt: input.attempt,
      nodeId,
      ...(input.result === undefined ? {} : { exitCode: input.result.exitCode }),
      metrics: input.result?.metrics ?? {},
      network: 'disabled',
      ...(input.note === undefined ? {} : { note: input.note }),
    });
    return nodeId;
  }

  entries(): StageEvidence[] {
    return this.recorded.map((entry) => ({ ...entry, metrics: { ...entry.metrics } }));
  }
}

function ledgerCost(entries: CostLedger['entries']): CostLedger {
  return { entries, totalUsd: () => entries.reduce((total, entry) => total + entry.usd, 0) };
}

interface Harness {
  alternatives: CounterfactualAlternative[];
  diagnosis?: Diagnosis;
  policy?: RepositoryPolicy;
  /** Maps a raced alternative diff onto its verification exit code. */
  verificationExitCode?: (diff: string) => number;
  rerunExitCode?: number;
  requiredCommandExitCode?: number;
  adjudication?: { approved: boolean; reasoning: string };
}

async function evaluate(harness: Harness) {
  const cost = ledgerCost([]);
  const ledger = new TestLedger();
  const trace = new TraceRecorder('counterfactual-test', { now: () => 0 });
  trace.record({ type: 'run-start', stage: 'run', summary: 'test' });
  let ultraCalls = 0;
  const appliedDiffs = new Map<string, string>();
  const executor = new InMemoryExecutor((cmd, parent) => {
    const raced = racedDiff(cmd);
    if (raced !== undefined) {
      appliedDiffs.set(executor.calls.at(-1)!.imageId, raced);
      return ok({ exitCode: 0 });
    }
    if (cmd === `sh -lc '${VERIFICATION_COMMAND}'`) {
      return ok({ exitCode: harness.verificationExitCode?.(appliedDiffs.get(parent) ?? '') ?? 0 });
    }
    if (cmd === VERIFICATION_COMMAND) return ok({ exitCode: harness.rerunExitCode ?? 0 });
    return ok({ exitCode: harness.requiredCommandExitCode ?? 0 });
  });
  const llm = {
    async chat() {
      ultraCalls += 1;
      const adjudication = harness.adjudication ?? {
        approved: true,
        reasoning: 'The patch repairs the diagnosed cause.',
      };
      cost.entries.push({
        role: 'ultra',
        model: 'test-ultra',
        inTok: 100,
        outTok: 20,
        reasoningTok: 0,
        usd: 0.01,
      });
      return { text: JSON.stringify(adjudication), model: 'test-ultra' };
    },
  } as unknown as AuditLlm;

  const evidence = await evaluateCounterfactuals({
    executor,
    llm,
    baselineImageId: 'baseline',
    diagnosis: harness.diagnosis ?? diagnosis(),
    policy: harness.policy ?? createDefaultRepositoryPolicy(),
    beforeLog: 'FAIL src/cart.test.ts',
    verificationCommand: VERIFICATION_COMMAND,
    diffBytesLimit: 20_000,
    alternatives: harness.alternatives,
    acceptedCandidateId: 'accepted-1',
    cost,
    ledger,
    trace,
  });
  return { evidence, ledger, trace, cost, ultraCalls };
}

const LOOSENED_TYPE = alternative(
  'loosen-type',
  'shortcut',
  unified('src/cart.ts', 'const total = pages(items);', ['const total = pages(items) as any;']),
);
const CORRECT = alternative(
  'exact-boundary',
  'plausible',
  unified('src/cart.ts', 'const total = pages(items);', ['const total = pages(items) - 1;']),
);
const WRONG = alternative(
  'wrong-boundary',
  'plausible',
  unified('src/cart.ts', 'const total = pages(items);', ['const total = pages(items) + 1;']),
);

describe('counterfactual gate evaluation', () => {
  it('preserves completed alternatives and marks shared-budget exhaustion as insufficient', async () => {
    let races = 0;
    const evidence = await evaluate({
      alternatives: [{ ...CORRECT, id: 'first' }, { ...CORRECT, id: 'second' }, { ...CORRECT, id: 'third' }],
      verificationExitCode: () => { if (++races === 2) throw new BudgetExceededError('sandboxOperations'); return 1; },
    });
    expect(evidence.evidence).toMatchObject({ status: 'insufficient', reason: 'budget-exhausted' });
    expect(evidence.evidence.alternatives.map(({ id }) => id)).toEqual(['first']);
    expect(races).toBe(2);
    expect(evidence.evidence.cost.sandboxOperations).toBe(1);
  });

  it('rejects a type-loosening shortcut at the mechanical gate without any model call', async () => {
    const { evidence, ultraCalls } = await evaluate({
      alternatives: [LOOSENED_TYPE, WRONG],
      verificationExitCode: (diff) => (diff.includes('as any') ? 0 : 1),
    });

    const [shortcut] = evidence.alternatives;
    expect(shortcut?.approved).toBe(false);
    expect(shortcut?.rejectedBy).toEqual({
      gate: 'mechanical',
      rule: 'loosened-type',
      evidence: expect.stringContaining('as any'),
    });
    expect(shortcut?.cost.inferenceUsd).toBe(0);
    expect(ultraCalls).toBe(0);
  });

  it('rejects a patch that touches a test file at the patch-policy gate', async () => {
    const shortcut = alternative(
      'drop-regression',
      'shortcut',
      unified('src/cart.test.ts', "  expect(pages(items)).toBe(2);", ['  expect(true).toBe(true);']),
    );
    const { evidence, ledger } = await evaluate({ alternatives: [shortcut, WRONG] });

    expect(evidence.alternatives[0]?.rejectedBy).toEqual({
      gate: 'patch-policy',
      rule: 'touches test file: src/cart.test.ts',
      evidence: 'touches test file: src/cart.test.ts',
    });
    expect(evidence.alternatives[0]?.cost.sandboxOperations).toBe(0);
    expect(ledger.recorded[0]?.note).toContain('refused before execution');
  });

  it('rejects a test assertion deletion before execution even when the diagnosis is a test bug', async () => {
    const shortcut = alternative(
      'delete-regression',
      'shortcut',
      `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1,3 +1,1 @@
-it('paginates an exact boundary', () => {
-  expect(pages(items)).toBe(2);
-});
+const skipped = true;
`,
    );
    const { evidence } = await evaluate({
      alternatives: [shortcut, WRONG],
      diagnosis: diagnosis({ class: 'test-bug' }),
      verificationExitCode: (diff) => (diff.includes('+ 1') ? 1 : 0),
    });

    expect(evidence.alternatives[0]?.rejectedBy?.gate).toBe('patch-policy');
    expect(evidence.alternatives[0]?.rejectedBy?.rule).toBe('touches test file: src/cart.test.ts');
    expect(evidence.cost.inferenceUsd).toBe(0);
  });

  it('rejects a plausible but wrong patch at the verification gate', async () => {
    const { evidence, ultraCalls } = await evaluate({
      alternatives: [LOOSENED_TYPE, WRONG],
      verificationExitCode: (diff) => (diff.includes('+ 1') ? 1 : 0),
    });

    const wrong = evidence.alternatives.find(({ id }) => id === WRONG.id);
    expect(wrong?.approved).toBe(false);
    expect(wrong?.testExitCode).toBe(1);
    expect(wrong?.rejectedBy).toEqual({
      gate: 'verification',
      rule: 'verification-command',
      evidence: 'The diagnosed verification command exited 1',
    });
    expect(ultraCalls).toBe(0);
  });

  it('rejects a patch whose fresh suite rerun fails at the suite-rerun gate', async () => {
    const { evidence, ultraCalls } = await evaluate({
      alternatives: [LOOSENED_TYPE, CORRECT],
      rerunExitCode: 1,
    });

    const correct = evidence.alternatives.find(({ id }) => id === CORRECT.id);
    expect(correct?.rejectedBy).toEqual({
      gate: 'suite-rerun',
      rule: 'fresh-suite-rerun',
      evidence: expect.stringContaining('fresh suite rerun exited 1'),
    });
    expect(ultraCalls).toBe(0);
  });

  it('records an adjudication refusal at the adjudication gate', async () => {
    const { evidence, ultraCalls } = await evaluate({
      alternatives: [LOOSENED_TYPE, CORRECT],
      adjudication: { approved: false, reasoning: 'REFUSED: repairs a different bug.' },
    });

    const correct = evidence.alternatives.find(({ id }) => id === CORRECT.id);
    expect(correct?.rejectedBy).toEqual({
      gate: 'adjudication',
      rule: 'llm-adjudication',
      evidence: 'REFUSED: repairs a different bug.',
    });
    expect(correct?.cost.inferenceUsd).toBeCloseTo(0.01, 10);
    expect(ultraCalls).toBe(1);
  });

  it('records a repository policy refusal at the repository-policy gate', async () => {
    const policy: RepositoryPolicy = {
      ...createDefaultRepositoryPolicy(),
      requiredCommands: ['pnpm lint'],
    };
    const { evidence } = await evaluate({
      alternatives: [LOOSENED_TYPE, CORRECT],
      policy,
      requiredCommandExitCode: 3,
    });

    const correct = evidence.alternatives.find(({ id }) => id === CORRECT.id);
    expect(correct?.rejectedBy).toEqual({
      gate: 'repository-policy',
      rule: 'policy-required-command',
      evidence: 'required command 1 exited 3',
    });
  });

  it('approves an alternative that passes every gate and reports it beside the accepted patch', async () => {
    const { evidence } = await evaluate({ alternatives: [LOOSENED_TYPE, CORRECT] });

    expect(evidence.acceptedCandidateId).toBe('accepted-1');
    const correct = evidence.alternatives.find(({ id }) => id === CORRECT.id);
    expect(correct?.approved).toBe(true);
    expect(correct?.rejectedBy).toBeUndefined();
    expect(correct?.checks.some(({ name, passed }) => name === 'llm-adjudication' && passed))
      .toBe(true);
  });

  it('measures added cost, latency, and sandbox operations per alternative and in total', async () => {
    const { evidence } = await evaluate({ alternatives: [LOOSENED_TYPE, CORRECT] });

    const [shortcut, correct] = evidence.alternatives;
    expect(shortcut?.cost).toEqual({
      inferenceUsd: 0,
      sandboxOperations: 1,
      elapsedTimeSec: 2,
    });
    expect(correct?.cost.sandboxOperations).toBe(2);
    expect(correct?.cost.elapsedTimeSec).toBe(4);
    expect(evidence.cost).toEqual({
      inferenceUsd: correct!.cost.inferenceUsd,
      sandboxOperations: 3,
      elapsedTimeSec: 6,
    });
  });

  it('records one sanitized trace event per alternative carrying no patch body', async () => {
    const { trace, evidence } = await evaluate({ alternatives: [LOOSENED_TYPE, CORRECT] });

    const events = trace.events().filter((event) => event.type === 'counterfactual-result');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      alternativeId: LOOSENED_TYPE.id,
      intent: 'shortcut',
      approved: false,
      gate: 'mechanical',
      rule: 'loosened-type',
    });
    expect(events[1]).toMatchObject({ alternativeId: CORRECT.id, approved: true, gate: '', rule: '' });
    const serialized = JSON.stringify(events);
    for (const item of evidence.alternatives) {
      expect(serialized).not.toContain(item.diffHash.slice(0, 32));
    }
    expect(serialized).not.toContain('diff --git');
  });
});
