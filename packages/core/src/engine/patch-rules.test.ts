import { describe, expect, it } from 'vitest';

import type { Diagnosis } from '../domain.js';
import { vetPatch } from './patch-rules.js';

const sourceDiff = `diff --git a/src/add.ts b/src/add.ts
index 1111111..2222222 100644
--- a/src/add.ts
+++ b/src/add.ts
@@ -1 +1 @@
-export const add = () => 1;
+export const add = () => 2;
`;

function diagnosis(failureClass: Diagnosis['class']): Diagnosis {
  return {
    class: failureClass,
    confidence: 0.9,
    signals: [],
    failingCmd: 'pnpm test',
    errorExcerpt: 'failure',
  };
}

describe('vetPatch', () => {
  it.each([
    ['test_value.py', '@pytest.mark.skip'],
    ['src/value.py', 'value = parse()  # type: ignore'],
    ['src/value.py', 'value = parse()  # noqa'],
    ['src/value.py', 'except Exception: pass'],
    ['ruff.toml', 'exclude = ["tests"]'],
  ])('rejects Python shortcut in %s before execution', (path, addition) => {
    const diff = `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-safe = true
+${addition}
`;
    expect(vetPatch(diff, diagnosis('test-bug')).ok).toBe(false);
  });

  it('treats root Python test modules as conventional test paths', () => {
    const diff = `diff --git a/test_value.py b/test_value.py
deleted file mode 100644
--- a/test_value.py
+++ /dev/null
@@ -1 +0,0 @@
-def test_value(): assert True
`;
    expect(vetPatch(diff, diagnosis('test-bug')).violations).toContain('deletes test file: test_value.py');
  });
  it('rejects deletion of a test file even for a test bug', () => {
    const diff = `diff --git a/src/foo.test.ts b/src/foo.test.ts
deleted file mode 100644
index 1111111..0000000
--- a/src/foo.test.ts
+++ /dev/null
@@ -1 +0,0 @@
-throw new Error('expected');
`;

    expect(vetPatch(diff, diagnosis('test-bug'))).toEqual({
      ok: false,
      violations: ['deletes test file: src/foo.test.ts'],
    });
  });

  it.each(['tests/foo.ts', '__tests__/foo.ts', 'e2e/checkout.ts'])(
    'rejects deletion of conventional test path %s',
    (path) => {
      const diff = `diff --git a/${path} b/${path}
deleted file mode 100644
index 1111111..0000000
--- a/${path}
+++ /dev/null
@@ -1 +0,0 @@
-throw new Error('expected');
`;

      expect(vetPatch(diff, diagnosis('test-bug')).violations).toEqual([
        `deletes test file: ${path}`,
      ]);
    },
  );

  it('rejects test edits even when the diagnosis is test-bug without a grant', () => {
    const diff = `diff --git a/src/foo.spec.ts b/src/foo.spec.ts
index 1111111..2222222 100644
--- a/src/foo.spec.ts
+++ b/src/foo.spec.ts
@@ -1 +1 @@
-expect(value).toBe(1);
+expect(value).toBe(2);
`;

    expect(vetPatch(diff, diagnosis('test-assertion')).violations).toEqual([
      'touches test file: src/foo.spec.ts',
    ]);
    expect(vetPatch(diff, diagnosis('test-bug'))).toEqual({
      ok: false,
      violations: ['touches test file: src/foo.spec.ts'],
    });
  });

  it('rejects tool configuration edits even with an env-config diagnosis without a grant', () => {
    const diff = `diff --git a/vitest.config.ts b/vitest.config.ts
index 1111111..2222222 100644
--- a/vitest.config.ts
+++ b/vitest.config.ts
@@ -1 +1 @@
-export default {};
+export default { test: {} };
`;

    expect(vetPatch(diff, diagnosis('test-assertion')).violations).toEqual([
      'touches tool config: vitest.config.ts',
    ]);
    expect(vetPatch(diff, diagnosis('env-config'))).toEqual({
      ok: false,
      violations: ['touches tool config: vitest.config.ts'],
    });
  });

  it.each(['.eslintignore', 'vitest.workspace.ts', 'vite.config.ts'])(
    'rejects control-file edit %s outside env-config',
    (path) => {
      const diff = `diff --git a/${path} b/${path}
index 1111111..2222222 100644
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-src/generated.ts
+src/failing.ts
`;

      expect(vetPatch(diff, diagnosis('build')).violations).toEqual([
        `touches tool config: ${path}`,
      ]);
    },
  );

  it('accepts a source-only diff', () => {
    expect(vetPatch(sourceDiff, diagnosis('test-assertion'))).toEqual({
      ok: true,
      violations: [],
    });
  });

  it.each([
    ['33802470792', "diff --git a/app.cjs b/app.cjs\nindex fb07b6b..399e907 100644\n--- a/app.cjs\n+++ b/app.cjs\n@@ -1,2 +1,2 @@\n-const chalk = require('chalk');\n+import chalk from 'chalk';\n exports.renderStatus = () => chalk.green('ready');\n"],
    ['33802888547', "diff --git a/app.cjs b/app.cjs\nindex 56cd7e1..0b9bcac 100644\n--- a/app.cjs\n+++ b/app.cjs\n@@ -1,2 +1,2 @@\n-const fetch = require('node-fetch');\n+import fetch from 'node-fetch';\n exports.fetchName = () => fetch('data:Juan').then((response) => response.text());\n"],
    ['33803376832', "diff --git a/app.cjs b/app.cjs\nindex 58cfe41..6e92c16 100644\n--- a/app.cjs\n+++ b/app.cjs\n@@ -1,2 +1,2 @@\n-const execa = require('execa');\n+import { execa } from 'execa';\n exports.nodeVersion = () => execa('node', ['--version']).stdout;\n"],
  ])('replays live Placebo run %s: rejects ES module syntax added to a .cjs file', (_runId, diff) => {
    expect(vetPatch(diff, diagnosis('dep-upstream-breaking'))).toEqual({
      ok: false,
      violations: ['adds ES module syntax to CommonJS file: app.cjs'],
    });
  });

  it('accepts the CommonJS default-import repair for an ESM-only release', () => {
    const diff = `diff --git a/app.cjs b/app.cjs
--- a/app.cjs
+++ b/app.cjs
@@ -1,2 +1,2 @@
-const chalk = require('chalk');
+const chalk = require('chalk').default;
 exports.renderStatus = () => chalk.green('ready');
`;
    expect(vetPatch(diff, diagnosis('dep-upstream-breaking'))).toEqual({ ok: true, violations: [] });
  });

  it('rejects pass-with-no-tests bypasses before the candidate race', () => {
    const diff = `diff --git a/package.json b/package.json
index 1111111..2222222 100644
--- a/package.json
+++ b/package.json
@@ -1 +1 @@
-{"scripts":{"test":"vitest run"}}
+{"scripts":{"test":"vitest run --passWithNoTests"}}
`;

    expect(vetPatch(diff, diagnosis('test-assertion')).violations).toEqual([
      'adds pass-with-no-tests bypass',
    ]);
  });

  it.each([
    "vitest run --passWithNo''Tests",
    'vitest run --passWithNo${UNSET:-}Tests',
    'P=passWith; vitest run --${P}NoTests',
    'P=pass; vitest run --${P}WithNoTests',
    'P=No; vitest run --passWith${P}Tests',
    'P=With; vitest run --pass${P}NoTests',
    'P=Tests; vitest run --passWithNo${P}',
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
    'R=vi; S=test; A=pass; B=With; C=No; D=Tests; "${R}${S}" run --"${A}${B}${C}${D}"',
  ])('rejects a shell-composed pass-with-no-tests bypass: %s', (command) => {
    const diff = `diff --git a/package.json b/package.json
index 1111111..2222222 100644
--- a/package.json
+++ b/package.json
@@ -1 +1 @@
-{"scripts":{"test":"vitest run"}}
+${JSON.stringify({ scripts: { test: command } })}
`;

    expect(vetPatch(diff, diagnosis('test-assertion')).violations).toEqual([
      'adds pass-with-no-tests bypass',
    ]);
  });

  it('checks every script property on a partial package hunk line', () => {
    const command = 'D=-; A=pass; B=With; C=NoTests; vitest ${D}${D}${A}${B}${C}';
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -2 +2 @@
-    "pretest": "echo safe",
+    "pretest": "echo safe", "test.unit": ${JSON.stringify(command)},
`;

    expect(vetPatch(diff, diagnosis('test-assertion')).violations).toEqual([
      'adds pass-with-no-tests bypass',
    ]);
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

    expect(vetPatch(diff, diagnosis('test-assertion')).violations).toEqual([
      'adds pass-with-no-tests bypass',
    ]);
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

    expect(vetPatch(diff, diagnosis('test-assertion')).violations).toEqual([]);
  });

  it('rejects a passWithNoTests configuration property without a runner name', () => {
    const diff = `diff --git a/jest.config.js b/jest.config.js
index 1111111..2222222 100644
--- a/jest.config.js
+++ b/jest.config.js
@@ -1 +1 @@
-export default {};
+export default { passWithNoTests: true };
`;

    expect(vetPatch(diff, diagnosis('env-config')).violations).toEqual([
      'adds pass-with-no-tests bypass',
    ]);
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
  ])('does not treat an unrelated expansion as a test bypass: %s', (line) => {
    const path = line.startsWith('const ')
      ? 'src/message.ts'
      : line.startsWith('{') ? 'package.json' : 'scripts/report.sh';
    const diff = `diff --git a/${path} b/${path}
index 1111111..2222222 100644
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-true
+${line}
`;

    expect(vetPatch(diff, diagnosis('test-assertion')).violations).toEqual([]);
  });

  it('does not treat a TypeScript bit shift as a shell heredoc', () => {
    const diff = `diff --git a/vitest.config.ts b/vitest.config.ts
--- a/vitest.config.ts
+++ b/vitest.config.ts
@@ -1 +1 @@
-const mask = value;
+const mask = value << 2;
`;

    expect(vetPatch(diff, diagnosis('env-config')).violations).toEqual(['touches tool config: vitest.config.ts']);
  });

  it('cannot hide a test edit behind a quoted path or a safe source edit', () => {
    const quotedTestDiff = `${sourceDiff}diff --git "a/src/foo test.test.ts" "b/src/foo test.test.ts"
index 1111111..2222222 100644
--- "a/src/foo test.test.ts"
+++ "b/src/foo test.test.ts"
@@ -1 +1 @@
-expect(value).toBe(1);
+expect(value).toBe(2);
`;

    expect(vetPatch(quotedTestDiff, diagnosis('build')).violations).toEqual([
      'touches test file: src/foo test.test.ts',
    ]);
  });

  it('checks both sides of a rename', () => {
    const renameDiff = `diff --git a/src/foo.test.ts b/src/foo.ts
similarity index 100%
rename from src/foo.test.ts
rename to src/foo.ts
`;

    expect(vetPatch(renameDiff, diagnosis('build')).violations).toEqual([
      'deletes test file: src/foo.test.ts',
    ]);
  });

  it('does not let hunk content overwrite protected file headers', () => {
    const spoofedHeaders = `diff --git a/src/foo.test.ts b/src/foo.test.ts
index 1111111..2222222 100644
--- a/src/foo.test.ts
+++ b/src/foo.test.ts
@@ -1 +1 @@
--- a/src/safe.ts
+++ b/src/safe.ts
`;

    expect(vetPatch(spoofedHeaders, diagnosis('build')).violations).toEqual([
      'touches test file: src/foo.test.ts',
    ]);
  });

  it.each([
    {
      label: 'unquoted',
      from: 'src/foo.test.ts',
      to: 'src/foo.ts',
      expected: 'src/foo.test.ts',
    },
    {
      label: 'quoted',
      from: '"src/foo test.test.ts"',
      to: '"src/foo test.ts"',
      expected: 'src/foo test.test.ts',
    },
  ])('treats a $label test-path rename as a test deletion', ({
    from,
    to,
    expected,
  }) => {
    const renameDiff = `diff --git a/src/foo.test.ts b/src/foo.ts
similarity index 100%
rename from ${from}
rename to ${to}
`;

    expect(vetPatch(renameDiff, diagnosis('test-bug')).violations).toEqual([
      `deletes test file: ${expected}`,
    ]);
  });

  it('fails closed when the reply is not a unified diff', () => {
    expect(vetPatch('Looks good to me.', diagnosis('build')).violations).toEqual([
      'patch has no recognized file changes',
    ]);
  });

  it('fails closed when a file change has incomplete headers', () => {
    const incomplete = `diff --git a/src/add.ts b/src/add.ts
--- a/src/add.ts
@@ -1 +1 @@
-export const add = () => 1;
+export const add = () => 2;
`;

    expect(vetPatch(incomplete, diagnosis('build')).violations).toEqual([
      'patch contains an unrecognized or incomplete file change',
    ]);
  });

  it('fails closed when a quoted file header is malformed', () => {
    const malformed = `diff --git "a/src/foo.test.ts" "b/src/foo.test.ts"
--- "a/src/foo.test.ts
+++ "b/src/foo.test.ts"
@@ -1 +1 @@
-expect(value).toBe(1);
+expect(value).toBe(2);
`;

    expect(vetPatch(malformed, diagnosis('test-bug')).violations).toEqual([
      'patch contains an unrecognized or incomplete file change',
    ]);
  });
});
