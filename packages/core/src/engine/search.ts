import type { Candidate, StageEvidence } from '../domain.js';
import type { ImageId, RunMetrics } from '../executor/types.js';
import type { RepairTestEvidence } from './repair-tools.js';
import { diffFingerprint, errorFingerprint } from './fingerprint.js';
import { compareSearchNodes } from './search-score.js';

export const DEFAULT_SEARCH_LIMITS = Object.freeze({
  initialBranches: 4,
  beamWidth: 2,
  maximumDepth: 4,
  maximumTotalBranches: 12,
});

export interface SearchPolicyEvidence {
  valid: boolean;
  violations: string[];
  changedFiles: string[];
  diffBytes: number;
}

export interface SearchNode {
  id: string;
  parentId?: string;
  depth: number;
  imageId: ImageId;
  cumulativeDiff: string;
  errorFingerprint: string;
  testEvidence: RepairTestEvidence;
  policyEvidence: SearchPolicyEvidence;
  stageEvidence: StageEvidence[];
  transcriptReference: string;
  metrics?: RunMetrics;
  candidate?: Candidate;
  terminalReason?: 'passed' | 'policy' | 'repeated-state' | 'depth' | 'cancelled' | 'failed' | 'completion-limit' | 'verification-refused';
  /** Why full verification refused a provisionally green candidate. */
  verificationReason?: string;
}

export interface SearchExpansion {
  imageId: ImageId;
  cumulativeDiff: string;
  testEvidence: RepairTestEvidence;
  policyEvidence: SearchPolicyEvidence;
  stageEvidence: StageEvidence[];
  transcriptReference: string;
  metrics?: RunMetrics;
  candidate?: Candidate;
  terminalReason?: SearchNode['terminalReason'];
}

export interface SearchExpansionContext {
  parent: SearchNode | undefined;
  parentImageId: ImageId;
  depth: number;
  branch: number;
  nodeId: string;
  operationId: string;
  signal: AbortSignal;
}

export interface AdaptiveSearchOptions {
  baselineImageId: ImageId;
  initialBranches?: number;
  beamWidth?: number;
  maximumDepth?: number;
  maximumTotalBranches?: number;
  availableBranches(frontier?: readonly (SearchNode | undefined)[]): number;
  concurrencyCapacity?(): number;
  cancel?(nodeId: string): Promise<void>;
  onDecision?(decision: { summary: string; nodeId?: string; parentNodeId?: string }): void;
  expand(context: SearchExpansionContext): Promise<SearchExpansion>;
  /**
   * Fully verifies a provisionally green candidate. Diagnosed-test green only
   * makes a branch provisional; without this hook a green branch is admitted on
   * the visible suite alone, which is the pre-phase-4 behavior.
   */
  admit?(input: {
    nodeId: string;
    expansion: SearchExpansion;
  }): Promise<{ accepted: boolean; reason?: string }>;
}

export interface AdaptiveSearchResult {
  nodes: SearchNode[];
  candidates: SearchNode[];
  terminalReason: 'candidate-found' | 'frontier-exhausted' | 'branch-budget' | 'operation-capacity' | 'depth' | 'completion-limit';
}

function isEvidenceTerminal(
  reason: SearchNode['terminalReason'],
): reason is 'cancelled' | 'completion-limit' {
  return reason === 'cancelled' || reason === 'completion-limit';
}

function limit(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > DEFAULT_SEARCH_LIMITS.maximumTotalBranches) {
    throw new RangeError(`${name} must be from 1 to ${DEFAULT_SEARCH_LIMITS.maximumTotalBranches}`);
  }
  return resolved;
}

export async function adaptiveSearch(options: AdaptiveSearchOptions): Promise<AdaptiveSearchResult> {
  const initialBranches = limit(options.initialBranches, DEFAULT_SEARCH_LIMITS.initialBranches, 'initialBranches');
  const beamWidth = limit(options.beamWidth, DEFAULT_SEARCH_LIMITS.beamWidth, 'beamWidth');
  const maximumDepth = limit(options.maximumDepth, DEFAULT_SEARCH_LIMITS.maximumDepth, 'maximumDepth');
  const maximumTotalBranches = limit(options.maximumTotalBranches, DEFAULT_SEARCH_LIMITS.maximumTotalBranches, 'maximumTotalBranches');
  const nodes: SearchNode[] = [];
  const visited = new Set<string>();
  let appliedProposals = 0;
  let completionLimits = 0;
  let frontier: Array<SearchNode | undefined> = Array.from({ length: Math.min(initialBranches, maximumTotalBranches) });

  for (let depth = 1; depth <= maximumDepth && frontier.length > 0; depth += 1) {
    const remaining = maximumTotalBranches - nodes.length;
    const authorized = Math.max(0, Math.floor(options.availableBranches(frontier)));
    const parents = frontier.slice(0, Math.min(remaining, authorized));
    if (parents.length === 0) {
      return { nodes, candidates: [], terminalReason: remaining === 0 ? 'branch-budget' : 'operation-capacity' };
    }
    const children: SearchNode[] = [];
    const concurrency = Math.max(1, Math.floor(options.concurrencyCapacity?.() ?? parents.length));
    for (let start = 0; start < parents.length;) {
      const authorizedBatchSize = Math.max(0, Math.floor(options.availableBranches(parents.slice(start))));
      if (authorizedBatchSize < 1) break;
      const batch = parents.slice(start, start + Math.min(concurrency, authorizedBatchSize));
      const controllers = batch.map(() => new AbortController());
      const settled = batch.map(() => false);
      const ids = batch.map((_parent, index) =>
        `search-${String(nodes.length + start + index + 1).padStart(3, '0')}`,
      );
      let cancellationStarted = false;
      const expansions = await Promise.all(batch.map(async (parent, index) => {
        const id = ids[index]!;
        options.onDecision?.({
          summary: `Expand branch ${start + index + 1} at depth ${depth}`,
          nodeId: id,
          ...(parent === undefined ? {} : { parentNodeId: parent.id }),
        });
        const expansion = await options.expand({
          parent,
          parentImageId: parent?.imageId ?? options.baselineImageId,
          depth,
          branch: start + index + 1,
          nodeId: id,
          operationId: id,
          signal: controllers[index]!.signal,
        });
        settled[index] = true;
        const provisional = expansion.policyEvidence.valid &&
          expansion.testEvidence.exitCode === 0 &&
          expansion.candidate !== undefined;
        // A provisional branch is verified before it may cancel anything. Only a
        // fully accepted result ends the race; a refused one keeps its reason and
        // leaves the remaining frontier running.
        const admission = provisional && options.admit !== undefined
          ? await options.admit({ nodeId: id, expansion })
          : { accepted: provisional };
        if (!cancellationStarted && admission.accepted) {
          cancellationStarted = true;
          await Promise.all(ids.flatMap((otherId, otherIndex) => {
            if (otherIndex === index || settled[otherIndex]) return [];
            controllers[otherIndex]!.abort();
            return options.cancel === undefined ? [] : [options.cancel(otherId)];
          }));
        }
        return { expansion, admission };
      }));
      for (const [index, { expansion, admission }] of expansions.entries()) {
        const parent = batch[index];
        const id = ids[index]!;
      const fingerprint = `${diffFingerprint(expansion.cumulativeDiff)}:${errorFingerprint(expansion.testEvidence.output)}`;
      const repeated = visited.has(fingerprint);
      visited.add(fingerprint);
      const provisional = expansion.testEvidence.exitCode === 0 && expansion.candidate !== undefined;
      const terminalReason = !expansion.policyEvidence.valid
        ? 'policy' as const
        : provisional
          ? (admission.accepted ? 'passed' as const : 'verification-refused' as const)
          : isEvidenceTerminal(expansion.terminalReason)
            ? expansion.terminalReason
            : repeated
              ? 'repeated-state' as const
              : expansion.terminalReason ?? (depth === maximumDepth ? 'depth' as const : undefined);
      children.push({
        id,
        ...(parent === undefined ? {} : { parentId: parent.id }),
        depth,
        imageId: expansion.imageId,
        cumulativeDiff: expansion.cumulativeDiff,
        testEvidence: expansion.testEvidence,
        policyEvidence: expansion.policyEvidence,
        stageEvidence: expansion.stageEvidence,
        transcriptReference: expansion.transcriptReference,
        ...(expansion.metrics === undefined ? {} : { metrics: expansion.metrics }),
        ...(expansion.candidate === undefined ? {} : { candidate: expansion.candidate }),
        errorFingerprint: errorFingerprint(expansion.testEvidence.output),
        ...(terminalReason === undefined ? {} : { terminalReason }),
        ...(terminalReason === 'verification-refused' && admission.reason !== undefined
          ? { verificationReason: admission.reason }
          : {}),
      });
      options.onDecision?.({
        summary: terminalReason === undefined ? 'Retain branch in frontier' : `Branch terminal: ${terminalReason}`,
        nodeId: id,
        ...(parent === undefined ? {} : { parentNodeId: parent.id }),
      });
      }
      const batchChildren = children.slice(-expansions.length);
      for (const child of batchChildren) {
        if (child.policyEvidence.changedFiles.length > 0) appliedProposals += 1;
        if (child.terminalReason === 'completion-limit') completionLimits += 1;
      }
      if (children.some(({ terminalReason }) => terminalReason === 'passed')) break;
      if (completionLimits > appliedProposals) {
        nodes.push(...children);
        return { nodes, candidates: [], terminalReason: 'completion-limit' };
      }
      start += batch.length;
    }
    nodes.push(...children);
    const candidates = children.filter(({ terminalReason }) => terminalReason === 'passed').sort(compareSearchNodes);
    if (candidates.length > 0) return { nodes, candidates, terminalReason: 'candidate-found' };
    frontier = children
      .filter(({ terminalReason }) => terminalReason === undefined || terminalReason === 'failed')
      .sort(compareSearchNodes)
      .slice(0, beamWidth);
  }
  return { nodes, candidates: [], terminalReason: frontier.length === 0 ? 'frontier-exhausted' : 'depth' };
}
