import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { InMemoryExecutor } from '../executor/memory.js';
import { AllowlistedExecutor, prepareSandbox } from '../heal.js';
import { NODE_RUNTIME } from '../runtime/node.js';
import type { RepositoryPort } from '../orchestrate.js';
import { ReplayRecorder } from './bundle.js';
import type { RecordedPortCall } from './replay-github.js';
import { recordingExecutor } from './record-executor.js';
import { RecordedExecutor } from './replay-executor.js';
import { RecordedRepository } from './replay-repository.js';
import { freezeRepositorySource } from './source-snapshot.js';
import { parseReplayBundle } from './validate.js';
import { RecordedCallCursor, describeMethodCall } from './recorded-call-cursor.js';

it('replays a frozen manifest and exact preparation without re-reading original source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sutura-source-recording-'));
  const recorder = new ReplayRecorder('1', 'acme/widget', 'a'.repeat(40), { triageN: 1, raceK: 1, models: { nano: 'nano', super: 'super', ultra: 'ultra' }, routingProfileId: 'test', maxOps: 20 });
  const content = 'export const answer = 42;\n';
  const pkg = JSON.stringify({ name: 'case', version: '1.0.0' });
  await writeFile(join(dir, 'package.json'), pkg);
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src/value.js'), content);
  const checkoutId = recorder.registerCheckoutPath(dir);
  recorder.recordRepository({ method: 'checkoutHead', args: ['acme/widget', 'a'.repeat(40), 'main', null], result: { checkoutId, snapshot: { runtimeEvidencePaths: ['package.json'], files: [{ path: 'package.json', content: pkg }] } } });
  const frozen = await freezeRepositorySource({} as RepositoryPort, dir, recorder);
  const executor = recordingExecutor(new InMemoryExecutor(() => ({ exitCode: 0, stdout: '', stderr: '', truncated: false, metrics: {} })), recorder);
  const live = await prepareSandbox(new AllowlistedExecutor(executor), dir, 'base', 'pnpm test', undefined, NODE_RUNTIME, () => Promise.resolve(frozen));
  expect(live.ok).toBe(true);
  const references = [{ path: 'src/value.js' }];
  const limits = { maxFiles: 1, maxLinesPerFile: 10, maxCharactersPerFile: 100, maxBytesPerFile: 100 };
  recorder.recordRepository({ method: 'readSourceExcerpts', args: [frozen.dir, references, limits], result: [{ path: 'src/value.js', startLine: 1, content, truncated: false }] });
  if (live.ok) await live.cleanup?.();
  await rm(dir, { recursive: true, force: true });
  const bundle = parseReplayBundle(JSON.parse(JSON.stringify(recorder.finish('fixed'))));
  expect(bundle.completeness.overflowedBoundaries).toEqual([]);
  expect(bundle.completeness.pendingBoundaries).not.toContain('repository');
  expect(bundle.completeness.pendingBoundaries).not.toContain('executor');
  expect(JSON.stringify(bundle)).not.toContain(dir);
  const repositoryCursor = new RecordedCallCursor<RecordedPortCall>(bundle.repository, describeMethodCall, 'port');
  const executorCursor = new RecordedCallCursor(bundle.executor, describeMethodCall, 'executor');
  const repository = new RecordedRepository(bundle.repository, repositoryCursor);
  try {
    const checkout = await repository.checkoutHead('acme/widget', 'a'.repeat(40), 'main');
    await expect(readFile(join(checkout, 'src/value.js'))).rejects.toThrow();
    const replayed = await freezeRepositorySource(repository, checkout);
    expect(replayed.snapshotSha256).toBe(frozen.snapshotSha256);
    const replayExecutor = new RecordedExecutor(bundle.executor, args => repository.normalizeArgs(args), executorCursor);
    const setup = await prepareSandbox(new AllowlistedExecutor(replayExecutor), checkout, 'base', 'pnpm test', undefined, NODE_RUNTIME, () => Promise.resolve(replayed));
    expect(setup.ok && setup.snapshotSha256).toBe(frozen.snapshotSha256);
    expect(await repository.readSourceExcerpts(replayed.dir, references, limits)).toEqual([{ path: 'src/value.js', startLine: 1, content, truncated: false }]);
    repositoryCursor.assertConsumed();
    executorCursor.assertConsumed();
    if (setup.ok) await setup.cleanup?.();
  } finally { await repository.cleanup(); await frozen.cleanup(); await rm(dir, { recursive: true, force: true }); }
}, 30_000);

it('refuses a legacy required replay without recorded frozen provenance', async () => {
  const repository = new RecordedRepository([]);
  await expect(freezeRepositorySource(repository, '/source-does-not-exist')).rejects.toThrow();
});
