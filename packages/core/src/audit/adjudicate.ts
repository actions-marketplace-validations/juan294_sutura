import { BudgetExceededError, type SecondOpinionReservation } from '../engine/repair-budget.js';
import { publicRepairReason } from '../engine/repair-model-call.js';
import { Buffer } from 'node:buffer';

import type { Diagnosis } from '../domain.js';
import { calculateModelCostUsd } from '../llm/cost.js';
import { extractJson } from '../llm/json.js';
import { SECOND_OPINION_MODEL, SECOND_OPINION_PRICE } from '../llm/openai.js';
import type { TierLlm } from '../llm/types.js';
import {
  redactExternalMessages,
  redactExternalJsonValue,
} from '../security/external-text.js';
import { boundedTail } from '../text/bounded-tail.js';

export type AdjudicationLlm = TierLlm<'ultra'>;

export interface AdjudicationContext {
  diagnosis: Diagnosis;
  diff: string;
  beforeLog: string;
  afterLog: string;
  challengeEvidence?: {setHash: string | null; status: string; observations: readonly {challengeId: string; subject: string; repetition: number; status: string; reasonCode: string; observationSha256?: string}[]};
}

export interface AdjudicationResult {
  approved: boolean;
  reasoning: string;
}

export const ADVERSARIAL_AUDIT_PROMPT = [
  'You are trying to prove this patch does NOT fix the diagnosed cause and merely makes CI pass.',
  'Default to refusal when uncertain.',
  'Attempt to find deleted tests or removed describe/it blocks; added skip, only, xit, or xdescribe markers; passWithNoTests or widened test ignores; fewer or weakened assertions; loosened TypeScript safety; disabled lint rules or widened Vitest exclusions; and a patch that fixes a different bug than the diagnosis.',
  'Approve only when the patch fixes the diagnosed cause and the after log confirms the repair without reducing enforcement.',
  'Return one JSON object with exactly this shape: {"approved":boolean,"reasoning":"non-empty public-safe explanation"}.',
  'Do not include hidden reasoning.',
].join('\n');

const OPTIONS = {
  maxTokens: 4_096,
  temperature: 0,
  responseFormat: { type: 'json_object' as const },
};

const BEFORE_LOG_BOUNDS = {
  maxLines: 200,
  maxCharacters: 20_000,
  maxBytes: 20_000,
};
const AFTER_LOG_BOUNDS = {
  maxLines: 100,
  maxCharacters: 2_000,
  maxBytes: 2_000,
};
const MAX_CONTEXT_CHARACTERS = 64_000;
const MAX_CONTEXT_BYTES = 64_000;

function validateAdjudication(value: unknown): AdjudicationResult {
  if (typeof value !== 'object' || value === null) {
    throw new Error('adjudication must be an object');
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.approved !== 'boolean') {
    throw new Error('approved must be a boolean');
  }
  if (typeof candidate.reasoning !== 'string' || !candidate.reasoning.trim()) {
    throw new Error('reasoning must be a non-empty string');
  }
  return {
    approved: candidate.approved,
    reasoning: candidate.reasoning.trim(),
  };
}

function contextMessage(context: AdjudicationContext): string | null {
  const encoded = JSON.stringify(redactExternalJsonValue({
    diagnosis: context.diagnosis,
    candidateDiff: context.diff,
    beforeLog: boundedTail(context.beforeLog, BEFORE_LOG_BOUNDS),
    afterLog: boundedTail(context.afterLog, AFTER_LOG_BOUNDS),
    ...(context.challengeEvidence === undefined ? {} : {challengeEvidence: context.challengeEvidence}),
  }));
  return encoded.length <= MAX_CONTEXT_CHARACTERS &&
    Buffer.byteLength(encoded, 'utf8') <= MAX_CONTEXT_BYTES
    ? encoded
    : null;
}

const CONTEXT_EXCEEDS_LIMIT_REASON =
  'REFUSED: adversarial audit context exceeds the safe Ultra request limit; the candidate diff was not truncated.';
const REMAINED_INVALID_REASON =
  'REFUSED: Ultra adjudication remained invalid after one repair attempt; uncertainty defaults to refusal.';

export interface AdjudicateWithOptions {
  /** true: never throws, defaults to a REFUSED result on any non-budget error (adjudicate()'s original behavior). */
  failClosed: boolean;
}

/**
 * Shared adjudication call. `failClosed: true` (adjudicate()) never throws:
 * uncertainty becomes a REFUSED result. `failClosed: false` (secondOpinion())
 * rethrows every non-budget failure so the caller can record `skipped`
 * instead of silently vetoing on a transport or parse failure.
 */
export async function adjudicateWith(
  llm: AdjudicationLlm,
  context: AdjudicationContext,
  { failClosed }: AdjudicateWithOptions,
): Promise<AdjudicationResult> {
  let userContent: string | null;
  try {
    userContent = contextMessage(context);
  } catch {
    userContent = null;
  }
  if (userContent === null) {
    if (!failClosed) throw new Error(CONTEXT_EXCEEDS_LIMIT_REASON);
    return { approved: false, reasoning: CONTEXT_EXCEEDS_LIMIT_REASON };
  }

  const options = {
    ...OPTIONS,
    routing: {
      failureClass: context.diagnosis.class,
      diagnosisConfidence: context.diagnosis.confidence,
      remainingInferenceBudgetUsd: Number.MAX_SAFE_INTEGER,
    },
  };

  try {
    const initial = await llm.chat(
      'ultra',
      redactExternalMessages([
        { role: 'system' as const, content: ADVERSARIAL_AUDIT_PROMPT },
        { role: 'user' as const, content: userContent },
      ]),
      options,
    );

    return await extractJson(initial, validateAdjudication, async (repairPrompt) =>
      llm.chat(
        'ultra',
        redactExternalMessages([
          { role: 'system' as const, content: ADVERSARIAL_AUDIT_PROMPT },
          { role: 'user' as const, content: userContent },
          { role: 'assistant' as const, content: initial.text },
          { role: 'user' as const, content: repairPrompt },
        ]),
        options,
      ),
    );
  } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
    if (error instanceof Error && error.cause instanceof BudgetExceededError) throw error.cause;
    if (!failClosed) throw error;
    return { approved: false, reasoning: REMAINED_INVALID_REASON };
  }
}

export async function adjudicate(
  llm: AdjudicationLlm,
  context: AdjudicationContext,
): Promise<AdjudicationResult> {
  return adjudicateWith(llm, context, { failClosed: true });
}

export type SecondOpinionStatus = 'approved' | 'refused' | 'skipped';

export interface SecondOpinionResult {
  status: SecondOpinionStatus;
  reasoning: string;
  model: string;
}

/** Structurally satisfied by RepairBudget; kept narrow so tests can supply a minimal fake. */
export interface SecondOpinionBudget {
  reserveSecondOpinion(worstCaseUsd: number): SecondOpinionReservation;
  settleSecondOpinion(reservation: SecondOpinionReservation, actualUsd: number): void;
}

/**
 * Absolute worst-case cost ceiling for one Astra adjudication call: the
 * maximum bounded context (MAX_CONTEXT_CHARACTERS, ~4 characters per token)
 * at SECOND_OPINION_PRICE.input, plus OPTIONS.maxTokens at
 * SECOND_OPINION_PRICE.output. Reserving this fixed ceiling on every call
 * would exceed the default USD 0.30 secondOpinionUsd budget even for a tiny
 * context (the request is dominated by the fixed output-token ceiling), so
 * `secondOpinion` reserves per-call against the actual encoded context size
 * instead; this constant remains the documented upper bound.
 * See docs/plans/2026-09-15-launch-readiness-v0.3.1-phases/phase-3.md.
 */
export const SECOND_OPINION_WORST_CASE_USD = calculateModelCostUsd(SECOND_OPINION_PRICE, {
  inTok: Math.ceil(MAX_CONTEXT_CHARACTERS / 4),
  outTok: OPTIONS.maxTokens,
  reasoningTok: 0,
});

/** Worst-case cost for this specific call's encoded context, capped by the fixed output-token ceiling. */
function secondOpinionWorstCaseUsd(userContent: string): number {
  return calculateModelCostUsd(SECOND_OPINION_PRICE, {
    inTok: Math.ceil(Buffer.byteLength(userContent, 'utf8') / 4),
    outTok: OPTIONS.maxTokens,
    reasoningTok: 0,
  });
}

/**
 * Optional veto-only second opinion (GPT-6 Astra). Fails open to `skipped` on
 * any transport, parse, or budget error, or when unconfigured -- it can only
 * block a run by actively refusing, never cause one to succeed. The runtime
 * model remains Nemotron on Nebius Token Factory; see docs/research/2026-08-26-nebius-hackathon-fit.md.
 */
export async function secondOpinion(
  llm: AdjudicationLlm | undefined,
  context: AdjudicationContext,
  budget?: SecondOpinionBudget,
): Promise<SecondOpinionResult> {
  const model = SECOND_OPINION_MODEL;
  if (!llm) {
    return { status: 'skipped', reasoning: 'Not configured: OPENAI_API_KEY absent', model };
  }
  try {
    let userContent: string | null;
    try {
      userContent = contextMessage(context);
    } catch {
      userContent = null;
    }
    const worstCaseUsd = userContent === null
      ? SECOND_OPINION_WORST_CASE_USD
      : secondOpinionWorstCaseUsd(userContent);
    const reservation = budget?.reserveSecondOpinion(worstCaseUsd);
    let actualUsd = 0;
    const meteredLlm: AdjudicationLlm = {
      chat: async (tier, messages, chatOptions) => {
        const reply = await llm.chat(tier, messages, chatOptions);
        actualUsd += reply.usd ?? 0;
        return reply;
      },
    };
    const result = await adjudicateWith(meteredLlm, context, { failClosed: false });
    if (reservation !== undefined) budget?.settleSecondOpinion(reservation, actualUsd);
    return { status: result.approved ? 'approved' : 'refused', reasoning: result.reasoning, model };
  } catch (error) {
    return {
      status: 'skipped',
      reasoning: `Skipped: ${error instanceof BudgetExceededError ? 'second-opinion budget exhausted' : publicRepairReason(error instanceof Error ? error.message : String(error))}`,
      model,
    };
  }
}
