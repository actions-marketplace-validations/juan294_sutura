# Phase 10: Case Lab side-by-side view

Issue: #73

Depends on: WS-1 #66 (stable result URLs) and #67 (readable main result) merged
to `develop`.

Status: Complete. The WS-1 result view landed on `develop` at `8d60f32`, which
unblocked this phase; the side-by-side view merged at `c0440b8` under freeze
admission category 4.

## Goal

Show the accepted patch and the rejected alternatives side by side in the Case
Lab, so a judge sees why a green suite is not sufficient without reading a raw
log.

## What Phase 2 already provides

The data contract is complete and on `develop` before this phase starts:

- `CaseFile.counterfactual` carries every alternative with its intent, its
  verdict, the gate and rule that rejected it, the audit checks, and its added
  cost, latency, and sandbox operations.
- The counterfactual sheet in `packages/core/src/report/casefile.ts` is the
  reference rendering and the source of the copy.
- The counterfactual trace events reach the ATIF export, so the same facts are
  available to a machine reader.

So this phase adds no core logic. It is a presentation change inside the WS-1
Case Lab result view.

## Work when unblocked

1. Read the WS-1 result view as merged and identify the component that renders
   the accepted patch.
2. Add a two-column comparison: the accepted or correctly refused outcome on
   the left, the rejected alternatives on the right, each with its intent
   badge, its rejecting gate, its exact rule, and one line of evidence.
3. Add the one-sentence explanation of why green is not sufficient, derived
   from the recorded gates rather than asserted.
4. Keep the view readable on desktop and mobile, matching the WS-1 acceptance
   criteria for #67, and keep the counterfactual section absent when a case has
   no counterfactual evidence.
5. Extend the WS-1 signed-out acceptance script with one assertion that a case
   carrying counterfactual evidence renders both columns.

Touching a WS-1 path follows coordination rule 5: the smallest possible change,
in its own commit, with `ws-2-counterfactual-arena` in the commit body.

## Success criteria

- [ ] A Case Lab case with counterfactual evidence shows the accepted patch and
      every rejected alternative side by side.
- [ ] Each rejected alternative names its gate and its exact rule.
- [ ] The view is readable on desktop and mobile.
- [ ] A case without counterfactual evidence is unchanged.
