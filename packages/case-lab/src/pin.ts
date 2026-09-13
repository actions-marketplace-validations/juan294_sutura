import type { ReleaseIdentity } from './dispatcher.js';

export const DEMO_WORKFLOW_FILE = '.github/workflows/case-lab.yml';
const ACTION_USES = /^\s*uses:\s*juan294\/sutura\/packages\/action@([a-f0-9]{40})\s*$/mu;
const ENV_ACTION = /^\s*SUTURA_ACTION_SHA:\s*([a-f0-9]{40})\s*$/mu;
const ENV_CONTROLLER = /^\s*SUTURA_CONTROLLER_SHA:\s*([a-f0-9]{40})\s*$/mu;

export interface DemoWorkflowPins {
  readonly usesSha: string;
  readonly envActionSha: string;
  readonly controllerSha: string;
}

export class CaseLabPinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseLabPinError';
  }
}

function single(text: string, pattern: RegExp, what: string, file: string): string {
  const matches = [...text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) {
    throw new CaseLabPinError(`${file} must contain exactly one ${what}`);
  }
  return matches[0][1];
}

export function parseDemoWorkflowPins(text: string, file = DEMO_WORKFLOW_FILE): DemoWorkflowPins {
  return {
    usesSha: single(text, ACTION_USES, 'juan294/sutura/packages/action@<sha> step', file),
    envActionSha: single(text, ENV_ACTION, 'SUTURA_ACTION_SHA value', file),
    controllerSha: single(text, ENV_CONTROLLER, 'SUTURA_CONTROLLER_SHA value', file),
  };
}

/** The demo workflow must pin the Action to the release in release.json, in both places. */
export function verifyPin(text: string, release: ReleaseIdentity, file = DEMO_WORKFLOW_FILE): DemoWorkflowPins {
  const pins = parseDemoWorkflowPins(text, file);
  if (pins.usesSha !== release.actionSha) {
    throw new CaseLabPinError(`${file} Action step is pinned to ${pins.usesSha} but release.json names ${release.actionSha}`);
  }
  if (pins.envActionSha !== release.actionSha) {
    throw new CaseLabPinError(`${file} SUTURA_ACTION_SHA is ${pins.envActionSha} but release.json names ${release.actionSha}`);
  }
  if (/^0{40}$/u.test(pins.controllerSha)) {
    throw new CaseLabPinError(`${file} SUTURA_CONTROLLER_SHA is not set to a juan294/sutura commit that contains packages/case-lab`);
  }
  return pins;
}

/** Replace the controller pin in the workflow text; the Action pin never changes here. */
export function withControllerSha(text: string, controllerSha: string): string {
  if (!/^[a-f0-9]{40}$/u.test(controllerSha)) throw new CaseLabPinError('controller sha must be an exact lowercase 40-character commit');
  return text.replace(ENV_CONTROLLER, (line) => line.replace(/[a-f0-9]{40}/u, controllerSha));
}
