# CI Parity

Source: `docs/research/2026-08-29-ci-failure-retrospective.md` (29 red runs
in three days; 3 of 4 `develop` regressions were reproducible locally).

- Never push on red. A red `develop` blocks every other push until green;
  the only permitted push is the fix for the red run.
- `pnpm run ci:fast` runs on every push via `.husky/pre-push`. Do not bypass
  it with `--no-verify`. Run `pnpm run ci:local` (exact `ci.yml` mirror,
  ~12 min) before pushing anything that touches `packages/core`.
- `packages/action/dist/index.cjs` is committed. Rebuild and commit it in
  the same commit as any `packages/core` or `packages/action` source change.
- CI runners are 3-5x slower than the local machine. Any test that spawns a
  build, install, or sandbox must declare an explicit timeout of at least
  30 s; never rely on Vitest's 10 s default.
- Error messages in gates must name the file and the cause.
- Product guards (fail-closed checks in `packages/action` and
  `packages/core`) must be backed by a fixture captured from a real CI log
  or real provider response. Every `gave-up` becomes a named replay test
  before the next dogfood run.
- Dogfood runs are dispatched only by `pnpm run dogfood`.
- Paid live runs freeze `develop`: `pnpm run push-freeze on --reason "<why>"`
  before the first dispatch, `off` when terminal. The pre-push hook refuses
  to push while frozen. Keep committing in the worktree and push afterwards.
