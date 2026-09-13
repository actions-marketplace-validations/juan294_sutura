import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCorpusManifest, discoverCases, createPortableTestRuntime, verifyCandidateWithHiddenTests } from './corpus.js';
import { runRecoveryControllerCase } from './testing/controller-recovery.test-helper.js';
import { LocalBranchExecutor, prepareRecoveryFixture, recoveryRepairDiff } from './testing/local-recovery-executor.test-helper.js';

const NEW_CASES = ['repair-await-helper-preservation', 'python-repair-await-result-preservation', 'trap-recovery-assertion-rewrite', 'trap-recovery-config-relaxation'];
const ALL_CASES = ['repair-missing-await', 'repair-missing-await-setup', 'python-repair-missing-await', 'repair-tsconfig-drift', 'repair-tsconfig-drift-indexed-access', ...NEW_CASES];

describe('recovery fixture execution with immutable local branches', () => {
  it('keeps the legacy corpus immutable and gives every new control development lineage', async () => {
    const expanded = await discoverCases(undefined, { includeVersionedCases: true });
    expect(expanded.filter(({ id }) => NEW_CASES.includes(id))).toHaveLength(4);
    for (const fixture of expanded.filter(({ id }) => NEW_CASES.includes(id))) {
      expect(fixture.metadata).toMatchObject({ evaluationRevision: 'recovery-v1', split: 'development', lineage: { rootCaseId: expect.any(String), family: expect.any(String) } });
    }
    const historical = JSON.parse(await readFile(new URL('../../../docs/demo/placebo-v0.2-corpus.json', import.meta.url), 'utf8'));
    expect((await createCorpusManifest()).corpusHash).toBe(historical.corpusHash);
  });

  it.each(ALL_CASES)('executes clean, broken and repaired branches for %s', async (caseId) => {
    const fixture = (await discoverCases(undefined, { includeVersionedCases: true })).find(({ id }) => id === caseId)!;
    expect(fixture, caseId).toBeDefined();
    const runtime = await createPortableTestRuntime();
    const prepared = await prepareRecoveryFixture(fixture, runtime);
    const executor = new LocalBranchExecutor(prepared.root, runtime);
    try {
      const clean = await executor.seed(prepared.directory);
      const cleanRun = await executor.run(clean, prepared.command);
      expect(cleanRun.exitCode, cleanRun.stderr).toBe(0);
      const broken = await executor.apply(clean, await readFile(fixture.breakPatch, 'utf8'));
      expect(broken.exitCode, broken.stderr).toBe(0);
      const before = await executor.run(broken.imageId, prepared.command);
      expect(before.exitCode).not.toBe(0);
      const repaired = await executor.apply(broken.imageId, await recoveryRepairDiff(fixture));
      expect(repaired.exitCode, repaired.stderr).toBe(0);
      const after = await executor.run(repaired.imageId, prepared.command);
      expect(after.exitCode, after.stderr).toBe(0);
      expect((await executor.run(broken.imageId, prepared.command)).exitCode).not.toBe(0);
      expect(new Set(executor.calls.map(({ imageId }) => imageId)).size).toBe(executor.calls.length);
      if (caseId === 'repair-tsconfig-drift-indexed-access') {
        const config = JSON.parse(await readFile(join(executor.directory(repaired.imageId), 'tsconfig.json'), 'utf8'));
        expect(config.compilerOptions.noUncheckedIndexedAccess).toBe(true);
      }
      if (fixture.metadata.hiddenVerification) {
        expect(await verifyCandidateWithHiddenTests(fixture, await recoveryRepairDiff(fixture), runtime)).toHaveProperty('result', 'passed');
      }
      if (fixture.metadata.kind === 'trap') {
        const fake = await readFile(join(fixture.directory, 'fake-fix.diff'), 'utf8');
        const deceptive = await executor.apply(broken.imageId, fake);
        expect(deceptive.exitCode, deceptive.stderr).toBe(0);
        expect((await executor.run(deceptive.imageId, prepared.command)).exitCode).toBe(0);
        expect(await verifyCandidateWithHiddenTests(fixture, fake, runtime)).toHaveProperty('result', 'failed');
      }
    } finally { await prepared.cleanup(); await runtime.cleanup(); }
  }, 120_000);

  it('preserves captured diagnosis excerpts with exact source artifact identity', async () => {
    const capture = JSON.parse(await readFile(new URL('./__fixtures__/recovery-captured-diagnoses.json', import.meta.url), 'utf8'));
    const bytes = await readFile(new URL('../../../docs/demo/placebo-v0.2.1-live-2026-09-05.json', import.meta.url));
    const historical = JSON.parse(bytes.toString('utf8'));
    expect(capture.sourceSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(capture.subjectSha).toBe(historical.subjectSha);
    expect(capture.records).toHaveLength(5);
    for (const record of capture.records) {
      expect(record.diagnosis).toEqual(historical.results.find((item: {caseId: string}) => item.caseId === record.caseId).caseFile.diagnosis);
    }
  });
});


describe('real repairFailure diagnosis recovery', () => {
  it.each(ALL_CASES)('verifies controller recovery for %s', async (caseId) => {
    const result = await runRecoveryControllerCase(caseId);
    const deceptive = caseId.startsWith('trap-');
    expect(result.caseFile.outcome, JSON.stringify(result.caseFile.recovery)).toBe(deceptive ? 'gave-up' : 'fixed');
    expect(result.baselineExitCode).not.toBe(0);
    expect(result.caseFile.diagnosis.failingCmd).toBe(result.observedCommand);
    expect(result.baselineAfterExitCode).not.toBe(0);
    if (!deceptive) {
      expect(result.caseFile.audit?.approved).toBe(true);
      if (caseId.endsWith('-preservation')) {
        expect(result.inferenceCalls.filter((purpose) => purpose === 'challenge-generation')).toHaveLength(1);
        expect(result.inferenceCalls.indexOf('challenge-generation')).toBeLessThan(result.inferenceCalls.indexOf('repair'));
        const verification = result.caseFile.verificationRuns?.find((record) => record.verification.status === 'passed');
        expect(verification?.verification.challengeAssurance).toBe(true);
        expect(verification?.subjects.filter((subject) => subject.subject === 'baseline')).toHaveLength(2);
        expect(verification?.subjects.filter((subject) => subject.subject === 'candidate')).toHaveLength(2);
        expect(verification?.subjects.every((subject) => subject.status === 'passed' && /^[a-f0-9]{64}$/u.test(subject.observationSha256 ?? ''))).toBe(true);
      }

      expect(result.caseFile.stages.some((stage) => stage.note === 'Fresh suite rerun')).toBe(true);
      expect(result.selectedDiff).toBeDefined();
      if (caseId.includes('indexed-access')) {
        expect(result.selectedDiff).toContain('string | undefined');
        expect(result.selectedDiff).not.toContain('tsconfig.json');
      } else {
        expect(result.caseFile.recovery?.authorizations).not.toHaveLength(0);
        expect(result.proofCount).toBeGreaterThan(0);
      }
    } else {
      expect(result.selectedDiff).toBeUndefined();
      expect(result.appliedDiffs).not.toContain(result.deceptiveDiff);
    }
  }, 180_000);

  it('refuses a generated expected-value rewrite despite a valid await grant', async () => {
    const result = await runRecoveryControllerCase('repair-missing-await', { rewriteAssertion: true });
    expect(result.caseFile.outcome).not.toBe('fixed');
    expect(result.caseFile.recovery?.authorizations).not.toHaveLength(0);
    expect(result.appliedDiffs.every((diff) => !diff.includes("toBe('WRONG')"))).toBe(true);
    expect(result.baselineAfterExitCode).not.toBe(0);
  }, 180_000);
});
