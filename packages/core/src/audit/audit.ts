import type {
  AuditVerdict,
  Diagnosis,
  GreenwashCheck,
  RaceResult,
} from '../domain.js';
import { SNAPSHOT_CWD, type Executor, type RunResult } from '../executor/types.js';
import { boundedTail } from '../text/bounded-tail.js';
import { adjudicate, type AdjudicationLlm } from './adjudicate.js';
import { runMechanicalChecks } from './mechanical.js';
import { vetPatch } from '../engine/patch-rules.js';
import type { RepairAuthorizationContext } from '../engine/repair-authorization.js';

export type AuditLlm = AdjudicationLlm;

export interface AuditContext {
  diagnosis: Diagnosis;
  beforeLog: string;
  suiteCommand: string;
  authorization?: RepairAuthorizationContext;
}

const OUTPUT_STREAM_BOUNDS = {
  maxLines: 50,
  maxCharacters: 1_000,
  maxBytes: 1_000,
};
const OUTPUT_EXCERPT_BOUNDS = {
  maxLines: 100,
  maxCharacters: 2_000,
  maxBytes: 2_000,
};

function skippedAdjudication(reason: string): AuditVerdict['checks'][number] {
  return {
    name: 'llm-adjudication',
    passed: false,
    evidence: `Not run: ${reason}`,
  };
}

function outputExcerpt(stdout: string, stderr: string): string {
  const parts = [stdout, stderr]
    .map((output) => boundedTail(output, OUTPUT_STREAM_BOUNDS).trim())
    .filter(Boolean);
  return boundedTail(parts.join('\n'), OUTPUT_EXCERPT_BOUNDS);
}

function failedNames(checks: readonly { name: GreenwashCheck; passed: boolean }[]): string {
  return checks
    .filter(({ passed }) => !passed)
    .map(({ name }) => name)
    .join(', ');
}

export async function audit(
  executor: Executor,
  llm: AuditLlm,
  winner: RaceResult,
  context: AuditContext,
  observe?: (result: RunResult) => void,
): Promise<AuditVerdict> {
  const mechanical = runMechanicalChecks(winner.candidate.diff);
  const mechanicalFailures = mechanical.filter(({ passed }) => !passed);
  if (mechanicalFailures.length > 0) {
    const checks: AuditVerdict['checks'] = [
      ...mechanical,
      skippedAdjudication('mechanical checks refused the patch'),
    ];
    return {
      approved: false,
      checks,
      reasoning: `REFUSED: deterministic checks found green-washing (${failedNames(mechanicalFailures)}).`,
    };
  }

  if (!winner.held || winner.exitCode !== 0) {
    return {
      approved: false,
      checks: [
        ...mechanical,
        skippedAdjudication('the selected candidate did not hold'),
      ],
      reasoning: 'REFUSED: the selected candidate did not pass its repair race.',
    };
  }
  const authorization = vetPatch(winner.candidate.diff, context.diagnosis, context.authorization);
  if (!authorization.ok) {
    return { approved: false, checks: [...mechanical, { name: 'policy-patch', passed: false, evidence: authorization.violations.join('; ') }, skippedAdjudication('repair authorization refused the patch')], reasoning: `REFUSED: ${authorization.violations.join('; ')}` };
  }
  if (!context.suiteCommand.trim()) {
    return {
      approved: false,
      checks: [
        ...mechanical,
        skippedAdjudication('the suite command was empty'),
      ],
      reasoning: 'REFUSED: a fresh suite rerun requires a non-empty command.',
    };
  }

  const rerun = await executor.run(winner.imageId, context.suiteCommand, {
    cwd: SNAPSHOT_CWD,
  });
  observe?.(rerun);
  const afterLog = outputExcerpt(rerun.stdout, rerun.stderr);
  if (rerun.exitCode !== 0) {
    const detail = afterLog ? `: ${afterLog}` : '';
    return {
      approved: false,
      checks: [
        ...mechanical,
        skippedAdjudication('the fresh suite rerun failed'),
      ],
      reasoning: `REFUSED: fresh suite rerun exited ${rerun.exitCode}${detail}`,
    };
  }

  const adjudication = await adjudicate(llm, {
    diagnosis: context.diagnosis,
    diff: winner.candidate.diff,
    beforeLog: context.beforeLog,
    afterLog,
  });
  return {
    approved: adjudication.approved,
    checks: [
      ...mechanical,
      {
        name: 'llm-adjudication',
        passed: adjudication.approved,
        evidence: adjudication.reasoning,
      },
    ],
    reasoning: adjudication.reasoning,
  };
}
