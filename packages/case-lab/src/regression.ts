import { escapeHtml } from './html.js';

const SHA256 = /^[a-f0-9]{64}$/u;
const SHA1 = /^[a-f0-9]{40}$/u;

export class RegressionComparisonError extends Error {
  constructor(readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'RegressionComparisonError';
  }
}

function refuse(reasonCode: string, message: string): never {
  throw new RegressionComparisonError(reasonCode, message);
}

export interface ComparisonBaseline {
  sourceSha: string;
  snapshotSha256: string;
}

export interface ComparisonArm {
  /** A short label a reader sees, such as "correct repair". */
  label: string;
  diffSha256: string;
  /** Whether the original failing test passed after this patch. */
  visibleTestPassed: boolean;
}

export interface IndependentCheck {
  id: string;
  description: string;
  /** The controller-derived expectation, in the order the arms are listed. */
  expected: string;
  observed: [string, string];
}

export interface TwoPatchComparison {
  baseline: ComparisonBaseline;
  visibleTestCommand: string;
  arms: [ComparisonArm, ComparisonArm];
  checks: IndependentCheck[];
  /** Checks whose observations differ between the two arms. */
  discriminating: string[];
}

/**
 * Binds one baseline, two exact patches, the old visible test and the new
 * independent checks into a single comparison.
 *
 * The comparison only means something when both patches passed the original
 * test and at least one independent check separates them. Without both, the
 * page would show two patches side by side and imply a distinction the
 * evidence does not support, so this refuses instead.
 */
export function buildTwoPatchComparison(input: {
  baseline: ComparisonBaseline;
  visibleTestCommand: string;
  arms: readonly ComparisonArm[];
  checks: readonly IndependentCheck[];
}): TwoPatchComparison {
  if (!SHA1.test(input.baseline.sourceSha) || !SHA256.test(input.baseline.snapshotSha256)) {
    refuse('invalid-baseline', 'The comparison needs an exact source commit and snapshot hash');
  }
  if (input.arms.length !== 2) {
    refuse('arm-count', `A two-patch comparison takes exactly two patches, not ${input.arms.length}`);
  }
  const [first, second] = input.arms as [ComparisonArm, ComparisonArm];
  for (const arm of [first, second]) {
    if (!SHA256.test(arm.diffSha256)) {
      refuse('invalid-diff-hash', `${arm.label} needs an exact diff hash`);
    }
    if (!arm.label.trim()) refuse('missing-label', 'Each patch needs a label a reader can read');
  }
  if (first.diffSha256 === second.diffSha256) {
    refuse('identical-patches', 'Both arms name the same patch');
  }
  if (!first.visibleTestPassed || !second.visibleTestPassed) {
    refuse(
      'visible-test-not-green',
      'Both patches must pass the original test; otherwise the original test already told them apart',
    );
  }
  if (!input.visibleTestCommand.trim()) {
    refuse('missing-visible-command', 'The comparison must name the original failing test command');
  }

  const seen = new Set<string>();
  for (const check of input.checks) {
    if (!check.id.trim()) refuse('invalid-check', 'Each independent check needs an id');
    if (seen.has(check.id)) refuse('duplicate-check', `Check ${check.id} appears more than once`);
    seen.add(check.id);
  }
  const discriminating = input.checks
    .filter((check) => check.observed[0] !== check.observed[1])
    .map((check) => check.id);
  if (discriminating.length === 0) {
    refuse(
      'no-discriminating-check',
      'No independent check separates the two patches, so the comparison shows nothing',
    );
  }

  return {
    baseline: { ...input.baseline },
    visibleTestCommand: input.visibleTestCommand,
    arms: [{ ...first }, { ...second }],
    checks: input.checks.map((check) => ({ ...check, observed: [...check.observed] })),
    discriminating,
  };
}

/** Renders the comparison, naming both patches by hash so neither can be confused. */
export function renderTwoPatchComparison(comparison: TwoPatchComparison): string {
  const rows = comparison.checks.map((check) => {
    const separates = check.observed[0] !== check.observed[1];
    return `<tr class="${separates ? 'separates' : 'agrees'}">
  <td>${escapeHtml(check.description)}</td>
  <td>${escapeHtml(check.expected)}</td>
  <td>${escapeHtml(check.observed[0])}</td>
  <td>${escapeHtml(check.observed[1])}</td>
</tr>`;
  }).join('\n');
  return `<section class="regression-comparison" aria-label="Two patch comparison">
  <p class="comparison-baseline">Same baseline <code>${escapeHtml(comparison.baseline.sourceSha)}</code> · snapshot <code>${escapeHtml(comparison.baseline.snapshotSha256)}</code></p>
  <p class="comparison-visible">Both patches pass <code>${escapeHtml(comparison.visibleTestCommand)}</code>, the test that was already there.</p>
  <table class="comparison">
    <thead><tr><th>Independent check</th><th>Expected</th><th>${escapeHtml(comparison.arms[0].label)}</th><th>${escapeHtml(comparison.arms[1].label)}</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <p class="comparison-hashes"><code>${escapeHtml(comparison.arms[0].diffSha256)}</code> · <code>${escapeHtml(comparison.arms[1].diffSha256)}</code></p>
</section>`;
}
