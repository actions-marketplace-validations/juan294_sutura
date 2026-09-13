import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY = /^[A-Za-z0-9_.-]+$/u;
const FULL_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const SHA = /^[a-f0-9]{40}$/u;
const DEFAULT_CONFIG = resolve(ROOT, '.sutura/fleet-dogfood-config.json');
const DEFAULT_OUTPUT = resolve(ROOT, '.sutura/fleet-dogfood-metrics');

function finiteNonnegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and nonnegative`);
  return value;
}

function isoInstant(value, label) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be an ISO-8601 UTC instant with milliseconds`);
  }
  return value;
}

function validateConfig(input, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Fleet config must be an object');
  if (input.schemaVersion !== 'sutura-fleet-config-v1') throw new Error('Fleet config schemaVersion is invalid');
  if (!REPOSITORY.test(input.owner ?? '')) throw new Error('Fleet config owner is invalid');
  if (!Array.isArray(input.repositories) || input.repositories.length === 0 || input.repositories.length > 100 ||
      input.repositories.some((value) => !REPOSITORY.test(value) && !FULL_REPOSITORY.test(value))) {
    throw new Error('Fleet config repositories must contain 1 to 100 GitHub repository names or owner/name identities');
  }
  if (new Set(input.repositories.map((value) => repositoryIdentity(input.owner, value).toLowerCase())).size !== input.repositories.length) {
    throw new Error('Fleet config repositories must be unique');
  }
  isoInstant(input.startedAt, 'Fleet config startedAt');
  if (Date.parse(input.startedAt) > now.getTime()) throw new Error('Fleet config startedAt cannot be in the future');
  if (!SHA.test(input.actionCommit ?? '')) throw new Error('Fleet config actionCommit must be an exact commit');
  return input;
}

function repositoryIdentity(defaultOwner, repository) {
  return repository.includes('/') ? repository : `${defaultOwner}/${repository}`;
}

function exactNumber(pattern, html, label) {
  const match = pattern.exec(html);
  if (!match?.[1]) throw new Error(`Case file omitted ${label}`);
  return finiteNonnegative(Number(match[1].replaceAll(',', '')), label);
}

export function parseCaseFileHtml(html) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > 4 * 1024 * 1024) {
    throw new Error('Case file must be bounded HTML text');
  }
  const outcome = /<body class="outcome-(fixed|flaky-no-patch|refused|gave-up|infra-stop)">/u.exec(html)?.[1];
  if (!outcome) throw new Error('Case file omitted a supported outcome');
  return {
    outcome,
    inferenceCostUsd: exactNumber(/<span>Inference cost<\/span><strong>\$([0-9,.]+)<\/strong>/u, html, 'inference cost'),
    sandboxCostUsd: exactNumber(/· \$([0-9,.]+) sandbox cost<\/p>/u, html, 'sandbox cost'),
    sandboxOperations: exactNumber(/<p>([0-9,]+) operations ·/u, html, 'sandbox operations'),
    sandboxElapsedTimeSec: exactNumber(/operations · ([0-9,.]+) s elapsed ·/u, html, 'sandbox elapsed time'),
  };
}

export function parseTerminalFailureJson(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 64 * 1024) {
    throw new Error('Terminal failure must be bounded JSON text');
  }
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error('Terminal failure must be valid JSON');
  }
  if (value?.schemaVersion !== 'sutura-terminal-failure-v1' || value.outcome !== 'infra-stop') {
    throw new Error('Terminal failure schema or outcome is invalid');
  }
  return {
    outcome: 'infra-stop',
    costStatus: 'unavailable',
    evidenceError: typeof value.errorMessage === 'string'
      ? value.errorMessage.slice(0, 300)
      : 'Sutura stopped before complete case-file evidence was available',
  };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function durationSeconds(run) {
  const start = Date.parse(run.run_started_at ?? '');
  const end = Date.parse(run.updated_at ?? '');
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 1000 : null;
}

function emptyOutcomes() {
  return { fixed: 0, 'flaky-no-patch': 0, refused: 0, 'gave-up': 0, 'infra-stop': 0, unknown: 0 };
}

export async function collectFleetMetrics(configInput, client, now = new Date()) {
  const config = validateConfig(configInput, now);
  const events = [];
  const installations = [];
  for (const repository of [...config.repositories].sort()) {
    let runs;
    try {
      runs = await client.listWorkflowRuns(repository, config.startedAt);
      installations.push({ repository, installed: true });
    } catch (error) {
      if (error?.status !== 404) throw error;
      installations.push({ repository, installed: false });
      continue;
    }
    for (const run of runs) {
      const base = {
        repository,
        runId: run.id,
        runUrl: run.html_url,
        startedAt: run.run_started_at,
        completedAt: run.updated_at,
        durationSec: durationSeconds(run),
        workflowConclusion: run.conclusion ?? null,
      };
      if (run.conclusion === 'skipped') {
        const noRepairNeeded = typeof run.display_title === 'string' &&
          run.display_title.startsWith('No repair needed:');
        events.push({
          ...base,
          attempted: false,
          outcome: noRepairNeeded ? 'no-repair-needed' : 'not-triggered',
          costStatus: 'not-incurred',
        });
        continue;
      }
      const artifacts = await client.listArtifacts(repository, run.id);
      const caseArtifact = artifacts.find(({ name, expired }) =>
        !expired && /^sutura-case-file-[1-9]\d*\.html$/u.test(name));
      const terminalArtifact = artifacts.find(({ name, expired }) =>
        !expired && /^sutura-terminal-failure-[1-9]\d*\.json$/u.test(name));
      try {
        const artifact = caseArtifact ?? terminalArtifact;
        if (!artifact) throw new Error('Sutura run has no readable terminal evidence artifact');
        const content = await client.downloadArtifact(repository, run.id, artifact);
        const evidence = caseArtifact
          ? parseCaseFileHtml(content)
          : parseTerminalFailureJson(content);
        events.push({ ...base, attempted: true, costStatus: 'measured', ...evidence });
      } catch (error) {
        events.push({
          ...base,
          attempted: true,
          outcome: 'unknown',
          costStatus: 'unavailable',
          evidenceError: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        });
      }
    }
  }
  events.sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)) || left.repository.localeCompare(right.repository));
  const outcomes = emptyOutcomes();
  let inferenceCostUsd = 0;
  let sandboxCostUsd = 0;
  for (const event of events) {
    if (event.attempted && Object.hasOwn(outcomes, event.outcome)) outcomes[event.outcome] += 1;
    if (event.costStatus === 'measured') {
      inferenceCostUsd += event.inferenceCostUsd;
      sandboxCostUsd += event.sandboxCostUsd;
    }
  }
  const attempts = events.filter(({ attempted }) => attempted);
  const summary = {
    schemaVersion: 'sutura-fleet-summary-v1',
    collectedAt: now.toISOString(),
    startedAt: config.startedAt,
    actionCommit: config.actionCommit,
    fleetRepositories: config.repositories.length,
    installedRepositories: installations.filter(({ installed }) => installed).length,
    monitorRuns: events.length,
    noRepairNeeded: events.filter(({ outcome }) => outcome === 'no-repair-needed').length,
    notTriggered: events.filter(({ outcome }) => outcome === 'not-triggered').length,
    repairAttempts: attempts.length,
    outcomes,
    repairPrsOpened: attempts.filter(({ outcome, workflowConclusion }) => outcome === 'fixed' && workflowConclusion === 'success').length,
    inferenceCostUsd: rounded(inferenceCostUsd),
    sandboxCostUsd: rounded(sandboxCostUsd),
    totalCostUsd: rounded(inferenceCostUsd + sandboxCostUsd),
    medianAttemptDurationSec: median(attempts.flatMap(({ durationSec }) => durationSec === null ? [] : [durationSec])),
  };
  return { summary, events, installations };
}

export function publicFleetSummary(summary) {
  return structuredClone(summary);
}

function markdown(summary) {
  const completed = summary.outcomes.fixed + summary.outcomes['flaky-no-patch'] + summary.outcomes.refused + summary.outcomes['gave-up'];
  const repairRate = completed === 0 ? 'n/a' : `${((summary.outcomes.fixed / completed) * 100).toFixed(1)}%`;
  return `# Sutura fleet dogfood metrics\n\nCollected ${summary.collectedAt}. Window starts ${summary.startedAt}.\n\n| Metric | Value |\n| --- | ---: |\n| Repositories configured | ${summary.installedRepositories}/${summary.fleetRepositories} |\n| CI completions observed | ${summary.monitorRuns} |\n| Green CI, no repair needed | ${summary.noRepairNeeded} |\n| Other CI conclusions, no repair attempted | ${summary.notTriggered} |\n| Repair attempts | ${summary.repairAttempts} |\n| Verified repairs and PRs | ${summary.repairPrsOpened} |\n| Flakes classified without patching | ${summary.outcomes['flaky-no-patch']} |\n| Unsafe repairs refused | ${summary.outcomes.refused} |\n| Gave up safely | ${summary.outcomes['gave-up']} |\n| Infrastructure stops | ${summary.outcomes['infra-stop']} |\n| Unknown or missing evidence | ${summary.outcomes.unknown} |\n| Repair rate among terminal repair searches | ${repairRate} |\n| Measured inference cost | $${summary.inferenceCostUsd.toFixed(6)} |\n| Measured sandbox cost | $${summary.sandboxCostUsd.toFixed(6)} |\n| Measured total cost | $${summary.totalCostUsd.toFixed(6)} |\n| Median attempt duration | ${summary.medianAttemptDurationSec === null ? 'n/a' : `${summary.medianAttemptDurationSec.toFixed(1)} s`} |\n`;
}

export async function writeFleetMetrics(result, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, 'summary.json'), `${JSON.stringify(result.summary, null, 2)}\n`);
  await writeFile(join(outputDirectory, 'summary.md'), markdown(result.summary));
  await writeFile(join(outputDirectory, 'events.jsonl'), result.events.map((event) => JSON.stringify(event)).join('\n') + (result.events.length ? '\n' : ''));
  await writeFile(join(outputDirectory, 'installations.json'), `${JSON.stringify(result.installations, null, 2)}\n`);
  const snapshotsPath = join(outputDirectory, 'snapshots.jsonl');
  let snapshots = [];
  try {
    snapshots = (await readFile(snapshotsPath, 'utf8')).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const publicSummary = publicFleetSummary(result.summary);
  const day = publicSummary.collectedAt.slice(0, 10);
  snapshots = snapshots.filter(({ collectedAt }) => String(collectedAt).slice(0, 10) !== day);
  snapshots.push(publicSummary);
  snapshots.sort((left, right) => left.collectedAt.localeCompare(right.collectedAt));
  await writeFile(snapshotsPath, `${snapshots.map((value) => JSON.stringify(value)).join('\n')}\n`);
}

class GhFleetClient {
  constructor(owner, gh = process.env.GH_BIN || 'gh') {
    this.owner = owner;
    this.gh = gh;
  }

  async api(path, options = []) {
    try {
      const { stdout } = await execFile(this.gh, ['api', ...options, path], { maxBuffer: 64 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (error) {
      const detail = `${error?.stderr ?? ''}`;
      if (/HTTP 404|status code 404|Not Found/iu.test(detail)) error.status = 404;
      throw error;
    }
  }

  async listWorkflowRuns(repository, since) {
    const identity = repositoryIdentity(this.owner, repository);
    const pages = await this.api(
      `repos/${identity}/actions/workflows/sutura.yml/runs?per_page=100&created=>=${encodeURIComponent(since)}`,
      ['--paginate', '--slurp'],
    );
    return pages.flatMap(({ workflow_runs: runs = [] }) => runs);
  }

  async listArtifacts(repository, runId) {
    const identity = repositoryIdentity(this.owner, repository);
    const value = await this.api(`repos/${identity}/actions/runs/${runId}/artifacts?per_page=100`);
    return value.artifacts ?? [];
  }

  async downloadArtifact(repository, runId, artifact) {
    const identity = repositoryIdentity(this.owner, repository);
    const directory = await mkdtemp(join(tmpdir(), 'sutura-fleet-artifact-'));
    try {
      await execFile(this.gh, ['run', 'download', String(runId), '--repo', identity, '--name', artifact.name, '--dir', directory], { maxBuffer: 8 * 1024 * 1024 });
      const files = await readdir(directory, { recursive: true });
      if (files.length !== 1) throw new Error('Sutura evidence artifact must contain exactly one file');
      return readFile(join(directory, files[0]), 'utf8');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

function parseCli(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!['--config', '--output'].includes(name) || !value) throw new Error('Usage: node scripts/fleet-dogfood-metrics.mjs [--config path] [--output directory]');
    values.set(name, value);
  }
  return {
    config: resolve(values.get('--config') ?? DEFAULT_CONFIG),
    output: resolve(values.get('--output') ?? DEFAULT_OUTPUT),
  };
}

export async function main(arguments_ = process.argv.slice(2)) {
  const paths = parseCli(arguments_);
  const config = JSON.parse(await readFile(paths.config, 'utf8'));
  const result = await collectFleetMetrics(config, new GhFleetClient(config.owner));
  await writeFleetMetrics(result, paths.output);
  process.stdout.write(`${JSON.stringify(publicFleetSummary(result.summary))}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
