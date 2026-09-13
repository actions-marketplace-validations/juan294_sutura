/**
 * Dataset validation, paired batch preparation and the join back to scoring
 * keys.
 *
 * These are the checks that keep a quality measurement describing the
 * experiment that was pre-registered: no record counted twice, no root family
 * across two splits, no unlicensed source, no answer travelling with its own
 * question, and no missing output quietly scored correct.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { blindExecutedRecord, type ExecutedRecord } from './blinded.js';
import {
  assertRecordMatchesSourceHash,
  DatasetError,
  joinBatchOutputs,
  preparePairedBatch,
  validateEvaluationDataset,
  type DatasetEntry,
} from './dataset.js';
import { QUALITY_PROMPT_VARIANTS } from './quality-task.js';

function executed(overrides: Partial<ExecutedRecord> = {}): ExecutedRecord {
  return {
    recordId: 'case-a',
    failureExcerpt: 'expected 3, received 2',
    candidateDiff: '--- a/page.js\n+++ b/page.js\n@@ -1 +1 @@\n-floor\n+ceil\n',
    publicContracts: [{ contractId: 'page-count', excerpt: 'pages = ceil(items / size)' }],
    observations: [{ command: 'pnpm test', exitCode: 0, output: '1 passed' }],
    changedPaths: ['page.js'],
    ...overrides,
  };
}

function entry(overrides: Partial<DatasetEntry> = {}): DatasetEntry {
  return {
    customId: 'case-a',
    record: blindExecutedRecord(executed()),
    split: 'development',
    rootFamily: 'pagination',
    provenance: { source: 'placebo corpus', license: 'MIT', revision: '0.2' },
    scoringKey: { truth: 'preserves-contract', oracleRevision: 'oracle-v1' },
    ...overrides,
  };
}

function reasonOf(run: () => unknown): string {
  try {
    run();
    return 'accepted';
  } catch (error) {
    expect(error).toBeInstanceOf(DatasetError);
    return (error as DatasetError).reasonCode;
  }
}

describe('dataset validation', () => {
  it('accepts a dataset and reports its split counts and a stable hash', () => {
    const dataset = validateEvaluationDataset([
      entry(),
      entry({ customId: 'case-b', rootFamily: 'await', split: 'validation' }),
    ]);

    expect(dataset.counts).toEqual({ development: 1, validation: 1, 'held-out': 0 });
    expect(dataset.datasetHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(validateEvaluationDataset([
      entry({ customId: 'case-b', rootFamily: 'await', split: 'validation' }),
      entry(),
    ]).datasetHash).toBe(dataset.datasetHash);
  });

  it('refuses a duplicate record and a family that spans two splits', () => {
    expect(reasonOf(() => validateEvaluationDataset([entry(), entry()])))
      .toBe('duplicate-record');
    expect(reasonOf(() => validateEvaluationDataset([
      entry(),
      entry({ customId: 'case-b', split: 'held-out' }),
    ]))).toBe('split-family-overlap');
  });

  it('refuses a missing licence, source, revision or scoring key', () => {
    for (const field of ['source', 'license', 'revision'] as const) {
      expect(reasonOf(() => validateEvaluationDataset([entry({
        provenance: { ...entry().provenance, [field]: '  ' },
      })]))).toBe('missing-provenance');
    }
    expect(reasonOf(() => validateEvaluationDataset([entry({
      scoringKey: undefined as unknown as DatasetEntry['scoringKey'],
    })]))).toBe('missing-scoring-key');
  });

  it('refuses an empty dataset, an unbounded custom id and an unknown split', () => {
    expect(reasonOf(() => validateEvaluationDataset([]))).toBe('empty-dataset');
    expect(reasonOf(() => validateEvaluationDataset([entry({ customId: 'Case A' })])))
      .toBe('invalid-custom-id');
    expect(reasonOf(() => validateEvaluationDataset([entry({
      split: 'holdout' as DatasetEntry['split'],
    })]))).toBe('invalid-split');
  });

  it('refuses a record whose bytes no longer match its registered hash', () => {
    const registered = entry();

    expect(() => assertRecordMatchesSourceHash(registered, JSON.stringify(executed()))).not.toThrow();
    expect(reasonOf(() => assertRecordMatchesSourceHash(
      registered, JSON.stringify(executed({ candidateDiff: 'something else' })),
    ))).toBe('source-hash-mismatch');
  });

  it('refuses a record carrying a label anywhere inside it', () => {
    const leaked = entry();
    (leaked.record as unknown as Record<string, unknown>).observations = [
      { command: 'pnpm test', exitCode: 0, output: 'ok', verdict: 'approved' },
    ];

    expect(() => validateEvaluationDataset([leaked])).toThrow(/leak/u);
  });
});

describe('paired batch preparation', () => {
  const dataset = validateEvaluationDataset([
    entry(),
    entry({
      customId: 'case-b', rootFamily: 'await', split: 'validation',
      scoringKey: { truth: 'breaks-contract', oracleRevision: 'oracle-v1' },
    }),
  ]);

  it('sends byte-identical inputs to both pre-registered variants', () => {
    const batch = preparePairedBatch({ dataset, model: 'nemotron-verified' });

    expect(batch.requests).toHaveLength(dataset.entries.length * QUALITY_PROMPT_VARIANTS.length);
    for (const { customId } of dataset.entries) {
      const pair = batch.requests.filter((request) => request.customId.startsWith(`${customId}.`));
      expect(pair).toHaveLength(2);
      expect(pair[0]!.messages[1]).toEqual(pair[1]!.messages[1]);
      expect(pair[0]!.messages[0]).not.toEqual(pair[1]!.messages[0]);
    }
    expect(new Set(batch.requests.map(({ maxTokens }) => maxTokens))).toEqual(new Set([512]));
  });

  it('names each request after its dataset entry so outputs join exactly', () => {
    const batch = preparePairedBatch({ dataset, model: 'nemotron-verified' });

    expect(batch.requests.map(({ customId }) => customId).sort()).toEqual([
      'case-a.direct-rubric-v2', 'case-a.evidence-citation-v2',
      'case-b.direct-rubric-v2', 'case-b.evidence-citation-v2',
    ]);
    expect(batch.customIds).toEqual(['case-a', 'case-b']);
  });

  it('never places a scoring key in a request', () => {
    const batch = preparePairedBatch({ dataset, model: 'nemotron-verified' });
    const sent = JSON.stringify(batch.requests.map(({ messages }) => messages[1]));

    // The instruction names the label vocabulary on purpose; the record must not.
    expect(sent).not.toContain('oracle-v1');
    expect(sent).not.toContain('breaks-contract');
    expect(sent).not.toContain('scoringKey');
    expect(JSON.stringify(batch.requests)).not.toContain('oracle-v1');
  });

  it('prepares one split at a time and refuses an empty selection or an unnamed model', () => {
    expect(preparePairedBatch({ dataset, model: 'm', split: 'validation' }).customIds)
      .toEqual(['case-b']);
    expect(reasonOf(() => preparePairedBatch({ dataset, model: 'm', split: 'held-out' })))
      .toBe('empty-selection');
    expect(reasonOf(() => preparePairedBatch({ dataset, model: '  ' }))).toBe('missing-model');
  });

  it('changes its hash when the model or an input changes', () => {
    const base = preparePairedBatch({ dataset, model: 'nemotron-verified' });

    expect(preparePairedBatch({ dataset, model: 'nemotron-other' }).batchHash)
      .not.toBe(base.batchHash);
    expect(preparePairedBatch({ dataset, model: 'nemotron-verified' }).batchHash)
      .toBe(base.batchHash);
  });
});

describe('joining outputs back to scoring keys', () => {
  const dataset = validateEvaluationDataset([
    entry(),
    entry({
      customId: 'case-b', rootFamily: 'await', split: 'development',
      scoringKey: { truth: 'breaks-contract', oracleRevision: 'oracle-v1' },
    }),
  ]);

  it('joins by exact custom id and leaves a missing output missing', () => {
    const joined = joinBatchOutputs({
      dataset, variant: 'direct-rubric-v2',
      outputs: [{ customId: 'case-a.direct-rubric-v2', text: '{"label":"preserves-contract"}' }],
    });

    expect(joined).toHaveLength(2);
    expect(joined[0]).toMatchObject({ customId: 'case-a', truth: 'preserves-contract' });
    expect(joined[0]!.text).toBeDefined();
    // The absent answer stays absent rather than becoming a correct one.
    expect(joined[1]).toEqual({ customId: 'case-b', truth: 'breaks-contract' });
  });

  it('ignores the other variant and refuses a duplicate or unknown output', () => {
    expect(joinBatchOutputs({
      dataset, variant: 'direct-rubric-v2',
      outputs: [{ customId: 'case-a.evidence-citation-v2', text: 'x' }],
    }).every(({ text }) => text === undefined)).toBe(true);

    expect(reasonOf(() => joinBatchOutputs({
      dataset, variant: 'direct-rubric-v2',
      outputs: [
        { customId: 'case-a.direct-rubric-v2', text: 'x' },
        { customId: 'case-a.direct-rubric-v2', text: 'y' },
      ],
    }))).toBe('duplicate-output');

    expect(reasonOf(() => joinBatchOutputs({
      dataset, variant: 'direct-rubric-v2',
      outputs: [{ customId: 'case-z.direct-rubric-v2', text: 'x' }],
    }))).toBe('unknown-output');
  });

  it('never lets the fixture kind reach the prompt, only the lineage hash', () => {
    const plain = validateEvaluationDataset([entry()]);
    const relabelled = validateEvaluationDataset([entry({
      record: blindExecutedRecord(executed({ kind: 'trap' } as Partial<ExecutedRecord>)),
    })]);
    /** The record the model reads, without the opaque lineage hash. */
    const content = (built: ReturnType<typeof preparePairedBatch>): unknown => {
      const { sourceHash, ...rest } = JSON.parse(
        String(built.requests[0]!.messages[1]!.content),
      ) as Record<string, unknown>;
      expect(sourceHash).toMatch(/^[a-f0-9]{64}$/u);
      return rest;
    };

    expect(JSON.stringify(preparePairedBatch({ dataset: relabelled, model: 'm' }).requests))
      .not.toContain('trap');
    // The lineage hash differs because it identifies the source record; nothing
    // a reader or a model could decode the kind from does.
    expect(content(preparePairedBatch({ dataset: relabelled, model: 'm' })))
      .toEqual(content(preparePairedBatch({ dataset: plain, model: 'm' })));
    expect(createHash('sha256').update(JSON.stringify(relabelled.entries[0]!.record)).digest('hex'))
      .not.toBe(createHash('sha256').update(JSON.stringify(plain.entries[0]!.record)).digest('hex'));
  });
});
