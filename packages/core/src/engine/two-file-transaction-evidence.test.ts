/**
 * A two-file repair is one transaction, so every record of it has to describe
 * the same whole: the candidate identity, the budget it charged, the audit
 * that read it, and the evidence a replay decodes. These tests hold those
 * records against each other, and against the partial patches the transaction
 * must never be confused with.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { runMechanicalChecks } from '../audit/mechanical.js';
import type { Candidate, Diagnosis, RaceResult } from '../domain.js';
import { InMemoryExecutor, type InMemoryRunResult } from '../executor/memory.js';
import { DEFAULT_MODEL_PRICES } from '../llm/cost.js';
import type { ChatMessage, ChatOptions, TierLlm } from '../llm/types.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import { decodeVerificationEvidence, encodeVerificationEvidence } from '../verification/codec.js';
import type { VerificationEvidence } from '../verification/types.js';
import { candidateIdentity, findSelectedCandidate } from './candidate-identity.js';
import { validateCandidateDiff } from './candidate-validation.js';
import { RepairBudget } from './repair-budget.js';
import { prepareControlledRepairProposalTemplate, runControlledRepairAttempt } from './repair-attempt.js';
import type { RepairSourceContext } from './repair.js';

const diagnosis: Diagnosis = {
  class: 'test-assertion', confidence: 0.98, signals: ['total is not a function'],
  failingCmd: 'pnpm test', errorExcerpt: 'expected 2 to be 3',
};

const CONSUMER = 'src/consumer.js';
const PRODUCER = 'src/totals.js';
const consumerBefore = "import { total } from './totals.js';\nexport const run = () => total(1);\n";
const consumerAfter = "import { total } from './totals.js';\nexport const run = () => total(1, 1);\n";
const producerBefore = 'export const total = (value) => value + 1;\n';
const producerAfter = 'export const total = (value, base) => value + base;\n';

const pairContext: RepairSourceContext = { sources: [
  { path: CONSUMER, startLine: 1, content: consumerBefore, truncated: false },
  { path: PRODUCER, startLine: 1, content: producerBefore, truncated: false },
] };
const singleContext: RepairSourceContext = { sources: [
  { path: PRODUCER, startLine: 1, content: producerBefore, truncated: false },
] };

/** A unified diff for one file, in the shape the sandbox reports it. */
function fileDiff(path: string, before: string, after: string): string {
  const beforeLines = before.split('\n').slice(0, -1);
  const afterLines = after.split('\n').slice(0, -1);
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    '',
  ].join('\n');
}

const consumerOnly = fileDiff(CONSUMER, consumerBefore, consumerAfter);
const producerOnly = fileDiff(PRODUCER, producerBefore, producerAfter);
const transaction = `${consumerOnly}${producerOnly}`;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function runResult(exitCode: number, stdout = ''): InMemoryRunResult {
  return { exitCode, stdout, stderr: '', truncated: false, metrics: {} };
}

function llm(reply: string): { model: TierLlm<'super'>; chat: ReturnType<typeof vi.fn> } {
  const chat = vi.fn(async (
    tier: 'super', messages: readonly ChatMessage[], options?: ChatOptions,
  ) => {
    void tier;
    void messages;
    void options;
    return { text: reply, usd: 0.01 };
  });
  return {
    chat,
    model: {
      modelQuote: vi.fn(() => ({
        role: 'super' as const, modelId: 'super', price: DEFAULT_MODEL_PRICES.super, profileId: 'test',
      })),
      chat,
    },
  };
}

const pairReply = JSON.stringify({ replacements: [
  { slot: 'slot-1', replacement: consumerAfter },
  { slot: 'slot-2', replacement: producerAfter },
] });

/**
 * The controller offers every editable source alone before it offers a pair,
 * so a two-file transaction is one of the later target sets. The search picks
 * the target set; here the test does, by naming the contract it wants.
 */
function contractFor(sourceContext: RepairSourceContext, slotCount: number) {
  const prepared = prepareControlledRepairProposalTemplate({
    diagnosis, policy: createDefaultRepositoryPolicy(), sourceContext, runtimeId: 'node',
  });
  for (let index = 0; index < prepared.targetCount; index += 1) {
    const contract = prepared.contract(undefined, index);
    if (contract.slots.length === slotCount) return contract;
  }
  throw new Error(`no target set offers ${slotCount} slots`);
}

interface AttemptOptions {
  sourceContext?: RepairSourceContext;
  reply?: string;
  budget?: RepairBudget;
  observedDiff?: string;
  signal?: AbortSignal;
}

async function attempt(options: AttemptOptions = {}) {
  const sourceContext = options.sourceContext ?? pairContext;
  const observed = options.observedDiff ?? transaction;
  const results = [runResult(0, observed), runResult(0, '1 passed')];
  const executor = new InMemoryExecutor((_command, _parent, index) => results[index] ?? runResult(0));
  const { model, chat } = llm(options.reply ?? pairReply);
  const budget = options.budget ?? new RepairBudget();
  const outcome = await runControlledRepairAttempt({
    llm: model, executor, initialImageId: 'baseline', diagnosis,
    policy: createDefaultRepositoryPolicy(),
    budget, trustedCommands: { diagnosed: 'pnpm test' },
    sourceContext,
    proposalContract: contractFor(sourceContext, sourceContext.sources.length === 1 ? 1 : 2),
    branchId: 'search-001',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return { outcome, budget, chat, executor };
}

function submittedCandidate(outcome: Awaited<ReturnType<typeof attempt>>['outcome']): Candidate {
  if (outcome.status !== 'submitted') {
    throw new Error(`expected a submitted candidate, got ${outcome.status}: ${JSON.stringify(outcome)}`);
  }
  return outcome.candidate;
}

describe('two-file transaction identity', () => {
  it('submits one candidate whose identity is the complete diff, not either half', async () => {
    const { outcome } = await attempt();
    const candidate = submittedCandidate(outcome);

    expect(candidate.diff).toContain(`diff --git a/${CONSUMER}`);
    expect(candidate.diff).toContain(`diff --git a/${PRODUCER}`);
    expect(candidateIdentity(candidate).diffHash).toBe(sha256(candidate.diff));
    expect(candidateIdentity(candidate).diffHash).not.toBe(sha256(consumerOnly));
    expect(candidateIdentity(candidate).diffHash).not.toBe(sha256(producerOnly));
  });

  it('does not accept a half of the transaction carrying the same candidate id', async () => {
    const { outcome } = await attempt();
    const candidate = submittedCandidate(outcome);
    const identity = candidateIdentity(candidate);
    const whole: RaceResult = {
      candidate, exitCode: 0, held: true, nodeId: 'n1', imageId: 'image-1',
    };
    const halved: RaceResult = { ...whole, candidate: { ...candidate, diff: consumerOnly } };

    expect(findSelectedCandidate([whole], identity)).not.toBeNull();
    expect(findSelectedCandidate([halved], identity)).toBeNull();
  });
});

describe('two-file transaction budget', () => {
  it('charges one branch and one model turn, the same as a one-file repair', async () => {
    const pair = await attempt();
    const single = await attempt({
      sourceContext: singleContext,
      reply: JSON.stringify({ replacement: producerAfter }),
      observedDiff: producerOnly,
    });

    expect(submittedCandidate(pair.outcome).diff).toContain(`diff --git a/${CONSUMER}`);
    expect(submittedCandidate(single.outcome).diff).not.toContain(`diff --git a/${CONSUMER}`);
    expect(pair.budget.snapshot().branches).toBe(1);
    expect(pair.budget.snapshot().branches).toBe(single.budget.snapshot().branches);
    expect(pair.budget.snapshot().modelTurns).toBe(single.budget.snapshot().modelTurns);
  });

  it('submits nothing when the branch budget is gone, and never asks the model', async () => {
    const spent = new RepairBudget({ branches: 1 });
    spent.reserveBranch();
    const { outcome, chat } = await attempt({ budget: spent });

    expect(outcome).toMatchObject({ status: 'gave-up', failureKind: 'budget' });
    expect(outcome).not.toHaveProperty('candidate');
    expect(chat).not.toHaveBeenCalled();
  });

  it('submits nothing when the branch is cancelled, and never asks the model', async () => {
    const controller = new AbortController();
    controller.abort();
    const { outcome, chat, budget } = await attempt({ signal: controller.signal });

    expect(outcome).toMatchObject({ status: 'gave-up' });
    expect(outcome).not.toHaveProperty('candidate');
    expect(chat).not.toHaveBeenCalled();
    expect(budget.snapshot().modelTurns).toBe(0);
  });
});

describe('two-file transaction audit', () => {
  it('reads both files as one candidate under the transaction file cap', async () => {
    const candidate = submittedCandidate((await attempt()).outcome);
    const validation = validateCandidateDiff(candidate.diff, diagnosis, createDefaultRepositoryPolicy());

    expect(validation.ok).toBe(true);
    expect(validation.changedFiles.sort()).toEqual([CONSUMER, PRODUCER]);
    expect(validation.diffBytes).toBe(Buffer.byteLength(candidate.diff, 'utf8'));
    expect(runMechanicalChecks(candidate.diff).filter((check) => !check.passed)).toEqual([]);
  });

  it('refuses a third changed path in the same transaction', async () => {
    const third = `${transaction}${fileDiff('src/extra.js', 'export const extra = 1;\n', 'export const extra = 2;\n')}`;
    expect(validateCandidateDiff(third, diagnosis, createDefaultRepositoryPolicy()).changedFiles)
      .toHaveLength(3);

    const { outcome } = await attempt({ observedDiff: third });

    expect(outcome.status).not.toBe('submitted');
    expect(JSON.stringify(outcome)).toMatch(/permits at most 2/u);
  });
});

const HASH = 'a'.repeat(64);

function evidenceFor(diffSha256: string): VerificationEvidence {
  return {
    schemaVersion: 'sutura-verification-evidence-v1',
    mode: 'local', outcome: 'repaired', assurance: 'baseline-only',
    identity: {
      sourceSha: 'b'.repeat(40), snapshotSha256: HASH,
      policyBaseSha: 'c'.repeat(40), policySha256: HASH, diffSha256,
      corpusRevision: null, fixtureRevision: null, imageDigest: `sha256:${HASH}`,
      routingVersion: 'fixed-v1', challengeVersion: 'protocol-v1',
    },
    startedAt: '2026-09-06T10:00:00.000Z', finishedAt: '2026-09-06T10:00:02.000Z',
    commands: ['pnpm test'], models: [],
    challenges: { mode: 'optional', qualifiedProbeCount: 0 },
    gates: [
      { gate: 'policy', status: 'passed', reasons: [], artifacts: [{ id: 'policy-check', sha256: HASH }] },
      { gate: 'mechanical', status: 'passed', reasons: [], artifacts: [{ id: 'mechanical', sha256: HASH }] },
      { gate: 'visible', status: 'passed', reasons: [], artifacts: [{ id: 'visible-run', sha256: HASH }] },
      { gate: 'audit', status: 'passed', reasons: [], artifacts: [{ id: 'audit', sha256: HASH }] },
      { gate: 'challenges', status: 'not-run', reasons: ['not-executed'], artifacts: [] },
    ],
    costs: {
      schemaVersion: 'sutura-verification-cost-v1', inference: [], wallTimeMs: 2_000,
      sandbox: [{ operationId: 'run-1', rawAmount: 0.2, rawUnit: null, unitSource: null, billed: null }],
    },
  };
}

describe('two-file transaction replay', () => {
  it('replays under the transaction identity and refuses either half of it', async () => {
    const candidate = submittedCandidate((await attempt()).outcome);
    const transactionSha = candidateIdentity(candidate).diffHash;
    const recorded = evidenceFor(transactionSha);
    const artifact = encodeVerificationEvidence(recorded);

    expect(decodeVerificationEvidence(artifact, recorded.identity)).toEqual(recorded);
    for (const half of [sha256(consumerOnly), sha256(producerOnly)]) {
      expect(() => decodeVerificationEvidence(artifact, { ...recorded.identity, diffSha256: half }))
        .toThrow(/identity/u);
    }
  });

  it('gives a half of the transaction a different comparison identity', () => {
    const whole = encodeVerificationEvidence(evidenceFor(sha256(transaction)));
    const half = encodeVerificationEvidence(evidenceFor(sha256(consumerOnly)));

    expect(half.normalizedComparisonSha256).not.toBe(whole.normalizedComparisonSha256);
    expect(half.integritySha256).not.toBe(whole.integritySha256);
  });
});

describe('a supplied patch obeys the same transaction cap', () => {
  /**
   * trap-two-file-third-path was approved live on 2026-09-07: a supplied
   * candidate changed three files where the transaction permits two. The cap
   * lived only in the repair tools, which a supplied patch never reaches.
   */
  const thirdPath = `${transaction}${fileDiff('package.json', '{"name":"x"}\n', '{"name":"y"}\n')}`;

  it('refuses a supplied candidate that changes a third file', async () => {
    const { policyVerdictForTest } = await import('../heal.js');
    const policy = createDefaultRepositoryPolicy();

    const twoFiles = policyVerdictForTest({ id: 'supplied', diff: transaction, rationale: 'r' }, diagnosis, policy);
    expect(twoFiles.ok).toBe(true);

    const threeFiles = policyVerdictForTest({ id: 'supplied', diff: thirdPath, rationale: 'r' }, diagnosis, policy);
    expect(threeFiles.ok).toBe(false);
    expect(threeFiles.violations.join(' ')).toMatch(/permits at most 2/u);
  });

  it('applies the cap to a supplied patch and a generated one alike', async () => {
    const { policyVerdictForTest } = await import('../heal.js');
    const policy = createDefaultRepositoryPolicy();

    // The generated path refuses it through the repair tools.
    const generated = validateCandidateDiff(thirdPath, diagnosis, policy);
    expect(generated.changedFiles).toHaveLength(3);

    // The supplied path must reach the same conclusion, not a weaker one.
    expect(policyVerdictForTest({ id: 'supplied', diff: thirdPath, rationale: 'r' }, diagnosis, policy).ok)
      .toBe(false);
  });
});
