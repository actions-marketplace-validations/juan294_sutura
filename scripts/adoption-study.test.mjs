import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  finalizeStudy,
  validateStudyEvidence,
  validateParticipantRecord,
  validateParticipantTemplate,
  verifyParticipantPublicEvidence,
  verifyPublicRelease,
} from './adoption-study.mjs';

const SHA = 'a'.repeat(40);
const VERIFY_PUBLIC = async () => undefined;
const VERIFY_RELEASE = async () => undefined;

function participant(overrides = {}) {
  return {
    schemaVersion: 'sutura-adoption-participant-v1',
    participantId: 'participant-a1b2c3d4',
    participantBuiltSutura: false,
    participationConsent: true,
    repository: {
      url: 'https://github.com/example/javascript-repair',
      familiarToParticipant: true,
      familiarToSuturaBuilders: false,
      language: 'javascript',
    },
    artifact: {
      packageVersion: '0.2.1',
      actionCommit: SHA,
      installSource: 'public-npm-and-immutable-action',
    },
    measurements: {
      sessionStartedAt: '2026-09-05T10:00:00.000Z',
      timeToFirstValidResultMs: 120000,
      setupFailures: [],
      unclearInstructions: [],
      manualInterventions: [],
    },
    result: {
      classification: 'repair',
      targetRunUrl: 'https://github.com/example/javascript-repair/actions/runs/123456789',
      suturaRunUrl: 'https://github.com/example/javascript-repair/actions/runs/123456790',
      checkRunUrl: 'https://github.com/example/javascript-repair/runs/987654321',
      valid: true,
    },
    releaseBlockingDefects: [],
    publicReviewConfirmed: true,
    feedbackPermission: false,
    feedbackQuote: null,
    feedbackDisplayName: null,
    ...overrides,
  };
}

test('template is explicitly incomplete and has the strict participant schema', async () => {
  const template = JSON.parse(await readFile(new URL('../docs/adoption/ws-3-participant-record-template.json', import.meta.url)));
  assert.doesNotThrow(() => validateParticipantTemplate(template));
  assert.throws(() => validateParticipantRecord(template), /participantId/u);
  assert.throws(() => validateParticipantTemplate({ ...template, unexpected: true }), /keys/u);
});

test('participant validation measures setup and rejects unapproved attribution or open blockers', () => {
  assert.doesNotThrow(() => validateParticipantRecord(participant()));
  assert.throws(() => validateParticipantRecord(participant({
    feedbackQuote: 'Looks useful.', feedbackDisplayName: 'A Developer',
  })), /feedbackPermission/u);
  assert.doesNotThrow(() => validateParticipantRecord(participant({
    feedbackPermission: true,
    feedbackQuote: 'The refusal explained the policy clearly.',
    feedbackDisplayName: 'A Developer',
  })));
  assert.throws(() => validateParticipantRecord(participant({
    releaseBlockingDefects: [{
      category: 'documentation', description: 'Missing permission step', blocking: true,
      resolved: false, resolution: null,
    }],
  })), /release-blocking defect/u);
  assert.throws(() => validateParticipantRecord(participant({
    measurements: { ...participant().measurements, timeToFirstValidResultMs: null },
  })), /timeToFirstValidResultMs/u);
  assert.throws(() => validateParticipantRecord(participant({
    measurements: { ...participant().measurements, sessionStartedAt: '2026-02-30T10:00:00.000Z' },
  })), /sessionStartedAt/u);
  assert.throws(() => validateParticipantRecord(participant({
    publicReviewConfirmed: false,
  })), /reviewed for public/u);
  assert.throws(() => validateParticipantRecord(participant({
    measurements: { ...participant().measurements, unclearInstructions: ['/Users/alice/private'] },
  })), /private local path/u);
  assert.throws(() => validateParticipantRecord(participant({
    measurements: { ...participant().measurements, setupFailures: ['NEBIUS_API_KEY=ordinary-looking-value'] },
  })), /credential/u);
  assert.throws(() => validateParticipantRecord(participant({
    result: { ...participant().result, targetRunUrl: 'https://github.com/example/other/actions/runs/1' },
  })), /belong to repository/u);
});

test('public evidence verifies repository, run, and immutable workflow through GitHub', async () => {
  const responses = [
    { private: false, full_name: 'example/javascript-repair' },
    {
      repository: { full_name: 'example/javascript-repair' }, head_sha: 'b'.repeat(40),
      path: '.github/workflows/sutura.yml', event: 'workflow_run', status: 'completed', conclusion: 'success',
      run_started_at: '2026-09-05T10:02:00.000Z', updated_at: '2026-09-05T10:04:00.000Z',
    },
    { content: Buffer.from(`jobs:\n  repair:\n    steps:\n      - uses: juan294/sutura@${SHA}\n`).toString('base64') },
    {
      repository: { full_name: 'example/javascript-repair' }, head_sha: 'c'.repeat(40),
      status: 'completed', conclusion: 'failure',
    },
    {
      name: 'Sutura repair audit', status: 'completed', head_sha: 'c'.repeat(40),
      external_id: 'sutura:example/javascript-repair:workflow-run:123456789',
      output: { title: 'Sutura outcome: fixed' },
      started_at: '2026-09-05T10:02:10.000Z', completed_at: '2026-09-05T10:03:50.000Z',
    },
  ];
  const fetchImplementation = async () => new Response(JSON.stringify(responses.shift()), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  await assert.doesNotReject(() => verifyParticipantPublicEvidence(participant(), fetchImplementation));
});

test('public release verification binds npm metadata and immutable tag to one candidate', async () => {
  const dependencies = {
    resolveCommit: async () => SHA,
    fetch: async () => new Response(JSON.stringify({
      name: 'sutura', version: '0.2.1', dist: { integrity: 'sha512-public' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  };
  await assert.doesNotReject(() => verifyPublicRelease('0.2.1', SHA, dependencies));
  await assert.rejects(() => verifyPublicRelease('0.2.1', 'b'.repeat(40), dependencies), /differs/u);
});

test('finalize requires three distinct unfamiliar repositories, both language families, and all outcomes', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'sutura-adoption-study-'));
  try {
    const records = [
      participant(),
      participant({
        participantId: 'participant-b2c3d4e5',
        repository: { ...participant().repository, url: 'https://github.com/example/python-refusal', language: 'python' },
        result: {
          ...participant().result, classification: 'refusal',
          targetRunUrl: 'https://github.com/example/python-refusal/actions/runs/223456789',
          suturaRunUrl: 'https://github.com/example/python-refusal/actions/runs/223456790',
          checkRunUrl: 'https://github.com/example/python-refusal/runs/887654321',
        },
      }),
      participant({
        participantId: 'participant-c3d4e5f6',
        repository: { ...participant().repository, url: 'https://github.com/example/typescript-flake', language: 'typescript' },
        result: {
          ...participant().result, classification: 'flake',
          targetRunUrl: 'https://github.com/example/typescript-flake/actions/runs/323456789',
          suturaRunUrl: 'https://github.com/example/typescript-flake/actions/runs/323456790',
          checkRunUrl: 'https://github.com/example/typescript-flake/runs/787654321',
        },
      }),
    ];
    for (const [index, record] of records.entries()) {
      await writeFile(join(temporary, `${index + 1}.json`), JSON.stringify(record));
    }

    const first = await finalizeStudy({ candidate: SHA, recordsDirectory: temporary, verifyPublicEvidence: VERIFY_PUBLIC, verifyRelease: VERIFY_RELEASE });
    const second = await finalizeStudy({ candidate: SHA, recordsDirectory: temporary, verifyPublicEvidence: VERIFY_PUBLIC, verifyRelease: VERIFY_RELEASE });
    assert.equal(first.participantCount, 3);
    assert.equal(first.ready, true);
    assert.equal(first.repositoryCount, 3);
    assert.deepEqual(first.languages, ['javascript', 'python', 'typescript']);
    assert.deepEqual(first.classifications, { flake: 1, refusal: 1, repair: 1 });
    assert.match(first.resultHash, /^[a-f0-9]{64}$/u);
    assert.equal(first.resultHash, second.resultHash);
    assert.equal(first.packageVersion, '0.2.1');
    assert.doesNotThrow(() => validateStudyEvidence(first));
    assert.throws(() => validateStudyEvidence({ ...first, resultHash: '0'.repeat(64) }), /resultHash/u);

    await writeFile(join(temporary, '3.json'), JSON.stringify({
      ...records[2], participantId: records[1].participantId,
    }));
    await assert.rejects(() => finalizeStudy({ candidate: SHA, recordsDirectory: temporary, verifyPublicEvidence: VERIFY_PUBLIC, verifyRelease: VERIFY_RELEASE }), /distinct participants/u);
    await writeFile(join(temporary, '3.json'), JSON.stringify({
      ...records[2],
      repository: { ...records[2].repository, url: `${records[1].repository.url}/`.toUpperCase() },
      result: {
        ...records[2].result,
        targetRunUrl: `${records[1].repository.url}/actions/runs/323456789`,
        suturaRunUrl: `${records[1].repository.url}/actions/runs/323456790`,
        checkRunUrl: `${records[1].repository.url}/runs/787654321`,
      },
    }));
    await assert.rejects(() => finalizeStudy({ candidate: SHA, recordsDirectory: temporary, verifyPublicEvidence: VERIFY_PUBLIC, verifyRelease: VERIFY_RELEASE }), /distinct repositories/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('finalize rejects incomplete language and outcome denominators', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'sutura-adoption-denominator-'));
  try {
    for (let index = 0; index < 3; index += 1) {
      const repositoryUrl = `https://github.com/example/repo-${index}`;
      await writeFile(join(temporary, `${index}.json`), JSON.stringify(participant({
        participantId: `participant-a1b2c3d${index}`,
        repository: { ...participant().repository, url: repositoryUrl },
        result: {
          ...participant().result,
          targetRunUrl: `${repositoryUrl}/actions/runs/${index + 1}`,
          suturaRunUrl: `${repositoryUrl}/actions/runs/${index + 11}`,
          checkRunUrl: `${repositoryUrl}/runs/${index + 21}`,
        },
      })));
    }
    await assert.rejects(() => finalizeStudy({ candidate: SHA, recordsDirectory: temporary, verifyPublicEvidence: VERIFY_PUBLIC, verifyRelease: VERIFY_RELEASE }), /Python/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
