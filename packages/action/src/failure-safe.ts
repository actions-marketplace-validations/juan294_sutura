import type { ReplayRecorder } from '@sutura/core';

import {
  createTerminalFailureEvidence,
  type TerminalFailureContext,
} from './terminal-failure.js';

export interface FailureSafeCheckPort {
  completeUnexpectedFailure(reason: string): Promise<void>;
  uploadReplayBundle?(name: string, json: string): Promise<{ url: string }>;
}

export async function withFailureSafeCheck<T>(
  githubPort: FailureSafeCheckPort,
  operation: () => Promise<T>,
  warn: (message: string) => void = () => undefined,
  replay?: ReplayRecorder,
  terminal?: Omit<TerminalFailureContext, 'replay'>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    try {
      await githubPort.completeUnexpectedFailure(
        error instanceof Error ? error.message : 'Sutura stopped unexpectedly',
      );
    } catch {
      warn('Sutura could not complete its GitHub check after an unexpected failure.');
    }
    const bundle = replay?.finish('infra-stop');
    if (terminal && githubPort.uploadReplayBundle) {
      try {
        await githubPort.uploadReplayBundle(
          `sutura-terminal-failure-${terminal.targetRunId}.json`,
          JSON.stringify(createTerminalFailureEvidence(error, {
            ...terminal,
            ...(bundle === undefined ? {} : { replay: bundle }),
          })),
        );
      } catch {
        warn('Sutura could not upload terminal failure evidence after an unexpected failure.');
      }
    }
    if (bundle && githubPort.uploadReplayBundle) {
      try {
        await githubPort.uploadReplayBundle(
          `sutura-replay-${bundle.runId}.json`,
          JSON.stringify(bundle),
        );
      } catch {
        warn('Sutura could not upload the replay bundle after an unexpected failure.');
      }
    }
    throw error;
  }
}
