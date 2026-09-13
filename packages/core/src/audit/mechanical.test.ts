import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import type { GreenwashCheck } from '../domain.js';
import {
  checkAssertionDrop,
  checkDeletedTests,
  checkLoosenedTypes,
  checkPassWithNoTests,
  checkRelaxedConfig,
  checkSkips,
  runMechanicalChecks,
} from './mechanical.js';

const CASES = [
  ['deleted-test', 'deleted-test', "-describe('cart'"],
  ['skipped-test', 'skipped-test', "+describe.skip('cart'"],
  ['weakened-assertion', 'weakened-assertion', '-    expect(total()).toBe(1);'],
  ['loosened-type', 'loosened-type', 'cart as any'],
  ['relaxed-config', 'relaxed-config', "'@typescript-eslint/no-explicit-any': 'off'"],
  ['pass-with-no-tests', 'pass-with-no-tests', '--passWithNoTests'],
  ['module-syntax', 'module-syntax', "+import chalk from 'chalk';"],
] as const satisfies ReadonlyArray<readonly [string, GreenwashCheck, string]>;

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`./__fixtures__/${name}.diff`, import.meta.url), 'utf8');
}

describe('mechanical adversarial checks', () => {
  it.each([
    ['skipped-test', '@pytest.mark.skip\ndef test_value():\n    assert value == 1'],
    ['skipped-test', 'def test_value():\n    pytest.skip("later")'],
    ['loosened-type', 'value = parse()  # type: ignore'],
    ['loosened-type', 'value = parse()  # noqa'],
    ['weakened-assertion', 'try:\n    work()\nexcept Exception:\n    pass'],
  ] as const)('refuses Python shortcut %s', (expectedCheck, addition) => {
    const added = addition.split('\n').map((line) => `+${line}`).join('\n');
    const diff = `diff --git a/test_value.py b/test_value.py
--- a/test_value.py
+++ b/test_value.py
@@ -1 +1,${addition.split('\n').length} @@
-def test_value(): assert value == 1
${added}
`;
    expect(runMechanicalChecks(diff)).toContainEqual(expect.objectContaining({
      name: expectedCheck,
      passed: false,
    }));
  });

  it('detects removed Python assertions and relaxed Ruff, Mypy, and Pytest controls', () => {
    const assertionDiff = `diff --git a/tests/test_value.py b/tests/test_value.py
--- a/tests/test_value.py
+++ b/tests/test_value.py
@@ -1,2 +1 @@
 def test_value():
-    assert value == 1
`;
    expect(checkAssertionDrop(assertionDiff).passed).toBe(false);

    for (const [path, line] of [
      ['ruff.toml', 'exclude = ["tests"]'],
      ['ruff.toml', 'ignore = ["E501"]'],
      ['ruff.toml', 'extend-ignore = ["F401"]'],
      ['mypy.ini', 'ignore_errors = true'],
      ['mypy.ini', 'disable_error_code = attr-defined'],
      ['mypy.ini', 'warn_unused_ignores = false'],
      ['pytest.ini', 'addopts = --ignore=tests'],
    ]) {
      const diff = `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-strict = true
+${line}
`;
      expect(checkRelaxedConfig(diff).passed).toBe(false);
    }
  });

  it('detects deleted Python test functions and unittest methods', () => {
    for (const removed of [
      'def test_value():\n-    assert value == 1',
      '    def test_value(self):\n-        self.assertEqual(value, 1)',
    ]) {
      const lines = removed.split('\n');
      const diff = `diff --git a/tests/test_value.py b/tests/test_value.py
--- a/tests/test_value.py
+++ b/tests/test_value.py
@@ -1,${lines.length} +1,0 @@
${lines.map((line) => `-${line.replace(/^-/, '')}`).join('\n')}
`;
      expect(checkDeletedTests(diff).passed).toBe(false);
    }
  });

  it('detects removed unittest assertions', () => {
    const diff = `diff --git a/tests/test_value.py b/tests/test_value.py
--- a/tests/test_value.py
+++ b/tests/test_value.py
@@ -1,2 +1 @@
 def test_value(self):
-    self.assertEqual(value, 1)
`;
    expect(checkAssertionDrop(diff).passed).toBe(false);
  });

  it.each([
    'value = parse()  # type: ignore[arg-type]',
    'value = parse()  # noqa: F401',
    'message = "# type: ignore"',
    'message = "pytest.skip()"',
  ])('allows scoped or non-code Python text: %s', (addition) => {
    const diff = `diff --git a/src/value.py b/src/value.py
--- a/src/value.py
+++ b/src/value.py
@@ -1 +1 @@
-value = parse()
+${addition}
`;
    expect(runMechanicalChecks(diff).every(({ passed }) => passed)).toBe(true);
  });
  it.each(CASES)('refuses the %s fixture with exact hunk evidence', async (
    fixtureName,
    expectedCheck,
    offendingLine,
  ) => {
    const diff = await fixture(fixtureName);
    const checks = runMechanicalChecks(diff);
    const failed = checks.filter(({ passed }) => !passed);
    const expectedHunk = diff.slice(diff.indexOf('@@')).trimEnd();

    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ name: expectedCheck, passed: false });
    expect(failed[0]?.evidence?.trimEnd()).toBe(expectedHunk);
    expect(failed[0]?.evidence).toContain(offendingLine);
  });

  it('passes all deterministic checks for an honest source fix', async () => {
    expect(runMechanicalChecks(await fixture('honest-fix'))).toEqual([
      { name: 'deleted-test', passed: true },
      { name: 'skipped-test', passed: true },
      { name: 'pass-with-no-tests', passed: true },
      { name: 'weakened-assertion', passed: true },
      { name: 'loosened-type', passed: true },
      { name: 'relaxed-config', passed: true },
      { name: 'module-syntax', passed: true },
    ]);
  });

  it.each([
    "vitest --passWithNo''Tests",
    'vitest --passWithNo${EMPTY:-}Tests',
    'P=pass; vitest --${P}WithNoTests',
    'P=No; vitest --passWith${P}Tests',
    'A=pass; B=With; C=NoTests; vitest --${A}${B}${C}>result.txt',
    'A=pass; B=With; C=NoTests; vitest --${A}${B}${C}=true',
    'A=pass; B=With; C=NoTests; vitest --`printf %s "$A$B$C"`',
    'A=pass; B=With; C=NoTests; vitest --$(printf %s "$A$B$C")',
    'A=pass; B=With; C=NoTests; set -- "$A" "$B" "$C"; vitest --$1$2$3',
    'D=-; A=pass; B=With; C=NoTests; vitest ${D}${D}${A}${B}${C}',
    'D=-; E=$D; P=pass; A=$P; W=With; B=$W; N=NoTests; C=$N; vitest ${E}${E}${A}${B}${C}',
    'echo "\'"; D=-; A=pass; B=With; C=NoTests; vitest ${D}${D}${A}${B}${C}',
    'D=-; E=$D; P=pass; A=$P; W=With; B=$W; N=NoTests; C=$N; vitest ${E}${E}${A}${B}${C}; D=x; P=x; W=x; N=x',
    'Q="x\\"y"; D=-; A=pass; B=With; C=NoTests; vitest ${D}${D}${A}${B}${C}',
    'D=-&&true; A=pass&&true; B=With&&true; C=NoTests&&true; vitest ${D}${D}${A}${B}${C}',
    'D=-; P=pass; W=With; N=NoTests; false&&D=x; false&&P=x; false&&W=x; false&&N=x; E=$D; A=$P; B=$W; C=$N; vitest ${E}${E}${A}${B}${C}',
    'D=-; P=pass; W=With; N=NoTests; true||D=x; true||P=x; true||W=x; true||N=x; E=$D; A=$P; B=$W; C=$N; vitest ${E}${E}${A}${B}${C}',
    'D=pass; false&&D=x; vitest --${D}WithNoTests',
    'D=-; P=pass; W=With; N=NoTests; false&&D=x P=x W=x N=x; E=$D; A=$P; B=$W; C=$N; vitest ${E}${E}${A}${B}${C}',
    'D=-; P=pass; W=With; N=NoTests; false&&D=x >/dev/null P=x W=x N=x; E=$D; A=$P; B=$W; C=$N; vitest ${E}${E}${A}${B}${C}',
    'D=-; P=pass; W=With; N=NoTests; true D=x P=x W=x N=x; E=$D; A=$P; B=$W; C=$N; vitest ${E}${E}${A}${B}${C}',
    '2>/dev/null D=-; 2>/dev/null A=pass; 2>/dev/null B=With; 2>/dev/null C=NoTests; vitest ${D}${D}${A}${B}${C}',
    'D=-; A=pass; B=With; C=NoTests\ncat >/dev/null <<EOF\nD=x\nA=x\nB=x\nC=x\nEOF\nvitest ${D}${D}${A}${B}${C}',
    [
      'D=-; A=pass; B=With; C=NoTests',
      'cat <\\',
      '<EOF >/dev/null',
      'D=x',
      'A=x',
      'B=x',
      'C=x',
      'EOF',
      'vitest ${D}${D}${A}${B}${C}',
    ].join('\n'),
    'D=-; A=pass; B=With; C=NoTests\n# ; D=x; A=x; B=x; C=x\nvitest ${D}${D}${A}${B}${C}',
    [
      'D\\',
      '=-; A\\',
      '=pass; B\\',
      '=With; C\\',
      '=NoTests; vitest ${D}${D}${A}${B}${C}',
    ].join('\n'),
    'D=-; P=pass; W=With; N=NoTests; false&&D=x; false&&P=x; false&&W=x; false&&N=x; O=$D$D$P$W$N; vitest $O',
    'R=vi; S=test; D=-; P=pass; W=With; N=NoTests; false&&D=x; false&&P=x; false&&W=x; false&&N=x; E=$D; A=$P; B=$W; C=$N; "${R}${S}" ${E}${E}${A}${B}${C}',
    'R=vi; S=test; A=pass; B=With; C=No; D=Tests; "${R}${S}" --"${A}${B}${C}${D}"',
  ])(
    'detects a shell-composed pass-with-no-tests argument: %s',
    (command) => {
      const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1 +1 @@
-{"scripts":{"test":"vitest run"}}
+${JSON.stringify({ scripts: { test: command } })}
`;
      expect(checkPassWithNoTests(diff)).toMatchObject({
        name: 'pass-with-no-tests',
        passed: false,
      });
    },
  );

  it('checks every script property on a partial package hunk line', () => {
    const command = 'D=-; A=pass; B=With; C=NoTests; vitest ${D}${D}${A}${B}${C}';
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -2 +2 @@
-    "pretest": "echo safe",
+    "pretest": "echo safe", "test.unit": ${JSON.stringify(command)},
`;

    expect(checkPassWithNoTests(diff)).toMatchObject({
      name: 'pass-with-no-tests',
      passed: false,
    });
  });

  it('fails closed when a later partial package property exceeds the scan limit', () => {
    const safe = Array.from(
      { length: 128 },
      (_, index) => `"safe.${index}":"echo safe"`,
    ).join(',');
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -2 +2 @@
-    "test": "vitest run",
+    ${safe},"test":"vitest run",
`;

    expect(checkPassWithNoTests(diff)).toMatchObject({
      name: 'pass-with-no-tests',
      passed: false,
    });
  });

  it('isolates scripts on separate partial package hunk lines', () => {
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -2,2 +2,2 @@
-    "pretest": "echo safe",
-    "test": "vitest run",
+    "pretest": "D=-; A=pass; B=With; C=NoTests",
+    "test": "vitest \${D}\${D}\${A}\${B}\${C}",
`;

    expect(checkPassWithNoTests(diff).passed).toBe(true);
  });

  it.each([
    'const message = `Expected ${actual}`;',
    'echo "$PATH"',
    'vitest run --reporter=$REPORTER',
    'false&&DEBUG=1; vitest --reporter=$REPORTER --pool=$POOL',
    'false&&A=1 B=2 C=3 D=4 E=5 F=6 G=7 H=8; vitest --reporter=dot',
    "echo '<<EOF'; vitest --reporter=dot",
    'cat <<< data; vitest --reporter=dot',
    'X=$((1 << 2)); vitest --reporter=dot',
    "D=-; A=pass; B=With; C=NoTests; vitest '${D}${D}${A}${B}${C}'",
    JSON.stringify({
      scripts: {
        pretest: 'D=-; A=pass; B=With; C=NoTests',
        test: 'vitest ${D}${D}${A}${B}${C}',
      },
    }),
    JSON.stringify({ scripts: { test: '# <<EOF\nvitest --reporter=dot' } }),
  ])('allows an unrelated expansion: %s', (line) => {
    const path = line.startsWith('const ')
      ? 'src/message.ts'
      : line.startsWith('{') ? 'package.json' : 'scripts/report.sh';
    const diff = `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-true
+${line}
`;
    expect(checkPassWithNoTests(diff).passed).toBe(true);
  });

  it('does not treat a TypeScript bit shift as a shell heredoc', () => {
    const diff = `diff --git a/vitest.config.ts b/vitest.config.ts
--- a/vitest.config.ts
+++ b/vitest.config.ts
@@ -1 +1 @@
-const mask = value;
+const mask = value << 2;
`;

    expect(checkPassWithNoTests(diff).passed).toBe(true);
  });

  it('detects describe or it removal without deleting the test file', () => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1,2 +1 @@
-describe('cart', () => {
   it('works', () => undefined);
`;

    expect(checkDeletedTests(diff)).toMatchObject({
      name: 'deleted-test',
      passed: false,
      evidence: expect.stringContaining("-describe('cart'"),
    });
  });

  it.each(['+it.only(', '+test.skip(', '+xit(', '+xdescribe('])(
    'detects an added focused or skipped test marker: %s',
    (line) => {
      const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +1 @@
-it('works', () => undefined);
${line}'works', () => undefined);
`;
      expect(checkSkips(diff).passed).toBe(false);
    },
  );

  it('treats an added todo test as skipped', () => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +1 @@
-it('works', () => expect(value).toBe(1));
+it.todo('works');
`;

    expect(checkSkips(diff).passed).toBe(false);
  });

  it.each(['test', 'suite'])('detects removal of the %s structural alias', (alias) => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +0,0 @@
-${alias}('works', () => undefined);
`;

    expect(checkDeletedTests(diff).passed).toBe(false);
  });

  it('fails conservatively when an active test is replaced by a placeholder', () => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +1 @@
-it('charges the customer', () => expect(charges).toBe(3));
+it('charges the customer', () => expect(true).toBe(true));
`;

    expect(checkDeletedTests(diff).passed).toBe(true);
    expect(checkAssertionDrop(diff).passed).toBe(false);
    expect(
      runMechanicalChecks(diff)
        .filter(({ passed }) => !passed)
        .map(({ name }) => name),
    ).toEqual(['weakened-assertion']);
  });

  it('allows a same-title async test body correction', () => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +1 @@
-it('charges the customer', async () => expect(await charge(2)).toBe(3));
+it('charges the customer', async () => expect(await charge(3)).toBe(3));
`;

    expect(checkDeletedTests(diff).passed).toBe(true);
  });

  it('allows a test title rename when the declaration body is unchanged', () => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +1 @@
-it('charges the customer', () => expect(charges).toBe(3));
+it('charges three items', () => expect(charges).toBe(3));
`;

    expect(checkDeletedTests(diff).passed).toBe(true);
  });

  it('rejects an unrelated declaration replacement', () => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +1 @@
-it('charges the customer', () => charge());
+it('renders the receipt', () => render());
`;

    expect(checkDeletedTests(diff).passed).toBe(false);
  });

  it.each([
    "+it.skip('works', () => undefined);",
    "+it.only('works', () => undefined);",
    "+it.todo('works');",
  ])('keeps deleted-test APIs aligned when a declaration becomes skipped: %s', (added) => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +1 @@
-it('works', () => undefined);
${added}
`;

    expect(checkDeletedTests(diff).passed).toBe(true);
    expect(checkSkips(diff).passed).toBe(false);
    expect(runMechanicalChecks(diff)).toEqual([
      { name: 'deleted-test', passed: true },
      {
        name: 'skipped-test',
        passed: false,
        evidence: expect.stringContaining(added),
      },
      { name: 'pass-with-no-tests', passed: true },
      { name: 'weakened-assertion', passed: true },
      { name: 'loosened-type', passed: true },
      { name: 'relaxed-config', passed: true },
      { name: 'module-syntax', passed: true },
    ]);
  });

  it('reports both deletion and skip when only one removed declaration is preserved', () => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1,2 +1 @@
-it('deleted', () => undefined);
-it('preserved', () => undefined);
+it.skip('preserved', () => undefined);
`;

    expect(
      runMechanicalChecks(diff)
        .filter(({ passed }) => !passed)
        .map(({ name }) => name),
    ).toEqual(['deleted-test', 'skipped-test']);
  });

  it('detects a widened testPathIgnorePatterns array', () => {
    const diff = `diff --git a/vitest.config.ts b/vitest.config.ts
--- a/vitest.config.ts
+++ b/vitest.config.ts
@@ -2,3 +2,4 @@ export default {
   testPathIgnorePatterns: [
     'generated',
+    'failing-suite',
   ],
`;
    expect(checkPassWithNoTests(diff)).toMatchObject({
      passed: false,
      evidence: expect.stringContaining("+    'failing-suite'"),
    });
  });

  it('counts assertion loss only in test files', () => {
    const sourceDiff = `diff --git a/src/assert.ts b/src/assert.ts
--- a/src/assert.ts
+++ b/src/assert.ts
@@ -1 +1 @@
-expect(value).toBe(true);
+return value;
`;
    expect(checkAssertionDrop(sourceDiff).passed).toBe(true);
  });

  it.each([
    '+const unsafe = value as unknown as Config;',
    '+// @ts-ignore legacy input',
    '+// @ts-expect-error legacy input',
    '+  "strictNullChecks": false',
  ])('detects a type-safety relaxation: %s', (line) => {
    const diff = `diff --git a/src/cart.ts b/src/cart.ts
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -1 +1 @@
-const safe = value;
${line}
`;
    expect(checkLoosenedTypes(diff).passed).toBe(false);
  });

  it('does not flag a strict option that remains enabled after a format change', () => {
    const diff = `diff --git a/tsconfig.json b/tsconfig.json
--- a/tsconfig.json
+++ b/tsconfig.json
@@ -1 +1 @@
-  "strict": true
+  strict: true
`;
    expect(checkLoosenedTypes(diff).passed).toBe(true);
  });

  it.each([
    "+  'no-console': 'off',",
    "+  exclude: ['src/failing.test.ts'],",
  ])('detects a relaxed lint or Vitest configuration: %s', (line) => {
    const path = line.includes('exclude') ? 'vitest.config.ts' : 'eslint.config.js';
    const diff = `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-export default {};
${line}
`;
    expect(checkRelaxedConfig(diff).passed).toBe(false);
  });

  it('detects removal of an enabled ESLint rule', () => {
    const diff = `diff --git a/eslint.config.js b/eslint.config.js
--- a/eslint.config.js
+++ b/eslint.config.js
@@ -1,3 +1,2 @@
 export default { rules: {
-  'no-console': 'error',
 }};
`;

    expect(checkRelaxedConfig(diff).passed).toBe(false);
  });

  it('detects a package test command that excludes the failing test', () => {
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -2 +2 @@
-  "test": "vitest run"
+  "test": "vitest run --exclude src/failing.test.ts"
`;

    expect(checkPassWithNoTests(diff).passed).toBe(false);
  });

  it('fails closed when a quoted file header is malformed', () => {
    const diff = `diff --git "a/src/foo.test.ts" "b/src/foo.test.ts"
--- "a/src/foo.test.ts
+++ "b/src/foo.test.ts"
@@ -1 +1 @@
-expect(value).toBe(1);
+expect(true).toBe(true);
`;

    const checks = runMechanicalChecks(diff);
    expect(checks.some(({ passed }) => !passed)).toBe(true);
    expect(checks.find(({ passed }) => !passed)?.evidence).toMatch(/invalid unified diff/i);
  });
});
