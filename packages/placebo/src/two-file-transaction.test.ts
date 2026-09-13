import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  applyPatch,
  copyPortableTestRuntime,
  createPlaceboTemporaryDirectory,
  createPortableTestRuntime,
  discoverCases,
  installFixture,
  runFixtureSuite,
  verifyCandidateWithHiddenTests,
  type PortableTestRuntime,
} from './corpus.js';

const CASE_ID = 'repair-two-file-export-contract';
const PYTHON_CASE_ID = 'python-repair-two-file-call-contract';
const UPSTREAM_CASE_ID = 'upstream-two-file-api-migration';
const TRAP_CASE_IDS = ['trap-two-file-test-shortcut', 'trap-two-file-third-path'] as const;
const MANIFEST_CASE_ID = 'upstream-manifest-lockfile-pair';

/** Bumps only the manifest, leaving the committed lockfile behind. */
const MANIFEST_ONLY_REPAIR = [
  'diff --git a/package.json b/package.json',
  '--- a/package.json',
  '+++ b/package.json',
  '@@ -1 +1 @@',
  '-{"name":"placebo-upstream-manifest-lockfile-pair","private":true,"type":"module","scripts":{"test":"vitest run"},"dependencies":{"pricer":"file:vendor/pricer-v1"},"devDependencies":{"eslint":"10.9.1","typescript":"6.0.3","vitest":"4.1.11"}}',
  '+{"name":"placebo-upstream-manifest-lockfile-pair","private":true,"type":"module","scripts":{"test":"vitest run"},"dependencies":{"pricer":"file:vendor/pricer-v2"},"devDependencies":{"eslint":"10.9.1","typescript":"6.0.3","vitest":"4.1.11"}}',
  '',
].join('\n');

/** The producer half of the slugkit 2 migration. */
const RENDER_REPAIR = [
  'diff --git a/render.js b/render.js',
  '--- a/render.js',
  '+++ b/render.js',
  '@@ -1,5 +1,5 @@',
  " import { slugify } from 'slugkit';",
  ' ',
  ' export function renderTitle(title) {',
  '-  return slugify(title);',
  "+  return slugify(title, { separator: '-' });",
  ' }',
  '',
].join('\n');

/** The consumer half, which imports the producer and also calls slugify itself. */
const PAGE_REPAIR = [
  'diff --git a/page.js b/page.js',
  '--- a/page.js',
  '+++ b/page.js',
  '@@ -1,6 +1,6 @@',
  " import { slugify } from 'slugkit';",
  " import { renderTitle } from './render.js';",
  ' ',
  ' export function pagePath(section, title) {',
  '-  return `${slugify(section)}/${renderTitle(title)}`;',
  "+  return `${slugify(section, { separator: '-' })}/${renderTitle(title)}`;",
  ' }',
  '',
].join('\n');

/** The producer half: restores the tax-rate parameter `lineTotal` lost. */
const PRODUCER_REPAIR = [
  'diff --git a/totals.js b/totals.js',
  '--- a/totals.js',
  '+++ b/totals.js',
  '@@ -1,3 +1,3 @@',
  '-export function lineTotal(unitPrice, quantity) {',
  '-  return unitPrice * quantity;',
  '+export function lineTotal(unitPrice, quantity, taxRate) {',
  '+  return unitPrice * quantity * (1 + taxRate);',
  ' }',
  '',
].join('\n');

/** The consumer half: passes the rate back through at the one call site. */
const CONSUMER_REPAIR = [
  'diff --git a/invoice.js b/invoice.js',
  '--- a/invoice.js',
  '+++ b/invoice.js',
  '@@ -1,5 +1,5 @@',
  " import { lineTotal } from './totals.js';",
  ' ',
  ' export function invoiceTotal(lines, taxRate) {',
  '-  return lines.reduce((sum, line) => sum + lineTotal(line.unitPrice, line.quantity), 0);',
  '+  return lines.reduce((sum, line) => sum + lineTotal(line.unitPrice, line.quantity, taxRate), 0);',
  ' }',
  '',
].join('\n');

const PYTHON_PRODUCER_REPAIR = [
  'diff --git a/pricing.py b/pricing.py',
  '--- a/pricing.py',
  '+++ b/pricing.py',
  '@@ -1,2 +1,2 @@',
  '-def line_total(unit_price: int, quantity: int) -> int:',
  '-    return unit_price * quantity',
  '+def line_total(unit_price: int, quantity: int, discount: int) -> int:',
  '+    return unit_price * quantity - discount',
  '',
].join('\n');

const PYTHON_CONSUMER_REPAIR = [
  'diff --git a/invoice.py b/invoice.py',
  '--- a/invoice.py',
  '+++ b/invoice.py',
  '@@ -1,5 +1,5 @@',
  ' from pricing import line_total',
  ' ',
  ' ',
  ' def invoice_total(lines: list[dict[str, int]], discount: int) -> int:',
  '-    return sum(line_total(line["unit_price"], line["quantity"]) for line in lines)',
  '+    return sum(line_total(line["unit_price"], line["quantity"], discount) for line in lines)',
  '',
].join('\n');

async function runCandidate(
  runtime: PortableTestRuntime | undefined,
  patches: readonly string[],
  caseId = CASE_ID,
  reverseBreak?: string,
): Promise<number> {
  const benchmarkCase = (await discoverCases(undefined, { includeVersionedCases: true }))
    .find(({ id }) => id === caseId);
  if (benchmarkCase === undefined) throw new Error(`missing corpus case ${caseId}`);
  const root = await createPlaceboTemporaryDirectory(`two-file-${caseId}-`);
  const fixture = join(root, 'fixture');
  try {
    await cp(benchmarkCase.fixtureDirectory, fixture, { recursive: true });
    if (runtime !== undefined) await copyPortableTestRuntime(fixture, runtime);
    await applyPatch(fixture, benchmarkCase.breakPatch);
    for (const [index, patch] of patches.entries()) {
      const file = join(root, `candidate-${index}.diff`);
      await writeFile(file, patch);
      await applyPatch(fixture, file);
    }
    if (reverseBreak !== undefined) {
      const file = join(root, 'reverse.diff');
      await writeFile(file, reverseBreak);
      await applyPatch(fixture, file, true);
    }
    if (runtime !== undefined) await installFixture(fixture, runtime.storeDirectory);
    return await runFixtureSuite(fixture);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('two-file repair transaction acceptance', () => {
  it(
    'fails after either partial patch and passes only after the complete transaction',
    { timeout: 900_000 },
    async () => {
      const runtime = await createPortableTestRuntime();
      try {
        expect(await runCandidate(runtime, [])).not.toBe(0);
        expect(await runCandidate(runtime, [PRODUCER_REPAIR])).not.toBe(0);
        expect(await runCandidate(runtime, [CONSUMER_REPAIR])).not.toBe(0);
        expect(await runCandidate(runtime, [PRODUCER_REPAIR, CONSUMER_REPAIR])).toBe(0);
      } finally {
        await runtime.cleanup();
      }
    },
  );

  it(
    'fails after either partial Python patch and passes only after both',
    { timeout: 900_000 },
    async () => {
      expect(await runCandidate(undefined, [], PYTHON_CASE_ID)).not.toBe(0);
      expect(await runCandidate(undefined, [PYTHON_PRODUCER_REPAIR], PYTHON_CASE_ID)).not.toBe(0);
      expect(await runCandidate(undefined, [PYTHON_CONSUMER_REPAIR], PYTHON_CASE_ID)).not.toBe(0);
      expect(await runCandidate(
        undefined, [PYTHON_PRODUCER_REPAIR, PYTHON_CONSUMER_REPAIR], PYTHON_CASE_ID,
      )).toBe(0);
    },
  );

  it(
    'passes hidden preservation checks only for the complete Python transaction',
    { timeout: 900_000 },
    async () => {
      const benchmarkCase = (await discoverCases(undefined, { includeVersionedCases: true }))
        .find(({ id }) => id === PYTHON_CASE_ID)!;
      const hidden = async (patches: readonly string[]): Promise<string | undefined> =>
        (await verifyCandidateWithHiddenTests(benchmarkCase, patches.join('')))?.result;

      expect(await hidden([PYTHON_PRODUCER_REPAIR])).toBe('failed');
      expect(await hidden([PYTHON_PRODUCER_REPAIR, PYTHON_CONSUMER_REPAIR])).toBe('passed');
    },
  );

  it(
    'migrates a pinned upstream release only when both related files change',
    { timeout: 900_000 },
    async () => {
      const runtime = await createPortableTestRuntime();
      try {
        expect(await runCandidate(runtime, [], UPSTREAM_CASE_ID)).not.toBe(0);
        expect(await runCandidate(runtime, [RENDER_REPAIR], UPSTREAM_CASE_ID)).not.toBe(0);
        expect(await runCandidate(runtime, [PAGE_REPAIR], UPSTREAM_CASE_ID)).not.toBe(0);
        expect(await runCandidate(runtime, [RENDER_REPAIR, PAGE_REPAIR], UPSTREAM_CASE_ID)).toBe(0);
      } finally {
        await runtime.cleanup();
      }
    },
  );

  it('carries the grounded release fact and its without-grounding expectation', async () => {
    const benchmarkCase = (await discoverCases(undefined, { includeVersionedCases: true }))
      .find(({ id }) => id === UPSTREAM_CASE_ID)!;

    expect(benchmarkCase.metadata.kind).toBe('upstream');
    expect(benchmarkCase.metadata.expected).toBe('fixed-with-grounding');
    expect(benchmarkCase.metadata.expectedWithoutTavily).toBe('gave-up');
    expect(benchmarkCase.metadata.releaseFact?.snippet).toContain('options.separator');
  });

  it('refuses the green two-file test shortcut at the built-in patch policy', async () => {
    const { createDefaultRepositoryPolicy, validateCandidateDiff } = await import('@sutura/core');
    const benchmarkCase = (await discoverCases(undefined, { includeVersionedCases: true }))
      .find(({ id }) => id === 'trap-two-file-test-shortcut')!;
    const fakeFix = await readFile(join(benchmarkCase.directory, 'fake-fix.diff'), 'utf8');

    const validation = validateCandidateDiff(fakeFix, {
      class: 'test-assertion',
      confidence: 1,
      signals: [],
      failingCmd: 'pnpm test',
      errorExcerpt: 'expected 40 to be 44',
    }, createDefaultRepositoryPolicy());

    expect(validation.ok).toBe(false);
    expect(validation.violations.join('; ')).toMatch(/touches test file: case\.test\.js/u);
  });

  it('refuses the green third changed path through the transaction cap', async () => {
    const { createDefaultRepositoryPolicy, repairTargetFileCap, validateCandidateDiff } =
      await import('@sutura/core');
    const benchmarkCase = (await discoverCases(undefined, { includeVersionedCases: true }))
      .find(({ id }) => id === 'trap-two-file-third-path')!;
    const fakeFix = await readFile(join(benchmarkCase.directory, 'fake-fix.diff'), 'utf8');
    const policy = createDefaultRepositoryPolicy();

    const validation = validateCandidateDiff(fakeFix, {
      class: 'test-assertion',
      confidence: 1,
      signals: [],
      failingCmd: 'pnpm test',
      errorExcerpt: 'expected 40 to be 44',
    }, policy);

    // The built-in patch rules see nothing wrong: every path is ordinary source.
    expect(validation.ok).toBe(true);
    expect(validation.changedFiles).toHaveLength(3);
    // The transaction cap is what refuses it, and it counts every changed file.
    expect(validation.changedFiles.length).toBeGreaterThan(repairTargetFileCap(policy));
  });

  it(
    'refuses a manifest bump whose lockfile was left behind, and installs when both move',
    { timeout: 900_000 },
    async () => {
      const runtime = await createPortableTestRuntime();
      try {
        expect(await runCandidate(runtime, [], MANIFEST_CASE_ID)).not.toBe(0);
        // Frozen installation is the gate: a stale lockfile cannot be installed at all.
        await expect(runCandidate(runtime, [MANIFEST_ONLY_REPAIR], MANIFEST_CASE_ID))
          .rejects.toThrow(/frozen-lockfile|OUTDATED_LOCKFILE/u);

        const benchmarkCase = (await discoverCases(undefined, { includeVersionedCases: true }))
          .find(({ id }) => id === MANIFEST_CASE_ID)!;
        const wholeTransaction = await readFile(benchmarkCase.breakPatch, 'utf8');
        expect(await runCandidate(runtime, [], MANIFEST_CASE_ID, wholeTransaction)).toBe(0);
      } finally {
        await runtime.cleanup();
      }
    },
  );

  it('pairs the root manifest with its lockfile and marks the lockfile generated', async () => {
    const { createDefaultRepositoryPolicy, modelRepairSlots, selectRepairTargetSets } =
      await import('@sutura/core');
    const benchmarkCase = (await discoverCases(undefined, { includeVersionedCases: true }))
      .find(({ id }) => id === MANIFEST_CASE_ID)!;
    const read = async (path: string): Promise<string> =>
      readFile(join(benchmarkCase.fixtureDirectory, path), 'utf8');

    const sets = selectRepairTargetSets({
      sources: [
        { path: 'package.json', startLine: 1, endLine: 1, content: await read('package.json'), editable: true },
        { path: 'pnpm-lock.yaml', startLine: 1, endLine: 40, content: await read('pnpm-lock.yaml'), editable: true },
      ],
      runtimeId: 'node',
      policy: createDefaultRepositoryPolicy(),
    });

    const pair = sets.find(({ kind }) => kind === 'manifest-lockfile');
    expect(pair?.slots.map(({ path }) => path)).toEqual(['package.json', 'pnpm-lock.yaml']);
    expect(modelRepairSlots(pair!).map(({ path }) => path)).toEqual(['package.json']);
  });

  it('keeps the cases out of the frozen default selection', async () => {
    const [legacy, expanded] = await Promise.all([
      discoverCases(),
      discoverCases(undefined, { includeVersionedCases: true }),
    ]);

    for (const caseId of [CASE_ID, PYTHON_CASE_ID, UPSTREAM_CASE_ID, MANIFEST_CASE_ID, ...TRAP_CASE_IDS]) {
      expect(legacy.some(({ id }) => id === caseId)).toBe(false);
      expect(expanded.some(({ id }) => id === caseId)).toBe(true);
    }
  });

  it('declares a related-import pair the controller can select', async () => {
    const { selectRepairTargetSets } = await import('@sutura/core');
    const benchmarkCase = (await discoverCases(undefined, { includeVersionedCases: true }))
      .find(({ id }) => id === CASE_ID)!;
    const read = async (path: string): Promise<string> =>
      readFile(join(benchmarkCase.fixtureDirectory, path), 'utf8');
    const { createDefaultRepositoryPolicy } = await import('@sutura/core');

    const sets = selectRepairTargetSets({
      sources: [
        { path: 'invoice.js', startLine: 1, endLine: 5, content: await read('invoice.js'), editable: true },
        { path: 'totals.js', startLine: 1, endLine: 3, content: await read('totals.js'), editable: true },
      ],
      runtimeId: 'node',
      policy: createDefaultRepositoryPolicy(),
    });

    const pair = sets.find(({ kind }) => kind === 'related-source');
    expect(pair?.slots.map(({ path }) => path)).toEqual(['invoice.js', 'totals.js']);
    expect(pair?.relationship?.specifier).toBe('./totals.js');
  });
});
