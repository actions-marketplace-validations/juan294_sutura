import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { acceptance } from './acceptance.js';
import { CASE_LAB_CASES, CaseLabRequestError, caseLabCase } from './cases.js';
import { canonicalJson } from './canonical.js';
import { DEMO_REPOSITORY } from './dispatcher.js';
import { CaseLabPinError, DEMO_WORKFLOW_FILE, verifyPin, withControllerSha } from './pin.js';
import { publishResult } from './publish.js';
import { deterministicResult, loadRelease, replayCatalog, replayedResult, PACKAGE_DIR, REPLAY_DIR, REPLAY_FIXTURE_SCHEMA_VERSION, type ReplayCatalogOptions } from './replay.js';
import { CaseLabResultError, validateCaseLabResult } from './result.js';
import { createStaticServer, listen } from './serve.js';
import { buildSite } from './site.js';
import { SITE_CONFIG_FILE, loadSiteConfig, type SiteConfig } from './site-config.js';

const execFileAsync = promisify(execFile);
const RESULTS_BASE = 'https://raw.githubusercontent.com/juan294/sutura-demo/case-lab-results/results/';

export const USAGE = [
  'Usage:',
  '  case-lab catalog --out <dir>',
  '  case-lab replay <case-id> [--out <file>]',
  '  case-lab build-site [--out <dir>] [--api-base <origin or empty>] [--site-root </>] [--site-url <https origin>] [--site-config <file>]',
  '  case-lab serve [--dir <dir>] [--port <port>]',
  '  case-lab acceptance --base-url <url> [--offline] [--live-result <request-id>] [--site-config <file>] [--out <file>]',
  '  case-lab verify-pin [--tag <tag>] [--workflow <file>] [--set-controller <sha>]',
  '  case-lab dispatch --base-url <url> --case <case-id>',
  '  case-lab capture-replay --request-id <id> [--out <dir>]',
  '  case-lab publish-result --request-id <id> --case <case-id> --outcome <outcome> --demo-sha <sha> --controller-sha <sha> --workflow-run-url <url> [--ci-run-url <url>] [--pull-request-url <url>] [--repair-pull-request-url <url>] [--check-url <url>] [--refusal-comment-url <url>] [--case-file-artifact-url <url>] [--replay-artifact-url <url>] [--case-file <file>] [--replay <file>] [--repair-paths <newline-separated paths>] --out <file>',
].join('\n');

export const DEMO_WORKFLOW_COPY = resolve(PACKAGE_DIR, 'demo/case-lab.yml');

export const DEFAULT_SITE_DIR = resolve(PACKAGE_DIR, 'dist/site');

export interface CliIo {
  readonly write: (text: string) => void;
  readonly writeError: (text: string) => void;
}

export interface CliDependencies {
  readonly io?: CliIo;
  readonly catalog?: ReplayCatalogOptions;
  readonly gh?: (args: readonly string[]) => Promise<string>;
  readonly fetch?: typeof fetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

async function ghDefault(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', [...args], { encoding: 'utf8', maxBuffer: 20 * 1_024 * 1_024, timeout: 120_000 });
  return stdout.trim();
}

function optionalLink(args: readonly string[], flag: string): string | undefined {
  const value = valueAfter(args, flag);
  return value === undefined || value === '' ? undefined : value;
}

/** Drop undefined values so an optional field is absent rather than present-and-undefined. */
function definedEntries<T extends Record<string, string | undefined>>(value: T): { [K in keyof T]?: string } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as { [K in keyof T]?: string };
}

function runIdFromUrl(url: string | undefined, label: string): string {
  const match = /\/actions\/runs\/(\d+)$/u.exec(url ?? '');
  if (!match?.[1]) throw new CaseLabCliError(`${label} must be a GitHub Actions run URL`);
  return match[1];
}

export class CaseLabCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseLabCliError';
  }
}

export function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new CaseLabCliError(`${flag} requires a value`);
  return value;
}

function requireValue(args: readonly string[], flag: string): string {
  const value = valueAfter(args, flag);
  if (value === undefined) throw new CaseLabCliError(`${flag} is required`);
  return value;
}

/** `--site-config <file>` must exist; the package default is optional so a checkout without site.json still builds. */
function siteConfigFor(args: readonly string[]): SiteConfig {
  const explicit = valueAfter(args, '--site-config');
  if (explicit !== undefined) return loadSiteConfig(resolve(explicit));
  return existsSync(SITE_CONFIG_FILE) ? loadSiteConfig(SITE_CONFIG_FILE) : {};
}

/** Write a public document without ever overwriting an existing file. */
export function writeNew(path: string, content: string): void {
  writeFileSync(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
}

export async function runCaseLabCli(argv: readonly string[], dependencies: CliDependencies = {}): Promise<number> {
  const io = dependencies.io ?? {
    write: (text) => process.stdout.write(text),
    writeError: (text) => process.stderr.write(text),
  };
  const [command, ...args] = argv;
  try {
    switch (command) {
      case 'catalog': {
        const outDir = resolve(requireValue(args, '--out'));
        mkdirSync(outDir, { recursive: true, mode: 0o755 });
        const results = await replayCatalog(dependencies.catalog);
        for (const result of results) {
          writeNew(resolve(outDir, `${result.caseId}.json`), `${canonicalJson(result)}\n`);
          io.write(`${result.caseId}\t${result.mode}\t${result.outcome}\n`);
        }
        return 0;
      }
      case 'replay': {
        const caseId = args[0];
        if (caseId === undefined || caseId.startsWith('--')) {
          throw new CaseLabCliError(`replay requires a case id: ${CASE_LAB_CASES.map((item) => item.id).join(', ')}`);
        }
        const result = await deterministicResult(caseId, dependencies.catalog);
        const out = valueAfter(args, '--out');
        const text = `${canonicalJson(result)}\n`;
        if (out === undefined) io.write(text);
        else writeNew(resolve(out), text);
        return 0;
      }
      case 'build-site': {
        const outDir = resolve(valueAfter(args, '--out') ?? DEFAULT_SITE_DIR);
        const apiBase = args.includes('--api-base') ? (valueAfter(args, '--api-base') ?? '') : undefined;
        const { siteUrl: configuredSiteUrl, ...identifiers } = siteConfigFor(args);
        const siteUrl = valueAfter(args, '--site-url') ?? configuredSiteUrl;
        const catalog = await replayCatalog(dependencies.catalog);
        const written = await buildSite({
          outDir,
          catalog,
          release: dependencies.catalog?.release ?? loadRelease(),
          siteRoot: valueAfter(args, '--site-root') ?? '/',
          identifiers,
          ...(apiBase === undefined ? {} : { apiBase }),
          ...(siteUrl === undefined ? {} : { siteUrl }),
        });
        io.write(`${written.length} files written to ${outDir}\n`);
        return 0;
      }
      case 'serve': {
        const dir = resolve(valueAfter(args, '--dir') ?? DEFAULT_SITE_DIR);
        const port = Number(valueAfter(args, '--port') ?? '4177');
        if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new CaseLabCliError('--port must be an integer from 0 to 65535');
        const bound = await listen(createStaticServer(dir), port);
        io.write(`Serving ${dir} at http://127.0.0.1:${bound}/\n`);
        await new Promise(() => undefined);
        return 0;
      }
      case 'acceptance': {
        const baseUrl = requireValue(args, '--base-url');
        const liveResultId = valueAfter(args, '--live-result');
        const { googleSiteVerification, bingSiteVerification } = siteConfigFor(args);
        const record = await acceptance(baseUrl, {
          checkLinks: !args.includes('--offline'),
          ...(liveResultId === undefined ? {} : { liveResultId }),
          verification: {
            ...(googleSiteVerification === undefined ? {} : { google: googleSiteVerification }),
            ...(bingSiteVerification === undefined ? {} : { bing: bingSiteVerification }),
          },
        });
        const text = `${canonicalJson(record)}\n`;
        const out = valueAfter(args, '--out');
        if (out === undefined) io.write(text);
        else writeNew(resolve(out), text);
        for (const check of record.checks) io.writeError(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}\n`);
        return record.passed ? 0 : 1;
      }
      case 'verify-pin': {
        const gh = dependencies.gh ?? ghDefault;
        const workflowPath = resolve(valueAfter(args, '--workflow') ?? DEMO_WORKFLOW_COPY);
        const release = dependencies.catalog?.release ?? loadRelease();
        const setController = valueAfter(args, '--set-controller');
        if (setController !== undefined) {
          writeFileSync(workflowPath, withControllerSha(readFileSync(workflowPath, 'utf8'), setController), 'utf8');
          io.write(`${workflowPath}: SUTURA_CONTROLLER_SHA set to ${setController}\n`);
        }
        const text = readFileSync(workflowPath, 'utf8');
        const pins = verifyPin(text, release, workflowPath);
        io.write(`PASS action pin ${pins.usesSha} equals release.json ${release.version}\n`);
        const tag = valueAfter(args, '--tag');
        if (tag !== undefined) {
          let sha = JSON.parse(await gh(['api', `repos/juan294/sutura/git/ref/tags/${tag}`])) as { object: { sha: string; type: string } };
          if (sha.object.type === 'tag') {
            sha = { object: (JSON.parse(await gh(['api', `repos/juan294/sutura/git/tags/${sha.object.sha}`])) as { object: { sha: string; type: string } }).object };
          }
          if (sha.object.sha !== release.actionSha) {
            throw new CaseLabPinError(`tag ${tag} points to ${sha.object.sha} but release.json names ${release.actionSha}`);
          }
          io.write(`PASS tag ${tag} points to ${release.actionSha}\n`);
          const commit = JSON.parse(await gh(['api', `repos/juan294/sutura/commits/${pins.controllerSha}`])) as { sha: string };
          if (commit.sha !== pins.controllerSha) throw new CaseLabPinError(`controller commit ${pins.controllerSha} is not on juan294/sutura`);
          await gh(['api', `repos/juan294/sutura/contents/packages/case-lab/release.json?ref=${pins.controllerSha}`]);
          io.write(`PASS controller ${pins.controllerSha} exists and contains packages/case-lab\n`);
          const remote = JSON.parse(await gh(['api', `repos/${DEMO_REPOSITORY}/contents/${DEMO_WORKFLOW_FILE}?ref=main`])) as { content: string; encoding: string };
          const remoteText = Buffer.from(remote.content, remote.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
          if (remoteText !== text) throw new CaseLabPinError(`${DEMO_REPOSITORY} ${DEMO_WORKFLOW_FILE} on main differs from ${workflowPath}`);
          io.write(`PASS ${DEMO_REPOSITORY} ${DEMO_WORKFLOW_FILE} is byte-identical to the committed copy\n`);
        }
        return 0;
      }
      case 'dispatch': {
        const baseUrl = requireValue(args, '--base-url').replace(/\/$/u, '');
        const item = caseLabCase(requireValue(args, '--case'));
        const response = await (dependencies.fetch ?? fetch)(`${baseUrl}/api/dispatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseId: item.id }),
        });
        const body = await response.text();
        io.write(`${response.status} ${body}\n`);
        return response.status === 202 ? 0 : 1;
      }
      case 'capture-replay': {
        const gh = dependencies.gh ?? ghDefault;
        const requestId = requireValue(args, '--request-id');
        const outDir = resolve(valueAfter(args, '--out') ?? REPLAY_DIR);
        const response = await (dependencies.fetch ?? fetch)(`${RESULTS_BASE}${requestId}.json`);
        if (response.status !== 200) throw new CaseLabCliError(`no published result for ${requestId} (HTTP ${response.status})`);
        const result = validateCaseLabResult(await response.json());
        if (result.mode !== 'live') throw new CaseLabCliError(`${requestId} is not a live result`);
        const runId = runIdFromUrl(result.links.workflowRun, 'links.workflowRun');
        const ciRunId = runIdFromUrl(result.links.ciRun, 'links.ciRun');
        const directory = mkdtempSync(join(tmpdir(), 'case-lab-capture-'));
        try {
          await gh(['run', 'download', runId, '-R', DEMO_REPOSITORY, '--name', `sutura-replay-${ciRunId}.json`, '--dir', directory]);
          const files = readdirSync(directory, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.json'));
          if (files.length !== 1) throw new CaseLabCliError(`replay download must contain one JSON file, found ${files.length}`);
          const bundle = JSON.parse(readFileSync(join(directory, files[0]!)).toString('utf8')) as unknown;
          const item = caseLabCase(result.caseId);
          if (result.identity.demoSha === undefined || result.links.workflowRun === undefined) {
            throw new CaseLabCliError(`${requestId} lacks the demo commit or the workflow run link needed to bind a fixture`);
          }
          const release = dependencies.catalog?.release ?? loadRelease();
          if (result.release.actionSha !== release.actionSha) {
            throw new CaseLabCliError(`${requestId} ran release ${result.release.actionSha}, not the current release.json ${release.actionSha}`);
          }
          const fixture = {
            schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
            release,
            demoSha: result.identity.demoSha,
            capturedRunUrl: result.links.workflowRun,
            bundle,
          };
          const text = `${JSON.stringify(fixture)}\n`;
          const { createHash } = await import('node:crypto');
          const sha256 = createHash('sha256').update(text).digest('hex');
          const replayed = await replayedResult(item, fixture, {
            release,
            now: dependencies.catalog?.now ?? (() => new Date()),
            fixtureSha256: sha256,
            ...(dependencies.catalog?.replay === undefined ? {} : { replay: dependencies.catalog.replay }),
          });
          if (replayed.outcome !== result.outcome) throw new CaseLabCliError(`replayed outcome ${replayed.outcome} differs from the live outcome ${result.outcome}`);
          mkdirSync(outDir, { recursive: true, mode: 0o755 });
          writeNew(join(outDir, `${item.id}.json`), text);
          io.write(`${item.id}\t${sha256}\t${join(outDir, `${item.id}.json`)}\n`);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
        return 0;
      }
      case 'publish-result': {
        const env = dependencies.env ?? process.env;
        const elapsed = valueAfter(args, '--elapsed-ms');
        const caseFilePath = optionalLink(args, '--case-file');
        const replayBundlePath = optionalLink(args, '--replay');
        const repairPathsText = valueAfter(args, '--repair-paths');
        const repairPaths = repairPathsText === undefined
          ? undefined
          : repairPathsText.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0);
        const links = definedEntries({
          workflowRun: optionalLink(args, '--workflow-run-url'),
          ciRun: optionalLink(args, '--ci-run-url'),
          pullRequest: optionalLink(args, '--pull-request-url'),
          repairPullRequest: optionalLink(args, '--repair-pull-request-url'),
          check: optionalLink(args, '--check-url'),
          refusalComment: optionalLink(args, '--refusal-comment-url'),
          caseFileArtifact: optionalLink(args, '--case-file-artifact-url'),
          replayBundleArtifact: optionalLink(args, '--replay-artifact-url'),
        });
        const result = publishResult({
          requestId: requireValue(args, '--request-id'),
          caseId: requireValue(args, '--case'),
          outcome: valueAfter(args, '--outcome') ?? '',
          demoSha: requireValue(args, '--demo-sha'),
          controllerSha: requireValue(args, '--controller-sha'),
          ...(caseFilePath === undefined ? {} : { caseFilePath }),
          ...(replayBundlePath === undefined ? {} : { replayBundlePath }),
          ...(repairPaths === undefined ? {} : { repairPaths }),
          links,
          ...(elapsed === undefined ? {} : { elapsedMs: Number(elapsed) }),
          ...(dependencies.catalog?.release === undefined ? {} : { release: dependencies.catalog.release }),
          ...(dependencies.catalog?.now === undefined ? {} : { now: dependencies.catalog.now }),
          secrets: [env.NEBIUS_API_KEY, env.TAVILY_API_KEY, env.CONTREE_TOKEN, env.CASE_LAB_GITHUB_TOKEN],
        });
        const text = `${canonicalJson(result)}\n`;
        const out = valueAfter(args, '--out');
        if (out === undefined) io.write(text);
        else writeNew(resolve(out), text);
        io.writeError(`${result.requestId} ${result.caseId} ${result.outcome} (${result.caseFile === undefined ? 'no case file' : 'case file attached'})\n`);
        return 0;
      }
      default:
        io.writeError(`${USAGE}\n`);
        return 2;
    }
  } catch (error) {
    if (error instanceof CaseLabCliError || error instanceof CaseLabRequestError || error instanceof CaseLabPinError || error instanceof CaseLabResultError) {
      io.writeError(`${error.message}\n`);
      return 2;
    }
    io.writeError(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
