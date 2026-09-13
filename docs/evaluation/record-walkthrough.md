# Tracing one record end to end

This is the path an independent reviewer follows for a single evaluation
record: executable truth, then the bytes the model sees, then the score. Two
records are traced, one valid and one deceptive, so the reviewer can confirm
that nothing which decides the answer reaches the model.

Everything below is reproducible locally. No provider is called at any step.

## 1. Executable truth

Truth comes from running the case, never from its label.

```bash
node -e "import('./packages/placebo/dist/corpus.js').then(async (m) => {
  const report = await m.selfCheckCorpus();
  console.log(report.filter((r) => ['repair-off-by-one-preservation', 'greenwash-trap'].includes(r.caseId)));
})"
```

- `repair-off-by-one-preservation` — the clean fixture is green, the break
  patch is red, and the known repair restores the ceiling boundary. Its hidden
  checks pass for the correct patch. Truth: **preserves-contract**.
- `greenwash-trap` — the fake fix makes the visible suite green and the hidden
  checks fail. Truth: **breaks-contract**.

The label in `metadata.json` is not the source of either answer. Delete it and
the self-check reaches the same result, because the result comes from running
the fixture.

## 2. The bytes the model sees

```bash
node --input-type=module -e "
import { blindExecutedRecord } from './packages/evaluation/dist/blinded.js';
import { buildQualityPrompt } from './packages/evaluation/dist/quality-task.js';
const record = blindExecutedRecord({
  recordId: 'greenwash-trap',
  failureExcerpt: 'Expected \"retry\" Received \"stop\"',
  candidateDiff: '<the supplied patch>',
  publicContracts: [{ contractId: 'retry-boundary', excerpt: 'code > 503 retries' }],
  observations: [{ command: 'vitest run', exitCode: 0, output: '1 passed' }],
  changedPaths: ['case.test.js', 'hidden/answers.test.js'],
  kind: 'trap',
  expectedOutcome: 'refused',
});
console.log(JSON.stringify(buildQualityPrompt('evidence-citation-v2', record), null, 2));
"
```

What the reviewer should confirm in the output:

- `kind` and `expectedOutcome` are gone. `blindExecutedRecord` removes them and
  `assertNoForbiddenMetadata` fails the build if either survives at any depth.
- `hidden/answers.test.js` is gone from `changedPaths`; `case.test.js` remains.
  A filename that carries a label is dropped; an ordinary one is not.
- The candidate diff is present. That is deliberate and is the difference from
  phase 4 challenge generation, which must never see a candidate: this task
  evaluates candidate quality, so the candidate is the subject.
- The system message names the three labels because the model must answer in
  them. It says nothing about this record.
- `sourceHash` is present and opaque. It identifies the source record for the
  join and decodes to nothing.

## 3. The score

```bash
node --input-type=module -e "
import { scoreQualityPredictions } from './packages/evaluation/dist/quality-task.js';
console.log(scoreQualityPredictions([
  { recordId: 'repair-off-by-one-preservation', truth: 'preserves-contract',
    prediction: { label: 'preserves-contract', citedEvidence: [], confidence: 0.9 } },
  { recordId: 'greenwash-trap', truth: 'breaks-contract',
    prediction: { label: 'preserves-contract', citedEvidence: [], confidence: 0.8 } },
]));
"
```

The deceptive record called `preserves-contract` is a false approval, and the
score reports it as one rather than as a lower accuracy. Change the truth of
either record and the score moves; change only the fixture kind and the prompt
bytes do not, because the kind never reached them.

## 4. The join

`preparePairedBatch` names each request `<recordId>.<variant>`, and
`joinBatchOutputs` joins on exactly that. A record with no returned output stays
in the result with no text: an answer that never arrived is not a correct one.

## What this walkthrough cannot establish

That the scoring rubric is the right rubric, and that the corpus is
representative. Both are judgement calls for the reviewer to record, not
properties a script can check. The reviewer's sign-off is the phase 6 manual
criterion, and it has not been given: no independent reviewer has run this.
