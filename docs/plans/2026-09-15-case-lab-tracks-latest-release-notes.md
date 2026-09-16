# Notes: `2026-09-15-case-lab-tracks-latest-release`

## Deviations

### Phase 4

- Plan said: `defaultDependencies()` in `scripts/release-case-lab.mjs` returns
  `{ git, gh, vercel, fetch, readFile, writeFile, stdout, stderr }` (phase-4.md
  "Script contract").
  Found: `bump()`'s prose requires shelling out to `case-lab verify-pin --tag`
  "through dependencies.command", and `deploy()`'s prose requires a 5-attempt/
  10 s-spaced health-check retry — neither a generic subprocess runner nor a
  stubbable delay was in the literal `defaultDependencies()` sketch.
  Chose: added `command` (a generic subprocess runner; `git`/`gh`/`vercel`
  remain thin wrappers around it, matching house style) and `sleep` to
  `defaultDependencies()`.
  Why: both are required by the contract's own prose to make `bump()` and
  `deploy()` runnable and testable (tests stub `sleep` to avoid 40 s+ real
  wall-clock time); omitting them would have made those two subcommands
  either unimplementable as specified or untestable offline.

- Plan said: "check names the file, observed and expected value for each
  drift ... (six cases)" (phase-4.md "Tests", item 3).
  Found: `check()` performs 9 `expect()` calls (one per compared field), not
  6.
  Chose: grouped the 9 field-level assertions into 6 test sub-cases matching
  the plan's six *bindings* (release.json version, release.json actionSha,
  workflow pins, recorded evidence result, recorded evidence ledger, replay
  EVIDENCE_URL) — each sub-case still verifies file/observed/expected/BLOCKED-
  prefix/Fix-suffix.
  Why: matches the plan's own binding table (design section C) rather than
  the literal per-field count, and keeps one test per logical drift a release
  operator would see.

### Simplify pass (after Phase 1 + 4 implementation)

Three findings from the 4-agent `/simplify` review were deliberately not
applied, despite being individually well-reasoned:

- **`readPins`/`writePins` in `scripts/release-case-lab.mjs` hand-copy the
  three regexes from `packages/case-lab/src/pin.ts` instead of importing
  `packages/case-lab/dist/index.js`'s exported `parseDemoWorkflowPins`/
  `verifyPin`.** The plan's own rationale for copying ("the .mjs cannot
  import TS") is factually wrong — the codebase already imports built dist
  output from `.mjs` scripts elsewhere (`scripts/dogfood.mjs` imports
  `packages/core/dist/index.js`). Not applied because: `packages/case-lab`
  has no `dist/` build in this worktree, and `package.json`'s
  `test:release-contracts` only builds `@sutura/core` and `@sutura/evaluation`
  — switching would require expanding build wiring outside this diff's file
  boundary and would break the offline pure-text-in/text-out design
  `check()`/`bump()`'s tests depend on. Left as a legitimate follow-up, not
  fixed here.
- **`scripts/dogfood.mjs`'s release-mode `clean-tree` check nests an
  unrelated `RELEASE_VERSION` stamp assertion under a check named for tree
  cleanliness.** Not applied because phase-1.md's own test spec requires
  "PASS line count stays 7" with names `origin-main`/`main-ci`; splitting the
  assertion into its own named check would add an 8th PASS line and break
  that explicit contract.
- **`resolveReleaseTag` in `scripts/placebo-live.mjs` duplicates the tag-
  dereference logic in `packages/case-lab/src/cli.ts:195-201`.** Not applied
  because phase-1.md's own code sketch specifies this as an intentional
  mirror ("Same dereference as ..."), not something to extract now.

Two findings *were* applied (redundant `ref`/`releaseTag` parameter removed
in `scripts/placebo-live.mjs`; independent I/O in `newestReleaseTag()` and
`check()` in `scripts/release-case-lab.mjs` parallelized with `Promise.all`)
— both pure refactors with no behavior change, verified by a full
`test:release-contracts` pass before and after.
