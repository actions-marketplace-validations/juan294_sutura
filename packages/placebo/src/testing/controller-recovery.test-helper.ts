import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createDefaultRepositoryPolicy, parseRepositoryPolicy, repairFailure,
  type RepairFailureContext, type Diagnosis, type ChatMessage,
} from '@sutura/core';
import { applyPatch, createPortableTestRuntime, discoverCases } from '../corpus.js';
import { LocalBranchExecutor, prepareRecoveryFixture, recoveryRepairDiff } from './local-recovery-executor.test-helper.js';

function request(messages: readonly ChatMessage[]): Record<string, unknown> {
  const user = messages.find((message) => message.role === 'user');
  if (!user || typeof user.content !== 'string') throw new Error('Missing controlled inference context');
  return JSON.parse(user.content) as Record<string, unknown>;
}
function targetPath(diff: string): string {
  const path = /^\+\+\+ b\/(.+)$/mu.exec(diff)?.[1];
  if (!path) throw new Error('Control has no exact replacement target');
  return path;
}

/** Inference is scripted; every reproduction, proof, patch and suite outcome comes from a local process. */
export async function runRecoveryControllerCase(caseId: string, options: { rewriteAssertion?: boolean } = {}) {
  const fixture = (await discoverCases(undefined, { includeVersionedCases: true })).find(({ id }) => id === caseId);
  if (!fixture) throw new Error(`Missing recovery fixture ${caseId}`);
  const runtime = await createPortableTestRuntime();
  const prepared = await prepareRecoveryFixture(fixture, runtime);
  const executor = new LocalBranchExecutor(prepared.root, runtime);
  try {
    const trap = fixture.metadata.kind === 'trap';
    const goodDiff = await recoveryRepairDiff(fixture);
    const deceptiveDiff = trap ? await readFile(join(fixture.directory, 'fake-fix.diff'), 'utf8') : undefined;
    const target = targetPath(deceptiveDiff ?? goodDiff);
    const fixturePaths = (await readdir(fixture.fixtureDirectory, { recursive: true })).sort();
    const paths = fixturePaths
      .filter((path) => /\.(?:js|ts|py)$/u.test(path) || path === 'tsconfig.json')
      .sort((left, right) => left === target ? -1 : right === target ? 1 : left.localeCompare(right));
    const clean = new Map(await Promise.all(paths.map(async (path) => [path, await readFile(join(fixture.fixtureDirectory, path), 'utf8')] as const)));
    await applyPatch(prepared.directory, fixture.breakPatch);
    const baseline = await executor.seed(prepared.directory);
    const before = await executor.run(baseline, prepared.command);
    if (before.exitCode === 0) throw new Error('Recovery fixture did not reproduce a real failure');
    const snapshotFiles = (await Promise.all(fixturePaths.map(async (path) => {
      const bytes = await readFile(join(prepared.directory, path)).catch((error: NodeJS.ErrnoException) => { if (error.code === 'EISDIR') return undefined; throw error; });
      return bytes === undefined ? [] : [{ path, sha256: createHash('sha256').update(bytes).digest('hex') }];
    }))).flat();
    const sources = await Promise.all(paths.map(async (path) => ({ path, startLine: 1, content: await readFile(join(prepared.directory, path), 'utf8'), truncated: false })));
    let policy = await readFile(join(fixture.fixtureDirectory, '.sutura.json'), 'utf8').then(parseRepositoryPolicy).catch(() => createDefaultRepositoryPolicy());
    // The trap repository permits only the tempting edit: a class label cannot grant it authority.
    if (trap) policy = { ...policy, allowedPaths: [target] };
    const observedCommand = prepared.command;
    const initialClass: Diagnosis['class'] = caseId.includes('indexed-access') ? 'typecheck' : trap ? fixture.metadata.class : 'test-assertion';
    const inferenceCalls: string[] = [];
    const llm: RepairFailureContext['llm'] = {
      modelQuote: (tier) => ({ role: tier, modelId: `local-scripted-${tier}`, profileId: 'local-control', price: { input: 0.1, output: 0.1 } }),
      async chat(tier, messages, settings) {
        if (settings?.purpose === 'challenge-generation') {
          inferenceCalls.push('challenge-generation');
          const input = request(messages) as { contractExcerpts: Array<{ contractId: string; path: string; excerpt: string }> };
          const challenges = input.contractExcerpts.map(({ contractId, path, excerpt }, index) => {
            const declared = JSON.parse(excerpt) as { sourceSha256: string; relationId: string; contract: { kind: string; examples?: Array<{ args: unknown[] }> } };
            if (declared.contract.kind !== 'exact' || !declared.contract.examples?.[0]) throw new Error('Unregistered recovery preservation contract');
            return {
              id: `preservation-${index}`, kind: 'preservation',
              contractRefs: [{ path, sha256: declared.sourceSha256, startLine: 1, endLine: 1 }],
              rationale: 'Preserve the declared asynchronous profile behavior',
              probeId: `preservation-${index}`, inputs: declared.contract.examples[0].args,
              contractId, relationId: declared.relationId,
            };
          });
          return { text: JSON.stringify({ challenges }), usd: 0.000001 };
        }
        if (tier === 'nano') {
          inferenceCalls.push('diagnosis');
          return { text: JSON.stringify({ class: initialClass, confidence: 0.49, signals: ['local-real-reproduction'], failingCmd: observedCommand, errorExcerpt: (before.stderr || before.stdout).slice(-2000) }), usd: 0.000001 };
        }
        if (settings?.responseFormat?.type === 'json_schema' && settings.responseFormat.jsonSchema.name === 'sutura_diagnosis_hypotheses') {
          inferenceCalls.push('hypotheses');
          const input = request(messages) as { sources: Array<{ path: string }>; signals: Array<{ id: string }> };
          const strict = target === 'tsconfig.json';
          const signalIndex = input.signals.findIndex(({ id }) => strict ? id === 'strict-requirement' : id !== 'strict-requirement');
          const sourceIndex = input.sources.findIndex(({ path }) => path === target);
          const intent = strict ? 'restore-strict-config' : caseId.includes('setup') || caseId.includes('helper') ? 'await-setup' : 'await-operation';
          return { text: JSON.stringify({ hypotheses: signalIndex < 0 || sourceIndex < 0 ? [] : [{ signalIndex, sourceIndex, intent, probeId: strict ? 'strict-json' : 'async-completion' }] }), usd: 0.000001 };
        }
        if (tier === 'super') {
          inferenceCalls.push('repair');
          const selected = (request(messages).selectedTarget as { path: string }).path;
          let replacement = clean.get(selected);
          if (caseId.includes('indexed-access') && selected === 'first.ts') replacement = replacement?.replace('): string {', '): string | undefined {');
          if (options.rewriteAssertion && selected === target) replacement = replacement?.replace("toBe('ADA')", "toBe('WRONG')");
          if (trap && selected === target) replacement = selected === 'tsconfig.json'
            ? replacement?.replace('"strict":true', '"strict":false')
            : replacement?.replace('toBe(false)', 'toBe(true)');
          if (replacement === undefined) throw new Error(`Unknown controller-selected source ${selected}`);
          return { text: JSON.stringify({ replacement }), usd: 0.000001 };
        }
        inferenceCalls.push('audit');
        return { text: JSON.stringify({ approved: true, reasoning: 'The known-good local control preserves the declared assertions.' }), usd: 0.000001 };
      },
    };
    const caseFile = await repairFailure({
      runId: `local-recovery-${caseId}`, repo: `placebo/${caseId}`,
      failedLog: `Run ${observedCommand}\n${before.stdout}\n${before.stderr}`,
      failingImage: baseline, executor, llm,
      cost: { entries: [], totalUsd: () => 0 }, triageN: 2, raceK: 1,
      policy, runtime: executor.runtimeAdapter(fixture.metadata.language === 'python' ? 'python' : 'node'),
      sourceIdentity: { kind: 'local-snapshot', sourceSha: null, policyBaseSha: null, snapshotSha256: createHash('sha256').update(JSON.stringify(snapshotFiles)).digest('hex') },
      readSourceContext: async () => ({ sources }),
      search: { initialBranches: 1, beamWidth: 1, maximumDepth: 1, maximumTotalBranches: 4 },
    });
    const selectedDiff = caseFile.race.find(({ candidate }) => candidate.id === caseFile.selectedCandidate?.id)?.candidate.diff;
    const appliedDiffs = executor.calls.flatMap(({ cmd }) => {
      const encoded = /^printf '%s' '([A-Za-z0-9+/=]+)' \| base64 --decode \| git apply -/u.exec(cmd)?.[1];
      return encoded ? [Buffer.from(encoded, 'base64').toString('utf8')] : [];
    });
    return {
      caseFile, observedCommand, selectedDiff, deceptiveDiff, appliedDiffs, inferenceCalls,
      baselineExitCode: before.exitCode, baselineAfterExitCode: (await executor.run(baseline, prepared.command)).exitCode,
      proofCount: executor.calls.filter(({ cmd }) => cmd.includes('SUTURA_SOURCE_SHA256=')).length,
    };
  } finally { await prepared.cleanup(); await runtime.cleanup(); }
}
