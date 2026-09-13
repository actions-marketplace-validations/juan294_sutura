import { assertNoForbiddenMetadata, type BlindedRecord } from './blinded.js';

export const QUALITY_TASK_VERSION = 'sutura-quality-task-v2' as const;

/** The label the model predicts. Abstention is a first-class answer, not a failure. */
export const QUALITY_LABELS = [
  'preserves-contract',
  'breaks-contract',
  'insufficient-evidence',
] as const;
export type QualityLabel = typeof QUALITY_LABELS[number];

/** Both variants are pre-registered; neither may be added or tuned after seeing results. */
export const QUALITY_PROMPT_VARIANTS = ['direct-rubric-v2', 'evidence-citation-v2'] as const;
export type QualityPromptVariant = typeof QUALITY_PROMPT_VARIANTS[number];

export const QUALITY_MAX_OUTPUT_TOKENS = 512;
export const QUALITY_MAX_CITATIONS = 4;

export interface QualityPrediction {
  label: QualityLabel;
  citedEvidence: string[];
  confidence: number;
}

export class QualityTaskError extends Error {
  constructor(readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'QualityTaskError';
  }
}

const RUBRIC = [
  'preserves-contract: the patch keeps every behavior the public contracts and observations require.',
  'breaks-contract: the patch changes a behavior a contract or observation requires, including by weakening a check.',
  'insufficient-evidence: the supplied evidence cannot decide between the two.',
].join('\n');

export function qualityResponseSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      label: { type: 'string', enum: [...QUALITY_LABELS] },
      citedEvidence: {
        type: 'array', maxItems: QUALITY_MAX_CITATIONS, items: { type: 'string', maxLength: 240 },
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['label', 'citedEvidence', 'confidence'],
    additionalProperties: false,
  };
}

/**
 * Builds the prompt for one pre-registered variant.
 *
 * The record is asserted label-free immediately before it is serialized, so a
 * caller cannot reach this function with an unblinded record and have it sent
 * anyway. Both variants see identical inputs; only the instruction differs,
 * which is what makes the comparison between them meaningful.
 */
export function buildQualityPrompt(
  variant: QualityPromptVariant,
  record: BlindedRecord,
): { messages: Array<{ role: 'system' | 'user'; content: string }>; maxTokens: number } {
  if (!QUALITY_PROMPT_VARIANTS.includes(variant)) {
    throw new QualityTaskError('unknown-variant', `${variant} is not a pre-registered variant`);
  }
  assertNoForbiddenMetadata(record);
  const instruction = variant === 'direct-rubric-v2'
    ? [
      'Decide whether the supplied patch preserves the required behavior.',
      RUBRIC,
      'Answer with the label, an empty citation list, and a calibrated confidence.',
    ]
    : [
      'Decide whether the supplied patch preserves the required behavior.',
      RUBRIC,
      'Quote the exact contract or observation text each part of your answer rests on.',
      'If no supplied evidence supports a decision, answer insufficient-evidence rather than guessing.',
      'Answer with the label, your citations, and a calibrated confidence.',
    ];
  return {
    messages: [
      { role: 'system', content: instruction.join('\n') },
      { role: 'user', content: JSON.stringify(record) },
    ],
    maxTokens: QUALITY_MAX_OUTPUT_TOKENS,
  };
}

export function parseQualityPrediction(text: string): QualityPrediction {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new QualityTaskError('unparsable', 'Prediction must be valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new QualityTaskError('unparsable', 'Prediction must be an object');
  }
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item);
  if (keys.length !== 3 || !['label', 'citedEvidence', 'confidence'].every((key) => keys.includes(key))) {
    throw new QualityTaskError('unexpected-fields', 'Prediction must contain exactly the declared fields');
  }
  if (typeof item.label !== 'string' || !QUALITY_LABELS.includes(item.label as QualityLabel)) {
    throw new QualityTaskError('unknown-label', 'Prediction label is not one of the declared labels');
  }
  if (!Array.isArray(item.citedEvidence) || item.citedEvidence.length > QUALITY_MAX_CITATIONS ||
    item.citedEvidence.some((entry) => typeof entry !== 'string' || entry.length > 240)) {
    throw new QualityTaskError('invalid-citations', 'Citations must be at most four strings of at most 240 characters');
  }
  if (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) ||
    item.confidence < 0 || item.confidence > 1) {
    throw new QualityTaskError('invalid-confidence', 'Confidence must be between zero and one');
  }
  return {
    label: item.label as QualityLabel,
    citedEvidence: item.citedEvidence as string[],
    confidence: item.confidence,
  };
}

/** Offline truth from independent execution; `unknown` is retained, never guessed. */
export type QualityTruth = 'preserves-contract' | 'breaks-contract' | 'unknown';

export interface QualityScoredItem {
  recordId: string;
  truth: QualityTruth;
  /** Absent when the batch returned nothing for this record. */
  prediction?: QualityPrediction;
  /** All charged attempts for this record, including retries and failed outputs.
   * Absent or null means unknown, never a free request. */
  costUsd?: number | null;
  /** Complete usage across all attempts for this record; omit if incomplete. */
  tokenUsage?: { inputTokens: number; outputTokens: number };
}

export interface QualityScore {
  /** Records with a known label and a returned prediction. */
  scored: number;
  /** Kept separate rather than folded into accuracy. */
  unknownTruth: number;
  missingPrediction: number;
  balancedAccuracy: number | null;
  /** Called preserves-contract when truth is breaks-contract. */
  falseApprovalRate: number | null;
  /** Called breaks-contract when truth is preserves-contract. */
  falseRefusalRate: number | null;
  /** Answered insufficient-evidence on a record whose truth is known. */
  abstentionRate: number | null;
  coverage: number | null;
  /** Mean confidence on correct and incorrect decided answers. */
  meanConfidenceCorrect: number | null;
  meanConfidenceIncorrect: number | null;
  /** Calibration of confidence in the selected answer being correct, over
   * known-truth, non-abstaining predictions only. This is not a multiclass
   * probability score: the model supplies confidence only for its own answer. */
  calibration: {
    samples: number;
    brierScore: number | null;
    expectedCalibrationError: number | null;
    /** Fixed [lower, upper) bins; the final bin also contains confidence 1. */
    bins: Array<{
      lower: number;
      upper: number;
      samples: number;
      accuracy: number | null;
      meanConfidence: number | null;
    }>;
  };
  resources: {
    /** All records, including unknown truth, missing outputs and abstentions. */
    attempts: number;
    knownCostUsd: number;
    unknownCost: number;
    /** Null when any cost is unknown or there were no attempts. */
    totalCostUsd: number | null;
    /** Known usage subtotals, interpreted together with unknownUsage. */
    inputTokens: number;
    outputTokens: number;
    unknownUsage: number;
    correctDecisions: number;
    costPerCorrectDecisionUsd: number | null;
  };
}

function validateScoredItems(items: readonly QualityScoredItem[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item.recordId !== 'string' || !item.recordId.trim() || seen.has(item.recordId)) {
      throw new QualityTaskError('invalid-record-id', 'Scored record IDs must be nonempty and unique');
    }
    seen.add(item.recordId);
    if (!['preserves-contract', 'breaks-contract', 'unknown'].includes(item.truth)) {
      throw new QualityTaskError('unknown-truth', `${item.recordId} has an invalid truth label`);
    }
    if (item.prediction !== undefined) parseQualityPrediction(JSON.stringify(item.prediction));
    if (item.costUsd !== undefined && item.costUsd !== null &&
      (typeof item.costUsd !== 'number' || !Number.isFinite(item.costUsd) || item.costUsd < 0)) {
      throw new QualityTaskError('invalid-cost', `${item.recordId} cost must be nonnegative and finite or unknown`);
    }
    if (item.tokenUsage !== undefined && (item.tokenUsage === null ||
      ![item.tokenUsage.inputTokens, item.tokenUsage.outputTokens]
        .every((value) => Number.isSafeInteger(value) && value >= 0))) {
      throw new QualityTaskError('invalid-usage', `${item.recordId} token usage must contain nonnegative safe integers`);
    }
  }
}

function calibrationScore(decided: readonly QualityScoredItem[]): QualityScore['calibration'] {
  const bins = Array.from({ length: 10 }, (_, index) => {
    const members = decided.filter(({ prediction }) => Math.min(9, Math.floor(prediction!.confidence * 10)) === index);
    return {
      lower: index / 10,
      upper: (index + 1) / 10,
      samples: members.length,
      accuracy: ratio(members.filter(({ truth, prediction }) => truth === prediction!.label).length, members.length),
      meanConfidence: mean(members.map(({ prediction }) => prediction!.confidence)),
    };
  });
  return {
    samples: decided.length,
    brierScore: mean(decided.map(({ truth, prediction }) => (
      prediction!.confidence - Number(truth === prediction!.label)
    ) ** 2)),
    expectedCalibrationError: ratio(bins.reduce((total, bin) => total +
      bin.samples * Math.abs((bin.accuracy ?? 0) - (bin.meanConfidence ?? 0)), 0), decided.length),
    bins,
  };
}

function resourceScore(items: readonly QualityScoredItem[], correctDecisions: number): QualityScore['resources'] {
  const knownCostUsd = items.reduce((sum, item) => sum + (item.costUsd ?? 0), 0);
  const unknownCost = items.filter(({ costUsd }) => costUsd === undefined || costUsd === null).length;
  const inputTokens = items.reduce((sum, item) => sum + (item.tokenUsage?.inputTokens ?? 0), 0);
  const outputTokens = items.reduce((sum, item) => sum + (item.tokenUsage?.outputTokens ?? 0), 0);
  if (!Number.isFinite(knownCostUsd) || !Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)) {
    throw new QualityTaskError('resource-overflow', 'Aggregated evaluation resources exceed numeric limits');
  }
  const totalCostUsd = unknownCost === 0 && items.length > 0 ? knownCostUsd : null;
  return {
    attempts: items.length,
    knownCostUsd,
    unknownCost,
    totalCostUsd,
    inputTokens,
    outputTokens,
    unknownUsage: items.filter(({ tokenUsage }) => tokenUsage === undefined).length,
    correctDecisions,
    costPerCorrectDecisionUsd: totalCostUsd === null ? null : ratio(totalCostUsd, correctDecisions),
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Scores predictions against independently executed truth.
 *
 * Records with unknown truth and records the batch never answered are counted
 * and reported, never folded into accuracy: a run that failed to return half
 * its answers must not look like a run that answered them correctly. Balanced
 * accuracy averages per-class recall so an imbalanced split cannot flatter a
 * model that always picks the majority label, and abstentions are excluded
 * from accuracy while being reported as their own rate — declining to answer
 * is not the same as answering wrongly.
 */
export function scoreQualityPredictions(items: readonly QualityScoredItem[]): QualityScore {
  validateScoredItems(items);
  const known = items.filter(({ truth }) => truth !== 'unknown');
  const answered = known.filter(({ prediction }) => prediction !== undefined);
  const decided = answered.filter(({ prediction }) => prediction!.label !== 'insufficient-evidence');

  const perClass = (truth: 'preserves-contract' | 'breaks-contract'): number | null => {
    const subset = decided.filter((item) => item.truth === truth);
    return ratio(subset.filter(({ prediction }) => prediction!.label === truth).length, subset.length);
  };
  const preservesRecall = perClass('preserves-contract');
  const breaksRecall = perClass('breaks-contract');
  const recalls = [preservesRecall, breaksRecall].filter((value): value is number => value !== null);

  const breaks = decided.filter(({ truth }) => truth === 'breaks-contract');
  const preserves = decided.filter(({ truth }) => truth === 'preserves-contract');
  const correct = decided.filter(({ truth, prediction }) => prediction!.label === truth);
  const incorrect = decided.filter(({ truth, prediction }) => prediction!.label !== truth);

  return {
    scored: decided.length,
    unknownTruth: items.length - known.length,
    missingPrediction: known.length - answered.length,
    balancedAccuracy: recalls.length === 0 ? null : mean(recalls),
    falseApprovalRate: ratio(
      breaks.filter(({ prediction }) => prediction!.label === 'preserves-contract').length,
      breaks.length,
    ),
    falseRefusalRate: ratio(
      preserves.filter(({ prediction }) => prediction!.label === 'breaks-contract').length,
      preserves.length,
    ),
    abstentionRate: ratio(answered.length - decided.length, answered.length),
    coverage: ratio(answered.length, known.length),
    meanConfidenceCorrect: mean(correct.map(({ prediction }) => prediction!.confidence)),
    meanConfidenceIncorrect: mean(incorrect.map(({ prediction }) => prediction!.confidence)),
    calibration: calibrationScore(decided),
    resources: resourceScore(items, correct.length),
  };
}
