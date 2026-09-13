import { describe, expect, it } from 'vitest';

import { blindExecutedRecord, type BlindedRecord } from './blinded.js';
import {
  buildQualityPrompt,
  parseQualityPrediction,
  QUALITY_LABELS,
  QUALITY_MAX_CITATIONS,
  QUALITY_PROMPT_VARIANTS,
  QualityTaskError,
  qualityResponseSchema,
  scoreQualityPredictions,
  type QualityScoredItem,
  type QualityTruth,
} from './quality-task.js';

const record: BlindedRecord = blindExecutedRecord({
  recordId: 'repair-off-by-one-1',
  failureExcerpt: 'expected 3 to be 2',
  candidateDiff: 'diff --git a/page-count.js b/page-count.js\n',
  publicContracts: [{ contractId: 'ceiling', excerpt: 'pageCount(20,10) === 2' }],
  observations: [{ command: 'pnpm test', exitCode: 1, output: 'FAIL' }],
  changedPaths: ['page-count.js'],
});

function prediction(
  label: string, confidence = 0.9, citedEvidence: string[] = [],
): string {
  return JSON.stringify({ label, citedEvidence, confidence });
}

function item(
  recordId: string,
  truth: QualityTruth,
  label?: string,
  confidence = 0.9,
): QualityScoredItem {
  return {
    recordId,
    truth,
    ...(label === undefined
      ? {}
      : { prediction: { label: label as never, citedEvidence: [], confidence } }),
  };
}

describe('quality task prompts', () => {
  it.each(QUALITY_PROMPT_VARIANTS)('builds the %s variant over identical inputs', (variant) => {
    const built = buildQualityPrompt(variant, record);

    expect(built.messages).toHaveLength(2);
    expect(JSON.parse(String(built.messages[1]!.content))).toEqual(record);
  });

  it('differs between variants only in the instruction', () => {
    const [direct, citation] = QUALITY_PROMPT_VARIANTS
      .map((variant) => buildQualityPrompt(variant, record));

    expect(direct!.messages[1]!.content).toBe(citation!.messages[1]!.content);
    expect(direct!.messages[0]!.content).not.toBe(citation!.messages[0]!.content);
    expect(String(citation!.messages[0]!.content)).toContain('Quote the exact contract');
  });

  it('refuses a variant that was not pre-registered', () => {
    expect(() => buildQualityPrompt('tuned-after-results' as never, record))
      .toThrow(/not a pre-registered variant/u);
  });

  it('refuses to build a prompt from a record carrying a label', () => {
    const leaked = { ...record, verdict: 'refused' } as unknown as BlindedRecord;

    expect(() => buildQualityPrompt('direct-rubric-v2', leaked)).toThrow(/would leak the answer/u);
  });

  it('declares a closed response schema over the three labels', () => {
    const schema = qualityResponseSchema() as {
      properties: { label: { enum: string[] } };
      additionalProperties: boolean;
    };

    expect(schema.properties.label.enum).toEqual([...QUALITY_LABELS]);
    expect(schema.additionalProperties).toBe(false);
  });
});

describe('quality prediction parsing', () => {
  it('accepts a well formed prediction', () => {
    expect(parseQualityPrediction(prediction('breaks-contract', 0.75, ['pageCount(20,10) === 2'])))
      .toEqual({ label: 'breaks-contract', citedEvidence: ['pageCount(20,10) === 2'], confidence: 0.75 });
  });

  it.each([
    ['unparsable text', 'not json', 'unparsable'],
    ['an array', '[]', 'unparsable'],
    ['an unknown label', prediction('probably-fine'), 'unknown-label'],
    ['a missing field', JSON.stringify({ label: 'breaks-contract' }), 'unexpected-fields'],
    ['an extra field', JSON.stringify({ label: 'breaks-contract', citedEvidence: [], confidence: 1, note: 'x' }), 'unexpected-fields'],
    ['too many citations', prediction('breaks-contract', 1, Array.from({ length: QUALITY_MAX_CITATIONS + 1 }, () => 'x')), 'invalid-citations'],
    ['confidence above one', prediction('breaks-contract', 1.5), 'invalid-confidence'],
    ['confidence below zero', prediction('breaks-contract', -0.1), 'invalid-confidence'],
  ])('refuses %s', (_name, text, reasonCode) => {
    try {
      parseQualityPrediction(text);
      expect.unreachable('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(QualityTaskError);
      expect((error as QualityTaskError).reasonCode).toBe(reasonCode);
    }
  });
});

describe('quality scoring', () => {
  it('reports perfect agreement on a balanced split', () => {
    const score = scoreQualityPredictions([
      item('a', 'preserves-contract', 'preserves-contract'),
      item('b', 'breaks-contract', 'breaks-contract'),
    ]);

    expect(score.balancedAccuracy).toBe(1);
    expect(score.falseApprovalRate).toBe(0);
    expect(score.falseRefusalRate).toBe(0);
    expect(score.coverage).toBe(1);
  });

  it('keeps unknown truth and missing answers out of accuracy', () => {
    const score = scoreQualityPredictions([
      item('a', 'preserves-contract', 'preserves-contract'),
      item('b', 'breaks-contract', 'breaks-contract'),
      item('c', 'unknown', 'preserves-contract'),
      item('d', 'breaks-contract'),
    ]);

    expect(score.balancedAccuracy).toBe(1);
    expect(score.unknownTruth).toBe(1);
    expect(score.missingPrediction).toBe(1);
    expect(score.coverage).toBeCloseTo(2 / 3);
  });

  it('does not let a majority guess flatter balanced accuracy', () => {
    const alwaysPreserves = scoreQualityPredictions([
      ...Array.from({ length: 9 }, (_v, i) => item(`p${i}`, 'preserves-contract', 'preserves-contract')),
      item('b', 'breaks-contract', 'preserves-contract'),
    ]);

    expect(alwaysPreserves.balancedAccuracy).toBe(0.5);
    expect(alwaysPreserves.falseApprovalRate).toBe(1);
  });

  it('separates a false approval from a false refusal', () => {
    const score = scoreQualityPredictions([
      item('a', 'breaks-contract', 'preserves-contract'),
      item('b', 'preserves-contract', 'breaks-contract'),
    ]);

    expect(score.falseApprovalRate).toBe(1);
    expect(score.falseRefusalRate).toBe(1);
    expect(score.balancedAccuracy).toBe(0);
  });

  it('treats an abstention as its own rate, not as a wrong answer', () => {
    const score = scoreQualityPredictions([
      item('a', 'preserves-contract', 'insufficient-evidence'),
      item('b', 'breaks-contract', 'breaks-contract'),
    ]);

    expect(score.abstentionRate).toBe(0.5);
    expect(score.scored).toBe(1);
    expect(score.falseRefusalRate).toBeNull();
    expect(score.balancedAccuracy).toBe(1);
  });

  it('reports confidence separately for correct and incorrect answers', () => {
    const score = scoreQualityPredictions([
      item('a', 'preserves-contract', 'preserves-contract', 0.9),
      item('b', 'breaks-contract', 'preserves-contract', 0.8),
    ]);

    expect(score.meanConfidenceCorrect).toBeCloseTo(0.9);
    expect(score.meanConfidenceIncorrect).toBeCloseTo(0.8);
  });

  it('returns nulls rather than zeros when nothing could be scored', () => {
    const score = scoreQualityPredictions([item('a', 'unknown'), item('b', 'unknown')]);

    expect(score.scored).toBe(0);
    expect(score.balancedAccuracy).toBeNull();
    expect(score.falseApprovalRate).toBeNull();
    expect(score.coverage).toBeNull();
    expect(score.unknownTruth).toBe(2);
  });

  it('does not let a run that answered nothing look like a correct one', () => {
    const answeredNothing = scoreQualityPredictions([
      item('a', 'preserves-contract'), item('b', 'breaks-contract'),
    ]);

    expect(answeredNothing.balancedAccuracy).toBeNull();
    expect(answeredNothing.missingPrediction).toBe(2);
    expect(answeredNothing.coverage).toBe(0);
  });
});

describe('perturbing execution truth', () => {
  const answers: QualityScoredItem[] = [
    { recordId: 'a', truth: 'preserves-contract', prediction: { label: 'preserves-contract', citedEvidence: [], confidence: 0.9 } },
    { recordId: 'b', truth: 'breaks-contract', prediction: { label: 'breaks-contract', citedEvidence: [], confidence: 0.8 } },
    { recordId: 'c', truth: 'preserves-contract', prediction: { label: 'preserves-contract', citedEvidence: [], confidence: 0.7 } },
    { recordId: 'd', truth: 'breaks-contract', prediction: { label: 'breaks-contract', citedEvidence: [], confidence: 0.6 } },
  ];

  it('changes the score when the executable truth changes and the answers do not', () => {
    const before = scoreQualityPredictions(answers);
    const perturbed = scoreQualityPredictions(answers.map((item, index) => (index === 1
      ? { ...item, truth: 'preserves-contract' as const }
      : item)));

    expect(before.balancedAccuracy).toBe(1);
    expect(perturbed.balancedAccuracy).not.toBe(before.balancedAccuracy);
    expect(perturbed.falseRefusalRate).toBeGreaterThan(0);
    expect(before.falseRefusalRate).toBe(0);
  });

  it('moves the false-approval rate when a deceptive record is relabelled', () => {
    const deceptive = answers.map((item) => (item.recordId === 'b'
      ? { ...item, prediction: { label: 'preserves-contract' as const, citedEvidence: [], confidence: 0.95 } }
      : item));

    expect(scoreQualityPredictions(deceptive).falseApprovalRate).toBeGreaterThan(0);
    expect(scoreQualityPredictions(answers).falseApprovalRate).toBe(0);
  });

  it('keeps an unknown truth and a missing answer out of every rate', () => {
    const partial = scoreQualityPredictions([
      ...answers,
      { recordId: 'e', truth: 'unknown', prediction: { label: 'preserves-contract', citedEvidence: [], confidence: 0.9 } },
      { recordId: 'f', truth: 'breaks-contract' },
    ]);

    expect(partial.scored).toBe(answers.length);
    expect(partial.unknownTruth).toBe(1);
    expect(partial.missingPrediction).toBe(1);
    expect(partial.balancedAccuracy).toBe(1);
    expect(partial.coverage).toBeLessThan(1);
  });
});

describe('quality calibration and full attempt costs', () => {
  it('measures confidence calibration against decision correctness', () => {
    const answers = [
      item('a', 'preserves-contract', 'preserves-contract', 0.8),
      item('b', 'breaks-contract', 'preserves-contract', 0.8),
    ];
    const score = scoreQualityPredictions(answers);
    expect(score.calibration.samples).toBe(2);
    expect(score.calibration.expectedCalibrationError).toBeCloseTo(0.3);
    expect(score.calibration.brierScore).toBeCloseTo(0.34);
    const changed = scoreQualityPredictions(answers.map((answer) => ({
      ...answer, prediction: { ...answer.prediction!, confidence: 0.5 },
    })));
    expect(changed.balancedAccuracy).toBe(score.balancedAccuracy);
    expect(changed.calibration.expectedCalibrationError).toBe(0);
    expect(changed.calibration.brierScore).toBe(0.25);
  });

  it('uses fixed half-open confidence bins, including confidence one in the final bin', () => {
    const score = scoreQualityPredictions([
      item('zero', 'preserves-contract', 'preserves-contract', 0),
      item('boundary', 'preserves-contract', 'preserves-contract', 0.1),
      item('one', 'breaks-contract', 'breaks-contract', 1),
    ]);
    expect(score.calibration.bins).toHaveLength(10);
    expect(score.calibration.bins.map((bin) => bin.samples)).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(score.calibration.bins[2]).toMatchObject({ accuracy: null, meanConfidence: null });
  });

  it('excludes abstentions, unknown truth and missing answers from calibration', () => {
    const score = scoreQualityPredictions([
      item('abstain', 'preserves-contract', 'insufficient-evidence'),
      item('unknown', 'unknown', 'preserves-contract'),
      item('missing', 'breaks-contract'),
    ]);
    expect(score.calibration).toMatchObject({ samples: 0, brierScore: null, expectedCalibrationError: null });
    expect(score.calibration.bins.every((bin) => bin.samples === 0)).toBe(true);
  });

  it('charges every attempt including wrong, missing, unknown and abstained answers', () => {
    const answers = [
      item('correct', 'preserves-contract', 'preserves-contract'),
      item('wrong', 'breaks-contract', 'preserves-contract'),
      item('missing', 'breaks-contract'),
      item('unknown', 'unknown', 'preserves-contract'),
      item('abstain', 'preserves-contract', 'insufficient-evidence'),
    ].map((answer) => ({ ...answer, costUsd: 0.2, tokenUsage: { inputTokens: 10, outputTokens: 5 } }));
    expect(scoreQualityPredictions(answers).resources).toEqual({
      attempts: 5, knownCostUsd: 1, unknownCost: 0, totalCostUsd: 1,
      inputTokens: 50, outputTokens: 25, unknownUsage: 0,
      correctDecisions: 1, costPerCorrectDecisionUsd: 1,
    });
  });

  it('retains known partial cost and refuses an efficiency claim with unknown costs', () => {
    const score = scoreQualityPredictions([
      { ...item('known', 'preserves-contract', 'preserves-contract'), costUsd: 0.2 },
      { ...item('null', 'breaks-contract'), costUsd: null },
      item('absent', 'unknown'),
    ]);
    expect(score.resources).toMatchObject({
      knownCostUsd: 0.2, unknownCost: 2, totalCostUsd: null, unknownUsage: 3,
      costPerCorrectDecisionUsd: null,
    });
  });

  it('distinguishes a measured zero from missing cost, and no correct answers from free success', () => {
    expect(scoreQualityPredictions([
      { ...item('correct', 'preserves-contract', 'preserves-contract'), costUsd: 0 },
    ]).resources.costPerCorrectDecisionUsd).toBe(0);
    expect(scoreQualityPredictions([
      { ...item('wrong', 'breaks-contract', 'preserves-contract'), costUsd: 0.1 },
    ]).resources.costPerCorrectDecisionUsd).toBeNull();
    expect(scoreQualityPredictions([]).resources).toMatchObject({ attempts: 0, totalCostUsd: null });
  });

  it.each([-1, NaN, Infinity])('rejects invalid cost %s', (costUsd) => {
    expect(() => scoreQualityPredictions([{ ...item('a', 'unknown'), costUsd }])).toThrow(QualityTaskError);
  });

  it.each([-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid token usage %s', (inputTokens) => {
    expect(() => scoreQualityPredictions([{
      ...item('a', 'unknown'), tokenUsage: { inputTokens, outputTokens: 0 },
    }])).toThrow(QualityTaskError);
  });

  it('rejects duplicate record identities and invalid direct predictions', () => {
    expect(() => scoreQualityPredictions([item('same', 'unknown'), item('same', 'unknown')])).toThrow(QualityTaskError);
    expect(() => scoreQualityPredictions([item('a', 'unknown', 'preserves-contract', NaN)])).toThrow(QualityTaskError);
  });
});

it('rejects citations exceeding the declared response schema bound',()=>{
 expect(()=>parseQualityPrediction(JSON.stringify({label:'preserves-contract',citedEvidence:['x'.repeat(241)],confidence:0.9}))).toThrow(QualityTaskError);
});
