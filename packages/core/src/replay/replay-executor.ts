import type {
  CancellationResult,
  Executor,
  ImageId,
  OperationCapacity,
  RunOptions,
  RunResult,
  SnapshotOptions,
} from '../executor/types.js';
import type { RecordedExecutorCall } from './bundle.js';
import {
  describeMethodCall,
  RecordedCallCursor,
  type RecordedCallCursorOptions,
  type RecordedCallDescription,
} from './recorded-call-cursor.js';
import { throwRecordedErrorResult } from './recorded-error.js';

/**
 * The adaptive search expands branches concurrently and each branch issues its
 * sandbox calls after its own provider turn, so a live recording orders
 * executor calls by provider latency. Every such call carries a distinct
 * operation id, so an exact match among unconsumed records identifies it
 * regardless of order. Capacity probes and cancellation requests are
 * observational: their number depends on scheduling, never on the repair.
 */
export const EXECUTOR_CURSOR_OPTIONS: RecordedCallCursorOptions = Object.freeze({
  unordered: true,
  optional: ({ method }: RecordedCallDescription) => method === 'operationCapacity' || method === 'cancel',
});

export class RecordedExecutor implements Executor {
  private readonly cursor: RecordedCallCursor<RecordedExecutorCall>;
  private lastCapacity: OperationCapacity | undefined;

  constructor(
    calls: readonly RecordedExecutorCall[],
    private readonly normalizeArgs: (args: unknown[]) => unknown[] = (args) => args,
    cursor?: RecordedCallCursor<RecordedExecutorCall>,
  ) {
    this.cursor = cursor ?? new RecordedCallCursor(calls, describeMethodCall, 'executor', EXECUTOR_CURSOR_OPTIONS);
  }

  private next<T>(method: keyof Executor, args: unknown[]): T {
    const call = this.cursor.next(method, args, this.normalizeArgs);
    throwRecordedErrorResult(call.result);
    return call.result as T;
  }

  private tryNext<T>(method: keyof Executor, args: unknown[]): T | undefined {
    const call = this.cursor.tryNext(method, args, this.normalizeArgs);
    if (call === undefined) return undefined;
    throwRecordedErrorResult(call.result);
    return call.result as T;
  }

  importImage(ref: string): Promise<ImageId> {
    return Promise.resolve(this.next<ImageId>('importImage', [ref]));
  }

  snapshot(dir: string, base: ImageId, options: SnapshotOptions): Promise<ImageId> {
    return Promise.resolve(this.next<ImageId>('snapshot', [dir, base, options]));
  }

  run(parent: ImageId, cmd: string, options?: RunOptions): Promise<RunResult> {
    return Promise.resolve(this.next<RunResult>('run', [parent, cmd, options ?? null]));
  }

  runMany(parent: ImageId, commands: string[], options?: RunOptions): Promise<RunResult[]> {
    return Promise.resolve(this.next<RunResult[]>('runMany', [parent, commands, options ?? null]));
  }

  operationCapacity(): OperationCapacity {
    // The number of probes depends on batch shape; a probe beyond the recording repeats the last answer.
    const recorded = this.tryNext<OperationCapacity>('operationCapacity', []);
    if (recorded !== undefined) this.lastCapacity = recorded;
    return this.lastCapacity ?? this.next<OperationCapacity>('operationCapacity', []);
  }

  cancel(operationId: string): Promise<CancellationResult> {
    // A cancellation the live run never issued reports that nothing was requested.
    return Promise.resolve(
      this.tryNext<CancellationResult>('cancel', [operationId]) ?? { operationId, requested: false },
    );
  }
}
