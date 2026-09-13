export interface UnifiedDiffHunk {
  header: string;
  lines: string[];
  additions: string[];
  removals: string[];
}

export interface UnifiedDiffFile {
  oldPath: string | null;
  newPath: string | null;
  deleted: boolean;
  renamed: boolean;
  headerLines: string[];
  hunks: UnifiedDiffHunk[];
}

export interface ParsedUnifiedDiff {
  valid: boolean;
  files: UnifiedDiffFile[];
  errors: string[];
}

interface ParsedPath {
  path: string | null;
  valid: boolean;
}

const TEST_DIRECTORY_SEGMENT = /^(?:(?:__)?tests?(?:__)?|specs?|e2e|cypress)$/u;
const TEST_FILE_INFIXES = ['.test.', '.spec.'] as const;
const PYTHON_TEST_FILE_SEGMENT = /^(?:test_[^/]+|[^/]+_test)\.py$/u;

function hasTestInfix(file: string): boolean {
  return TEST_FILE_INFIXES.some((infix) => {
    const index = file.indexOf(infix);
    return index > 0 && index + infix.length < file.length;
  });
}

export function isConventionalTestPath(path: string): boolean {
  const segments = path.split('/');
  if (segments.some((segment) => TEST_DIRECTORY_SEGMENT.test(segment))) return true;
  const file = segments[segments.length - 1] ?? '';
  return hasTestInfix(file) || PYTHON_TEST_FILE_SEGMENT.test(file);
}

function decodeQuotedToken(value: string): { value: string; rest: string } | null {
  if (!value.startsWith('"')) return null;

  let escaped = false;
  for (let index = 1; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"') {
      const token = value.slice(0, index + 1);
      try {
        const decoded = JSON.parse(token) as unknown;
        return typeof decoded === 'string'
          ? { value: decoded, rest: value.slice(index + 1) }
          : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function normalizePath(path: string): string {
  return path.replace(/^[ab]\//, '');
}

function parseHeaderPath(value: string): ParsedPath {
  const trimmed = value.trimStart();
  if (!trimmed) return { path: null, valid: false };

  let decoded: string;
  if (trimmed.startsWith('"')) {
    const token = decodeQuotedToken(trimmed);
    if (!token || (token.rest !== '' && !token.rest.startsWith('\t'))) {
      return { path: null, valid: false };
    }
    decoded = token.value;
  } else {
    decoded = trimmed.split('\t', 1)[0]?.trimEnd() ?? '';
  }

  if (!decoded) return { path: null, valid: false };
  if (decoded === '/dev/null') return { path: null, valid: true };
  return { path: normalizePath(decoded), valid: true };
}

function parseGitPaths(value: string): { oldPath: string; newPath: string } | null {
  const tokens: string[] = [];
  let rest = value.trimStart();

  while (rest && tokens.length < 2) {
    if (rest.startsWith('"')) {
      const token = decodeQuotedToken(rest);
      if (!token) return null;
      tokens.push(token.value);
      rest = token.rest.trimStart();
    } else {
      const boundary = rest.search(/\s/);
      if (boundary === -1) {
        tokens.push(rest);
        rest = '';
      } else {
        tokens.push(rest.slice(0, boundary));
        rest = rest.slice(boundary).trimStart();
      }
    }
  }

  return tokens.length === 2 && rest === '' && tokens[0] && tokens[1]
    ? { oldPath: normalizePath(tokens[0]), newPath: normalizePath(tokens[1]) }
    : null;
}

interface PendingFile {
  gitPaths: { oldPath: string; newPath: string } | null;
  oldPath: string | null;
  newPath: string | null;
  sawOldPath: boolean;
  sawNewPath: boolean;
  renameFrom: string | null;
  renameTo: string | null;
  sawRenameFrom: boolean;
  sawRenameTo: boolean;
  deletedMode: boolean;
  headerLines: string[];
  hunks: UnifiedDiffHunk[];
  invalid: boolean;
}

const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@(?: .*)?$/u;
const HUNK_PARTS = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/u;
const NO_NEWLINE_MARKER = '\\ No newline at end of file';

function formatRange(start: string, count: number): string {
  return count === 1 ? start : `${start},${count}`;
}

export function normalizeUnifiedDiffHunks(diff: string): string {
  const lines = diff.split(/\r?\n/u);
  const hasTrailingNewline = lines.at(-1) === '';
  if (hasTrailingNewline) lines.pop();

  for (let index = 0; index < lines.length; index += 1) {
    const match = HUNK_PARTS.exec(lines[index] ?? '');
    if (!match) continue;

    let boundary = index + 1;
    while (
      boundary < lines.length &&
      !lines[boundary]?.startsWith('diff --git ') &&
      !lines[boundary]?.startsWith('@@ ')
    ) {
      boundary += 1;
    }

    let bodyEnd = boundary;
    while (bodyEnd > index + 1 && lines[bodyEnd - 1] === '') bodyEnd -= 1;

    let oldCount = 0;
    let newCount = 0;
    let changed = false;
    for (let bodyIndex = index + 1; bodyIndex < bodyEnd; bodyIndex += 1) {
      const line = lines[bodyIndex] ?? '';
      if (
        line !== NO_NEWLINE_MARKER &&
        !line.startsWith(' ') &&
        !line.startsWith('-') &&
        !line.startsWith('+')
      ) {
        lines[bodyIndex] = ` ${line}`;
        changed = true;
      }
      const normalized = lines[bodyIndex] ?? '';
      if (normalized === NO_NEWLINE_MARKER) continue;
      if (normalized.startsWith(' ') || normalized.startsWith('-')) oldCount += 1;
      if (normalized.startsWith(' ') || normalized.startsWith('+')) newCount += 1;
    }

    const oldExpected = Number(match[2] ?? 1);
    const newExpected = Number(match[4] ?? 1);
    if (changed || oldExpected !== oldCount || newExpected !== newCount) {
      lines[index] =
        `@@ -${formatRange(match[1] ?? '0', oldCount)}` +
        ` +${formatRange(match[3] ?? '0', newCount)} @@${match[5] ?? ''}`;
    }
  }

  return `${lines.join('\n')}\n`;
}

function validHunk(hunk: UnifiedDiffHunk): boolean {
  const match = HUNK_HEADER.exec(hunk.header);
  if (!match) return false;

  const oldExpected = Number(match[1] ?? 1);
  const newExpected = Number(match[2] ?? 1);
  let oldActual = 0;
  let newActual = 0;
  let canMarkNoNewline = false;
  const body = hunk.lines.slice(1);
  while (body.at(-1) === '') body.pop();

  for (const line of body) {
    if (line === NO_NEWLINE_MARKER) {
      if (!canMarkNoNewline) return false;
      canMarkNoNewline = false;
      continue;
    }
    if (line.startsWith(' ')) {
      oldActual += 1;
      newActual += 1;
    } else if (line.startsWith('-')) {
      oldActual += 1;
    } else if (line.startsWith('+')) {
      newActual += 1;
    } else {
      return false;
    }
    canMarkNoNewline = true;
  }

  return oldActual === oldExpected && newActual === newExpected;
}

export function parseUnifiedDiff(diff: string): ParsedUnifiedDiff {
  const files: UnifiedDiffFile[] = [];
  const errors: string[] = [];
  let current: PendingFile | undefined;
  let hunk: UnifiedDiffHunk | undefined;

  const flush = (): void => {
    if (!current) return;

    current.invalid ||= current.hunks.some((entry) => !validHunk(entry));

    const pairedHeaders = current.sawOldPath === current.sawNewPath;
    const pairedRename = current.sawRenameFrom === current.sawRenameTo;
    const hasUnifiedHeaders = current.sawOldPath && current.sawNewPath;
    const hasRenameHeaders = current.sawRenameFrom && current.sawRenameTo;
    if (
      current.invalid ||
      !current.gitPaths ||
      !pairedHeaders ||
      !pairedRename ||
      (!hasUnifiedHeaders && !hasRenameHeaders)
    ) {
      errors.push('unrecognized or incomplete file change');
    }

    const oldPath = hasUnifiedHeaders ? current.oldPath : current.renameFrom;
    const newPath = hasUnifiedHeaders ? current.newPath : current.renameTo;
    const renamed = oldPath !== null && newPath !== null && oldPath !== newPath;
    const deleted = current.deletedMode || (hasUnifiedHeaders && newPath === null);

    files.push({
      oldPath,
      newPath,
      deleted,
      renamed,
      headerLines: current.headerLines,
      hunks: current.hunks,
    });
    current = undefined;
    hunk = undefined;
  };

  const assignPath = (side: 'old' | 'new' | 'renameFrom' | 'renameTo', value: string): void => {
    if (!current) return;
    const parsed = parseHeaderPath(value);
    current.invalid ||= !parsed.valid;
    if (side === 'old') {
      current.invalid ||= current.sawOldPath;
      current.oldPath = parsed.path;
      current.sawOldPath = true;
    } else if (side === 'new') {
      current.invalid ||= current.sawNewPath;
      current.newPath = parsed.path;
      current.sawNewPath = true;
    } else if (side === 'renameFrom') {
      current.invalid ||= current.sawRenameFrom || parsed.path === null;
      current.renameFrom = parsed.path;
      current.sawRenameFrom = true;
    } else {
      current.invalid ||= current.sawRenameTo || parsed.path === null;
      current.renameTo = parsed.path;
      current.sawRenameTo = true;
    }
  };

  const lines = diff.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush();
      current = {
        gitPaths: parseGitPaths(line.slice('diff --git '.length)),
        oldPath: null,
        newPath: null,
        sawOldPath: false,
        sawNewPath: false,
        renameFrom: null,
        renameTo: null,
        sawRenameFrom: false,
        sawRenameTo: false,
        deletedMode: false,
        headerLines: [line],
        hunks: [],
        invalid: false,
      };
      hunk = undefined;
      continue;
    }
    if (!current) continue;

    if (line.startsWith('@@ ')) {
      hunk = { header: line, lines: [line], additions: [], removals: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (hunk) {
      hunk.lines.push(line);
      if (line.startsWith('+')) hunk.additions.push(line.slice(1));
      if (line.startsWith('-')) hunk.removals.push(line.slice(1));
      continue;
    }

    current.headerLines.push(line);
    if (line.startsWith('deleted file mode ')) {
      current.deletedMode = true;
    } else if (line.startsWith('rename from ')) {
      assignPath('renameFrom', line.slice('rename from '.length));
    } else if (line.startsWith('rename to ')) {
      assignPath('renameTo', line.slice('rename to '.length));
    } else if (line.startsWith('--- ')) {
      assignPath('old', line.slice(4));
    } else if (line.startsWith('+++ ')) {
      assignPath('new', line.slice(4));
    }
  }
  flush();

  return { valid: errors.length === 0, files, errors };
}

export function unifiedHunkText(hunk: UnifiedDiffHunk): string {
  return hunk.lines.join('\n');
}

export function unifiedHeaderText(file: UnifiedDiffFile): string {
  return file.headerLines.join('\n');
}
