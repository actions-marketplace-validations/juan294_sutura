import { Buffer } from 'node:buffer';

import { isVerificationPrivatePath } from '../security/repository-path.js';

import { parseUnifiedDiff } from '../diff/unified.js';
import type { RunMetrics } from '../executor/types.js';
import type { PatchVerdict } from '../engine/patch-rules.js';
import type { RepositoryPolicy, ResourceLimits } from './schema.js';

function matchSegment(glob: string, value: string): boolean {
  let globIndex = 0;
  let valueIndex = 0;
  let starIndex = -1;
  let starValueIndex = -1;
  while (valueIndex < value.length) {
    const token = glob[globIndex];
    if (token === '?' || token === value[valueIndex]) {
      globIndex += 1;
      valueIndex += 1;
    } else if (token === '*') {
      starIndex = globIndex;
      starValueIndex = valueIndex;
      globIndex += 1;
    } else if (starIndex >= 0) {
      globIndex = starIndex + 1;
      starValueIndex += 1;
      valueIndex = starValueIndex;
    } else {
      return false;
    }
  }
  while (glob[globIndex] === '*') globIndex += 1;
  return globIndex === glob.length;
}

export function isPolicyPathMatched(glob: string, path: string): boolean {
  const globSegments = glob.split('/');
  const pathSegments = path.split('/');
  const memo = new Map<string, boolean>();
  const match = (globIndex: number, pathIndex: number): boolean => {
    const key = `${globIndex}:${pathIndex}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const segment = globSegments[globIndex];
    let result: boolean;
    if (segment === undefined) {
      result = pathIndex === pathSegments.length;
    } else if (segment === '**') {
      result = match(globIndex + 1, pathIndex) ||
        (pathIndex < pathSegments.length && match(globIndex, pathIndex + 1));
    } else {
      const pathSegment = pathSegments[pathIndex];
      result = pathSegment !== undefined &&
        matchSegment(segment, pathSegment) &&
        match(globIndex + 1, pathIndex + 1);
    }
    memo.set(key, result);
    return result;
  };
  return match(0, 0);
}

function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => isPolicyPathMatched(glob, path));
}

export function policyAllowsSourceRead(path: string, policy: RepositoryPolicy): boolean {
  return !isVerificationPrivatePath(path) && !matchesAny(path, policy.deniedReadPaths);
}

export function policyAllowsPatchPath(path: string, policy: RepositoryPolicy): boolean {
  return !isVerificationPrivatePath(path) &&
    !matchesAny(path, policy.protectedPaths) && matchesAny(path, policy.allowedPaths);
}

const WORKSPACE_PATH_PREFIX = /(?:file:\/\/\/workspace\/|\/workspace\/|\/(?:home\/runner\/work|__w)\/([A-Za-z0-9_.-]+)\/\1\/)/gu;
const REPOSITORY_PATH_IN_TEXT = /(?:^|[\t "'(`=])(?<path>(?:\.\/)?(?:(?:[A-Za-z0-9_@.-][A-Za-z0-9_@. -]*\/)+[A-Za-z0-9_@.-][A-Za-z0-9_@. -]*|[A-Za-z0-9_@.-][A-Za-z0-9_@. -]*\.[A-Za-z0-9_-]+))(?=:\d+|\(|[\t ]|$)/gu;

export function filterPolicyDeniedText(
  text: string,
  policy: RepositoryPolicy,
): string {
  return text.split(/\r?\n/u).map((line) => {
    const normalizedLine = line.replace(WORKSPACE_PATH_PREFIX, '');
    const denied = [...normalizedLine.matchAll(REPOSITORY_PATH_IN_TEXT)].some((match) => {
      const path = (match.groups?.path ?? '').replace(/^\.\//u, '').trimEnd();
      const segments = path.split('/');
      return segments.some((_, index) =>
        !policyAllowsSourceRead(segments.slice(index).join('/'), policy),
      );
    });
    return denied ? '[policy-denied repository context]' : line;
  }).join('\n');
}

export function evaluatePatchPolicy(
  diff: string,
  policy: RepositoryPolicy,
): PatchVerdict {
  const parsed = parseUnifiedDiff(diff);
  if (!parsed.valid) {
    return { ok: false, violations: ['repository policy could not parse patch'] };
  }
  const paths = new Set<string>();
  for (const file of parsed.files) {
    if (file.oldPath) paths.add(file.oldPath);
    if (file.newPath) paths.add(file.newPath);
  }
  const violations: string[] = [];
  const bytes = Buffer.byteLength(diff, 'utf8');
  if (bytes > policy.maxDiffBytes) {
    violations.push(`diff is ${bytes} bytes; policy permits at most ${policy.maxDiffBytes}`);
  }
  if (parsed.files.length > policy.maxChangedFiles) {
    violations.push(
      `changes ${parsed.files.length} files; policy permits at most ${policy.maxChangedFiles}`,
    );
  }
  for (const path of paths) {
    if (matchesAny(path, policy.protectedPaths)) {
      violations.push(`touches protected path: ${path}`);
    } else if (!policyAllowsPatchPath(path, policy)) {
      violations.push(`touches disallowed path: ${path}`);
    }
  }
  return { ok: violations.length === 0, violations };
}

function configuredMetric(
  command: string,
  label: string,
  before: number | undefined,
  after: number | undefined,
  percent: number | undefined,
): string | null {
  if (percent === undefined) return null;
  if (before === undefined || after === undefined) {
    return `${command}: configured ${label} metric is missing`;
  }
  if (before <= 0) return `${command}: configured ${label} baseline must exceed zero`;
  const maximum = before * (1 + percent / 100);
  return after > maximum
    ? `${command}: ${label} increased from ${before} to ${after}, above ${percent}% policy threshold`
    : null;
}

export function evaluateResourceThresholds(
  command: string,
  baseline: RunMetrics,
  candidate: RunMetrics,
  limits: ResourceLimits,
): string[] {
  return [
    configuredMetric(
      command,
      'elapsed time',
      baseline.elapsedTimeSec,
      candidate.elapsedTimeSec,
      limits.elapsedTimePercent,
    ),
    configuredMetric(
      command,
      'max RSS',
      baseline.maxRssKb,
      candidate.maxRssKb,
      limits.maxRssPercent,
    ),
  ].filter((violation): violation is string => violation !== null);
}
