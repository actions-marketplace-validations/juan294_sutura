import { describe, expect, it } from 'vitest';

import type { VerificationContract } from './contracts.js';
import { deriveExpectation, evaluateAgainstContract } from './expectation.js';

const ceiling: VerificationContract = {
  id: 'page-count-ceiling',
  kind: 'ceiling-division',
  target: { adapter: 'javascript', path: 'page-count.js', export: 'pageCount' },
  maxItems: 1_000,
  maxDivisor: 100,
};

const exact: VerificationContract = {
  id: 'page-count-examples',
  kind: 'exact',
  target: { adapter: 'javascript', path: 'page-count.js', export: 'pageCount' },
  examples: [{ args: [20, 10], expected: 2 }],
};

const strict: VerificationContract = {
  id: 'strict-enabled',
  kind: 'json-property',
  target: { adapter: 'json', path: 'tsconfig.json' },
  property: ['compilerOptions', 'strict'],
  expected: true,
};

describe('controller-derived expectations', () => {
  it('derives the pagination expectations from the contract, not from a proposal', () => {
    expect(deriveExpectation(ceiling, [21, 10])).toEqual({ ok: true, expected: 3 });
    expect(deriveExpectation(ceiling, [1, 10])).toEqual({ ok: true, expected: 1 });
    expect(deriveExpectation(ceiling, [20, 10])).toEqual({ ok: true, expected: 2 });
  });

  it('cannot be overridden by a fabricated expectation carried alongside a valid citation', () => {
    // A proposal claiming (21,10) -> 2 with a perfectly valid contract citation.
    const fabricated = 2;
    const derived = deriveExpectation(ceiling, [21, 10]);

    expect(derived).toEqual({ ok: true, expected: 3 });
    expect(derived.ok && derived.expected).not.toBe(fabricated);
    expect(evaluateAgainstContract(ceiling, [21, 10], 'equals', fabricated))
      .toEqual({ status: 'failed', reasonCode: 'assertion-mismatch' });
  });

  it('rejects the floor-only pagination patch and preserves the correct one', () => {
    // floor(21/10)+1 = 3 agrees at this input, but floor(1/10)+1 = 1 and ceil(1/10) = 1 too,
    // so the discriminating input is an exact boundary: floor(20/10)+1 = 3 while ceil = 2.
    const floorOnly = (items: number, divisor: number): number =>
      Math.floor(items / divisor) + 1;
    const correct = (items: number, divisor: number): number => Math.ceil(items / divisor);

    expect(evaluateAgainstContract(ceiling, [20, 10], 'equals', floorOnly(20, 10)))
      .toEqual({ status: 'failed', reasonCode: 'assertion-mismatch' });
    expect(evaluateAgainstContract(ceiling, [20, 10], 'equals', correct(20, 10)))
      .toEqual({ status: 'passed' });
    for (const [items, divisor] of [[21, 10], [1, 10], [0, 10]]) {
      expect(evaluateAgainstContract(ceiling, [items!, divisor!], 'equals', correct(items!, divisor!)))
        .toEqual({ status: 'passed' });
    }
  });

  it('abstains for an input outside the declared domain', () => {
    expect(deriveExpectation(ceiling, [2_000, 10]))
      .toMatchObject({ ok: false, reasonCode: 'input-outside-declared-domain' });
    expect(deriveExpectation(ceiling, [20, 0]))
      .toMatchObject({ ok: false, reasonCode: 'input-outside-declared-domain' });
    expect(deriveExpectation(ceiling, [20]))
      .toMatchObject({ ok: false, reasonCode: 'input-outside-declared-domain' });
    expect(deriveExpectation(ceiling, [1.5, 10]))
      .toMatchObject({ ok: false, reasonCode: 'input-outside-declared-domain' });
  });

  it('abstains when an example table declares nothing for these inputs', () => {
    expect(deriveExpectation(exact, [20, 10])).toEqual({ ok: true, expected: 2 });
    expect(deriveExpectation(exact, [21, 10]))
      .toMatchObject({ ok: false, reasonCode: 'no-declared-example' });
  });

  it('serves the strict configuration contract through the JSON property adapter', () => {
    expect(deriveExpectation(strict, [])).toEqual({ ok: true, expected: true });
    expect(evaluateAgainstContract(strict, [], 'is-true', true)).toEqual({ status: 'passed' });
    expect(evaluateAgainstContract(strict, [], 'is-true', false))
      .toEqual({ status: 'failed', reasonCode: 'assertion-mismatch' });
    expect(deriveExpectation(strict, [1]))
      .toMatchObject({ ok: false, reasonCode: 'input-outside-declared-domain' });
  });

  it('abstains rather than guessing for an unsupported contract kind', () => {
    const prose = { id: 'prose', kind: 'described-in-readme' } as unknown as VerificationContract;

    expect(deriveExpectation(prose, [1]))
      .toMatchObject({ ok: false, reasonCode: 'unsupported-contract-kind' });
    expect(evaluateAgainstContract(prose, [1], 'equals', 1))
      .toEqual({ status: 'insufficient', reasonCode: 'unsupported-contract-kind' });
  });

  it('abstains on an unsupported relation rather than treating it as a pass', () => {
    expect(evaluateAgainstContract(ceiling, [20, 10], 'roughly' as never, 2))
      .toEqual({ status: 'insufficient', reasonCode: 'unsupported-relation' });
  });

  it('never turns a missing expectation into a pass', () => {
    const outOfDomain = evaluateAgainstContract(ceiling, [5_000, 10], 'equals', 500);

    expect(outOfDomain.status).toBe('insufficient');
    expect(outOfDomain.status).not.toBe('passed');
  });

  it.each([
    ['not-equals', 3, false],
    ['not-equals', 4, true],
    ['greater-than', 4, true],
    ['greater-than', 2, false],
    ['less-than', 2, true],
  ] as const)('evaluates %s against the derived value', (relation, observed, passes) => {
    expect(evaluateAgainstContract(ceiling, [21, 10], relation, observed).status)
      .toBe(passes ? 'passed' : 'failed');
  });
});

describe('remaining limitation of declarative probes', () => {
  /**
   * A patch can be written to satisfy exactly the inputs a challenge names.
   * Controller-owned expectations stop a candidate from asserting its own
   * correctness; they do not stop it from being right only where it is looked
   * at. This is the documented limit of the approach, not a defect in it.
   */
  it('a test-aware patch passes the named inputs and fails a held-out one', () => {
    const named: Array<[number, number]> = [[20, 10], [21, 10]];
    const heldOut: [number, number] = [7, 4];
    const testAware = (items: number, divisor: number): number => {
      const match = named.find(([a, b]) => a === items && b === divisor);
      return match ? Math.ceil(items / divisor) : Math.floor(items / divisor);
    };

    for (const [items, divisor] of named) {
      expect(evaluateAgainstContract(ceiling, [items, divisor], 'equals', testAware(items, divisor)))
        .toEqual({ status: 'passed' });
    }
    expect(evaluateAgainstContract(ceiling, heldOut, 'equals', testAware(...heldOut)))
      .toEqual({ status: 'failed', reasonCode: 'assertion-mismatch' });
  });
});
