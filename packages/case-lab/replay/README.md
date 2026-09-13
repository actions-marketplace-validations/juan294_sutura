# Case Lab replay fixtures

A file `<case-id>.json` in this directory is a `sutura-case-lab-replay-fixture-v1`
document: `{ schemaVersion, release: { version, actionSha }, demoSha,
capturedRunUrl, bundle }`, where `bundle` is a complete `sutura-replay-v1`
bundle captured by the `Case Lab` workflow with `capture-replay: 'true'`. The
Case Lab replays it through `replayBundle` from `@sutura/core` without
credentials, network, or sandbox access, and labels the result
`Deterministic replay`.

Rules:

- `release.actionSha` must equal `actionSha` in `../release.json`: the Sutura
  release that recorded the bundle. Recorded request shapes drift between
  Sutura commits.
- The bundle's own `actionSha` is the commit of the repository that ran the
  workflow, the demo commit; it must equal the fixture's `demoSha`.
- A partial bundle (`completeness.complete: false`) is refused.
- The replayed outcome must equal the recorded outcome.
- Fixtures are written with `flag: 'wx'` by `case-lab capture-replay`, which
  replays the bundle before writing and refuses one that does not replay. They
  are never overwritten; replace one by deleting it in a reviewed commit.

When no fixture exists for a case, the Case Lab falls back to the committed
live benchmark result in `docs/demo/placebo-v0.2-live-2026-09.json`, labeled
`Recorded live result`.
