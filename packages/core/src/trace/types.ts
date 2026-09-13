import type { CaseFile, StageName } from '../domain.js';

export const TRACE_SCHEMA_VERSION = 'sutura-trace-v1' as const;

export type TraceStage = StageName | 'run';

interface TraceEventBase {
  schemaVersion: typeof TRACE_SCHEMA_VERSION;
  runId: string;
  sequence: number;
  timestampMs: number;
  stage: TraceStage;
}

interface ModelEventFields {
  role: 'system' | 'user' | 'assistant';
  model: string;
  summary: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  latencyMs: number;
  costUsd: number;
  requestId: string | null;
}

export type TraceEvent =
  | TraceEventBase & { type: 'run-start'; summary: string }
  | TraceEventBase & ({
      type: 'model-request';
      promptHash: string;
      promptExcerpt: string;
    } & ModelEventFields)
  | TraceEventBase & ({ type: 'model-response' } & ModelEventFields)
  | TraceEventBase & {
      type: 'tool-request';
      toolCallId: string;
      toolName: string;
      argumentSummary: Readonly<Record<string, unknown>>;
      childNodeId?: string;
    }
  | TraceEventBase & {
      type: 'tool-result';
      toolCallId: string;
      toolName: string;
      resultSummary: string;
      childNodeId?: string;
    }
  | TraceEventBase & {
      type: 'sandbox-operation';
      operation: string;
      resultSummary: string;
      childNodeId?: string;
    }
  | TraceEventBase & {
      type: 'search-decision';
      summary: string;
      childNodeId?: string;
      parentNodeId?: string;
    }
  | TraceEventBase & {
      type: 'candidate-submitted';
      candidateId: string;
      summary: string;
      childNodeId?: string;
    }
  | TraceEventBase & {
      type: 'audit-result';
      approved: boolean;
      summary: string;
      childNodeId?: string;
    }
  | TraceEventBase & {
      type: 'counterfactual-result';
      alternativeId: string;
      intent: 'plausible' | 'shortcut';
      approved: boolean;
      gate: string;
      rule: string;
      summary: string;
      childNodeId?: string;
    }
  | TraceEventBase & { type: 'run-finish'; outcome: CaseFile['outcome'] };

export type TraceEventInput = TraceEvent extends infer Event
  ? Event extends TraceEvent
    ? Omit<Event, 'schemaVersion' | 'runId' | 'sequence' | 'timestampMs'>
    : never
  : never;
