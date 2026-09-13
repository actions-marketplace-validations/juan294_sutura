import { Buffer } from 'node:buffer';

import type {
  Candidate,
  Diagnosis,
  RaceResult,
  TriageVerdict,
} from '../domain.js';
import { MAX_RACE_CANDIDATES } from '../config.js';
import {
  normalizeUnifiedDiffHunks,
  parseUnifiedDiff,
} from '../diff/unified.js';
import {
  SNAPSHOT_CWD,
  type Executor,
  type ImageId,
  type RunResult,
} from '../executor/types.js';
import { extractJson } from '../llm/json.js';
import type { TierLlm } from '../llm/types.js';
import {
  assertExternalEditableText,
  redactExternalJsonValue,
  redactExternalMessages,
} from '../security/external-text.js';
import { triage } from './triage.js';
import { shellQuote } from './shell.js';

const DEFAULT_RACE_CANDIDATES = 3;
export const SUPER_REPAIR_MAX_TOKENS = 16_384;
export const REPAIR_FULL_REPLACEMENT_MAX_CODE_POINTS = 1_000;

export const REPAIR_PROPOSAL_LIMITS = Object.freeze({
  edits: 8,
  pathCodePoints: 240,
  replacementCodePoints: REPAIR_FULL_REPLACEMENT_MAX_CODE_POINTS,
});
export const REPAIR_PROPOSAL_FIELDS = Object.freeze({
  replacement: 'replacement',
  replacements: 'replacements',
  slot: 'slot',
} as const);
export const REPAIR_EDIT_FIELDS = Object.freeze({
  path: 'path', startLine: 'startLine', endLine: 'endLine', replacement: 'new',
} as const);
const REPAIR_EDIT_FIELD_NAMES = new Set<string>(Object.values(REPAIR_EDIT_FIELDS));

export type RepairLlm = TierLlm<'super'>;

interface CandidateReply {
  candidates: Candidate[];
}

const NUMBERED_HUNK = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(?: .*)?$/u;

export interface RepairPreparation {
  triage: TriageVerdict;
  candidates: Candidate[];
}

export interface RepairSourceExcerpt {
  path: string;
  startLine: number;
  content: string;
  truncated: boolean;
  boundaryComplete?: boolean;
}

export interface RepairSourceContext {
  sources: RepairSourceExcerpt[];
}

function positiveCount(value: number, name: string): void {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_RACE_CANDIDATES
  ) {
    throw new RangeError(
      `${name} must be between 1 and ${MAX_RACE_CANDIDATES}`,
    );
  }
}

function oldHunkSequence(lines: readonly string[]): string[] {
  const body = lines.slice(1);
  while (body.at(-1) === '') body.pop();
  return body.flatMap((line) =>
    line.startsWith(' ') || line.startsWith('-') ? [line.slice(1)] : [],
  );
}

function containsSequence(source: readonly string[], sequence: readonly string[]): boolean {
  if (sequence.length === 0 || sequence.length > source.length) return false;
  for (let start = 0; start <= source.length - sequence.length; start += 1) {
    if (sequence.every((line, offset) => source[start + offset] === line)) {
      return true;
    }
  }
  return false;
}

function validateSourceContext(
  candidateIndex: number,
  parsed: ReturnType<typeof parseUnifiedDiff>,
  sourceContext: RepairSourceContext,
): void {
  if (sourceContext.sources.length === 0) return;

  for (const file of parsed.files) {
    if (file.renamed) {
      throw new Error(`candidate ${candidateIndex + 1} diff must not rename source files`);
    }
    const paths = [file.oldPath, file.newPath].filter((path): path is string => path !== null);
    const unsupportedPath = paths.find((path) =>
      !sourceContext.sources.some((source) => source.path === path),
    );
    if (unsupportedPath) {
      throw new Error(
        `candidate ${candidateIndex + 1} diff path ${unsupportedPath} must be supplied in source context`,
      );
    }
    const path = file.oldPath ?? file.newPath;
    if (!path) {
      throw new Error(`candidate ${candidateIndex + 1} diff must have a supplied source path`);
    }
    const excerpts = sourceContext.sources.filter((source) => source.path === path);
    for (const hunk of file.hunks) {
      const sequence = oldHunkSequence(hunk.lines);
      const matches = excerpts.some((source) =>
        containsSequence(source.content.split(/\r?\n/u), sequence),
      );
      if (!matches) {
        throw new Error(
          `candidate ${candidateIndex + 1} diff hunk must match supplied source ${path} exactly`,
        );
      }
    }
  }
}

interface RepairEdit {
  path: string;
  old: string;
  replacement: string;
}

interface PatchLine {
  text: string;
  terminated: boolean;
}

const NO_NEWLINE_MARKER = '\\ No newline at end of file';

function patchLines(content: string): PatchLine[] {
  const lines = content.split('\n');
  const finalNewline = lines.at(-1) === '';
  if (finalNewline) lines.pop();
  return lines.map((text, index) => ({
    text,
    terminated: index < lines.length - 1 || finalNewline,
  }));
}

function samePatchLine(left: PatchLine, right: PatchLine): boolean {
  return left.text === right.text && left.terminated === right.terminated;
}

function diffBodyLines(prefix: ' ' | '-' | '+', lines: readonly PatchLine[]): string[] {
  return lines.flatMap((line) => [
    `${prefix}${line.text}`,
    ...(!line.terminated ? [NO_NEWLINE_MARKER] : []),
  ]);
}

function editValue(value: unknown, candidateIndex: number, editIndex: number): RepairEdit {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`candidate ${candidateIndex + 1} edit ${editIndex + 1} must be an object`);
  }
  const edit = value as Record<string, unknown>;
  if (typeof edit.path !== 'string' || !edit.path.trim()) {
    throw new Error(`candidate ${candidateIndex + 1} edit ${editIndex + 1} must have a path`);
  }
  if (typeof edit.old !== 'string' || !edit.old) {
    throw new Error(`candidate ${candidateIndex + 1} edit ${editIndex + 1} must have non-empty old text`);
  }
  if (typeof edit.new !== 'string' || edit.new === edit.old) {
    throw new Error(`candidate ${candidateIndex + 1} edit ${editIndex + 1} must change the old text`);
  }
  return {
    path: edit.path,
    old: edit.old,
    replacement: edit.new,
  };
}

function changedRegionDiff(path: string, startLine: number, oldText: string, newText: string): string {
  const oldLines = patchLines(oldText);
  const newLines = patchLines(newText);
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    samePatchLine(oldLines[prefix]!, newLines[prefix]!)
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    samePatchLine(
      oldLines[oldLines.length - suffix - 1]!,
      newLines[newLines.length - suffix - 1]!,
    )
  ) {
    suffix += 1;
  }

  const contextStart = Math.max(0, prefix - 3);
  const trailingContext = Math.min(3, suffix);
  const oldChangeEnd = oldLines.length - suffix;
  const newChangeEnd = newLines.length - suffix;
  const oldEnd = oldChangeEnd + trailingContext;
  const newEnd = newChangeEnd + trailingContext;
  const body = [
    ...diffBodyLines(' ', oldLines.slice(contextStart, prefix)),
    ...diffBodyLines('-', oldLines.slice(prefix, oldChangeEnd)),
    ...diffBodyLines('+', newLines.slice(prefix, newChangeEnd)),
    ...diffBodyLines(' ', oldLines.slice(oldChangeEnd, oldEnd)),
  ];
  const oldCount = oldEnd - contextStart;
  const newCount = newEnd - contextStart;
  const hunkStart = startLine + contextStart;
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${hunkStart},${oldCount} +${hunkStart},${newCount} @@`,
    ...body,
  ].join('\n');
}

interface PositionedRepairEdit {
  start: number;
  end: number;
  replacement: string;
}

function positionedEditsDiff(
  path: string,
  excerpt: RepairSourceExcerpt,
  edits: readonly PositionedRepairEdit[],
  overlapMessage: string,
): string {
  const positioned = [...edits].sort((left, right) => left.start - right.start);
  if (positioned.some((edit, index) => index > 0 && edit.start < positioned[index - 1]!.end)) {
    throw new Error(overlapMessage);
  }
  let revised = excerpt.content;
  for (const edit of positioned.toReversed()) {
    revised = `${revised.slice(0, edit.start)}${edit.replacement}${revised.slice(edit.end)}`;
  }
  return changedRegionDiff(path, excerpt.startLine, excerpt.content, revised);
}

function editsDiff(
  editsValue: unknown,
  candidateIndex: number,
  sourceContext: RepairSourceContext,
): string {
  if (!Array.isArray(editsValue) || editsValue.length === 0) {
    throw new Error(`candidate ${candidateIndex + 1} must have a non-empty edits array`);
  }
  const edits = editsValue.map((value, editIndex) =>
    editValue(value, candidateIndex, editIndex),
  );
  const paths = [...new Set(edits.map(({ path }) => path))];
  return `${paths.map((path) => {
    const pathEdits = edits.filter((edit) => edit.path === path);
    const excerpts = sourceContext.sources.filter((source) => source.path === path);
    const excerpt = excerpts.find((source) => pathEdits.every(({ old }) => {
      const content = source.content;
      return content.indexOf(old) !== -1 && content.indexOf(old) === content.lastIndexOf(old);
    }));
    if (!excerpt) {
      throw new Error(
        `candidate ${candidateIndex + 1} edits must match supplied source ${path} exactly once`,
      );
    }
    const original = excerpt.content;
    return positionedEditsDiff(path, excerpt, pathEdits.map((edit) => ({
      ...edit,
      start: original.indexOf(edit.old),
      end: original.indexOf(edit.old) + edit.old.length,
    })), `candidate ${candidateIndex + 1} edits for ${path} must not overlap`);
  }).join('\n')}\n`;
}

export function structuredEditsDiff(
  edits: unknown,
  sourceContext: RepairSourceContext,
): string {
  return editsDiff(edits, 0, sourceContext);
}

interface AnchoredRepairEdit {
  path: string;
  startLine: number;
  endLine: number;
  replacement: string;
}

function anchoredEditValue(value: unknown, editIndex: number): AnchoredRepairEdit {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`repair edit ${editIndex + 1} must be an object`);
  }
  const edit = value as Record<string, unknown>;
  const path = edit[REPAIR_EDIT_FIELDS.path];
  const startLine = edit[REPAIR_EDIT_FIELDS.startLine];
  const endLine = edit[REPAIR_EDIT_FIELDS.endLine];
  const replacement = edit[REPAIR_EDIT_FIELDS.replacement];
  if (
    Object.keys(edit).some((key) => !REPAIR_EDIT_FIELD_NAMES.has(key)) ||
    typeof path !== 'string' || !/\S/u.test(path) ||
    [...path].length > REPAIR_PROPOSAL_LIMITS.pathCodePoints ||
    !Number.isSafeInteger(startLine) || Number(startLine) < 1 ||
    !Number.isSafeInteger(endLine) || Number(endLine) < Number(startLine) ||
    typeof replacement !== 'string' ||
    [...replacement].length > REPAIR_PROPOSAL_LIMITS.replacementCodePoints
  ) throw new Error(`repair edit ${editIndex + 1} does not match the anchored line schema`);
  return {
    path,
    startLine: Number(startLine),
    endLine: Number(endLine),
    replacement,
  };
}

function lineSpans(content: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== '\n') continue;
    spans.push({ start, end: index + 1 });
    start = index + 1;
  }
  if (start < content.length) spans.push({ start, end: content.length });
  return spans;
}

export interface RepairSourceLine {
  line: number;
  text: string;
  start: number;
  end: number;
}

export function indexRepairSourceLines(excerpt: RepairSourceExcerpt): RepairSourceLine[] {
  if (!Number.isSafeInteger(excerpt.startLine) || excerpt.startLine < 1) {
    throw new RangeError(`repair source ${excerpt.path} must use a safe positive start line`);
  }
  const spans = lineSpans(excerpt.content);
  if (spans.length > 0 && spans.length - 1 > Number.MAX_SAFE_INTEGER - excerpt.startLine) {
    throw new RangeError(`repair source ${excerpt.path} line range exceeds safe integers`);
  }
  return spans.map(({ start, end }, index) => ({
    line: excerpt.startLine + index,
    text: excerpt.content.slice(start, end).replace(/\r?\n$/u, ''),
    start,
    end,
  }));
}

function replacementWithSourceEnding(
  source: string,
  oldText: string,
  replacement: string,
): string {
  if (!replacement) return '';
  const sourceEnding = source.includes('\r\n') ? '\r\n' : '\n';
  const rangeEnding = oldText.endsWith('\r\n') ? '\r\n' : oldText.endsWith('\n') ? '\n' : '';
  const normalized = replacement.replace(/\r\n|\r|\n/gu, sourceEnding);
  if (rangeEnding && !normalized.endsWith(sourceEnding)) return `${normalized}${sourceEnding}`;
  if (!rangeEnding && /(?:\r\n|\r|\n)$/u.test(normalized)) {
    return normalized.replace(/(?:\r\n|\r|\n)$/u, '');
  }
  return normalized;
}

export function anchoredEditsDiff(
  editsValue: unknown,
  sourceContext: RepairSourceContext,
): string {
  if (
    !Array.isArray(editsValue) ||
    editsValue.length === 0 ||
    editsValue.length > REPAIR_PROPOSAL_LIMITS.edits
  ) {
    throw new Error(`repair proposal must have from 1 to ${REPAIR_PROPOSAL_LIMITS.edits} anchored edits`);
  }
  const edits = editsValue.map(anchoredEditValue);
  const paths = [...new Set(edits.map(({ path }) => path))];
  return `${paths.map((path) => {
    const pathEdits = edits.filter((edit) => edit.path === path);
    let selected: { excerpt: RepairSourceExcerpt; spans: Array<{ start: number; end: number }> } | undefined;
    for (const excerpt of sourceContext.sources) {
      if (excerpt.path !== path) continue;
      const spans = lineSpans(excerpt.content);
      const finalLine = spans.length === 0 ? undefined : excerpt.startLine + spans.length - 1;
      if (pathEdits.every(({ startLine, endLine }) =>
        finalLine !== undefined && startLine >= excerpt.startLine && endLine <= finalLine,
      )) {
        selected = { excerpt, spans };
        break;
      }
    }
    if (!selected) throw new Error(`repair edits must use line ranges inside supplied source ${path}`);
    const { excerpt, spans } = selected;
    return positionedEditsDiff(path, excerpt, pathEdits.map((edit) => {
      const start = spans[edit.startLine - excerpt.startLine]?.start;
      const end = spans[edit.endLine - excerpt.startLine]?.end;
      if (start === undefined || end === undefined) {
        throw new Error(`repair edit range is outside supplied source ${path}`);
      }
      const oldText = excerpt.content.slice(start, end);
      const replacement = replacementWithSourceEnding(excerpt.content, oldText, edit.replacement);
      if (replacement === oldText) throw new Error(`repair edit for ${path} must change its line range`);
      return { start, end, replacement };
    }), `repair edits for ${path} must not overlap`);
  }).join('\n')}\n`;
}

function candidateReply(
  value: unknown,
  expected: number,
  sourceContext: RepairSourceContext,
): CandidateReply {
  if (typeof value !== 'object' || value === null) {
    throw new Error('candidate reply must be an object');
  }

  const record = value as Record<string, unknown>;
  const candidates = Array.isArray(record.candidates)
    ? record.candidates
    : expected === 1 &&
        'id' in record &&
        'rationale' in record &&
        ('diff' in record || 'edits' in record)
      ? [value]
      : undefined;
  if (!Array.isArray(candidates) || candidates.length !== expected) {
    throw new Error(`candidate reply must contain exactly ${expected} candidates`);
  }

  const parsed = candidates.map((value, index): Candidate => {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`candidate ${index + 1} must be an object`);
    }
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || !candidate.id.trim()) {
      throw new Error(`candidate ${index + 1} must have a non-empty id`);
    }
    if (typeof candidate.rationale !== 'string' || !candidate.rationale.trim()) {
      throw new Error(`candidate ${index + 1} must have a non-empty rationale`);
    }
    const suppliedDiff = typeof candidate.diff === 'string' && candidate.diff.trim()
      ? candidate.diff
      : undefined;
    const diff = suppliedDiff === undefined
      ? editsDiff(candidate.edits, index, sourceContext)
      : normalizeUnifiedDiffHunks(suppliedDiff);
    const parsedDiff = parseUnifiedDiff(diff);
    if (
      !parsedDiff.valid ||
      parsedDiff.files.length === 0 ||
      parsedDiff.files.some(
        ({ hunks }) =>
          hunks.length === 0 || hunks.some(({ header }) => !NUMBERED_HUNK.test(header)),
      )
    ) {
      throw new Error(
        `candidate ${index + 1} diff must be a complete git unified diff with numbered hunks`,
      );
    }
    validateSourceContext(index, parsedDiff, sourceContext);

    return {
      id: candidate.id,
      rationale: candidate.rationale,
      diff,
    };
  });

  if (new Set(parsed.map(({ id }) => id.trim().toLowerCase())).size !== parsed.length) {
    throw new Error('candidate ids must be distinct');
  }
  if (
    new Set(parsed.map(({ rationale }) => rationale.trim().toLowerCase())).size !==
    parsed.length
  ) {
    throw new Error('candidate rationales must be distinct');
  }
  if (new Set(parsed.map(({ diff }) => diff.trim())).size !== parsed.length) {
    throw new Error('candidate diffs must be distinct');
  }

  return { candidates: parsed };
}

function generationPrompt(K: number, hasSourceContext: boolean): string {
  const common = [
    `Return exactly ${K} independent CI repair candidates as one JSON object.`,
    'Use distinct evidence-backed strategies. Prefer the smallest direct source repairs. Use configuration or dependency changes only when the evidence directly requires them.',
    'Do not describe your analysis. Emit the JSON object immediately.',
  ];
  if (!hasSourceContext) {
    return [
      ...common,
      'Each candidate must have a distinct concise id, a distinct concise rationale, and a complete unified diff accepted by git apply.',
      'For every changed file, include `diff --git a/path b/path`, `--- a/path`, `+++ b/path`, and one or more numbered hunk headers.',
      'Inside each hunk, prefix every unchanged context line with one literal space and use exact old/new line counts.',
      'Do not weaken, skip, or delete tests. Do not include hidden reasoning.',
      'Schema: {"candidates":[{"id":"...","rationale":"...","diff":"..."}]}',
    ].join('\n');
  }
  return [
    ...common,
    'Each candidate must have a distinct concise id, a distinct concise rationale, and a non-empty edits array.',
    'Each edit must contain path, old, and new. Copy old verbatim from sourceContext. Set new to its exact replacement.',
    'Use only supplied repository paths. Keep old text as small as possible and unique within its supplied source excerpt.',
    'Do not weaken, skip, or delete tests. Do not include hidden reasoning.',
    'Schema: {"candidates":[{"id":"...","rationale":"...","edits":[{"path":"...","old":"...","new":"..."}]}]}',
  ].join('\n');
}

export async function generateCandidates(
  llm: RepairLlm,
  diagnosis: Diagnosis,
  K = DEFAULT_RACE_CANDIDATES,
  sourceContext: RepairSourceContext = { sources: [] },
): Promise<Candidate[]> {
  positiveCount(K, 'K');
  for (const source of sourceContext.sources) {
    assertExternalEditableText(source.content);
  }
  const messages = redactExternalMessages([
    {
      role: 'system' as const,
      content: generationPrompt(K, sourceContext.sources.length > 0),
    },
    {
      role: 'user' as const,
      content: JSON.stringify(redactExternalJsonValue({ diagnosis, sourceContext })),
    },
  ]);
  const options = {
    maxTokens: SUPER_REPAIR_MAX_TOKENS,
    temperature: 1,
    reasoningEffort: 'low' as const,
    responseFormat: { type: 'json_object' as const },
    routing: {
      failureClass: diagnosis.class,
      diagnosisConfidence: diagnosis.confidence,
      remainingInferenceBudgetUsd: Number.MAX_SAFE_INTEGER,
    },
  };
  const reply = await llm.chat('super', messages, options);
  const result = await extractJson(
    reply,
    (value) => candidateReply(value, K, sourceContext),
    async (repairPrompt) =>
      llm.chat(
        'super',
        redactExternalMessages([
          ...messages,
          ...(reply.text.trim()
            ? [{ role: 'assistant' as const, content: reply.text }]
            : []),
          { role: 'user' as const, content: repairPrompt },
        ]),
        options,
      ),
  );
  return result.candidates;
}

export async function prepareRepair(
  executor: Executor,
  llm: RepairLlm,
  failingImage: ImageId,
  diagnosis: Diagnosis,
  N = 5,
  K = DEFAULT_RACE_CANDIDATES,
  sourceContext: RepairSourceContext = { sources: [] },
): Promise<RepairPreparation> {
  positiveCount(K, 'K');
  const verdict = await triage(executor, failingImage, diagnosis.failingCmd, N);
  if (verdict.status !== 'real') {
    return { triage: verdict, candidates: [] };
  }

  return {
    triage: verdict,
    candidates: await generateCandidates(llm, diagnosis, K, sourceContext),
  };
}

function raceApplyCommand(diff: string): string {
  const encodedDiff = Buffer.from(diff, 'utf8').toString('base64');
  return `printf '%s' ${shellQuote(encodedDiff)} | base64 --decode | git apply -`;
}

export async function race(
  executor: Executor,
  failingImage: ImageId,
  candidates: readonly Candidate[],
  failingCmd: string,
  observe?: (result: RunResult, attempt: number) => string,
): Promise<RaceResult[]> {
  if (candidates.length > MAX_RACE_CANDIDATES) {
    throw new RangeError(
      `candidates must contain at most ${MAX_RACE_CANDIDATES} entries`,
    );
  }
  if (!failingCmd.trim()) throw new Error('failingCmd must contain a command');
  const applied = await executor.runMany(failingImage, candidates.map(({ diff }) => raceApplyCommand(diff)), {
    cwd: SNAPSHOT_CWD, network: 'disabled',
  });
  if (applied.length !== candidates.length) {
    throw new Error('executor returned an unexpected number of race results');
  }
  const results: RaceResult[] = [];
  for (const [index, patch] of applied.entries()) {
    // Visible commands may mutate their child image. All subsequent audit gates
    // must start from the immutable applied source, never those side effects.
    const tested = patch.exitCode === 0
      ? await executor.run(patch.imageId, `sh -lc ${shellQuote(failingCmd)}`, { cwd: SNAPSHOT_CWD, network: 'disabled' })
      : patch;
    results.push({
      candidate: candidates[index] as Candidate,
      imageId: patch.imageId,
      nodeId: observe?.(tested, index + 1) ?? `candidate-${index + 1}`,
      exitCode: tested.exitCode,
      held: patch.exitCode === 0 && tested.exitCode === 0,
    });
  }
  return results;
}

export function selectWinner(results: readonly RaceResult[]): RaceResult | null {
  let winner: RaceResult | null = null;
  let winnerBytes = Number.POSITIVE_INFINITY;

  for (const result of results) {
    if (!result.held) {
      continue;
    }
    const candidateBytes = Buffer.byteLength(result.candidate.diff, 'utf8');
    if (candidateBytes < winnerBytes) {
      winner = result;
      winnerBytes = candidateBytes;
    }
  }

  return winner;
}
