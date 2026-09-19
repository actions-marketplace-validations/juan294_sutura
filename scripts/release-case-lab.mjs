#!/usr/bin/env node
// The Case Lab always tracks the newest production release tag on `main`.
//
//   node scripts/release-case-lab.mjs check                                          read-only
//   node scripts/release-case-lab.mjs bump --tag <vX.Y.Z> --result <file> --ledger <file>   builds core + case-lab, then verify-pin
//   node scripts/release-case-lab.mjs publish-demo --authorize
//   node scripts/release-case-lab.mjs deploy --authorize
//
// Exit 0 on success, 1 on any refusal. Every refusal names the file, the
// observed value and the expected value. Repository paths resolve against the
// repository root, so the script behaves the same from any working directory.

import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_REPOSITORY = 'juan294/sutura-demo';
const DEMO_WORKFLOW_PATH = '.github/workflows/case-lab.yml';
const HEALTH_URL = 'https://sutura-case-lab.vercel.app/api/health';
const VERCEL_SCOPE = 'thecreativetoken';
const VERCEL_PROJECT = 'sutura-case-lab';
const VERCEL_PROJECT_FILE = 'packages/case-lab/.vercel/project.json';

export const FILES = Object.freeze({
  release: 'packages/case-lab/release.json',
  workflow: 'packages/case-lab/demo/case-lab.yml',
  evidence: 'packages/case-lab/src/evidence.ts',
  replay: 'packages/case-lab/src/replay.ts',
});

export class ReleaseCaseLabError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleaseCaseLabError';
  }
}

async function command(commandName, args, options = {}) {
  const result = await execFileAsync(commandName, args, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1_024 * 1_024,
    timeout: options.timeout ?? 120_000,
  });
  return result.stdout;
}

export function defaultDependencies() {
  return {
    git: (args) => command('git', args),
    gh: (args) => command('gh', args),
    vercel: (args, options) => command('vercel', args, options),
    command,
    fetch: globalThis.fetch,
    readFile: (path, encoding) => readFile(resolve(ROOT, path), encoding),
    writeFile: (path, data, encoding) => writeFile(resolve(ROOT, path), data, encoding),
    sleep: (ms) => new Promise((resolvePromise) => { setTimeout(resolvePromise, ms); }),
    stdout: process.stdout,
    stderr: process.stderr,
  };
}

function compareSemverDesc(a, b) {
  const partsA = a.slice(1).split('.').map(Number);
  const partsB = b.slice(1).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (partsA[index] !== partsB[index]) return partsB[index] - partsA[index];
  }
  return 0;
}

// Transport errors seen intermittently in the pre-push hook (2026-09-15); a
// network blip must not block a push, so these get retried before refusing.
const TRANSPORT_ERROR_PATTERN = /SSL_ERROR_SYSCALL|Could not resolve host|Connection reset|unable to access|shallow\.lock|index\.lock|Another git process seems to be running/u;
const TRANSPORT_RETRY_BACKOFF_MS = [2_000, 4_000];

async function withTransportRetry(dependencies, action) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt > TRANSPORT_RETRY_BACKOFF_MS.length || !TRANSPORT_ERROR_PATTERN.test(message)) throw error;
      await dependencies.sleep(TRANSPORT_RETRY_BACKOFF_MS[attempt - 1]);
    }
  }
}

/** Newest semver v* tag whose peeled commit is reachable from origin/main. */
export async function newestReleaseTag(dependencies) {
  const [tagsOutput] = await Promise.all([
    withTransportRetry(dependencies, () => dependencies.git(['ls-remote', '--tags', 'origin', 'refs/tags/v*'])),
    withTransportRetry(dependencies, () => dependencies.git(['fetch', '--quiet', 'origin', 'main'])),
  ]);
  // CI checks out one commit. In a shallow clone, origin/main has no history, so
  // every earlier tag reads as unreachable and the only tag the check could ever
  // accept is one sitting at HEAD. Deepen before testing ancestry.
  const shallow = (await dependencies.git(['rev-parse', '--is-shallow-repository'])).trim() === 'true';
  if (shallow) {
    await withTransportRetry(dependencies, () => dependencies.git(['fetch', '--quiet', '--unshallow', 'origin', 'main']));
  }
  const lines = tagsOutput.split('\n').filter(Boolean);
  // "<sha>\trefs/tags/v0.3.0" (annotated tag object) and "<sha>\trefs/tags/v0.3.0^{}" (peeled commit)
  const tags = new Map();
  for (const line of lines) {
    const [sha, ref] = line.split('\t');
    const match = /^refs\/tags\/(v\d+\.\d+\.\d+)(\^\{\})?$/u.exec(ref ?? '');
    if (!match) continue;
    const entry = tags.get(match[1]) ?? {};
    if (match[2]) entry.commit = sha; else entry.ref = sha;
    tags.set(match[1], entry);
  }
  if (tags.size === 0) throw new ReleaseCaseLabError('origin has no v* tags');
  const ordered = [...tags.keys()].sort(compareSemverDesc);
  for (const tag of ordered) {
    const commit = tags.get(tag).commit ?? tags.get(tag).ref; // lightweight tags have no ^{}
    try {
      await dependencies.git(['merge-base', '--is-ancestor', commit, 'origin/main']);
      return { tag, version: tag.slice(1), commit };
    } catch {
      // a tag not on main is not a production release; keep looking
    }
  }
  throw new ReleaseCaseLabError('no v* tag is reachable from origin/main');
}

function singleMatch(text, pattern, what, file) {
  const matches = [...text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) {
    throw new ReleaseCaseLabError(`${file} must contain exactly one ${what}`);
  }
  return matches[0][1];
}

// Copied from packages/case-lab/src/pin.ts: the .mjs script cannot import TS.
const ACTION_USES_PATTERN = /^\s*uses:\s*juan294\/sutura\/packages\/action@([a-f0-9]{40})\s*$/mu;
const ENV_ACTION_PATTERN = /^\s*SUTURA_ACTION_SHA:\s*([a-f0-9]{40})\s*$/mu;
const ENV_CONTROLLER_PATTERN = /^\s*SUTURA_CONTROLLER_SHA:\s*([a-f0-9]{40})\s*$/mu;

export function readPins(text) {
  return {
    usesSha: singleMatch(text, ACTION_USES_PATTERN, 'juan294/sutura/packages/action@<sha> step', FILES.workflow),
    envActionSha: singleMatch(text, ENV_ACTION_PATTERN, 'SUTURA_ACTION_SHA value', FILES.workflow),
    controllerSha: singleMatch(text, ENV_CONTROLLER_PATTERN, 'SUTURA_CONTROLLER_SHA value', FILES.workflow),
  };
}

function withPin(text, pattern, sha) {
  return text.replace(pattern, (line) => line.replace(/[a-f0-9]{40}/u, sha));
}

function writePins(text, sha) {
  // The controller pin is set separately (`case-lab verify-pin --set-controller`) to the
  // commit that carries this bump, because that commit does not exist yet here.
  return withPin(withPin(text, ACTION_USES_PATTERN, sha), ENV_ACTION_PATTERN, sha);
}

const RESULT_FILE_PATTERN = /^export const RECORDED_RESULT_FILE = '([^']+)';$/mu;
const LEDGER_FILE_PATTERN = /^export const RECORDED_LEDGER_FILE = '([^']+)';$/mu;
const EVIDENCE_URL_PATTERN = /^const EVIDENCE_URL = '([^']+)';$/mu;

export function readEvidenceBinding(text) {
  return {
    result: singleMatch(text, RESULT_FILE_PATTERN, 'RECORDED_RESULT_FILE literal', FILES.evidence),
    ledger: singleMatch(text, LEDGER_FILE_PATTERN, 'RECORDED_LEDGER_FILE literal', FILES.evidence),
  };
}

export function readEvidenceUrl(text) {
  return singleMatch(text, EVIDENCE_URL_PATTERN, 'EVIDENCE_URL literal', FILES.replay);
}

function withEvidenceBinding(text, binding) {
  return text
    .replace(RESULT_FILE_PATTERN, `export const RECORDED_RESULT_FILE = '${binding.result}';`)
    .replace(LEDGER_FILE_PATTERN, `export const RECORDED_LEDGER_FILE = '${binding.ledger}';`);
}

function withEvidenceUrl(text, url) {
  return text.replace(EVIDENCE_URL_PATTERN, `const EVIDENCE_URL = '${url}';`);
}

/** release.json as committed at the controller commit, read through the API so a shallow CI checkout needs no local object. */
async function controllerReleaseJson(dependencies, sha) {
  const valid = (parsed) => (typeof parsed?.version === 'string' && typeof parsed?.actionSha === 'string' ? parsed : null);
  try {
    const encoded = await withTransportRetry(dependencies, () => dependencies.gh([
      'api', `repos/juan294/sutura/contents/${FILES.release}?ref=${sha}`, '--jq', '.content',
    ]));
    return valid(JSON.parse(Buffer.from(encoded.replace(/\s+/gu, ''), 'base64').toString('utf8')));
  } catch {
    // gh may be unauthenticated (CI runs this step without a token); fetch the
    // exact commit and read the file from git instead. A shallow clone can
    // fetch a reachable commit by sha from GitHub.
    try {
      await withTransportRetry(dependencies, () => dependencies.git(['fetch', '--quiet', '--depth=1', 'origin', sha]));
      return valid(JSON.parse(await dependencies.git(['show', `${sha}:${FILES.release}`])));
    } catch {
      return null;
    }
  }
}

export async function check(dependencies = defaultDependencies(), options = {}) {
  const release = await newestReleaseTag(dependencies);
  const [releaseText, workflowText, evidenceText, replayText] = await Promise.all([
    dependencies.readFile(FILES.release, 'utf8'),
    dependencies.readFile(FILES.workflow, 'utf8'),
    dependencies.readFile(FILES.evidence, 'utf8'),
    dependencies.readFile(FILES.replay, 'utf8'),
  ]);
  const json = JSON.parse(releaseText);
  const refusals = [];
  const expect = (file, what, observed, expected) => {
    if (observed !== expected) refusals.push(`${file}: ${what} is ${observed} but the newest release tag ${release.tag} names ${expected}`);
  };
  expect(FILES.release, 'version', json.version, release.version);
  expect(FILES.release, 'actionSha', json.actionSha, release.commit);
  const pins = readPins(workflowText);
  expect(FILES.workflow, 'uses: juan294/sutura/packages/action@', pins.usesSha, release.commit);
  expect(FILES.workflow, 'SUTURA_ACTION_SHA', pins.envActionSha, release.commit);
  // The controller checkout publishes results, so it must be a commit whose own
  // release.json names the newest release. The tag commit itself cannot be that
  // commit: its release.json is written before the tag exists and names the
  // previous release, which is why the first live publish after every tag failed.
  if (options.controller !== 'skip') {
    const controllerRelease = await controllerReleaseJson(dependencies, pins.controllerSha);
    expect(FILES.workflow, `SUTURA_CONTROLLER_SHA ${pins.controllerSha} release.json version`, controllerRelease?.version ?? 'unreadable', release.version);
    expect(FILES.workflow, `SUTURA_CONTROLLER_SHA ${pins.controllerSha} release.json actionSha`, controllerRelease?.actionSha ?? 'unreadable', release.commit);
  }
  const binding = readEvidenceBinding(evidenceText);
  const [resultText, ledgerText] = await Promise.all([
    dependencies.readFile(binding.result, 'utf8'),
    dependencies.readFile(binding.ledger, 'utf8'),
  ]);
  const result = JSON.parse(resultText);
  expect(binding.result, 'subjectSha', result.subjectSha, release.commit);
  expect(binding.result, 'subjectVersion', result.subjectVersion, release.version);
  const ledger = JSON.parse(ledgerText);
  if (ledger.resultHash !== result.ledgerHash) {
    refusals.push(`${binding.ledger}: resultHash is ${ledger.resultHash} but ${binding.result} ledgerHash is ${result.ledgerHash}`);
  }
  expect(FILES.replay, 'EVIDENCE_URL', readEvidenceUrl(replayText),
    `https://github.com/juan294/sutura/blob/develop/${binding.result}`);
  if (refusals.length > 0) {
    throw new ReleaseCaseLabError([
      `BLOCKED: the Case Lab lags release ${release.tag} (${release.commit})`,
      ...refusals,
      'Fix: run the release benchmark (Phase 2 procedure), then `pnpm run release:case-lab bump --tag <tag> --result <file> --ledger <file>`.',
    ].join('\n'));
  }
  return release;
}

export async function bump({ tag, result, ledger }, dependencies) {
  const newest = await newestReleaseTag(dependencies);
  if (tag !== newest.tag) {
    throw new ReleaseCaseLabError(
      `bump --tag ${tag} is not the newest release tag; origin/main names ${newest.tag} (${newest.commit})`,
    );
  }
  const resultJson = JSON.parse(await dependencies.readFile(result, 'utf8'));
  if (resultJson.subjectSha !== newest.commit) {
    throw new ReleaseCaseLabError(`${result}: subjectSha is ${resultJson.subjectSha} but ${newest.tag} names ${newest.commit}`);
  }
  if (resultJson.subjectVersion !== newest.version) {
    throw new ReleaseCaseLabError(`${result}: subjectVersion is ${resultJson.subjectVersion} but ${newest.tag} names ${newest.version}`);
  }
  const ledgerJson = JSON.parse(await dependencies.readFile(ledger, 'utf8'));
  if (ledgerJson.resultHash !== resultJson.ledgerHash) {
    throw new ReleaseCaseLabError(`${ledger}: resultHash ${ledgerJson.resultHash} does not match ${result} ledgerHash ${resultJson.ledgerHash}`);
  }

  // Every read check passed; only now do we write.
  await dependencies.writeFile(
    FILES.release,
    `${JSON.stringify({ version: newest.version, actionSha: newest.commit }, null, 2)}\n`,
    'utf8',
  );
  const workflowText = await dependencies.readFile(FILES.workflow, 'utf8');
  await dependencies.writeFile(FILES.workflow, writePins(workflowText, newest.commit), 'utf8');
  const evidenceText = await dependencies.readFile(FILES.evidence, 'utf8');
  await dependencies.writeFile(FILES.evidence, withEvidenceBinding(evidenceText, { result, ledger }), 'utf8');
  const replayText = await dependencies.readFile(FILES.replay, 'utf8');
  await dependencies.writeFile(
    FILES.replay,
    withEvidenceUrl(replayText, `https://github.com/juan294/sutura/blob/develop/${result}`),
    'utf8',
  );

  // verify-pin runs from the built package; a fresh worktree has no dist.
  await dependencies.command('pnpm', ['--filter', '@sutura/core', '--filter', '@sutura/case-lab', 'build']);
  const output = await dependencies.command('node', ['packages/case-lab/bin/case-lab.js', 'verify-pin', '--tag', tag]);
  dependencies.stdout.write(output);
  return newest;
}

export async function publishDemo({ authorize }, dependencies) {
  if (!authorize) throw new ReleaseCaseLabError('publish-demo requires literal --authorize');
  // The local tree must already be consistent before we push it out.
  const release = await check(dependencies);
  const local = await dependencies.readFile(FILES.workflow, 'utf8');
  const before = JSON.parse(await dependencies.gh(['api', `repos/${DEMO_REPOSITORY}/contents/${DEMO_WORKFLOW_PATH}?ref=main`]));
  const message = `chore(case-lab): pin the Action and controller to sutura ${release.tag}`;
  await dependencies.gh([
    'api', `repos/${DEMO_REPOSITORY}/contents/${DEMO_WORKFLOW_PATH}`,
    '-X', 'PUT',
    '-f', `message=${message}`,
    '-f', `content=${Buffer.from(local, 'utf8').toString('base64')}`,
    '-f', `sha=${before.sha}`,
    '-f', 'branch=main',
  ]);
  const after = JSON.parse(await dependencies.gh(['api', `repos/${DEMO_REPOSITORY}/contents/${DEMO_WORKFLOW_PATH}?ref=main`]));
  const remoteText = Buffer.from(after.content, 'base64').toString('utf8');
  if (remoteText !== local) {
    throw new ReleaseCaseLabError(`${DEMO_REPOSITORY} ${DEMO_WORKFLOW_PATH}: remote is not byte-identical to ${FILES.workflow} after publish`);
  }
  // The push landed; refuse to report success until the demo's own CI on the
  // published commit is actually green (the Case Lab cannot repair anything
  // while the demo suite it races against is red).
  const commit = after.sha ? (JSON.parse(await dependencies.gh(['api', `repos/${DEMO_REPOSITORY}/commits/main`]))).sha : undefined;
  const deadline = Date.now() + 15 * 60_000;
  for (;;) {
    const runs = JSON.parse(await dependencies.gh(['api', `repos/${DEMO_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${commit}&per_page=5`]));
    const run = runs.workflow_runs?.[0];
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') {
        throw new ReleaseCaseLabError(
          `${DEMO_REPOSITORY} ci.yml on ${commit} concluded ${run.conclusion}: ${run.html_url}. `
          + 'The Case Lab cannot repair anything while the demo suite is red.',
        );
      }
      break;
    }
    if (Date.now() > deadline) throw new ReleaseCaseLabError(`${DEMO_REPOSITORY} ci.yml on ${commit} did not complete within 15 minutes`);
    await dependencies.sleep(30_000);
  }
  return release;
}

export async function deploy({ authorize }, dependencies) {
  if (!authorize) throw new ReleaseCaseLabError('deploy requires literal --authorize');
  const cwd = resolve(ROOT, 'packages/case-lab');
  await dependencies.vercel(['link', '--yes', '--scope', VERCEL_SCOPE, '--project', VERCEL_PROJECT], { cwd });
  const project = JSON.parse(await dependencies.readFile(VERCEL_PROJECT_FILE, 'utf8'));
  if (project.projectName !== VERCEL_PROJECT) {
    throw new ReleaseCaseLabError(
      `${VERCEL_PROJECT_FILE}: projectName is ${JSON.stringify(project.projectName)} but deploy requires ${JSON.stringify(VERCEL_PROJECT)}`,
    );
  }
  await dependencies.vercel(['pull', '--yes', '--environment=production', '--scope', VERCEL_SCOPE], { cwd });
  await dependencies.vercel(['build', '--prod', '--scope', VERCEL_SCOPE], { cwd });
  await dependencies.vercel(['deploy', '--prebuilt', '--prod', '--scope', VERCEL_SCOPE], { cwd });
  const release = JSON.parse(await dependencies.readFile(FILES.release, 'utf8'));
  let observed;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await dependencies.fetch(HEALTH_URL);
    const body = await response.json();
    observed = body.release;
    if (observed?.version === release.version && observed?.actionSha === release.actionSha) {
      return release;
    }
    if (attempt < 5) await dependencies.sleep(10_000);
  }
  throw new ReleaseCaseLabError(
    `${HEALTH_URL}: release is ${JSON.stringify(observed)} but ${FILES.release} names `
    + `${JSON.stringify({ version: release.version, actionSha: release.actionSha })}`,
  );
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function run(argv, dependencies = defaultDependencies()) {
  const [subcommand, ...rest] = argv;
  try {
    switch (subcommand) {
      case 'check': {
        const release = await check(dependencies);
        dependencies.stdout.write(`PASS the Case Lab names release ${release.tag} (${release.commit})\n`);
        return 0;
      }
      case 'bump': {
        const tag = valueAfter(rest, '--tag');
        const result = valueAfter(rest, '--result');
        const ledger = valueAfter(rest, '--ledger');
        if (!tag || !result || !ledger) {
          dependencies.stderr.write('Usage: release-case-lab.mjs bump --tag <vX.Y.Z> --result <docs/demo/...json> --ledger <docs/demo/...json>\n');
          return 2;
        }
        await bump({ tag, result, ledger }, dependencies);
        return 0;
      }
      case 'publish-demo': {
        const release = await publishDemo({ authorize: rest.includes('--authorize') }, dependencies);
        dependencies.stdout.write(`PASS ${DEMO_REPOSITORY} ${DEMO_WORKFLOW_PATH} is byte-identical to the committed copy (release ${release.tag})\n`);
        return 0;
      }
      case 'deploy': {
        const release = await deploy({ authorize: rest.includes('--authorize') }, dependencies);
        dependencies.stdout.write(`PASS deployed release matches ${FILES.release} (${release.version})\n`);
        return 0;
      }
      default:
        dependencies.stderr.write('Usage: release-case-lab.mjs check | bump --tag <vX.Y.Z> --result <file> --ledger <file> | publish-demo --authorize | deploy --authorize\n');
        return 2;
    }
  } catch (error) {
    dependencies.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
