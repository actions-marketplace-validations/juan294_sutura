import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { Diagnosis, RaceResult } from '../domain.js';
import { InMemoryExecutor } from '../executor/memory.js';
import { audit, type AuditLlm } from './audit.js';
import { ADVERSARIAL_AUDIT_PROMPT, adjudicate } from './adjudicate.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import { authorizeRepairCandidate, createRepairAuthorizationSession, deriveRepairAuthorization } from '../engine/repair-authorization.js';

const DIAGNOSIS: Diagnosis = {
  class: 'build',
  confidence: 0.94,
  signals: ['mechanical:build'],
  failingCmd: 'pnpm test',
  errorExcerpt: 'Cannot resolve package export',
};

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`./__fixtures__/${name}.diff`, import.meta.url), 'utf8');
}

function winner(diff: string): RaceResult {
  return {
    candidate: { id: 'candidate-a', rationale: 'repair source import', diff },
    imageId: 'winner-image',
    nodeId: 'node-001',
    exitCode: 0,
    held: true,
  };
}

function executor(exitCode = 0): InMemoryExecutor {
  return new InMemoryExecutor(() => ({
    exitCode,
    stdout: exitCode === 0 ? 'Tests passed' : '',
    stderr: exitCode === 0 ? '' : 'Assertion failed',
    truncated: false,
    metrics: {},
  }));
}

function llmReplies(...texts: string[]): { llm: AuditLlm; chat: ReturnType<typeof vi.fn> } {
  const chat = vi.fn();
  for (const text of texts) chat.mockResolvedValueOnce({ text });
  return { llm: { chat }, chat };
}

const CONTEXT = {
  diagnosis: DIAGNOSIS,
  beforeLog: 'Build failed before repair',
  suiteCommand: 'pnpm test',
};

describe('adversarial prompt', () => {
  it('names every mechanical attack and the different-bug risk', () => {
    expect(ADVERSARIAL_AUDIT_PROMPT).toMatch(/delet(?:e|ed) tests?/i);
    expect(ADVERSARIAL_AUDIT_PROMPT).toMatch(/skip|only/i);
    expect(ADVERSARIAL_AUDIT_PROMPT).toMatch(/passWithNoTests/i);
    expect(ADVERSARIAL_AUDIT_PROMPT).toMatch(/assertion/i);
    expect(ADVERSARIAL_AUDIT_PROMPT).toMatch(/type/i);
    expect(ADVERSARIAL_AUDIT_PROMPT).toMatch(/lint|vitest/i);
    expect(ADVERSARIAL_AUDIT_PROMPT).toMatch(/different bug/i);
    expect(ADVERSARIAL_AUDIT_PROMPT).toMatch(/default to refusal when uncertain/i);
  });
});

describe('audit', () => {
  it('rechecks the exact controller authorization before a fresh audit rerun', async () => {
    const before = 'import { test, expect } from "vitest"; test("name", async () => { expect(load()).toBe("ok"); });\n';
    const after = before.replace('expect(load())', 'expect(await load())');
    const diff = `diff --git a/case.test.js b/case.test.js\n--- a/case.test.js\n+++ b/case.test.js\n@@ -1 +1 @@\n-${before.trimEnd()}\n+${after.trimEnd()}\n`;
    const baseline = { kind: 'local-snapshot' as const, sourceSha: null, policyBaseSha: null, policySha256: 'a'.repeat(64), baselineImageId: 'baseline', snapshotSha256: null };
    const session = createRepairAuthorizationSession({ baseline, failingCommand: 'pnpm test', policy: createDefaultRepositoryPolicy(), sources: [{ path: 'case.test.js', startLine: 1, content: before, truncated: false }] });
    expect((await deriveRepairAuthorization(session, { kind: 'await-operation', path: 'case.test.js', evidenceReferences: ['recorded-promise-failure'], controllerProbe: { id: 'async-completion', imageId: 'baseline', exitCode: 1, output: 'Promise mismatch', sourceSha256: createHash('sha256').update(before).digest('hex'), failingCommand: 'pnpm test' } })).ok).toBe(true);
    const context = { ...CONTEXT, authorization: { session, baseline } };
    const unavailable = llmReplies();
    expect((await audit(executor(), unavailable.llm, winner(diff), context)).approved).toBe(false);
    expect(unavailable.chat).not.toHaveBeenCalled();
    expect((await authorizeRepairCandidate(session, baseline, diff)).ok).toBe(true);
    const available = llmReplies('{"approved":true,"reasoning":"unchanged assertion and awaited existing operation"}');
    expect((await audit(executor(), available.llm, winner(diff), context)).approved).toBe(true);
    expect((await audit(executor(), llmReplies().llm, winner(diff.replace('toBe("ok")', 'toBe("other")')), context)).approved).toBe(false);
  });
  it.each([
    'deleted-test',
    'skipped-test',
    'weakened-assertion',
    'loosened-type',
    'relaxed-config',
    'pass-with-no-tests',
    'module-syntax',
  ])('refuses %s mechanically before spending a sandbox or LLM call', async (name) => {
    const sandbox = executor();
    const { llm, chat } = llmReplies(JSON.stringify({ approved: true, reasoning: 'ok' }));

    const verdict = await audit(sandbox, llm, winner(await fixture(name)), CONTEXT);

    expect(verdict.approved).toBe(false);
    expect(verdict.checks).toHaveLength(8);
    expect(verdict.checks.some((check) => !check.passed)).toBe(true);
    expect(verdict.checks.find((check) => !check.passed)?.evidence).toContain('@@');
    expect(sandbox.calls).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  it('approves an honest fix after one fresh suite rerun and Ultra approval', async () => {
    const sandbox = executor();
    const { llm, chat } = llmReplies(
      JSON.stringify({ approved: true, reasoning: 'The patch fixes the diagnosed export.' }),
    );

    const verdict = await audit(
      sandbox,
      llm,
      winner(await fixture('honest-fix')),
      CONTEXT,
    );

    expect(verdict.approved).toBe(true);
    expect(verdict.reasoning).toBe('The patch fixes the diagnosed export.');
    expect(verdict.checks).toHaveLength(8);
    expect(verdict.checks.every(({ passed }) => passed)).toBe(true);
    expect(sandbox.calls).toEqual([
      expect.objectContaining({
        kind: 'run',
        parent: 'winner-image',
        cmd: 'pnpm test',
        opts: { cwd: '/workspace' },
      }),
    ]);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledWith(
      'ultra',
      expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: ADVERSARIAL_AUDIT_PROMPT }),
        expect.objectContaining({
          role: 'user',
          content: expect.stringMatching(
            /Cannot resolve package export[\s\S]*price\/legacy|price\/legacy[\s\S]*Cannot resolve package export/,
          ),
        }),
      ]),
      expect.objectContaining({ responseFormat: { type: 'json_object' } }),
    );
    const userMessage = chat.mock.calls[0]?.[1]?.find(
      (message: { role: string }) => message.role === 'user',
    ) as { content?: string } | undefined;
    expect(userMessage?.content).toContain('Build failed before repair');
    expect(userMessage?.content).toContain('Tests passed');
  });

  it('bounds the logs in the actual serialized Ultra user message', async () => {
    const sandbox = new InMemoryExecutor(() => ({
      exitCode: 0,
      stdout: `${'🧵'.repeat(4_000)}\nstdout-tail`,
      stderr: `${'🔥'.repeat(4_000)}\nstderr-tail`,
      truncated: false,
      metrics: {},
    }));
    const { llm, chat } = llmReplies(
      JSON.stringify({ approved: true, reasoning: 'The repair is valid.' }),
    );
    const beforeLog = `${Array.from(
      { length: 500 },
      (_, index) => `old failure ${index}`,
    ).join('\n')}\n${'🧵'.repeat(20_000)}\nFINAL FAILURE`;

    await audit(sandbox, llm, winner(await fixture('honest-fix')), {
      ...CONTEXT,
      beforeLog,
    });

    const messages = chat.mock.calls[0]?.[1] as Array<{
      role: string;
      content: string;
    }>;
    const userContent = messages.find(({ role }) => role === 'user')?.content ?? '';
    const context = JSON.parse(userContent) as {
      beforeLog: string;
      afterLog: string;
    };
    expect(context.beforeLog.split('\n').length).toBeLessThanOrEqual(200);
    expect(context.beforeLog.length).toBeLessThanOrEqual(20_000);
    expect(Buffer.byteLength(context.beforeLog, 'utf8')).toBeLessThanOrEqual(20_000);
    expect(context.beforeLog).toContain('FINAL FAILURE');
    expect(context.afterLog.length).toBeLessThanOrEqual(2_000);
    expect(Buffer.byteLength(context.afterLog, 'utf8')).toBeLessThanOrEqual(2_000);
    expect(context.afterLog.split('\n').length).toBeLessThanOrEqual(100);
    expect(context.afterLog).toContain('stdout-tail');
    expect(context.afterLog).toContain('stderr-tail');
    expect(userContent.length).toBeLessThanOrEqual(23_000);
    expect(Buffer.byteLength(userContent, 'utf8')).toBeLessThanOrEqual(23_000);
  });

  it('refuses a mechanically clean patch when Ultra finds the wrong-cause repair', async () => {
    const sandbox = executor();
    const reasoning = 'REFUSED: the patch changes a different bug and hides the cause.';
    const { llm } = llmReplies(JSON.stringify({ approved: false, reasoning }));

    await expect(
      audit(sandbox, llm, winner(await fixture('honest-fix')), CONTEXT),
    ).resolves.toMatchObject({
      approved: false,
      reasoning,
      checks: expect.arrayContaining([
        { name: 'llm-adjudication', passed: false, evidence: reasoning },
      ]),
    });
  });

  it('refuses when the fresh suite rerun fails and does not call Ultra', async () => {
    const sandbox = executor(1);
    const { llm, chat } = llmReplies(JSON.stringify({ approved: true, reasoning: 'ok' }));

    const verdict = await audit(
      sandbox,
      llm,
      winner(await fixture('honest-fix')),
      CONTEXT,
    );

    expect(verdict.approved).toBe(false);
    expect(verdict.checks).toHaveLength(8);
    expect(verdict.reasoning).toContain('suite rerun exited 1');
    expect(verdict.reasoning).toContain('Assertion failed');
    expect(chat).not.toHaveBeenCalled();
  });

  it('repairs malformed JSON once and then refuses continuing ambiguity', async () => {
    const sandbox = executor();
    const { llm, chat } = llmReplies('Maybe this is safe.', 'Still not JSON.');

    const verdict = await audit(
      sandbox,
      llm,
      winner(await fixture('honest-fix')),
      CONTEXT,
    );

    expect(verdict.approved).toBe(false);
    expect(verdict.reasoning).toMatch(/invalid|uncertain|refus/i);
    expect(verdict.checks.at(-1)).toMatchObject({
      name: 'llm-adjudication',
      passed: false,
    });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringMatching(/valid JSON object/i),
        }),
      ]),
    );
  });
});

describe('adjudicate', () => {
  it('redacts non-editable audit context and the model reply on retry', async () => {
    const { llm, chat } = llmReplies(
      'invalid {"token":"echoed-secret"}',
      JSON.stringify({ approved: false, reasoning: 'The candidate is unsafe.' }),
    );

    await adjudicate(llm, {
      diagnosis: { ...DIAGNOSIS, errorExcerpt: 'PASSWORD=input-secret' },
      diff: await fixture('honest-fix'),
      beforeLog: 'Authorization: Bearer before-secret',
      afterLog: 'after',
    });

    const outbound = JSON.stringify(chat.mock.calls.map((call) => call[1]));
    expect(outbound).not.toMatch(/input-secret|before-secret|echoed-secret/u);
    expect(outbound).toContain('[redacted credential]');
  });

  it('accepts one repaired JSON response and does not make a third call', async () => {
    const { llm, chat } = llmReplies(
      'not json',
      JSON.stringify({ approved: true, reasoning: 'The diagnosed cause is fixed.' }),
    );

    await expect(
      adjudicate(llm, {
        diagnosis: DIAGNOSIS,
        diff: await fixture('honest-fix'),
        beforeLog: 'before',
        afterLog: 'after',
      }),
    ).resolves.toEqual({
      approved: true,
      reasoning: 'The diagnosed cause is fixed.',
    });
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('bounds hostile escaped logs while preserving the complete diff', async () => {
    const { llm, chat } = llmReplies(
      JSON.stringify({ approved: true, reasoning: 'The diagnosed cause is fixed.' }),
    );
    const diff = await fixture('honest-fix');
    const hostile = `${'\\"'.repeat(30_000)}\nFINAL LOG LINE`;

    await expect(
      adjudicate(llm, {
        diagnosis: DIAGNOSIS,
        diff,
        beforeLog: hostile,
        afterLog: hostile,
      }),
    ).resolves.toMatchObject({ approved: true });

    expect(chat).toHaveBeenCalledTimes(1);
    const messages = chat.mock.calls[0]?.[1] as Array<{
      role: string;
      content: string;
    }>;
    const userContent = messages.find(({ role }) => role === 'user')?.content ?? '';
    const context = JSON.parse(userContent) as {
      candidateDiff: string;
      beforeLog: string;
      afterLog: string;
    };
    expect(userContent.length).toBeLessThanOrEqual(64_000);
    expect(Buffer.byteLength(userContent, 'utf8')).toBeLessThanOrEqual(64_000);
    expect(context.candidateDiff).toBe(diff);
    expect(context.beforeLog.length).toBeLessThanOrEqual(20_000);
    expect(Buffer.byteLength(context.beforeLog, 'utf8')).toBeLessThanOrEqual(20_000);
    expect(context.beforeLog.split('\n').length).toBeLessThanOrEqual(200);
    expect(context.afterLog.length).toBeLessThanOrEqual(2_000);
    expect(Buffer.byteLength(context.afterLog, 'utf8')).toBeLessThanOrEqual(2_000);
    expect(context.afterLog.split('\n').length).toBeLessThanOrEqual(100);
    expect(context.beforeLog).toContain('FINAL LOG LINE');
    expect(context.afterLog).toContain('FINAL LOG LINE');
  });

  it.each([
    ['characters', 'x'.repeat(70_000)],
    ['UTF-8 bytes', '🧵'.repeat(17_000)],
  ])('refuses a context oversized by %s without truncating or calling Ultra', async (
    _limit,
    payload,
  ) => {
    const { llm, chat } = llmReplies(
      JSON.stringify({ approved: true, reasoning: 'unsafe approval' }),
    );
    const oversizedDiff = `diff --git a/src/a.ts b/src/a.ts\n${payload}`;

    await expect(
      adjudicate(llm, {
        diagnosis: DIAGNOSIS,
        diff: oversizedDiff,
        beforeLog: 'before',
        afterLog: 'after',
      }),
    ).resolves.toEqual({
      approved: false,
      reasoning: expect.stringMatching(/context|limit|truncat/i),
    });
    expect(chat).not.toHaveBeenCalled();
  });
});
