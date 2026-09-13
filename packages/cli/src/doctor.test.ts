import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { doctorSutura } from './doctor.js';

const ACTION_SHA = 'a'.repeat(40);

describe('doctorSutura', () => {
  it('passes when the workflow and required GitHub names exist', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-doctor-'));
    try {
      await mkdir(join(directory, '.github', 'workflows'), { recursive: true });
      await writeFile(
        join(directory, '.github', 'workflows', 'sutura.yml'),
        [
          'permissions:', '  checks: write', 'jobs:', '  repair:', '    steps:',
          '      - name: Repair', `        uses: juan294/sutura@${ACTION_SHA}`, '        with:',
          '          github-token: ${{ github.token }}',
          '          run-id: ${{ github.event.workflow_run.id }}',
          '          nebius-api-key: ${{ secrets.NEBIUS_API_KEY }}',
          '          contree-token: ${{ secrets.CONTREE_TOKEN }}',
          '          contree-project: ${{ vars.CONTREE_PROJECT }}',
          '          runtime: auto',
        ].join('\n'),
      );
      const run = vi.fn(async (_command: string, args: readonly string[]) => {
        if (args[0] === 'secret') return 'NEBIUS_API_KEY\nCONTREE_TOKEN\nTAVILY_API_KEY\n';
        if (args[0] === 'variable') return 'CONTREE_PROJECT\n';
        return 'octo/example\n';
      });

      const result = await doctorSutura(
        { command: 'doctor', repository: 'octo/example', actionSha: ACTION_SHA },
        { cwd: directory, run },
      );

      expect(result.exitCode).toBe(0);
      expect(result.lines.every((line) => line.startsWith('[PASS]'))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects action-like keys nested under another step key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-doctor-spoof-'));
    try {
      await mkdir(join(directory, '.github', 'workflows'), { recursive: true });
      await writeFile(join(directory, '.github', 'workflows', 'sutura.yml'), [
        'permissions:', '  checks: write', 'jobs:', '  repair:', '    steps:',
        '      - name: Spoofed action', '        env:',
        `          uses: juan294/sutura@${ACTION_SHA}`,
        '          with:',
        '            github-token: ${{ github.token }}',
        '            run-id: ${{ github.event.workflow_run.id }}',
        '            nebius-api-key: ${{ secrets.NEBIUS_API_KEY }}',
        '            contree-token: ${{ secrets.CONTREE_TOKEN }}',
        '            contree-project: ${{ vars.CONTREE_PROJECT }}',
      ].join('\n'));
      const run = vi.fn(async (_command: string, args: readonly string[]) => {
        if (args[0] === 'secret') return 'NEBIUS_API_KEY\nCONTREE_TOKEN\n';
        if (args[0] === 'variable') return 'CONTREE_PROJECT\n';
        return 'octo/example\n';
      });

      const result = await doctorSutura({ command: 'doctor', repository: 'octo/example', actionSha: ACTION_SHA }, { cwd: directory, run });
      expect(result.exitCode).toBe(1);
      expect(result.lines).toEqual(expect.arrayContaining([
        `[FAIL] Workflow uses juan294/sutura@${ACTION_SHA}.`,
        '[FAIL] Workflow wires github-token.',
      ]));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails without the required GitHub names', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-doctor-missing-'));
    try {
      await mkdir(join(directory, '.github', 'workflows'), { recursive: true });
      await writeFile(join(directory, '.github', 'workflows', 'sutura.yml'), `uses: juan294/sutura@${ACTION_SHA}\n`);
      const run = vi.fn(async (_command: string, args: readonly string[]) => {
        if (args[0] === 'repo') return 'octo/example\n';
        return '';
      });

      const result = await doctorSutura({ command: 'doctor', actionSha: ACTION_SHA }, { cwd: directory, run });

      expect(result.exitCode).toBe(1);
      expect(result.lines).toEqual(expect.arrayContaining([
        '[FAIL] Workflow grants checks: write.',
        '[FAIL] Workflow wires github-token.',
        '[FAIL] GitHub secret NEBIUS_API_KEY is missing.',
        '[FAIL] GitHub secret CONTREE_TOKEN is missing.',
        '[FAIL] GitHub variable CONTREE_PROJECT is missing.',
      ]));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('verifies an immutable workflow commit against the release tag', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-doctor-release-'));
    try {
      await mkdir(join(directory, '.github', 'workflows'), { recursive: true });
      await writeFile(join(directory, '.github', 'workflows', 'sutura.yml'), [
        'permissions:', '  checks: write', 'jobs:', '  repair:', '    steps:',
        '      - name: Repair', `        uses: juan294/sutura@${ACTION_SHA}`, '        with:',
        '          github-token: ${{ github.token }}',
        '          run-id: ${{ github.event.workflow_run.id }}',
        '          nebius-api-key: ${{ secrets.NEBIUS_API_KEY }}',
        '          contree-token: ${{ secrets.CONTREE_TOKEN }}',
        '          contree-project: ${{ vars.CONTREE_PROJECT }}',
        '          runtime: auto',
      ].join('\n'));
      const run = vi.fn(async (command: string, args: readonly string[]) => {
        if (command === 'git') return `${ACTION_SHA}\trefs/tags/v0.2.1\n`;
        if (args[0] === 'secret') return 'NEBIUS_API_KEY\nCONTREE_TOKEN\n';
        if (args[0] === 'variable') return 'CONTREE_PROJECT\n';
        return 'octo/example\n';
      });

      const result = await doctorSutura({ command: 'doctor', repository: 'octo/example' }, { cwd: directory, run });
      expect(result.exitCode).toBe(0);
      expect(result.lines).toContain(`[PASS] Workflow uses juan294/sutura@${ACTION_SHA}.`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
