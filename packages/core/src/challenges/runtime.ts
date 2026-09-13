import { createHash } from 'node:crypto';
import type { Executor, ImageId, RunResult } from '../executor/types.js';
import type { HealLlm } from '../heal.js';
import type { RepositoryPolicy } from '../policy/schema.js';
import { policyAllowsSourceRead } from '../policy/evaluate.js';
import { canonicalJson } from '../replay/canonical-json.js';
import { BudgetExceededError } from '../engine/repair-budget.js';
import { buildChallengeGenerationPrompt, freezeChallengeSet, type FrozenChallengeSet, type ChallengeGenerationContext } from './generate.js';
import { buildObservationCommand, decodeObservation, evaluateObservation, freezeProbe, type FrozenProbe } from './protocol.js';
import { validateChallengeProposal } from './validate.js';
import type { ChallengeObservation, ChallengeQualification, ChallengeRunResult } from './runner.js';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export interface RuntimeChallengeInput {
  /** Ports must be charged to the caller's shared run budget. */
  executor: Executor;
  llm: HealLlm;
  baselineImage: ImageId;
  policy: RepositoryPolicy;
  policyBaseSha: string | null;
  policyHash: string;
  baselineSnapshotHash: string;
  failureExcerpt: string;
  baselineSources: ChallengeGenerationContext['baselineSources'];
  observe?: (result: RunResult, parent: ImageId) => void;
}
export interface PreparedRuntimeChallenges {
  readonly mode: 'required' | 'optional' | 'disabled';
  readonly set: FrozenChallengeSet | null;
  readonly baseline: readonly ChallengeObservation[];
  readonly qualified: readonly ChallengeQualification[];
  readonly reason: string | null;
}
// Probe handles hold controller-only assertions and cannot be serialized or supplied by a patch.
const handles = new WeakMap<PreparedRuntimeChallenges, ReadonlyMap<string, FrozenProbe>>();
async function repetitions(executor: Executor, image: ImageId, id: string, probe: FrozenProbe, subject: 'baseline' | 'candidate', observe?: RuntimeChallengeInput['observe']): Promise<ChallengeObservation[]> {
  const observations: ChallengeObservation[] = [];
  for (let repetition = 1; repetition <= 2; repetition++) {
    let observationSha256: string | undefined;
    try {
      const result = await executor.run(image, buildObservationCommand(probe), { cwd: '/workspace', timeoutSec: 10, network: 'disabled', env: { NODE_OPTIONS: '', NODE_PATH: '', PYTHONPATH: '', PYTHONNOUSERSITE: '1', TZ: 'UTC', LANG: 'C.UTF-8' } });
      observe?.(result, image);
      observationSha256 = digest(result.stdout);
      const verdict = evaluateObservation(probe, decodeObservation(result));
      observations.push({ challengeId: id, subject, repetition, status: verdict.status, reasonCode: verdict.status === 'passed' ? 'passed' : 'assertion-mismatch', observationSha256 });
    }
    catch (error) {
      if (error instanceof BudgetExceededError)
        throw error;
      observations.push({ challengeId: id, subject, repetition, status: 'insufficient', reasonCode: 'protocol-error', ...(observationSha256 === undefined ? {} : { observationSha256 }) });
    }
  }
  return observations;
}
/** Generate and qualify strictly before constructing any candidate. */
export async function prepareRuntimeChallenges(input: RuntimeChallengeInput): Promise<PreparedRuntimeChallenges> {
  const verification = input.policy.verification ?? { mode: 'optional' as const, contracts: [] };
  const base = { mode: verification.mode, set: null, baseline: [], qualified: [], reason: null };
  if (verification.mode === 'disabled' || verification.contracts.length === 0) {
    const prepared = { ...base, reason: verification.mode === 'disabled' ? null : 'missing-contract' };
    handles.set(prepared, new Map());
    return Object.freeze(prepared);
  }
  if (verification.contracts.some(contract => !policyAllowsSourceRead(contract.target.path, input.policy))) {
    const prepared = { ...base, reason: 'invalid-probe' };
    handles.set(prepared, new Map());
    return Object.freeze(prepared);
  }
  const sources = input.baselineSources.filter(s => policyAllowsSourceRead(s.path, input.policy));
  const context = { failureExcerpt: input.failureExcerpt, baselineSources: sources, contractExcerpts: verification.contracts.map(c => ({ contractId: c.id, path: c.target.path, excerpt: canonicalJson({ contract: c, sourceSha256: sources.find(s => s.path === c.target.path) ? digest(sources.find(s => s.path === c.target.path)!.content) : null, relationId: 'equals' }) })), baselineSnapshotHash: input.baselineSnapshotHash, trustedPolicySha: input.policyHash };
  const prompt = buildChallengeGenerationPrompt(context);
  prompt.messages[0] = { ...prompt.messages[0]!, role: 'system', content: `${prompt.messages[0]!.content}
Return {"challenges":[{"id":"probe-1","kind":"preservation or bug-regression","contractRefs":[{"path":"declared target path","sha256":"supplied sourceSha256","startLine":1,"endLine":1}],"rationale":"short contract reason","probeId":"probe-1","inputs":[],"contractId":"declared contract id","relationId":"equals"}]}. Choose at most three probes. Use supplied source hashes; never invent a hash. Only equals is supported by this runtime.` };
  const reply = await input.llm.chat('super', prompt.messages, { purpose: 'challenge-generation', maxTokens: 2048, temperature: 0, responseFormat: { type: 'json_object' } });
  let proposals: unknown[];
  try {
    const decoded = JSON.parse(reply.text) as {
      challenges?: unknown;
    };
    if (!Array.isArray(decoded.challenges))
      throw Error('missing challenges');
    proposals = decoded.challenges;
  }
  catch {
    const prepared = { ...base, reason: 'invalid-probe' };
    handles.set(prepared, new Map());
    return Object.freeze(prepared);
  }
  const set = freezeChallengeSet({ proposals, policy: verification, baselineSnapshotHash: input.baselineSnapshotHash, trustedPolicySha: input.policyHash, contextHash: prompt.contextHash, promptHash: digest(canonicalJson(prompt.messages)) });
  const baseline: ChallengeObservation[] = [];
  const qualified: ChallengeQualification[] = [];
  const probes = new Map<string, FrozenProbe>();
  let reason: string | null = set.excluded.some(x => x.reasonCode !== 'retention-limit') ? 'invalid-probe' : null;
  for (const challenge of set.challenges) {
    const validated = validateChallengeProposal(challenge, { policy: input.policy, sourceHashes: new Map(sources.map(s => [s.path, digest(s.content)])), trustedContractIds: new Set(verification.contracts.map(c => c.id)) });
    let probe: FrozenProbe;
    try {
      if (!validated.ok || challenge.relationId !== 'equals')
        throw Error('invalid probe');
      probe = freezeProbe(verification, input.policyBaseSha === null ? { policyBaseSha: null, policyHash: input.policyHash, localSnapshotSha256: input.baselineSnapshotHash } : { policyBaseSha: input.policyBaseSha, policyHash: input.policyHash }, { contractId: challenge.contractId, args: challenge.inputs });
    }
    catch {
      reason = 'invalid-probe';
      qualified.push({ challengeId: challenge.id, qualified: false, reasonCode: 'invalid-probe', observations: [] });
      continue;
    }
    const observations = await repetitions(input.executor, input.baselineImage, challenge.id, probe, 'baseline', input.observe);
    baseline.push(...observations);
    const expected = challenge.kind === 'preservation' ? 'passed' : 'failed';
    const ok = observations.every(o => o.status === expected);
    qualified.push({ challengeId: challenge.id, qualified: ok, reasonCode: ok ? 'qualified' : 'baseline-not-qualified', observations });
    if (ok)
      probes.set(challenge.id, probe);
    else
      reason = 'invalid-probe';
  }
  if (probes.size === 0)
    reason ??= 'missing-contract';
  const prepared = { mode: verification.mode, set, baseline, qualified, reason };
  // Deep-freeze public preparation records; assertions remain in the private map.
  const freeze = (value: unknown): void => { if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  } };
  freeze(prepared);
  handles.set(prepared, probes);
  return prepared;
}
/** Every candidate reuses the exact qualified baseline; failed checks are never removed. */
export async function runRuntimeChallenges(prepared: PreparedRuntimeChallenges, executor: Executor, candidateImage: ImageId, observe?: RuntimeChallengeInput['observe']): Promise<ChallengeRunResult> {
  const probes = handles.get(prepared);
  if (!probes)
    throw Error('Challenge context was not prepared by this controller');
  const observations = [...prepared.baseline];
  const qualified = prepared.qualified.map(q => ({ ...q, observations: [...q.observations] }));
  if (prepared.reason || probes.size === 0)
    return { status: 'insufficient', reasonCode: prepared.reason ?? 'no-frozen-challenges', qualified, observations };
  for (const [id, probe] of probes) {
    const checks = await repetitions(executor, candidateImage, id, probe, 'candidate', observe);
    observations.push(...checks);
    qualified.find(q => q.challengeId === id)!.observations.push(...checks);
  }
  const candidate = observations.filter(o => o.subject === 'candidate');
  const status = candidate.some(o => o.status === 'insufficient') ? 'insufficient' : candidate.some(o => o.status === 'failed') ? 'failed' : 'passed';
  return { status, reasonCode: status === 'passed' ? 'passed' : status === 'failed' ? 'assertion-mismatch' : 'protocol-error', qualified, observations };
}
