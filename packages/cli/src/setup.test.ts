import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { installSutura, SetupError } from './setup.js';

const ACTION_SHA = 'a'.repeat(40);

describe('installSutura', () => {
  it('writes the BYOK workflow and sends secrets through stdin', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-init-'));
    const calls: Array<{ command: string; args: readonly string[]; stdin?: string }> = [];
    try {
      await mkdir(join(directory, '.github', 'workflows'), { recursive: true });
      await writeFile(join(directory, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\n');
      const run = vi.fn(async (command: string, args: readonly string[], options?: { stdin?: string }) => {
        calls.push({ command, args, ...(options?.stdin ? { stdin: options.stdin } : {}) });
        if (args[0] === 'repo') return 'octo/example\n';
        return '';
      });

      const result = await installSutura(
        { command: 'init', workflow: 'CI', repository: 'octo/example', actionSha: ACTION_SHA, force: false, tavilyEnabled: true },
        {
          cwd: directory,
          environment: {
            NEBIUS_API_KEY: 'nebius-private',
            CONTREE_TOKEN: 'contree-private',
            CONTREE_PROJECT: 'project-id',
            TAVILY_API_KEY: 'tavily-private',
          },
          run,
        },
      );

      const workflow = await readFile(join(directory, '.github', 'workflows', 'sutura.yml'), 'utf8');
      expect(workflow).toContain('workflows: ["CI"]');
      expect(workflow).toContain("workflow_run.conclusion == 'timed_out'");
      expect(workflow).toContain(`uses: juan294/sutura@${ACTION_SHA}`);
      expect(workflow).toContain('checks: write');
      expect(workflow).toContain('name: Sutura repair monitor');
      expect(workflow).toContain('run-name: "${{ format(');
      expect(workflow).toContain("&& 'No repair needed'");
      expect(workflow).toContain("&& 'Repair requested'");
      expect(workflow).toContain("|| 'Repair not triggered'");
      expect(workflow.match(/^run-name:.*$/gmu)).toHaveLength(1);
      expect(workflow).toContain('name: Attempt verified CI repair');
      expect(workflow).toContain('nebius-api-key: ${{ secrets.NEBIUS_API_KEY }}');
      expect(workflow).toContain('contree-project: ${{ vars.CONTREE_PROJECT }}');
      expect(result.lines.join('\n')).not.toMatch(/private|project-id/u);
      expect(calls.filter(({ args }) => args[0] === 'secret')).toHaveLength(3);
      expect(calls.filter(({ args }) => args[0] === 'secret').map(({ stdin }) => stdin)).toEqual([
        'nebius-private', 'contree-private', 'tavily-private',
      ]);
      expect(calls.flatMap(({ args }) => args)).not.toEqual(expect.arrayContaining([
        'nebius-private', 'contree-private', 'tavily-private',
      ]));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('detects one workflow and reports missing required BYOK values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-init-missing-'));
    try {
      await mkdir(join(directory, '.github', 'workflows'), { recursive: true });
      await writeFile(join(directory, '.github', 'workflows', 'checks.yaml'), 'name: Checks\non: [push]\n');
      const result = await installSutura(
        { command: 'init', actionSha: ACTION_SHA, force: false, tavilyEnabled: true },
        { cwd: directory, environment: {}, run: vi.fn(async () => 'octo/example\n') },
      );

      expect(result.missing).toEqual(['NEBIUS_API_KEY', 'CONTREE_TOKEN', 'CONTREE_PROJECT']);
      expect(result.lines.join('\n')).toContain('Set NEBIUS_API_KEY in your environment');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not overwrite an existing workflow without force', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-init-existing-'));
    try {
      await mkdir(join(directory, '.github', 'workflows'), { recursive: true });
      await writeFile(join(directory, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\n');
      await writeFile(join(directory, '.github', 'workflows', 'sutura.yml'), 'existing\n');

      await expect(installSutura(
        { command: 'init', workflow: 'CI', actionSha: ACTION_SHA, force: false, tavilyEnabled: true },
        { cwd: directory, environment: {}, run: vi.fn(async () => 'octo/example\n') },
      )).rejects.toThrow(SetupError);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses a symlinked workflows directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-init-link-'));
    const outside = await mkdtemp(join(tmpdir(), 'sutura-init-outside-'));
    try {
      await mkdir(join(directory, '.github'), { recursive: true });
      await writeFile(join(outside, 'ci.yml'), 'name: CI\non: [push]\n');
      await symlink(outside, join(directory, '.github', 'workflows'));

      await expect(installSutura(
        { command: 'init', workflow: 'CI', actionSha: ACTION_SHA, force: false, tavilyEnabled: true },
        { cwd: directory, environment: {} },
      )).rejects.toThrow(SetupError);
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('resolves the release tag before writing or configuring GitHub', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-init-release-'));
    const run = vi.fn(async (command: string) => {
      if (command === 'git') return `${ACTION_SHA}\trefs/tags/v0.2.1\n`;
      throw new Error('GitHub mutation must not run');
    });
    try {
      await mkdir(join(directory, '.github', 'workflows'), { recursive: true });
      await writeFile(join(directory, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\n');

      await installSutura(
        { command: 'init', workflow: 'CI', force: false, tavilyEnabled: false },
        { cwd: directory, environment: {}, run },
      );

      expect(await readFile(join(directory, '.github', 'workflows', 'sutura.yml'), 'utf8'))
        .toContain(`uses: juan294/sutura@${ACTION_SHA}`);
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('writes nothing when release tag resolution fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-init-release-fail-'));
    try {
      await mkdir(join(directory, '.github', 'workflows'), { recursive: true });
      await writeFile(join(directory, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\n');

      await expect(installSutura(
        { command: 'init', workflow: 'CI', force: false, tavilyEnabled: false },
        { cwd: directory, environment: {}, run: vi.fn().mockResolvedValue('') },
      )).rejects.toThrow(/release tag/u);
      await expect(readFile(join(directory, '.github', 'workflows', 'sutura.yml'), 'utf8'))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
