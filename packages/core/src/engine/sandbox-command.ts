import { NODE_RUNTIME } from '../runtime/node.js';
import type { RuntimeAdapter } from '../runtime/types.js';
import { shellQuote } from './shell.js';

export function sandboxExecutableCommand(
  command: string,
  runtime: RuntimeAdapter = NODE_RUNTIME,
): string {
  return runtime.normalizeCommand(command);
}

export function sandboxTargetCommand(
  command: string,
  runtime: RuntimeAdapter = NODE_RUNTIME,
): string {
  return `sh -lc ${shellQuote(sandboxExecutableCommand(command, runtime))}`;
}
