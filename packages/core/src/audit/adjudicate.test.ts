import { describe, expect, it } from 'vitest';

import { BudgetExceededError, RepairBudget } from '../engine/repair-budget.js';
import type { Diagnosis } from '../domain.js';
import { SECOND_OPINION_MODEL } from '../llm/openai.js';
import { adjudicate, secondOpinion } from './adjudicate.js';

const DIAGNOSIS: Diagnosis = {
  class: 'test-assertion',
  confidence: 0.9,
  signals: ['assertion'],
  failingCmd: 'pnpm test',
  errorExcerpt: 'expected 1 to be 2',
};

const CONTEXT = {
  diagnosis: DIAGNOSIS,
  diff: 'diff --git a/add.ts b/add.ts\n',
  beforeLog: 'AssertionError',
  afterLog: 'Tests passed',
};

describe('adjudicate', () => {
  it.each([
    ['approved', { reasoning: 'The patch fixes the diagnosed assertion.' }],
    ['reasoning', { approved: true }],
  ])('refuses an Ultra reply without required field %s', async (_field, reply) => {
    const result = await adjudicate({
      async chat() {
        return { text: JSON.stringify(reply) };
      },
    }, CONTEXT);
    expect(result).toEqual({
      approved: false,
      reasoning: expect.stringContaining('REFUSED'),
    });
  });
});

describe('secondOpinion', () => {
  it('reports skipped when unconfigured, without calling any llm', async () => {
    const result = await secondOpinion(undefined, CONTEXT);
    expect(result).toEqual({
      status: 'skipped',
      reasoning: expect.stringContaining('OPENAI_API_KEY'),
      model: SECOND_OPINION_MODEL,
    });
  });

  it('reports approved when Astra approves', async () => {
    const result = await secondOpinion({
      async chat() {
        return { text: '{"approved":true,"reasoning":"Fixes the diagnosed cause."}' };
      },
    }, CONTEXT);
    expect(result).toEqual({
      status: 'approved',
      reasoning: 'Fixes the diagnosed cause.',
      model: SECOND_OPINION_MODEL,
    });
  });

  it('reports refused when Astra refuses', async () => {
    const result = await secondOpinion({
      async chat() {
        return { text: '{"approved":false,"reasoning":"Weakens an assertion."}' };
      },
    }, CONTEXT);
    expect(result).toEqual({
      status: 'refused',
      reasoning: 'Weakens an assertion.',
      model: SECOND_OPINION_MODEL,
    });
  });

  it('fails open to skipped on a transport error, never throwing', async () => {
    const result = await secondOpinion({
      async chat() {
        throw new Error('ECONNRESET');
      },
    }, CONTEXT);
    expect(result.status).toBe('skipped');
    expect(result.model).toBe(SECOND_OPINION_MODEL);
  });

  it('fails open to skipped on an invalid reply, never throwing', async () => {
    const result = await secondOpinion({
      async chat() {
        return { text: 'not json' };
      },
    }, CONTEXT);
    expect(result.status).toBe('skipped');
  });

  it('fails open to skipped when the second-opinion budget is exhausted, never calling the llm', async () => {
    let called = false;
    const budget = {
      reserveSecondOpinion() {
        throw new BudgetExceededError('secondOpinionUsd');
      },
      settleSecondOpinion() {},
    };
    const result = await secondOpinion({
      async chat() {
        called = true;
        return { text: '{"approved":true,"reasoning":"unused"}' };
      },
    }, CONTEXT, budget);
    expect(result).toEqual({
      status: 'skipped',
      reasoning: expect.stringContaining('second-opinion budget exhausted'),
      model: SECOND_OPINION_MODEL,
    });
    expect(called).toBe(false);
  });

  it('reserves against a real default RepairBudget for a typical-size call without skipping', async () => {
    const budget = new RepairBudget();
    const result = await secondOpinion({
      async chat() {
        return { text: '{"approved":true,"reasoning":"ok"}', usd: 0.04 };
      },
    }, CONTEXT, budget);
    expect(result.status).toBe('approved');
    expect(budget.snapshot().secondOpinionUsd).toBeCloseTo(0.04, 10);
  });

  it('settles the reservation with the actual reported cost', async () => {
    const settled: Array<{ id: number; actualUsd: number }> = [];
    const budget = {
      reserveSecondOpinion(worstCaseUsd: number) {
        return { id: 1, reservedUsd: worstCaseUsd };
      },
      settleSecondOpinion(reservation: { id: number }, actualUsd: number) {
        settled.push({ id: reservation.id, actualUsd });
      },
    };
    const result = await secondOpinion({
      async chat() {
        return { text: '{"approved":true,"reasoning":"ok"}', usd: 0.01 };
      },
    }, CONTEXT, budget);
    expect(result.status).toBe('approved');
    expect(settled).toEqual([{ id: 1, actualUsd: 0.01 }]);
  });
});
