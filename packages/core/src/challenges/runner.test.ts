import { describe, expect, it, vi } from 'vitest';

import { CHALLENGE_REPETITIONS, type ChallengeProposal, type FrozenChallengeSet } from './generate.js';
import { runFrozenChallenges, type ChallengeProbeRunner } from './runner.js';

function challenge(overrides: Partial<ChallengeProposal> = {}): ChallengeProposal {
  return {
    id: 'ceiling-preserved',
    kind: 'preservation',
    contractRefs: [{ path: '.sutura.json', sha256: 'a'.repeat(64), startLine: 1, endLine: 2 }],
    rationale: 'boundary stays at two pages',
    probeId: 'page-count',
    inputs: [20, 10],
    contractId: 'page-count-ceiling',
    relationId: 'equals',
    ...overrides,
  };
}

function frozen(challenges: ChallengeProposal[]): FrozenChallengeSet {
  return {
    version: 'sutura-challenges-v1',
    baselineSnapshotHash: 'b'.repeat(64),
    trustedPolicySha: 'c'.repeat(64),
    contextHash: 'd'.repeat(64),
    promptHash: 'e'.repeat(64),
    setHash: 'f'.repeat(64),
    challenges,
    excluded: [],
  };
}

/** Scripts an outcome per subject so baseline and candidate can differ. */
function scripted(
  script: Partial<Record<'baseline' | 'candidate', 'passed' | 'failed' | 'insufficient'>>,
): ChallengeProbeRunner {
  return ({ subject }) => Promise.resolve({ status: script[subject] ?? 'passed' });
}

describe('frozen challenge runner', () => {
  it('runs two repetitions per subject on a qualified preservation challenge', async () => {
    const run = vi.fn<ChallengeProbeRunner>(scripted({ baseline: 'passed', candidate: 'passed' }));
    const result = await runFrozenChallenges({ set: frozen([challenge()]), run });

    expect(result.status).toBe('passed');
    expect(result.observations).toHaveLength(CHALLENGE_REPETITIONS * 2);
    expect(result.observations.filter(({ subject }) => subject === 'baseline'))
      .toHaveLength(CHALLENGE_REPETITIONS);
    expect(run.mock.calls.map((call) => call[0].repetition)).toEqual([1, 2, 1, 2]);
  });

  it('qualifies a bug-regression challenge only when the baseline fails consistently', async () => {
    const regression = challenge({ id: 'bug-reproduced', kind: 'bug-regression' });
    const good = await runFrozenChallenges({
      set: frozen([regression]), run: scripted({ baseline: 'failed', candidate: 'passed' }),
    });
    const bad = await runFrozenChallenges({
      set: frozen([regression]), run: scripted({ baseline: 'passed', candidate: 'passed' }),
    });

    expect(good.status).toBe('passed');
    expect(bad.status).toBe('insufficient');
    expect(bad.qualified[0]).toMatchObject({
      qualified: false, reasonCode: 'baseline-not-consistently-failing',
    });
  });

  it('excludes a preservation challenge the baseline does not consistently pass', async () => {
    const result = await runFrozenChallenges({
      set: frozen([challenge()]), run: scripted({ baseline: 'failed' }),
    });

    expect(result.status).toBe('insufficient');
    expect(result.qualified[0]).toMatchObject({
      qualified: false, reasonCode: 'baseline-not-consistently-passing',
    });
  });

  it('never runs the candidate for a challenge the baseline disqualified', async () => {
    const run = vi.fn<ChallengeProbeRunner>(scripted({ baseline: 'insufficient' }));
    await runFrozenChallenges({ set: frozen([challenge()]), run });

    expect(run.mock.calls.map((call) => call[0].subject)).toEqual(['baseline', 'baseline']);
  });

  it('refuses when a qualified challenge does not pass every candidate repetition', async () => {
    let candidateRun = 0;
    const run: ChallengeProbeRunner = ({ subject }) => {
      if (subject === 'baseline') return Promise.resolve({ status: 'passed' as const });
      candidateRun += 1;
      return Promise.resolve({ status: candidateRun === 1 ? 'passed' as const : 'failed' as const });
    };
    const result = await runFrozenChallenges({ set: frozen([challenge()]), run });

    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('ceiling-preserved');
  });

  it('reports insufficient when the frozen set retained nothing', async () => {
    const result = await runFrozenChallenges({ set: frozen([]), run: scripted({}) });

    expect(result.status).toBe('insufficient');
    expect(result.reasonCode).toBe('no-frozen-challenges');
  });

  it('keeps an unqualified challenge from conferring assurance on its own', async () => {
    const result = await runFrozenChallenges({
      set: frozen([
        challenge({ id: 'unqualified' }),
        challenge({ id: 'also-unqualified', kind: 'bug-regression' }),
      ]),
      run: scripted({ baseline: 'insufficient', candidate: 'passed' }),
    });

    expect(result.status).toBe('insufficient');
    expect(result.reasonCode).toBe('no-qualified-challenge');
    expect(result.qualified.every(({ qualified }) => !qualified)).toBe(true);
  });

  it('requires every qualified challenge to pass, not merely one', async () => {
    const run: ChallengeProbeRunner = ({ challenge: item, subject }) => Promise.resolve({
      status: subject === 'baseline' || item.id === 'first' ? 'passed' as const : 'failed' as const,
    });
    const result = await runFrozenChallenges({
      set: frozen([challenge({ id: 'first' }), challenge({ id: 'second' })]),
      run,
    });

    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('second');
  });
});

describe('challenge quality fixtures', () => {
  const preservation = challenge({ id: 'preserved' });
  const regression = challenge({ id: 'reproduces-bug', kind: 'bug-regression' });

  /** A challenge whose probe cannot even load on the baseline. */
  it('treats a baseline import failure as insufficient, never as a patch defect', async () => {
    const result = await runFrozenChallenges({
      set: frozen([preservation]),
      run: ({ subject }) => Promise.resolve(subject === 'baseline'
        ? { status: 'insufficient' as const, reasonCode: 'import-error' }
        : { status: 'passed' as const }),
    });

    expect(result.status).toBe('insufficient');
    expect(result.status).not.toBe('failed');
    expect(result.reasonCode).toBe('no-qualified-challenge');
  });

  it('treats a nondeterministic baseline as insufficient rather than qualifying it', async () => {
    let baselineRun = 0;
    const result = await runFrozenChallenges({
      set: frozen([preservation]),
      run: ({ subject }) => {
        if (subject !== 'baseline') return Promise.resolve({ status: 'passed' as const });
        baselineRun += 1;
        return Promise.resolve({ status: baselineRun === 1 ? 'passed' as const : 'failed' as const });
      },
    });

    expect(result.status).toBe('insufficient');
    expect(result.qualified[0]?.qualified).toBe(false);
  });

  it('treats a nondeterministic candidate as a refusal, not a pass', async () => {
    let candidateRun = 0;
    const result = await runFrozenChallenges({
      set: frozen([preservation]),
      run: ({ subject }) => {
        if (subject === 'baseline') return Promise.resolve({ status: 'passed' as const });
        candidateRun += 1;
        return Promise.resolve({ status: candidateRun === 1 ? 'failed' as const : 'passed' as const });
      },
    });

    expect(result.status).toBe('failed');
  });

  it('keeps contradictory challenges from cancelling out into an approval', async () => {
    // One qualified challenge passes the candidate, the other refuses it.
    const result = await runFrozenChallenges({
      set: frozen([preservation, challenge({ id: 'also-preserved' })]),
      run: ({ challenge: item, subject }) => Promise.resolve({
        status: subject === 'baseline' || item.id === 'preserved'
          ? 'passed' as const
          : 'failed' as const,
      }),
    });

    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('also-preserved');
  });

  it('passes two equivalent valid repairs identically', async () => {
    const run = scripted({ baseline: 'passed', candidate: 'passed' });
    const [first, second] = await Promise.all([
      runFrozenChallenges({ set: frozen([preservation]), run }),
      runFrozenChallenges({ set: frozen([preservation]), run }),
    ]);

    expect(first.status).toBe('passed');
    expect(second).toEqual(first);
  });

  it('qualifies a bug-regression challenge the candidate then fixes', async () => {
    const result = await runFrozenChallenges({
      set: frozen([regression]),
      run: ({ subject }) => Promise.resolve({
        status: subject === 'baseline' ? 'failed' as const : 'passed' as const,
      }),
    });

    expect(result.status).toBe('passed');
    expect(result.qualified[0]).toMatchObject({ challengeId: 'reproduces-bug', qualified: true });
  });

  it('never reports a candidate refusal when no challenge qualified', async () => {
    const result = await runFrozenChallenges({
      set: frozen([preservation, regression]),
      run: ({ subject }) => Promise.resolve(subject === 'baseline'
        ? { status: 'insufficient' as const, reasonCode: 'timeout' }
        : { status: 'failed' as const }),
    });

    expect(result.status).toBe('insufficient');
    expect(result.observations.every(({ subject }) => subject === 'baseline')).toBe(true);
  });
});
