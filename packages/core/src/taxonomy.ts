import type { FailureClass } from './domain.js';

export interface TaxonomyEntry {
  signatures: readonly RegExp[];
  examples: readonly string[];
  repairable: boolean;
  notes: string;
}

export const FAILURE_TAXONOMY: Readonly<Record<FailureClass, TaxonomyEntry>> = {
  typecheck: {
    signatures: [/\bTS\d{4}\b/, /\btsc\b[^\n]*(?:failed|error)/i],
    examples: ['error TS2322: Type A is not assignable to type B'],
    repairable: true,
    notes: 'Static TypeScript diagnostics.',
  },
  lint: {
    signatures: [
      /\b(?:eslint|typescript-eslint)\b/i,
      /\b(?:@?[a-z][\w-]*\/)?[a-z]\w*(?:-[a-z]\w*)+\b[^\n]*(?:error|warning)/i,
    ],
    examples: ['error Unexpected value no-example-rule'],
    repairable: true,
    notes: 'Static style or code-quality rule violations.',
  },
  build: {
    signatures: [
      /\bbuild failed\b/i,
      /\bfailed to compile\b/i,
      /\b(?:vite|webpack|rollup)\b[^\n]*(?:build|error)/i,
    ],
    examples: ['Build failed: Could not resolve entry module'],
    repairable: true,
    notes: 'Compilation or packaging failures outside type checking.',
  },
  'test-assertion': {
    signatures: [
      /\bAssertionError\b/i,
      /\bexpected\b[^\n]*\b(?:to|but)\b[^\n]*\b(?:received|be|equal|match)\b/i,
      /\b(?:Expected|Received):\s/i,
    ],
    examples: ['AssertionError: expected 3 to be 4'],
    repairable: true,
    notes: 'A test completed and its expected value did not match.',
  },
  'test-bug': {
    signatures: [
      /\b(?:TypeError|ReferenceError):[^\n]+[\s\S]*\.(?:test|spec)\.[cm]?[jt]sx?:/i,
      /\bUnhandled (?:Promise )?Rejection\b/i,
    ],
    examples: ['TypeError in a test stack frame'],
    repairable: true,
    notes: 'The code under test or test harness raised an unexpected error.',
  },
  'flaky-timing': {
    signatures: [
      /\bEADDRINUSE\b/,
      /\b(?:test|hook) timed out\b/i,
      /\b(?:ECONNRESET|ETIMEDOUT)\b/,
      /\bflaky\b(?![-/]|\.[A-Za-z0-9])/i,
    ],
    examples: ['Error: listen EADDRINUSE'],
    repairable: false,
    notes: 'Timing or transient behavior requires triage, not an automatic patch.',
  },
  'dep-upstream-breaking': {
    signatures: [
      /\bERR_MODULE_NOT_FOUND\b/,
      /\bCannot find (?:module|package)\b/i,
      /\bpeer dep(?:endency)?\b/i,
      /\bbreaking (?:change|release)\b/i,
    ],
    examples: ['ERR_MODULE_NOT_FOUND for a package import'],
    repairable: true,
    notes: 'A dependency is absent, incompatible, or changed upstream.',
  },
  'env-config': {
    signatures: [
      /\bmissing required environment variable\b/i,
      /\benvironment variable\b[^\n]*\b(?:missing|required|undefined)\b/i,
      /\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET)\b[^\n]*\b(?:missing|required|undefined|not set)\b/i,
    ],
    examples: ['Missing required environment variable: SERVICE_API_KEY'],
    repairable: true,
    notes: 'Required runtime configuration is absent or invalid.',
  },
  infra: {
    signatures: [
      /\bENOSPC\b/,
      /\bno space left on device\b/i,
      /\brunner lost communication\b/i,
      /\b(?:502|503)\b[^\n]*\b(?:gateway|service|unavailable)\b/i,
    ],
    examples: ['ENOSPC: no space left on device'],
    repairable: false,
    notes: 'The runner or an external service failed outside repository code.',
  },
};
