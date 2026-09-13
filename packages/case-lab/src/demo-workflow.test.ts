import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CASE_LAB_CASE_IDS } from './cases.js';

const WORKFLOW = readFileSync(resolve(import.meta.dirname, '../demo/case-lab.yml'), 'utf8');
const MATERIALIZER = readFileSync(resolve(import.meta.dirname, '../demo/materialize-case-lab-case.mjs'), 'utf8');

function stepBlocks(text: string): Array<{ name: string; body: string }> {
  const parts = text.split(/\n {6}- (?=name:|uses:)/u).slice(1);
  return parts.map((part) => {
    const name = /^name:\s*(.+)$/mu.exec(part)?.[1] ?? part.split('\n')[0] ?? '';
    return { name: name.trim(), body: part };
  });
}

describe('demo case-lab.yml contract', () => {
  const steps = stepBlocks(WORKFLOW);

  it('accepts exactly two inputs: a choice of the five cases and a bounded request id', () => {
    const inputs = /inputs:\n([\s\S]*?)\n\npermissions:/u.exec(WORKFLOW)?.[1] ?? '';
    expect(inputs.match(/^ {6}[a-z-]+:$/gmu)).toEqual(['      case-id:', '      request-id:']);
    const options = [...inputs.matchAll(/^ {10}- ([a-z-]+)$/gmu)].map((match) => match[1]);
    expect(options).toEqual([...CASE_LAB_CASE_IDS]);
    expect(inputs).toContain('type: choice');
    expect(WORKFLOW).toContain('[[ "$REQUEST_ID" =~ ^cl-[0-9]{13}-[a-f0-9]{8}$ ]]');
    expect(WORKFLOW).toContain('javascript-repair|python-repair|flaky-failure|greenwash-trap|upstream-incident) ;;');
  });

  it('grants exactly the four permissions and never id-token', () => {
    const permissions = /permissions:\n([\s\S]*?)\n\n/u.exec(WORKFLOW)?.[1] ?? '';
    expect(permissions.split('\n').map((line) => line.trim()).sort()).toEqual([
      'actions: write', 'checks: write', 'contents: write', 'pull-requests: write',
    ]);
    expect(WORKFLOW).not.toContain('id-token');
    expect(WORKFLOW.match(/permissions:/gu)).toHaveLength(1);
  });

  it('serializes through one static concurrency group and a 45-minute timeout', () => {
    expect(WORKFLOW).toContain('concurrency:\n  group: case-lab\n  cancel-in-progress: false');
    expect(WORKFLOW).toContain('timeout-minutes: 45');
  });

  it('gates on the repository variable and the daily cap before any checkout', () => {
    const names = steps.map((step) => step.name);
    expect(names[0]).toBe('Gate on the emergency switch');
    expect(names[1]).toBe('Validate bounded dispatch input');
    expect(names[2]).toBe('Enforce the daily run cap');
    expect(names[3]).toBe('Check out the trusted demo default branch');
    expect(steps[0]?.body).toContain('if [ "$CASE_LAB_ENABLED" != "true" ]');
    expect(steps[0]?.body).toContain('exit 1');
    expect(steps[2]?.body).toContain('gh run list -R "$GITHUB_REPOSITORY" --workflow case-lab.yml --created ">=$since"');
    expect(steps[2]?.body).toContain('if [ "$count" -gt "$CASE_LAB_DAILY_RUN_CAP" ]');
    expect(WORKFLOW).toContain("CASE_LAB_DAILY_RUN_CAP: '8'");
  });

  it('checks out with persist-credentials false and pins the Action and the controller by exact commit', () => {
    expect(WORKFLOW.match(/persist-credentials: false/gu)).toHaveLength(2);
    expect(WORKFLOW).toContain('ref: ${{ env.SUTURA_CONTROLLER_SHA }}');
    expect(WORKFLOW).toContain('test "$(git -C .sutura rev-parse HEAD)" = "$SUTURA_CONTROLLER_SHA"');
    const uses = [...WORKFLOW.matchAll(/uses: juan294\/sutura\/packages\/action@([a-f0-9]{40})/gu)];
    expect(uses).toHaveLength(1);
    expect(WORKFLOW).toContain(`SUTURA_ACTION_SHA: ${uses[0]?.[1]}`);
  });

  it('passes provider secrets only to the Action step and the publish step that scrubs them', () => {
    const secretSteps = steps.filter((step) => /secrets\.(?:NEBIUS_API_KEY|TAVILY_API_KEY|CONTREE_TOKEN)/u.test(step.body)).map((step) => step.name);
    expect(secretSteps).toEqual(['Run Sutura at the exact release', 'Publish the public-safe result document']);
    const publish = steps.find((step) => step.name === 'Publish the public-safe result document');
    expect(publish?.body).toContain('publish-result');
    expect(WORKFLOW).toContain("capture-replay: 'true'");
    expect(WORKFLOW).toContain('continue-on-error: true');
  });

  it('publishes to the results branch without overwriting and uploads the artifact', () => {
    expect(WORKFLOW).toContain('RESULTS_BRANCH: case-lab-results');
    expect(WORKFLOW).toContain('test ! -e "results/${REQUEST_ID}.json"');
    expect(WORKFLOW).toContain('git push origin "HEAD:${RESULTS_BRANCH}"');
    expect(WORKFLOW).toContain('name: sutura-case-lab-${{ inputs.request-id }}');
    expect(WORKFLOW).toContain('if-no-files-found: error');
  });
});

describe('demo materializer', () => {
  it('maps the five ids onto the existing break and matrix materializers and nothing else', () => {
    for (const id of CASE_LAB_CASE_IDS) expect(MATERIALIZER).toContain(`'${id}':`);
    expect(MATERIALIZER).toContain("kind: 'break', name: 'assertion'");
    expect(MATERIALIZER).toContain("kind: 'matrix', name: 'python-repair'");
    expect(MATERIALIZER).toContain('Object.hasOwn(CASES, caseId)');
    expect(MATERIALIZER).toContain('process.exit(2)');
    expect(MATERIALIZER).not.toMatch(/exec(?:Sync)?\(/u);
  });
});
