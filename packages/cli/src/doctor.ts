import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DoctorArguments } from './args.js';
import { VERSION } from './args.js';
import { type CommandRunner, resolveRepository, runCommand } from './command.js';
import { resolveActionCommit } from './release.js';

export interface DoctorOptions {
  cwd?: string;
  run?: CommandRunner;
}

export interface DoctorResult {
  exitCode: 0 | 1;
  lines: string[];
}

function line(passed: boolean, text: string): string {
  return `[${passed ? 'PASS' : 'FAIL'}] ${text}`;
}

function listed(output: string): Set<string> {
  return new Set(output.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean));
}

interface WorkflowLine {
  indent: number;
  text: string;
}

function workflowLines(workflow: string): WorkflowLine[] {
  return workflow.split(/\r?\n/u).flatMap((raw) => {
    if (!raw.trim() || raw.trimStart().startsWith('#') || /^\t/u.test(raw)) return [];
    return [{ indent: raw.length - raw.trimStart().length, text: raw.trim() }];
  });
}

function workflowContract(workflow: string, releaseRef: string): {
  checksWrite: boolean;
  actionReference: boolean;
  inputs: ReadonlyMap<string, boolean>;
} {
  const lines = workflowLines(workflow);
  const permissionIndex = lines.findIndex(({ indent, text }) => indent === 0 && text === 'permissions:');
  const permissionEnd = permissionIndex < 0
    ? permissionIndex
    : lines.findIndex(({ indent }, index) => index > permissionIndex && indent === 0);
  const permissionBlock = permissionIndex < 0
    ? []
    : lines.slice(permissionIndex + 1, permissionEnd < 0 ? undefined : permissionEnd);
  const permissionIndent = Math.min(...permissionBlock.map(({ indent }) => indent));
  const checksWrite = permissionBlock.some(
    ({ indent, text }) => indent === permissionIndent && text === 'checks: write',
  );

  const useText = `uses: ${releaseRef}`;
  let stepBlock: WorkflowLine[] = [];
  let directStepIndent = -1;
  for (const useIndex of lines.keys()) {
    const useLine = lines[useIndex] as WorkflowLine;
    if (useLine.text !== useText && useLine.text !== `- ${useText}`) continue;
    let stepStart = useIndex;
    while (stepStart >= 0) {
      const candidate = lines[stepStart] as WorkflowLine;
      if (candidate.indent <= useLine.indent && candidate.text.startsWith('- ')) break;
      stepStart -= 1;
    }
    const step = lines[stepStart];
    const stepsIndex = lines.findLastIndex(
      ({ indent, text }, index) => index < stepStart && text === 'steps:' && indent < (step?.indent ?? 0),
    );
    if (step && stepsIndex >= 0) {
      let stepEnd = lines.findIndex(
        ({ indent }, index) => index > stepStart && indent <= step.indent,
      );
      if (stepEnd < 0) stepEnd = lines.length;
      const candidate = lines.slice(stepStart, stepEnd);
      const childIndent = Math.min(
        ...candidate.slice(1).map(({ indent }) => indent).filter((indent) => indent > step.indent),
      );
      const directUse = useLine.text === `- ${useText}`
        ? useIndex === stepStart
        : useLine.indent === childIndent;
      if (directUse && candidate.some(
        ({ indent, text }) => indent === childIndent && text === 'with:',
      )) {
        stepBlock = candidate;
        directStepIndent = childIndent;
        break;
      }
    }
  }
  const withIndex = stepBlock.findIndex(
    ({ indent, text }) => indent === directStepIndent && text === 'with:',
  );
  const withLine = stepBlock[withIndex];
  const withEnd = withLine === undefined
    ? -1
    : stepBlock.findIndex(({ indent }, index) => index > withIndex && indent <= withLine.indent);
  const inputBlock = withLine === undefined
    ? []
    : stepBlock.slice(withIndex + 1, withEnd < 0 ? undefined : withEnd);
  const inputIndent = Math.min(...inputBlock.map(({ indent }) => indent));
  const requiredInputs = new Map([
    ['github-token', '${{ github.token }}'],
    ['run-id', '${{ github.event.workflow_run.id }}'],
    ['nebius-api-key', '${{ secrets.NEBIUS_API_KEY }}'],
    ['contree-token', '${{ secrets.CONTREE_TOKEN }}'],
    ['contree-project', '${{ vars.CONTREE_PROJECT }}'],
  ]);
  return {
    checksWrite,
    actionReference: stepBlock.length > 0,
    inputs: new Map([
      ...[...requiredInputs].map(([name, value]) => [
        name,
        inputBlock.some(({ indent, text }) =>
          indent === inputIndent && text === `${name}: ${value}`,
        ),
      ] as const),
      ['runtime', inputBlock.some(({ indent, text }) =>
        indent === inputIndent && /^runtime: (?:auto|node|python)$/u.test(text),
      )] as const,
    ]),
  };
}

export async function doctorSutura(
  request: DoctorArguments,
  options: DoctorOptions = {},
): Promise<DoctorResult> {
  const cwd = options.cwd ?? process.cwd();
  const run = options.run ?? runCommand;
  const lines: string[] = [];
  const workflowPath = join(cwd, '.github', 'workflows', 'sutura.yml');
  let workflow = '';
  try {
    const metadata = await lstat(workflowPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error('unsafe workflow path');
    workflow = await readFile(workflowPath, 'utf8');
    lines.push(line(true, 'Sutura workflow exists.'));
  } catch {
    lines.push(line(false, 'Sutura workflow is missing or unsafe.'));
  }
  let actionSha: string | undefined;
  try {
    actionSha = await resolveActionCommit({
      version: VERSION,
      cwd,
      run,
      ...(request.actionSha ? { explicitCommit: request.actionSha } : {}),
    });
  } catch (error) {
    lines.push(line(
      false,
      `Action release commit could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
    ));
  }
  const releaseRef = `juan294/sutura@${actionSha ?? '[unresolved]'}`;
  const contract = workflowContract(workflow, releaseRef);
  lines.push(line(contract.actionReference, `Workflow uses ${releaseRef}.`));
  lines.push(line(contract.checksWrite, 'Workflow grants checks: write.'));
  for (const [name, configured] of contract.inputs) {
    lines.push(line(configured, `Workflow wires ${name}.`));
  }

  try {
    const repository = await resolveRepository(cwd, request.repository, run);
    const [secretOutput, variableOutput] = await Promise.all([
      run('gh', ['secret', 'list', '--repo', repository, '--json', 'name', '--jq', '.[].name'], { cwd }),
      run('gh', ['variable', 'list', '--repo', repository, '--json', 'name', '--jq', '.[].name'], { cwd }),
    ]);
    const secrets = listed(secretOutput);
    const variables = listed(variableOutput);
    for (const name of ['NEBIUS_API_KEY', 'CONTREE_TOKEN']) {
      const configured = secrets.has(name);
      lines.push(line(configured, `GitHub secret ${name} is ${configured ? 'configured' : 'missing'}.`));
    }
    const projectConfigured = variables.has('CONTREE_PROJECT');
    lines.push(line(
      projectConfigured,
      `GitHub variable CONTREE_PROJECT is ${projectConfigured ? 'configured' : 'missing'}.`,
    ));
    if (secrets.has('TAVILY_API_KEY')) {
      lines.push(line(true, 'Optional GitHub secret TAVILY_API_KEY is configured.'));
    }
    if (secrets.has('OPENAI_API_KEY')) {
      lines.push(line(true, 'Optional GitHub secret OPENAI_API_KEY is configured.'));
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    lines.push(line(false, `GitHub configuration could not be inspected: ${detail}`));
  }
  return { exitCode: lines.some((value) => value.startsWith('[FAIL]')) ? 1 : 0, lines };
}
