import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('published CLI bundle', () => {
  beforeAll(async () => {
    await execFileAsync('pnpm', ['run', 'build'], {
      cwd: new URL('..', import.meta.url),
    });
  }, 90_000);

  it('contains the evaluation commands and manifest validator', async () => {
    const bundle = await readFile(new URL('../dist/bin.js', import.meta.url), 'utf8');
    expect(bundle).toContain('sutura eval validate --manifest');
    expect(bundle).toContain('sutura-evaluation-v1');
    expect(bundle).toContain('ATIF-v1.7');
  });
});
