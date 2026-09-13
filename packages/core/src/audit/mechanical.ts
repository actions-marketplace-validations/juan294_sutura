import type { GreenwashCheck } from '../domain.js';
import {
  isConventionalTestPath,
  parseUnifiedDiff,
  unifiedHeaderText,
  unifiedHunkText,
  type ParsedUnifiedDiff,
  type UnifiedDiffFile,
  type UnifiedDiffHunk,
} from '../diff/unified.js';
import {
  containsPassWithNoTestsBypass,
  isShellCommandPath,
  isTestCommandPath,
} from '../engine/test-bypass.js';
import { addsEsModuleSyntax, isCommonJsPath } from '../engine/module-syntax.js';
import {
  hasBroadPythonSuppression,
  hasPythonSkip,
  hasRelaxedPythonConfig,
  hasSwallowedPythonException,
} from '../engine/python-safety.js';

export interface MechanicalCheck {
  name: Exclude<GreenwashCheck, 'llm-adjudication'>;
  passed: boolean;
  evidence?: string;
}

const ESLINT_CONFIG =
  /(?:^|\/)(?:eslint\.config\.[^/]+|\.eslintrc(?:\.[^/]+)?|\.eslintignore)$/;
const VITEST_CONFIG =
  /(?:^|\/)(?:vitest\.(?:config|workspace)\.[^/]+|vite\.config\.[^/]+)$/;
const STRICT_FLAG =
  /\b(?:strict|noImplicitAny|strictNullChecks|strictFunctionTypes|strictBindCallApply|strictPropertyInitialization|noImplicitThis|useUnknownInCatchVariables|alwaysStrict)\b/;
const STRUCTURAL_TEST_CALL =
  /\b(describe|it|test|suite)((?:\.(?:each|concurrent|todo|skip|only))*)\s*\(/g;

interface StructuralDeclaration {
  base: string;
  title: string | null;
  body: string;
}

function passed(name: MechanicalCheck['name']): MechanicalCheck {
  return { name, passed: true };
}

function failed(
  name: MechanicalCheck['name'],
  file: UnifiedDiffFile,
  hunk?: UnifiedDiffHunk,
): MechanicalCheck {
  return {
    name,
    passed: false,
    evidence: hunk ? unifiedHunkText(hunk) : unifiedHeaderText(file),
  };
}

function invalidDiff(parsed: ParsedUnifiedDiff): MechanicalCheck | undefined {
  return parsed.valid && parsed.files.length > 0
    ? undefined
    : {
        name: 'deleted-test',
        passed: false,
        evidence: `Invalid unified diff: ${
          parsed.errors.join('; ') || 'no recognized file changes'
        }`,
      };
}

function filePath(file: UnifiedDiffFile): string {
  return file.newPath ?? file.oldPath ?? '';
}

function countMatches(lines: readonly string[], pattern: RegExp): number {
  return lines.reduce((total, line) => total + [...line.matchAll(pattern)].length, 0);
}

function stringArgument(value: string): { title: string; rest: string } | null {
  const quote = value[0];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;

  let escaped = false;
  for (let index = 1; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === quote) {
      return {
        title: value.slice(1, index),
        rest: value.slice(index + 1),
      };
    }
  }
  return null;
}

function structuralDeclarations(lines: readonly string[]): StructuralDeclaration[] {
  const declarations: StructuralDeclaration[] = [];
  for (const line of lines) {
    for (const match of line.matchAll(STRUCTURAL_TEST_CALL)) {
      const base = match[1];
      if (!base || match.index === undefined) continue;

      const tail = line.slice(match.index + match[0].length).trimStart();
      const argument = stringArgument(tail);
      declarations.push({
        base,
        title: argument?.title ?? null,
        body: (argument?.rest ?? tail).trim(),
      });
    }
  }
  return declarations;
}

function sameStructuralDeclaration(
  removed: StructuralDeclaration,
  added: StructuralDeclaration,
): boolean {
  if (removed.base !== added.base) return false;
  if (removed.title !== null && removed.title === added.title) return true;
  return removed.body === added.body;
}

function pythonTestDeclarations(lines: readonly string[]): string[] {
  return lines.flatMap((line) => {
    const match = /^\s*(?:async\s+)?def\s+(test_[A-Za-z0-9_]+)\s*\(/u.exec(line);
    return match?.[1] === undefined ? [] : [match[1]];
  });
}

function deletedTests(files: readonly UnifiedDiffFile[]): MechanicalCheck {
  for (const file of files) {
    const renamed =
      file.oldPath !== null && file.newPath !== null && file.oldPath !== file.newPath;
    if (
      file.oldPath &&
      isConventionalTestPath(file.oldPath) &&
      (file.deleted || renamed)
    ) {
      return failed('deleted-test', file, file.hunks[0]);
    }

    if (!isConventionalTestPath(filePath(file))) continue;
    const added = file.hunks.flatMap((hunk) => structuralDeclarations(hunk.additions));
    const matchedAdditions = new Set<number>();
    for (const hunk of file.hunks) {
      for (const removed of structuralDeclarations(hunk.removals)) {
        const match = added.findIndex(
          (candidate, index) =>
            !matchedAdditions.has(index) &&
            sameStructuralDeclaration(removed, candidate),
        );
        if (match === -1) return failed('deleted-test', file, hunk);
        matchedAdditions.add(match);
      }
    }
    if (/\.pyi?$/u.test(filePath(file))) {
      const addedPython = file.hunks.flatMap((hunk) => pythonTestDeclarations(hunk.additions));
      const remaining = [...addedPython];
      for (const hunk of file.hunks) {
        for (const removed of pythonTestDeclarations(hunk.removals)) {
          const match = remaining.indexOf(removed);
          if (match === -1) return failed('deleted-test', file, hunk);
          remaining.splice(match, 1);
        }
      }
    }
  }
  return passed('deleted-test');
}

export function checkDeletedTests(diff: string): MechanicalCheck {
  const parsed = parseUnifiedDiff(diff);
  return invalidDiff(parsed) ?? deletedTests(parsed.files);
}

function skips(files: readonly UnifiedDiffFile[]): MechanicalCheck {
  for (const file of files) {
    for (const hunk of file.hunks) {
      if (
        (!/\.pyi?$/u.test(filePath(file)) && hunk.additions.some((line) =>
          /\.(?:skip|only|todo)(?:\.each)?\s*\(|\b(?:xit|xdescribe)\s*\(/.test(line),
        )) || hasPythonSkip(hunk.additions)
      ) {
        return failed('skipped-test', file, hunk);
      }
    }
  }
  return passed('skipped-test');
}

export function checkSkips(diff: string): MechanicalCheck {
  const parsed = parseUnifiedDiff(diff);
  return invalidDiff(parsed) ?? skips(parsed.files);
}

function passWithNoTests(files: readonly UnifiedDiffFile[]): MechanicalCheck {
  for (const file of files) {
    for (const hunk of file.hunks) {
      const added = hunk.additions;
      if (containsPassWithNoTestsBypass(added, {
        allowComposed: isTestCommandPath(filePath(file)),
        decodePackageJson: filePath(file) === 'package.json',
        shellCommands: isShellCommandPath(filePath(file)),
      })) {
        return failed('pass-with-no-tests', file, hunk);
      }

      if (
        filePath(file) === 'package.json' &&
        added.some((line) => /\bvitest\b.*(?:^|\s)--exclude(?:\s|=)/.test(line))
      ) {
        return failed('pass-with-no-tests', file, hunk);
      }

      if (/\btestPathIgnorePatterns\b/.test(unifiedHunkText(hunk))) {
        const grew = added.some((line) => {
          const withoutKey = line.replace(/^.*\btestPathIgnorePatterns\b\s*:\s*/, '');
          return /['"`][^'"`]+['"`]/.test(withoutKey);
        });
        if (grew) return failed('pass-with-no-tests', file, hunk);
      }
    }
  }
  return passed('pass-with-no-tests');
}

export function checkPassWithNoTests(diff: string): MechanicalCheck {
  const parsed = parseUnifiedDiff(diff);
  return invalidDiff(parsed) ?? passWithNoTests(parsed.files);
}

function assertionDrop(files: readonly UnifiedDiffFile[]): MechanicalCheck {
  for (const file of files) {
    if (!isConventionalTestPath(filePath(file))) continue;

    const placeholder = file.hunks.find((hunk) =>
      hunk.additions.some((line) => /\bexpect\s*\(\s*true\s*\)/.test(line)),
    );
    if (placeholder) return failed('weakened-assertion', file, placeholder);

    const removed = file.hunks.reduce(
      (total, hunk) => total + countMatches(hunk.removals, /\bexpect\s*\(/g),
      0,
    );
    const added = file.hunks.reduce(
      (total, hunk) => total + countMatches(hunk.additions, /\bexpect\s*\(/g),
      0,
    );
    if (removed > added) {
      const offending = file.hunks.find(
        (hunk) => countMatches(hunk.removals, /\bexpect\s*\(/g) > 0,
      );
      return failed('weakened-assertion', file, offending);
    }
    if (/\.pyi?$/u.test(filePath(file))) {
      const pythonAssertion = /(?:^|\s)assert\s+|\b(?:self|cls)\.(?:assert[A-Z][A-Za-z0-9_]*|fail)\s*\(/g;
      const removedPython = file.hunks.reduce(
        (total, hunk) => total + countMatches(hunk.removals, pythonAssertion),
        0,
      );
      const addedPython = file.hunks.reduce(
        (total, hunk) => total + countMatches(hunk.additions, pythonAssertion),
        0,
      );
      if (removedPython > addedPython) {
        return failed('weakened-assertion', file, file.hunks.find((hunk) =>
          hunk.removals.some((line) => /(?:^|\s)assert\s+|\b(?:self|cls)\.(?:assert[A-Z][A-Za-z0-9_]*|fail)\s*\(/u.test(line))));
      }
    }
    const swallowed = file.hunks.find((hunk) => hasSwallowedPythonException(hunk.additions));
    if (swallowed) return failed('weakened-assertion', file, swallowed);
  }
  return passed('weakened-assertion');
}

export function checkAssertionDrop(diff: string): MechanicalCheck {
  const parsed = parseUnifiedDiff(diff);
  return invalidDiff(parsed) ?? assertionDrop(parsed.files);
}

function loosenedTypes(files: readonly UnifiedDiffFile[]): MechanicalCheck {
  for (const file of files) {
    for (const hunk of file.hunks) {
      const added = hunk.additions;
      const retainedStrictFlags = new Set(
        added
          .filter((line) => /[:=]\s*true\b/.test(line))
          .map((line) => STRICT_FLAG.exec(line)?.[0])
          .filter((flag): flag is string => flag !== undefined),
      );
      if (
        added.some((line) =>
          /:\s*any\b|\bas\s+any\b|\bas\s+unknown\s+as\b|@ts-(?:ignore|nocheck|expect-error)\b/.test(
            line,
          ),
        ) ||
        added.some(
          (line) => STRICT_FLAG.test(line) && /[:=]\s*false\b/.test(line),
        ) ||
        hunk.removals.some(
          (line) => {
            const flag = STRICT_FLAG.exec(line)?.[0];
            return (
              flag !== undefined &&
              /[:=]\s*true\b/.test(line) &&
              !retainedStrictFlags.has(flag)
            );
          },
        ) || hasBroadPythonSuppression(added)
      ) {
        return failed('loosened-type', file, hunk);
      }
    }
  }
  return passed('loosened-type');
}

export function checkLoosenedTypes(diff: string): MechanicalCheck {
  const parsed = parseUnifiedDiff(diff);
  return invalidDiff(parsed) ?? loosenedTypes(parsed.files);
}

function enabledEslintRules(lines: readonly string[]): Set<string> {
  const rules = new Set<string>();
  for (const line of lines) {
    const match = line.match(
      /^\s*(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$]*))\s*:\s*(?:['"](?:error|warn)['"]|[12]\b|\[\s*(?:['"](?:error|warn)['"]|[12]\b))/,
    );
    const rule = match?.[1] ?? match?.[2];
    if (rule) rules.add(rule);
  }
  return rules;
}

function relaxedConfig(files: readonly UnifiedDiffFile[]): MechanicalCheck {
  for (const file of files) {
    const path = filePath(file);
    for (const hunk of file.hunks) {
      const added = hunk.additions;
      if (ESLINT_CONFIG.test(path)) {
        const ignoresAdded =
          path.endsWith('.eslintignore') &&
          added.some((line) => line.trim() && !line.trim().startsWith('#'));
        const ruleDisabled = added.some((line) =>
          /:\s*(?:['"]off['"]|0|\[\s*(?:['"]off['"]|0)(?:\s*,|\s*\]))/.test(
            line,
          ),
        );
        const ignoreConfigAdded = added.some((line) =>
          /\b(?:ignores|ignorePatterns|globalIgnores)\b/.test(line),
        );
        const enabledRemoved = enabledEslintRules(hunk.removals);
        const enabledAdded = enabledEslintRules(added);
        const enabledRuleRemoved = [...enabledRemoved].some(
          (rule) => !enabledAdded.has(rule),
        );
        if (
          ignoresAdded ||
          ruleDisabled ||
          ignoreConfigAdded ||
          enabledRuleRemoved
        ) {
          return failed('relaxed-config', file, hunk);
        }
      }

      if (VITEST_CONFIG.test(path)) {
        const text = unifiedHunkText(hunk);
        const isViteConfig = /(?:^|\/)vite\.config\./.test(path);
        const isTestConfig = !isViteConfig || /\btest\s*:/.test(text);
        if (
          isTestConfig &&
          /\bexclude\b/.test(text) &&
          added.some((line) => /['"`][^'"`]+['"`]/.test(line))
        ) {
          return failed('relaxed-config', file, hunk);
        }
      }
      if (hasRelaxedPythonConfig(path, added)) {
        return failed('relaxed-config', file, hunk);
      }
    }
  }
  return passed('relaxed-config');
}

export function checkRelaxedConfig(diff: string): MechanicalCheck {
  const parsed = parseUnifiedDiff(diff);
  return invalidDiff(parsed) ?? relaxedConfig(parsed.files);
}

function moduleSyntax(files: readonly UnifiedDiffFile[]): MechanicalCheck {
  for (const file of files) {
    if (!isCommonJsPath(filePath(file))) continue;
    for (const hunk of file.hunks) {
      if (addsEsModuleSyntax(hunk.additions)) return failed('module-syntax', file, hunk);
    }
  }
  return passed('module-syntax');
}

export function checkModuleSyntax(diff: string): MechanicalCheck {
  const parsed = parseUnifiedDiff(diff);
  return invalidDiff(parsed) ?? moduleSyntax(parsed.files);
}

export function runMechanicalChecks(diff: string): MechanicalCheck[] {
  const parsed = parseUnifiedDiff(diff);
  const invalid = invalidDiff(parsed);
  if (invalid) {
    return [
      invalid,
      passed('skipped-test'),
      passed('pass-with-no-tests'),
      passed('weakened-assertion'),
      passed('loosened-type'),
      passed('relaxed-config'),
      passed('module-syntax'),
    ];
  }
  const files = parsed.files;
  return [
    deletedTests(files),
    skips(files),
    passWithNoTests(files),
    assertionDrop(files),
    loosenedTypes(files),
    relaxedConfig(files),
    moduleSyntax(files),
  ];
}
