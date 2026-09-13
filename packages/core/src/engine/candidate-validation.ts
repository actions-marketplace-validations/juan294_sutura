import { Buffer } from 'node:buffer';

import type { Diagnosis } from '../domain.js';
import { parseUnifiedDiff } from '../diff/unified.js';
import { evaluatePatchPolicy } from '../policy/evaluate.js';
import type { RepositoryPolicy } from '../policy/schema.js';
import { vetPatch } from './patch-rules.js';
import type { RepairAuthorizationContext } from './repair-authorization.js';

export interface CandidateValidation {
  ok: boolean;
  violations: string[];
  changedFiles: string[];
  diffBytes: number;
}

export function validateCandidateDiff(
  diff: string,
  diagnosis: Diagnosis,
  policy: RepositoryPolicy,
  runMaxDiffBytes = policy.maxDiffBytes,
  authorization?: RepairAuthorizationContext,
): CandidateValidation {
  const bytes = Buffer.byteLength(diff, 'utf8');
  const parsed = parseUnifiedDiff(diff);
  const paths = [...new Set(parsed.files.flatMap(({ oldPath, newPath }) =>
    [oldPath, newPath].filter((path): path is string => path !== null),
  ))];
  const builtIn = vetPatch(diff, diagnosis, authorization);
  const policyVerdict = builtIn.ok ? evaluatePatchPolicy(diff, policy) : { ok: true, violations: [] };
  const runViolations = bytes > runMaxDiffBytes
    ? [`diff is ${bytes} bytes; run permits at most ${runMaxDiffBytes}`]
    : [];
  const violations = [...builtIn.violations, ...policyVerdict.violations, ...runViolations];
  return { ok: violations.length === 0, violations, changedFiles: paths, diffBytes: bytes };
}
