import { BudgetExceededError } from '../engine/repair-budget.js';
import type { Diagnosis, FailureClass } from '../domain.js';
import { extractJson } from '../llm/json.js';
import type { TierLlm } from '../llm/types.js';
import { redactExternalMessages } from '../security/external-text.js';
import { FAILURE_TAXONOMY } from '../taxonomy.js';
import { boundedTail } from '../text/bounded-tail.js';

const FAILURE_CLASSES = Object.freeze(
  Object.keys(FAILURE_TAXONOMY) as FailureClass[],
);
const MAX_LOG_LINES = 200;
const MAX_LOG_CHARACTERS = 20_000;
const MAX_LOG_BYTES = 20_000;

export type DiagnosisLlm = TierLlm<'nano'>;

export type MechanicalDiagnosis = Omit<Diagnosis, 'grounding'>;

export class ClassificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClassificationError';
  }
}

function finalLines(log: string, count: number): string {
  return boundedTail(log, {
    maxLines: count,
    maxCharacters: MAX_LOG_CHARACTERS,
    maxBytes: MAX_LOG_BYTES,
  });
}

function githubLogPayload(line: string): string {
  const finalField = line.slice(line.lastIndexOf('\t') + 1).trim();
  return finalField
    .replace(/^\d{4}-\d{2}-\d{2}T\S+Z\s+/, '')
    .replace(/^##\[(?:group|endgroup)\]/, '')
    .trim();
}

function failingCommand(log: string): string {
  const lines = log.split(/\r?\n/);
  let command = '';

  for (let index = 0; index < lines.length; index += 1) {
    const line = githubLogPayload(lines[index] ?? '');
    const runMatch = /^(?:Run|\$)\s+(\S.*)$/.exec(line);
    if (runMatch?.[1]) {
      command = runMatch[1].trim();
      continue;
    }

    const scriptHeader = /^>\s+(\S+)\s+(?:typecheck|lint|test|build)(?:\s+\S+)?$/.exec(line);
    const packageToken = scriptHeader?.[1] ?? '';
    const packageAt = packageToken.indexOf('@', 1);
    if (packageAt > 0 && packageAt < packageToken.length - 1) {
      const nextLine = lines
        .slice(index + 1)
        .map(githubLogPayload)
        .find(Boolean);
      const nestedCommand = /^>\s+(\S.*)$/.exec(nextLine ?? '');
      if (nestedCommand?.[1]) {
        command = nestedCommand[1].trim();
      }
    }
  }

  return command || 'unknown';
}

function bestTaxonomyMatch(log: string): {
  failureClass: FailureClass;
  matched: string[];
} {
  let bestClass: FailureClass = 'infra';
  let bestMatches: string[] = [];

  for (const failureClass of FAILURE_CLASSES) {
    const matched = FAILURE_TAXONOMY[failureClass].signatures
      .filter((signature) => signature.test(log))
      .map((signature) => signature.source);
    if (matched.length > bestMatches.length) {
      bestClass = failureClass;
      bestMatches = matched;
    }
  }

  return { failureClass: bestClass, matched: bestMatches };
}

export function classifyMechanically(logExcerpt: string): MechanicalDiagnosis {
  const boundedLog = finalLines(logExcerpt, MAX_LOG_LINES);
  const { failureClass, matched } = bestTaxonomyMatch(boundedLog);

  return {
    class: failureClass,
    confidence: matched.length === 0 ? 0 : Math.min(0.95, 0.65 + matched.length * 0.1),
    signals: [
      `mechanical:${failureClass}`,
      ...matched.map((signature) => `signature:${signature}`),
    ],
    failingCmd: failingCommand(boundedLog),
    errorExcerpt: finalLines(boundedLog, 20).trim(),
  };
}

function taxonomyPrompt(): string {
  const taxonomy = Object.fromEntries(
    FAILURE_CLASSES.map((failureClass) => [
      failureClass,
      {
        signatures: FAILURE_TAXONOMY[failureClass].signatures.map(
          (signature) => signature.source,
        ),
        repairable: FAILURE_TAXONOMY[failureClass].repairable,
        notes: FAILURE_TAXONOMY[failureClass].notes,
      },
    ]),
  );

  return [
    'Classify the CI failure using only this public taxonomy.',
    'Return one JSON object with class, confidence, signals, failingCmd, and errorExcerpt.',
    'confidence must be from 0 to 1. Do not include hidden reasoning.',
    JSON.stringify(taxonomy),
  ].join('\n');
}

const PUBLIC_TAXONOMY_PROMPT = taxonomyPrompt();

function validateDiagnosis(value: unknown): Diagnosis {
  if (typeof value !== 'object' || value === null) {
    throw new Error('diagnosis must be an object');
  }

  const candidate = value as Record<string, unknown>;
  if (!FAILURE_CLASSES.includes(candidate.class as FailureClass)) {
    throw new Error('class is not in the public failure taxonomy');
  }
  if (
    typeof candidate.confidence !== 'number' ||
    !Number.isFinite(candidate.confidence) ||
    candidate.confidence < 0 ||
    candidate.confidence > 1
  ) {
    throw new Error('confidence must be a number from 0 to 1');
  }
  if (
    !Array.isArray(candidate.signals) ||
    !candidate.signals.every((signal) => typeof signal === 'string')
  ) {
    throw new Error('signals must be an array of strings');
  }
  if (typeof candidate.failingCmd !== 'string' || !candidate.failingCmd.trim()) {
    throw new Error('failingCmd must be a non-empty string');
  }
  if (typeof candidate.errorExcerpt !== 'string' || !candidate.errorExcerpt.trim()) {
    throw new Error('errorExcerpt must be a non-empty string');
  }

  return {
    class: candidate.class as FailureClass,
    confidence: candidate.confidence,
    signals: candidate.signals,
    failingCmd: candidate.failingCmd,
    errorExcerpt: candidate.errorExcerpt,
  };
}

export async function classify(
  llm: DiagnosisLlm,
  logExcerpt: string,
): Promise<Diagnosis> {
  const boundedLog = finalLines(logExcerpt, MAX_LOG_LINES);
  const mechanical = classifyMechanically(boundedLog);
  if (mechanical.failingCmd === 'unknown') {
    throw new ClassificationError(
      'CI log does not contain an observed failing command',
    );
  }
  const messages = redactExternalMessages([
    { role: 'system' as const, content: PUBLIC_TAXONOMY_PROMPT },
    { role: 'user' as const, content: boundedLog },
  ]);
  const options = {
    maxTokens: 2_048,
    temperature: 0,
    responseFormat: { type: 'json_object' as const },
    routing: {
      failureClass: mechanical.class,
      diagnosisConfidence: mechanical.confidence,
      remainingInferenceBudgetUsd: Number.MAX_SAFE_INTEGER,
    },
  };
  let reply: { text: string };

  try {
    reply = await llm.chat('nano', messages, options);
  } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
    throw new ClassificationError('Diagnosis model request failed');
  }

  let model: Diagnosis;
  try {
    model = await extractJson(reply, validateDiagnosis, async (repairPrompt) =>
      llm.chat(
        'nano',
        redactExternalMessages([
          ...messages,
          { role: 'assistant' as const, content: reply.text },
          { role: 'user' as const, content: repairPrompt },
        ]),
        options,
      ),
    );
  } catch (error) {
    if (error instanceof Error && error.cause instanceof BudgetExceededError) throw error.cause;
    if (error instanceof BudgetExceededError) throw error;
    throw new ClassificationError('Diagnosis model returned an invalid response');
  }
  const classAgrees = mechanical.class === model.class;
  const commandAgrees = mechanical.failingCmd === model.failingCmd;
  const agrees = classAgrees && commandAgrees;
  return {
    ...model,
    confidence: agrees ? model.confidence : Math.min(model.confidence, 0.49),
    failingCmd: mechanical.failingCmd,
    signals: Array.from(
      new Set([
        ...model.signals,
        ...mechanical.signals,
        ...(classAgrees ? [] : [`llm:${model.class}`]),
        ...(commandAgrees ? [] : ['llm-command-mismatch']),
      ]),
    ),
  };
}
