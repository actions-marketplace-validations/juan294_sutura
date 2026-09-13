import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import { authorizeRepairCandidate, createRepairAuthorizationSession, deriveRepairAuthorization, isAuthorizedRepairTarget } from './repair-authorization.js';
import { vetPatch } from './patch-rules.js';
import { validateCandidateDiff } from './candidate-validation.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const baseline = { kind: 'local-snapshot' as const, sourceSha: null, policyBaseSha: null, policySha256: hash('policy'), baselineImageId: 'baseline-uuid', snapshotSha256: null };
const diagnosis = { class: 'test-bug' as const, confidence: 1, signals: [], failingCmd: 'pnpm test', errorExcerpt: 'Promise mismatch' };
const imports = 'import { test, expect } from "vitest";\n';
const before = imports + 'test("value", async () => { expect(load()).toBe("ok"); });\n';
function diff(old: string, next: string, path = 'case.test.js') {
  const a = old.trimEnd().split('\n'); const b = next.trimEnd().split('\n');
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, `@@ -1,${a.length} +1,${b.length} @@`, ...a.map((s) => `-${s}`), ...b.map((s) => `+${s}`), ''].join('\n');
}
async function setup(content = before, path = 'case.test.js') {
  const source = { path, startLine: 1, content, truncated: false };
  const policy = createDefaultRepositoryPolicy();
  const session = createRepairAuthorizationSession({ baseline, failingCommand: 'pnpm test', policy, sources: [source] });
  expect(await deriveRepairAuthorization(session, { kind: 'await-operation', path, evidenceReferences: ['captured-promise-mismatch'], controllerProbe: { id: 'async-completion', imageId: baseline.baselineImageId, exitCode: 1, output: 'Expected promise/coroutine result to equal a value', sourceSha256: hash(content), failingCommand: 'pnpm test' } })).toEqual({ ok: true });
  return { session, source, policy, context: { session, baseline } };
}

describe('controller repair authorization', () => {
  it('authenticates exact baseline/path/source and certifies only the checked diff', async () => {
    const { session, source, policy, context } = await setup();
    const patch = diff(before, before.replace('expect(load())', 'expect(await load())'));
    expect(isAuthorizedRepairTarget(session, baseline, source)).toBe(true);
    expect(vetPatch(patch, diagnosis, context).ok).toBe(false);
    expect((await authorizeRepairCandidate(session, baseline, patch)).ok).toBe(true);
    expect(validateCandidateDiff(patch, diagnosis, policy, policy.maxDiffBytes, context).ok).toBe(true);
    expect(isAuthorizedRepairTarget(structuredClone(session), baseline, source)).toBe(false);
    expect(isAuthorizedRepairTarget(session, { ...baseline, baselineImageId: 'other' }, source)).toBe(false);
    expect(isAuthorizedRepairTarget(session, baseline, { ...source, content: 'changed' })).toBe(false);
    expect(vetPatch(patch, diagnosis, { session: structuredClone(session), baseline }).ok).toBe(false);
    expect(vetPatch(patch, { ...diagnosis, failingCmd: 'echo bypass' }, context).ok).toBe(false);
    expect(vetPatch(patch, diagnosis, { session, baseline: { ...baseline, baselineImageId: 'other' } }).ok).toBe(false);
    expect((await authorizeRepairCandidate(session, baseline, patch + diff('x\n', 'y\n', 'other.js'))).ok).toBe(false);
    expect(validateCandidateDiff(patch, diagnosis, { ...policy, protectedPaths: ['case.test.js'] }, policy.maxDiffBytes, context).ok).toBe(false);
  });

  it.each([
    'test("value", async () => { expect(await load()).toBe("other"); });\n',
    'test("value", async () => { expect(await load(1)).toBe("ok"); });\n',
    'test("value", async () => { if(false) expect(await load()).toBe("ok"); });\n',
    'test.skip("value", async () => { expect(await load()).toBe("ok"); });\n',
    'test("value", async () => { /* hidden */ expect(await load()).toBe("ok"); });\n',
    'test("value", async () => { try { expect(await load()).toBe("ok"); } catch {} });\n',
  ])('rejects changes beyond inserted syntax %#', async (next) => {
    const { session } = await setup();
    expect((await authorizeRepairCandidate(session, baseline, diff(before, imports + next))).ok).toBe(false);
  });

  it('locates a hunk by its baseline context rather than its declared line number', async () => {
    const { session } = await setup();
    const patch = diff(before, before.replace('expect(load())', 'expect(await load())'));
    const shifted = patch.replace('@@ -1,', '@@ -7,').replace(' +1,', ' +7,');

    expect(shifted).not.toBe(patch);
    expect((await authorizeRepairCandidate(session, baseline, shifted)).ok).toBe(true);
  });

  it('refuses a hunk with an absent, repeated or missing baseline context', async () => {
    const repeated = `${imports}test("a", async () => { expect(load()).toBe("ok"); });\ntest("a", async () => { expect(load()).toBe("ok"); });\n`;
    const { session } = await setup(repeated);
    const one = 'test("a", async () => { expect(load()).toBe("ok"); });';
    const hunk = (header: string, lines: string[]) => [
      'diff --git a/case.test.js b/case.test.js', '--- a/case.test.js', '+++ b/case.test.js', header, ...lines, '',
    ].join('\n');

    expect((await authorizeRepairCandidate(session, baseline, hunk('@@ -2,1 +2,1 @@', [
      `-${one}`, `+${one.replace('expect(load())', 'expect(await load())')}`,
    ]))).violations[0]).toContain('more than one baseline position');
    expect((await authorizeRepairCandidate(session, baseline, hunk('@@ -1,1 +1,1 @@', [
      '-test("absent", () => {});', '+test("absent", async () => {});',
    ]))).violations[0]).toContain('does not match exact baseline source');
    expect((await authorizeRepairCandidate(session, baseline, hunk('@@ -1,0 +1,1 @@', [
      '+test("added", () => {});',
    ]))).violations[0]).toContain('no baseline context to locate');
  });

  it('permits only necessary enclosing async syntax', async () => {
    const old = `import { test } from 'vitest';\ntest("value", () => { expect(load()).toBe("ok"); });\n`;
    const { session } = await setup(old);
    expect((await authorizeRepairCandidate(session, baseline, diff(old, old.replace('() =>', 'async () =>').replace('expect(load())', 'expect(await load())')))).ok).toBe(true);
    expect((await authorizeRepairCandidate(session, baseline, diff(old, before))).ok).toBe(false);
  });

  it('rejects moving or deleting an existing await', async () => {
    const old = 'async function check() { await first(); second(); }\n';
    const { session } = await setup(old);
    expect((await authorizeRepairCandidate(session, baseline, diff(old, 'async function check() { first(); await second(); }\n'))).ok).toBe(false);
  });

  it('rejects missing controller evidence and incomplete source', async () => {
    const session = createRepairAuthorizationSession({ baseline, failingCommand: 'pnpm test', policy: createDefaultRepositoryPolicy(), sources: [{ path: 'case.test.js', startLine: 2, content: before, truncated: true }] });
    expect((await deriveRepairAuthorization(session, { kind: 'await-operation', path: 'case.test.js', evidenceReferences: [], controllerProbe: { id: 'async-completion', imageId: 'other', exitCode: 0, output: '', sourceSha256: hash(before), failingCommand: 'pnpm test' } })).ok).toBe(false);
  });

  it('parses Python without executing repository source', async () => {
    const old = 'import unittest\nclass T(unittest.IsolatedAsyncioTestCase):\n async def test_value(self):\n  self.assertEqual(load(), "ok")\n';
    const { session } = await setup(old, 'test_value.py');
    expect((await authorizeRepairCandidate(session, baseline, diff(old, old.replace('load()', 'await load()'), 'test_value.py'))).ok).toBe(true);
    expect((await authorizeRepairCandidate(session, baseline, diff(old, old.replace('"ok"', '"wrong"'), 'test_value.py'))).ok).toBe(false);
    const refused = await authorizeRepairCandidate(session, baseline, diff(old, `${old}PRIVATE_SOURCE_SENTINEL = (\n`, 'test_value.py'));
    expect(refused.ok).toBe(false);
    expect(refused.violations.join(' ')).not.toContain('PRIVATE_SOURCE_SENTINEL');
  }, 30_000);

  it('restores only a contract-required strict JSON key', async () => {
    const old = '{"compilerOptions":{"strict":false,"module":"NodeNext"}}\n';
    const policy = { ...createDefaultRepositoryPolicy(), verification: { mode: 'required' as const, contracts: [{ id: 'strict', kind: 'json-property' as const, target: { adapter: 'json' as const, path: 'tsconfig.json' }, property: ['compilerOptions', 'strict'], expected: true }] } };
    const session = createRepairAuthorizationSession({ baseline, failingCommand: 'pnpm test', policy, sources: [{ path: 'tsconfig.json', startLine: 1, content: old, truncated: false }] });
    expect((await deriveRepairAuthorization(session, { kind: 'restore-strict-config', path: 'tsconfig.json', strictKey: 'strict', evidenceReferences: ['trusted-contract'], controllerProbe: { id: 'strict-json', imageId: baseline.baselineImageId, exitCode: 1, output: 'strict expected true', sourceSha256: hash(old), failingCommand: 'pnpm test' } })).ok).toBe(true);
    expect((await authorizeRepairCandidate(session, baseline, diff(old, old.replace('false', 'true'), 'tsconfig.json'))).ok).toBe(true);
    expect((await authorizeRepairCandidate(session, baseline, diff(old, old.replace('false', 'true').replace('NodeNext', 'CommonJS'), 'tsconfig.json'))).ok).toBe(false);
    const invalid = await authorizeRepairCandidate(session, baseline, diff(old, '{"PRIV":broken}\n', 'tsconfig.json'));
    expect(invalid.ok).toBe(false);
    expect(invalid.violations.join(' ')).not.toContain('PRIV');
  });

  it.each(['sourceSha256', 'failingCommand', 'id'])('rejects substituted controller proof %s', async (field) => {
    const session = createRepairAuthorizationSession({ baseline, failingCommand: 'pnpm test', policy: createDefaultRepositoryPolicy(), sources: [{ path: 'case.test.js', startLine: 1, content: before, truncated: false }] });
    const controllerProbe = { id: 'async-completion', imageId: baseline.baselineImageId, exitCode: 1, output: 'Promise mismatch', sourceSha256: hash(before), failingCommand: 'pnpm test', [field]: 'wrong' };
    expect((await deriveRepairAuthorization(session, { kind: 'await-operation', path: 'case.test.js', evidenceReferences: ['captured-failure'], controllerProbe })).ok).toBe(false);
  });

  it('rejects unparsable complete source before authorizing a target', async () => {
    const content = 'test("bad", () => { nonsense( }';
    const session = createRepairAuthorizationSession({ baseline, failingCommand: 'pnpm test', policy: createDefaultRepositoryPolicy(), sources: [{ path: 'case.test.js', startLine: 1, content, truncated: false }] });
    expect((await deriveRepairAuthorization(session, { kind: 'await-operation', path: 'case.test.js', evidenceReferences: ['captured-failure'], controllerProbe: { id: 'async-completion', imageId: baseline.baselineImageId, exitCode: 1, output: 'Promise mismatch', sourceSha256: hash(content), failingCommand: 'pnpm test' } })).ok).toBe(false);
  });

  it('supports typed TypeScript async edits without changing the type annotation', async () => {
    const old = imports + 'test("value", async (): Promise<void> => { expect(load()).toBe("ok"); });\n';
    const { session } = await setup(old, 'case.test.ts');
    expect((await authorizeRepairCandidate(session, baseline, diff(old, old.replace('expect(load())', 'expect(await load())'), 'case.test.ts'))).ok).toBe(true);
    expect((await authorizeRepairCandidate(session, baseline, diff(old, old.replace('expect(load())', 'expect(await load())').replace('void', 'any'), 'case.test.ts'))).ok).toBe(false);
  });

  it('recognizes the unchanged existing strictness fixture as authority', async () => {
    const authority = await readFile(new URL('../../../placebo/corpus/repair-tsconfig-drift/fixture/case.test.js', import.meta.url), 'utf8');
    const old = '{"compilerOptions":{"strict":false,"module":"NodeNext","moduleResolution":"NodeNext"}}\n';
    const session = createRepairAuthorizationSession({ baseline, failingCommand: 'pnpm test', policy: createDefaultRepositoryPolicy(), sources: [
      { path: 'tsconfig.json', startLine: 1, content: old, truncated: false },
      { path: 'case.test.js', startLine: 1, content: authority, truncated: false },
    ] });
    expect(await deriveRepairAuthorization(session, { kind: 'restore-strict-config', path: 'tsconfig.json', strictKey: 'strict', evidenceReferences: ['existing-repository-check'], controllerProbe: { id: 'strict-json', imageId: baseline.baselineImageId, exitCode: 1, output: 'strict expected true', sourceSha256: hash(old), failingCommand: 'pnpm test' } })).toEqual({ ok: true });
    expect((await authorizeRepairCandidate(session, baseline, diff(old, old.replace('false', 'true'), 'tsconfig.json'))).ok).toBe(true);
    expect((await authorizeRepairCandidate(session, baseline, diff(old, '{"compilerOptions":{"strict":true,"strict":false}}\n', 'tsconfig.json'))).ok).toBe(false);
  });
  it.each([
    ['[1].forEach(() => { expect(load()).toBe("ok"); });\n', '[1].forEach(async () => { expect(await load()).toBe("ok"); });\n'],
    ['function check() { expect(load()).toBe("ok"); }\n', 'async function check() { expect(await load()).toBe("ok"); }\n'],
    ['test("x", () => { expect(load()).toBe("ok"); });\n', 'test("x", async () => { expect(await load()).toBe("ok"); });\n'],
    ['async function check() { if(enabled()) expect(load()).toBe("ok"); }\n', 'async function check() { if(await enabled()) expect(load()).toBe("ok"); }\n'],
    ['async function check() { enabled() && expect(load()).toBe("ok"); }\n', 'async function check() { await enabled() && expect(load()).toBe("ok"); }\n'],
    ['async function check() { expect("ok").toBe(load()); }\n', 'async function check() { expect("ok").toBe(await load()); }\n'],
    ['async function check() { const yes = enabled(); if(yes) expect(load()).toBe("ok"); }\n', 'async function check() { const yes = await enabled(); if(yes) expect(load()).toBe("ok"); }\n'],
    ['async function check() { try { expect(load()).toBe("ok"); } catch {} }\n', 'async function check() { try { expect(await load()).toBe("ok"); } catch {} }\n'],
    ['async function check() { for(const x of values()) expect(x).toBe("ok"); }\n', 'async function check() { for(const x of await values()) expect(x).toBe("ok"); }\n'],
  ])('rejects detached completion and assertion suppression %#', async (old, next) => {
    const { session } = await setup(old);
    expect((await authorizeRepairCandidate(session, baseline, diff(old, next))).ok).toBe(false);
  });

  it.each([
    ['import unittest\nclass T(unittest.TestCase):\n def test_value(self):\n  self.assertEqual(load(), "ok")\n', 'import unittest\nclass T(unittest.TestCase):\n async def test_value(self):\n  self.assertEqual(await load(), "ok")\n'],
    ['async def check():\n if enabled():\n  assert load() == "ok"\n', 'async def check():\n if await enabled():\n  assert load() == "ok"\n'],
    ['async def check():\n yes = enabled()\n if yes:\n  assert load() == "ok"\n', 'async def check():\n yes = await enabled()\n if yes:\n  assert load() == "ok"\n'],
    ['async def check(self):\n self.assertEqual("ok", load())\n', 'async def check(self):\n self.assertEqual("ok", await load())\n'],
  ])('rejects Python detached completion and assertion suppression %#', async (old, next) => {
    const { session } = await setup(old, 'test_value.py');
    expect((await authorizeRepairCandidate(session, baseline, diff(old, next, 'test_value.py'))).ok).toBe(false);
  }, 30_000);

  it('accepts completion-aware Python conversion and straight-line setup', async () => {
    const old = 'import unittest\nclass T(unittest.IsolatedAsyncioTestCase):\n def test_value(self):\n  result = load()\n  self.assertEqual(result, "ok")\n';
    const { session } = await setup(old, 'test_value.py');
    const next = old.replace(' def test_value', ' async def test_value').replace('result = load()', 'result = await load()');
    expect((await authorizeRepairCandidate(session, baseline, diff(old, next, 'test_value.py'))).ok).toBe(true);
  }, 30_000);

  it('accepts a direct existing setup call in an async body', async () => {
    const old = imports + 'test("value", async () => { setup(); expect(state).toBe("ok"); });\n';
    const { session } = await setup(old);
    expect((await authorizeRepairCandidate(session, baseline, diff(old, old.replace('setup();', 'await setup();')))).ok).toBe(true);
  });

  it.each([
    'async function check(expect) { expect(load()).toBe("ok"); }\n',
    'import { expect } from "./fake.js";\nasync function check() { expect(load()).toBe("ok"); }\n',
    'const expect = fake;\nasync function check() { expect(load()).toBe("ok"); }\n',
  ])('rejects shadowed assertion binding %#', async (old) => {
    const { session } = await setup(old);
    expect((await authorizeRepairCandidate(session, baseline, diff(old, old.replace('expect(load())', 'expect(await load())')))).ok).toBe(false);
  });

  it.each([
    ['async function check() { const expected = load(); expect("ok").toBe(expected); }\n', 'async function check() { const expected = await load(); expect("ok").toBe(expected); }\n', 'case.test.js'],
    ['async def check(self):\n expected = load()\n self.assertEqual("ok", expected)\n', 'async def check(self):\n expected = await load()\n self.assertEqual("ok", expected)\n', 'test_value.py'],
    ['async function check() { const guard = load(); conditionalAssertion(guard); }\n', 'async function check() { const guard = await load(); conditionalAssertion(guard); }\n', 'case.test.js'],
  ])('rejects setup results flowing into expectations or indirect guards %#', async (old, next, path) => {
    const { session } = await setup(old, path);
    expect((await authorizeRepairCandidate(session, baseline, diff(old, next, path))).ok).toBe(false);
  }, 30_000);

  it('rejects conversion when a Python class overrides completion dispatch', async () => {
    const old = 'import unittest\nclass T(unittest.IsolatedAsyncioTestCase):\n def _callTestMethod(self, method):\n  method()\n def test_value(self):\n  self.assertEqual(load(), "ok")\n';
    const { session } = await setup(old, 'test_value.py');
    const next = old.replace(' def test_value', ' async def test_value').replace('self.assertEqual(load()', 'self.assertEqual(await load()');
    expect((await authorizeRepairCandidate(session, baseline, diff(old, next, 'test_value.py'))).ok).toBe(false);
  }, 30_000);

  it.each([
    `[1].forEach(async () => { expect(load()).toBe("ok"); });`,
    `[1].map(async () => { expect(load()).toBe("ok"); });`,
    `setTimeout(async () => { expect(load()).toBe("ok"); }, 0);`,
  ])('rejects already-async detached callbacks: %s', async (statement) => {
    const old = `import { test, expect } from 'vitest';\ntest('x', async () => { ${statement} });\n`;
    const { session } = await setup(old);
    expect((await authorizeRepairCandidate(session, baseline, diff(old, old.replace('expect(load())', 'expect(await load())')))).ok).toBe(false);
  });

  it('rejects an already-async Python helper without proven completion propagation', async () => {
    const old = 'async def check(self):\n self.assertEqual(load(), "ok")\n';
    const { session } = await setup(old, 'test_value.py');
    expect((await authorizeRepairCandidate(session, baseline, diff(old, old.replace('load()', 'await load()'), 'test_value.py'))).ok).toBe(false);
  }, 30_000);

  it.each(['JSON', 'URL'])('rejects shadowed %s in existing strict-check authority', async (name) => {
    const authority = await readFile(new URL('../../../placebo/corpus/repair-tsconfig-drift/fixture/case.test.js', import.meta.url), 'utf8');
    const old = '{"compilerOptions":{"strict":false}}\n';
    const session = createRepairAuthorizationSession({ baseline, failingCommand: 'pnpm test', policy: createDefaultRepositoryPolicy(), sources: [
      { path: 'tsconfig.json', startLine: 1, content: old, truncated: false },
      { path: 'case.test.js', startLine: 1, content: `import { ${name} } from './fake.js';\n${authority}`, truncated: false },
    ] });
    expect((await deriveRepairAuthorization(session, { kind: 'restore-strict-config', path: 'tsconfig.json', strictKey: 'strict', evidenceReferences: ['existing-repository-check'], controllerProbe: { id: 'strict-json', imageId: baseline.baselineImageId, exitCode: 1, output: 'strict expected true', sourceSha256: hash(old), failingCommand: 'pnpm test' } })).ok).toBe(false);
  });

});
