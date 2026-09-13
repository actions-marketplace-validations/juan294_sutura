import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { prepareRuntimeChallenges, runRuntimeChallenges } from './runtime.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import type { Executor } from '../executor/types.js';
import type { HealLlm } from '../heal.js';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const source = 'export function pages(n, d) { return Math.floor(n / d) + 1; }';
const proposal = { id: 'boundary', kind: 'bug-regression', contractRefs: [{ path: 'src/pages.js', sha256: hash(source), startLine: 1, endLine: 1 }], rationale: 'Exact boundary', probeId: 'pages', inputs: [20, 10], contractId: 'pages', relationId: 'equals' };
function setup() {
  const calls: string[] = [];
  const run = vi.fn(async (image: string) => { calls.push(image); return { imageId: 'discard', exitCode: 0, stdout: JSON.stringify({ version: 1, value: image === 'ceil' ? 2 : 3 }), stderr: '', metrics: {} }; });
  const executor = { run } as unknown as Executor;
  const chat = vi.fn(async () => { calls.push('generate'); return { text: JSON.stringify({ challenges: [proposal] }) }; });
  const llm = { chat } as unknown as HealLlm;
  const policy = { ...createDefaultRepositoryPolicy(), verification: { mode: 'required' as const, contracts: [{ id: 'pages', kind: 'ceiling-division' as const, target: { adapter: 'javascript' as const, path: 'src/pages.js', export: 'pages' }, maxItems: 100, maxDivisor: 100 }] } };
  return { calls, run, chat, executor, llm, policy, input: { executor, llm, policy, baselineImage: 'baseline', baselineSnapshotHash: hash('snapshot'), policyBaseSha: 'a'.repeat(40), policyHash: hash('policy'), failureExcerpt: 'expected two pages', baselineSources: [{ path: 'src/pages.js', startLine: 1, content: source }] } };
}
it('generates and qualifies once before any candidate and shares frozen probes across alternatives', async () => {
  const s = setup();
  const prepared = await prepareRuntimeChallenges(s.input);
  expect(s.calls).toEqual(['generate', 'baseline', 'baseline']);
  expect((await runRuntimeChallenges(prepared, s.executor, 'floor')).status).toBe('failed');
  expect((await runRuntimeChallenges(prepared, s.executor, 'ceil')).status).toBe('passed');
  expect(s.chat).toHaveBeenCalledTimes(1);
  expect(s.calls).toEqual(['generate', 'baseline', 'baseline', 'floor', 'floor', 'ceil', 'ceil']);
  expect(JSON.stringify(s.chat.mock.calls)).not.toContain('candidateDiff');
});
it('never discards an invalid frozen challenge to approve the remaining one', async () => {
  const s = setup();
  s.chat.mockResolvedValue({ text: JSON.stringify({ challenges: [proposal, { ...proposal, id: 'bad', inputs: [-1, 10] }] }) });
  const prepared = await prepareRuntimeChallenges(s.input);
  expect((await runRuntimeChallenges(prepared, s.executor, 'ceil')).status).toBe('insufficient');
});
it('binds every repetition to the original subject image and stores observed byte digests', async () => {
  const s = setup();
  const prepared = await prepareRuntimeChallenges(s.input);
  const result = await runRuntimeChallenges(prepared, s.executor, 'ceil');
  expect(result.observations).toHaveLength(4);
  expect(result.observations.every(x => /^[a-f0-9]{64}$/.test(x.observationSha256 ?? ''))).toBe(true);
  expect(s.run.mock.calls.map(([image]) => image)).toEqual(['baseline', 'baseline', 'ceil', 'ceil']);
});

it('refuses a denied contract target before disclosing it to generation or running a probe', async () => {
  const s = setup();
  s.policy.deniedReadPaths = ['src/pages.js'];
  const prepared = await prepareRuntimeChallenges(s.input);
  expect(prepared.reason).toBe('invalid-probe');
  expect(s.chat).not.toHaveBeenCalled();
  expect(s.run).not.toHaveBeenCalled();
});
