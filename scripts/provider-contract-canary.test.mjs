import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const SHA = 'a'.repeat(40);

test('provider contract canary writes SHA-bound evidence and refuses a dirty tree', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-canary-'));
  const { runProviderContractCanary } = await import('./provider-contract-canary.mjs');
  try {
    const output = await runProviderContractCanary({
      apiKey: 'test-key',
      outputDirectory: directory,
      now: () => Date.parse('2026-08-30T08:00:00.000Z'),
      git: (args) => args[0] === 'status' ? '' : SHA,
      run: async () => ({ passed: true, model: 'test-model' }),
    });
    const artifact = JSON.parse(await readFile(output.outputPath, 'utf8'));
    assert.equal(artifact.headSha, SHA);
    assert.equal(artifact.capturedAt, '2026-08-30T08:00:00.000Z');
    assert.equal(typeof artifact.contractVersion, 'string');
    assert.deepEqual(artifact.result, { passed: true, model: 'test-model' });
    await assert.rejects(() => runProviderContractCanary({
      apiKey: 'test-key', outputDirectory: directory,
      git: (args) => args[0] === 'status' ? ' M dirty.ts' : SHA,
      run: async () => ({ passed: true }),
    }), /clean tree/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('provider contract canary builds core and runs without repository or GitHub mutation', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const source = await readFile(resolve(root, 'scripts/provider-contract-canary.mjs'), 'utf8');

  assert.equal(
    manifest.scripts['canary:provider-contract'],
    'pnpm --filter @sutura/core build && node scripts/provider-contract-canary.mjs',
  );
  assert.match(source, /runSuperRepairProviderContractCanary/u);
  assert.match(source, /process\.env\.NEBIUS_API_KEY/u);
  assert.match(source, /process\.env\.SUTURA_CANARY_OUTPUT_DIRECTORY/u);
  assert.match(source, /JSON\.stringify\(result/u);
  assert.doesNotMatch(source, /(?:git|gh)\s+(?:push|branch|pr)|createFixPullRequest|publishFix/u);
  assert.doesNotMatch(source, /console\.log\([^)]*apiKey/u);
  assert.match(source, /provider-contract-canary-\$\{headSha\}\.json/u);
  assert.match(source, /requires a clean tree/u);
});

test('provider contract canary workflow is manual, read-only, and runs the canonical command', async () => {
  const workflow = await readFile(resolve(root, '.github/workflows/provider-contract-canary.yml'), 'utf8');

  assert.match(workflow, /^on:\n  workflow_dispatch:$/mu);
  assert.match(workflow, /^permissions:\n  contents: read$/mu);
  assert.match(workflow, /pnpm run canary:provider-contract/u);
  assert.match(workflow, /NEBIUS_API_KEY: \$\{\{ secrets\.NEBIUS_API_KEY \}\}/u);
  assert.match(workflow, /SUTURA_CANARY_OUTPUT_DIRECTORY: \$\{\{ runner\.temp \}\}/u);
  assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/provider-contract-canary-\*\.json/u);
  assert.match(workflow, /uses: actions\/upload-artifact@v7/u);
  assert.match(workflow, /name: provider-contract-canary/u);
  assert.match(workflow, /if-no-files-found: error/u);
  assert.doesNotMatch(workflow, /(?:pull_request|push):|contents: write|pull-requests: write/u);
});

test('serialized production replay names every observed live run from 1 through 16', async () => {
  const manifest = JSON.parse(await readFile(resolve(
    root,
    'packages/action/src/__fixtures__/captured/manifest.json',
  ), 'utf8'));
  const sources = await Promise.all([
    'packages/core/src/engine/repair-provider-replay.test.ts',
    'packages/core/src/orchestrate.test.ts',
  ].map((path) => readFile(resolve(root, path), 'utf8')));
  const namedRuns = new Set(
    sources.flatMap((source) =>
      [...source.matchAll(/it\(\s*'(?<title>replays live runs? [^']+)'/gu)]
        .flatMap((match) => [...(match.groups?.title ?? '').matchAll(/\d+/gu)])
        .map((match) => Number(match[0])),
    ),
  );

  assert.deepEqual([...namedRuns].sort((left, right) => left - right),
    Array.from({ length: 16 }, (_value, index) => index + 1));

  const capturedTargetRunIds = new Set(manifest.entries.map(({ targetRunId }) => targetRunId));
  const bindings = sources.flatMap((source) =>
    [...source.matchAll(/capturedLiveRun\(\s*(?<run>\d+)\s*,\s*'(?<targetRunId>\d+)'\s*\)/gu)]
      .map((match) => ({
        run: Number(match.groups?.run),
        targetRunId: match.groups?.targetRunId,
      })),
  );
  const boundRuns = new Set(bindings.map(({ run }) => run));

  assert.deepEqual([...boundRuns].sort((left, right) => left - right),
    Array.from({ length: 16 }, (_value, index) => index + 1));
  for (const { run, targetRunId } of bindings) {
    assert.ok(
      capturedTargetRunIds.has(targetRunId),
      `live run ${run} references missing captured target ${targetRunId}`,
    );
  }
});
