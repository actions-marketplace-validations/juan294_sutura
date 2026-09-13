# Phase 2: Counterfactual evidence, trace, and ATIF

Issue: #74

Depends on: Phase 1 (lands in the same commit as Phase 1 because the trace
event type is referenced by the evaluator)

## Goal

Counterfactual results reach the public case file, the trace, the evaluation
manifest, and the ATIF export without repeating any patch body.

## Step 1 - Trace event

`packages/core/src/trace/types.ts`: add one variant.

```ts
| TraceEventBase & {
    type: 'counterfactual-result';
    alternativeId: string;
    intent: 'plausible' | 'shortcut';
    approved: boolean;
    gate: string;   // '' when approved
    rule: string;   // '' when approved
    summary: string;
    childNodeId?: string;
  }
```

Stage is always `'audit'`. The event carries no diff and no source, so
`sanitizeTraceEvent` needs no change; a test asserts the event survives
`sanitizeTraceEvent` unchanged, which also proves no field name normalizes into
`PRIVATE_KEYS`.

`packages/core/src/counterfactual/evaluate.ts` records exactly one such event
per alternative, with `summary` = the verdict reasoning bounded by the existing
500-character trace bound, and `childNodeId` = the alternative's node id.

## Step 2 - Evaluation manifest validation

`packages/evaluation/src/validate.ts`:

- add `'counterfactual-result'` to `TRACE_TYPES`
- add the key list to `EVENT_KEYS`:
  `['alternativeId', 'intent', 'approved', 'gate', 'rule', 'summary', 'childNodeId']`
  with `childNodeId` optional
- add validation in `validateEventFields`: `alternativeId` non-empty, `intent`
  one of the two literals, `approved` boolean, `gate` and `rule` strings that
  are both empty or both non-empty, `summary` a string

No manifest field is added, so `EVALUATION_SCHEMA_VERSION` is unchanged and
`evaluationResultHash` normalization is unchanged.

## Step 3 - ATIF export

`packages/evaluation/src/atif.ts`: add a branch before the `systemStep`
fallback.

```ts
if (event.type === 'counterfactual-result') {
  return [{
    timestamp: timestamp(event.timestampMs),
    source: 'system',
    message: event.summary,
    extra: {
      sutura: {
        event_type: event.type,
        sequence: event.sequence,
        alternative_id: event.alternativeId,
        intent: event.intent,
        approved: event.approved,
        ...(event.gate ? { rejected_by: { gate: event.gate, rule: event.rule } } : {}),
      },
    },
  }];
}
```

`AtifStep.extra` is already `Record<string, unknown>`
(`packages/evaluation/src/schema.ts:57`), so `ATIF_SCHEMA_VERSION` stays
`ATIF-v1.7`. `pnpm run test:atif` validates the committed sample against the
ATIF validator, so a refreshed sample must still pass it.

## Step 4 - Public case file

`packages/core/src/report/casefile.ts`: when `caseFile.counterfactual` is
present, render a "Counterfactual" sheet after Pathology:

- one row per alternative: id, intent, verdict (`ACCEPTED` or `REJECTED`),
  gate, rule, evidence, added sandbox operations, added elapsed seconds, added
  inference USD
- a one-sentence lede naming why a green suite is not sufficient, derived from
  the recorded gates rather than written as a fixed claim
- totals for the additional cost, latency, and sandbox operations

Diff bodies are not rendered here. The accepted patch already appears in the
Procedure sheet. This section is the data source Phase 10 reuses for the Case
Lab side-by-side view.

`packages/core/src/report/markdown.ts` gains one summary line when
counterfactual evidence exists: how many alternatives were evaluated, how many
were rejected, and the distinct gates that rejected them.

## Step 5 - Adapter revalidation

`packages/placebo/src/adapters.ts` `parseCaseFile` must accept the new optional
`counterfactual` field, and must reject a malformed one, otherwise every
Placebo run through the CLI adapter would report
`does not match Sutura CaseFile`. Add `validCounterfactual(value)` mirroring
the shape checks already used for `validAudit` and `validStages`, with bounded
string lengths.

## Tests

- `packages/core/src/trace/recorder.test.ts`: the new event round-trips through
  `sanitizeTraceEvent` unchanged and is bounded.
- `packages/evaluation/src/evaluation.test.ts`: a manifest containing
  `counterfactual-result` events validates; a manifest with an unknown field on
  that event is refused; a manifest whose `gate` is set but `rule` is empty is
  refused.
- `packages/evaluation/src/evaluation.test.ts`: `exportAtif` maps the event to
  a system step whose `extra.sutura.rejected_by` names the gate and rule, and
  no step contains any patch body.
- `packages/core/src/report/casefile.test.ts`: the counterfactual sheet renders
  every alternative with its gate and rule, escapes untrusted text, and is
  absent when the field is absent.
- `packages/placebo/src/adapters.test.ts`: a `CaseFile` carrying valid
  counterfactual evidence parses; a malformed one is refused.

## Success criteria

- [ ] All listed tests pass.
- [ ] `EVALUATION_SCHEMA_VERSION` and `ATIF_SCHEMA_VERSION` are unchanged.
- [ ] `pnpm run test:atif` passes on the committed ATIF sample.
- [ ] No trace event carries a patch body, and `PRIVATE_KEYS` is unchanged.
- [ ] `pnpm run ci:local` passes on the integrated commit and
      `packages/action/dist/index.cjs` is rebuilt in the same commit.
