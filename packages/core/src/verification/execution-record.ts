import { createHash } from 'node:crypto';
import type { Executor, RunResult } from '../executor/types.js';
import type { HealLlm } from '../heal.js';
import { DEFAULT_MODEL_PRICES, DEFAULT_MODEL_PRICE_PROVENANCE, type ModelTier } from '../llm/cost.js';
import { DEFAULT_MODELS } from '../config.js';
import type { ChatOptions, TierLlm } from '../llm/types.js';
import type { PreparedRuntimeChallenges } from '../challenges/runtime.js';
import type { ChallengeRunResult } from '../challenges/runner.js';
import { CHALLENGE_SET_VERSION } from '../challenges/generate.js';
import { encodeVerificationEvidence } from './codec.js';
import type { SharedVerificationOutcome } from './evaluate.js';
import { VERIFICATION_COST_VERSION, VERIFICATION_EXECUTION_EVIDENCE_VERSION, type VerificationArtifact, type VerificationEvidence, type VerificationIdentity, type VerificationMode, type VerificationModel, type VerificationOutcome, type VerificationCosts } from './types.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function publicCommand(command: string): string {
  return command.length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]|\/Users\/|\/home\/|Authorization:|github_pat_|ghp_|sk-[A-Za-z0-9]{20,}/u.test(command)
    ? `command-sha256:${digest(command)}` : command;
}
function modelId(value: unknown): string | null {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9/_.:-]{0,255}$/u.test(value) ? value : null;
}
function purpose(options: ChatOptions | undefined, tier: ModelTier): VerificationModel['purpose'] {
  switch (options?.purpose) {
    case 'classification': case 'diagnosis-recovery': return 'diagnosis';
    case 'repair': return 'repair';
    case 'challenge-generation': return 'challenge-generation';
    case 'adjudication': return 'adjudication';
    default: return tier === 'nano' ? 'diagnosis' : tier === 'ultra' ? 'adjudication' : 'repair';
  }
}
export interface ExecutionRecordFinish {
  identity: Omit<VerificationIdentity, 'imageDigest' | 'routingVersion' | 'challengeVersion' | 'executorImageId'>;
  /** The actual immutable baseline returned by sandbox preparation. */
  baselineImageId?: string;
  outcome: VerificationOutcome;
  verification: SharedVerificationOutcome;
  prepared: PreparedRuntimeChallenges | null;
  challenges: ChallengeRunResult | null;
}

/** Observe actual port calls. No prompt, reply text, assertions or raw logs enter public evidence. */
export class VerificationExecutionRecorder {
  readonly executor: Executor;
  readonly llm: HealLlm;
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly mode: VerificationMode;
  private readonly commands: string[] = [];
  private readonly models: VerificationModel[] = [];
  private readonly inference: NonNullable<VerificationCosts['inference']> = [];
  private readonly sandbox = new Map<string, NonNullable<VerificationCosts['sandbox']>[number]>();
  private incompleteInference = false;
  private incompleteSandbox = false;
  private sandboxTouched = false;
  private imageDigest: string | null = null;
  private routingVersion = 'unavailable';

  constructor(input: { executor: Executor; llm: HealLlm; now?: () => number; mode?: VerificationMode }) {
    this.now = input.now ?? Date.now;
    this.startedAt = this.now();
    this.mode = input.mode ?? 'local';
    const executor = input.executor;
    this.executor = {
      importImage: async (ref) => {
        this.sandboxTouched = true;
        const imported = await executor.importImage(ref);
        this.imageDigest = /@(sha256:[a-f0-9]{64})$/u.exec(ref)?.[1] ?? null;
        return imported;
      },
      snapshot: async (...args) => { this.sandboxTouched = true; return executor.snapshot(...args); },
      operationCapacity: () => executor.operationCapacity(),
      cancel: (id) => executor.cancel(id),
      run: async (parent, command, options) => {
        this.sandboxTouched = true;
        this.commands.push(publicCommand(command));
        let result: RunResult | undefined;
        try {
          result = await executor.run(parent, command, options);
          return result;
        } finally {
          const id = result?.operation?.operationId ?? options?.operationId;
          if (id === undefined) this.incompleteSandbox = true;
          else this.sandbox.set(id, { operationId: id, rawAmount: result?.metrics.cost ?? null, rawUnit: null, unitSource: null, billed: null });
        }
      },
      runMany: async (parent, commands, options) => {
        const results: RunResult[] = [];
        for (const command of commands) results.push(await this.executor.run(parent, command, options));
        return results;
      },
    };
    const delegate = input.llm as TierLlm<ModelTier>;
    this.llm = {
      ...(delegate.capacitySnapshot === undefined ? {} : { capacitySnapshot: () => delegate.capacitySnapshot!() }),
      ...(delegate.modelId === undefined ? {} : { modelId: (tier) => delegate.modelId!(tier) }),
      ...(delegate.modelQuote === undefined ? {} : { modelQuote: (tier, messages, options) => delegate.modelQuote!(tier, messages, options) }),
      async chat(tier, messages, options) {
        // Bound below to the recorder; preserved as a method for TierLlm typing.
        return observeModel(tier, messages, options);
      },
    };
    const observeModel: TierLlm<ModelTier>['chat'] = async (tier, messages, options) => {
      const quote = options?.quotedRoute ?? delegate.modelQuote?.(tier, messages, options);
      const requested = modelId(quote?.modelId ?? delegate.modelId?.(tier));
      if (quote?.routingProfileHash ?? quote?.profileId) this.routingVersion = quote.routingProfileHash ?? quote.profileId;
      const modelIndex = this.models.length;
      if (requested !== null) this.models.push({ purpose: purpose(options, tier), tier: quote?.role ?? tier, requestedModel: requested, returnedModel: null });
      else this.incompleteInference = true;
      try {
        const reply = await delegate.chat(tier, messages, options);
        if (requested !== null) this.models[modelIndex]!.returnedModel = modelId(reply.providerModel);
        if (requested !== null && reply.usage !== undefined &&
          [reply.usage.inTok, reply.usage.outTok, reply.usage.reasoningTok].every(value => Number.isSafeInteger(value) && value >= 0)) {
          const catalogTier = (Object.keys(DEFAULT_MODELS) as ModelTier[]).find(role => DEFAULT_MODELS[role] === requested);
          const catalogPrice = catalogTier === undefined ? undefined : DEFAULT_MODEL_PRICES[catalogTier];
          const price = reply.providerModel === requested && catalogPrice !== undefined &&
            quote?.price.input === catalogPrice.input && quote.price.output === catalogPrice.output
            ? { inputPerMillionUsd: catalogPrice.input, outputPerMillionUsd: catalogPrice.output, ...DEFAULT_MODEL_PRICE_PROVENANCE } : null;
          this.inference.push({ modelIndex, inputTokens: reply.usage.inTok, outputTokens: reply.usage.outTok, reasoningTokens: reply.usage.reasoningTok,
            estimateUsd: price === null ? null : (reply.usage.inTok * price.inputPerMillionUsd +
              (reply.usage.outTok + reply.usage.reasoningTok) * price.outputPerMillionUsd) / 1_000_000, price });
        } else this.incompleteInference = true;
        return reply;
      } catch (error) {
        this.incompleteInference = true;
        throw error;
      }
    };
  }

  finish(input: ExecutionRecordFinish): { evidence: VerificationEvidence; verificationArtifact: VerificationArtifact } {
    const finishedAt = this.now();
    const accepted = input.outcome === 'repaired' || input.outcome === 'verified-supplied-patch';
    const subjects = input.challenges?.observations ?? input.prepared?.baseline ?? [];
    const evidence: VerificationEvidence = {
      schemaVersion: VERIFICATION_EXECUTION_EVIDENCE_VERSION,
      mode: this.mode, outcome: input.outcome,
      assurance: accepted && input.verification.challengeAssurance ? 'contract-verified' : 'baseline-only',
      identity: { ...input.identity, sourceKind: input.identity.sourceKind ?? 'git', imageDigest: this.imageDigest, executorImageId: input.baselineImageId ?? null,
        routingVersion: this.routingVersion, challengeVersion: CHALLENGE_SET_VERSION },
      startedAt: new Date(this.startedAt).toISOString(), finishedAt: new Date(finishedAt).toISOString(),
      commands: [...this.commands], models: structuredClone(this.models),
      challenges: { mode: input.verification.challengeMode,
        qualifiedProbeCount: input.prepared?.qualified.filter(probe => probe.qualified).length ?? 0,
        ...(input.prepared?.set === null || input.prepared?.set === undefined ? {} : {
          setHash: input.prepared.set.setHash,
          subjects: subjects.map(subject => ({ ...subject, observationSha256: subject.observationSha256 ?? null })),
        }) },
      gates: structuredClone(input.verification.observations),
      costs: { schemaVersion: VERIFICATION_COST_VERSION,
        inference: this.incompleteInference ? null : structuredClone(this.inference),
        sandbox: this.incompleteSandbox || (this.sandboxTouched && this.sandbox.size === 0) ? null : [...this.sandbox.values()].map(value => ({ ...value })),
        wallTimeMs: finishedAt - this.startedAt },
    };
    return { evidence, verificationArtifact: encodeVerificationEvidence(evidence) };
  }
}
