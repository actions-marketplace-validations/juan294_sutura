import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  FILES,
  bump,
  check,
  deploy,
  newestReleaseTag,
  publishDemo,
  run,
} from './release-case-lab.mjs';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'release-case-lab.mjs');

const NEWEST_TAG = 'v0.3.0';
const NEWEST_COMMIT = 'c94eee2086b31450d975137a0102dda18522d0b8';
const V020_COMMIT = 'a943ded4c734aed75c5c63f2b2dd63a2f44556c2';
const V021_TAG_OBJECT = '1111111111111111111111111111111111111a';
const V021_COMMIT = '2222222222222222222222222222222222222b';
const V090_TAG_OBJECT = '8888888888888888888888888888888888888e';
const V090_COMMIT = '9999999999999999999999999999999999999f';
const RESULT_PATH = 'docs/demo/placebo-v0.3.0-live-2026-09-16.json';
const LEDGER_PATH = 'docs/demo/placebo-v0.3.0-live-ledger-2026-09-16.json';
const EVIDENCE_URL = `https://github.com/juan294/sutura/blob/develop/${RESULT_PATH}`;

async function withTempDirectory(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-release-case-lab-'));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeFixtureFile(directory, path, content) {
  const full = join(directory, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
}

async function buildConsistentTree(directory) {
  await writeFixtureFile(directory, FILES.release, `${JSON.stringify({
    version: '0.3.0',
    actionSha: NEWEST_COMMIT,
  }, null, 2)}\n`);
  await writeFixtureFile(directory, FILES.workflow, [
    'name: Case Lab',
    'env:',
    `  SUTURA_ACTION_SHA: ${NEWEST_COMMIT}`,
    `  SUTURA_CONTROLLER_SHA: ${NEWEST_COMMIT}`,
    'jobs:',
    '  case:',
    '    steps:',
    '      - name: Run Sutura at the exact release',
    `        uses: juan294/sutura/packages/action@${NEWEST_COMMIT}`,
    '',
  ].join('\n'));
  await writeFixtureFile(directory, FILES.evidence, [
    `export const RECORDED_RESULT_FILE = '${RESULT_PATH}';`,
    `export const RECORDED_LEDGER_FILE = '${LEDGER_PATH}';`,
    '',
  ].join('\n'));
  await writeFixtureFile(directory, FILES.replay, [
    `const EVIDENCE_URL = '${EVIDENCE_URL}';`,
    '',
  ].join('\n'));
  await writeFixtureFile(directory, RESULT_PATH, `${JSON.stringify({
    subjectSha: NEWEST_COMMIT,
    subjectVersion: '0.3.0',
    ledgerHash: 'ledgerhash123',
  }, null, 2)}\n`);
  await writeFixtureFile(directory, LEDGER_PATH, `${JSON.stringify({
    resultHash: 'ledgerhash123',
  }, null, 2)}\n`);
}

function noisyIo() {
  const out = [];
  const err = [];
  return { out, err, stdout: { write: (text) => out.push(text) }, stderr: { write: (text) => err.push(text) } };
}

/** git stub with only v0.3.0 present and reachable from origin/main. */
function simpleGitStub() {
  return async (args) => {
    if (args[0] === 'ls-remote') {
      return [
        `1234567890123456789012345678901234567890\trefs/tags/${NEWEST_TAG}`,
        `${NEWEST_COMMIT}\trefs/tags/${NEWEST_TAG}^{}`,
      ].join('\n');
    }
    if (args[0] === 'fetch') return '';
    if (args[0] === 'merge-base') return '';
    throw new Error(`unstubbed git command: ${args.join(' ')}`);
  };
}

/** git stub with v0.2.0 (lightweight), v0.2.1 (annotated), v0.3.0 (annotated) on main, and v0.9.0 (annotated) on a branch. */
function multiTagGitStub() {
  const mergeBaseCalls = [];
  const stub = async (args) => {
    if (args[0] === 'ls-remote') {
      return [
        `${V020_COMMIT}\trefs/tags/v0.2.0`,
        `${V021_TAG_OBJECT}\trefs/tags/v0.2.1`,
        `${V021_COMMIT}\trefs/tags/v0.2.1^{}`,
        `1234567890123456789012345678901234567890\trefs/tags/${NEWEST_TAG}`,
        `${NEWEST_COMMIT}\trefs/tags/${NEWEST_TAG}^{}`,
        `${V090_TAG_OBJECT}\trefs/tags/v0.9.0`,
        `${V090_COMMIT}\trefs/tags/v0.9.0^{}`,
      ].join('\n');
    }
    if (args[0] === 'fetch') return '';
    if (args[0] === 'merge-base') {
      mergeBaseCalls.push(args[2]);
      if (args[2] === V090_COMMIT) throw new Error('not an ancestor');
      return '';
    }
    throw new Error(`unstubbed git command: ${args.join(' ')}`);
  };
  return { stub, mergeBaseCalls };
}

function dependenciesFor(directory, overrides = {}) {
  const io = noisyIo();
  return {
    readFile: (path, encoding) => readFile(join(directory, path), encoding),
    writeFile: (path, data, encoding) => writeFile(join(directory, path), data, encoding),
    git: simpleGitStub(),
    gh: async () => { throw new Error('gh not stubbed'); },
    vercel: async () => { throw new Error('vercel not stubbed'); },
    fetch: async () => { throw new Error('fetch not stubbed'); },
    command: async () => 'PASS (stub verify-pin)\n',
    sleep: async () => undefined,
    stdout: io.stdout,
    stderr: io.stderr,
    io,
    ...overrides,
  };
}

test('newest release tag picks the highest semver whose commit is on main', async () => {
  const { stub, mergeBaseCalls } = multiTagGitStub();
  const release = await newestReleaseTag({ git: stub });
  assert.deepEqual(release, { tag: NEWEST_TAG, version: '0.3.0', commit: NEWEST_COMMIT });
  assert.deepEqual(mergeBaseCalls, [V090_COMMIT, NEWEST_COMMIT]);
});

test('newest release tag resolves a lightweight tag (no ^{} line) to its ref sha', async () => {
  const git = async (args) => {
    if (args[0] === 'ls-remote') return `${V020_COMMIT}\trefs/tags/v0.2.0`;
    if (args[0] === 'fetch') return '';
    if (args[0] === 'merge-base') return '';
    throw new Error(`unstubbed git command: ${args.join(' ')}`);
  };
  const release = await newestReleaseTag({ git });
  assert.deepEqual(release, { tag: 'v0.2.0', version: '0.2.0', commit: V020_COMMIT });
});

test('check passes when every binding names the newest tag', async () => {
  await withTempDirectory(async (directory) => {
    await buildConsistentTree(directory);
    const dependencies = dependenciesFor(directory);
    const release = await check(dependencies);
    assert.deepEqual(release, { tag: NEWEST_TAG, version: '0.3.0', commit: NEWEST_COMMIT });
  });
});

test('check names the file, observed and expected value for each drift', async () => {
  const cases = [
    {
      name: 'release.json version',
      mutate: async (directory) => writeFixtureFile(directory, FILES.release, `${JSON.stringify({ version: '0.2.0', actionSha: NEWEST_COMMIT }, null, 2)}\n`),
      expectFile: FILES.release,
      expectObserved: '0.2.0',
      expectExpected: '0.3.0',
    },
    {
      name: 'release.json actionSha',
      mutate: async (directory) => writeFixtureFile(directory, FILES.release, `${JSON.stringify({ version: '0.3.0', actionSha: V020_COMMIT }, null, 2)}\n`),
      expectFile: FILES.release,
      expectObserved: V020_COMMIT,
      expectExpected: NEWEST_COMMIT,
    },
    {
      name: 'workflow pins',
      mutate: async (directory) => writeFixtureFile(directory, FILES.workflow, [
        'name: Case Lab',
        'env:',
        `  SUTURA_ACTION_SHA: ${NEWEST_COMMIT}`,
        `  SUTURA_CONTROLLER_SHA: ${V020_COMMIT}`,
        'jobs:',
        '  case:',
        '    steps:',
        '      - name: Run Sutura at the exact release',
        `        uses: juan294/sutura/packages/action@${NEWEST_COMMIT}`,
        '',
      ].join('\n')),
      expectFile: FILES.workflow,
      expectObserved: V020_COMMIT,
      expectExpected: NEWEST_COMMIT,
    },
    {
      name: 'recorded evidence result',
      mutate: async (directory) => writeFixtureFile(directory, RESULT_PATH, `${JSON.stringify({
        subjectSha: V020_COMMIT, subjectVersion: '0.3.0', ledgerHash: 'ledgerhash123',
      }, null, 2)}\n`),
      expectFile: RESULT_PATH,
      expectObserved: V020_COMMIT,
      expectExpected: NEWEST_COMMIT,
    },
    {
      name: 'recorded evidence ledger',
      mutate: async (directory) => writeFixtureFile(directory, LEDGER_PATH, `${JSON.stringify({ resultHash: 'stale-hash' }, null, 2)}\n`),
      expectFile: LEDGER_PATH,
      expectObserved: 'stale-hash',
      expectExpected: 'ledgerhash123',
    },
    {
      name: 'replay EVIDENCE_URL',
      mutate: async (directory) => writeFixtureFile(directory, FILES.replay, [
        "const EVIDENCE_URL = 'https://github.com/juan294/sutura/blob/develop/docs/demo/placebo-v0.2-live-2026-09.json';",
        '',
      ].join('\n')),
      expectFile: FILES.replay,
      expectObserved: 'https://github.com/juan294/sutura/blob/develop/docs/demo/placebo-v0.2-live-2026-09.json',
      expectExpected: EVIDENCE_URL,
    },
  ];

  for (const testCase of cases) {
    await withTempDirectory(async (directory) => {
      await buildConsistentTree(directory);
      await testCase.mutate(directory);
      const dependencies = dependenciesFor(directory);
      await assert.rejects(
        check(dependencies),
        (error) => {
          assert.match(error.message, /^BLOCKED: the Case Lab lags release v0\.3\.0/mu, testCase.name);
          assert.ok(error.message.includes(testCase.expectFile), `${testCase.name}: names ${testCase.expectFile}`);
          assert.ok(error.message.includes(testCase.expectObserved), `${testCase.name}: names observed ${testCase.expectObserved}`);
          assert.ok(error.message.includes(testCase.expectExpected), `${testCase.name}: names expected ${testCase.expectExpected}`);
          assert.match(error.message, /Fix: run the release benchmark/u, testCase.name);
          return true;
        },
      );
    });
  }
});

test('bump rewrites all six bindings and refuses to write on a stale result', async () => {
  await withTempDirectory(async (directory) => {
    // Start from a stale (v0.2.0) tree; bump should bring every binding to v0.3.0.
    await buildConsistentTree(directory);
    await writeFixtureFile(directory, FILES.release, `${JSON.stringify({ version: '0.2.0', actionSha: V020_COMMIT }, null, 2)}\n`);
    await writeFixtureFile(directory, FILES.workflow, [
      'name: Case Lab',
      'env:',
      `  SUTURA_ACTION_SHA: ${V020_COMMIT}`,
      `  SUTURA_CONTROLLER_SHA: ${V020_COMMIT}`,
      'jobs:',
      '  case:',
      '    steps:',
      '      - name: Run Sutura at the exact release',
      `        uses: juan294/sutura/packages/action@${V020_COMMIT}`,
      '',
    ].join('\n'));
    await writeFixtureFile(directory, FILES.evidence, [
      "export const RECORDED_RESULT_FILE = 'docs/demo/placebo-v0.2-live-2026-09.json';",
      "export const RECORDED_LEDGER_FILE = 'docs/demo/placebo-v0.2-live-ledger-2026-09.json';",
      '',
    ].join('\n'));
    await writeFixtureFile(directory, FILES.replay, [
      "const EVIDENCE_URL = 'https://github.com/juan294/sutura/blob/develop/docs/demo/placebo-v0.2-live-2026-09.json';",
      '',
    ].join('\n'));

    const dependencies = dependenciesFor(directory);
    const commandCalls = [];
    dependencies.command = async (commandName, args) => {
      commandCalls.push([commandName, ...args]);
      return 'PASS action pin equals release.json 0.3.0\n';
    };

    await bump({ tag: NEWEST_TAG, result: RESULT_PATH, ledger: LEDGER_PATH }, dependencies);
    assert.deepEqual(commandCalls, [['node', 'packages/case-lab/bin/case-lab.js', 'verify-pin', '--tag', NEWEST_TAG]]);

    const release = await check(dependenciesFor(directory));
    assert.deepEqual(release, { tag: NEWEST_TAG, version: '0.3.0', commit: NEWEST_COMMIT });

    // A stale result (wrong subjectSha) must not touch any file.
    await writeFixtureFile(directory, 'docs/demo/stale-result.json', `${JSON.stringify({
      subjectSha: V020_COMMIT, subjectVersion: '0.2.0', ledgerHash: 'ledgerhash123',
    }, null, 2)}\n`);
    const before = await Promise.all(Object.values(FILES).map((path) => readFile(join(directory, path), 'utf8')));
    await assert.rejects(
      bump({ tag: NEWEST_TAG, result: 'docs/demo/stale-result.json', ledger: LEDGER_PATH }, dependenciesFor(directory)),
      /subjectSha is .* but v0\.3\.0 names/u,
    );
    const after = await Promise.all(Object.values(FILES).map((path) => readFile(join(directory, path), 'utf8')));
    assert.deepEqual(before, after, 'no file changes when the result is stale');
  });
});

test('bump refuses a tag older than the newest', async () => {
  await withTempDirectory(async (directory) => {
    await buildConsistentTree(directory);
    const dependencies = dependenciesFor(directory);
    await assert.rejects(
      bump({ tag: 'v0.2.1', result: RESULT_PATH, ledger: LEDGER_PATH }, dependencies),
      /bump --tag v0\.2\.1 is not the newest release tag.*v0\.3\.0/su,
    );
  });
});

test('publish-demo requires literal --authorize and re-verifies byte identity', async () => {
  await withTempDirectory(async (directory) => {
    await buildConsistentTree(directory);
    const dependencies = dependenciesFor(directory);

    await assert.rejects(
      publishDemo({ authorize: false }, dependencies),
      /publish-demo requires literal --authorize/u,
    );

    const local = await readFile(join(directory, FILES.workflow), 'utf8');
    const calls = [];
    let putBody;
    dependencies.gh = async (args) => {
      if (args.includes('-X')) {
        calls.push('PUT');
        putBody = args.find((arg) => arg.startsWith('content='))?.slice('content='.length);
        return JSON.stringify({ sha: 'new-sha' });
      }
      calls.push('GET');
      return JSON.stringify({ sha: 'old-sha', content: Buffer.from(local, 'utf8').toString('base64') });
    };
    const release = await publishDemo({ authorize: true }, dependencies);
    assert.deepEqual(calls, ['GET', 'PUT', 'GET']);
    assert.equal(release.tag, NEWEST_TAG);
    assert.equal(Buffer.from(putBody, 'base64').toString('utf8'), local, 'PUT body carries the local bytes');
    assert.equal(dependencies.io.err.length, 0);
  });
});

test('publish-demo refuses when the remote is not byte-identical after publish', async () => {
  await withTempDirectory(async (directory) => {
    await buildConsistentTree(directory);
    const dependencies = dependenciesFor(directory);
    let call = 0;
    dependencies.gh = async () => {
      call += 1;
      if (call === 2) return JSON.stringify({ sha: 'old-sha' });
      return JSON.stringify({ sha: 'old-sha', content: Buffer.from('different text', 'utf8').toString('base64') });
    };
    await assert.rejects(
      publishDemo({ authorize: true }, dependencies),
      /remote is not byte-identical/u,
    );
  });
});

test('deploy requires literal --authorize and refuses a health mismatch', async () => {
  await withTempDirectory(async (directory) => {
    await buildConsistentTree(directory);
    const dependencies = dependenciesFor(directory);

    await assert.rejects(
      deploy({ authorize: false }, dependencies),
      /deploy requires literal --authorize/u,
    );

    const vercelCalls = [];
    dependencies.vercel = async (args, options) => {
      vercelCalls.push({ args, options });
      return '';
    };
    dependencies.fetch = async () => ({
      json: async () => ({ release: { version: '0.2.0', actionSha: V020_COMMIT } }),
    });
    await assert.rejects(
      deploy({ authorize: true }, dependencies),
      (error) => {
        assert.match(error.message, /0\.2\.0/u);
        assert.match(error.message, /0\.3\.0/u);
        return true;
      },
    );
    assert.equal(vercelCalls.length, 3);
    assert.deepEqual(vercelCalls.map(({ args }) => args[0]), ['pull', 'build', 'deploy']);
    for (const { args, options } of vercelCalls) {
      assert.ok(args.includes('--scope'), 'passes --scope');
      assert.ok(args.includes('thecreativetoken'));
      assert.ok(options.cwd.endsWith(join('packages', 'case-lab')));
    }
    assert.ok(vercelCalls[0].args.includes('--yes'));
    assert.ok(vercelCalls[1].args.includes('--prod'));
    assert.ok(vercelCalls[2].args.includes('--prebuilt'));
    assert.ok(vercelCalls[2].args.includes('--prod'));

    dependencies.fetch = async () => ({
      json: async () => ({ release: { version: '0.3.0', actionSha: NEWEST_COMMIT } }),
    });
    const release = await deploy({ authorize: true }, dependencies);
    assert.equal(release.version, '0.3.0');
  });
});

test('cli guard: run returns 1 and prints the refusal on stderr', async () => {
  await assert.rejects(
    execFileAsync('node', [SCRIPT, 'publish-demo'], { cwd: ROOT }),
    (error) => error.code === 1 && /publish-demo requires literal --authorize/u.test(error.stderr),
  );
});

test('run: check surfaces a PASS line on success and prints the CLI usage on an unknown subcommand', async () => {
  await withTempDirectory(async (directory) => {
    await buildConsistentTree(directory);
    const dependencies = dependenciesFor(directory);
    assert.equal(await run(['check'], dependencies), 0);
    assert.match(dependencies.io.out.at(-1), /PASS the Case Lab names release v0\.3\.0/u);

    const unknown = dependenciesFor(directory);
    assert.equal(await run(['bogus'], unknown), 2);
    assert.match(unknown.io.err.at(-1), /Usage: release-case-lab\.mjs/u);
  });
});
