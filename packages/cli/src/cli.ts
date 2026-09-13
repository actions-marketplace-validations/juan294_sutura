import { notRunTriageVerdict, type AuditFile, type CaseFile, type CostLedger } from '@sutura/core';

import {
  CliUsageError,
  parseArgs,
  USAGE,
  VERSION,
  type DoctorArguments,
  type AuditArguments,
  type HealArguments,
  type InitArguments,
  type ReplayArguments,
  type VerifyArguments,
} from './args.js';
import { doctorSutura, type DoctorResult } from './doctor.js';
import { detectLocalRuntimeId, healFromEnvironment } from './heal.js';
import { auditFromEnvironment } from './heal.js';
import { installSutura, type SetupResult } from './setup.js';
import { runEvaluationCommand } from './eval.js';
import { replayFromFile } from './replay.js';
import { executeVerify, verifyRuntimeFromEnvironment } from './verify.js';

export interface CliIo {
  write?: (value: string) => void;
  writeError?: (value: string) => void;
}

export interface CliDependencies {
  heal?: (request: HealArguments) => Promise<CaseFile>;
  init?: (request: InitArguments) => Promise<SetupResult>;
  doctor?: (request: DoctorArguments) => Promise<DoctorResult>;
  audit?: (request: AuditArguments) => Promise<AuditFile>;
  verify?: (request: VerifyArguments) => Promise<unknown>;
  replay?: (request: ReplayArguments) => Promise<CaseFile>;
}

function emptyLedger(): CostLedger {
  return { entries: [], totalUsd: () => 0 };
}

function publicError(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return reason
    .replace(/https?:\/\/[^\s"'<>\\]+/giu, (value) => {
      try {
        const url = new URL(value);
        url.username = '';
        url.password = '';
        url.search = '';
        url.hash = '';
        return url.toString();
      } catch {
        return '[redacted URL]';
      }
    })
    .replace(/\bBearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(
      /\b(?:[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)|api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;]+/giu,
      '[redacted credential]',
    );
}

function diagnosticExcerpt(reason: string): string {
  const limit = 2_000;
  if (reason.length <= limit) return reason;
  const marker = '\n[truncated]\n';
  const headLength = 750;
  return reason.slice(0, headLength) + marker + reason.slice(-(limit - headLength - marker.length));
}

async function infraStop(
  caseDir: string,
  error: unknown,
  configuredRuntime?: 'node' | 'python',
): Promise<CaseFile> {
  const reason = publicError(error);
  const caseName = caseDir.split(/[\\/]/u).filter(Boolean).at(-1) ?? 'case';
  const runtime = configuredRuntime ?? await detectLocalRuntimeId(caseDir).catch(() => 'node' as const);
  return {
    runId: `local-${caseName}`,
    repo: `local/${caseName}`,
    runtime,
    diagnosis: {
      class: 'infra',
      confidence: 1,
      signals: ['cli-runtime-failure'],
      failingCmd: 'pnpm test',
      errorExcerpt: diagnosticExcerpt(reason),
    },
    triage: notRunTriageVerdict(),
    race: [],
    outcome: 'infra-stop',
    cost: emptyLedger(),
    policy: { baseRef: 'local', baseSha: 'local', policySha: 'unavailable' },
    stages: [{
      stage: 'policy',
      attempt: 1,
      nodeId: 'node-001',
      metrics: {},
      network: 'disabled',
      note: 'CLI stopped after an unhandled runtime failure; provider completion and cost are unavailable',
    }],
  };
}

export async function runCli(
  args = process.argv.slice(2),
  io: CliIo = {},
  dependencies: CliDependencies = {},
): Promise<number> {
  const write = io.write ?? ((value: string) => process.stdout.write(value));
  const writeError = io.writeError ?? ((value: string) => process.stderr.write(value));
  let request;
  try {
    request = parseArgs(args);
  } catch (error) {
    const detail = error instanceof CliUsageError ? error.message : 'Invalid arguments';
    writeError(`${detail}\n${USAGE}\n`);
    return 2;
  }

  if (request.command === 'help') {
    write(`${USAGE}\n`);
    return 0;
  }
  if (request.command === 'version') {
    write(`${VERSION}\n`);
    return 0;
  }
  if (request.command === 'init' || request.command === 'doctor') {
    try {
      const result = request.command === 'init'
        ? await (dependencies.init ?? installSutura)(request)
        : await (dependencies.doctor ?? doctorSutura)(request);
      write(`${result.lines.join('\n')}\n`);
      return 'exitCode' in result ? result.exitCode : 0;
    } catch (error) {
      writeError(`${publicError(error)}\n`);
      return 1;
    }
  }
  if (request.command === 'eval-validate' || request.command === 'eval-export') {
    try {
      const lines = await runEvaluationCommand(request);
      write(`${lines.join('\n')}\n`);
      return 0;
    } catch (error) {
      writeError(`${publicError(error)}\n`);
      return 1;
    }
  }
  if (request.command === 'verify') {
    try {
      const result = dependencies.verify !== undefined
        ? await dependencies.verify(request)
        : await executeVerify(request, verifyRuntimeFromEnvironment());
      write(`${JSON.stringify(result)}\n`);
      return typeof result === 'object' && result !== null && 'status' in result && result.status === 'verified-supplied-patch' ? 0 : 1;
    } catch (error) {
      writeError(`${publicError(error)}\n`);
      return 1;
    }
  }
  if (request.command === 'audit') {
    try {
      const auditFile = await (dependencies.audit ?? auditFromEnvironment)(request);
      write(`${JSON.stringify(auditFile)}\n`);
      return 0;
    } catch (error) {
      writeError(`${publicError(error)}\n`);
      return 1;
    }
  }
  if (request.command === 'replay') {
    try {
      const caseFile = await (dependencies.replay ?? replayFromFile)(request);
      write(`${JSON.stringify(caseFile)}\n`);
      return 0;
    } catch (error) {
      writeError(`${publicError(error)}\n`);
      return 1;
    }
  }

  let caseFile: CaseFile;
  try {
    caseFile = await (dependencies.heal ?? healFromEnvironment)(request);
  } catch (error) {
    caseFile = await infraStop(request.caseDir, error, request.runtime);
  }
  write(`${JSON.stringify(caseFile)}\n`);
  return 0;
}
