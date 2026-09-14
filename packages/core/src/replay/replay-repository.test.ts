import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ReplayBundle } from './bundle.js';
import { detectRuntimeAtPath } from '../runtime/detect.js';
import { RecordedRepository } from './replay-repository.js';

const LIMITS = {
  maxFiles: 1,
  maxLinesPerFile: 10,
  maxCharactersPerFile: 100,
  maxBytesPerFile: 100,
};

function bundle(): ReplayBundle {
  return {
    repository: [
      {
        sequence: 1,
        method: 'readPolicyAtSha',
        args: ['acme/widget', 'a'.repeat(40)],
        result: '{"version":1}',
      },
      {
        sequence: 2,
        method: 'checkoutHead',
        args: ['acme/widget', 'a'.repeat(40), 'main', null],
        result: {
          checkoutId: 'checkout-1',
          snapshot: {
            runtimeEvidencePaths: ['package.json', 'packages/app/package.json'],
            files: [{ path: 'package.json', content: '{"scripts":{"test":"vitest"}}' }],
          },
        },
      },
      {
        sequence: 3,
        method: 'readSourceExcerpts',
        args: ['checkout-1', [{ path: 'src/index.ts', line: 4 }], LIMITS],
        result: [{ path: 'src/index.ts', startLine: 1, content: 'throw fail', truncated: false }],
      },
      {
        sequence: 4,
        method: 'publishFix',
        args: [{ branch: 'sutura/fix-1', checkoutDir: 'checkout-1', diff: 'diff', headSha: 'a'.repeat(40), message: 'fix' }],
        result: null,
      },
    ],
  } as ReplayBundle;
}

describe('RecordedRepository', () => {
  it('materializes a bounded checkout and maps its path back to the logical id', async () => {
    const repository = new RecordedRepository(bundle().repository);
    try {
      await expect(repository.readPolicyAtSha('acme/widget', 'a'.repeat(40)))
        .resolves.toBe('{"version":1}');
      const checkoutDir = await repository.checkoutHead('acme/widget', 'a'.repeat(40), 'main');
      await expect(readFile(join(checkoutDir, 'package.json'), 'utf8'))
        .resolves.toBe('{"scripts":{"test":"vitest"}}');
      await expect(readFile(join(checkoutDir, 'packages/app/package.json'), 'utf8'))
        .resolves.toBe('');
      await expect(repository.readSourceExcerpts(
        checkoutDir,
        [{ path: 'src/index.ts', line: 4 }],
        LIMITS,
      )).resolves.toEqual([
        { path: 'src/index.ts', startLine: 1, content: 'throw fail', truncated: false },
      ]);
      await expect(repository.publishFix({
        branch: 'sutura/fix-1',
        checkoutDir,
        diff: 'diff',
        headSha: 'a'.repeat(40),
        message: 'fix',
      })).resolves.toBeUndefined();
      expect(repository.normalizeArgs([checkoutDir, `${checkoutDir}/package.json`]))
        .toEqual(['checkout-1', 'checkout-1/package.json']);
    } finally {
      await repository.cleanup();
    }
  });

  it('rejects snapshot paths that escape the replay checkout', async () => {
    const value = bundle();
    value.repository[1]!.result = {
      checkoutId: 'checkout-1',
      snapshot: { runtimeEvidencePaths: ['../outside'], files: [] },
    };
    const repository = new RecordedRepository(value.repository);
    try {
      await repository.readPolicyAtSha('acme/widget', 'a'.repeat(40));
      await expect(repository.checkoutHead('acme/widget', 'a'.repeat(40), 'main'))
        .rejects.toThrow('snapshot path');
    } finally {
      await repository.cleanup();
    }
  });

  it('materializes the evidence selected by live runtime detection for replay', async () => {
    const value = bundle();
    const repository = new RecordedRepository(
      value.repository,
      undefined,
      ['services/worker/tests/test_widget.py'],
    );
    try {
      await repository.readPolicyAtSha('acme/widget', 'a'.repeat(40));
      const checkoutDir = await repository.checkoutHead('acme/widget', 'a'.repeat(40), 'main');
      await expect(readFile(join(checkoutDir, 'services/worker/tests/test_widget.py'), 'utf8'))
        .resolves.toBe('');
      await expect(detectRuntimeAtPath(checkoutDir, 'pytest'))
        .resolves.toMatchObject({ id: 'python' });
    } finally {
      await repository.cleanup();
    }
  });
});
