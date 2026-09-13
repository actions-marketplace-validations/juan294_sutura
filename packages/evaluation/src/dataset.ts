import { createHash } from 'node:crypto';

import { assertNoForbiddenMetadata, type BlindedLabel, type BlindedRecord } from './blinded.js';
import type { EvaluationSplit } from './blinded.js';
import {
  buildQualityPrompt,
  QUALITY_MAX_OUTPUT_TOKENS,
  QUALITY_PROMPT_VARIANTS,
  qualityResponseSchema,
  type QualityPromptVariant,
} from './quality-task.js';

export const DATASET_SCHEMA_VERSION = 'sutura-quality-dataset-v2' as const;
export const PAIRED_BATCH_SCHEMA_VERSION = 'sutura-quality-paired-batch-v1' as const;

export class DatasetError extends Error {
  constructor(readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'DatasetError';
  }
}

function refuse(reasonCode: string, message: string): never {
  throw new DatasetError(reasonCode, message);
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * One dataset entry: what the model sees, what it came from, and the key that
 * scores it. The key is deliberately a sibling of the record rather than a
 * field inside it, so nothing that scores an answer can travel with the
 * question.
 */
export interface DatasetEntry {
  customId: string;
  record: BlindedRecord;
  split: EvaluationSplit;
  rootFamily: string;
  /** Where the case came from, and under what licence its bytes may be used. */
  provenance: { source: string; license: string; revision: string };
  scoringKey: { truth: BlindedLabel; oracleRevision: string };
}

export interface ValidatedDataset {
  schemaVersion: typeof DATASET_SCHEMA_VERSION;
  entries: DatasetEntry[];
  datasetHash: string;
  counts: Record<EvaluationSplit, number>;
}

const SPLITS: EvaluationSplit[] = ['development', 'validation', 'held-out'];

/**
 * Validates a quality dataset before anything is prepared from it.
 *
 * The checks here are the ones that would otherwise turn a measurement into a
 * different measurement without anyone noticing: a record counted twice, a
 * root family that appears in two splits, a record whose bytes no longer match
 * the hash they were registered under, and a record with no stated source or
 * licence.
 */
export function validateEvaluationDataset(entries: readonly DatasetEntry[]): ValidatedDataset {
  if (entries.length === 0) refuse('empty-dataset', 'A dataset needs at least one entry');
  const seenIds = new Set<string>();
  const splitByFamily = new Map<string, EvaluationSplit>();
  const counts: Record<EvaluationSplit, number> = { development: 0, validation: 0, 'held-out': 0 };

  for (const entry of entries) {
    if (typeof entry.customId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(entry.customId)) {
      refuse('invalid-custom-id', `Custom id ${String(entry.customId)} is not a bounded identifier`);
    }
    if (seenIds.has(entry.customId)) {
      refuse('duplicate-record', `Custom id ${entry.customId} appears more than once`);
    }
    seenIds.add(entry.customId);
    if (!SPLITS.includes(entry.split)) refuse('invalid-split', `${entry.customId} names an unknown split`);
    if (typeof entry.rootFamily !== 'string' || !entry.rootFamily.trim()) {
      refuse('missing-family', `${entry.customId} declares no root family`);
    }
    const assigned = splitByFamily.get(entry.rootFamily);
    if (assigned !== undefined && assigned !== entry.split) {
      refuse(
        'split-family-overlap',
        `Root family ${entry.rootFamily} appears in both ${assigned} and ${entry.split}`,
      );
    }
    splitByFamily.set(entry.rootFamily, entry.split);

    const { source, license, revision } = entry.provenance ?? {};
    if (!source?.trim() || !license?.trim() || !revision?.trim()) {
      refuse('missing-provenance', `${entry.customId} needs a source, a licence and a revision`);
    }
    if (entry.scoringKey === undefined || typeof entry.scoringKey.truth !== 'string' ||
      !entry.scoringKey.oracleRevision?.trim()) {
      refuse('missing-scoring-key', `${entry.customId} has no scoring key`);
    }
    // The record must still be the bytes it was registered under.
    const { sourceHash, ...content } = entry.record;
    if (!/^[a-f0-9]{64}$/u.test(sourceHash)) {
      refuse('invalid-source-hash', `${entry.customId} carries no source hash`);
    }
    assertNoForbiddenMetadata(content, entry.customId);
    counts[entry.split] += 1;
  }

  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    entries: [...entries].sort((left, right) => left.customId.localeCompare(right.customId)),
    datasetHash: digest(JSON.stringify(
      [...entries].sort((left, right) => left.customId.localeCompare(right.customId))
        .map(({ customId, record, split }) => [customId, record.sourceHash, split]),
    )),
    counts,
  };
}

/**
 * Confirms a record's bytes still hash to what the dataset registered.
 *
 * A record that was edited after registration would be scored against a key
 * derived from different bytes, so the mismatch is refused rather than
 * reconciled.
 */
export function assertRecordMatchesSourceHash(entry: DatasetEntry, executedRecordJson: string): void {
  if (digest(executedRecordJson) !== entry.record.sourceHash) {
    refuse('source-hash-mismatch', `${entry.customId} no longer matches its registered source`);
  }
}

export interface PairedBatchRequest {
  customId: string;
  variant: QualityPromptVariant;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  maxTokens: number;
}

export interface PairedBatch {
  schemaVersion: typeof PAIRED_BATCH_SCHEMA_VERSION;
  model: string;
  responseSchema: Record<string, unknown>;
  requests: PairedBatchRequest[];
  /** Exactly the custom ids the scoring keys join on, in dataset order. */
  customIds: string[];
  batchHash: string;
}

/**
 * Prepares, but never sends, the paired batch for both pre-registered prompt
 * variants.
 *
 * Both variants receive byte-identical inputs, so the only difference between
 * the two arms is the instruction. Nothing that scores an answer is placed in
 * a request, and the custom id of each request names its dataset entry
 * exactly, so outputs join back without a heuristic.
 */
export function preparePairedBatch(input: {
  dataset: ValidatedDataset;
  model: string;
  split?: EvaluationSplit;
}): PairedBatch {
  if (!input.model.trim()) refuse('missing-model', 'A paired batch names one verified model');
  const entries = input.split === undefined
    ? input.dataset.entries
    : input.dataset.entries.filter(({ split }) => split === input.split);
  if (entries.length === 0) refuse('empty-selection', 'The selected split holds no entries');

  const requests: PairedBatchRequest[] = [];
  for (const entry of entries) {
    const built = QUALITY_PROMPT_VARIANTS.map((variant) => ({
      variant, prompt: buildQualityPrompt(variant, entry.record),
    }));
    const [first, second] = built;
    if (JSON.stringify(first!.prompt.messages[1]) !== JSON.stringify(second!.prompt.messages[1])) {
      refuse('variant-input-drift', `${entry.customId} would send different inputs to the two variants`);
    }
    for (const { variant, prompt } of built) {
      // The instruction names the label vocabulary on purpose; the record must
      // not carry anything that identifies this record's own answer.
      const sent = JSON.stringify(prompt.messages[1]);
      if (sent.includes(entry.scoringKey.oracleRevision) || sent.includes('scoringKey')) {
        refuse('scoring-key-leak', `${entry.customId} would send its own answer to the model`);
      }
      requests.push({
        customId: `${entry.customId}.${variant}`,
        variant,
        messages: prompt.messages,
        maxTokens: Math.min(prompt.maxTokens, QUALITY_MAX_OUTPUT_TOKENS),
      });
    }
  }

  return {
    schemaVersion: PAIRED_BATCH_SCHEMA_VERSION,
    model: input.model,
    responseSchema: qualityResponseSchema(),
    requests,
    customIds: entries.map(({ customId }) => customId),
    batchHash: digest(JSON.stringify({ model: input.model, requests })),
  };
}

/**
 * Joins batch outputs back onto their scoring keys by exact custom id.
 *
 * A missing output stays missing. Nothing absent is scored, because an answer
 * that never arrived is not a correct one, and counting it either way would
 * describe a run that did not happen.
 */
export function joinBatchOutputs(input: {
  dataset: ValidatedDataset;
  variant: QualityPromptVariant;
  outputs: ReadonlyArray<{ customId: string; text: string }>;
}): Array<{ customId: string; truth: BlindedLabel; text?: string }> {
  const byId = new Map<string, string>();
  for (const output of input.outputs) {
    const suffix = `.${input.variant}`;
    if (!output.customId.endsWith(suffix)) continue;
    const id = output.customId.slice(0, -suffix.length);
    if (byId.has(id)) refuse('duplicate-output', `${output.customId} was returned more than once`);
    byId.set(id, output.text);
  }
  for (const id of byId.keys()) {
    if (!input.dataset.entries.some((entry) => entry.customId === id)) {
      refuse('unknown-output', `${id} is not a dataset entry`);
    }
  }
  return input.dataset.entries.map((entry) => {
    const text = byId.get(entry.customId);
    return {
      customId: entry.customId,
      truth: entry.scoringKey.truth,
      ...(text === undefined ? {} : { text }),
    };
  });
}
