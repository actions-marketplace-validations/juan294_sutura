import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CaseLabPinError, parseDemoWorkflowPins, verifyPin, withControllerSha } from './pin.js';
import { loadRelease } from './replay.js';

const WORKFLOW = readFileSync(resolve(import.meta.dirname, '../demo/case-lab.yml'), 'utf8');
const RELEASE = loadRelease();

describe('demo workflow pins', () => {
  it('reads the Action pin from both places and the controller pin', () => {
    const pins = parseDemoWorkflowPins(WORKFLOW);
    expect(pins.usesSha).toBe(RELEASE.actionSha);
    expect(pins.envActionSha).toBe(RELEASE.actionSha);
    expect(pins.controllerSha).toMatch(/^[a-f0-9]{40}$/u);
  });

  it('refuses a workflow whose pins disagree with release.json', () => {
    const other = 'b'.repeat(40);
    expect(() => verifyPin(WORKFLOW.replace(`packages/action@${RELEASE.actionSha}`, `packages/action@${other}`), RELEASE))
      .toThrow(`.github/workflows/case-lab.yml Action step is pinned to ${other} but release.json names ${RELEASE.actionSha}`);
    expect(() => verifyPin(WORKFLOW.replace(`SUTURA_ACTION_SHA: ${RELEASE.actionSha}`, `SUTURA_ACTION_SHA: ${other}`), RELEASE))
      .toThrow(`SUTURA_ACTION_SHA is ${other} but release.json names ${RELEASE.actionSha}`);
    expect(() => verifyPin(WORKFLOW.replace('SUTURA_ACTION_SHA:', 'SUTURA_ACTION_SHA_X:'), RELEASE))
      .toThrow('must contain exactly one SUTURA_ACTION_SHA value');
    expect(() => verifyPin(`${WORKFLOW}\n        uses: juan294/sutura/packages/action@${RELEASE.actionSha}\n`, RELEASE))
      .toThrow('must contain exactly one juan294/sutura/packages/action@<sha> step');
  });

  it('requires a real controller commit before the pin verifies', () => {
    const pins = parseDemoWorkflowPins(WORKFLOW);
    if (/^0{40}$/u.test(pins.controllerSha)) {
      expect(() => verifyPin(WORKFLOW, RELEASE)).toThrow(CaseLabPinError);
    } else {
      expect(verifyPin(WORKFLOW, RELEASE).controllerSha).toBe(pins.controllerSha);
    }
    const updated = withControllerSha(WORKFLOW, 'c'.repeat(40));
    expect(parseDemoWorkflowPins(updated).controllerSha).toBe('c'.repeat(40));
    expect(parseDemoWorkflowPins(updated).usesSha).toBe(RELEASE.actionSha);
    expect(() => withControllerSha(WORKFLOW, 'short')).toThrow('controller sha must be an exact lowercase 40-character commit');
  });
});
