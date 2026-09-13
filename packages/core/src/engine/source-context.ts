import { posix } from 'node:path';

import type { RuntimeId } from '../runtime/types.js';
import type { RepairSourceExcerpt } from './repair.js';

const MAX_DEPENDENCY_GROUPS = 24;
const NODE_STATIC_SPECIFIER = /(?:\b(?:import|export)\s(?:[^'"\n]*\bfrom\s)?\s*|\b(?:import|require)\s*\(\s*)['"](?<specifier>\.{1,2}\/[^'"\n]+)['"]/gu;
const PYTHON_RELATIVE_IMPORT = /^\s*from\s+(?<dots>\.+)(?<module>[A-Za-z_][A-Za-z0-9_.]*)?\s+import\s+(?<imports>[A-Za-z_][A-Za-z0-9_]*(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?)*)/gmu;
/**
 * Absolute imports name a module on `sys.path`. A test run from the repository
 * root or through unittest discovery resolves them against the root, the
 * importing file's own directory, or a `src/` layout; every candidate is one
 * bounded read and an ambiguous module contributes nothing.
 */
const PYTHON_MODULE_NAME = /^[A-Za-z_][A-Za-z0-9_.]*$/u;
const PYTHON_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
/** Standard-library and test-runner modules a repository never defines; probing them wastes the budget. */
const PYTHON_EXTERNAL_MODULES = new Set([
  'abc', 'argparse', 'asyncio', 'base64', 'collections', 'concurrent', 'contextlib', 'copy', 'csv',
  'dataclasses', 'datetime', 'decimal', 'enum', 'functools', 'glob', 'hashlib', 'http', 'importlib',
  'inspect', 'io', 'itertools', 'json', 'logging', 'math', 'os', 'pathlib', 'pickle', 'platform',
  'pytest', 'random', 're', 'shutil', 'socket', 'sqlite3', 'string', 'subprocess', 'sys', 'tempfile',
  'threading', 'time', 'typing', 'unittest', 'urllib', 'uuid', 'warnings',
]);
const SAFE_DEPENDENCY_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_@./-]+$/u;

export interface SourceDependencyGroup {
  sourcePath: string;
  specifier: string;
  candidates: readonly string[];
}

function safeNormalizedPath(path: string): string | undefined {
  const normalized = posix.normalize(path);
  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    !SAFE_DEPENDENCY_PATH.test(normalized) ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) return undefined;
  return normalized;
}

export function typescriptSourceVariants(path: string): string[] {
  if (!path.endsWith('.js')) return [];
  const stem = path.slice(0, -3);
  return [`${stem}.ts`, `${stem}.tsx`];
}

function nodeCandidates(sourcePath: string, specifier: string): string[] {
  const resolved = safeNormalizedPath(posix.join(posix.dirname(sourcePath), specifier));
  if (resolved === undefined) return [];
  const extension = posix.extname(resolved);
  const variants = extension
      ? [
        resolved,
        ...typescriptSourceVariants(resolved),
        ...(extension === '.mjs' ? [`${resolved.slice(0, -4)}.mts`] : []),
        ...(extension === '.cjs' ? [`${resolved.slice(0, -4)}.cts`] : []),
      ]
    : [
        ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].map((suffix) => `${resolved}${suffix}`),
        ...['index.ts', 'index.tsx', 'index.mts', 'index.cts', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs']
          .map((name) => `${resolved}/${name}`),
      ];
  return [...new Set(variants)].filter((path) => safeNormalizedPath(path) !== undefined);
}

function pythonCandidates(sourcePath: string, dots: string, moduleName: string): string[] {
  let directory = posix.dirname(sourcePath);
  for (let index = 1; index < dots.length; index += 1) directory = posix.dirname(directory);
  const modulePath = moduleName ? moduleName.replaceAll('.', '/') : '';
  const resolved = safeNormalizedPath(posix.join(directory, modulePath));
  if (resolved === undefined) return [];
  return [...new Set([
    ...(modulePath ? [`${resolved}.py`, `${resolved}.pyi`] : []),
    `${resolved}/__init__.py`,
    `${resolved}/__init__.pyi`,
  ])].filter((path) => safeNormalizedPath(path) !== undefined);
}

function pythonAbsoluteCandidates(sourcePath: string, moduleName: string): string[] {
  const modulePath = moduleName.replaceAll('.', '/');
  const roots = [...new Set(['.', posix.dirname(sourcePath), 'src'])];
  return [...new Set(roots.flatMap((root) => {
    const resolved = safeNormalizedPath(posix.join(root, modulePath));
    return resolved === undefined
      ? []
      : [`${resolved}.py`, `${resolved}.pyi`, `${resolved}/__init__.py`, `${resolved}/__init__.pyi`];
  }))].filter((path) => safeNormalizedPath(path) !== undefined);
}

function pythonAbsoluteImportModules(line: string): string[] {
  const trimmed = line.trim();
  if (trimmed.startsWith('from') && /\s/u.test(trimmed[4] ?? '')) {
    const declaration = trimmed.slice(4).trimStart();
    const moduleEnd = declaration.search(/\s/u);
    if (moduleEnd < 1) return [];
    const moduleName = declaration.slice(0, moduleEnd);
    const remainder = declaration.slice(moduleEnd).trimStart();
    if (!PYTHON_MODULE_NAME.test(moduleName) || !remainder.startsWith('import') ||
        !/\s/u.test(remainder[6] ?? '') || remainder.slice(6).trim().length === 0) return [];
    return [moduleName];
  }
  if (!trimmed.startsWith('import') || !/\s/u.test(trimmed[6] ?? '')) return [];
  const modules: string[] = [];
  for (const declaration of trimmed.slice(6).split(',')) {
    const parts = declaration.trim().split(/\s+/u);
    const moduleName = parts[0] ?? '';
    if (!PYTHON_MODULE_NAME.test(moduleName) ||
        (parts.length !== 1 && (parts.length !== 3 || parts[1] !== 'as' || !PYTHON_IDENTIFIER.test(parts[2] ?? '')))) return [];
    modules.push(moduleName);
  }
  return modules;
}

function* pythonAbsoluteImports(source: RepairSourceExcerpt): Generator<{ specifier: string; candidates: string[] }> {
  for (const line of source.content.split('\n')) {
    for (const moduleName of pythonAbsoluteImportModules(line)) {
      if (!moduleName || PYTHON_EXTERNAL_MODULES.has(moduleName.split('.')[0] ?? '')) continue;
      yield { specifier: moduleName, candidates: pythonAbsoluteCandidates(source.path, moduleName) };
    }
  }
}

function* dependencySpecifiers(
  source: RepairSourceExcerpt,
  runtimeId: RuntimeId,
): Generator<{ specifier: string; candidates: string[] }> {
  if (runtimeId === 'node') {
    for (const match of source.content.matchAll(NODE_STATIC_SPECIFIER)) {
      const specifier = match.groups?.specifier;
      if (specifier !== undefined) yield { specifier, candidates: nodeCandidates(source.path, specifier) };
    }
    return;
  }
  yield* pythonAbsoluteImports(source);
  for (const match of source.content.matchAll(PYTHON_RELATIVE_IMPORT)) {
    const dots = match.groups?.dots;
    if (dots === undefined) continue;
    const moduleName = match.groups?.module ?? '';
    if (!moduleName) {
      for (const imported of (match.groups?.imports ?? '').split(',')) {
        const importedName = imported.trim().split(/\s/u)[0] ?? '';
        if (importedName) {
          yield {
            specifier: `${dots}${importedName}`,
            candidates: pythonCandidates(source.path, dots, importedName),
          };
        }
      }
      continue;
    }
    yield {
      specifier: `${dots}${moduleName}`,
      candidates: pythonCandidates(source.path, dots, moduleName),
    };
  }
}

export function sourceDependencyGroups(
  sources: readonly RepairSourceExcerpt[],
  runtimeId: RuntimeId,
  knownPaths: ReadonlySet<string> = new Set(),
): SourceDependencyGroup[] {
  const groups: SourceDependencyGroup[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const dependency of dependencySpecifiers(source, runtimeId)) {
      const key = `${source.path}\0${dependency.specifier}`;
      if (
        dependency.candidates.length === 0 ||
        dependency.candidates.some((path) => knownPaths.has(path)) ||
        seen.has(key)
      ) continue;
      seen.add(key);
      groups.push({
        sourcePath: source.path,
        specifier: dependency.specifier,
        candidates: dependency.candidates,
      });
      if (groups.length >= MAX_DEPENDENCY_GROUPS) return groups;
    }
  }
  return groups;
}
