import { createHash } from 'node:crypto';
import type { CaseFile, Candidate } from '../domain.js';
import type { Executor } from '../executor/types.js';
import type { HealLlm } from '../heal.js';
import type { PreparedRuntimeChallenges } from '../challenges/runtime.js';
import type { RepositoryPolicy } from '../policy/schema.js';
import { canonicalJson } from '../replay/canonical-json.js';
import { candidateIdentity } from '../engine/candidate-identity.js';
import { VERIFICATION_GATE_ORDER, type SharedVerificationOutcome } from './evaluate.js';
import type { RuntimeCandidateResult } from './runtime.js';
import type { VerificationMode } from './types.js';
import { VerificationExecutionRecorder } from './execution-record.js';

interface GeneratedRecordInput {
  executor: Executor;
  llm: HealLlm;
  executionRecorder?: VerificationExecutionRecorder;
  baselineImageId: string;
  policy: RepositoryPolicy;
  policySha256?: string;
  mode?: VerificationMode;
  sourceIdentity?: { kind: 'git' | 'local-snapshot'; sourceSha: string | null; policyBaseSha: string | null; snapshotSha256: string | null };
}
/** Attach exact current execution evidence only to new required-contract runs. */
export class GeneratedVerificationRecorder {
  readonly executor: Executor;
  readonly llm: HealLlm;
  private readonly recorder: VerificationExecutionRecorder;
  private prepared: PreparedRuntimeChallenges | null = null;
  private readonly candidates = new Map<string, { candidate: Candidate; prepared: PreparedRuntimeChallenges; result: RuntimeCandidateResult }>();
  constructor(private readonly input: GeneratedRecordInput) {
    this.recorder = input.executionRecorder ?? new VerificationExecutionRecorder(input);
    this.executor = input.executionRecorder === undefined ? this.recorder.executor : input.executor;
    this.llm = this.recorder.llm;
  }
  prepare(prepared: PreparedRuntimeChallenges): void { this.prepared = prepared; }
  record(candidate: Candidate, prepared: PreparedRuntimeChallenges, result: RuntimeCandidateResult): void {
    this.candidates.set(candidateIdentity(candidate).diffHash, { candidate, prepared, result });
  }
  attach(file: CaseFile): CaseFile {
    const selected = file.selectedCandidate === undefined ? undefined : this.candidates.get(file.selectedCandidate.diffHash);
    const retained = selected ?? (file.outcome === 'fixed' ? undefined : [...this.candidates.values()].at(-1));
    if (file.outcome === 'fixed' && (!selected || selected.result.verification.status !== 'passed')) {
      throw new Error('Required-contract acceptance has no matching executed candidate verification');
    }
    const outcome = file.outcome === 'fixed' ? 'repaired' : file.outcome === 'gave-up' ? 'insufficient' : file.outcome;
    const empty: SharedVerificationOutcome = { status: outcome === 'infra-stop' ? 'infra-stop' : 'insufficient', blockingGate: 'reproduction', challengeMode: 'required', challengeAssurance: false,
      observations: VERIFICATION_GATE_ORDER.map(gate => ({ gate, status: 'not-run', reasons: ['not-executed'], artifacts: [] })) };
    const identity = this.input.sourceIdentity;
    const { evidence, verificationArtifact } = this.recorder.finish({
      identity: { sourceKind: identity?.kind ?? 'local-snapshot', sourceSha: identity?.sourceSha ?? null, policyBaseSha: identity?.policyBaseSha ?? null,
        snapshotSha256: identity?.snapshotSha256 ?? null,
        policySha256: this.input.policySha256 ?? createHash('sha256').update(canonicalJson(this.input.policy)).digest('hex'),
        diffSha256: retained === undefined ? null : candidateIdentity(retained.candidate).diffHash,
        corpusRevision: null, fixtureRevision: null },
      baselineImageId: this.input.baselineImageId, outcome,
      verification: retained?.result.verification ?? empty,
      prepared: retained?.prepared ?? this.prepared,
      challenges: retained?.result.challenges ?? null,
    });
    return { ...file, verification: evidence, verificationArtifact };
  }
}
