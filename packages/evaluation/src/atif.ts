import type { TraceEvent } from '@sutura/core';

import {
  ATIF_SCHEMA_VERSION,
  type AtifCaseExport,
  type AtifStep,
  type EvaluationCase,
  type EvaluationManifest,
} from './schema.js';
import { validateEvaluationManifest } from './validate.js';

function timestamp(offsetMs: number): string {
  return new Date(offsetMs).toISOString();
}

function lineage(childNodeId: string | undefined) {
  return childNodeId === undefined ? undefined : { sutura: { child_node_id: childNodeId } };
}

function systemStep(event: TraceEvent, message: string): Omit<AtifStep, 'step_id'> {
  return {
    timestamp: timestamp(event.timestampMs),
    source: 'system',
    message,
    extra: { sutura: { event_type: event.type, sequence: event.sequence } },
  };
}

function steps(events: readonly TraceEvent[]): AtifStep[] {
  const toolResults = new Map(events.flatMap((event) =>
    event.type === 'tool-result' ? [[event.toolCallId, event] as const] : []));
  const mapped = events.flatMap((event): Array<Omit<AtifStep, 'step_id'>> => {
    if (event.type === 'model-request') {
      return [{
        timestamp: timestamp(event.timestampMs),
        source: 'user',
        message: event.summary,
        extra: { sutura: { event_type: event.type, sequence: event.sequence } },
      }];
    }
    if (event.type === 'model-response') {
      return [{
        timestamp: timestamp(event.timestampMs),
        source: 'agent',
        model_name: event.model,
        message: event.summary,
        metrics: {
          prompt_tokens: event.inputTokens,
          completion_tokens: event.outputTokens + event.reasoningTokens,
          cost_usd: event.costUsd,
          extra: {
            reasoning_tokens: event.reasoningTokens,
            latency_ms: event.latencyMs,
            request_id: event.requestId === null ? null : '[request-id]',
          },
        },
        llm_call_count: 1,
      }];
    }
    if (event.type === 'tool-request') {
      const result = toolResults.get(event.toolCallId);
      const toolLineage = lineage(event.childNodeId);
      const resultLineage = lineage(result?.childNodeId);
      return [{
        timestamp: timestamp(event.timestampMs),
        source: 'agent',
        message: '',
        tool_calls: [{
          tool_call_id: event.toolCallId,
          function_name: event.toolName,
          arguments: { ...event.argumentSummary },
          ...(toolLineage === undefined ? {} : { extra: toolLineage }),
        }],
        ...(result === undefined ? {} : {
          observation: {
            results: [{
              source_call_id: event.toolCallId,
              content: result.resultSummary,
              ...(resultLineage === undefined ? {} : { extra: resultLineage }),
            }],
          },
        }),
        llm_call_count: 0,
      }];
    }
    if (event.type === 'tool-result') return [];
    if (event.type === 'run-start') return [systemStep(event, event.summary)];
    if (event.type === 'run-finish') return [systemStep(event, `outcome: ${event.outcome}`)];
    if (event.type === 'search-decision') return [systemStep(event, event.summary)];
    if (event.type === 'candidate-submitted') return [systemStep(event, event.summary)];
    if (event.type === 'audit-result') return [systemStep(event, event.summary)];
    if (event.type === 'counterfactual-result') {
      return [{
        timestamp: timestamp(event.timestampMs),
        source: 'system',
        message: event.summary,
        extra: {
          sutura: {
            event_type: event.type,
            sequence: event.sequence,
            alternative_id: event.alternativeId,
            intent: event.intent,
            approved: event.approved,
            ...(event.gate === '' ? {} : { rejected_by: { gate: event.gate, rule: event.rule } }),
          },
        },
      }];
    }
    return [systemStep(event, `${event.operation}: ${event.resultSummary}`)];
  });
  return mapped.map((step, index) => ({ step_id: index + 1, ...step }));
}

function trajectory(value: EvaluationManifest, item: EvaluationCase): AtifCaseExport {
  const model = item.trace.find((event) => event.type === 'model-response');
  const runId = item.trace[0]!.runId;
  return {
    caseId: item.caseId,
    trajectory: {
      schema_version: ATIF_SCHEMA_VERSION,
      session_id: runId,
      trajectory_id: runId,
      agent: {
        name: 'Sutura',
        version: value.adapterVersion,
        ...(model?.type === 'model-response' ? { model_name: model.model } : {}),
      },
      steps: steps(item.trace),
      notes: 'Sanitized Sutura evaluation trajectory. Hidden reasoning and full source are excluded.',
      extra: {
        evaluation_id: value.evaluationId,
        case_id: item.caseId,
        outcome: item.outcome,
      },
    },
  };
}

export function exportAtif(value: EvaluationManifest): AtifCaseExport[] {
  const manifest = validateEvaluationManifest(value);
  return manifest.cases.map((item) => trajectory(manifest, item));
}
