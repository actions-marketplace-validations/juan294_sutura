import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { InMemoryExecutor } from '../executor/memory.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import { validateVerifyRequest } from '../verify.js';
import type { HealLlm } from '../heal.js';
import { executeExternalVerification } from './external.js';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0))
  await rm(dir, { recursive: true, force: true }); });
const source = 'export const pages = (n, d) => Math.floor(n / d) + 1;';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
async function setup(correct: boolean) {
  const dir = await mkdtemp(join(tmpdir(), 'sutura-external-'));
  dirs.push(dir);
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src/pages.js'), source);
  const policy = { ...createDefaultRepositoryPolicy(), verification: { mode: 'required' as const, contracts: [{ id: 'pages', kind: 'ceiling-division' as const, target: { adapter: 'javascript' as const, path: 'src/pages.js', export: 'pages' }, maxItems: 100, maxDivisor: 100 }] } };
  const diff = `diff --git a/src/pages.js b/src/pages.js\n--- a/src/pages.js\n+++ b/src/pages.js\n@@ -1 +1 @@\n-${source}\n+export const pages = (n, d) => Math.${correct ? 'ceil' : 'floor'}(n / d);\n`;
  const request = validateVerifyRequest({ caseDir: dir, sourceSha: 'a'.repeat(40), policyBaseSha: 'b'.repeat(40), candidateDiff: diff, failureCommandId: 'diagnosed', runtimeId: 'node' }, policy, { diagnosed: 'npm test' });
  const events: string[] = [];
  let tests = 0;
  let applied = false;
  const executor = new InMemoryExecutor((command) => {
    events.push(command);
    if (command.includes('git apply'))
      applied = true;
    const probe = command.includes('SUTURA') || command.includes('JSON.stringify');
    const stdout = probe ? JSON.stringify({ version: 1, value: applied ? (correct ? 3 : 2) : 3 }) : 'AssertionError expected 3';
    return { exitCode: command === 'npm test' && ++tests <= 2 ? 1 : 0, stdout, stderr: '', truncated: false, metrics: {} };
  });
  const chat = vi.fn(async (tier: string) => {
    events.push(`model:${tier}`);
    return { text: tier === 'super' ? JSON.stringify({ challenges: [{ id: 'boundary', kind: 'preservation', contractRefs: [{ path: 'src/pages.js', sha256: sha(source), startLine: 1, endLine: 1 }], rationale: 'Non-divisible input preserves rounding up', probeId: 'pages', inputs: [21, 10], contractId: 'pages', relationId: 'equals' }] }) : '{"approved":true,"reasoning":"Preserves the declared contract"}', usd: 0.0001 };
  });
  const llm = { chat, modelQuote: () => ({ price: { input: 0.1, output: 0.1 } }) } as unknown as HealLlm;
  return { request, policy, executor, llm, events, chat, sourceDir: dir, snapshotSha256: sha('snapshot'), policySha256: sha('policy') };
}
it('executes a legitimate supplied patch through frozen challenges and full audit without generating a repair', async () => {
  const input = await setup(true);
  const result = await executeExternalVerification(input);
  expect(result.status).toBe('verified-supplied-patch');
  expect(result.verification.challengeAssurance).toBe(true);
  expect(input.events.indexOf('model:super')).toBeLessThan(input.events.findIndex(x => x.includes('git apply')));
  expect(input.chat.mock.calls.map(([tier]) => tier)).toEqual(['super', 'ultra']);
  expect(result.challenges?.observations).toHaveLength(4);
});
it('refuses a visible-green deceptive patch using preservation challenges', async () => {
  const input = await setup(false);
  const result = await executeExternalVerification(input);
  expect(result.status).toBe('refused');
  expect(result.verification.blockingGate).toBe('challenges');
  expect(input.chat.mock.calls.map(([tier]) => tier)).toEqual(['super']);
});
it('abstains before provider work if the audit budget cannot be reserved', async () => {
  const input = await setup(true);
  const result = await executeExternalVerification({ ...input, budgets: { inferenceCostUsd: 0.000001 } });
  expect(result.status).toBe('insufficient');
  expect(input.executor.calls).toHaveLength(0);
});
