const MAX_CANDIDATE_DIFF_BYTES = 1024 * 1024;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const SHA_PATTERN = /^[a-f0-9]{40}$/iu;

export const VERSION = '0.2.1';
export const USAGE = [
  'Usage:',
  '  sutura init [--workflow <name>] [--repo <owner/repo>] [--action-sha <commit>] [--force] [--no-tavily]',
  '  sutura doctor [--repo <owner/repo>] [--action-sha <commit>]',
  '  sutura heal --case-dir <dir> --format json [--candidate-diff <diff>] [--alternatives-file <file>] [--routing-profile <id>] [--runtime <auto|node|python>] [--no-tavily]',
  '  sutura verify --case-dir <dir> --source-sha <commit> --policy-base-sha <commit> --candidate-diff <file> --failing-command <id> [--runtime <auto|node|python>] --format json',
  '  sutura audit --case-dir <dir> --candidate-diff <file> --before-log <file> --after-log <file> --format json',
  '  sutura replay --bundle <file> --format json [--runtime <auto|node|python>]',
  '  sutura eval validate --manifest <file>',
  '  sutura eval export --manifest <file> --format <atif|jsonl> --output <file> [--force]',
  '  sutura --help',
  '  sutura --version',
].join('\n');

export interface HealArguments {
  command: 'heal';
  caseDir: string;
  format: 'json';
  candidateDiff?: string;
  /**
   * Path to a JSON file holding `{ "alternatives": [...] }`. A path, never
   * inline JSON, because a three-entry alternative set exceeds a comfortable
   * argv value. The file is read and validated in `heal.ts`.
   */
  alternativesFile?: string;
  routingProfile?: string;
  runtime?: 'node' | 'python';
  /**
   * The failing command to reproduce, exactly as CI ran it. Without it the
   * core uses its per-runtime default (`pnpm test`, or `python -m unittest`).
   */
  failingCommand?: string;
  tavilyEnabled: boolean;
}

export interface InitArguments {
  command: 'init';
  workflow?: string;
  repository?: string;
  actionSha?: string;
  force: boolean;
  tavilyEnabled: boolean;
}

/**
 * Execution-backed verification of a patch this tool did not write. Every
 * identity is exact and required: a branch name or short sha cannot stand in
 * for the commit that failed, and the trusted policy commit is chosen by the
 * operator rather than by the patch. The candidate is always a file path, never
 * inline bytes, so a large diff never has to survive argv.
 */
export interface VerifyArguments {
  command: 'verify';
  caseDir: string;
  sourceSha: string;
  policyBaseSha: string;
  candidateDiff: string;
  failingCommand: string;
  runtime?: 'node' | 'python';
  format: 'json';
}

export interface AuditArguments {
  command: 'audit';
  caseDir: string;
  candidateDiff: string;
  beforeLog: string;
  afterLog: string;
  format: 'json';
}

export interface ReplayArguments {
  command: 'replay';
  bundle: string;
  format: 'json';
  runtime?: 'node' | 'python';
}

export interface DoctorArguments {
  command: 'doctor';
  repository?: string;
  actionSha?: string;
}

export interface HelpArguments {
  command: 'help';
}

export interface VersionArguments {
  command: 'version';
}

export interface EvalValidateArguments {
  command: 'eval-validate';
  manifest: string;
}

export interface EvalExportArguments {
  command: 'eval-export';
  manifest: string;
  format: 'atif' | 'jsonl';
  output: string;
  force: boolean;
}

export type CliArguments =
  | HealArguments
  | VerifyArguments
  | AuditArguments
  | ReplayArguments
  | InitArguments
  | DoctorArguments
  | EvalValidateArguments
  | EvalExportArguments
  | HelpArguments
  | VersionArguments;

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

function nonEmptyValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliUsageError(`${flag} requires a value`);
  }
  return value;
}

function validateRepository(repository: string): string {
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new CliUsageError('--repo must use owner/repo format');
  }
  return repository;
}

function validateActionSha(value: string): string {
  if (!SHA_PATTERN.test(value)) {
    throw new CliUsageError('--action-sha must be an exact 40-character commit');
  }
  return value.toLowerCase();
}

const MAX_FAILING_COMMAND_BYTES = 256;

function validateFailingCommand(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    Buffer.byteLength(trimmed, 'utf8') > MAX_FAILING_COMMAND_BYTES ||
    !/^[\x20-\x7e]+$/u.test(trimmed)
  ) {
    throw new CliUsageError(
      `--failing-command must be printable ASCII on one line, at most ${MAX_FAILING_COMMAND_BYTES} bytes`,
    );
  }
  return trimmed;
}

function parseHeal(args: readonly string[]): HealArguments {
  let caseDir: string | undefined;
  let format: string | undefined;
  let candidateDiff: string | undefined;
  let alternativesFile: string | undefined;
  let failingCommand: string | undefined;
  let routingProfile: string | undefined;
  let runtime: 'node' | 'python' | undefined;
  let tavilyEnabled = true;
  const seen = new Set<string>();

  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag || !['--case-dir', '--format', '--candidate-diff', '--alternatives-file', '--failing-command', '--routing-profile', '--runtime', '--no-tavily'].includes(flag)) {
      throw new CliUsageError(`Unknown argument: ${flag ?? '(missing)'}`);
    }
    if (seen.has(flag)) throw new CliUsageError(`Duplicate argument: ${flag}`);
    seen.add(flag);
    if (flag === '--no-tavily') {
      tavilyEnabled = false;
      continue;
    }
    const value = nonEmptyValue(args, index, flag);
    index += 1;
    if (flag === '--case-dir') caseDir = value;
    else if (flag === '--format') format = value;
    else if (flag === '--candidate-diff') candidateDiff = value;
    else if (flag === '--alternatives-file') alternativesFile = value;
    else if (flag === '--failing-command') failingCommand = validateFailingCommand(value);
    else if (flag === '--routing-profile') routingProfile = value;
    else if (value === 'auto') runtime = undefined;
    else if (value === 'node' || value === 'python') runtime = value;
    else throw new CliUsageError('--runtime must be auto, node, or python');
  }

  if (!caseDir) throw new CliUsageError('--case-dir is required');
  if (format !== 'json') throw new CliUsageError('--format must be json');
  if (
    candidateDiff !== undefined &&
    Buffer.byteLength(candidateDiff, 'utf8') > MAX_CANDIDATE_DIFF_BYTES
  ) {
    throw new CliUsageError(`--candidate-diff exceeds ${MAX_CANDIDATE_DIFF_BYTES} bytes`);
  }
  return {
    command: 'heal',
    caseDir,
    format: 'json',
    ...(candidateDiff === undefined ? {} : { candidateDiff }),
    ...(alternativesFile === undefined ? {} : { alternativesFile }),
    ...(failingCommand === undefined ? {} : { failingCommand }),
    ...(routingProfile === undefined ? {} : { routingProfile }),
    ...(runtime === undefined ? {} : { runtime }),
    tavilyEnabled,
  };
}

function parseInit(args: readonly string[]): InitArguments {
  let workflow: string | undefined;
  let repository: string | undefined;
  let actionSha: string | undefined;
  let force = false;
  let tavilyEnabled = true;
  const seen = new Set<string>();
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag || !['--workflow', '--repo', '--action-sha', '--force', '--no-tavily'].includes(flag)) {
      throw new CliUsageError(`Unknown argument: ${flag ?? '(missing)'}`);
    }
    if (seen.has(flag)) throw new CliUsageError(`Duplicate argument: ${flag}`);
    seen.add(flag);
    if (flag === '--force') {
      force = true;
      continue;
    }
    if (flag === '--no-tavily') {
      tavilyEnabled = false;
      continue;
    }
    const value = nonEmptyValue(args, index, flag);
    index += 1;
    if (flag === '--workflow') {
      if (value.length > 100 || /[\r\n]/u.test(value)) {
        throw new CliUsageError('--workflow must be one line with at most 100 characters');
      }
      workflow = value;
    } else if (flag === '--repo') {
      repository = validateRepository(value);
    } else {
      actionSha = validateActionSha(value);
    }
  }
  return {
    command: 'init',
    ...(workflow ? { workflow } : {}),
    ...(repository ? { repository } : {}),
    ...(actionSha ? { actionSha } : {}),
    force,
    tavilyEnabled,
  };
}

function parseVerify(args: readonly string[]): VerifyArguments {
  const values = new Map<string, string>();
  const required = ['--case-dir', '--source-sha', '--policy-base-sha', '--candidate-diff', '--failing-command', '--format'];
  const allowed = new Set([...required, '--runtime']);
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    if (!flag || !allowed.has(flag)) throw new CliUsageError(`Unknown argument: ${flag ?? '(missing)'}`);
    if (values.has(flag)) throw new CliUsageError(`Duplicate argument: ${flag}`);
    values.set(flag, nonEmptyValue(args, index, flag));
  }
  for (const flag of required) {
    if (!values.has(flag)) throw new CliUsageError(`${flag} is required`);
  }
  if (values.get('--format') !== 'json') throw new CliUsageError('--format must be json');
  for (const flag of ['--source-sha', '--policy-base-sha']) {
    const value = values.get(flag) as string;
    if (!/^[a-f0-9]{40}$/u.test(value)) {
      throw new CliUsageError(`${flag} must be an exact lowercase 40-character commit`);
    }
  }
  const runtimeValue = values.get('--runtime');
  if (runtimeValue !== undefined && !['auto', 'node', 'python'].includes(runtimeValue)) {
    throw new CliUsageError('--runtime must be auto, node, or python');
  }
  const runtime = runtimeValue === undefined || runtimeValue === 'auto'
    ? undefined
    : runtimeValue as 'node' | 'python';
  return {
    command: 'verify',
    caseDir: values.get('--case-dir') as string,
    sourceSha: values.get('--source-sha') as string,
    policyBaseSha: values.get('--policy-base-sha') as string,
    candidateDiff: values.get('--candidate-diff') as string,
    failingCommand: values.get('--failing-command') as string,
    ...(runtime === undefined ? {} : { runtime }),
    format: 'json',
  };
}

function parseAudit(args: readonly string[]): AuditArguments {
  const values = new Map<string, string>();
  const allowed = new Set(['--case-dir', '--candidate-diff', '--before-log', '--after-log', '--format']);
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    if (!flag || !allowed.has(flag)) throw new CliUsageError(`Unknown argument: ${flag ?? '(missing)'}`);
    if (values.has(flag)) throw new CliUsageError(`Duplicate argument: ${flag}`);
    values.set(flag, nonEmptyValue(args, index, flag));
  }
  for (const flag of allowed) {
    if (!values.has(flag)) throw new CliUsageError(`${flag} is required`);
  }
  if (values.get('--format') !== 'json') throw new CliUsageError('--format must be json');
  return {
    command: 'audit',
    caseDir: values.get('--case-dir') as string,
    candidateDiff: values.get('--candidate-diff') as string,
    beforeLog: values.get('--before-log') as string,
    afterLog: values.get('--after-log') as string,
    format: 'json',
  };
}

function parseReplay(args: readonly string[]): ReplayArguments {
  let bundle: string | undefined;
  let format: string | undefined;
  let runtime: 'node' | 'python' | undefined;
  const allowed = new Set(['--bundle', '--format', '--runtime']);
  const seen = new Set<string>();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    if (!flag || !allowed.has(flag)) {
      throw new CliUsageError(`Unknown argument: ${flag ?? '(missing)'}`);
    }
    if (seen.has(flag)) throw new CliUsageError(`Duplicate argument: ${flag}`);
    seen.add(flag);
    const value = nonEmptyValue(args, index, flag);
    if (flag === '--bundle') bundle = value;
    else if (flag === '--format') format = value;
    else if (value === 'auto') runtime = undefined;
    else if (value === 'node' || value === 'python') runtime = value;
    else throw new CliUsageError('--runtime must be auto, node, or python');
  }
  if (!bundle) throw new CliUsageError('--bundle is required');
  if (format !== 'json') throw new CliUsageError('--format must be json');
  return {
    command: 'replay',
    bundle,
    format: 'json',
    ...(runtime === undefined ? {} : { runtime }),
  };
}

function parseDoctor(args: readonly string[]): DoctorArguments {
  let repository: string | undefined;
  let actionSha: string | undefined;
  const seen = new Set<string>();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    if (flag !== '--repo' && flag !== '--action-sha') {
      throw new CliUsageError(`Unknown argument: ${flag ?? '(missing)'}`);
    }
    if (seen.has(flag)) throw new CliUsageError(`Duplicate argument: ${flag}`);
    seen.add(flag);
    const value = nonEmptyValue(args, index, flag);
    if (flag === '--repo') repository = validateRepository(value);
    else actionSha = validateActionSha(value);
  }
  return {
    command: 'doctor',
    ...(repository ? { repository } : {}),
    ...(actionSha ? { actionSha } : {}),
  };
}

function parseEval(args: readonly string[]): EvalValidateArguments | EvalExportArguments {
  const operation = args[1];
  if (operation !== 'validate' && operation !== 'export') {
    throw new CliUsageError(`Unknown eval command: ${operation ?? '(missing)'}`);
  }
  let manifest: string | undefined;
  let format: string | undefined;
  let output: string | undefined;
  let force = false;
  const allowed = operation === 'validate'
    ? ['--manifest']
    : ['--manifest', '--format', '--output', '--force'];
  const seen = new Set<string>();
  for (let index = 2; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag || !allowed.includes(flag)) throw new CliUsageError(`Unknown argument: ${flag ?? '(missing)'}`);
    if (seen.has(flag)) throw new CliUsageError(`Duplicate argument: ${flag}`);
    seen.add(flag);
    if (flag === '--force') {
      force = true;
      continue;
    }
    const value = nonEmptyValue(args, index, flag);
    index += 1;
    if (flag === '--manifest') manifest = value;
    else if (flag === '--format') format = value;
    else output = value;
  }
  if (!manifest) throw new CliUsageError('--manifest is required');
  if (operation === 'validate') return { command: 'eval-validate', manifest };
  if (format !== 'atif' && format !== 'jsonl') {
    throw new CliUsageError('--format must be atif or jsonl');
  }
  if (!output) throw new CliUsageError('--output is required');
  return { command: 'eval-export', manifest, format, output, force };
}

export function parseArgs(args: readonly string[]): CliArguments {
  if (args.length === 1 && (args[0] === '--help' || args[0] === 'help')) return { command: 'help' };
  if (args.length === 1 && (args[0] === '--version' || args[0] === 'version')) return { command: 'version' };
  if (args[0] === 'heal') return parseHeal(args);
  if (args[0] === 'verify') return parseVerify(args);
  if (args[0] === 'audit') return parseAudit(args);
  if (args[0] === 'replay') return parseReplay(args);
  if (args[0] === 'init') return parseInit(args);
  if (args[0] === 'doctor') return parseDoctor(args);
  if (args[0] === 'eval') return parseEval(args);
  throw new CliUsageError(`Unknown command: ${args[0] ?? '(missing)'}`);
}
