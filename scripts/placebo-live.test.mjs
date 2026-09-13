import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  appendPlaceboLedger,
  recordRemoteArtifact,
  runRemoteCase,
  recoverPendingPlaceboCase,
  assertPublicArtifactSafe,
  createPlaceboCaseArtifact,
  createPlaceboLedger,
  finalizePlaceboEvidence,
  placeboSpendDecision,
  redactPublicArtifact,
  main,
  orderedPlaceboCaseIds,
  runSinglePlaceboCase,
  runPlaceboStreak,
  dispatchPlaceboWorkflow,
  validatePlaceboCaseArtifact,
  validatePlaceboLedger,
} from './placebo-live.mjs';

const CONTROLLER_SHA = 'a'.repeat(40);
const SUBJECT_SHA = 'a943ded4c734aed75c5c63f2b2dd63a2f44556c2';
const PACKAGE_HASH = '999e189d91dc52383361e739f075056622308da6360b5d9187fea8f303330572';
const PACKAGE_INTEGRITY = '6365ab9af9cfcef0cdfe1441b95c9de2ff504e2181e77fdf5669ff92eef3937f';
const RECORDED_AT = '2026-08-31T12:00:00.000Z';
const corpus = JSON.parse(await readFile('docs/demo/placebo-v0.2-corpus.json', 'utf8'));

test('v0.2.1 controller state is ignored before the lock-protected gate runs', async () => {
  const ignore = await readFile('.gitignore', 'utf8');
  assert.match(ignore, /^\.sutura\/placebo-v0\.2\.1-live-ledger\.json$/mu);
  assert.match(ignore, /^\.sutura\/placebo-v0\.2\.1-live\.lock$/mu);
  assert.match(ignore, /^\.sutura\/placebo-v0\.2\.1-live-artifacts\/$/mu);
  assert.match(ignore, /^\.sutura\/placebo-v0\.2\.1-failed-runs\/$/mu);
});

function result(corpusCase, tavilyEnabled = true, overrides = {}) {
  return {
    caseId: corpusCase.id,
    kind: corpusCase.metadata.kind,
    language: corpusCase.metadata.language,
    tavilyEnabled,
    elapsedTimeMs: 1_000,
    caseFile: {
      outcome: corpusCase.metadata.kind === 'trap' ? 'refused' :
        corpusCase.metadata.kind === 'flaky' ? 'flaky-no-patch' : 'fixed',
      audit: {
        approved: corpusCase.metadata.kind !== 'trap', checks: [], reasoning: 'fixture',
      },
      cost: { entries: [{ role: 'super', model: 'model', inTok: 1, outTok: 1, reasoningTok: 0, usd: 0.01 }] },
      stages: [{
        stage: 'reproduction', attempt: 1, nodeId: 'node-001', metrics: { cost: 0.02 },
        network: 'disabled', operationId: `operation-${corpusCase.id}`,
      }],
      trace: [{ type: 'run-finish', stage: 'run', outcome: 'fixed' }],
      ...overrides,
    },
  };
}

function artifact(caseId, overrides = {}) {
  const corpusCase = corpus.cases.find((value) => value.id === caseId);
  const caseIndex = corpus.cases.findIndex((value) => value.id === caseId);
  const results = corpusCase.metadata.kind === 'upstream'
    ? [result(corpusCase, true), result(corpusCase, false)]
    : [result(corpusCase)];
  return createPlaceboCaseArtifact({
    controllerSha: CONTROLLER_SHA,
    githubRunId: String(1000 + caseIndex),
    subjectVersion: '0.2.1',
    subjectSha: SUBJECT_SHA,
    packageContentHash: PACKAGE_HASH,
    packageIntegrity: PACKAGE_INTEGRITY,
    caseId,
    results,
    evaluationManifest: {
      schemaVersion: 'sutura-evaluation-v1', suturaCommit: CONTROLLER_SHA,
      corpusHash: corpus.corpusHash, cases: results.map(({ tavilyEnabled }) => ({
        caseId: `${caseId}:${tavilyEnabled ? 'with-tavily' : 'without-tavily'}`,
      })),
    },
    artifactName: `sutura-placebo-live-test-${caseId}`,
    ...overrides,
  }, { corpus });
}

function append(ledger, value, index) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  return appendPlaceboLedger(ledger, value, {
    artifactBytes: bytes,
    runUrl: `https://github.com/juan294/sutura/actions/runs/${value.githubRunId}`,
    recordedAt: new Date(Date.parse(RECORDED_AT) + index).toISOString(),
  }, { corpus });
}

test('case artifacts bind exact identities, costs, and one canonical case', () => {
  const value = artifact('repair-off-by-one');
  assert.equal(value.evaluationCount, 1);
  assert.equal(value.inferenceUsd, 0.01);
  assert.equal(value.sandboxUsd, 0.02);
  assert.equal(value.totalUsd, 0.03);
  assert.match(value.resultHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(validatePlaceboCaseArtifact(value, { corpus }), value);
  assert.throws(() => validatePlaceboCaseArtifact({ ...value, subjectSha: CONTROLLER_SHA }, { corpus }), /resultHash|subject/u);
  assert.throws(() => createPlaceboCaseArtifact({
    ...value, caseId: 'unknown-case', evaluationManifest: {
      schemaVersion: 'sutura-evaluation-v1', suturaCommit: CONTROLLER_SHA,
      corpusHash: corpus.corpusHash, cases: value.results.map(({ tavilyEnabled }) => ({
        caseId: `unknown-case:${tavilyEnabled ? 'with-tavily' : 'without-tavily'}`,
      })),
    },
  }, { corpus }), /canonical case/u);
});

test('public artifact safety rejects credential values and private local paths', () => {
  assert.equal(assertPublicArtifactSafe({ result: 'safe' }).result, 'safe');
  assert.throws(() => assertPublicArtifactSafe({ value: 'secret-value' }, ['secret-value']), /credential/u);
  assert.throws(() => assertPublicArtifactSafe({ path: '/Users/person/private' }), /private local path/u);
});

test('public artifact redaction removes sensitive strings before fail-closed validation', () => {
  const input = {
    diagnosis: 'Authorization: Bearer bearer-token /Users/person/private secret-value',
    trace: [
      'C:\\Users\\person\\private',
      'github_pat_abcdefghijklmnopqrstuvwxyz',
      'sk-abcdefghijklmnopqrstuvwxyz',
    ],
  };
  const redacted = redactPublicArtifact(input, ['secret-value']);
  assert.deepEqual(redacted.summary, { credentialValues: 4, privatePaths: 2 });
  assert.doesNotMatch(JSON.stringify(redacted.value), /secret-value|\/Users\/person|C:\\Users\\person|github_pat_|sk-/u);
  assert.equal(redacted.value.diagnosis.endsWith('[REDACTED_PRIVATE_PATH] [REDACTED_CREDENTIAL]'), true);
  assert.equal(redacted.value.trace[0], '[REDACTED_PRIVATE_PATH]');
  assert.deepEqual(assertPublicArtifactSafe(redacted.value, ['secret-value']), redacted.value);
  assert.equal(input.diagnosis.endsWith('secret-value'), true);
});

test('case artifacts bind a deterministic public redaction summary', () => {
  const value = artifact('repair-off-by-one', {
    redactions: { credentialValues: 2, privatePaths: 1 },
  });
  assert.deepEqual(value.redactions, { credentialValues: 2, privatePaths: 1 });
  assert.deepEqual(validatePlaceboCaseArtifact(value, { corpus }), value);
  assert.throws(() => validatePlaceboCaseArtifact({
    ...value, redactions: { credentialValues: -1, privatePaths: 0 },
  }, { corpus }), /redaction summary/u);
});

test('upstream artifacts require their exact Tavily pair', () => {
  const value = artifact('upstream-client-release');
  assert.equal(value.evaluationCount, 2);
  assert.deepEqual(value.results.map(({ tavilyEnabled }) => tavilyEnabled), [true, false]);
  assert.throws(() => createPlaceboCaseArtifact({
    ...value, results: value.results.slice(0, 1), evaluationManifest: {
      schemaVersion: 'sutura-evaluation-v1', suturaCommit: CONTROLLER_SHA,
      corpusHash: corpus.corpusHash,
      cases: [{ caseId: `${value.caseId}:with-tavily` }],
    },
  }, { corpus }), /Tavily pair/u);
});

test('ledger append is deterministic, resumable, and mutation-safe', () => {
  const first = artifact('flaky-timer-race');
  const second = artifact('repair-off-by-one');
  const once = append(createPlaceboLedger([]), first, 1);
  const twice = append(once, second, 2);
  assert.deepEqual(validatePlaceboLedger(twice), twice);
  assert.equal(twice.entries.length, 2);
  assert.throws(() => append(twice, first, 3), /duplicate/u);
  assert.throws(() => validatePlaceboLedger({
    ...twice,
    entries: [{ ...twice.entries[0], caseId: 'repair-missing-await' }, ...twice.entries.slice(1)],
  }), /resultHash/u);
});

test('spend reserve stops before dispatch can exceed the cap', () => {
  assert.deepEqual(placeboSpendDecision({ spentUsd: 1, observedMaximumUsd: 0.4, initialReserveUsd: 0.5, capUsd: 1.5 }), {
    reserveUsd: 0.5, mayDispatch: true,
  });
  assert.deepEqual(placeboSpendDecision({ spentUsd: 1.1, observedMaximumUsd: 0.6, initialReserveUsd: 0.5, capUsd: 1.5 }), {
    reserveUsd: 0.6, mayDispatch: false,
  });
});

test('single run rejects missing or excessive reserve before entering the live path', async () => {
  const base = [
    'run', '--controller-sha', CONTROLLER_SHA, '--subject-sha', CONTROLLER_SHA,
    '--case', 'repair-off-by-one', '--authorize',
  ];
  await assert.rejects(() => main(base), /--cap-usd requires a value/u);
  await assert.rejects(
    () => main([...base, '--cap-usd', '0.25', '--initial-reserve-usd', '0.30']),
    /reserve must not exceed cap/u,
  );
});

test('single run gates before reading the ledger and refuses cap-reserve before dispatch', async () => {
  const existing = append(createPlaceboLedger([]), artifact('flaky-timer-race'), 1);
  const events = [];
  await assert.rejects(() => runSinglePlaceboCase({
    controllerSha: CONTROLLER_SHA, subjectSha: SUBJECT_SHA,
    caseId: 'repair-off-by-one', capUsd: 0.05, initialReserveUsd: 0.03,
  }, {
    gate: async () => { events.push('gate'); },
    readLedger: async () => { events.push('ledger'); return existing; },
    runCase: async () => { events.push('dispatch'); },
  }), /cap-reserve/u);
  assert.deepEqual(events, ['gate', 'ledger']);
});

test('single run refuses a duplicate case before dispatch', async () => {
  const caseId = 'flaky-timer-race';
  const existing = append(createPlaceboLedger([]), artifact(caseId), 1);
  let dispatched = false;
  await assert.rejects(() => runSinglePlaceboCase({
    controllerSha: CONTROLLER_SHA, subjectSha: SUBJECT_SHA,
    caseId, capUsd: 1, initialReserveUsd: 0.1,
  }, {
    gate: async () => {},
    readLedger: async () => existing,
    runCase: async () => { dispatched = true; },
  }), /duplicate case/u);
  assert.equal(dispatched, false);
});

test('single run refuses a terminal safety ledger before dispatch', async () => {
  const terminalArtifacts = [
    artifact('python-flaky-timer', {
      results: [result(corpus.cases.find(({ id }) => id === 'python-flaky-timer'), true, {
        outcome: 'infra-stop', audit: { approved: false, checks: [], reasoning: 'infrastructure' },
      })],
    }),
    artifact('trap-skipped-test', {
      results: [result(corpus.cases.find(({ id }) => id === 'trap-skipped-test'), true, {
        outcome: 'fixed', audit: { approved: true, checks: [], reasoning: 'unsafe' },
      })],
    }),
  ];
  for (const terminal of terminalArtifacts) {
    const existing = append(createPlaceboLedger([]), terminal, 1);
    let dispatched = false;
    await assert.rejects(() => runSinglePlaceboCase({
      controllerSha: CONTROLLER_SHA, subjectSha: SUBJECT_SHA,
      caseId: 'repair-off-by-one', capUsd: 10, initialReserveUsd: 0.5,
    }, {
      gate: async () => {},
      readLedger: async () => existing,
      runCase: async () => { dispatched = true; },
    }), /(?:infrastructure-stop|false-approval) ledger/u);
    assert.equal(dispatched, false);
  }
});

test('workflow dispatch checks the active freeze at the final dispatch edge', async () => {
  const events = [];
  await dispatchPlaceboWorkflow({
    controllerSha: CONTROLLER_SHA,
    subjectSha: CONTROLLER_SHA,
    caseId: 'repair-off-by-one',
    controllerId: 'pl-test-controller',
  }, {
    requireActivePushFreeze: () => { events.push('freeze'); },
    command: async (name, args) => { events.push(`${name}:${args.slice(0, 2).join(' ')}`); },
  });
  assert.deepEqual(events, ['freeze', 'gh:workflow run']);

  let dispatched = false;
  await assert.rejects(() => dispatchPlaceboWorkflow({
    controllerSha: CONTROLLER_SHA,
    subjectSha: CONTROLLER_SHA,
    caseId: 'repair-off-by-one',
    controllerId: 'pl-test-controller',
  }, {
    requireActivePushFreeze: () => { throw new Error('freeze missing'); },
    command: async () => { dispatched = true; },
  }), /freeze missing/u);
  assert.equal(dispatched, false);
});

test('streak resumes and stops immediately after a false approval', async () => {
  const ids = ['flaky-timer-race', 'trap-skipped-test', 'repair-off-by-one'];
  let ledger = createPlaceboLedger([]);
  const dispatched = [];
  const resultValue = await runPlaceboStreak({
    controllerSha: CONTROLLER_SHA, subjectSha: SUBJECT_SHA, authorize: true,
    capUsd: 10, initialReserveUsd: 0.5, caseIds: ids,
  }, {
    readLedger: async () => ledger,
    runCase: async (caseId) => {
      dispatched.push(caseId);
      const value = caseId === 'trap-skipped-test'
        ? artifact(caseId, { results: [result(corpus.cases.find(({ id }) => id === caseId), true, {
            outcome: 'fixed', audit: { approved: true, checks: [], reasoning: 'unsafe' },
          })] })
        : artifact(caseId);
      ledger = append(ledger, value, dispatched.length);
      return { artifact: value, ledger };
    },
  });
  assert.deepEqual(dispatched, ['flaky-timer-race', 'trap-skipped-test']);
  assert.equal(resultValue.stoppedFor, 'false-approval');
});

test('streak stops immediately after an infrastructure stop', async () => {
  const ids = ['python-flaky-timer', 'repair-off-by-one'];
  let ledger = createPlaceboLedger([]);
  const dispatched = [];
  const resultValue = await runPlaceboStreak({
    controllerSha: CONTROLLER_SHA, subjectSha: SUBJECT_SHA, authorize: true,
    capUsd: 10, initialReserveUsd: 0.5, caseIds: ids,
  }, {
    readLedger: async () => ledger,
    runCase: async (caseId) => {
      dispatched.push(caseId);
      const value = artifact(caseId, { results: [result(corpus.cases.find(({ id }) => id === caseId), true, {
        outcome: 'infra-stop', audit: { approved: false, checks: [], reasoning: 'infrastructure' },
      })] });
      ledger = append(ledger, value, dispatched.length);
      return { artifact: value, ledger };
    },
  });
  assert.deepEqual(dispatched, ['python-flaky-timer']);
  assert.equal(resultValue.stoppedFor, 'infra-stop');
});

test('streak never dispatches after resuming an infrastructure-stop ledger', async () => {
  const caseId = 'python-flaky-timer';
  const value = artifact(caseId, { results: [result(corpus.cases.find(({ id }) => id === caseId), true, {
    outcome: 'infra-stop', audit: { approved: false, checks: [], reasoning: 'infrastructure' },
  })] });
  const ledger = append(createPlaceboLedger([]), value, 1);
  const resultValue = await runPlaceboStreak({
    controllerSha: CONTROLLER_SHA, subjectSha: SUBJECT_SHA, authorize: true,
    capUsd: 10, initialReserveUsd: 0.5, caseIds: [caseId, 'repair-off-by-one'],
  }, {
    readLedger: async () => ledger,
    runCase: async () => { throw new Error('must not dispatch'); },
  });
  assert.equal(resultValue.stoppedFor, 'infra-stop');
  assert.equal(resultValue.ledger.entries.length, 1);
});

test('streak refuses to resume a ledger from another controller', async () => {
  const value = artifact('repair-off-by-one');
  const ledger = append(createPlaceboLedger([]), value, 1);
  const changed = createPlaceboLedger(ledger.entries.map((entry) => ({
    ...entry, controllerSha: 'b'.repeat(40),
  })));
  await assert.rejects(() => runPlaceboStreak({
    controllerSha: CONTROLLER_SHA, subjectSha: SUBJECT_SHA, authorize: true,
    capUsd: 10, initialReserveUsd: 0.5, caseIds: ['repair-bad-import'],
  }, {
    readLedger: async () => changed,
    runCase: async () => { throw new Error('must not dispatch'); },
  }), /identity differs/u);
});

test('streak rechecks the freeze before each eligible case', async () => {
  const ids = ['flaky-timer-race', 'repair-off-by-one'];
  let ledger = createPlaceboLedger([]);
  let checks = 0;
  let dispatches = 0;
  await assert.rejects(() => runPlaceboStreak({
    controllerSha: CONTROLLER_SHA, subjectSha: SUBJECT_SHA, authorize: true,
    capUsd: 10, initialReserveUsd: 0.5, caseIds: ids,
  }, {
    readLedger: async () => ledger,
    runCase: async (caseId) => {
      await dispatchPlaceboWorkflow({
        controllerSha: CONTROLLER_SHA, subjectSha: SUBJECT_SHA, caseId,
        controllerId: `pl-streak-${caseId}`,
      }, {
        requireActivePushFreeze: () => {
          checks += 1;
          if (checks === 2) throw new Error('freeze ended');
        },
        command: async () => { dispatches += 1; },
      });
      const value = artifact(caseId);
      ledger = append(ledger, value, dispatches);
      return { artifact: value, ledger };
    },
  }), /freeze ended/u);
  assert.equal(checks, 2);
  assert.equal(dispatches, 1);
});

test('finalizer requires all 51 cases and 55 retained evaluations', async () => {
  const artifacts = corpus.cases.map(({ id }) => artifact(id));
  let ledger = createPlaceboLedger([]);
  artifacts.forEach((value, index) => { ledger = append(ledger, value, index + 1); });
  const finalized = await finalizePlaceboEvidence(ledger, artifacts, {
    corpus,
    scoreResults: (results) => ({ retained: results.length }),
  });
  assert.equal(finalized.caseCount, 51);
  assert.equal(finalized.evaluationCount, 55);
  assert.deepEqual(finalized.score, { retained: 55 });
  await assert.rejects(() => finalizePlaceboEvidence(
    createPlaceboLedger(ledger.entries.slice(0, 50)), artifacts.slice(0, 50), {
      corpus, scoreResults: () => ({}),
    },
  ), /51 canonical cases/u);
});

test('the expanded selection reaches versioned cases without widening the frozen one', async () => {
  const { readFileSync } = await import('node:fs');
  const frozen = JSON.parse(readFileSync('docs/demo/placebo-v0.2-corpus.json', 'utf8'));
  const expanded = JSON.parse(readFileSync('docs/demo/placebo-v0.2-expanded-corpus.json', 'utf8'));

  assert.equal(frozen.cases.length, 51);
  assert.equal(frozen.corpusHash, '785cfc70359935a0f04a9a9cda39e8fb6ff4b05cc8fea3738fb24b70bcda101f');
  assert.equal(expanded.cases.length, 100);
  assert.notEqual(expanded.corpusHash, frozen.corpusHash);
  assert.equal(expanded.corpusHash, 'd4757a557e3376b8610c7e0ecc3b6660f5f2ca10d2fbee43e04ebaa617e4d136');

  // The expanded selection contains every frozen case, so opting in adds and never replaces.
  const expandedIds = new Set(expanded.cases.map(({ id }) => id));
  for (const { id } of frozen.cases) assert.ok(expandedIds.has(id), `${id} missing from expanded`);

  // The default selection is still exactly the frozen slice.
  assert.equal(orderedPlaceboCaseIds().length, 51);
  const frozenIds = new Set(frozen.cases.map(({ id }) => id));
  for (const id of orderedPlaceboCaseIds()) assert.ok(frozenIds.has(id), `${id} is not frozen`);

  // Cases the verified repair program added exist only in the expanded selection.
  for (const id of ['repair-off-by-one-preservation', 'repair-two-file-export-contract']) {
    assert.ok(expandedIds.has(id), `${id} missing from expanded`);
    assert.ok(!frozenIds.has(id), `${id} leaked into the frozen slice`);
  }
});

test('a ledger holds one entry per case in the expanded selection, not only the frozen slice', () => {
  const entry = (index) => ({
    artifactName: `sutura-placebo-pl-1-case-${index}`,
    artifactSha256: 'a'.repeat(64),
    caseId: `case-${index}`,
    controllerSha: 'c'.repeat(40),
    evaluationCount: 1,
    inferenceUsd: 0.001,
    outcomes: ['fixed'],
    packageContentHash: 'd'.repeat(64),
    packageIntegrity: 'f'.repeat(64),
    recordedAt: '2026-09-06T12:00:00.000Z',
    resultHash: 'e'.repeat(64),
    runId: String(1000 + index),
    runUrl: `https://github.com/juan294/sutura/actions/runs/${1000 + index}`,
    sandboxUsd: 0.06,
    subjectSha: 'c'.repeat(40),
    totalUsd: 0.061,
  });

  // 80 entries is a development plus validation run; 51 was the frozen slice.
  const eighty = createPlaceboLedger(Array.from({ length: 80 }, (_unused, index) => entry(index)));
  assert.equal(validatePlaceboLedger(eighty).entries.length, 80);

  const hundred = createPlaceboLedger(Array.from({ length: 100 }, (_unused, index) => entry(index)));
  assert.equal(validatePlaceboLedger(hundred).entries.length, 100);

  const tooMany = createPlaceboLedger(Array.from({ length: 101 }, (_unused, index) => entry(index)));
  assert.throws(() => validatePlaceboLedger(tooMany), /schema or resultHash is invalid/u);
});

test('continuing past a recorded infrastructure stop needs a deliberate opt-in', async () => {
  const entry = {
    artifactName: 'sutura-placebo-pl-1-flaky-timer-race',
    artifactSha256: 'a'.repeat(64),
    caseId: 'flaky-timer-race',
    controllerSha: 'c'.repeat(40),
    evaluationCount: 1,
    inferenceUsd: 0.001,
    outcomes: ['infra-stop'],
    packageContentHash: 'd'.repeat(64),
    packageIntegrity: 'f'.repeat(64),
    recordedAt: '2026-09-07T12:00:00.000Z',
    resultHash: 'e'.repeat(64),
    runId: '1001',
    runUrl: 'https://github.com/juan294/sutura/actions/runs/1001',
    sandboxUsd: 0.06,
    subjectSha: 'c'.repeat(40),
    totalUsd: 0.061,
  };
  const options = {
    controllerSha: 'c'.repeat(40), subjectSha: 'c'.repeat(40),
    caseId: 'repair-off-by-one', capUsd: 10, initialReserveUsd: 0.5,
  };
  const dependencies = {
    gate: async () => undefined,
    readLedger: async () => createPlaceboLedger([entry]),
    runCase: async () => 'dispatched',
  };

  const previous = process.env.SUTURA_ALLOW_INFRA_STOP_LEDGER;
  delete process.env.SUTURA_ALLOW_INFRA_STOP_LEDGER;
  try {
    await assert.rejects(() => runSinglePlaceboCase(options, dependencies),
      /refuses to continue an infrastructure-stop ledger/u);

    // The opt-in continues; it never removes the recorded infra-stop.
    process.env.SUTURA_ALLOW_INFRA_STOP_LEDGER = '1';
    assert.equal(await runSinglePlaceboCase(options, dependencies), 'dispatched');
  } finally {
    if (previous === undefined) delete process.env.SUTURA_ALLOW_INFRA_STOP_LEDGER;
    else process.env.SUTURA_ALLOW_INFRA_STOP_LEDGER = previous;
  }
});

test('paid CLI commands require a run manifest before gating or dispatch', async () => {
  for (const command of ['run', 'streak']) {
    await assert.rejects(() => main([
      command, '--controller-sha', CONTROLLER_SHA, '--subject-sha', SUBJECT_SHA,
      '--case', 'repair-off-by-one', '--authorize', '--cap-usd', '1', '--initial-reserve-usd', '0.2',
    ]), /--run-manifest requires a value/u);
  }
});

test('artifact/ledger crash recovery records a completed job once', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'placebo-recovery-'));
  t.after(() => rm(directory, { recursive:true, force:true }));
  const value = artifact('repair-off-by-one');
  const bytes = Buffer.from(JSON.stringify(value));
  const input = { artifact:value, bytes, run:{url:`https://github.com/juan294/sutura/actions/runs/${value.githubRunId}`}, stateDirectory:directory };
  await assert.rejects(recordRemoteArtifact(input, {afterArtifactWrite:async()=>{throw Error('simulated process death');}}), /process death/);
  assert.deepEqual(JSON.parse(await readFile(join(directory,'placebo-v0.2.1-live-artifacts/repair-off-by-one.json'))), value);
  const first = await recordRemoteArtifact(input);
  const resumed = await recordRemoteArtifact(input);
  assert.equal(first.entries.length,1); assert.deepEqual(resumed,first);
  const changed = artifact('repair-off-by-one',{githubRunId:'999'});
  await assert.rejects(recordRemoteArtifact({...input,artifact:changed,bytes:Buffer.from(JSON.stringify(changed))}), /conflict/);
});
test('reattach pending job and retry interrupted download without dispatch', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'placebo-download-'));
  t.after(() => rm(directory, {recursive:true,force:true}));
  const value=artifact('repair-off-by-one',{artifactName:'sutura-placebo-pending-controller-repair-off-by-one'});
  let downloads=0;
  const dependencies={
    stateDirectory:directory,
    sleep:async()=>{},
    pollRun:async (controller,caseId,sha,options)=>{
      assert.equal(controller,'pending-controller');assert.equal(options.runId,'123');
      return {databaseId:value.githubRunId,url:`https://github.com/juan294/sutura/actions/runs/${value.githubRunId}`};
    },
    command:async (_name,args)=>{
      assert.deepEqual(args.slice(0,2),['run','download']);
      const target=args[args.indexOf('--dir')+1];
      assert.deepEqual(await readdir(target),[]);
      if(++downloads===1){await writeFile(join(target,'partial.json'),'{');throw Object.assign(Error('read failure'),{stderr:'net/http: TLS handshake timeout'});}
      await writeFile(join(target,'case.json'),JSON.stringify(value));
    },
  };
  const result=await runRemoteCase({controllerSha:CONTROLLER_SHA,subjectSha:SUBJECT_SHA,caseId:'repair-off-by-one',controllerId:'pending-controller',runId:'123',resumed:true,skipGate:true},dependencies);
  assert.equal(downloads,2);assert.equal(result.ledger.entries.length,1);
});

test('ambiguous dispatch response attaches to its job without a second dispatch', async (t) => {
  const directory=await mkdtemp(join(tmpdir(),'placebo-ambiguous-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const value=artifact('repair-off-by-one',{artifactName:'sutura-placebo-pending-controller-repair-off-by-one'});
  let dispatches=0;
  await runRemoteCase({controllerSha:CONTROLLER_SHA,subjectSha:SUBJECT_SHA,caseId:'repair-off-by-one',controllerId:'pending-controller',skipGate:true},{
    stateDirectory:directory,
    requireActivePushFreeze:async()=>{},
    pollRun:async()=>({databaseId:value.githubRunId,url:`https://github.com/juan294/sutura/actions/runs/${value.githubRunId}`}),
    command:async (_name,args)=>{
      if(args[0]==='workflow'){dispatches++;throw Object.assign(Error('lost response'),{stderr:'unexpected EOF'});}
      assert.deepEqual(args.slice(0,2),['run','download']);
      await writeFile(join(args[args.indexOf('--dir')+1],'case.json'),JSON.stringify(value));
    },
  });
  assert.equal(dispatches,1);
});

test('a recovered approved trap remains a durable stop even with a nonfixed outcome', async () => {
  const selected=corpus.cases.find(c=>c.metadata.kind==='trap');
  const value=artifact(selected.id,{subjectSha:CONTROLLER_SHA,results:[result(selected,true,{outcome:'refused',audit:{approved:true,checks:[],reasoning:'deceptive'}})]});
  const ledger=append(createPlaceboLedger([]),value,0);
  assert.equal(ledger.entries[0].falseApproval,true);
  const resumed=await runPlaceboStreak({controllerSha:CONTROLLER_SHA,subjectSha:CONTROLLER_SHA,authorize:true,capUsd:1,initialReserveUsd:0.1,caseIds:['repair-off-by-one']},{readLedger:async()=>ledger,runCase:()=>assert.fail('must not dispatch after false approval')});
  assert.equal(resumed.stoppedFor,'false-approval');
});

test('startup recovery forwards the saved pending identity without preflight or redispatch', async () => {
  const saved={caseId:'repair-off-by-one',controllerId:'pl-saved-job',runId:'123',resumed:true,checkpointRun:async()=>{}};
  const result=await recoverPendingPlaceboCase({controllerSha:CONTROLLER_SHA,subjectSha:SUBJECT_SHA},{
    readPending:async()=>saved,
    withSpend:async(options,operation)=>{assert.equal(options.recoverPending,true);assert.equal(options.caseId,saved.caseId);return operation(saved);},
    runCase:async input=>{assert.equal(input.controllerId,saved.controllerId);assert.equal(input.runId,saved.runId);assert.equal(input.resumed,true);assert.equal(input.skipGate,true);return 'recovered';},
  });
  assert.equal(result,'recovered');
});
test('fresh single-case false approval reports a terminal stop', async () => {
  const selected=corpus.cases.find(c=>c.metadata.kind==='trap');
  const value=artifact(selected.id,{results:[result(selected,true,{outcome:'refused',audit:{approved:true,checks:[],reasoning:'deceptive'}})]});
  const completed=await runSinglePlaceboCase({controllerSha:CONTROLLER_SHA,subjectSha:SUBJECT_SHA,caseId:selected.id,capUsd:1,initialReserveUsd:0.1},{gate:async()=>{},readLedger:async()=>createPlaceboLedger([]),runCase:async()=>({artifact:value})});
  assert.equal(completed.stoppedFor,'false-approval');
});
