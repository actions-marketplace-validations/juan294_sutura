import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { InitArguments } from './args.js';
import { VERSION } from './args.js';
import { type CommandRunner, resolveRepository, runCommand } from './command.js';
import { resolveActionCommit } from './release.js';

const REQUIRED_SECRET_NAMES = ['NEBIUS_API_KEY', 'CONTREE_TOKEN'] as const;
const REQUIRED_VARIABLE_NAMES = ['CONTREE_PROJECT'] as const;
const OPTIONAL_SECRET_NAMES = ['TAVILY_API_KEY'] as const;
const MAX_WORKFLOW_BYTES = 128 * 1024;

export interface SetupOptions {
  cwd?: string;
  environment?: Readonly<NodeJS.ProcessEnv>;
  run?: CommandRunner;
}

export interface SetupResult {
  workflowPath: string;
  configured: string[];
  missing: string[];
  lines: string[];
}

export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupError';
  }
}

function selectedRuntime(environment: Readonly<NodeJS.ProcessEnv>): 'auto' | 'node' | 'python' {
  const runtime = environment.SUTURA_RUNTIME?.trim() || 'auto';
  if (runtime !== 'auto' && runtime !== 'node' && runtime !== 'python') {
    throw new SetupError('SUTURA_RUNTIME must be auto, node, or python');
  }
  return runtime;
}

function actionWorkflow(
  workflow: string,
  tavilyEnabled: boolean,
  actionSha: string,
  runtime = 'auto',
): string {
  const tavilyInput = tavilyEnabled
    ? '          tavily-api-key: ${{ secrets.TAVILY_API_KEY }}\n'
    : '';
  return `name: Sutura repair monitor
run-name: "\${{ format('{0}: {1} #{2} ({3}) on {4}', github.event.workflow_run.conclusion == 'success' && 'No repair needed' || (github.event.workflow_run.conclusion == 'failure' || github.event.workflow_run.conclusion == 'timed_out') && 'Repair requested' || 'Repair not triggered', github.event.workflow_run.name, github.event.workflow_run.run_number, github.event.workflow_run.conclusion, github.event.workflow_run.head_branch) }}"

on:
  workflow_run:
    workflows: [${JSON.stringify(workflow)}]
    types: [completed]

permissions:
  actions: read
  checks: write
  contents: write
  pull-requests: write

concurrency:
  group: sutura-\${{ github.event.workflow_run.id }}
  cancel-in-progress: false

jobs:
  repair:
    name: Attempt verified CI repair
    if: >-
      \${{
        github.event.workflow_run.conclusion == 'failure' ||
        github.event.workflow_run.conclusion == 'timed_out'
      }}
    runs-on: ubuntu-latest
    steps:
      - name: Verify and repair failed CI
        uses: juan294/sutura@${actionSha}
        with:
          github-token: \${{ github.token }}
          run-id: \${{ github.event.workflow_run.id }}
          runtime: ${runtime}
          nebius-api-key: \${{ secrets.NEBIUS_API_KEY }}
${tavilyInput}          contree-token: \${{ secrets.CONTREE_TOKEN }}
          contree-project: \${{ vars.CONTREE_PROJECT }}
`;
}

async function assertNotSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new SetupError(`Refusing symbolic link: ${path}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function workflowNames(cwd: string): Promise<string[]> {
  const directory = join(cwd, '.github', 'workflows');
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const names: string[] = [];
  for (const file of files.sort()) {
    if (!/\.ya?ml$/u.test(file) || /^sutura\.ya?ml$/u.test(file)) continue;
    const path = join(directory, file);
    await assertNotSymlink(path);
    const content = await readFile(path);
    if (content.byteLength > MAX_WORKFLOW_BYTES) continue;
    const match = /^name:\s*(?:['"]([^'"]+)['"]|([^#\r\n]+))\s*$/mu.exec(content.toString('utf8'));
    const name = (match?.[1] ?? match?.[2])?.trim();
    if (name) names.push(name);
  }
  return names;
}

async function chooseWorkflow(cwd: string, requested: string | undefined): Promise<string> {
  const names = await workflowNames(cwd);
  if (requested) {
    if (!names.includes(requested)) {
      throw new SetupError(`Workflow not found: ${requested}`);
    }
    return requested;
  }
  if (names.length === 1 && names[0]) return names[0];
  if (names.length === 0) {
    throw new SetupError('No GitHub Actions workflow was found. Add CI before Sutura.');
  }
  throw new SetupError(`Multiple workflows found. Select one with --workflow: ${names.join(', ')}`);
}

async function configureSecret(
  name: string,
  value: string,
  repository: string,
  cwd: string,
  run: CommandRunner,
): Promise<void> {
  await run('gh', ['secret', 'set', name, '--repo', repository], { cwd, stdin: value });
}

export async function installSutura(
  request: InitArguments,
  options: SetupOptions = {},
): Promise<SetupResult> {
  const cwd = options.cwd ?? process.cwd();
  const environment = options.environment ?? process.env;
  const run = options.run ?? runCommand;
  const workflowsDirectory = join(cwd, '.github', 'workflows');
  const workflowPath = join(workflowsDirectory, 'sutura.yml');
  await assertNotSymlink(join(cwd, '.github'));
  await assertNotSymlink(workflowsDirectory);
  await assertNotSymlink(workflowPath);
  const workflow = await chooseWorkflow(cwd, request.workflow);
  try {
    await lstat(workflowPath);
    if (!request.force) throw new SetupError('Sutura workflow exists. Use --force to replace it.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const actionSha = await resolveActionCommit({
    version: VERSION,
    cwd,
    run,
    ...(request.actionSha ? { explicitCommit: request.actionSha } : {}),
  });
  await mkdir(workflowsDirectory, { recursive: true });
  await writeFile(
    workflowPath,
    actionWorkflow(workflow, request.tavilyEnabled, actionSha, selectedRuntime(environment)),
    { mode: 0o644 },
  );

  const configured: string[] = [];
  const missing: string[] = [];
  const values = [
    ...REQUIRED_SECRET_NAMES.map((name) => ({ name, kind: 'secret' as const })),
    ...REQUIRED_VARIABLE_NAMES.map((name) => ({ name, kind: 'variable' as const })),
    ...(request.tavilyEnabled
      ? OPTIONAL_SECRET_NAMES.map((name) => ({ name, kind: 'optional-secret' as const }))
      : []),
  ];
  const available = values.filter(({ name }) => Boolean(environment[name]?.trim()));
  const requiredMissing = values.filter(({ name, kind }) =>
    kind !== 'optional-secret' && !environment[name]?.trim(),
  );
  missing.push(...requiredMissing.map(({ name }) => name));

  if (available.length > 0) {
    const repository = await resolveRepository(cwd, request.repository, run);
    for (const { name, kind } of available) {
      const value = environment[name]?.trim();
      if (!value) continue;
      if (kind === 'variable') {
        await run('gh', ['variable', 'set', name, '--repo', repository, '--body', value], { cwd });
      } else {
        await configureSecret(name, value, repository, cwd, run);
      }
      configured.push(name);
    }
  }

  const lines = [
    `[PASS] Wrote ${join('.github', 'workflows', basename(workflowPath))} for ${workflow}.`,
    ...configured.map((name) => `[PASS] Configured ${name} in GitHub.`),
    ...missing.map((name) => `Set ${name} in your environment, then rerun sutura init --force.`),
    'Run sutura doctor after setup.',
  ];
  return { workflowPath, configured, missing, lines };
}

export { actionWorkflow };
