import { adjudicate } from './audit/adjudicate.js';
import { runMechanicalChecks } from './audit/mechanical.js';
import { classify } from './diagnose/classify.js';
import type { AuditFile, CostLedger, PolicyEvidence } from './domain.js';
import { vetPatch } from './engine/patch-rules.js';
import {
  evaluatePatchPolicy,
  filterPolicyDeniedText,
  policyAllowsSourceRead,
} from './policy/evaluate.js';
import type { RepositoryPolicy } from './policy/schema.js';
import type { TierLlm } from './llm/types.js';

const DIFF_HEADER_PREFIX = 'diff --git a/';
const DIFF_HEADER_SEPARATOR = ' b/';

const BUILT_IN_COMMANDS = new Set([
  'npm test', 'npm run test', 'npm run typecheck', 'npm run lint', 'npm run build',
  'pnpm test', 'pnpm run test', 'pnpm typecheck', 'pnpm run typecheck',
  'pnpm lint', 'pnpm run lint', 'pnpm build', 'pnpm run build',
  'yarn test', 'yarn run test', 'yarn typecheck', 'yarn run typecheck',
  'yarn lint', 'yarn run lint', 'yarn build', 'yarn run build',
]);

export class AuditEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditEvidenceError';
  }
}

export type AuditOnlyLlm = TierLlm<'nano' | 'ultra'>;

export interface AuditOnlyContext {
  llm: AuditOnlyLlm;
  cost: CostLedger;
  beforeLog: string;
  afterLog: string;
  candidateDiff: string;
  policy: RepositoryPolicy;
  policyEvidence: PolicyEvidence;
}

function logPayload(line: string): string {
  const finalField = line.slice(line.lastIndexOf('\t') + 1).trim();
  return finalField.replace(/^\d{4}-\d{2}-\d{2}T\S+Z\s+/u, '').trim();
}

function oneCommand(log: string, allowlist: ReadonlySet<string>): string {
  const commands = new Set<string>();
  for (const rawLine of log.split(/\r?\n/u)) {
    const match = /^(?:Run|\$)\s+(\S.*)$/u.exec(logPayload(rawLine));
    const command = match?.[1]?.trim();
    if (command) commands.add(command);
  }
  if (commands.size !== 1) {
    throw new AuditEvidenceError('Each audit log must contain exactly one unambiguous command identifier');
  }
  const command = [...commands][0] as string;
  if (!allowlist.has(command)) {
    throw new AuditEvidenceError(`Audit command is not allowlisted: ${command}`);
  }
  return command;
}

function oneExitCode(log: string): number {
  const codes = [...log.matchAll(/Process completed with exit code (\d+)\.?/gu)]
    .map((match) => Number(match[1]));
  if (codes.length !== 1 || !Number.isSafeInteger(codes[0])) {
    throw new AuditEvidenceError('Each audit log must contain exactly one GitHub exit-code marker');
  }
  return codes[0] as number;
}

export function validateAuditEvidence(
  beforeLog: string,
  afterLog: string,
  policyCommands: readonly string[],
): { command: string; beforeExitCode: number; afterExitCode: number } {
  const allowlist = new Set([...BUILT_IN_COMMANDS, ...policyCommands]);
  const beforeCommand = oneCommand(beforeLog, allowlist);
  const afterCommand = oneCommand(afterLog, allowlist);
  if (beforeCommand !== afterCommand) {
    throw new AuditEvidenceError('Before and after logs must use the same command identifier');
  }
  const beforeExitCode = oneExitCode(beforeLog);
  const afterExitCode = oneExitCode(afterLog);
  if (beforeExitCode === 0) throw new AuditEvidenceError('Before log must show a failing command');
  if (afterExitCode !== 0) throw new AuditEvidenceError('After log must show a passing command');
  return { command: beforeCommand, beforeExitCode, afterExitCode };
}

function diffHeaderPaths(line: string): readonly [string, string] | null {
  if (!line.startsWith(DIFF_HEADER_PREFIX)) return null;
  const rest = line.slice(DIFF_HEADER_PREFIX.length);
  const separator = rest.lastIndexOf(DIFF_HEADER_SEPARATOR);
  if (separator <= 0) return null;
  const after = rest.slice(separator + DIFF_HEADER_SEPARATOR.length);
  if (!after) return null;
  return [rest.slice(0, separator), after];
}

function filterPolicyDeniedDiff(diff: string, policy: RepositoryPolicy): string {
  const output: string[] = [];
  let deniedFile = false;
  for (const line of diff.split(/\r?\n/u)) {
    const header = diffHeaderPaths(line);
    if (header) {
      deniedFile = !policyAllowsSourceRead(header[0], policy) ||
        !policyAllowsSourceRead(header[1], policy);
      output.push(deniedFile ? '[policy-denied repository context]' : line);
      continue;
    }
    const oldPath = /^--- a\/(.+)$/u.exec(line)?.[1];
    if (oldPath) {
      deniedFile = !policyAllowsSourceRead(oldPath, policy);
      output.push(deniedFile ? '[policy-denied repository context]' : line);
      continue;
    }
    const newPath = /^\+\+\+ b\/(.+)$/u.exec(line)?.[1];
    if (newPath) {
      deniedFile = deniedFile || !policyAllowsSourceRead(newPath, policy);
      output.push(deniedFile ? '[policy-denied repository context]' : line);
      continue;
    }
    if (!deniedFile) output.push(filterPolicyDeniedText(line, policy));
  }
  return output.join('\n');
}

export async function auditOnly(context: AuditOnlyContext): Promise<AuditFile> {
  const evidence = validateAuditEvidence(
    context.beforeLog,
    context.afterLog,
    context.policy.requiredCommands,
  );
  const safeBeforeLog = filterPolicyDeniedText(context.beforeLog, context.policy);
  const safeAfterLog = filterPolicyDeniedText(context.afterLog, context.policy);
  const safeDiff = filterPolicyDeniedDiff(context.candidateDiff, context.policy);
  const before = await classify(context.llm, safeBeforeLog);
  const after = await classify(context.llm, safeAfterLog);
  const builtIn = vetPatch(context.candidateDiff, before);
  const policy = evaluatePatchPolicy(context.candidateDiff, context.policy);
  const mechanical = runMechanicalChecks(context.candidateDiff);
  const adjudication = await adjudicate(context.llm, {
    diagnosis: before,
    diff: safeDiff,
    beforeLog: safeBeforeLog,
    afterLog: safeAfterLog,
  });
  const checks = [
    ...mechanical,
    {
      name: 'paired-evidence' as const,
      passed: true,
      evidence: `${evidence.command}: exit ${evidence.beforeExitCode} -> ${evidence.afterExitCode}`,
    },
    {
      name: 'policy-patch' as const,
      passed: builtIn.ok && policy.ok,
      evidence: [...builtIn.violations, ...policy.violations].join('; ') || 'Built-in and repository patch rules passed',
    },
    {
      name: 'llm-adjudication' as const,
      passed: adjudication.approved,
      evidence: adjudication.reasoning,
    },
  ];
  const approved = checks.every((check) => check.passed);
  return {
    assurance: 'reduced',
    outcome: approved ? 'audit-approved' : 'audit-refused',
    diagnosis: { before, after },
    policy: context.policyEvidence,
    audit: {
      approved,
      checks,
      reasoning: approved
        ? adjudication.reasoning
        : `REFUSED: ${checks.filter((check) => !check.passed).map((check) => check.name).join(', ')}`,
    },
    cost: context.cost,
  };
}
