import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { DEFAULT_MODELS } from './config.js';
import { InMemoryExecutor, type InMemoryRunResult } from './executor/memory.js';
import { healCase } from './heal.js';
import { DEFAULT_MODEL_PRICES } from './llm/cost.js';
import { DEFAULT_ROUTING_PROFILE_ID } from './llm/router.js';
import type { TierLlm } from './llm/types.js';
import { createDefaultRepositoryPolicy } from './policy/load.js';

it('refuses the first visible-green floor repair under frozen preservation challenges and admits the later ceil repair', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-required-search-'));
  const before = 'export function pageCount(items, size) { return Math.floor(items / size) + 1; }\n';
  const replacement = (operation: string) => `export function pageCount(items, size) { return Math.${operation}(items / size); }\n`;
  const diff = (operation: string) => ['diff --git a/page-count.js b/page-count.js', '--- a/page-count.js', '+++ b/page-count.js', '@@ -1 +1 @@', `-${before.trimEnd()}`, `+${replacement(operation).trimEnd()}`, ''].join('\n');
  const result = (exitCode = 0): InMemoryRunResult => ({ exitCode, stdout: exitCode ? 'AssertionError: case.test.js failed' : 'Tests passed', stderr: '', truncated: false, metrics: {} });
  let baselineReached = false;
  let applied = 0;
  let proposed = 0;
  let adjudications = 0;
  const events: string[] = [];
  const imageValues = new Map<string, number>();
  const executor = new InMemoryExecutor((command, parent) => {
    const current = executor.calls.at(-1)!;
    const value = imageValues.get(parent) ?? 3;
    imageValues.set(current.imageId, value);
    if (command.includes('git apply - && git diff')) {
      const operation = applied++ === 0 ? 'floor' : 'ceil';
      imageValues.set(current.imageId, operation === 'floor' ? 2 : 3);
      return { ...result(), stdout: diff(operation) };
    }
    if (command.includes('JSON.stringify')) {
      events.push(`observe:${value}`);
      return { ...result(), stdout: JSON.stringify({ version: 1, value }) };
    }
    if (command.includes('SUTURA_TRIAGE_ATTEMPT')) return result(1);
    if (command.includes('pnpm test') && !baselineReached) { baselineReached = true; return result(1); }
    return result();
  });
  const llm: TierLlm<'nano' | 'super' | 'ultra'> = {
    modelQuote: tier => ({ role: tier, modelId: DEFAULT_MODELS[tier], price: DEFAULT_MODEL_PRICES[tier], profileId: DEFAULT_ROUTING_PROFILE_ID }),
    chat: async (tier, _messages, options) => {
      if (options?.purpose === 'challenge-generation') {
        events.push('freeze');
        return { usd: 0, text: JSON.stringify({ challenges: [{ id: 'boundary', kind: 'preservation', contractRefs: [{ path: 'page-count.js', sha256: createHash('sha256').update(before).digest('hex'), startLine: 1, endLine: 1 }], rationale: 'Preserve non-divisible input', probeId: 'pages', inputs: [21, 10], contractId: 'pages', relationId: 'equals' }] }) };
      }
      if (tier === 'nano') return { usd: 0, text: JSON.stringify({ class: 'test-assertion', confidence: 0.95, signals: ['scripted'], failingCmd: 'pnpm test', errorExcerpt: 'case.test.js: assertion failed' }) };
      if (tier === 'ultra') { adjudications++; return { usd: 0, text: JSON.stringify({ approved: true, reasoning: 'Declared contract preserved' }) }; }
      events.push('repair');
      return { usd: 0, text: JSON.stringify({ replacement: replacement(proposed++ === 0 ? 'floor' : 'ceil') }) };
    },
  };
  try {
    await writeFile(join(directory, 'page-count.js'), before);
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'local-case', version: '1.0.0', type: 'module' }));
    const outcome = await healCase({
      runId: 'required-search', repo: 'fixture/required-search', caseDir: directory,
      failureCommand: 'pnpm test', executor, llm, cost: { entries: [], totalUsd: () => 0 }, triageN: 5, raceK: 1,
      search: { initialBranches: 2, beamWidth: 1, maximumDepth: 1, maximumTotalBranches: 2 },
      readSourceContext: async () => ({ sources: [{ path: 'page-count.js', startLine: 1, content: before, truncated: false }] }),
      policy: { ...createDefaultRepositoryPolicy(), verification: { mode: 'required', contracts: [{ id: 'pages', kind: 'ceiling-division', target: { adapter: 'javascript', path: 'page-count.js', export: 'pageCount' }, maxItems: 100, maxDivisor: 100 }] } },
    });
    expect(outcome.outcome, JSON.stringify(outcome)).toBe('fixed');
    expect(outcome.verification?.schemaVersion).toBe('sutura-verification-evidence-v2');
    expect(outcome.verificationArtifact).toBeDefined();
    expect(JSON.parse(outcome.verificationArtifact!.bytes)).toEqual(outcome.verification);
    expect(proposed).toBe(2);
    expect(adjudications).toBe(1);
    expect(events.filter(event => event === 'freeze')).toHaveLength(1);
    expect(events.indexOf('freeze')).toBeLessThan(events.indexOf('repair'));
    expect(outcome.verificationRuns).toHaveLength(2);
    expect(outcome.verificationRuns?.[0]?.setHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(outcome.verificationRuns?.[1]?.setHash).toBe(outcome.verificationRuns?.[0]?.setHash);
    expect(outcome.verificationRuns?.[1]?.diffHash).toBe(createHash('sha256').update(diff('ceil')).digest('hex'));
    expect(outcome.verificationRuns?.[0]?.verification).toMatchObject({ status: 'failed', blockingGate: 'challenges' });
    expect(outcome.verificationRuns?.[1]?.verification).toMatchObject({ status: 'passed', challengeAssurance: true });
    expect(outcome.search?.map(node => node.terminalReason)).toEqual(['verification-refused', 'passed']);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30_000);
