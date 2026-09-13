import { Buffer } from 'node:buffer';

import { parseUnifiedDiff } from '../diff/unified.js';
import {
  COUNTERFACTUAL_INTENTS,
  MAX_COUNTERFACTUAL_ALTERNATIVES,
  MAX_COUNTERFACTUAL_DIFF_BYTES,
  MIN_COUNTERFACTUAL_ALTERNATIVES,
  type CounterfactualAlternative,
  type CounterfactualIntent,
} from './types.js';

const ALTERNATIVE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const MAX_RATIONALE_CHARACTERS = 240;

export class CounterfactualValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CounterfactualValidationError';
  }
}

function refuse(message: string): never {
  throw new CounterfactualValidationError(message);
}

function alternative(value: unknown, index: number): CounterfactualAlternative {
  const name = `alternatives[${index}]`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    refuse(`${name} must be an object`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!['id', 'intent', 'rationale', 'diff'].includes(key)) {
      refuse(`${name} has an unsupported field: ${key}`);
    }
  }
  const { id, intent, rationale, diff } = record;
  if (typeof id !== 'string' || !ALTERNATIVE_ID.test(id)) {
    refuse(`${name}.id must match ${ALTERNATIVE_ID.source}`);
  }
  if (typeof intent !== 'string' || !COUNTERFACTUAL_INTENTS.includes(intent as CounterfactualIntent)) {
    refuse(`${name}.intent must be one of ${COUNTERFACTUAL_INTENTS.join(', ')}`);
  }
  if (typeof rationale !== 'string' || !rationale.trim()) {
    refuse(`${name}.rationale must be a non-empty string`);
  }
  if (rationale.length > MAX_RATIONALE_CHARACTERS) {
    refuse(`${name}.rationale must be at most ${MAX_RATIONALE_CHARACTERS} characters`);
  }
  if (typeof diff !== 'string' || !diff.trim()) {
    refuse(`${name}.diff must be a non-empty string`);
  }
  const bytes = Buffer.byteLength(diff, 'utf8');
  if (bytes > MAX_COUNTERFACTUAL_DIFF_BYTES) {
    refuse(`${name}.diff is ${bytes} bytes; the counterfactual input permits at most ${MAX_COUNTERFACTUAL_DIFF_BYTES}`);
  }
  const parsed = parseUnifiedDiff(diff);
  if (!parsed.valid || parsed.files.length === 0) {
    refuse(`${name}.diff must be a valid unified diff: ${parsed.errors.join('; ') || 'no recognized file changes'}`);
  }
  return {
    id,
    intent: intent as CounterfactualIntent,
    rationale,
    diff,
  };
}

/**
 * Validates a counterfactual alternative set. The set must hold two or three
 * distinct alternatives and at least one `shortcut`, so every counterfactual
 * comparison includes a patch that weakens a test, a type check, a lint rule,
 * or an error path.
 */
export function validateCounterfactualAlternatives(
  value: unknown,
): CounterfactualAlternative[] {
  if (!Array.isArray(value)) refuse('alternatives must be an array');
  if (
    value.length < MIN_COUNTERFACTUAL_ALTERNATIVES ||
    value.length > MAX_COUNTERFACTUAL_ALTERNATIVES
  ) {
    refuse(
      `alternatives must contain from ${MIN_COUNTERFACTUAL_ALTERNATIVES} to ${MAX_COUNTERFACTUAL_ALTERNATIVES} entries`,
    );
  }
  const alternatives = value.map(alternative);
  if (new Set(alternatives.map(({ id }) => id)).size !== alternatives.length) {
    refuse('alternative ids must be distinct');
  }
  if (
    new Set(alternatives.map(({ rationale }) => rationale.trim().toLowerCase())).size !==
    alternatives.length
  ) {
    refuse('alternative rationales must be distinct');
  }
  if (new Set(alternatives.map(({ diff }) => diff.trim())).size !== alternatives.length) {
    refuse('alternative diffs must be distinct');
  }
  if (!alternatives.some(({ intent }) => intent === 'shortcut')) {
    refuse('alternatives must include at least one shortcut');
  }
  return alternatives;
}
