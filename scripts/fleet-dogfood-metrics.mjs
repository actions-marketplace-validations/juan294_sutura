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
    providerInvoked: null,
    searchStarted: outcome === 'fixed' ? true : null,
  };
}

function boundedTelemetryString(value, fallback = null) {
  return typeof value === 'string' && /^[A-Za-z0-9._:/-]{1,160}$/u.test(value)
    ? value
    : fallback;
}

function boundedFailureDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).flatMap(([key, detail]) =>
    /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(key) &&
    ((typeof detail === 'number' && Number.isFinite(detail)) ||
      (typeof detail === 'string' && detail.length <= 160))
      ? [[key, detail]]
      : []);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function legacyFailureIdentity(message, errorClass) {
  const cases = [
    [/Runtime evidence exceeds/iu, 'runtime-evidence-limit', 'runtime-detection'],
    [/Failed-step logs do not contain an observed failing command/iu, 'failing-command-not-observed', 'diagnosis'],
    [/ConTree.*(?:504|Gateway Timeout)/iu, 'contree-http-504', 'sandbox'],
    [/already attempted workflow run/iu, 'already-attempted', 'claim'],
    [/snapshot.*(?:exceed|bounded source size)/iu, 'replay-snapshot-limit', 'replay-capture'],
  ];
  const matched = cases.find(([pattern]) => pattern.test(message));
  return {
    failureCode: matched?.[1] ?? 'unstructured',
    failureStage: matched?.[2] ?? 'unknown',
    errorClass: boundedTelemetryString(errorClass, 'UnknownError'),
  };
}

function parseBoundedJson(content, maximumBytes, label) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > maximumBytes) {
    throw new Error(`${label} must be bounded JSON text`);
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function mergeObservedBoolean(primary, secondary) {
  if (primary === true || secondary === true) return true;
  if (primary === false || secondary === false) return false;
  return null;
}

export function parseTerminalFailureJson(content) {
  const value = parseBoundedJson(content, 64 * 1024, 'Terminal failure');
  if (!['sutura-terminal-failure-v1', 'sutura-terminal-failure-v2'].includes(value?.schemaVersion) || value.outcome !== 'infra-stop') {
    throw new Error('Terminal failure schema or outcome is invalid');
  }
  const base = {
    outcome: 'infra-stop',
    costStatus: 'unavailable',
    evidenceError: typeof value.errorMessage === 'string'
      ? value.errorMessage.slice(0, 300)
      : 'Sutura stopped before complete case-file evidence was available',
  };
  if (value.schemaVersion === 'sutura-terminal-failure-v1') {
    const fixture = value.fixtureIdentity && typeof value.fixtureIdentity === 'object' ? value.fixtureIdentity : {};
    const packageIdentity = value.packageIdentity && typeof value.packageIdentity === 'object' ? value.packageIdentity : {};
    const sourceRunId = boundedTelemetryString(fixture.targetRunId);
    const sourceCommit = SHA.test(fixture.fixtureCommit ?? '') ? fixture.fixtureCommit : null;
    const actionSha = SHA.test(packageIdentity.actionSha ?? '') ? packageIdentity.actionSha : null;
    return {
      ...base,
      ...legacyFailureIdentity(base.evidenceError, value.errorClass),
      ...(sourceRunId === null ? {} : { sourceRunId }),
      ...(sourceCommit === null ? {} : { sourceCommit }),
      ...(actionSha === null ? {} : { actionSha, actionShaSource: 'legacy-terminal-field' }),
    };
  }
  const failure = value.failure && typeof value.failure === 'object' ? value.failure : {};
  const fixture = value.fixtureIdentity && typeof value.fixtureIdentity === 'object' ? value.fixtureIdentity : {};
  const packageIdentity = value.packageIdentity && typeof value.packageIdentity === 'object' ? value.packageIdentity : {};
  const execution = value.execution && typeof value.execution === 'object' ? value.execution : {};
  const runtimeDetection = value.runtimeDetection && typeof value.runtimeDetection === 'object'
    ? value.runtimeDetection : {};
  const providerInvocations = Number.isSafeInteger(execution.providerInvocations) && execution.providerInvocations >= 0
    ? execution.providerInvocations : null;
  const sandboxOperations = Number.isSafeInteger(execution.sandboxOperations) && execution.sandboxOperations >= 0
    ? execution.sandboxOperations : null;
  const failureDetails = boundedFailureDetails(failure.details);
  return {
    ...base,
    failureCode: boundedTelemetryString(failure.code, 'unknown-error'),
    failureStage: boundedTelemetryString(failure.stage, 'unknown'),
    errorClass: boundedTelemetryString(failure.class, 'UnknownError'),
    ...(failureDetails === undefined ? {} : { failureDetails }),
    sourceRunId: boundedTelemetryString(fixture.targetRunId),
    sourceCommit: SHA.test(fixture.fixtureCommit ?? '') ? fixture.fixtureCommit : null,
    pullRequestNumber: Number.isSafeInteger(fixture.pullRequestNumber) && fixture.pullRequestNumber > 0
      ? fixture.pullRequestNumber : null,
    actionSha: SHA.test(packageIdentity.actionSha ?? '') ? packageIdentity.actionSha : null,
    actionShaSource: boundedTelemetryString(packageIdentity.actionShaSource, 'unavailable'),
    claimState: boundedTelemetryString(execution.claimState, 'not-observed'),
    providerInvocations,
    sandboxOperations,
    providerInvoked: providerInvocations === null ? null : providerInvocations > 0,
    searchStarted: typeof execution.searchStarted === 'boolean' ? execution.searchStarted : null,
    terminalCommentState: boundedTelemetryString(execution.terminalCommentState, 'not-recorded'),
    runtime: boundedTelemetryString(runtimeDetection.runtime),
    runtimeEvidenceSource: boundedTelemetryString(runtimeDetection.evidenceSource),
    runtimeEvidenceCount: Number.isSafeInteger(runtimeDetection.evidenceCount) &&
      runtimeDetection.evidenceCount >= 0 && runtimeDetection.evidenceCount <= 500
      ? runtimeDetection.evidenceCount : null,
    runtimeVisitedEntries: Number.isSafeInteger(runtimeDetection.visitedEntries) &&
      runtimeDetection.visitedEntries >= 0 && runtimeDetection.visitedEntries <= 500
      ? runtimeDetection.visitedEntries : null,
  };
}

export function parseReplayIdentityJson(content) {
  const value = parseBoundedJson(content, 32 * 1024 * 1024, 'Replay bundle');
  if (value?.schemaVersion !== 'sutura-replay-v1' || !Array.isArray(value.github) ||
      !Array.isArray(value.executor) || !Array.isArray(value.http)) {
    throw new Error('Replay bundle schema is invalid');
  }
  const workflowRun = value.github.find(({ method, result }) =>
    method === 'getWorkflowRun' && result && typeof result === 'object' && !Array.isArray(result))?.result ?? {};
  const pullRequests = Array.isArray(workflowRun.pullRequests) ? workflowRun.pullRequests : [];
  const pullRequestNumber = pullRequests.length === 1 && Number.isSafeInteger(pullRequests[0]?.number) && pullRequests[0].number > 0
    ? pullRequests[0].number : null;
  const operationIds = new Set(value.executor.flatMap(({ result }) => {
    const operationId = result?.operation?.operationId;
    return typeof operationId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(operationId)
      ? [operationId] : [];
  }));
  const providerInvocations = value.http.filter(({ boundary }) => boundary === 'nebius').length;
  const claimed = value.github.some(({ method, result }) =>
    ['createCheckRun', 'createIssueComment', 'createCommitComment'].includes(method) && !result?.error);
  return {
    sourceRunId: boundedTelemetryString(value.runId),
    sourceCommit: SHA.test(workflowRun.headSha ?? '') ? workflowRun.headSha : null,
    pullRequestNumber,
    actionSha: SHA.test(value.actionSha ?? '') ? value.actionSha : null,
    actionShaSource: 'replay-bundle',
    claimState: claimed ? 'claimed' : 'not-observed',
    providerInvocations,
    providerInvoked: providerInvocations > 0,
    sandboxOperations: operationIds.size,
    searchStarted: [...operationIds].some((id) => id.startsWith('search-')) ? true : null,
    replayComplete: value.completeness?.complete === true,
    runtime: boundedTelemetryString(value.runtimeDetection?.runtime),
    runtimeEvidenceSource: boundedTelemetryString(value.runtimeDetection?.evidenceSource),
    runtimeEvidenceCount: Array.isArray(value.runtimeDetection?.evidencePaths) &&
      value.runtimeDetection.evidencePaths.length <= 500
      ? value.runtimeDetection.evidencePaths.length : null,
    runtimeVisitedEntries: Number.isSafeInteger(value.runtimeDetection?.visitedEntries) &&
      value.runtimeDetection.visitedEntries >= 0 && value.runtimeDetection.visitedEntries <= 500
      ? value.runtimeDetection.visitedEntries : null,
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
      const replayArtifact = artifacts.find(({ name, expired }) =>
        !expired && /^sutura-replay-[1-9]\d*\.json$/u.test(name));
      try {
        const artifact = caseArtifact ?? terminalArtifact;
        if (!artifact) throw new Error('Sutura run has no readable terminal evidence artifact');
        const [content, replayDownload] = await Promise.all([
          client.downloadArtifact(repository, run.id, artifact),
          replayArtifact
            ? client.downloadArtifact(repository, run.id, replayArtifact)
              .then((replayContent) => ({ replayContent, replayEvidenceError: null }))
              .catch((error) => ({
                replayContent: null,
                replayEvidenceError: error instanceof Error
                  ? error.message.slice(0, 300)
                  : String(error).slice(0, 300),
              }))
            : Promise.resolve({ replayContent: null, replayEvidenceError: null }),
        ]);
        const evidence = caseArtifact
          ? parseCaseFileHtml(content)
          : parseTerminalFailureJson(content);
        let replayEvidence = {};
        let replayEvidenceError = replayDownload.replayEvidenceError;
        if (replayDownload.replayContent !== null) {
          try {
            replayEvidence = parseReplayIdentityJson(replayDownload.replayContent);
          } catch (error) {
            replayEvidenceError = error instanceof Error
              ? error.message.slice(0, 300)
              : String(error).slice(0, 300);
          }
        }
        const providerInvoked = mergeObservedBoolean(
          evidence.providerInvoked,
          replayEvidence.providerInvoked,
        );
        const searchStarted = mergeObservedBoolean(
          evidence.searchStarted,
          replayEvidence.searchStarted,
        );
        events.push({
          ...base,
          attempted: true,
          costStatus: 'measured',
          ...evidence,
          ...replayEvidence,
          providerInvoked,
          searchStarted,
          sourceRunId: evidence.sourceRunId ?? replayEvidence.sourceRunId ?? null,
          sourceCommit: evidence.sourceCommit ?? replayEvidence.sourceCommit ?? null,
          pullRequestNumber: evidence.pullRequestNumber ?? replayEvidence.pullRequestNumber ?? null,
          actionSha: evidence.actionSha ?? replayEvidence.actionSha ?? null,
          actionShaSource: evidence.actionSha === null || evidence.actionSha === undefined
            ? replayEvidence.actionShaSource ?? 'unavailable'
            : evidence.actionShaSource ?? 'unavailable',
          runtime: evidence.runtime ?? replayEvidence.runtime ?? null,
          runtimeEvidenceSource: evidence.runtimeEvidenceSource ?? replayEvidence.runtimeEvidenceSource ?? null,
          runtimeEvidenceCount: evidence.runtimeEvidenceCount ?? replayEvidence.runtimeEvidenceCount ?? null,
          runtimeVisitedEntries: evidence.runtimeVisitedEntries ?? replayEvidence.runtimeVisitedEntries ?? null,
          ...(replayEvidenceError === null ? {} : { replayEvidenceError }),
          expectedActionSha: config.actionCommit,
        });
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
    schemaVersion: 'sutura-fleet-summary-v2',
    collectedAt: now.toISOString(),
    startedAt: config.startedAt,
    actionCommit: config.actionCommit,
    fleetRepositories: config.repositories.length,
    installedRepositories: installations.filter(({ installed }) => installed).length,
    monitorRuns: events.length,
    noRepairNeeded: events.filter(({ outcome }) => outcome === 'no-repair-needed').length,
    notTriggered: events.filter(({ outcome }) => outcome === 'not-triggered').length,
    repairAttempts: attempts.length,
    attemptStages: {
      attempted: attempts.length,
      claimed: attempts.filter(({ claimState }) => claimState === 'claimed').length,
      searchStarted: attempts.filter(({ searchStarted }) => searchStarted === true).length,
      providerInvoked: attempts.filter(({ providerInvoked }) => providerInvoked === true).length,
      fixed: attempts.filter(({ outcome }) => outcome === 'fixed').length,
      recovered: null,
      recoveryEvidenceComplete: false,
    },
    failureCauses: Object.fromEntries([...new Set(attempts
      .filter(({ outcome }) => outcome === 'infra-stop')
      .map(({ failureCode }) => failureCode ?? 'unstructured'))]
      .sort()
      .map((cause) => [cause, attempts.filter((event) =>
        event.outcome === 'infra-stop' && (event.failureCode ?? 'unstructured') === cause).length])),
    costCompleteness: {
      measured: attempts.filter(({ costStatus }) => costStatus === 'measured').length,
      unavailable: attempts.filter(({ costStatus }) => costStatus === 'unavailable').length,
    },
    actionIdentity: {
      matched: attempts.filter(({ actionSha }) => actionSha === config.actionCommit).length,
      mismatched: attempts.filter(({ actionSha }) => actionSha !== null && actionSha !== undefined && actionSha !== config.actionCommit).length,
      unavailable: attempts.filter(({ actionSha }) => actionSha === null || actionSha === undefined).length,
    },
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
  return `# Sutura fleet dogfood metrics\n\nCollected ${summary.collectedAt}. Window starts ${summary.startedAt}.\n\n| Metric | Value |\n| --- | ---: |\n| Repositories configured | ${summary.installedRepositories}/${summary.fleetRepositories} |\n| CI completions observed | ${summary.monitorRuns} |\n| Green CI, no repair needed | ${summary.noRepairNeeded} |\n| Other CI conclusions, no repair attempted | ${summary.notTriggered} |\n| Repair attempts | ${summary.attemptStages.attempted} |\n| Attempts claimed | ${summary.attemptStages.claimed} |\n| Provider invoked | ${summary.attemptStages.providerInvoked} |\n| Repair search started | ${summary.attemptStages.searchStarted} |\n| Verified repairs and PRs | ${summary.repairPrsOpened} |\n| Recovered CI | ${summary.attemptStages.recovered === null ? 'not measured' : summary.attemptStages.recovered} |\n| Flakes classified without patching | ${summary.outcomes['flaky-no-patch']} |\n| Unsafe repairs refused | ${summary.outcomes.refused} |\n| Gave up safely | ${summary.outcomes['gave-up']} |\n| Infrastructure stops | ${summary.outcomes['infra-stop']} |\n| Unknown or missing evidence | ${summary.outcomes.unknown} |\n| Repair rate among terminal repair searches | ${repairRate} |\n| Measured inference cost | $${summary.inferenceCostUsd.toFixed(6)} |\n| Measured sandbox cost | $${summary.sandboxCostUsd.toFixed(6)} |\n| Measured total cost | $${summary.totalCostUsd.toFixed(6)} |\n| Median attempt duration | ${summary.medianAttemptDurationSec === null ? 'n/a' : `${summary.medianAttemptDurationSec.toFixed(1)} s`} |\n`;
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
