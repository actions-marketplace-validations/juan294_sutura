import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { Candidate, Diagnosis } from '../domain.js';
import { InMemoryExecutor } from '../executor/memory.js';
import { completedTriageVerdict } from './triage.js';
import {
  anchoredEditsDiff,
  generateCandidates,
  prepareRepair,
  race,
  selectWinner,
  type RepairLlm,
  type RepairSourceContext,
} from './repair.js';

describe('anchoredEditsDiff', () => {
  const repeatedSource: RepairSourceContext = { sources: [{
    path: 'src/repeated.ts', startLine: 20, truncated: false,
    content: 'first\nrepeat\nrepeat\nlast\n',
  }] };

  it('derives exact old bytes from an inclusive line range even when text repeats', () => {
    expect(anchoredEditsDiff([{
      path: 'src/repeated.ts', startLine: 22, endLine: 22, new: 'changed',
    }], repeatedSource)).toContain(' first\n repeat\n-repeat\n+changed\n last');
  });

  it('rejects out-of-window and overlapping line anchors before sandbox work', () => {
    expect(() => anchoredEditsDiff([{
      path: 'src/repeated.ts', startLine: 19, endLine: 19, new: 'outside',
    }], repeatedSource)).toThrow('inside supplied source');
    expect(() => anchoredEditsDiff([
      { path: 'src/repeated.ts', startLine: 21, endLine: 22, new: 'first edit' },
      { path: 'src/repeated.ts', startLine: 22, endLine: 23, new: 'second edit' },
    ], repeatedSource)).toThrow('must not overlap');
    expect(() => anchoredEditsDiff([{
      path: '   ', startLine: 21, endLine: 21, new: 'invalid path',
    }], repeatedSource)).toThrow('anchored line schema');
    expect(() => anchoredEditsDiff([{
      path: 'src/repeated.ts', startLine: Number.MAX_SAFE_INTEGER + 1,
      endLine: Number.MAX_SAFE_INTEGER + 1, new: 'unsafe line',
    }], repeatedSource)).toThrow('anchored line schema');
  });

  it.each([
    ['without a final newline', 'old', 1, 1, 'new', 'new'],
    ['with CRLF', 'old\r\nnext\r\n', 1, 1, 'new', 'new\r\nnext\r\n'],
    [
      'for an unterminated final line in a CRLF file',
      'first\r\nold', 2, 2, 'new1\nnew2', 'first\r\nnew1\r\nnew2',
    ],
    ['when deleting a middle line', 'first\nobsolete\nlast\n', 2, 2, '', 'first\nlast\n'],
    ['when deleting an unterminated final line', 'first\nobsolete', 2, 2, '', 'first\n'],
  ])('builds a git-applicable anchored diff %s', async (
    _label, original, startLine, endLine, replacement, revised,
  ) => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-anchored-diff-'));
    try {
      await writeFile(join(directory, 'value.txt'), original);
      const generated = anchoredEditsDiff([{
        path: 'value.txt', startLine, endLine, new: replacement,
      }], { sources: [{ path: 'value.txt', startLine: 1, content: original, truncated: false }] });
      const apply = spawnSync('git', ['apply', '-'], {
        cwd: directory, input: generated, encoding: 'utf8',
      });
      expect(apply.status, apply.stderr).toBe(0);
      expect(await readFile(join(directory, 'value.txt'), 'utf8')).toBe(revised);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

const buildDiagnosis: Diagnosis = {
  class: 'build',
  confidence: 0.92,
  signals: ['mechanical:build'],
  failingCmd: 'pnpm test',
  errorExcerpt: 'Cannot find name value',
};

function candidate(id: string, diff: string): Candidate {
  return {
    id,
    rationale: `strategy ${id}`,
    diff: `diff --git a/src/${id}.ts b/src/${id}.ts
--- a/src/${id}.ts
+++ b/src/${id}.ts
@@ -1 +1 @@
-${diff}
+${diff} repaired
`,
  };
}

describe('generateCandidates', () => {
  it('rejects editable source when redaction would change it', async () => {
    const chat = vi.fn();

    await expect(generateCandidates({ chat }, buildDiagnosis, 1, {
      sources: [{
        path: 'src/config.ts',
        startLine: 1,
        content: 'export const config={"token":"source-secret"};\n',
        truncated: false,
      }],
    })).rejects.toThrow(/editable external text contains 1 credential pattern/u);
    expect(chat).not.toHaveBeenCalled();
  });

  it('makes one Super call for K independent, distinct candidates', async () => {
    const chat = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        candidates: [
          candidate('source-fix', 'source diff'),
          candidate('config-fix', 'configuration diff'),
          candidate('dependency-fix', 'dependency diff'),
        ],
      }),
    });
    const llm: RepairLlm = { chat };

    await expect(generateCandidates(llm, buildDiagnosis, 3)).resolves.toEqual([
      candidate('source-fix', 'source diff'),
      candidate('config-fix', 'configuration diff'),
      candidate('dependency-fix', 'dependency diff'),
    ]);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledWith(
      'super',
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringMatching(/independent[\s\S]*source[\s\S]*configuration[\s\S]*dependency/i),
        }),
      ]),
      expect.objectContaining({
        maxTokens: 16_384,
        reasoningEffort: 'low',
        responseFormat: { type: 'json_object' },
        temperature: 1,
      }),
    );
    const systemPrompt = (chat.mock.calls[0]?.[1] as Array<{ role: string; content: string }>)
      .find(({ role }) => role === 'system')?.content;
    expect(systemPrompt).toContain('complete unified diff');
    expect(systemPrompt).not.toContain('non-empty edits array');
  });

  it('includes bounded repository source context in the repair request', async () => {
    const chat = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        candidates: [
          ['source-fix', 'replace with a string literal', '"1"'],
          ['constructor-fix', 'replace with an explicit conversion', 'String(1)'],
          ['template-fix', 'replace with a template literal', '`1`'],
        ].map(([id, rationale, replacement]) => ({
          id,
          rationale,
          edits: [{
            path: 'src/value.ts',
            old: 'export const value: string = 1;',
            new: `export const value: string = ${replacement};`,
          }],
        })),
      }),
    });
    const sourceContext: RepairSourceContext = {
      sources: [
        {
          path: 'src/value.ts',
          startLine: 1,
          content: 'export const value: string = 1;',
          truncated: false,
        },
      ],
    };

    await generateCandidates({ chat }, buildDiagnosis, 3, sourceContext);

    const messages = chat.mock.calls[0]?.[1] as Array<{
      role: string;
      content: string;
    }>;
    const user = messages.find(({ role }) => role === 'user');
    expect(JSON.parse(user?.content ?? '')).toEqual({
      diagnosis: buildDiagnosis,
      sourceContext,
    });
  });

  it('builds an exact unified diff from a structured source edit', async () => {
    const sourceContext: RepairSourceContext = {
      sources: [{
        path: 'src/value.ts',
        startLine: 10,
        content: [
          'const before = 1;',
          "const value: number = '1';",
          'const after = 2;',
        ].join('\n') + '\n',
        truncated: false,
      }],
    };
    const chat = vi.fn().mockResolvedValue({
      text: JSON.stringify({ candidates: [{
        id: 'source-fix',
        rationale: 'replace the string with a number',
        edits: [{
          path: 'src/value.ts',
          old: "const value: number = '1';",
          new: 'const value: number = 1;',
        }],
      }] }),
    });

    await expect(generateCandidates({ chat }, buildDiagnosis, 1, sourceContext))
      .resolves.toEqual([expect.objectContaining({
        diff: [
          'diff --git a/src/value.ts b/src/value.ts',
          '--- a/src/value.ts',
          '+++ b/src/value.ts',
          '@@ -10,3 +10,3 @@',
          ' const before = 1;',
          "-const value: number = '1';",
          '+const value: number = 1;',
          ' const after = 2;',
          '',
        ].join('\n'),
      })]);
    const systemPrompt = (chat.mock.calls[0]?.[1] as Array<{ role: string; content: string }>)
      .find(({ role }) => role === 'system')?.content;
    expect(systemPrompt).toContain('Copy old verbatim from sourceContext');
  });

  it('recovers a structured edit from a malformed outer candidates object', async () => {
    const sourceContext: RepairSourceContext = {
      sources: [{ path: 'src/value.ts', startLine: 1, content: 'old', truncated: false }],
    };
    const candidateObject = JSON.stringify({
      id: 'source-fix',
      rationale: 'replace the exact value',
      edits: [{ path: 'src/value.ts', old: 'old', new: 'new' }],
    });
    const chat = vi.fn().mockResolvedValue({
      text: `{"candidates":[${candidateObject}}`,
    });

    await expect(generateCandidates({ chat }, buildDiagnosis, 1, sourceContext))
      .resolves.toEqual([expect.objectContaining({ id: 'source-fix' })]);
    expect(chat).toHaveBeenCalledOnce();
  });

  it.each([
    ['without a final newline', 'old', 'new'],
    ['with CRLF', 'old\r\nnext\r\n', 'new\r\nnext\r\n'],
  ])('builds a git-applicable structured diff %s', async (_label, original, revised) => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-structured-diff-'));
    try {
      await writeFile(join(directory, 'value.txt'), original);
      const sourceContext: RepairSourceContext = {
        sources: [{ path: 'value.txt', startLine: 1, content: original, truncated: false }],
      };
      const chat = vi.fn().mockResolvedValue({
        text: JSON.stringify({ candidates: [{
          id: 'source-fix',
          rationale: 'replace the exact value',
          edits: [{ path: 'value.txt', old: original, new: revised }],
        }] }),
      });

      const [generated] = await generateCandidates({ chat }, buildDiagnosis, 1, sourceContext);
      const check = spawnSync('git', ['apply', '--check', '-'], {
        cwd: directory,
        input: generated?.diff,
        encoding: 'utf8',
      });

      expect(check.status, check.stderr).toBe(0);
      if (!original.endsWith('\n')) {
        expect(generated?.diff).toContain('\\ No newline at end of file');
      }
      if (original.includes('\r\n')) expect(generated?.diff).toContain('\r\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['an unsupported file', candidate('other', 'old')],
    ['old text absent from source', candidate('value', 'absent')],
    ['a new file', {
      id: 'new-file',
      rationale: 'add another file',
      diff: `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+export const value = 1;
`,
    }],
    ['a rename target', {
      id: 'rename-file',
      rationale: 'rename the supplied file',
      diff: `diff --git a/src/value.ts b/src/renamed.ts
similarity index 80%
rename from src/value.ts
rename to src/renamed.ts
--- a/src/value.ts
+++ b/src/renamed.ts
@@ -1 +1 @@
-old
+new
`,
    }],
  ])('rejects raw diffs grounded in %s', async (_label, rawCandidate) => {
    const sourceContext: RepairSourceContext = {
      sources: [{ path: 'src/value.ts', startLine: 1, content: 'old', truncated: false }],
    };
    const chat = vi.fn().mockResolvedValue({
      text: JSON.stringify({ candidates: [rawCandidate] }),
    });

    await expect(generateCandidates({ chat }, buildDiagnosis, 1, sourceContext))
      .rejects.toThrow(/must (?:be supplied in source context|match supplied source|not rename)/u);
  });

  it('rejects a rename even when both paths are supplied', async () => {
    const sourceContext: RepairSourceContext = {
      sources: [
        { path: 'src/value.ts', startLine: 1, content: 'old\n', truncated: false },
        { path: 'src/renamed.ts', startLine: 1, content: 'old\n', truncated: false },
      ],
    };
    const renamed = {
      id: 'rename-file',
      rationale: 'rename the supplied file',
      diff: `diff --git a/src/value.ts b/src/renamed.ts
similarity index 80%
rename from src/value.ts
rename to src/renamed.ts
--- a/src/value.ts
+++ b/src/renamed.ts
@@ -1 +1 @@
-old
+new
`,
    };
    const chat = vi.fn().mockResolvedValue({
      text: JSON.stringify({ candidates: [renamed] }),
    });

    await expect(generateCandidates({ chat }, buildDiagnosis, 1, sourceContext))
      .rejects.toThrow('must not rename source files');
  });

  it('rejects a model reply with fewer than K candidates', async () => {
    const llm: RepairLlm = {
      chat: vi.fn().mockResolvedValue({
        text: JSON.stringify({ candidates: [candidate('one', 'diff')] }),
      }),
    };

    await expect(generateCandidates(llm, buildDiagnosis, 3)).rejects.toThrow(
      'exactly 3 candidates',
    );
  });

  it('supports every configured race slot beyond the three base strategies', async () => {
    const chat = vi.fn().mockResolvedValue({ text: JSON.stringify({ candidates: [
      candidate('one', 'diff 1'),
      candidate('two', 'diff 2'),
      candidate('three', 'diff 3'),
      candidate('four', 'diff 4'),
    ] }) });

    await expect(generateCandidates({ chat }, buildDiagnosis, 4)).resolves.toHaveLength(4);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('rejects candidates that repeat a strategy rationale', async () => {
    const llm: RepairLlm = {
      chat: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          candidates: [
            candidate('one', 'first diff'),
            { ...candidate('two', 'second diff'), rationale: 'strategy one' },
            candidate('three', 'third diff'),
          ],
        }),
      }),
    };

    await expect(generateCandidates(llm, buildDiagnosis, 3)).rejects.toThrow(
      'candidate rationales must be distinct',
    );
  });

  it('repairs candidates whose diffs omit git headers and numbered hunks once', async () => {
    const repaired = [candidate('source-fix', 'source diff')];
    const chat = vi.fn()
      .mockResolvedValueOnce({
        text: JSON.stringify({
          candidates: repaired.map((value) => ({ ...value, diff: '--- a/src/value.ts\n+++ b/src/value.ts\n@@\n-old\n+new' })),
        }),
      })
      .mockResolvedValueOnce({ text: JSON.stringify({ candidates: repaired }) });

    await expect(generateCandidates({ chat }, buildDiagnosis, 1)).resolves.toEqual(repaired);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1]?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant' }),
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('complete git unified diff with numbered hunks'),
      }),
    ]));
    expect(chat.mock.calls[1]?.[2]).toMatchObject({
      reasoningEffort: 'low',
      responseFormat: { type: 'json_object' },
      temperature: 1,
    });
  });

  it('repairs a hunk whose anchored context does not match the supplied source', async () => {
    const sourceContext: RepairSourceContext = {
      sources: [{
        path: 'src/value.ts',
        startLine: 1,
        content: [
          'const before = 1;',
          "const value: number = '1';",
          'const after = 2;',
        ].join('\n'),
        truncated: false,
      }],
    };
    const mismatched = {
      id: 'source-fix',
      rationale: 'replace the string with a number',
      diff: `diff --git a/src/value.ts b/src/value.ts
--- a/src/value.ts
+++ b/src/value.ts
@@ -1,3 +1,3 @@
 const after = 2;
-const value: number = '1';
+const value: number = 1;
 const before = 1;
`,
    };
    const repaired = {
      ...mismatched,
      diff: `diff --git a/src/value.ts b/src/value.ts
--- a/src/value.ts
+++ b/src/value.ts
@@ -1,3 +1,3 @@
 const before = 1;
-const value: number = '1';
+const value: number = 1;
 const after = 2;
`,
    };
    const chat = vi.fn()
      .mockResolvedValueOnce({ text: JSON.stringify({ candidates: [mismatched] }) })
      .mockResolvedValueOnce({ text: JSON.stringify({ candidates: [repaired] }) });

    await expect(
      generateCandidates({ chat }, buildDiagnosis, 1, sourceContext),
    ).resolves.toEqual([repaired]);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1]?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('match supplied source src/value.ts exactly'),
      }),
    ]));
  });

  it('retries an empty structured reply without an empty assistant turn', async () => {
    const repaired = [candidate('source-fix', 'source diff')];
    const chat = vi.fn()
      .mockResolvedValueOnce({ text: '' })
      .mockResolvedValueOnce({ text: JSON.stringify({ candidates: repaired }) });

    await expect(generateCandidates({ chat }, buildDiagnosis, 1)).resolves.toEqual(repaired);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1]?.[1]).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant' }),
    ]));
  });

  it('canonicalizes omitted hunk context prefixes before validation', async () => {
    const chat = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        candidates: [{
          id: 'source-fix',
          rationale: 'replace the off-by-one formula',
          diff: `diff --git a/src/page-count.js b/src/page-count.js
--- a/src/page-count.js
+++ b/src/page-count.js
@@ -6,2 +6,2 @@
export function pageCount(items, size) {
-  return Math.floor(items / size) + 1;
+  return Math.ceil(items / size);
}
`,
        }],
      }),
    });

    await expect(generateCandidates({ chat }, buildDiagnosis, 1)).resolves.toEqual([
      expect.objectContaining({
        diff: expect.stringContaining(
          '@@ -6,3 +6,3 @@\n export function pageCount(items, size) {',
        ),
      }),
    ]);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('adds the final patch-file newline required by git apply', async () => {
    const unterminated = candidate('source-fix', 'source diff');
    unterminated.diff = unterminated.diff.trimEnd();
    const chat = vi.fn().mockResolvedValue({
      text: JSON.stringify({ candidates: [unterminated] }),
    });

    const [generated] = await generateCandidates({ chat }, buildDiagnosis, 1);

    expect(generated?.diff).toBe(`${unterminated.diff}\n`);
  });
});

describe('prepareRepair', () => {
  it('short-circuits a flaky verdict without calling candidate generation', async () => {
    const executor = new InMemoryExecutor(() => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      truncated: false,
      metrics: {},
    }));
    const chat = vi.fn();

    await expect(
      prepareRepair(executor, { chat }, 'failure-image', buildDiagnosis, 5, 3),
    ).resolves.toEqual({
      triage: completedTriageVerdict([0, 0, 0, 0], 5),
      candidates: [],
    });
    expect(chat).not.toHaveBeenCalled();
  });

  it('rejects an excessive candidate count before paid triage work', async () => {
    const executor = new InMemoryExecutor(() => ({
      exitCode: 1,
      stdout: '',
      stderr: '',
      truncated: false,
      metrics: {},
    }));

    await expect(
      prepareRepair(executor, { chat: vi.fn() }, 'failure-image', buildDiagnosis, 5, 11),
    ).rejects.toThrow('K must be between 1 and 10');
    expect(executor.calls).toEqual([]);
  });
});

describe('race and selectWinner', () => {
  it('races all candidates from one parent and selects the smallest held diff', async () => {
    const exits = [1, 0, 0, 0, 0];
    const executor = new InMemoryExecutor((_cmd, _parent, callIndex) => ({
      exitCode: exits[callIndex] ?? 1,
      stdout: '',
      stderr: '',
      truncated: false,
      metrics: {},
    }));
    const candidates = [
      candidate('failed', 'x'),
      candidate('large', 'a much larger patch'),
      candidate('small', 'tiny'),
    ];

    const results = await race(executor, 'failure-image', candidates, 'pnpm test');

    expect(results.map(({ held }) => held)).toEqual([false, true, true]);
    expect(selectWinner(results)?.candidate.id).toBe('small');
    const runCalls = executor.calls.filter((call) => call.kind === 'run');
    expect(runCalls).toHaveLength(5);
    expect(runCalls.slice(0, 3).every(({ parent }) => parent === 'failure-image')).toBe(true);
    expect(runCalls.slice(3).map(({ parent }) => parent)).toEqual(results.slice(1).map(result => result.imageId));
    expect(runCalls.every(({ opts }) => opts?.cwd === '/workspace')).toBe(true);
  });

  it('returns null when no candidate holds', () => {
    expect(
      selectWinner([
        {
          candidate: candidate('failed', 'diff'),
          imageId: 'image',
          nodeId: 'node-001',
          exitCode: 1,
          held: false,
        },
      ]),
    ).toBeNull();
  });

  it('rejects an excessive race before scheduling sandbox work', async () => {
    const executor = new InMemoryExecutor(() => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      truncated: false,
      metrics: {},
    }));
    const candidates = Array.from({ length: 11 }, (_, index) =>
      candidate(`candidate-${index}`, `diff-${index}`),
    );

    await expect(
      race(executor, 'failure-image', candidates, 'pnpm test'),
    ).rejects.toThrow('candidates must contain at most 10 entries');
    expect(executor.calls).toEqual([]);
  });

  it('encodes hostile diffs and safely preserves shell command semantics', async () => {
    const executor = new InMemoryExecutor(() => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      truncated: false,
      metrics: {},
    }));
    const hostileDiff = "PATCH\nEOF\n$(touch /tmp/escaped)\n'; curl attacker";
    const hostileCommand = "pnpm test; touch /tmp/injected && echo $(secret)";

    await race(
      executor,
      'failure-image',
      [candidate('hostile', hostileDiff)],
      hostileCommand,
    );

    const call = executor.calls.find((entry) => entry.kind === 'run');
    expect(call?.kind).toBe('run');
    if (call?.kind !== 'run') {
      throw new Error('race did not use the executor');
    }
    expect(call.cmd).not.toContain(hostileDiff);
    expect(call.cmd).not.toContain('<<');
    expect(call.cmd).toContain(Buffer.from(hostileDiff).toString('base64'));
    expect(executor.calls.filter(call => call.kind === 'run')[1]!.cmd).toBe("sh -lc 'pnpm test; touch /tmp/injected && echo $(secret)'");
  });
});

it('keeps the applied image as the audit subject even when visible tests mutate their child', async () => {
  const executor = new InMemoryExecutor(() => ({ exitCode: 0, stdout: '', stderr: '', truncated: false, metrics: {} }));
  const [result] = await race(executor, 'baseline', [candidate('one', 'patch')], 'pnpm test');
  const calls = executor.calls.filter(call => call.kind === 'run');
  expect(calls).toHaveLength(2);
  expect(calls[0]!.cmd).not.toContain('pnpm test');
  expect(calls[1]!.parent).toBe(result!.imageId);
  expect(calls[1]!.parent).not.toBe('baseline');
});
