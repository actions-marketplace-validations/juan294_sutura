import type { CaseLabCase, CaseLabOutcome } from './cases.js';
import type { CaseLabMode } from './labels.js';
import type { CaseLabResult } from './result.js';
import { escapeHtml } from './html.js';

/**
 * How a result should read at a glance. Only `accepted` may use approving
 * language or colour; a stopped or inconclusive run must never borrow it.
 */
export type VerdictTone = 'accepted' | 'refused' | 'inconclusive' | 'stopped';

export interface CaseVerdict {
  tone: VerdictTone;
  headline: string;
  /** One sentence a reader who knows nothing about the internals can act on. */
  reason: string;
  nextAction: string;
  /** Evidence mode, exact subject and timestamp. */
  evidenceLine: string;
}

/**
 * Claims this product must never make about a patch. Passing the checks that
 * ran is a statement about those checks, not about the code in general.
 */
export const FORBIDDEN_VERDICT_CLAIMS = Object.freeze([
  'universally safe',
  'proven correct',
  'production-certified',
  'guaranteed',
  'bug-free',
  'fully verified',
]);

const TONES: Readonly<Record<CaseLabOutcome, VerdictTone>> = {
  fixed: 'accepted',
  refused: 'refused',
  'flaky-no-patch': 'inconclusive',
  'gave-up': 'inconclusive',
  'infra-stop': 'stopped',
};

const HEADLINES: Readonly<Record<CaseLabOutcome, string>> = {
  fixed: 'Passed the required checks',
  refused: 'Rejected',
  'flaky-no-patch': 'No patch: the failure was not consistent',
  'gave-up': 'No patch: the evidence did not support one',
  'infra-stop': 'Stopped before a verdict',
};

const REASONS: Readonly<Record<CaseLabOutcome, string>> = {
  fixed: 'The repair reproduced the failure, fixed it, and held the behavior the checks require.',
  refused: 'This patch made the original test pass without keeping the behavior the checks require.',
  'flaky-no-patch': 'The failure did not reproduce consistently, so any patch would be guesswork.',
  'gave-up': 'The available checks could not decide whether a patch preserved the required behavior.',
  'infra-stop': 'The run stopped on an infrastructure or provider failure, so nothing was decided.',
};

const NEXT_ACTIONS: Readonly<Record<CaseLabOutcome, string>> = {
  fixed: 'Review the diff and the behavior tested before merging.',
  refused: 'Read the failing check below; the patch needs the behavior restored, not the test changed.',
  'flaky-no-patch': 'Stabilize the test before asking for a repair.',
  'gave-up': 'Add or declare a contract that states the required behavior, then run again.',
  'infra-stop': 'Retry once the infrastructure is available; no conclusion should be drawn from this run.',
};

const MODE_PHRASES: Readonly<Record<CaseLabMode, string>> = {
  live: 'Executed live',
  replay: 'Replayed from a recorded run',
  recorded: 'Historical recorded result',
};

/**
 * Builds the verdict-first summary shown above every execution detail.
 *
 * A reader should be able to act on the headline, the reason and the next
 * action without reading anything below them. The mode is stated plainly so a
 * historical record is never mistaken for a run that happened just now, and a
 * result whose outcome missed its expectation says so rather than presenting
 * the outcome alone.
 */
export function caseVerdict(result: CaseLabResult, item: CaseLabCase): CaseVerdict {
  const tone = TONES[result.outcome];
  const subject = result.recordedFrom?.subjectSha ?? result.identity.controllerSha;
  const timestamp = result.recordedFrom?.recordedAt ?? result.createdAt;
  const reason = result.matchesExpectation
    ? REASONS[result.outcome]
    : `${REASONS[result.outcome]} This did not match what the case expected, and the mismatch is kept in the record.`;
  return {
    tone,
    headline: HEADLINES[result.outcome],
    reason,
    nextAction: NEXT_ACTIONS[result.outcome],
    evidenceLine: `${MODE_PHRASES[result.mode]} · ${item.scenario} · subject ${subject} · ${timestamp}`,
  };
}

/**
 * Renders the verdict region. The tone becomes a class rather than inline
 * colour so a stopped or inconclusive result cannot be styled as an acceptance
 * by a later change to one template.
 */
export function renderVerdict(result: CaseLabResult, item: CaseLabCase): string {
  const verdict = caseVerdict(result, item);
  return `<section class="verdict verdict-${verdict.tone}" aria-label="Verdict">
  <h2 class="verdict-headline">${escapeHtml(verdict.headline)}</h2>
  <p class="verdict-reason">${escapeHtml(verdict.reason)}</p>
  <p class="verdict-evidence">${escapeHtml(verdict.evidenceLine)}</p>
  <p class="verdict-next">${escapeHtml(verdict.nextAction)}</p>
</section>`;
}
