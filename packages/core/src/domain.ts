import type { RuntimeCandidateEvidence } from './verification/runtime-evidence.js';
import type { CounterfactualEvidence } from './counterfactual/types.js';
import type { RunMetrics } from './executor/types.js';
import type { TraceEvent } from './trace/types.js';
import type { VerificationArtifact, VerificationEvidence } from './verification/types.js';
import type { DiagnosisRecoveryEvidence } from './diagnose/hypotheses.js';

export type FailureClass =
  | 'typecheck'
  | 'lint'
  | 'build'
  | 'test-assertion'
  | 'test-bug'
  | 'flaky-timing'
  | 'dep-upstream-breaking'
  | 'env-config'
  | 'infra';

export interface Grounding {
  query: string;
  citations: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
  skipped: boolean;
  reason?: 'disabled' | 'not-applicable';
}

export interface Diagnosis {
  class: FailureClass;
  confidence: number;
  signals: string[];
  failingCmd: string;
  errorExcerpt: string;
  grounding?: Grounding;
}

export interface TriageVerdict {
  status: 'real' | 'flaky' | 'intermittent' | 'not-run';
  reproduced: number;
  of: number;
  attemptsUsed: number;
  maximumAttempts: number;
  reproductionProbability: number;
  confidenceLower: number;
  confidenceUpper: number;
  stopReason: 'failure-boundary' | 'pass-boundary' | 'maximum-attempts' | 'not-run';
  methodVersion: 'sprt-p20-p80-a05-b05-v1';
}

export interface Candidate {
  id: string;
  rationale: string;
  diff: string;
}

export type RepairFailureKind =
  | 'provider'
  | 'completion-limit'
  | 'sandbox'
  | 'policy'
  | 'budget'
  | 'invalid';

export interface RaceResult {
  candidate: Candidate;
  imageId: string;
  nodeId: string;
  exitCode: number;
  held: boolean;
  note?: string;
}

export type GreenwashCheck =
  | 'deleted-test'
  | 'skipped-test'
  | 'weakened-assertion'
  | 'loosened-type'
  | 'relaxed-config'
  | 'pass-with-no-tests'
  | 'module-syntax'
  | 'llm-adjudication'
  | 'policy-required-command'
  | 'policy-resource-limit'
  | 'paired-evidence'
  | 'policy-patch';

export interface AuditVerdict {
  approved: boolean;
  checks: Array<{
    name: GreenwashCheck;
    passed: boolean;
    evidence?: string;
  }>;
  reasoning: string;
}

export interface CostLedger {
  entries: Array<{
    role: 'nano' | 'super' | 'ultra';
    model: string;
    inTok: number;
    outTok: number;
    reasoningTok: number;
    usd: number;
  }>;
  totalUsd(): number;
}

export type StageName =
  | 'policy'
  | 'preparation'
  | 'reproduction'
  | 'triage'
  | 'candidate'
  | 'search'
  | 'audit';

export interface StageEvidence {
  stage: StageName;
  attempt: number;
  nodeId: string;
  parentNodeId?: string;
  exitCode?: number;
  metrics: RunMetrics;
  network: 'disabled' | 'enabled';
  note?: string;
  operationId?: string;
  operationTerminal?: 'succeeded' | 'failed' | 'cancelled';
  cancellationRequested?: boolean;
}

export interface SearchEvidence {
  nodeId: string;
  parentNodeId?: string;
  depth: number;
  errorFingerprint: string;
  transcriptReference: string;
  terminalReason?: string;
  testExitCode: number;
  policyValid: boolean;
  changedFiles: number;
  diffBytes: number;
}

export interface PolicyEvidence {
  baseRef: string;
  baseSha: string;
  policySha: string;
}

export interface CaseFile {
  runId: string;
  repo: string;
  runtime: 'node' | 'python';
  diagnosis: Diagnosis;
  triage: TriageVerdict;
  race: RaceResult[];
  audit?: AuditVerdict;
  selectedCandidate?: {
    id: string;
    diffHash: string;
  };
  outcome: 'fixed' | 'flaky-no-patch' | 'refused' | 'gave-up' | 'infra-stop';
  cost: CostLedger;
  policy: PolicyEvidence;
  stages: StageEvidence[];
  search?: SearchEvidence[];
  counterfactual?: CounterfactualEvidence;
  trace?: TraceEvent[];
  /** Absent on legacy records; absence never establishes challenge assurance. */
  verification?: VerificationEvidence;
  verificationArtifact?: VerificationArtifact;
  verificationRuns?: RuntimeCandidateEvidence[];
  /** Public observations only; serialized recovery evidence cannot create edit grants. */
  recovery?: DiagnosisRecoveryEvidence;
}

export interface AuditFile {
  assurance: 'reduced';
  outcome: 'audit-approved' | 'audit-refused';
  diagnosis: {
    before: Diagnosis;
    after: Diagnosis;
  };
  policy: PolicyEvidence;
  audit: AuditVerdict;
  cost: CostLedger;
}
