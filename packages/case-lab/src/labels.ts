/**
 * Pure constants shared by the Node validator and the browser renderer. This
 * module must stay free of Node imports.
 */
import type { CaseLabOutcome } from './cases.js';

export type CaseLabMode = 'live' | 'replay' | 'recorded';

export interface ModeDescription {
  readonly label: string;
  readonly note: string;
}

export const MODES: Readonly<Record<CaseLabMode, ModeDescription>> = Object.freeze({
  live: Object.freeze({
    label: 'Live run',
    note: 'This result was produced by a live run through the public Case Lab path.',
  }),
  replay: Object.freeze({
    label: 'Deterministic replay',
    note: 'This result was reproduced offline from a complete replay bundle captured on a live run, with no provider or sandbox access.',
  }),
  recorded: Object.freeze({
    label: 'Recorded live result',
    note: 'This result is a recorded live benchmark evaluation of the released Sutura version, not a run started from this page.',
  }),
});

export const MODE_LABELS: Readonly<Record<CaseLabMode, string>> = Object.freeze({
  live: MODES.live.label,
  replay: MODES.replay.label,
  recorded: MODES.recorded.label,
});

export const OUTCOME_LABELS: Readonly<Record<CaseLabOutcome, string>> = Object.freeze({
  fixed: 'Fixed',
  'flaky-no-patch': 'Flaky, no patch',
  refused: 'Refused',
  'gave-up': 'Gave up',
  'infra-stop': 'Infrastructure stop',
});

export function modeLabel(mode: CaseLabMode): string {
  return MODES[mode].label;
}

export function isCaseLabMode(value: unknown): value is CaseLabMode {
  return value === 'live' || value === 'replay' || value === 'recorded';
}

export const LIVE_REQUEST_ID_PATTERN = /^cl-[0-9]{13}-[a-f0-9]{8}$/u;

/** The one rule for a URL that may become an href or a citation: https, no userinfo, no fragment. */
export function isPublicHttpsUrl(value: string): boolean {
  if (value.length === 0 || value.length > 2_048 || /[\s"'<>]/u.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.username === '' && url.password === '' && url.hash === '';
}
