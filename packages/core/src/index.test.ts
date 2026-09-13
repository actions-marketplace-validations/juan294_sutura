import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  ADVERSARIAL_AUDIT_PROMPT,
  FAILURE_TAXONOMY,
  ContreeError,
  ContreeExecutor,
  InMemoryExecutor,
  OrchestrationError,
  ExternalTextError,
  SUTURA_SANDBOX_ENV,
  TavilyClient,
  VERSION,
  adjudicate,
  audit,
  auditOnly,
  checkAssertionDrop,
  checkDeletedTests,
  checkLoosenedTypes,
  checkPassWithNoTests,
  checkRelaxedConfig,
  checkSkips,
  classify,
  classifyMechanically,
  generateCandidates,
  ground,
  orchestrate,
  prepareRepair,
  renderCaseFile,
  renderAuditCaseFile,
  renderAuditMarkdown,
  renderComment,
  redactExternalText,
  runMechanicalChecks,
  selectWinner,
  triage,
  vetPatch,
} from '@sutura/core';
import type {
  AdjudicationContext,
  AdjudicationResult,
  AuditContext,
  AuditLlm,
  ContreeExecutorConfig,
  Executor,
  ImageId,
  InMemoryCall,
  InMemoryRunResult,
  InMemoryScript,
  PatchVerdict,
  RepairLlm,
  RunMetrics,
  RunOptions,
  RunResult,
  SnapshotMode,
  SnapshotOptions,
  SnapshotProfile,
  TaxonomyEntry,
} from '@sutura/core';

describe('@sutura/core entry point', () => {
  it('exports the release version', () => {
    expect(VERSION).toBe('0.2.1');
  });

  it('exports executor implementations and types from the package root', () => {
    expect(ContreeExecutor).toBeTypeOf('function');
    expect(ContreeError).toBeTypeOf('function');
    expect(InMemoryExecutor).toBeTypeOf('function');
    expect(ExternalTextError).toBeTypeOf('function');
    expect(redactExternalText).toBeTypeOf('function');

    expectTypeOf<ContreeExecutorConfig>().toBeObject();
    expectTypeOf<Executor>().toBeObject();
    expectTypeOf<ImageId>().toBeString();
    expectTypeOf<InMemoryCall>().toBeObject();
    expectTypeOf<InMemoryRunResult>().toBeObject();
    expectTypeOf<InMemoryScript>().toBeFunction();
    expectTypeOf<RunMetrics>().toBeObject();
    expectTypeOf<RunOptions>().toBeObject();
    expectTypeOf<RunResult>().toBeObject();
    expectTypeOf<SnapshotMode>().toBeString();
    expectTypeOf<SnapshotOptions>().toBeObject();
    expectTypeOf<SnapshotProfile>().toBeString();
  });

  it('exports the diagnosis and grounding API from the package root', () => {
    expect(FAILURE_TAXONOMY.typecheck.repairable).toBe(true);
    expect(classify).toBeTypeOf('function');
    expect(classifyMechanically).toBeTypeOf('function');
    expect(TavilyClient).toBeTypeOf('function');
    expect(ground).toBeTypeOf('function');
    expectTypeOf<TaxonomyEntry>().toBeObject();
  });

  it('exports the triage and repair API from the package root', () => {
    expect(triage).toBeTypeOf('function');
    expect(generateCandidates).toBeTypeOf('function');
    expect(prepareRepair).toBeTypeOf('function');
    expect(selectWinner).toBeTypeOf('function');
    expect(vetPatch).toBeTypeOf('function');
    expectTypeOf<PatchVerdict>().toBeObject();
    expectTypeOf<RepairLlm>().toBeObject();
  });

  it('exports both surgical report renderers from the package root', () => {
    expect(renderComment).toBeTypeOf('function');
    expect(renderCaseFile).toBeTypeOf('function');
    expect(renderAuditMarkdown).toBeTypeOf('function');
    expect(renderAuditCaseFile).toBeTypeOf('function');
  });

  it('exports the adversarial audit API from the package root', () => {
    expect(ADVERSARIAL_AUDIT_PROMPT).toContain('Default to refusal');
    expect(audit).toBeTypeOf('function');
    expect(auditOnly).toBeTypeOf('function');
    expect(adjudicate).toBeTypeOf('function');
    expect(runMechanicalChecks).toBeTypeOf('function');
    expect(checkDeletedTests).toBeTypeOf('function');
    expect(checkSkips).toBeTypeOf('function');
    expect(checkPassWithNoTests).toBeTypeOf('function');
    expect(checkAssertionDrop).toBeTypeOf('function');
    expect(checkLoosenedTypes).toBeTypeOf('function');
    expect(checkRelaxedConfig).toBeTypeOf('function');
    expectTypeOf<AuditContext>().toBeObject();
    expectTypeOf<AuditLlm>().toBeObject();
    expectTypeOf<AdjudicationContext>().toBeObject();
    expectTypeOf<AdjudicationResult>().toBeObject();
  });

  it('exports the runtime-independent orchestrator from the package root', () => {
    expect(orchestrate).toBeTypeOf('function');
    expect(OrchestrationError).toBeTypeOf('function');
    expect(SUTURA_SANDBOX_ENV).toEqual({ CI: 'true', NODE_ENV: 'test' });
  });
});
