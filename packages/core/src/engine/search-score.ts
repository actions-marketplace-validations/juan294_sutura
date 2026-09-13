import type { SearchNode } from './search.js';
import { failureSignatureCount } from './fingerprint.js';

export interface SearchScore {
  pruned: number;
  passing: number;
  unpatched: number;
  failureSignatures: number;
  diffBytes: number;
  changedFiles: number;
  sandboxCost: number;
  elapsedTime: number;
  nodeId: string;
}

export function searchScore(node: SearchNode): SearchScore {
  return {
    pruned: node.policyEvidence.valid ? 0 : 1,
    passing: node.testEvidence.exitCode === 0 ? 0 : 1,
    unpatched: node.testEvidence.exitCode !== 0 && node.policyEvidence.changedFiles.length === 0 ? 1 : 0,
    failureSignatures: failureSignatureCount(node.testEvidence.output),
    diffBytes: node.policyEvidence.diffBytes,
    changedFiles: node.policyEvidence.changedFiles.length,
    sandboxCost: node.metrics?.cost ?? 0,
    elapsedTime: node.metrics?.elapsedTimeSec ?? 0,
    nodeId: node.id,
  };
}

export function compareSearchNodes(left: SearchNode, right: SearchNode): number {
  const a = searchScore(left);
  const b = searchScore(right);
  for (const key of ['pruned', 'passing', 'unpatched', 'failureSignatures', 'diffBytes', 'changedFiles', 'sandboxCost', 'elapsedTime'] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  return a.nodeId.localeCompare(b.nodeId);
}
