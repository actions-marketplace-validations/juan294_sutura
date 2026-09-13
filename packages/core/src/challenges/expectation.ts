import { canonicalJson } from '../replay/canonical-json.js';
import type { TypedValue, VerificationContract } from './contracts.js';

export type ExpectationReasonCode =
  | 'input-outside-declared-domain'
  | 'no-declared-example'
  | 'unsupported-contract-kind'
  | 'unsupported-relation';

export type DerivedExpectation =
  | { ok: true; expected: TypedValue }
  | { ok: false; reasonCode: ExpectationReasonCode; detail: string };

function abstain(reasonCode: ExpectationReasonCode, detail: string): DerivedExpectation {
  return { ok: false, reasonCode, detail };
}

function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= minimum && value <= maximum;
}

/**
 * Computes the expected value for a set of inputs from the operator-trusted
 * contract alone.
 *
 * Nothing a model proposes contributes to the result. A valid citation, a
 * matching source hash and a confident rationale are all evidence that a
 * proposal is well formed; none of them is authority over what the answer is.
 * An input outside the contract's declared domain, an example table with no
 * matching row, and a contract kind the controller cannot compute all abstain
 * rather than guess.
 */
export function deriveExpectation(
  contract: VerificationContract,
  inputs: readonly TypedValue[],
): DerivedExpectation {
  switch (contract.kind) {
    case 'ceiling-division': {
      const [items, divisor] = inputs;
      if (inputs.length !== 2 ||
        !integerInRange(items, 0, contract.maxItems) ||
        !integerInRange(divisor, 1, contract.maxDivisor)) {
        return abstain(
          'input-outside-declared-domain',
          `ceiling-division accepts 0..${contract.maxItems} over 1..${contract.maxDivisor}`,
        );
      }
      return { ok: true, expected: Math.ceil(items / divisor) };
    }
    case 'cardinality': {
      const [items] = inputs;
      if (inputs.length !== 1 || !integerInRange(items, 0, contract.maxItems)) {
        return abstain('input-outside-declared-domain', `cardinality accepts 0..${contract.maxItems}`);
      }
      return { ok: true, expected: items };
    }
    case 'exact': {
      const match = contract.examples.find(
        ({ args }) => canonicalJson(args) === canonicalJson([...inputs]),
      );
      return match === undefined
        ? abstain('no-declared-example', 'the contract declares no example for these inputs')
        : { ok: true, expected: match.expected };
    }
    case 'json-property':
      return inputs.length === 0
        ? { ok: true, expected: contract.expected }
        : abstain('input-outside-declared-domain', 'json-property takes no inputs');
    case 'codec-round-trip': {
      const [value] = inputs;
      if (inputs.length !== 1 ||
        !contract.examples.some((example) => canonicalJson(example) === canonicalJson(value))) {
        return abstain('no-declared-example', 'the contract declares no round-trip example for this value');
      }
      return { ok: true, expected: value as TypedValue };
    }
    default:
      return abstain('unsupported-contract-kind', 'the controller cannot compute this contract');
  }
}

export type ChallengeRelation =
  | 'equals' | 'not-equals' | 'greater-than' | 'less-than' | 'is-true' | 'is-false';

export type ObservationVerdict =
  | { status: 'passed' }
  | { status: 'failed'; reasonCode: 'assertion-mismatch' }
  | { status: 'insufficient'; reasonCode: ExpectationReasonCode };

/**
 * Compares an observation against the controller-derived expectation.
 *
 * Only this comparison can produce `passed`. A candidate influences the
 * observed value and nothing else: it cannot set the relation, the expectation
 * or the verdict.
 */
export function evaluateAgainstContract(
  contract: VerificationContract,
  inputs: readonly TypedValue[],
  relation: ChallengeRelation,
  observed: TypedValue,
): ObservationVerdict {
  const derived = deriveExpectation(contract, inputs);
  if (!derived.ok) return { status: 'insufficient', reasonCode: derived.reasonCode };
  const expected = derived.expected;
  const held = (() => {
    switch (relation) {
      case 'equals':
        return canonicalJson(observed) === canonicalJson(expected);
      case 'not-equals':
        return canonicalJson(observed) !== canonicalJson(expected);
      case 'greater-than':
        return typeof observed === 'number' && typeof expected === 'number' && observed > expected;
      case 'less-than':
        return typeof observed === 'number' && typeof expected === 'number' && observed < expected;
      case 'is-true':
        return observed === true;
      case 'is-false':
        return observed === false;
      default:
        return undefined;
    }
  })();
  if (held === undefined) return { status: 'insufficient', reasonCode: 'unsupported-relation' };
  return held ? { status: 'passed' } : { status: 'failed', reasonCode: 'assertion-mismatch' };
}
