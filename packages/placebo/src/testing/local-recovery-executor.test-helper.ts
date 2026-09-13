import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NODE_RUNTIME, PYTHON_RUNTIME, type Executor, type ImageId, type RunOptions, type RunResult, type RuntimeAdapter } from '@sutura/core';
import { fixtureTestCommand, prepareFixture, type PortableTestRuntime } from '../corpus.js';
import type { CorpusCase } from '../types.js';

const quote = (text: string) => `'${text.replaceAll("'", `'"'"'`)}'`;
export async function prepareRecoveryFixture(fixture: CorpusCase, runtime: PortableTestRuntime) {
  const root = await mkdtemp(join(tmpdir(), 'placebo-recovery-'));
  const directory = join(root, 'fixture');
  try {
    await cp(fixture.fixtureDirectory, directory, { recursive: true });
    await prepareFixture(directory, undefined, runtime);
    return { root, directory, command: fixtureTestCommand(fixture.metadata.language), cleanup: () => rm(root, { recursive: true, force: true }) };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}

export async function recoveryRepairDiff(fixture: CorpusCase): Promise<string> {
  if (fixture.id === 'repair-tsconfig-drift-indexed-access') return [
    'diff --git a/first.ts b/first.ts', '--- a/first.ts', '+++ b/first.ts', '@@ -1 +1 @@',
    '-export function first(values: string[]): string { return values[0]; }',
    '+export function first(values: string[]): string | undefined { return values[0]; }', '',
  ].join('\n');
  const declared = await readFile(join(fixture.directory, 'repair.diff'), 'utf8').catch(() => undefined);
  if (declared !== undefined) return declared;
  // Existing await/strict fixtures have symmetric hunks; preserve their bytes by deriving the inverse externally.
  const original = await readFile(fixture.breakPatch, 'utf8');
  return original.split('\n').map((line) => {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) return line;
    if (line.startsWith('-')) return '+' + line.slice(1);
    if (line.startsWith('+')) return '-' + line.slice(1);
    if (line.startsWith('@@ ')) return line.replace(/^@@ -(\d+(?:,\d+)?) \+(\d+(?:,\d+)?) @@/u, '@@ -$2 +$1 @@');
    return line;
  }).join('\n');
}

/** Test-only filesystem executor for committed, controlled fixtures. It is not an OS security sandbox. */
export class LocalBranchExecutor implements Executor {
  readonly calls: Array<{ parent: ImageId; cmd: string; imageId: ImageId; exitCode: number }> = [];
  private readonly images = new Map<ImageId, string>();
  private readonly active = new Map<string, ChildProcess>();
  private readonly cancelled = new Set<string>();
  private nextId = 0;
  constructor(private readonly root: string, private readonly runtime: PortableTestRuntime) {}
  directory(image: ImageId): string {
    const path = this.images.get(image);
    if (!path) throw new Error(`Unknown local image: ${image}`);
    return path;
  }
  async seed(directory: string): Promise<ImageId> {
    const image = await this.copy(directory);
    const initialized = await this.process(this.directory(image), 'git init --quiet && git config core.hooksPath /dev/null && git config user.email test@example.invalid && git config user.name LocalFixture && git add --all -- . ":!node_modules" && git -c core.hooksPath=/dev/null commit --quiet -m baseline');
    if (initialized.exitCode !== 0) throw new Error(initialized.stderr);
    return image;
  }
  private async copy(parent: string): Promise<ImageId> {
    const image = `local-${++this.nextId}`;
    const destination = join(this.root, 'images', image);
    await mkdir(join(this.root, 'images'), { recursive: true });
    await cp(parent, destination, { recursive: true, filter: (path) => path !== join(parent, 'node_modules') });
    await symlink(this.runtime.nodeModules, join(destination, 'node_modules'), 'dir');
    this.images.set(image, destination);
    return image;
  }
  private async command(command: string, directory: string): Promise<string> {
    // Fixed runtime translations execute the exact fixture checks without provider/Corepack setup.
    const vitest = `${quote(process.execPath)} ${quote(join(this.runtime.nodeModules, 'vitest/vitest.mjs'))} run --maxWorkers=1`;
    const tsc = `${quote(process.execPath)} ${quote(join(this.runtime.nodeModules, 'typescript/bin/tsc'))} --noEmit`;
    const normalized = new Map<string, string>([
      ['vitest run', vitest], ['tsc --noEmit', tsc], ['tsc --noEmit && vitest run', `${tsc} && ${vitest}`],
    ]);
    for (const [trusted, local] of [...normalized]) normalized.set(NODE_RUNTIME.normalizeCommand(trusted), local);
    if (command === 'pnpm test' || command === NODE_RUNTIME.normalizeCommand('pnpm test')) {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as { scripts: { test: string } };
      const executable = normalized.get(manifest.scripts.test);
      if (!executable) throw new Error('Unregistered fixture test command');
      return executable;
    }
    const python = fixtureTestCommand('python');
    normalized.set(python, python);
    normalized.set(PYTHON_RUNTIME.normalizeCommand(python), python);
    const manifest = await readFile(join(directory, 'package.json'), 'utf8').then((text) => JSON.parse(text) as { scripts: { test: string } }).catch(() => undefined);
    const packageTest = manifest ? normalized.get(manifest.scripts.test) : undefined;
    if (packageTest) {
      normalized.set('pnpm test', packageTest);
      normalized.set(NODE_RUNTIME.normalizeCommand('pnpm test'), packageTest);
    }
    const direct = normalized.get(command);
    if (direct) return direct;
    if (command.startsWith('node -e ') || command.startsWith('python -I -c ')) {
      for (const [trusted, local] of normalized) {
        const suffix = ' && ' + trusted;
        if (command.endsWith(suffix)) {
          const prefix = command.slice(0, -suffix.length).replace(/^python -I -c /u, 'python3 -I -c ');
          return prefix + ' && ' + local;
        }
      }
      throw new Error('Unregistered recovery proof command suffix');
    }
    return command;
  }
  runtimeAdapter(runtime: 'node' | 'python'): RuntimeAdapter {
    return runtime === 'node' ? NODE_RUNTIME : PYTHON_RUNTIME;
  }
  async apply(parent: ImageId, diff: string): Promise<RunResult> {
    return this.run(parent, `printf '%s' ${quote(Buffer.from(diff).toString('base64'))} | base64 --decode | git apply - && git diff --no-ext-diff --no-renames --binary HEAD --`);
  }
  async run(parent: ImageId, command: string, options: RunOptions = {}): Promise<RunResult> {
    if (options.cwd !== undefined && options.cwd !== '/workspace') throw new Error('Local fixture commands require /workspace');
    if (options.network === 'enabled') throw new Error('Local recovery tests never enable provider networking');
    const imageId = await this.copy(this.directory(parent));
    const result = await this.process(this.directory(imageId), await this.command(command, this.directory(imageId)), options);
    this.calls.push({ parent, cmd: command, imageId, exitCode: result.exitCode });
    return { imageId, ...result };
  }
  async runMany(parent: ImageId, commands: string[], options?: RunOptions): Promise<RunResult[]> {
    return Promise.all(commands.map((command) => this.run(parent, command, options)));
  }
  operationCapacity() { return { limit: 1, active: this.active.size, available: Math.max(0, 1 - this.active.size) }; }
  async cancel(operationId: string) {
    const child = this.active.get(operationId);
    if (!child) return { operationId, requested: false };
    this.cancelled.add(operationId);
    child.kill('SIGTERM');
    return { operationId, requested: true };
  }
  async importImage(): Promise<ImageId> { throw new Error('Local recovery tests seed a prepared fixture'); }
  async snapshot(): Promise<ImageId> { throw new Error('Local recovery tests seed a prepared fixture'); }
  private process(cwd: string, command: string, options: RunOptions = {}): Promise<Omit<RunResult, 'imageId'>> {
    return new Promise((resolve, reject) => {
      const started = performance.now();
      let stdout = ''; let stderr = ''; let truncated = false;
      const child = spawn('/bin/sh', ['-c', command], { cwd, env: { PATH: process.env.PATH, CI: '1', PYTHONDONTWRITEBYTECODE: '1', ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] });
      if (options.operationId) this.active.set(options.operationId, child);
      const collect = (stream: 'stdout' | 'stderr', bytes: Buffer) => {
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + bytes.length > 65536) { truncated = true; child.kill('SIGKILL'); return; }
        if (stream === 'stdout') stdout += bytes.toString('utf8'); else stderr += bytes.toString('utf8');
      };
      child.stdout.on('data', (bytes: Buffer) => collect('stdout', bytes));
      child.stderr.on('data', (bytes: Buffer) => collect('stderr', bytes));
      const timer = setTimeout(() => child.kill('SIGKILL'), Math.min(options.timeoutSec ?? 30, 30) * 1000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (options.operationId) this.active.delete(options.operationId);
        const exitCode = code ?? 1;
        resolve({ exitCode, stdout, stderr, truncated, metrics: { elapsedTimeSec: (performance.now() - started) / 1000 }, ...(options.operationId === undefined ? {} : { operation: { operationId: options.operationId, terminal: this.cancelled.has(options.operationId) ? 'cancelled' : exitCode === 0 ? 'succeeded' : 'failed', cancellationRequested: this.cancelled.has(options.operationId) } }) });
      });
    });
  }
}
