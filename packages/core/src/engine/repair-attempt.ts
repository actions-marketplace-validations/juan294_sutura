import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { moduleSystemInstruction } from './module-syntax.js';
import type { Candidate } from '../domain.js';
import type { ChatMessage, ChatOptions, JsonSchema } from '../llm/types.js';
import { policyAllowsPatchPath } from '../policy/evaluate.js';
import { assertExternalEditableText, redactExternalJsonValue } from '../security/external-text.js';
import type { RepairAgentContext, RepairAgentOutcome } from './repair-agent.js';
import { publicRepairReason, requestRepairModel } from './repair-model-call.js';
import { RepairToolRuntime, type RepairToolResult } from './repair-tools.js';
import { isAuthorizedRepairTarget } from './repair-authorization.js';
import { isRepairPathAdmissible } from './patch-rules.js';
import {
  modelRepairSlots,
  selectRepairTargetSets,
  type RepairTargetKind,
  type RepairTargetSlot,
} from './repair-targets.js';
import {
  anchoredEditsDiff,
  indexRepairSourceLines,
  REPAIR_EDIT_FIELDS,
  REPAIR_PROPOSAL_FIELDS,
  REPAIR_PROPOSAL_LIMITS,
} from './repair.js';

const REPAIR_ATTEMPT_MINIMUM_INFERENCE_USD = 0.05;

export const REPAIR_ATTEMPT_COSTS = Object.freeze({
  modelTurns: 1,
  toolCalls: 3,
  branches: 1,
  sandboxOperations: 2,
});

export interface RepairAttemptFeedback {
  candidateDiff: string;
  testOutput: string;
  errorFingerprint: string;
  repeatedProposal?: true;
}

export interface ControlledRepairAttemptContext extends RepairAgentContext {
  feedback?: RepairAttemptFeedback;
  proposalTemplate?: ControlledRepairProposalTemplate;
  proposalContract?: RepairProposalContract;
}

interface RepairProposal {
  slotId: string;
  replacement: string;
}

interface SourceEvidence {
  path: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
  editable: boolean;
  lines: Array<{ line: number; text: string }>;
}

interface PreparedSourceEvidence extends SourceEvidence {
  policyAdmissible: boolean;
  replacementCodePoints: number;
  /** Kept for target selection and slot identity; never sent to the model. */
  content: string;
}

export interface RepairProposalContract {
  messages: ChatMessage[];
  schema: JsonSchema;
  requestBytes: number;
  /** The first completion slot; a single-target contract has only this one. */
  target: RepairProposalTarget;
  /** Every slot the model completes, in stable slot order. */
  slots: RepairTargetSlot[];
  kind: RepairTargetKind;
  /** Controller-generated files the transaction also changes. */
  generatedPaths: string[];
}

export interface RepairProposalTarget {
  path: string;
  startLine: number;
  endLine: number;
}

export interface ControlledRepairProposalTemplate {
  readonly targetCount: number;
  contract(feedback?: RepairAttemptFeedback, targetIndex?: number): RepairProposalContract;
}

export class RepairProposalPreparationError extends Error {
  constructor(
    readonly failureKind: 'invalid' | 'policy',
    message: string,
  ) {
    super(message);
    this.name = 'RepairProposalPreparationError';
  }
}

const REPAIR_PROPOSAL_EXAMPLE = Object.freeze({
  [REPAIR_PROPOSAL_FIELDS.replacement]: 'complete replacement for the controller-selected excerpt',
});
const REPAIR_PAIR_PROPOSAL_EXAMPLE = Object.freeze({
  [REPAIR_PROPOSAL_FIELDS.replacements]: [{
    [REPAIR_PROPOSAL_FIELDS.slot]: 'slot-1',
    [REPAIR_PROPOSAL_FIELDS.replacement]: 'complete replacement for that slot',
  }],
});

function proposalExample(slots: readonly RepairTargetSlot[]): unknown {
  return slots.length === 1 ? REPAIR_PROPOSAL_EXAMPLE : REPAIR_PAIR_PROPOSAL_EXAMPLE;
}
export const CONTROLLED_REPAIR_MAX_TOKENS = 8_192;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sourceEvidence(ctx: Pick<ControlledRepairAttemptContext, 'diagnosis' | 'policy' | 'sourceContext' | 'authorization'>): PreparedSourceEvidence[] {
  return ctx.sourceContext.sources.flatMap((source) => {
    assertExternalEditableText(source.content);
    let lines: ReturnType<typeof indexRepairSourceLines>;
    try {
      lines = indexRepairSourceLines(source);
    } catch (error) {
      throw new RepairProposalPreparationError(
        'invalid', error instanceof Error ? error.message : String(error),
      );
    }
    if (lines.length === 0) return [];
    const policyAdmissible = isRepairPathAdmissible(
      source.path, ctx.diagnosis, ctx.authorization, source,
    ) && (ctx.authorization === undefined || isAuthorizedRepairTarget(
      ctx.authorization.session, ctx.authorization.baseline, source,
    )) && policyAllowsPatchPath(source.path, ctx.policy);
    const replacementCodePoints = [...source.content].length;
    return [{
      path: source.path,
      startLine: source.startLine,
      endLine: lines.at(-1)!.line,
      truncated: source.truncated,
      editable: policyAdmissible &&
        replacementCodePoints <= REPAIR_PROPOSAL_LIMITS.replacementCodePoints &&
        (!source.truncated || source.content.endsWith('\n') || source.boundaryComplete === true),
      lines: lines.map(({ line, text }) => ({ line, text })),
      policyAdmissible,
      replacementCodePoints,
      content: source.content,
    }];
  });
}

function proposalSchema(slots: readonly RepairTargetSlot[]): JsonSchema {
  const replacement = {
    type: 'string', maxLength: REPAIR_PROPOSAL_LIMITS.replacementCodePoints,
  };
  if (slots.length === 1) {
    return {
      type: 'object',
      properties: { [REPAIR_PROPOSAL_FIELDS.replacement]: replacement },
      required: [REPAIR_PROPOSAL_FIELDS.replacement],
      additionalProperties: false,
    };
  }
  return {
    type: 'object',
    properties: {
      [REPAIR_PROPOSAL_FIELDS.replacements]: {
        type: 'array',
        minItems: slots.length,
        maxItems: slots.length,
        items: {
          type: 'object',
          properties: {
            [REPAIR_PROPOSAL_FIELDS.slot]: {
              type: 'string', enum: slots.map(({ slotId }) => slotId),
            },
            [REPAIR_PROPOSAL_FIELDS.replacement]: replacement,
          },
          required: [REPAIR_PROPOSAL_FIELDS.slot, REPAIR_PROPOSAL_FIELDS.replacement],
          additionalProperties: false,
        },
      },
    },
    required: [REPAIR_PROPOSAL_FIELDS.replacements],
    additionalProperties: false,
  };
}

export function prepareControlledRepairProposalTemplate(
  ctx: Pick<ControlledRepairAttemptContext, 'diagnosis' | 'policy' | 'sourceContext' | 'authorization' | 'runtimeId'>,
): ControlledRepairProposalTemplate {
  return buildProposalTemplate(ctx, sourceEvidence(ctx));
}

function buildProposalTemplate(
  ctx: Pick<ControlledRepairAttemptContext, 'diagnosis' | 'policy' | 'runtimeId'>,
  sources: PreparedSourceEvidence[],
): ControlledRepairProposalTemplate {
  if (sources.length === 0) {
    throw new RepairProposalPreparationError(
      'invalid', 'No non-empty anchorable repair source was available',
    );
  }
  const policySources = sources.filter(({ policyAdmissible }) => policyAdmissible);
  if (policySources.length === 0) {
    throw new RepairProposalPreparationError(
      'policy', 'No policy-admissible bounded repair source was available',
    );
  }
  const editableSources = policySources.filter(({ editable }) => editable);
  if (editableSources.length === 0) {
    throw new RepairProposalPreparationError(
      'invalid', 'No completion-bounded repair source was available',
    );
  }
  const targetSets = selectRepairTargetSets({
    sources: policySources.map(({ path, startLine, endLine, content, editable }) => ({
      path, startLine, endLine, content, editable,
    })),
    runtimeId: ctx.runtimeId ?? 'node',
    policy: ctx.policy,
  });
  if (targetSets.length === 0) {
    throw new RepairProposalPreparationError(
      'invalid', 'No bounded repair target set was available',
    );
  }
  const evidence = {
    diagnosis: redactExternalJsonValue(ctx.diagnosis),
    sources: sources.map((source): SourceEvidence => ({
      path: source.path,
      startLine: source.startLine,
      endLine: source.endLine,
      truncated: source.truncated,
      editable: source.editable,
      lines: source.lines,
    })),
    trustedCommandId: 'diagnosed',
  };
  const repairInstruction = ctx.diagnosis.class === 'test-bug'
    ? 'Repair the diagnosed test defect; do not change policy.'
    : 'The failing assertion declares required behavior. Repair production source; do not change tests or policy.';
  const systemMessageFor = (slots: readonly RepairTargetSlot[]): ChatMessage => ({
    role: 'system',
    content: [
      slots.length === 1
        ? 'Return one complete replacement repair proposal as strict JSON.'
        : 'Return one complete replacement for every controller-selected slot as strict JSON.',
      `Return exactly this shape: ${JSON.stringify(proposalExample(slots))}`,
      slots.length === 1
        ? 'The controller selects exactly one target excerpt. You cannot select a path or line range.'
        : 'The controller selects every slot. Name each slot by its supplied slot identifier; you cannot select a path or line range, and you cannot add, drop or repeat a slot.',
      'replacement must be the complete new text for the entire selected target excerpt, including every unchanged line and without supplied line numbers.',
      repairInstruction,
      'Use an empty replacement only when deleting the entire selected excerpt is the diagnosed repair.',
      'Change the smallest necessary part of the excerpt, but return the full replacement excerpt.',
      'Do not include analysis or markdown.',
      'A previousAttempt is feedback only; this proposal will be applied to the clean baseline.',
    ].join('\n'),
  });
  const cache = new Map<string, RepairProposalContract>();
  return {
    targetCount: targetSets.length,
    contract(feedback, targetIndex = 0) {
      if (!Number.isSafeInteger(targetIndex) || targetIndex < 0 || targetIndex >= targetSets.length) {
        throw new RepairProposalPreparationError('invalid', 'Repair proposal target index is outside the bounded source closure');
      }
      const targetSet = targetSets[targetIndex]!;
      const slots = modelRepairSlots(targetSet);
      if (slots.length === 0) {
        throw new RepairProposalPreparationError('invalid', 'Repair target set offers no completion slot');
      }
      const schema = proposalSchema(slots);
      const target: RepairProposalTarget = {
        path: slots[0]!.path,
        startLine: slots[0]!.startLine,
        endLine: slots[0]!.endLine,
      };
      const redactedFeedback = feedback === undefined
        ? undefined
        : redactExternalJsonValue(feedback);
      const feedbackKey = redactedFeedback === undefined
        ? 'baseline'
        : digest(JSON.stringify(redactedFeedback));
      const repeatedProposal = feedback?.repeatedProposal === true;
      const key = `${targetIndex}:${feedbackKey}${repeatedProposal ? ':repeat' : ''}`;
      const existing = cache.get(key);
      if (existing !== undefined) return existing;
      const systemMessage = systemMessageFor(slots);
      const extraLines = [
        ...new Set(slots.map(({ path }) => moduleSystemInstruction(path))),
        repeatedProposal
          ? 'The previous proposal was identical to an earlier failed proposal for this excerpt. Return a materially different replacement.'
          : undefined,
      ].filter((line): line is string => line !== undefined);
      const contractSystemMessage = extraLines.length === 0
        ? systemMessage
        : { ...systemMessage, content: [systemMessage.content, ...extraLines].join('\n') };
      const generatedPaths = targetSet.slots
        .filter(({ generated }) => generated)
        .map(({ path }) => path);
      const selected = slots.length === 1
        ? { selectedTarget: target }
        : {
          selectedSlots: slots.map(({ slotId, path, startLine, endLine }) =>
            ({ slotId, path, startLine, endLine })),
          ...(targetSet.relationship === undefined
            ? {}
            : { slotRelationship: targetSet.relationship }),
          ...(generatedPaths.length === 0 ? {} : { controllerGeneratedPaths: generatedPaths }),
        };
      const messages: ChatMessage[] = [
        contractSystemMessage,
        {
          role: 'user',
          content: JSON.stringify({
            ...evidence,
            ...selected,
            ...(redactedFeedback === undefined ? {} : { previousAttempt: redactedFeedback }),
          }),
        },
      ];
      const contract = {
        schema,
        messages,
        requestBytes: Buffer.byteLength(JSON.stringify({ messages, responseSchema: schema }), 'utf8'),
        target,
        slots,
        kind: targetSet.kind,
        generatedPaths,
      };
      cache.set(key, contract);
      return contract;
    },
  };
}

/** Exposes the slot-reply contract to tests without widening the runtime surface. */
export function parseControlledRepairProposalForTest(
  text: string,
  slots: readonly RepairTargetSlot[],
): Array<{ slotId: string; replacement: string }> {
  return parseProposal(text, slots);
}

function proposalContract(ctx: ControlledRepairAttemptContext): RepairProposalContract {
  if (ctx.proposalContract !== undefined) return ctx.proposalContract;
  const template = ctx.proposalTemplate ?? prepareControlledRepairProposalTemplate(ctx);
  return template.contract(ctx.feedback);
}

function proposalObject(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new SyntaxError('Repair proposal must be valid JSON', { cause: error });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Repair proposal must be an object');
  }
  return value as Record<string, unknown>;
}

function boundedReplacement(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Repair proposal replacement must be a string');
  }
  if ([...value].length > REPAIR_PROPOSAL_LIMITS.replacementCodePoints) {
    throw new TypeError('Repair proposal replacement exceeds the completion-bound source limit');
  }
  return value;
}

/**
 * One replacement per controller-supplied slot, in slot order. A reply that
 * adds, drops, repeats or renames a slot is refused rather than partially
 * applied, so an incomplete transaction never reaches a branch.
 */
function parseProposal(text: string, slots: readonly RepairTargetSlot[]): RepairProposal[] {
  const record = proposalObject(text);
  const keys = Object.keys(record);
  if (slots.length === 1) {
    if (keys.length !== 1 || keys[0] !== REPAIR_PROPOSAL_FIELDS.replacement) {
      throw new TypeError('Repair proposal must contain only the replacement field');
    }
    return [{
      slotId: slots[0]!.slotId,
      replacement: boundedReplacement(record[REPAIR_PROPOSAL_FIELDS.replacement]),
    }];
  }
  const replacements = record[REPAIR_PROPOSAL_FIELDS.replacements];
  if (keys.length !== 1 || keys[0] !== REPAIR_PROPOSAL_FIELDS.replacements) {
    throw new TypeError('Repair proposal must contain only the replacements field');
  }
  if (!Array.isArray(replacements) || replacements.length !== slots.length) {
    throw new TypeError(`Repair proposal must contain exactly ${slots.length} slot replacements`);
  }
  const bySlot = new Map<string, string>();
  for (const entry of replacements) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new TypeError('Each repair proposal replacement must be an object');
    }
    const item = entry as Record<string, unknown>;
    const itemKeys = Object.keys(item);
    if (
      itemKeys.length !== 2 ||
      !itemKeys.includes(REPAIR_PROPOSAL_FIELDS.slot) ||
      !itemKeys.includes(REPAIR_PROPOSAL_FIELDS.replacement)
    ) throw new TypeError('Each repair proposal replacement must contain only slot and replacement');
    const slotId = item[REPAIR_PROPOSAL_FIELDS.slot];
    if (typeof slotId !== 'string' || !slots.some((slot) => slot.slotId === slotId)) {
      throw new TypeError('Repair proposal named a slot the controller did not supply');
    }
    if (bySlot.has(slotId)) {
      throw new TypeError('Repair proposal repeated a slot');
    }
    bySlot.set(slotId, boundedReplacement(item[REPAIR_PROPOSAL_FIELDS.replacement]));
  }
  return slots.map((slot) => ({ slotId: slot.slotId, replacement: bySlot.get(slot.slotId)! }));
}

function worstCaseRequestUsd(
  requestBytes: number, inputPrice: number, outputPrice: number,
): number {
  const priced = (requestBytes * inputPrice + CONTROLLED_REPAIR_MAX_TOKENS * outputPrice) / 1_000_000;
  return Math.max(REPAIR_ATTEMPT_MINIMUM_INFERENCE_USD, Math.ceil(priced * 1_000_000) / 1_000_000);
}

function proposalOptions(ctx: Pick<ControlledRepairAttemptContext, 'diagnosis' | 'budget' | 'feedback'>, schema: JsonSchema, targetCount = 1): ChatOptions {
  return {
    purpose: 'repair',
    maxTokens: CONTROLLED_REPAIR_MAX_TOKENS,
    temperature: 1,
    topP: 0.95,
    thinkingMode: 'disabled',
    responseFormat: {
      type: 'json_schema',
      jsonSchema: { name: 'sutura_repair_proposal', strict: true, schema },
    },
    routing: {
      targetCount,
      priorRepairFeedback: ctx.feedback !== undefined && ctx.feedback.repeatedProposal !== true,
      runScope: ctx.budget,
      failureClass: ctx.diagnosis.class,
      diagnosisConfidence: ctx.diagnosis.confidence,
      remainingInferenceBudgetUsd: Math.max(0, ctx.budget.limits.inferenceCostUsd - ctx.budget.snapshot().inferenceCostUsd),
    },
  };
}

export function controlledRepairAttemptReservationUsd(
  ctx: ControlledRepairAttemptContext,
): number {
  const { messages, schema, requestBytes, slots } = proposalContract(ctx);
  const options = proposalOptions(ctx, schema, slots.length);
  const quote = ctx.llm.modelQuote?.('super', messages, options);
  if (quote === undefined) throw new Error('Repair model routing quote is unavailable');
  return worstCaseRequestUsd(requestBytes, quote.price.input, quote.price.output);
}

/** Price bounded initial/recovery prompts without granting or exposing an editable target. */
export function recoveryRepairReservationUsd(
  ctx: Pick<ControlledRepairAttemptContext, 'llm' | 'diagnosis' | 'policy' | 'sourceContext' | 'budget' | 'runtimeId'>,
): number {
  const sources = sourceEvidence(ctx);
  const diagnoses = [ctx.diagnosis, ...(['test-bug', 'env-config'] as const).map((failureClass) => ({
    ...ctx.diagnosis, class: failureClass,
    signals: [...ctx.diagnosis.signals, 'recovery:hypothesis-2'],
  }))];
  const templates: Array<{ diagnosis: typeof ctx.diagnosis; template: ControlledRepairProposalTemplate }> = [];
  if (sources.some(({ editable }) => editable)) {
    templates.push({ diagnosis: ctx.diagnosis, template: buildProposalTemplate(ctx, sources) });
  }
  for (const diagnosis of diagnoses.slice(1)) {
    for (const selected of sources) {
      if (selected.truncated || selected.startLine !== 1 ||
        selected.replacementCodePoints > REPAIR_PROPOSAL_LIMITS.replacementCodePoints ||
        !policyAllowsPatchPath(selected.path, ctx.policy)) continue;
      const estimate = sources.map((source) => ({
        ...source, editable: source === selected, policyAdmissible: source === selected,
      }));
      templates.push({
        diagnosis,
        template: buildProposalTemplate({
          diagnosis, policy: ctx.policy, ...(ctx.runtimeId === undefined ? {} : { runtimeId: ctx.runtimeId }),
        }, estimate),
      });
    }
  }
  let maximum = REPAIR_ATTEMPT_MINIMUM_INFERENCE_USD;
  for (const { diagnosis, template } of templates) {
    for (let index = 0; index < template.targetCount; index++) {
      const { messages, schema, requestBytes } = template.contract(undefined, index);
      const quote = ctx.llm.modelQuote?.('super', messages, proposalOptions({ diagnosis, budget: ctx.budget }, schema));
      if (quote === undefined) throw new Error('Repair model routing quote is unavailable');
      maximum = Math.max(maximum, worstCaseRequestUsd(requestBytes, quote.price.input, quote.price.output));
    }
  }
  return maximum;
}

export async function runControlledRepairAttempt(
  ctx: ControlledRepairAttemptContext,
): Promise<RepairAgentOutcome> {
  try {
    ctx.budget.reserveBranch();
  } catch (error) {
    return { status: 'gave-up', failureKind: 'budget', reason: publicRepairReason(error instanceof Error ? error.message : String(error)) };
  }
  if (ctx.signal?.aborted) {
    return { status: 'gave-up', failureKind: 'sandbox', reason: 'Repair branch was cancelled' };
  }
  if (ctx.sourceContext.sources.length === 0) {
    return { status: 'gave-up', failureKind: 'invalid', reason: 'No bounded editable repair source was available' };
  }
  let contract: RepairProposalContract;
  try {
    contract = proposalContract(ctx);
  } catch (error) {
    return {
      status: 'gave-up',
      failureKind: error instanceof RepairProposalPreparationError ? error.failureKind : 'policy',
      reason: publicRepairReason(error instanceof Error ? error.message : String(error)),
    };
  }
  const { messages, schema, requestBytes, slots } = contract;
  const options = proposalOptions(ctx, schema, slots.length);
  const response = await requestRepairModel({
    llm: ctx.llm, budget: ctx.budget, messages, options,
    worstCaseUsd: (price) => worstCaseRequestUsd(requestBytes, price.input, price.output),
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    ...(ctx.observeCapacity === undefined ? {} : { observeCapacity: ctx.observeCapacity }),
  });
  if (!response.ok) return response.outcome;
  const { reply } = response;
  if (reply.finishReason === 'length') {
    return {
      status: 'gave-up', failureKind: 'completion-limit',
      reason: 'Repair proposal reached the provider completion-token limit',
    };
  }
  const slotById = new Map(slots.map((slot) => [slot.slotId, slot]));
  const parseAttempt = (text: string): {
    proposals: RepairProposal[];
    proposalDiff: string;
  } => {
    const proposals = parseProposal(text, slots);
    const proposalDiff = anchoredEditsDiff(proposals.map((proposal) => {
      const slot = slotById.get(proposal.slotId)!;
      return {
        path: slot.path,
        startLine: slot.startLine,
        endLine: slot.endLine,
        [REPAIR_EDIT_FIELDS.replacement]: proposal.replacement,
      };
    }), ctx.sourceContext);
    return { proposals, proposalDiff };
  };
  let parsedAttempt: ReturnType<typeof parseAttempt>;
  try {
    parsedAttempt = parseAttempt(reply.text);
  } catch (firstError) {
    const firstReason = publicRepairReason(
      firstError instanceof Error ? firstError.message : String(firstError),
    );
    const retryMessages: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: reply.text },
      {
        role: 'user',
        content: `The previous reply was not a valid repair proposal: ${firstReason}. Return only ${JSON.stringify(proposalExample(slots))} with the complete replacement text.`,
      },
    ];
    ctx.observe?.({
      parentImageId: ctx.initialImageId,
      note: 'Proposal retry after invalid response',
    });
    const retryBytes = Buffer.byteLength(JSON.stringify({
      messages: retryMessages,
      responseSchema: schema,
    }), 'utf8');
    const retryResponse = await requestRepairModel({
      llm: ctx.llm, budget: ctx.budget, messages: retryMessages, options,
      worstCaseUsd: (price) => worstCaseRequestUsd(retryBytes, price.input, price.output),
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
      ...(ctx.observeCapacity === undefined ? {} : { observeCapacity: ctx.observeCapacity }),
    });
    if (!retryResponse.ok) return retryResponse.outcome;
    if (retryResponse.reply.finishReason === 'length') {
      return {
        status: 'gave-up', failureKind: 'completion-limit',
        reason: 'Repair proposal reached the provider completion-token limit',
      };
    }
    try {
      parsedAttempt = parseAttempt(retryResponse.reply.text);
    } catch (secondError) {
      return {
        status: 'gave-up', failureKind: 'invalid',
        reason: publicRepairReason(
          secondError instanceof Error ? secondError.message : String(secondError),
        ),
      };
    }
  }
  const { proposals, proposalDiff } = parsedAttempt;
  const proposalDiffHash = digest(proposalDiff);
  const proposalId = `repair-${proposalDiffHash.slice(0, 12)}`;
  const proposalRationale = slots.length === 1
    ? 'Replace the controller-selected source excerpt.'
    : 'Replace every controller-selected slot as one transaction.';
  const tools = new RepairToolRuntime({
    executor: ctx.executor,
    initialImageId: ctx.initialImageId,
    diagnosis: ctx.diagnosis,
    policy: ctx.policy,
    budget: ctx.budget,
    trustedCommands: ctx.trustedCommands,
    sourceContext: ctx.sourceContext,
    ...(ctx.authorization === undefined ? {} : { authorization: ctx.authorization }),
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    ...(ctx.operationIdPrefix === undefined ? {} : { operationIdPrefix: ctx.operationIdPrefix }),
    ...(ctx.onOperationStart === undefined ? {} : { onOperationStart: ctx.onOperationStart }),
    ...(ctx.observe === undefined ? {} : { observe: ctx.observe }),
  });
  const execute = async (id: string, name: string, args: unknown): Promise<RepairToolResult> => {
    try {
      ctx.budget.reserveToolCall();
    } catch (error) {
      return { ok: false, kind: 'budget', message: publicRepairReason(error instanceof Error ? error.message : String(error)) };
    }
    ctx.trace?.record({
      type: 'tool-request', stage: 'candidate', toolCallId: id, toolName: name,
      argumentSummary: name === 'apply_patch'
        ? { form: 'anchored-line-ranges', proposalId, proposalHash: digest(JSON.stringify(proposals)), diffHash: proposalDiffHash }
        : name === 'run_test'
          ? { commandId: 'diagnosed' }
          : { candidateId: proposalId, diffHash: digest(tools.state().cumulativeDiff) },
      ...(ctx.branchId === undefined ? {} : { childNodeId: ctx.branchId }),
    });
    const result = await tools.execute(name, args);
    ctx.trace?.record({
      type: 'tool-result', stage: 'candidate', toolCallId: id, toolName: name,
      resultSummary: JSON.stringify({ ok: result.ok, kind: result.kind ?? null, exitCode: result.exitCode ?? null, messageHash: digest(result.message) }),
      ...(ctx.branchId === undefined ? {} : { childNodeId: ctx.branchId }),
    });
    return result;
  };
  if (ctx.signal?.aborted) return { status: 'gave-up', failureKind: 'sandbox', reason: 'Repair branch was cancelled' };
  const applied = await execute(`${ctx.branchId ?? 'repair'}-apply`, 'apply_patch', { diff: proposalDiff });
  if (!applied.ok || applied.exitCode !== 0) {
    return {
      status: 'gave-up', failureKind: applied.kind ?? 'invalid',
      reason: publicRepairReason(`Repair proposal patch was not accepted: ${applied.message}`),
    };
  }
  if (ctx.signal?.aborted) return { status: 'gave-up', failureKind: 'sandbox', reason: 'Repair branch was cancelled' };
  const tested = await execute(`${ctx.branchId ?? 'repair'}-test`, 'run_test', { commandId: 'diagnosed' });
  if (ctx.signal?.aborted) return { status: 'gave-up', failureKind: 'sandbox', reason: 'Repair branch was cancelled' };
  const state = tools.state();
  if (!tested.ok || tested.exitCode === undefined || state.latestTest === undefined) {
    return { status: 'gave-up', failureKind: tested.kind ?? 'sandbox', reason: 'Automatic trusted test did not produce valid evidence' };
  }
  const candidate: Candidate = { id: proposalId, rationale: proposalRationale, diff: state.cumulativeDiff };
  if (tested.exitCode !== 0) {
    return {
      status: 'checkpoint', candidate, imageId: state.editableImageId,
      ...(state.lastNodeId === undefined ? {} : { nodeId: state.lastNodeId }), test: state.latestTest,
    };
  }
  const submitted = await execute(`${ctx.branchId ?? 'repair'}-submit`, 'submit_candidate', {
    id: proposalId, rationale: proposalRationale,
  });
  if (!submitted.ok || !submitted.submitted || !submitted.candidate || !submitted.imageId) {
    return { status: 'gave-up', failureKind: submitted.kind ?? 'invalid', reason: 'Automatic candidate submission failed' };
  }
  ctx.trace?.record({
    type: 'candidate-submitted', stage: 'candidate', candidateId: submitted.candidate.id,
    summary: submitted.candidate.rationale,
    ...(ctx.branchId === undefined ? {} : { childNodeId: ctx.branchId }),
  });
  return {
    status: 'submitted', candidate: submitted.candidate, imageId: submitted.imageId,
    ...(submitted.nodeId === undefined ? {} : { nodeId: submitted.nodeId }), test: state.latestTest,
  };
}
