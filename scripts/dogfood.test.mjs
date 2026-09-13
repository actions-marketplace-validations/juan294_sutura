import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertAppendOnlyLedger,
  costFromLog,
  createDogfoodDependencies,
  createSuturaRunCorrelator,
  dogfoodLedger,
  gateDogfood,
  inferenceCostFromEvidence,
  outcomeFromLog,
  renderDogfoodLedger,
  renderDogfoodExecutableEquivalence,
  runDogfoodAttempt,
  runDogfoodStreak,
  validateFailedCiJobs,
  validateDogfoodReplay,
  validateDogfoodLedger,
  validateSuturaCheckRuns,
} from './dogfood.mjs';

const SHA = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const DOGFOOD_SHA = 'c'.repeat(40);
const BUNDLE_HASH = 'd'.repeat(64);
const NOW = Date.parse('2026-08-30T08:00:00.000Z');
const CANARY_REPLACEMENT = 'export function add(left: number, right: number): number {\n  return left + right;\n}\n';

function entry(attempt, overrides = {}) {
  return {
    attempt,
    ciRunId: String(1000 + attempt),
    suturaRunId: String(2000 + attempt),
    dogfoodSha: DOGFOOD_SHA,
    actionSha: SHA,
    packagesTreeHash: TREE,
    outcome: 'fixed',
    bundleSha256: BUNDLE_HASH,
    sandboxUsd: 0.2,
    inferenceUsd: 0.3,
    prUrl: `https://github.com/juan294/sutura/pull/${attempt}`,
    recordedAt: new Date(NOW + attempt).toISOString(),
    ...overrides,
  };
}

async function contractVersion() {
  return import('../packages/core/dist/index.js')
    .then(({ SUPER_REPAIR_PROVIDER_CONTRACT_VERSION }) => SUPER_REPAIR_PROVIDER_CONTRACT_VERSION);
}

async function gateDependencies(overrides = {}) {
  const core = await import('../packages/core/dist/index.js');
  const version = core.SUPER_REPAIR_PROVIDER_CONTRACT_VERSION;
  const output = [];
  const dependencies = {
    stdout: { write: (value) => output.push(value) },
    now: () => NOW,
    git: async (args) => {
      if (args[0] === 'status') return '';
      if (args[0] === 'fetch') return '';
      if (args[1] === 'HEAD') return SHA;
      if (args[1] === 'origin/develop') return SHA;
      if (args[1] === `${SHA}:packages`) return TREE;
      throw new Error(`unexpected git: ${args.join(' ')}`);
    },
    ghApi: async (endpoint) => {
      if (endpoint.includes('/ci.yml/runs?')) return JSON.stringify({ workflow_runs: [{
        head_sha: SHA, head_branch: 'develop', event: 'push', conclusion: 'success',
      }] });
      throw new Error(`unexpected gh api: ${endpoint}`);
    },
    canaryEvidence: async () => ({
      schemaVersion: 'sutura-provider-contract-canary-v1',
      headSha: SHA,
      contractVersion: version,
      capturedAt: new Date(NOW - 60_000).toISOString(),
      result: {
        contractVersion: version,
        endpoint: 'https://api.tokenfactory.nebius.com/v1/chat/completions',
        model: core.DEFAULT_MODELS.super,
        finishReason: 'stop',
        usage: { inTok: 10, outTok: 5, reasoningTok: 0 },
        replacementCodePoints: [...CANARY_REPLACEMENT].length,
        replacementSha256: createHash('sha256').update(CANARY_REPLACEMENT).digest('hex'),
        latencyMs: 100,
        requestId: null,
      },
    }),
    runtimeImageEvidence: async () => ({
      schemaVersion: 'sutura-runtime-image-canary-v2',
      headSha: SHA,
      capturedAt: new Date(NOW - 60_000).toISOString(),
      registryResolution: {
        imageRef: core.PYTHON_IMAGE_REF,
        indexDigest: core.PYTHON_IMAGE_INDEX_DIGEST,
        linuxAmd64Digest: core.PYTHON_IMAGE_LINUX_AMD64_DIGEST,
      },
      proof: {
        schemaVersion: core.PYTHON_IMAGE_PROOF_SCHEMA_VERSION,
        imageRef: core.PYTHON_IMAGE_REF,
        expectedIndexDigest: core.PYTHON_IMAGE_INDEX_DIGEST,
        expectedLinuxAmd64Digest: core.PYTHON_IMAGE_LINUX_AMD64_DIGEST,
        importedImageId: 'image-1',
        requiredTools: core.PYTHON_REQUIRED_TOOLS,
        operationId: 'sutura-python-runtime-image-proof',
      },
    }),
    readLedger: async () => dogfoodLedger([]),
    findRegressionTest: async () => 'replays live run 2001',
    runRegressionTest: async () => '',
    ...overrides,
  };
  return { dependencies, output };
}

test('dogfood gate fails each precondition independently and passes only when all hold', async () => {
  const valid = await gateDependencies();
  await assert.doesNotReject(() => gateDogfood(SHA, valid.dependencies));
  assert.equal(valid.output.filter((line) => line.startsWith('PASS')).length, 7);

  const failures = [
    { git: async (args) => args[0] === 'status' ? ' M packages/core/src/x.ts' : args[1] === `${SHA}:packages` ? TREE : SHA },
    { git: async (args) => args[0] === 'status' || args[0] === 'fetch' ? '' : args[1] === `${SHA}:packages` ? TREE : 'c'.repeat(40) },
    { ghApi: async () => JSON.stringify({ workflow_runs: [] }) },
    { canaryEvidence: async () => ({ headSha: 'c'.repeat(40), contractVersion: await contractVersion(), capturedAt: new Date(NOW).toISOString() }) },
    { runtimeImageEvidence: async () => ({ headSha: SHA, capturedAt: new Date(NOW).toISOString(), proof: {} }) },
    {
      readLedger: async () => dogfoodLedger([entry(1, { outcome: 'gave-up' })]),
      findRegressionTest: async () => undefined,
    },
    { git: async (args) => args[0] === 'status' || args[0] === 'fetch' ? '' : args[1] === 'origin/develop' ? SHA : 'not-a-tree' },
  ];
  for (const overrides of failures) {
    const { dependencies } = await gateDependencies(overrides);
    await assert.rejects(() => gateDogfood(SHA, dependencies), /gate failed/u);
  }
});

test('dogfood run appends exactly one entry and refuses when the gate fails', async () => {
  const appended = [];
  const expected = entry(1);
  const dependencies = {
    gate: async () => undefined,
    executeAttempt: async () => expected,
    appendEntry: async (value) => { appended.push(value); },
  };
  assert.deepEqual(await runDogfoodAttempt({ sha: SHA, attempt: 1 }, dependencies), expected);
  assert.deepEqual(appended, [expected]);
  await assert.rejects(() => runDogfoodAttempt({ sha: SHA, attempt: 2 }, {
    ...dependencies,
    gate: async () => { throw new Error('gate rejected'); },
  }), /gate rejected/u);
  assert.equal(appended.length, 1);

  let executed = false;
  await assert.rejects(() => runDogfoodAttempt({ sha: SHA, attempt: 2 }, {
    gate: async () => undefined,
    readLedger: async () => dogfoodLedger([]),
    executeAttempt: async () => { executed = true; return entry(2); },
  }), /attempt must be 1/u);
  assert.equal(executed, false);

  let gated = false;
  await assert.rejects(() => runDogfoodAttempt({ sha: SHA, attempt: 11 }, {
    gate: async () => { gated = true; },
  }), /1 through 10/u);
  assert.equal(gated, false);
});

test('Sutura artifact correlation inspects each completed run only once', async () => {
  const endpoints = [];
  const correlate = createSuturaRunCorrelator('3001', {
    ghApi: async (endpoint) => {
      endpoints.push(endpoint);
      return JSON.stringify({ total_count: 1, artifacts: [{ name: 'unrelated' }] });
    },
  });
  const runs = [{ databaseId: 4001, status: 'completed', conclusion: 'success' }];
  assert.equal(await correlate(runs), undefined);
  assert.equal(await correlate(runs), undefined);
  assert.deepEqual(endpoints, [
    'repos/juan294/sutura/actions/runs/4001/artifacts?per_page=100',
  ]);
});

test('dogfood append validates against the committed HEAD ledger before atomic write', async () => {
  const expected = entry(1);
  let written;
  const result = await runDogfoodAttempt({ sha: SHA, attempt: 1 }, {
    gate: async () => undefined,
    readLedger: async () => dogfoodLedger([]),
    readCommittedLedger: async () => dogfoodLedger([]),
    executeAttempt: async () => expected,
    writeScratchLedger: async (ledger) => { written = ledger; },
  });
  assert.deepEqual(result, expected);
  assert.deepEqual(written, dogfoodLedger([expected]));

  const gitCalls = [];
  const dependencies = createDogfoodDependencies({
    git: async (args) => { gitCalls.push(args); return JSON.stringify(dogfoodLedger([])); },
  });
  assert.deepEqual(await dependencies.readCommittedLedger(), dogfoodLedger([]));
  assert.deepEqual(gitCalls, [['show', 'HEAD:docs/demo/dogfood-ledger.json']]);
});

test('dogfood streak stops on non-fixed outcome and before reserved spend exceeds cap', async () => {
  const calls = [];
  const output = [];
  const stopped = await runDogfoodStreak({
    sha: SHA, authorize: true, capUsd: 10, initialReserveUsd: 1.5,
  }, {
    stdout: { write: (value) => output.push(value) },
    readLedger: async () => dogfoodLedger([]),
    withStreakLock: async (operation) => operation(),
    runDogfoodAttempt: async ({ attempt }) => {
      calls.push(attempt);
      return entry(attempt, {
        outcome: attempt === 3 ? 'gave-up' : 'fixed',
        sandboxUsd: 0.4,
        inferenceUsd: 0.6,
      });
    },
  });
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(stopped.entries.length, 3);
  assert.match(output.join(''), /2\/10/u);

  calls.length = 0;
  const capped = await runDogfoodStreak({
    sha: SHA, authorize: true, capUsd: 2.4, initialReserveUsd: 1.5,
  }, {
    stdout: { write: () => undefined },
    readLedger: async () => dogfoodLedger([]),
    withStreakLock: async (operation) => operation(),
    runDogfoodAttempt: async ({ attempt }) => {
      calls.push(attempt);
      return entry(attempt, { sandboxUsd: 0.8, inferenceUsd: 0.4 });
    },
  });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(capped.spent, 2.4);

  calls.length = 0;
  await assert.rejects(() => runDogfoodStreak({
    sha: SHA, authorize: true, capUsd: 10, initialReserveUsd: 1.5,
  }, {
    stdout: { write: () => undefined },
    readLedger: async () => dogfoodLedger([entry(1, { outcome: 'gave-up', prUrl: undefined })]),
    withStreakLock: async (operation) => operation(),
    runDogfoodAttempt: async ({ attempt }) => {
      calls.push(attempt);
      return entry(attempt, { outcome: 'gave-up', prUrl: undefined });
    },
  }), /new candidate/u);
  assert.deepEqual(calls, []);

  calls.length = 0;
  const resumed = await runDogfoodStreak({
    sha: SHA, authorize: true, capUsd: 4, initialReserveUsd: 1.5,
  }, {
    stdout: { write: () => undefined },
    readLedger: async () => dogfoodLedger([
      entry(1, {
        actionSha: 'f'.repeat(40), outcome: 'gave-up', sandboxUsd: 0.3,
        inferenceUsd: 0.2, prUrl: undefined,
      }),
      entry(1, { sandboxUsd: 0.8, inferenceUsd: 0.4 }),
      entry(2, { sandboxUsd: 0.8, inferenceUsd: 0.4 }),
    ]),
    withStreakLock: async (operation) => operation(),
    runDogfoodAttempt: async ({ attempt }) => { calls.push(attempt); return entry(attempt); },
  });
  assert.deepEqual(calls, []);
  assert.equal(resumed.streakEntries.length, 2);
  assert.equal(resumed.spent, 2.9);
  await assert.rejects(() => runDogfoodStreak({ sha: SHA, capUsd: 10 }, {}), /--authorize/u);
  await assert.doesNotReject(() => runDogfoodStreak({
    sha: SHA, authorize: true, capUsd: 14, initialReserveUsd: 1.5,
  }, {
    stdout: { write: () => undefined },
    readLedger: async () => dogfoodLedger([]),
    withStreakLock: async (operation) => operation(),
    runDogfoodAttempt: async ({ attempt }) => entry(attempt, { outcome: 'gave-up' }),
  }));
  await assert.rejects(() => runDogfoodStreak({
    sha: SHA, authorize: true, capUsd: 14.01, initialReserveUsd: 1.5,
  }, {}), /must not exceed USD 14/u);
  await assert.rejects(() => runDogfoodStreak({
    sha: SHA, authorize: true, capUsd: 10, initialReserveUsd: 1.49,
  }, {}), /at least USD 1\.50/u);
});

test('dogfood ledger is hashed, validated, and append-only', async () => {
  const committed = dogfoodLedger([entry(1)]);
  const appended = dogfoodLedger([entry(1), entry(2)]);
  assert.deepEqual(validateDogfoodLedger(appended), appended);
  assert.doesNotThrow(() => assertAppendOnlyLedger(appended, committed));
  assert.throws(() => assertAppendOnlyLedger(dogfoodLedger([entry(1, { outcome: 'gave-up' }), entry(2)]), committed), /append-only/u);
  assert.throws(() => validateDogfoodLedger({ ...appended, resultHash: 'e'.repeat(64) }), /resultHash/u);

  const gaveUp = entry(1, { outcome: 'gave-up' });
  delete gaveUp.prUrl;
  const nextCandidate = dogfoodLedger([gaveUp, entry(1, { actionSha: 'f'.repeat(40) })]);
  assert.deepEqual(validateDogfoodLedger(nextCandidate), nextCandidate);
  assert.throws(() => validateDogfoodLedger(dogfoodLedger([
    entry(1), entry(2, { actionSha: 'f'.repeat(40) }),
  ])), /attempt sequence/u);
});

test('canonical fixture, ledger, and ignored scratch paths stay exact', async () => {
  const source = await readFile('packages/placebo/corpus/repair-dogfood-arithmetic/fixture/packages/core/src/dogfood-add.ts', 'utf8');
  const broken = await readFile('packages/placebo/corpus/repair-dogfood-arithmetic/break.diff', 'utf8');
  const repaired = await readFile('packages/placebo/corpus/repair-dogfood-arithmetic/repair.diff', 'utf8');
  const ignore = await readFile('.gitignore', 'utf8');
  const ledger = validateDogfoodLedger(JSON.parse(await readFile('docs/demo/dogfood-ledger.json', 'utf8')));
  const markdown = await readFile('docs/demo/dogfood-ledger.md', 'utf8');
  assert.match(source, /return left \+ right/u);
  assert.match(broken, /return left - right/u);
  assert.match(repaired, /-  return left - right;[\s\S]*\+  return left \+ right;/u);
  assert.equal(ledger.entries.length, 13);
  assert.deepEqual(ledger.entries.slice(-10).map(({ attempt, outcome }) => ({ attempt, outcome })),
    Array.from({ length: 10 }, (_, index) => ({ attempt: index + 1, outcome: 'fixed' })));
  assert.equal(ledger.resultHash,
    '42ddbff67eeb8f7ded9e59aa3da1ef91ec5c3733f0737260d0058e4a0e3dcd5f');
  assert.equal(markdown, renderDogfoodLedger(ledger));
  assert.match(ignore, /^\.sutura\/dogfood-ledger-scratch\.json$/mu);
  assert.match(ignore, /^\.sutura\/dogfood-artifacts\/$/mu);
});

test('dogfood executable equivalence note states both identities without overstating execution', () => {
  const markdown = renderDogfoodExecutableEquivalence({
    streakActionSha: SHA,
    releaseCommit: 'e'.repeat(40),
    executableFingerprint: 'f'.repeat(64),
    paths: ['action.yml', 'packages/action/action.yml', 'packages/action/dist/index.cjs'],
    fixedAttempts: 10,
    totalUsd: 12.345678,
    widerDifferences: ['packages/cli/src/setup.ts', 'packages/cli/src/setup.test.ts'],
  });
  assert.match(markdown, /Ten consecutive live repairs ran at `a{40}`/u);
  assert.match(markdown, /No dogfood run executed at `e{40}`/u);
  assert.match(markdown, /USD 12\.345678/u);
  assert.doesNotMatch(markdown, /ran at the v0\.2\.0 release/u);
});

test('dogfood validates the one intentional CI failure and SHA-bound Sutura check', () => {
  assert.deepEqual(validateFailedCiJobs([{ name: 'checks', steps: [
    { name: 'pnpm install --frozen-lockfile', conclusion: 'success' },
    { name: 'Run pnpm run test', conclusion: 'failure' },
  ] }]), { job: 'checks', step: 'Run pnpm run test' });
  assert.throws(() => validateFailedCiJobs([{ name: 'checks', steps: [
    { name: 'pnpm run test', conclusion: 'failure' },
  ] }]), /fail only/u);
  assert.throws(() => validateFailedCiJobs([{ name: 'checks', steps: [
    { name: 'pnpm run build', conclusion: 'failure' },
    { name: 'pnpm run test', conclusion: 'failure' },
  ] }]), /fail only/u);

  const check = {
    name: 'Sutura repair audit',
    external_id: 'sutura:juan294/sutura:workflow-run:1001',
    head_sha: DOGFOOD_SHA,
    status: 'completed',
    conclusion: 'neutral',
  };
  assert.equal(validateSuturaCheckRuns([check], {
    outcome: 'fixed', ciRunId: '1001', dogfoodSha: DOGFOOD_SHA,
  }), check);
  assert.throws(() => validateSuturaCheckRuns([{ ...check, conclusion: 'action_required' }], {
    outcome: 'fixed', ciRunId: '1001', dogfoodSha: DOGFOOD_SHA,
  }), /conclusion differs/u);

  assert.equal(costFromLog('Sandbox evidence: ok sandbox cost USD=0.250000', 'Sandbox evidence:'), 0.25);
  assert.throws(() => costFromLog('', 'Sandbox evidence:'), /exactly one/u);
  assert.throws(() => costFromLog([
    'Sandbox evidence: first sandbox cost USD=0.250000',
    'Sandbox evidence: duplicate sandbox cost USD=0.250000',
  ].join('\n'), 'Sandbox evidence:'), /exactly one/u);
  assert.equal(outcomeFromLog('Sutura outcome: refused'), 'refused');
  assert.throws(() => outcomeFromLog('Sutura outcome: fixed\nSutura outcome: fixed'), /exactly once/u);

  const replay = {
    runId: '1001', actionSha: SHA, outcome: 'fixed',
    completeness: { complete: true, pendingBoundaries: [], overflowedBoundaries: [] },
  };
  assert.deepEqual(validateDogfoodReplay(replay, {
    ciRunId: '1001', actionSha: SHA, outcome: 'fixed',
  }), { complete: true, zeroInference: false });
  assert.throws(() => validateDogfoodReplay({
    ...replay, completeness: { ...replay.completeness, pendingBoundaries: ['tavily'] },
  }, { ciRunId: '1001', actionSha: SHA, outcome: 'fixed' }), /completeness differs/u);
  assert.deepEqual(validateDogfoodReplay({
    ...replay,
    outcome: 'infra-stop',
    http: [],
    completeness: { complete: false, pendingBoundaries: ['nebius'], overflowedBoundaries: [] },
  }, { ciRunId: '1001', actionSha: SHA, outcome: 'infra-stop' }), {
    complete: false, zeroInference: true,
  });
  assert.equal(inferenceCostFromEvidence(
    'ConTree runtime: sandbox preparation failed before reproduction; triage=0/0',
    { zeroInference: true },
  ), 0);
  assert.throws(() => inferenceCostFromEvidence(
    'ConTree runtime: sandbox reproduction attempted; triage=0/0',
    { zeroInference: true },
  ), /exactly one/u);
});

test('dogfood parses exact GitHub CLI log prefixes from historical run 33269188958', async () => {
  const log = await readFile('scripts/__fixtures__/dogfood-gh-log-33269188958.txt', 'utf8');
  assert.equal(costFromLog(log, 'Sandbox evidence:'), 0.134053);
  assert.equal(costFromLog(log, 'Nemotron runtime:'), 0.000376);
  assert.equal(outcomeFromLog(log), 'gave-up');
});

test('dogfood real path validates dispatch, correlation, artifacts, repair, and exact-SHA CI', async () => {
  const repairSha = 'e'.repeat(40);
  const appended = [];
  const calls = [];
  const git = async (args, options = {}) => {
    calls.push(['git', ...args]);
    if (args[0] === 'worktree' && args[1] === 'add') {
      await mkdir(`${args[4]}/packages/core/src`, { recursive: true });
      return '';
    }
    if (args[0] === 'show') {
      assert.equal(options.trim, false);
      return args[1].endsWith('dogfood-add.test.ts')
        ? "import { add } from './dogfood-add.js';\nimport { expect, it } from 'vitest';\nit('adds', () => expect(add(2, 3)).toBe(5));\n"
        : 'export function add(left: number, right: number): number {\n  return left + right;\n}\n';
    }
    if (args[0] === 'rev-parse' && args[1] === 'HEAD' && options.cwd) return DOGFOOD_SHA;
    if (args[0] === 'rev-parse' && args[1] === 'FETCH_HEAD') return repairSha;
    if (args[0] === 'rev-parse' && args[1] === `${repairSha}^`) return DOGFOOD_SHA;
    if (args[0] === 'rev-parse' && args[1] === `${SHA}:packages`) return TREE;
    if (args[0] === 'diff' && args.includes('--name-only')) return 'packages/core/src/dogfood-add.ts';
    if (args[0] === 'diff') return readFile(
      'packages/placebo/corpus/repair-dogfood-arithmetic/repair.diff', 'utf8',
    );
    return '';
  };
  const gh = async (args) => {
    calls.push(['gh', ...args]);
    const joined = args.join(' ');
    if (joined.includes('run list --branch dogfood/')) return JSON.stringify([{
      databaseId: 3001, headSha: DOGFOOD_SHA, status: 'completed', conclusion: 'failure', event: 'workflow_dispatch',
    }]);
    if (joined.includes('run view 3001 --json jobs')) return JSON.stringify({ jobs: [{
      name: 'checks', steps: [{ name: 'Run pnpm run test', conclusion: 'failure' }],
    }] });
    if (joined.includes('run list --workflow sutura.yml')) return JSON.stringify([{
      databaseId: 4001, status: 'completed', conclusion: 'success',
    }]);
    if (joined.includes('run download 4001')) {
      const directory = args[args.indexOf('--dir') + 1];
      await mkdir(`${directory}/artifacts`, { recursive: true });
      await writeFile(`${directory}/artifacts/sutura-case-file-3001.html`, '<html></html>');
      await writeFile(`${directory}/artifacts/sutura-replay-3001.json`, '{}');
      return '';
    }
    if (joined.includes('run view 4001 --log')) return [
      'Sandbox evidence: ok sandbox cost USD=0.200000',
      'Nemotron runtime: ok inference cost USD=0.300000',
      'Sutura outcome: fixed',
    ].join('\n');
    if (joined.includes('pr list')) return JSON.stringify([{
      url: 'https://github.com/juan294/sutura/pull/99',
      headRefName: 'sutura/fix-3001',
      headRefOid: repairSha,
    }]);
    if (joined.includes('run list --branch sutura/fix-3001')) return JSON.stringify([{
      headSha: repairSha, status: 'completed', conclusion: 'success',
    }]);
    return '';
  };
  const ghApi = async (endpoint) => {
    if (endpoint.includes('/actions/runs/4001/artifacts')) return JSON.stringify({
      total_count: 1,
      artifacts: [{ name: 'sutura-case-file-3001.html' }],
    });
    if (endpoint.includes(`/commits/${DOGFOOD_SHA}/check-runs`)) return JSON.stringify({ check_runs: [{
      name: 'Sutura repair audit',
      external_id: 'sutura:juan294/sutura:workflow-run:3001',
      head_sha: DOGFOOD_SHA,
      status: 'completed',
      conclusion: 'neutral',
    }] });
    throw new Error(`unexpected endpoint ${endpoint}`);
  };
  const result = await runDogfoodAttempt({ sha: SHA, attempt: 1 }, {
    gate: async () => undefined,
    git, gh, ghApi,
    now: () => NOW,
    parseReplayArtifact: () => ({
      runId: '3001', actionSha: SHA, outcome: 'fixed',
      completeness: { complete: true, pendingBoundaries: [], overflowedBoundaries: [] },
    }),
    appendEntry: async (value) => { appended.push(value); },
  });
  assert.equal(result.outcome, 'fixed');
  assert.equal(result.bundleSha256.length, 64);
  assert.deepEqual(appended, [result]);
  assert.ok(calls.some((call) => call.join(' ').includes('workflow run ci.yml --ref dogfood/')));
  assert.ok(calls.some((call) => call.join(' ').includes('workflow run ci.yml --ref sutura/fix-3001')));
  assert.ok(calls.some((call) => call.join(' ').includes('fetch origin sutura/fix-3001')));
});
