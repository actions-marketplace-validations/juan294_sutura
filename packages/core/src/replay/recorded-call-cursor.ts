import { canonicalJson, firstJsonDifference } from './canonical-json.js';
import { ReplayMismatchError } from './replay-error.js';

interface SequencedRecord {
  sequence: number;
}

export interface RecordedCallDescription {
  method: string;
  args: unknown[];
}

export type DescribeRecordedCall<T extends SequencedRecord> =
  (record: T) => RecordedCallDescription;

export const describeMethodCall = <T extends SequencedRecord & RecordedCallDescription>(
  record: T,
): RecordedCallDescription => record;

export interface RecordedCallCursorOptions {
  /**
   * A concurrent phase issues its calls in live latency order, which a replay
   * served from memory cannot reproduce. When set, a call that does not match
   * the record at the cursor may consume a later unconsumed record that
   * matches it exactly; the positional record is still tried first, so a
   * serial regression keeps its precise mismatch.
   */
  readonly unordered?: boolean;
  /**
   * Records whose count depends on scheduling (capacity probes, cancellation
   * requests). They are served when a matching record exists and never block
   * `assertConsumed` when one is left over.
   */
  readonly optional?: (description: RecordedCallDescription) => boolean;
}

export class RecordedCallCursor<T extends SequencedRecord> {
  private readonly records: T[];
  private readonly consumed = new Set<number>();
  private index = 0;
  private mismatch: ReplayMismatchError | undefined;

  constructor(
    records: readonly T[],
    private readonly describe: DescribeRecordedCall<T>,
    private readonly domain: string,
    private readonly options: RecordedCallCursorOptions = {},
  ) {
    this.records = [...records].toSorted((left, right) => left.sequence - right.sequence);
  }

  /** The first record not yet consumed, in recorded order. */
  private position(): number {
    while (this.consumed.has(this.index)) this.index += 1;
    return this.index;
  }

  private matches(at: number, method: string, canonicalArgs: string): boolean {
    const record = this.records[at];
    if (record === undefined || this.consumed.has(at)) return false;
    const expected = this.describe(record);
    return expected.method === method && canonicalJson(expected.args) === canonicalArgs;
  }

  private find(method: string, canonicalArgs: string, from: number): number | undefined {
    for (let at = from; at < this.records.length; at += 1) {
      if (this.matches(at, method, canonicalArgs)) return at;
    }
    return undefined;
  }

  private take(at: number): T {
    this.consumed.add(at);
    return this.records[at]!;
  }

  next(
    method: string,
    args: unknown[],
    normalizeArgs: (args: unknown[]) => unknown[] = (value) => value,
  ): T {
    const at = this.position();
    const record = this.records[at];
    if (!record) {
      const sequence = (this.records.at(-1)?.sequence ?? 0) + 1;
      return this.fail(new ReplayMismatchError(
        sequence,
        '$',
        `recorded ${this.domain} call`,
        'sequence exhausted',
      ));
    }
    const normalized = normalizeArgs(args);
    const canonicalArgs = canonicalJson(normalized);
    if (this.matches(at, method, canonicalArgs)) return this.take(at);
    if (this.options.unordered === true) {
      const found = this.find(method, canonicalArgs, at + 1);
      if (found !== undefined) return this.take(found);
    }
    this.consumed.add(at);
    const expected = this.describe(record);
    if (expected.method !== method) {
      return this.fail(
        new ReplayMismatchError(record.sequence, '$.method', expected.method, method),
      );
    }
    const difference = firstJsonDifference(expected.args, normalized);
    return this.fail(new ReplayMismatchError(
      record.sequence,
      difference?.path ?? '$.args',
      difference?.expected,
      difference?.actual,
    ));
  }

  /**
   * Serve an optional call from any unconsumed matching record, or report that
   * none was recorded. Never records a mismatch: the caller decides what an
   * unrecorded optional call means.
   */
  tryNext(
    method: string,
    args: unknown[],
    normalizeArgs: (args: unknown[]) => unknown[] = (value) => value,
  ): T | undefined {
    const found = this.find(method, canonicalJson(normalizeArgs(args)), this.position());
    return found === undefined ? undefined : this.take(found);
  }

  /** Record a mismatch found after a record was served, so `rethrowMismatch` can surface it. */
  fail(error: ReplayMismatchError): never {
    this.mismatch ??= error;
    throw error;
  }

  rethrowMismatch(): void {
    if (this.mismatch) throw this.mismatch;
  }

  assertConsumed(): void {
    this.rethrowMismatch();
    for (let at = this.position(); at < this.records.length; at += 1) {
      if (this.consumed.has(at)) continue;
      const remaining = this.describe(this.records[at]!);
      if (this.options.optional?.(remaining) === true) continue;
      throw new ReplayMismatchError(
        this.records[at]!.sequence,
        '$',
        `all recorded ${this.domain} calls consumed`,
        `${remaining.method} remains`,
      );
    }
  }
}
