import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  AuditVerdict,
  Candidate,
  CaseFile,
  CostLedger,
  Diagnosis,
  FailureClass,
  GreenwashCheck,
  Grounding,
  RaceResult,
  PolicyEvidence,
  SearchEvidence,
  StageEvidence,
  TriageVerdict,
} from './domain.js';

describe('domain model', () => {
  it('exports the shared repair vocabulary as types', () => {
    expectTypeOf<FailureClass>().toEqualTypeOf<
      | 'typecheck'
      | 'lint'
      | 'build'
      | 'test-assertion'
      | 'test-bug'
      | 'flaky-timing'
      | 'dep-upstream-breaking'
      | 'env-config'
      | 'infra'
    >();
    expectTypeOf<Grounding>().toEqualTypeOf<{
      query: string;
      citations: Array<{ title: string; url: string; snippet: string }>;
      skipped: boolean;
      reason?: 'disabled' | 'not-applicable';
    }>();
    expectTypeOf<Diagnosis>().toEqualTypeOf<{
      class: FailureClass;
      confidence: number;
      signals: string[];
      failingCmd: string;
      errorExcerpt: string;
      grounding?: Grounding;
    }>();
    expectTypeOf<TriageVerdict>().toEqualTypeOf<{
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
    }>();
    expectTypeOf<Candidate>().toEqualTypeOf<{
      id: string;
      rationale: string;
      diff: string;
    }>();
    expectTypeOf<RaceResult>().toEqualTypeOf<{
      candidate: Candidate;
      imageId: string;
      nodeId: string;
      exitCode: number;
      held: boolean;
      note?: string;
    }>();
    expectTypeOf<GreenwashCheck>().toEqualTypeOf<
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
      | 'policy-patch'
    >();
    expectTypeOf<AuditVerdict>().toEqualTypeOf<{
      approved: boolean;
      checks: Array<{
        name: GreenwashCheck;
        passed: boolean;
        evidence?: string;
      }>;
      reasoning: string;
    }>();
    expectTypeOf<CostLedger>().toEqualTypeOf<{
      entries: Array<{
        role: 'nano' | 'super' | 'ultra';
        model: string;
        inTok: number;
        outTok: number;
        reasoningTok: number;
        usd: number;
      }>;
      totalUsd(): number;
    }>();
    expectTypeOf<CaseFile>().toEqualTypeOf<{
      runId: string;
      repo: string;
      runtime: 'node' | 'python';
      diagnosis: Diagnosis;
      triage: TriageVerdict;
      race: RaceResult[];
      audit?: AuditVerdict;
      outcome:
        | 'fixed'
        | 'flaky-no-patch'
        | 'refused'
        | 'gave-up'
        | 'infra-stop';
      cost: CostLedger;
      policy: PolicyEvidence;
      stages: StageEvidence[];
      search?: SearchEvidence[];
      counterfactual?: import('./counterfactual/types.js').CounterfactualEvidence;
      trace?: import('./trace/types.js').TraceEvent[];
      verification?: import('./verification/types.js').VerificationEvidence;
      verificationArtifact?: import('./verification/types.js').VerificationArtifact;
      verificationRuns?: import('./verification/runtime-evidence.js').RuntimeCandidateEvidence[];
      recovery?: import('./diagnose/hypotheses.js').DiagnosisRecoveryEvidence;
      selectedCandidate?: {
        id: string;
        diffHash: string;
      };
    }>();
  });

  it('has no runtime exports', async () => {
    const domain = await import('./domain.js');

    expect(Object.keys(domain)).toEqual([]);
  });
});
