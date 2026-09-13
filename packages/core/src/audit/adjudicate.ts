import { BudgetExceededError } from '../engine/repair-budget.js';
import { Buffer } from 'node:buffer';

import type { Diagnosis } from '../domain.js';
import { extractJson } from '../llm/json.js';
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

export async function adjudicate(
  llm: AdjudicationLlm,
  context: AdjudicationContext,
): Promise<AdjudicationResult> {
  let userContent: string | null;
  try {
    userContent = contextMessage(context);
  } catch {
    userContent = null;
  }
  if (userContent === null) {
    return {
      approved: false,
      reasoning:
        'REFUSED: adversarial audit context exceeds the safe Ultra request limit; the candidate diff was not truncated.',
    };
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
    return {
      approved: false,
      reasoning:
        'REFUSED: Ultra adjudication remained invalid after one repair attempt; uncertainty defaults to refusal.',
    };
  }
}
