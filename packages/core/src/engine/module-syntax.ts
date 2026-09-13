const COMMONJS_FILE = /\.cjs$/u;
const ES_MODULE_FILE = /\.mjs$/u;
// A static `import` declaration. Dynamic `import(...)` is valid CommonJS and must not match.
const ESM_IMPORT = /^\s*import\s+(?!\()/u;
// An `export` declaration. `exports.name = ...` starts with `exports` and does not match.
const ESM_EXPORT = /^\s*export\s+(?:default\b|const\b|let\b|var\b|function\b|class\b|async\b|\{|\*)/u;

export function isCommonJsPath(path: string): boolean {
  return COMMONJS_FILE.test(path);
}

export function addsEsModuleSyntax(lines: readonly string[]): boolean {
  return lines.some((line) => ESM_IMPORT.test(line) || ESM_EXPORT.test(line));
}

export function isEsModulePath(path: string): boolean {
  return ES_MODULE_FILE.test(path);
}

export function moduleSystemInstruction(path: string): string | undefined {
  if (isCommonJsPath(path)) {
    return "The selected file is CommonJS (.cjs). Use require(); never add import or export declarations. When a dependency became ES-module-only, use require('pkg').default or destructure the named export from require('pkg').";
  }
  if (isEsModulePath(path)) {
    return 'The selected file is an ES module (.mjs). Use import declarations; never add require() or module.exports.';
  }
  return undefined;
}
