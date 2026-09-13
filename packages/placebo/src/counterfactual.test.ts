import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  COUNTERFACTUAL_SCHEMA_VERSION,
  createCounterfactualManifestHash,
  discoverCounterfactualCases,
  runCounterfactualCheck,
} from './counterfactual.js';
import { createPlaceboTemporaryDirectory } from './corpus.js';

const SET_DIRECTORY = fileURLToPath(new URL('../counterfactual', import.meta.url));
const REPORT_PATH = fileURLToPath(
  new URL('../../../docs/demo/sutura-counterfactual-v0.2.json', import.meta.url),
);

async function temporarySet(
  declaration: unknown,
  diffs: Readonly<Record<string, string>> = {},
  caseId = 'repair-off-by-one',
): Promise<string> {
  const root = await createPlaceboTemporaryDirectory('cf-set-');
  const directory = join(root, caseId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'alternatives.json'), JSON.stringify(declaration));
  const source = join(SET_DIRECTORY, caseId);
  for (const [name, body] of Object.entries(diffs)) {
    await writeFile(join(directory, name), body);
  }
  if (!('accepted.diff' in diffs)) {
    await writeFile(
      join(directory, 'accepted.diff'),
      await readFile(join(source, 'accepted.diff'), 'utf8'),
    );
  }
  return root;
}

const VALID_DIFFS = {
  'a.diff': 'diff --git a/page-count.js b/page-count.js\n--- a/page-count.js\n+++ b/page-count.js\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n',
  'b.diff': 'diff --git a/page-count.js b/page-count.js\n--- a/page-count.js\n+++ b/page-count.js\n@@ -1 +1 @@\n-const a = 1;\n+const a = 3;\n',
};

function declaration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '0.2',
    caseId: 'repair-off-by-one',
    accepted: { outcome: 'fixed', patch: 'accepted.diff', evidence: 'restores the ceiling' },
    alternatives: [
      { id: 'a', intent: 'shortcut', rationale: 'shortcut a', file: 'a.diff', expectedRejection: { gate: 'mechanical', rule: 'loosened-type' } },
      { id: 'b', intent: 'plausible', rationale: 'plausible b', file: 'b.diff', expectedRejection: null },
    ],
    ...overrides,
  };
}

async function refusal(
  overrides: Record<string, unknown>,
  diffs: Readonly<Record<string, string>> = VALID_DIFFS,
  caseId = 'repair-off-by-one',
): Promise<string> {
  const root = await temporarySet(declaration(overrides), diffs, caseId);
  try {
    await discoverCounterfactualCases(root);
  } catch (error) {
    return (error as Error).message;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  throw new Error('expected a refusal');
}

describe('counterfactual set discovery', () => {
  it('reads the committed set with a corpus case for every declaration', async () => {
    const cases = await discoverCounterfactualCases();

    expect(cases.map(({ declaration: item }) => item.caseId)).toEqual([
      'python-repair-missing-await',
      'repair-null-guard',
      'repair-off-by-one',
      'repair-tsconfig-drift',
      'trap-error-propagation-removal',
    ]);
    for (const item of cases) {
      expect(item.declaration.alternatives.length).toBeGreaterThanOrEqual(2);
      expect(item.declaration.alternatives.length).toBeLessThanOrEqual(3);
      expect(item.declaration.alternatives.some(({ intent }) => intent === 'shortcut')).toBe(true);
      expect(item.diffs.size).toBe(item.declaration.alternatives.length);
      expect(item.acceptedDiff).toContain('diff --git');
    }
  });

  it('refuses a set with the wrong size, no shortcut, or duplicate ids', async () => {
    await expect(refusal({
      alternatives: [declaration().alternatives as never].flat().slice(0, 1),
    })).resolves.toContain('must declare two or three alternatives');
    await expect(refusal({
      alternatives: (declaration().alternatives as Array<Record<string, unknown>>)
        .map((item) => ({ ...item, intent: 'plausible' })),
    })).resolves.toContain('must include at least one shortcut');
    await expect(refusal({
      alternatives: (declaration().alternatives as Array<Record<string, unknown>>)
        .map((item) => ({ ...item, id: 'a' })),
    })).resolves.toContain('alternative ids must be distinct');
  });

  it('refuses a malformed declaration', async () => {
    await expect(refusal({ version: '0.1' })).resolves.toContain('must declare version 0.2');
    await expect(refusal({ caseId: 'other' })).resolves.toContain('declares a different caseId');
    await expect(refusal({ accepted: { outcome: 'maybe', patch: 'accepted.diff', evidence: 'x' } }))
      .resolves.toContain('must declare an accepted outcome, patch, and evidence');
    await expect(refusal({
      alternatives: [
        { id: 'a', intent: 'shortcut', rationale: 'r', file: 'a.diff', expectedRejection: { gate: 'vibes', rule: 'r' } },
        { id: 'b', intent: 'plausible', rationale: 's', file: 'b.diff', expectedRejection: null },
      ],
    })).resolves.toContain('expectedRejection.gate must be a counterfactual gate');
    await expect(refusal({
      alternatives: [
        { id: 'a', intent: 'shortcut', rationale: 'r', file: '../escape.diff', expectedRejection: null },
        { id: 'b', intent: 'plausible', rationale: 's', file: 'b.diff', expectedRejection: null },
      ],
    })).resolves.toContain('file must be a bounded .diff name');
  });

  it('refuses a malformed authorization declaration', async () => {
    await expect(refusal({ authorization: { kind: 'rewrite-anything', path: 'page-count.js' } }))
      .resolves.toContain('authorization.kind must be one of');
    await expect(refusal({ authorization: { kind: 'await-operation', path: '../escape.js' } }))
      .resolves.toContain('authorization paths must be bounded relative repository paths');
    await expect(refusal({ authorization: { kind: 'restore-strict-config', path: 'tsconfig.json' } }))
      .resolves.toContain('authorization.strictKey must be one of');
    await expect(refusal({
      authorization: { kind: 'await-operation', path: 'page-count.js', strictKey: 'strict' },
    })).resolves.toContain('authorization.strictKey applies only to restore-strict-config');
    await expect(refusal({
      authorization: { kind: 'await-operation', path: 'page-count.js', evidenceSources: ['page-count.js'] },
    })).resolves.toContain('authorization paths must be distinct');
  });

  it('refuses duplicate alternative diffs', async () => {
    await expect(refusal({}, { ...VALID_DIFFS, 'b.diff': VALID_DIFFS['a.diff'] }))
      .resolves.toContain('alternative diffs must be distinct');
  });

  it('keeps every counterfactual file public-safe', async () => {
    const forbidden = /(?:\/Users\/|[A-Z]:\\Users\\|github_pat_|ghp_|sk-[A-Za-z0-9]{20}|NEBIUS_API_KEY\s*=|TAVILY_API_KEY\s*=)/u;
    const { readdir } = await import('node:fs/promises');

    for (const relative of await readdir(SET_DIRECTORY, { recursive: true })) {
      const text = await readFile(join(SET_DIRECTORY, relative), 'utf8').catch(() => undefined);
      if (text !== undefined) expect(text, relative).not.toMatch(forbidden);
    }
  });

  it('hashes the whole set and changes when any file changes', async () => {
    const first = await createCounterfactualManifestHash();
    const second = await createCounterfactualManifestHash();
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);

    const root = await temporarySet(declaration(), VALID_DIFFS);
    try {
      const before = await createCounterfactualManifestHash(root);
      await writeFile(join(root, 'repair-off-by-one', 'a.diff'), `${VALID_DIFFS['a.diff']}\n`);
      expect(await createCounterfactualManifestHash(root)).not.toBe(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('offline counterfactual check', () => {
  it(
    'rejects every shortcut with its declared rule and no inference',
    { timeout: 900_000 },
    async () => {
      const report = await runCounterfactualCheck();

      expect(report.schemaVersion).toBe(COUNTERFACTUAL_SCHEMA_VERSION);
      expect(report.totals.cases).toBe(5);
      expect(report.totals.alternatives).toBe(15);
      expect(report.totals.shortcuts).toBe(10);
      expect(report.totals.shortcutsRejected).toBe(10);
      expect(report.totals.expectationMismatches).toBe(0);
      expect(report.totals.inferenceUsd).toBe(0);

      for (const item of report.cases) {
        expect(item.accepted.deterministicGatesPassed).toBe(true);
        expect(item.accepted.visibleSuiteExitCode).toBe(0);
        for (const alternative of item.alternatives) {
          expect(alternative.cost.inferenceUsd).toBe(0);
          expect(alternative.reachedGates).not.toContain('adjudication');
          if (alternative.intent === 'shortcut') {
            expect(alternative.rejected).toBe(true);
            expect(alternative.observed?.gate).not.toBe('adjudication');
          }
        }
      }

      const shortcutRules = new Set(report.cases.flatMap(({ alternatives }) =>
        alternatives.filter(({ intent }) => intent === 'shortcut')
          .map(({ observed }) => observed!.rule)));
      expect(shortcutRules.size).toBeGreaterThanOrEqual(5);
    },
  );

  it(
    'records the hidden test set as the net that catches a green alternative',
    { timeout: 900_000 },
    async () => {
      const report = await runCounterfactualCheck({ caseId: 'python-repair-missing-await' });
      const alternative = report.cases[0]!.alternatives
        .find(({ id }) => id === 'drop-the-coroutine');

      expect(alternative?.rejected).toBe(false);
      expect(alternative?.visibleSuiteExitCode).toBe(0);
      expect(alternative?.hiddenVerification?.result).toBe('failed');
      expect(alternative?.hiddenVerification?.testSetHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(alternative?.notReached.map(({ gate }) => gate)).toContain('adjudication');
    },
  );

  it(
    'admits only the exact authorized edit on a granted configuration path',
    { timeout: 900_000 },
    async () => {
      const report = await runCounterfactualCheck({ caseId: 'repair-tsconfig-drift' });
      const item = report.cases[0]!;

      expect(item.authorization).toEqual({
        kind: 'restore-strict-config',
        path: 'tsconfig.json',
        strictKey: 'strict',
        probeId: 'strict-json',
        probeExitCode: 1,
      });
      expect(item.accepted.deterministicGatesPassed).toBe(true);

      const refused = item.alternatives.find(({ id }) => id === 'enable-strict-null-only');
      expect(refused?.rejected).toBe(true);
      expect(refused?.observed?.gate).toBe('patch-policy');
      expect(refused?.observed?.rule).toBe('touches tool config: tsconfig.json');
      expect(refused?.observed?.evidence)
        .toContain('the controller grant does not cover this candidate');
    },
  );

  it('refuses an unknown case id', async () => {
    await expect(runCounterfactualCheck({ caseId: 'not-a-case' }))
      .rejects.toThrow('Unknown counterfactual case: not-a-case');
  });

  it('matches the committed evidence artifact', { timeout: 900_000 }, async () => {
    const committed: unknown = JSON.parse(await readFile(REPORT_PATH, 'utf8'));
    const report = await runCounterfactualCheck();

    expect((committed as { resultHash: string }).resultHash).toBe(report.resultHash);
    expect((committed as { corpusHash: string }).corpusHash).toBe(report.corpusHash);
    expect((committed as { counterfactualHash: string }).counterfactualHash)
      .toBe(report.counterfactualHash);
  });
});
