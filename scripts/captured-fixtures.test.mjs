import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { publicGitHubUrl } from './evidence-contract.mjs';
import {
  completedReplayBoundaries,
  parseCapturedFixturesManifest,
  parseReplayBundle,
} from './replay-contract.mjs';

const ACTION_CAPTURE_ROOT = 'packages/action/src/__fixtures__/captured';
const SECRET_PATTERN = /Bearer\s+\S+|\bnb-[A-Za-z0-9]{8,}|\bghp_|\bgithub_pat_|\bsk-[A-Za-z0-9]{8,}/u;
const fixtureCache = new Map();
let manifestCache;
const DOGFOOD_0829_RUNS = [
  '33238860852', '33240572371', '33241358531', '33242204485',
  '33243759945', '33244884596', '33246383946', '33247360873',
  '33248388988', '33252323239', '33254012677', '33256572917',
  '33258931783', '33261605582', '33265268595', '33268037618',
];

const BOUNDARY_TESTS = [
  ['packages/action/src/github.test.ts', 'github'],
  ['packages/action/src/octokit.test.ts', 'github'],
  ['packages/action/src/repository.test.ts', 'repository'],
  ['packages/core/src/llm/nebius.test.ts', 'nebius'],
  ['packages/core/src/llm/json.test.ts', 'nebius'],
  ['packages/core/src/executor/contree.test.ts', 'contree'],
  ['packages/core/src/diagnose/tavily.test.ts', 'tavily'],
  ['packages/core/src/runtime/detect.test.ts', 'repository'],
  ['packages/core/src/runtime/python.test.ts', 'repository'],
  ['packages/core/src/orchestrate.test.ts', 'github'],
];

// Track C removes its GitHub entries as it lands captured-fixture imports.
// Provider, Tavily, ConTree, and Repository entries remain pending through
// Phase 4 because their authorized captures do not exist yet.
export const PENDING_CAPTURE_IMPORTS = new Set([
  'packages/action/src/github.test.ts',
  'packages/action/src/octokit.test.ts',
  'packages/action/src/repository.test.ts',
  'packages/core/src/diagnose/tavily.test.ts',
  'packages/core/src/runtime/detect.test.ts',
  'packages/core/src/runtime/python.test.ts',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function capturedManifest() {
  manifestCache ??= (async () => {
    const path = join(ACTION_CAPTURE_ROOT, 'manifest.json');
    const bytes = await readFile(path);
    return { path, bytes, manifest: parseCapturedFixturesManifest(bytes) };
  })();
  return manifestCache;
}

function fixture(runId) {
  let captured = fixtureCache.get(runId);
  if (captured === undefined) {
    captured = (async () => {
      const path = join(ACTION_CAPTURE_ROOT, runId, 'bundle.json');
      const bytes = await readFile(path);
      return { path, bytes, bundle: parseReplayBundle(bytes) };
    })();
    fixtureCache.set(runId, captured);
  }
  return captured;
}

test('captured fixture manifest binds every unique real bundle to hashes and sources', async () => {
  const { bytes, manifest } = await capturedManifest();
  assert.doesNotMatch(bytes.toString('utf8'), SECRET_PATTERN);
  assert.ok(manifest.entries.length >= 26);

  const listed = new Set();
  for (const [index, entry] of manifest.entries.entries()) {
    const label = `manifest.entries[${index}]`;
    if (entry.suturaRunId !== undefined) {
      assert.notEqual(entry.suturaRunId, entry.targetRunId, `${label} run roles must stay distinct`);
    }
    if (entry.capturedBy === 'workflow') {
      assert.equal(
        publicGitHubUrl(entry.source, `${label}.source`),
        `https://github.com/juan294/sutura/actions/runs/${entry.workflowRunId}`,
      );
    }
    assert.equal(new Set(entry.boundaries).size, entry.boundaries.length);

    const captured = await fixture(entry.workflowRunId);
    assert.equal(sha256(captured.bytes), entry.bundleSha256, `${captured.path} hash drift`);
    assert.doesNotMatch(captured.bytes.toString('utf8'), SECRET_PATTERN);
    assert.equal(captured.bundle.runId, entry.targetRunId);
    assert.equal(captured.bundle.repo, 'juan294/sutura');
    assert.equal(captured.bundle.capturedAt, entry.capturedAt);
    assert.equal(
      captured.bundle.completeness.complete,
      (entry.kind === 'dogfood-gave-up' || entry.kind === 'dogfood-refused') &&
        entry.capturedBy === 'workflow',
    );
    assert.ok(captured.bundle.github.length > 0);
    assert.deepEqual(
      [...completedReplayBoundaries(captured.bundle)].sort(),
      entry.boundaries,
    );
    listed.add(`${entry.workflowRunId}/bundle.json`);
  }

  const actual = new Set();
  for (const directory of await readdir(ACTION_CAPTURE_ROOT, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    for (const file of await readdir(join(ACTION_CAPTURE_ROOT, directory.name))) {
      actual.add(`${directory.name}/${file}`);
    }
  }
  assert.deepEqual(actual, listed, 'every captured file must be listed exactly once');
});

test('historical logs retain exact ANSI and hook-timeout evidence', async () => {
  for (const runId of DOGFOOD_0829_RUNS) {
    const { bundle } = await fixture(runId);
    const logs = bundle.github
      .filter(({ method }) => method === 'downloadJobLogs')
      .map(({ result }) => result)
      .join('\n');
    assert.match(logs, /\u001b\[31m❯\u001b\[39m/u, `${runId} lost raw ANSI Vitest evidence`);
  }
  for (const runId of ['33238191746', '33239848825']) {
    const { bundle } = await fixture(runId);
    const logs = bundle.github
      .filter(({ method }) => method === 'downloadJobLogs')
      .map(({ result }) => result)
      .join('\n');
    assert.match(logs, /Hook timed out in 10000ms/u, `${runId} lost the hook timeout`);
  }
});

test('boundary tests name captured fixtures when their authorized boundary is ready', async () => {
  const { manifest } = await capturedManifest();
  const capturedBoundaries = new Set(
    manifest.entries.flatMap(({ boundaries }) => boundaries),
  );
  for (const [path, boundary] of BOUNDARY_TESTS) {
    if (!capturedBoundaries.has(boundary) || PENDING_CAPTURE_IMPORTS.has(path)) continue;
    await stat(path);
    assert.match(
      await readFile(path, 'utf8'),
      /__fixtures__\/captured\//u,
      `${path} must import a captured ${boundary} fixture`,
    );
  }
  for (const pending of PENDING_CAPTURE_IMPORTS) {
    assert.ok(BOUNDARY_TESTS.some(([path]) => path === pending), `${pending} is not enumerated`);
  }
});

test('Node replay contract commands build the ignored Core distribution first', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  for (const name of [
    'test:capture-run', 'test:captured-fixtures', 'test:release-contracts',
  ]) {
    const command = packageJson.scripts[name];
    const coreBuild = command.indexOf('pnpm --filter @sutura/core build');
    const nodeTests = command.indexOf('node --test');
    assert.ok(coreBuild === 0 && nodeTests > coreBuild,
      `${name} must build Core before importing its compiled replay parser`);
    if (name === 'test:release-contracts') {
      const evaluationBuild = command.indexOf('pnpm --filter @sutura/evaluation build');
      assert.ok(evaluationBuild > coreBuild && evaluationBuild < nodeTests,
        `${name} must build Evaluation before importing its Data Lab contract`);
    }
  }
});
