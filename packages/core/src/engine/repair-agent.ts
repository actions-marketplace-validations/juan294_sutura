import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import type { Candidate, Diagnosis, RepairFailureKind } from '../domain.js';
import type { Executor, ImageId, RunResult } from '../executor/types.js';
import type { CapacitySnapshot, ChatMessage, FunctionToolCall, TierLlm } from '../llm/types.js';
import type { ModelPrice } from '../llm/cost.js';
import type { RepositoryPolicy } from '../policy/schema.js';
import { redactExternalJsonValue } from '../security/external-text.js';
import type { RepairAuthorizationContext } from './repair-authorization.js';
import type { RepairBudget } from './repair-budget.js';
import { publicRepairReason, requestRepairModel } from './repair-model-call.js';
import {
  REPAIR_TOOL_DEFINITIONS,
  RepairToolRuntime,
  type RepairTestEvidence,
  type RepairToolResult,
  type RepairToolState,
} from './repair-tools.js';
import type { RepairSourceContext } from './repair.js';
import type { RuntimeId } from '../runtime/types.js';
import type { TraceRecorder } from '../trace/recorder.js';

const MAX_AGENT_OUTPUT_TOKENS = 8_192;
const MINIMUM_AGENT_TURN_RESERVATION_USD = 0.05;
const MUTATING_TOOLS = new Set(['apply_patch', 'submit_candidate']);

export type RepairAgentOutcome =
  | {
      status: 'submitted';
      candidate: Candidate;
      imageId: ImageId;
      nodeId?: string;
      test: RepairTestEvidence;
    }
  | {
      status: 'checkpoint';
      candidate: Candidate;
      imageId: ImageId;
      nodeId?: string;
      test: RepairTestEvidence;
    }
  | { status: 'gave-up' | 'infra-stop'; reason: string; failureKind: RepairFailureKind };

export interface RepairAgentContext {
  llm: TierLlm<'super'>;
  executor: Executor;
  initialImageId: ImageId;
  diagnosis: Diagnosis;
  policy: RepositoryPolicy;
  budget: RepairBudget;
  trustedCommands: Readonly<Record<string, string>>;
  sourceContext: RepairSourceContext;
  /** Decides how a related-source pair resolves an import; defaults to Node. */
  runtimeId?: RuntimeId;
  authorization?: RepairAuthorizationContext;
  branchId?: string;
  operationIdPrefix?: string;
  observeCapacity?: (capacity: CapacitySnapshot) => void;
  onOperationStart?: (operationId: string) => void;
  signal?: AbortSignal;
  trace?: TraceRecorder;
  observe?: (input: { result?: RunResult; imageId?: ImageId; parentImageId: ImageId; note: string }) => string;
}

function initialMessages(ctx: RepairAgentContext): ChatMessage[] {
  const evidence = redactExternalJsonValue({
    diagnosis: ctx.diagnosis,
    initialSources: ctx.sourceContext.sources,
    trustedCommandIds: Object.keys(ctx.trustedCommands),
  });
  return [
    {
      role: 'system',
      content: [
        'Repair the diagnosed CI failure using only the supplied tools.',
        'Call exactly the tools needed. A tool call is required on every turn.',
        'Do not reveal hidden reasoning. Do not weaken tests or policy.',
        'When read_file names a resolved source path, use that path for edits.',
        'Only submit after the latest trusted test passes.',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(evidence) },
  ];
}

function fingerprint(call: FunctionToolCall): string {
  return `${call.function.name}:${call.function.arguments}`;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function traceToolArguments(name: string, value: unknown): Record<string, unknown> {
  const args = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (name === 'read_file') {
    return {
      path: typeof args.path === 'string' ? args.path : '[invalid]',
      ...(Number.isSafeInteger(args.startLine) ? { startLine: args.startLine } : {}),
      ...(Number.isSafeInteger(args.endLine) ? { endLine: args.endLine } : {}),
    };
  }
  if (name === 'search_repo') {
    const query = typeof args.query === 'string' ? args.query : '';
    return {
      queryHash: digest(query),
      queryBytes: Buffer.byteLength(query, 'utf8'),
      pathCount: Array.isArray(args.paths) ? args.paths.length : 0,
    };
  }
  if (name === 'run_test') {
    return { commandId: typeof args.commandId === 'string' ? args.commandId : '[invalid]' };
  }
  if (name === 'apply_patch') {
    const payload = JSON.stringify(args);
    return {
      payloadHash: digest(payload),
      payloadBytes: Buffer.byteLength(payload, 'utf8'),
      editCount: Array.isArray(args.edits) ? args.edits.length : 0,
      form: typeof args.diff === 'string' ? 'unified-diff' : 'structured-edits',
    };
  }
  if (name === 'submit_candidate') {
    const rationale = typeof args.rationale === 'string' ? args.rationale : '';
    return {
      candidateId: typeof args.id === 'string' ? args.id : '[invalid]',
      rationaleHash: digest(rationale),
      rationaleBytes: Buffer.byteLength(rationale, 'utf8'),
    };
  }
  return {};
}

function traceToolResult(
  name: string,
  result: { ok: boolean; kind?: string; exitCode?: number; message: string },
): string {
  return JSON.stringify({
    tool: name,
    ok: result.ok,
    kind: result.kind ?? null,
    exitCode: result.exitCode ?? null,
    messageHash: digest(result.message),
    messageBytes: Buffer.byteLength(result.message, 'utf8'),
  });
}

function worstCaseRequestUsd(messages: readonly ChatMessage[], price: ModelPrice): number {
  const requestBytes = Buffer.byteLength(JSON.stringify({
    messages,
    tools: REPAIR_TOOL_DEFINITIONS,
  }), 'utf8');
  const priced = (
    requestBytes * price.input +
    MAX_AGENT_OUTPUT_TOKENS * price.output
  ) / 1_000_000;
  return Math.max(
    MINIMUM_AGENT_TURN_RESERVATION_USD,
    Math.ceil(priced * 1_000_000) / 1_000_000,
  );
}

export async function runRepairAgent(ctx: RepairAgentContext): Promise<RepairAgentOutcome> {
  try {
    ctx.budget.reserveBranch();
  } catch (error) {
    return { status: 'gave-up', failureKind: 'budget', reason: publicRepairReason(error instanceof Error ? error.message : String(error)) };
  }
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
  const messages = initialMessages(ctx);
  let previousInvalid = '';
  let repeatedInvalid = 0;
  let previousFailureState = '';
  let repeatedFailureState = 0;
  const recordToolRequest = (toolCallId: string, toolName: string, args: unknown): void => {
    ctx.trace?.record({
      type: 'tool-request', stage: 'candidate', toolCallId, toolName,
      argumentSummary: traceToolArguments(toolName, args),
      ...(ctx.branchId === undefined ? {} : { childNodeId: ctx.branchId }),
    });
  };
  const recordToolResult = (toolCallId: string, toolName: string, result: RepairToolResult): void => {
    ctx.trace?.record({
      type: 'tool-result', stage: 'candidate', toolCallId, toolName,
      resultSummary: traceToolResult(toolName, result),
      ...(ctx.branchId === undefined ? {} : { childNodeId: ctx.branchId }),
    });
  };
  const executeRecordedTool = async (
    toolCallId: string,
    toolName: string,
    args: unknown,
  ): Promise<RepairToolResult> => {
    recordToolRequest(toolCallId, toolName, args);
    const result = await tools.execute(toolName, args);
    recordToolResult(toolCallId, toolName, result);
    return result;
  };
  const cancelledOutcome = (): RepairAgentOutcome => ({
    status: 'gave-up', failureKind: 'sandbox', reason: 'Repair branch was cancelled',
  });
  const reserveToolCall = (): RepairAgentOutcome | undefined => {
    try {
      ctx.budget.reserveToolCall();
      return undefined;
    } catch (error) {
      return {
        status: 'gave-up',
        failureKind: 'budget',
        reason: publicRepairReason(error instanceof Error ? error.message : String(error)),
      };
    }
  };
  const checkpointOutcome = (
    state: Readonly<RepairToolState>,
    rationale: string,
  ): RepairAgentOutcome => state.latestTest === undefined
    ? { status: 'gave-up', failureKind: 'invalid', reason: 'Checkpoint lacked test evidence' }
    : {
        status: 'checkpoint',
        candidate: {
          id: ctx.branchId ?? 'repair-checkpoint',
          rationale,
          diff: state.cumulativeDiff,
        },
        imageId: state.editableImageId,
        ...(state.lastNodeId === undefined ? {} : { nodeId: state.lastNodeId }),
        test: state.latestTest,
      };
  const submissionOutcome = (
    result: RepairToolResult,
    state: Readonly<RepairToolState>,
    failureReason = 'Candidate submission failed',
  ): RepairAgentOutcome => {
    if (!result.submitted || !result.candidate || !result.imageId) {
      return { status: 'gave-up', failureKind: result.kind ?? 'invalid', reason: failureReason };
    }
    if (!state.latestTest) {
      return { status: 'gave-up', failureKind: 'invalid', reason: 'Submission lacked test evidence' };
    }
    ctx.trace?.record({
      type: 'candidate-submitted', stage: 'candidate',
      candidateId: result.candidate.id, summary: result.candidate.rationale,
      ...(ctx.branchId === undefined ? {} : { childNodeId: ctx.branchId }),
    });
    return {
      status: 'submitted', candidate: result.candidate, imageId: result.imageId,
      ...(result.nodeId === undefined ? {} : { nodeId: result.nodeId }), test: state.latestTest,
    };
  };

  for (;;) {
    if (ctx.signal?.aborted) {
      return cancelledOutcome();
    }
    const routing = {
      failureClass: ctx.diagnosis.class,
      diagnosisConfidence: ctx.diagnosis.confidence,
      remainingInferenceBudgetUsd: Math.max(
        0,
        ctx.budget.limits.inferenceCostUsd - ctx.budget.snapshot().inferenceCostUsd,
      ),
    };
    const requestOptions = {
      maxTokens: MAX_AGENT_OUTPUT_TOKENS,
      temperature: 0.2,
      reasoningEffort: 'low' as const,
      tools: REPAIR_TOOL_DEFINITIONS,
      toolChoice: 'auto' as const,
      routing,
    };
    const response = await requestRepairModel({
      llm: ctx.llm, budget: ctx.budget, messages, options: requestOptions,
      worstCaseUsd: (price) => worstCaseRequestUsd(messages, price),
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
      ...(ctx.observeCapacity === undefined ? {} : { observeCapacity: ctx.observeCapacity }),
    });
    if (!response.ok) return response.outcome;
    const { reply } = response;
    const calls = reply.toolCalls ?? [];
    if (calls.length === 0 || (calls.length > 1 && calls.some(({ function: tool }) => MUTATING_TOOLS.has(tool.name)))) {
      const invalid = calls.length === 0 ? 'missing required tool call' : 'parallel mutating tool calls are forbidden';
      repeatedInvalid = previousInvalid === invalid ? repeatedInvalid + 1 : 1;
      previousInvalid = invalid;
      if (repeatedInvalid >= 2) return { status: 'gave-up', failureKind: 'invalid', reason: `Stopped after repeated ${invalid}` };
      messages.push({ role: 'user', content: invalid });
      continue;
    }
    messages.push({ role: 'assistant', content: null, toolCalls: calls });
    for (const call of calls) {
      let args: unknown;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        args = null;
      }
      const reservationFailure = reserveToolCall();
      if (reservationFailure !== undefined) return reservationFailure;
      let result: RepairToolResult;
      if (args === null) {
        result = { ok: false, kind: 'invalid', message: 'Tool arguments must be valid JSON' };
        recordToolRequest(call.id, call.function.name, args);
        recordToolResult(call.id, call.function.name, result);
      } else {
        result = await executeRecordedTool(call.id, call.function.name, args);
      }
      const toolMessage = publicRepairReason(JSON.stringify({ ok: result.ok, kind: result.kind, message: result.message, exitCode: result.exitCode }));
      messages.push({ role: 'tool', toolCallId: call.id, content: toolMessage });
      if (result.submitted && result.candidate && result.imageId) {
        return submissionOutcome(result, tools.state());
      }
      if (call.function.name === 'apply_patch' && result.ok && result.exitCode === 0) {
        if (ctx.signal?.aborted) return cancelledOutcome();
        const testReservationFailure = reserveToolCall();
        if (testReservationFailure !== undefined) return testReservationFailure;
        const automaticTest = await executeRecordedTool(
          `${call.id}-automatic-test`,
          'run_test',
          { commandId: 'diagnosed' },
        );
        if (ctx.signal?.aborted) return cancelledOutcome();
        const testedState = tools.state();
        if (!automaticTest.ok || automaticTest.exitCode === undefined || !testedState.latestTest) {
          return {
            status: 'gave-up',
            failureKind: automaticTest.kind ?? 'sandbox',
            reason: 'Automatic trusted test did not produce valid evidence',
          };
        }
        if (automaticTest.exitCode !== 0) {
          return checkpointOutcome(
            testedState,
            'Intermediate repair checkpoint after an automatic trusted failing test.',
          );
        }
        const submissionReservationFailure = reserveToolCall();
        if (submissionReservationFailure !== undefined) return submissionReservationFailure;
        const automaticSubmission = await executeRecordedTool(
          `${call.id}-automatic-submit`,
          'submit_candidate',
          {
            id: ctx.branchId ?? 'repair-candidate',
            rationale: 'Accepted repair patch passed the diagnosed trusted test.',
          },
        );
        return submissionOutcome(automaticSubmission, testedState, 'Automatic candidate submission failed');
      }
      const invalidFingerprint = result.ok ? '' : `${fingerprint(call)}:${result.kind ?? 'invalid'}`;
      repeatedInvalid = invalidFingerprint && invalidFingerprint === previousInvalid ? repeatedInvalid + 1 : invalidFingerprint ? 1 : 0;
      previousInvalid = invalidFingerprint;
      if (repeatedInvalid >= 2) return { status: 'gave-up', failureKind: result.kind ?? 'invalid', reason: 'Stopped after repeated identical invalid tool calls' };
      const state = tools.state();
      if (
        call.function.name === 'run_test' &&
        result.exitCode !== undefined &&
        result.exitCode !== 0 &&
        state.cumulativeDiff &&
        state.latestTest
      ) {
        return checkpointOutcome(state, 'Intermediate repair checkpoint after a trusted failing test.');
      }
      const executionFailed = result.exitCode !== undefined && result.exitCode !== 0;
      const failureState = result.ok && !executionFailed
        ? ''
        : `${state.cumulativeDiff}:${result.message}:${result.exitCode ?? 'none'}`;
      repeatedFailureState = failureState && failureState === previousFailureState ? repeatedFailureState + 1 : failureState ? 1 : 0;
      previousFailureState = failureState;
      if (repeatedFailureState >= 2) return { status: 'gave-up', failureKind: result.kind ?? 'sandbox', reason: 'Stopped after repeated repair state and failure' };
    }
  }
}
