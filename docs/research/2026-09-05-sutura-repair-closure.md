# Repair closure research: why the Python repairs stop at an inadmissible source

Date: 2026-09-05

Status: Complete

Commit read: `f5c3056acc96597f1ae11f411a3b9cfe03ba990f`

Date: 2026-09-05
Repository: `/Users/juan/code/sutura-g2` (detached at `f5c3056`)
Evidence: `.sutura/placebo-v0.2.1-live-artifacts/*.json` (read only), corpus fixtures,
and a local re-run of the broken Python fixture in the session scratchpad.

## Correction to the task premise (read this first)

The brief states "the bug is in `app.py` (missing await), the traceback only names
`tests/test_app.py`". That is not what the corpus does.

`packages/placebo/corpus/python-repair-missing-await/break.diff:1-11` mutates
`tests/test_app.py`, not `app.py`:

```
--- a/tests/test_app.py
+++ b/tests/test_app.py
-        self.assertEqual(await fetch_name(), "Ada")
+        self.assertEqual(fetch_name(), "Ada")
```

`fixture/app.py:1-2` is two correct lines (`async def fetch_name() -> str: return "Ada"`).
`repair.diff:1-11` restores the `await` in the test file. `metadata.json:1` labels the case
`"class":"test-bug"`. The same holds for both JavaScript siblings:
`corpus/repair-missing-await/break.diff:4-9` and
`corpus/repair-missing-await-setup/break.diff:4-9` both edit `case.test.js`, and both
`metadata.json` files declare `"class":"test-bug"`.

So the three `missing-await` cases are **not** closure-coverage failures. The one file the
closure needs is already in the closure; it is refused as a *target* because the diagnosed
class is `test-assertion`, not `test-bug`.

Two genuinely different defects hide behind the one stage note. They need different fixes.

| Case | Broken file | In closure? | Admissible target? | Root cause |
| --- | --- | --- | --- | --- |
| `python-repair-missing-await` | `tests/test_app.py` | yes | no | class is `test-assertion` |
| `repair-missing-await` (JS) | `case.test.js` | yes | no | class is `test-assertion` |
| `repair-missing-await-setup` (JS) | `case.test.js` | yes | no | class is `test-assertion` |
| `python-repair-cache-key` | `cache.py` | **no** | n/a | absolute Python import not followed |
| `python-repair-type-mismatch` | `formatting.py` | **no** | n/a | absolute Python import not followed |

Defect A (missing-await family): the only admissible-target rule keyed on the diagnosis class
refuses the file that must change.
Defect B (cache-key / type-mismatch): the import-graph expansion that already exists does not
understand Python absolute imports, so the production file never enters the closure.

## 1. How the closure is built

Both entry points converge on one function, so a fix in `packages/core/src` covers both.

- CLI: `packages/cli/src/heal.ts:183-211` `readLocalSourceContext` wraps a local
  `readSourceExcerpts` port (`packages/cli/src/heal.ts:193-203`) that guards path shape
  (`safeRelativePath`, `packages/cli/src/heal.ts:78-90`), symlink components
  (`hasSymlinkComponent`, `:92-103`), containment (`isInside`, `:74-76`), and a bounded line
  window (`readLineWindow`, `:105-157`; `readBoundedSource`, `:159-181`). It then delegates to
  `readRepairSourceContext` (`packages/cli/src/heal.ts:191-210`). It does **not** pass
  `sourceReferenceOrder`, so the default `'first'` applies.
- GitHub Action: `packages/action/src/main.ts:70` sets `sourceReferenceOrder: 'latest'`;
  `packages/action/src/repository.ts:207-265` implements the same port with equivalent guards;
  `packages/core/src/orchestrate.ts:692-699` calls the same `readRepairSourceContext` with
  `runtime.id` and `ctx.sourceReferenceOrder`.
- The only behavioural difference between the two paths is `'first'` vs `'latest'` reference
  ordering (`packages/core/src/orchestrate.ts:377-382`). Neither difference is load-bearing for
  the cases in question (each log names exactly one repository path).

`readRepairSourceContext` (`packages/core/src/orchestrate.ts:365-492`):

1. `extractSourceReferences(log, order)` (`:304-363`) scrapes repository-relative paths from the
   log with `SOURCE_PATH_PATTERN` (`:58`), after stripping ANSI, `/workspace/`, and the GitHub
   runner workspace prefix (`:308-312`). Capped at `MAX_SOURCE_FILES = 8` (`:53`, `:331-335`).
2. Policy read filter: `policyAllowsSourceRead` (`:374-376`;
   `packages/core/src/policy/evaluate.ts:65-67`).
3. Class-keyed manifest fallbacks are appended when the reference list is short
   (`:383-394`). `NODE_FALLBACK_SOURCE_PATHS` (`:61-72`) and `PYTHON_FALLBACK_SOURCE_PATHS`
   (`:73-79`) have entries only for `typecheck`, `lint`, `build`, `dep-upstream-breaking`,
   `env-config`. **There is no entry for `test-assertion` or `test-bug`**, so the `uv.lock`
   fallback the earlier research doc describes does not fire for any of these five cases.
4. Root excerpts are read and validated (`:447-451`, validator `:397-445`; it enforces the
   file/line/byte limits at `:167-172` and drops excerpts containing redacted text at `:433-436`).
5. **Import-graph expansion already exists**: two depths of it, `:453-488`, driven by
   `sourceDependencyGroups` (`packages/core/src/engine/source-context.ts:100-125`). Candidate
   paths are probed through the same bounded read port (`:470-477`) and a group contributes a
   file only when **exactly one** of its candidates resolves (`:478-484`), which is what keeps
   it deterministic. Probe budget `MAX_DEPENDENCY_CANDIDATE_PROBES_PER_DEPTH = 192` (`:56`),
   group cap `MAX_DEPENDENCY_GROUPS = 24` (`source-context.ts:6`).

Target selection: `packages/core/src/heal.ts:850-861` calls
`prepareControlledRepairProposalTemplate`; on throw it records
`` `${failureKind} failure: ${message}` `` to the stage ledger and returns a `gave-up` case file
with an empty race. That is the exact note in the artifacts.
`prepareControlledRepairProposalTemplate` (`packages/core/src/engine/repair-attempt.ts:141-244`)
filters in three stages: non-empty anchorable (`:144-149`), **policy-admissible** (`:150-155`,
message at `:153`), completion-bounded (`:156-161`). `sourceEvidence` (`:98-126`) computes
`policyAdmissible = isRepairPathAdmissible(source.path, ctx.diagnosis) && policyAllowsPatchPath(...)`
at `:110-111`.

The agentic loop with `read_file` / `search_repo` (`packages/core/src/engine/repair-tools.ts:38-58`,
`runRepairAgent` at `packages/core/src/engine/repair-agent.ts:161`) is exported from
`packages/core/src/index.ts:110` but **is never called from `heal.ts`**. Only
`runControlledRepairAttempt` runs (`packages/core/src/heal.ts:1020`). The model cannot name a
target file today; the controller owns target choice
(`repair-attempt.ts:180`: "The controller selects exactly one target excerpt. You cannot select
a path or line range.").

## 2. Exactly what the closure contains for the Python case

The stored trace answers this directly. `search-decision` summaries from
`packages/core/src/heal.ts:829-832`:

| Artifact | Closure size | Outcome |
| --- | ---: | --- |
| `python-repair-missing-await.json` | 1 file | gave-up |
| `python-repair-cache-key.json` | 1 file | gave-up |
| `python-repair-type-mismatch.json` | 1 file | gave-up |
| `python-repair-wrong-import.json` | 4 files | fixed |

Recorded diagnosis for `python-repair-missing-await.json`
(`results[0].caseFile.diagnosis`): class `test-assertion`, confidence `0.96`,
`failingCmd` `python3 -B -m unittest discover -s tests -p 'test_*.py'`,
`errorExcerpt` `AssertionError: <coroutine object fetch_name at 0x7ffff6f97950> != 'Ada'`.
Terminal stage note (`results[0].caseFile.stages[-1]`):
`policy failure: No policy-admissible bounded repair source was available`, stage `search`,
node `node-013`. Note that `failureCommand` is now correct, so Finding 1 of
`docs/research/2026-09-05-sutura-repair-quality.md` is fixed at this commit; Finding 2 is not.

I reproduced the failing fixture locally and ran the extractor against the resulting log using
the built `packages/core/dist`:

```
PY refs: [{"path":"tests/test_app.py"}]
JS refs: [{"path":"case.test.js","line":5}]
py groups: []
js groups: [{"sourcePath":"case.test.js","specifier":"./load-name.js",
             "candidates":["load-name.js","load-name.ts","load-name.tsx"]}]
```

Why `app.py` is absent:

- The unittest traceback names only `/workspace/tests/test_app.py` plus interpreter-internal
  files under `/usr/local/lib/python3.13/unittest/`. `SOURCE_PATH_PATTERN`
  (`orchestrate.ts:58`) requires the character before the path to be start-of-input or one of
  `` [\s("'`] ``; an absolute path presents `/` before every internal segment, so interpreter
  paths never match. `/workspace/` is stripped first (`:311`), which is why the repository path
  does match.
- No line number is captured: the pattern wants `path:NNN` or `path(NNN)`, and unittest emits
  `File "tests/test_app.py", line 8`. Hence `{"path":"tests/test_app.py"}` with no `line`.
- `sourceDependencyGroups` for `runtimeId === 'python'` matches only `PYTHON_RELATIVE_IMPORT`
  (`source-context.ts:8`), anchored on `^\s*from\s+(?<dots>\.+)`. The fixture's
  `from app import fetch_name` (`fixture/tests/test_app.py:3`) has no leading dots, so zero
  groups are produced. Same for `from cache import cache_key`
  (`corpus/python-repair-cache-key/fixture/tests/test_cache.py:3`) and `from formatting import
  format_count` (`corpus/python-repair-type-mismatch/fixture/tests/test_formatting.py:3`).
  There is no handler for `import app` either.
- `python-repair-wrong-import` succeeded precisely because its failure is a
  `ModuleNotFoundError` at import time, so the traceback itself names `tests/test_calculator.py`
  **and** `calculator.py`; four files entered the closure with no import following needed.
- The class-keyed fallback list contributes nothing, because `test-assertion` has no entry
  (`orchestrate.ts:73-79`).

For JavaScript the closure is larger but still wrong: `case.test.js` (inadmissible) plus
`load-name.js` (admissible and **not** broken). That is why the JS siblings do not emit the
policy-failure note; they burn branches editing a correct file, matching Finding 2 of
`docs/research/2026-09-05-sutura-repair-quality.md`
("all six or seven branches edited the correct production file and repeated one fingerprint").

## 3. Existing import-following mechanism

It exists and is the natural place to extend.

- `packages/core/src/engine/source-context.ts:100-125` `sourceDependencyGroups`.
- Node specifiers: `NODE_STATIC_SPECIFIER` (`:7`) covers `import`, `export ... from`, dynamic
  `import(...)`, and `require(...)`, **relative only** (`\.{1,2}\/`). Candidate variants in
  `nodeCandidates` (`:34-51`) include TypeScript rewrites of `.js`, `.mjs`, `.cjs`, and
  extensionless / `index.*` resolution.
- Python specifiers: `PYTHON_RELATIVE_IMPORT` (`:8`), relative only, with
  `pythonCandidates` (`:53-64`) producing `<module>.py`, `.pyi`, `__init__.py`, `__init__.pyi`.
- Path safety: `SAFE_DEPENDENCY_PATH` (`:9`) and `safeNormalizedPath` (`:17-26`) reject absolute
  paths and any `..` traversal.
- Consumed only at `packages/core/src/orchestrate.ts:455`.
- `typescriptSourceVariants` (`source-context.ts:28-32`) is reused by the repair tools
  (`repair-tools.ts:133`, `:296`).
- Existing coverage: `packages/core/src/engine/source-context.test.ts:1-81` (5 tests, one of
  which is the Python relative-import case at `:47-64`).

No grep hit for a broader dependency-graph or "closure" abstraction; `closure` appears only in
two strings (`heal.ts:831`, `repair-attempt.ts:196`).

## 4. The admissibility rule and how the class is decided

The rule: `packages/core/src/engine/patch-rules.ts:33-46`.

```
function repairPathViolations(path: string, diagnosis: Diagnosis): string[] {
  const violations: string[] = [];
  if (diagnosis.class !== 'test-bug' && isConventionalTestPath(path)) {
    violations.push(`touches test file: ${path}`);
  }
  if (diagnosis.class !== 'env-config' && TOOL_CONFIG.test(path)) {
    violations.push(`touches tool config: ${path}`);
  }
  return violations;
}
```

`isRepairPathAdmissible` (`:44-46`) is the gate used for target selection; `vetPatch` (`:93-135`)
applies the same `repairPathViolations` to the produced diff (`:113`), so relaxing the target
gate alone would still be caught by the patch vet.

`isConventionalTestPath` (`packages/core/src/diff/unified.ts:39-44`) matches a `tests`/`test`/
`__tests__`/`spec`/`e2e`/`cypress` path segment (`:28`), a `.test.` / `.spec.` infix (`:29`,
`:32-37`), or the Python `test_*.py` / `*_test.py` file convention (`:30`). `tests/test_app.py`
matches on two of the three.

`test-assertion` and `test-bug` are distinct taxonomy entries
(`packages/core/src/taxonomy.ts:36-45` and `:46-54`):

- `test-assertion` notes: "A test completed and its expected value did not match."
- `test-bug` notes: "The code under test or test harness raised an unexpected error."
- `test-bug` signatures are `/\b(?:TypeError|ReferenceError):[^\n]+[\s\S]*\.(?:test|spec)\.[cm]?[jt]sx?:/i`
  and `/\bUnhandled (?:Promise )?Rejection\b/i` (`taxonomy.ts:47-53`). The first hard-codes
  JavaScript test-file naming, so **`test-bug` is mechanically unreachable for any Python
  failure**.

Final class decision: `packages/core/src/diagnose/classify.ts:220-235` returns `{...model, ...}`
and only overrides `failingCmd`, `confidence`, and `signals`. **The class is always the nano
model's class.** The mechanical class (`classifyMechanically`, `:92-106`, best-signature-count
match at `:72-90`) only clamps confidence to `0.49` on disagreement (`:225`) and adds an
`llm:<class>` signal (`:231`).

Corpus labels: `python-repair-missing-await`, `repair-missing-await` and
`repair-missing-await-setup` are all `"class":"test-bug"` in their `metadata.json`.
`python-repair-cache-key` is `"test-assertion"`, `python-repair-type-mismatch` is `"typecheck"`.
The corpus `class` is never fed to the controller; it is only a reporting dimension
(`packages/placebo/src/score.ts:180`), so the corpus labels are ground truth to measure against,
not an input the fix may consume.

The deeper design mismatch worth naming: taxonomy classes describe the **symptom**
("a test completed with a wrong value"), while `patch-rules.ts:35` uses the class to infer
**where the defect lives** ("the test file is the thing to edit"). A missing `await` in a test
produces a `test-assertion` symptom and a test-file defect. Those two axes cannot be collapsed
into one field, which is why every missing-await case in the corpus fails.

## 5. Design options

### Option A — import-graph expansion for absolute module imports (deterministic, no model call)

Fixes `python-repair-cache-key` and `python-repair-type-mismatch`. Does **not** fix any
missing-await case, because the missing file is not the problem there.

Note the brief's framing ("when every referenced path is inadmissible, parse the referenced test
files for imports") is narrower than needed and narrower than what the code already does:
`sourceDependencyGroups` runs unconditionally on every root at
`orchestrate.ts:453-488`, admissible or not, and the JS closure already contains `load-name.js`.
The gap is only the Python specifier grammar, so gate nothing on admissibility — just widen the
grammar.

Change: add absolute-import handling to `dependencySpecifiers`
(`packages/core/src/engine/source-context.ts:66-98`) for `runtimeId === 'python'`:
`from <module>[.<sub>] import ...` and `import <module>[.<sub>][ as x]`, resolved against
(i) the repository root and (ii) the source file's own directory, yielding `<path>.py`,
`<path>.pyi`, `<path>/__init__.py`, `<path>/__init__.pyi` through the existing
`pythonCandidates` shape.

Why this stays safe and deterministic:
- All new candidates pass through `safeNormalizedPath` (`:17-26`), which rejects absolute paths
  and `..` traversal, then through `policyAllowsSourceRead` (`orchestrate.ts:463-465`), the
  bounded read port, and `validateSources` (`:397-445`).
- The existing `matches.length !== 1` rule (`orchestrate.ts:481`) already discards ambiguity, so
  a module name that resolves at two roots contributes nothing rather than guessing.
- Bounds already exist: `MAX_DEPENDENCY_GROUPS = 24`, `MAX_SOURCE_FILES = 8`,
  `MAX_DEPENDENCY_CANDIDATE_PROBES_PER_DEPTH = 192`, depth 2.
- Risk to manage: stdlib and third-party names (`import unittest`, `import os`) become probes.
  Each is one bounded read that returns nothing, but they consume the group and probe budget.
  Mitigate by skipping a stdlib denylist, or by preferring groups whose module name matches a
  repository-root file, or simply by relying on the probe cap. State the choice in the plan.

Files touched: `packages/core/src/engine/source-context.ts` (the only required change),
`packages/core/src/engine/source-context.test.ts`, `packages/core/src/orchestrate.test.ts`.
No CLI or Action change; `packages/action/dist/index.cjs` must be rebuilt and committed in the
same commit (`.claude/rules/ci-parity.md`).

Consider the mirror-image Node gap while you are there: `NODE_STATIC_SPECIFIER`
(`source-context.ts:7`) is relative-only, so a bare workspace-package import
(`import { x } from '@scope/pkg'`) is never followed. Out of scope for these cases; worth an issue.

### Option B — let the model name a target from a repository tree listing

Reverses the controller/model split that `repair-attempt.ts:180` states explicitly, requires a
new tree-listing evidence channel with its own path filtering and size bound, and adds at least
one model turn against a budget of 8 (`REPAIR_ATTEMPT_COSTS.modelTurns = 1`,
`repair-attempt.ts:23-28`; `DEFAULT_REPAIR_BUDGET_LIMITS.modelTurns = 8`). It also does not
remove the `patch-rules.ts:35` refusal, so a model-named test file is still rejected. It fixes
nothing that Option A does not fix more cheaply, and it weakens the determinism claim the trace
and replay bundles rest on. Not recommended.

### Option C — admit test files for class `test-assertion`

This is the only option that addresses the missing-await family, and it is the dangerous one.
Stated plainly so the trade-off is visible:

- `test-assertion` is the single most common diagnosis in the corpus. Admitting test edits for
  it means the model may edit the failing assertion in almost every repair case. The
  cheapest way to make an assertion pass is to change the assertion.
- Defence in depth does exist. `vetPatch` (`patch-rules.ts:93-135`) still rejects deleted test
  files (`:110-112`) and pass-with-no-tests bypasses (`:106-108`); the mechanical audit
  (`packages/core/src/audit/mechanical.ts:143-175`, `:187-195`, `:241-274`) rejects deleted
  tests, skipped tests, and weakened assertions in both JavaScript and Python; Placebo runs an
  unseen hidden test set (`packages/placebo/src/corpus.ts:309-333`), and
  `corpus/python-repair-missing-await/hidden/test_app.py` asserts `await fetch_name() == "Ada"`.
  But `vetPatch` shares `repairPathViolations` with the target gate (`:113`), so a blanket
  relaxation removes the check on both sides at once, and the corpus's deceptive-patch traps
  (`trap-weakened-expect`, `trap-assertion-tautology`, `trap-conditional-assertion-deletion`)
  exist precisely to catch what would newly become reachable. The current run has zero false
  approvals; this option puts that number at risk.
- The README's stated safety claim is behavioural, not a "never edits tests" promise:
  `README.md:49-52` says Sutura "rejects deleted or skipped tests, weakened assertions, relaxed
  compiler or linter settings, ES module syntax added to CommonJS files, and similar green-wash
  fixes". I grepped `README.md` and `.claude/rules/`: there is **no** claim that Sutura never
  edits test files, and no rule file mentions repair-path admissibility at all. So narrowing
  the test-file rule is not a documented-promise violation; it is a defence-in-depth reduction.

Recommended shape if this is pursued (a narrowed variant, call it C'): do not relax the class
check globally. Instead add a bounded, evidence-backed exception that admits a test file only
when all of these hold, and record the exception in the trace:
1. The diagnosed class is `test-assertion` or `test-bug`.
2. Every other file in the closure is either inadmissible or absent, i.e. the test file is the
   only candidate target.
3. The failing test file is the file the traceback's deepest repository frame names.
4. `vetPatch`, the mechanical audit, and the hidden test set all still run unchanged, so a
   weakened assertion or deleted test is still refused.

This keeps the blast radius to exactly the situation that currently ends in
`policy failure: ...`, which today produces zero fixes and therefore cannot regress the fix rate.
Files touched: `packages/core/src/engine/patch-rules.ts` (a new exported predicate that takes
closure context, not just a path), `packages/core/src/engine/repair-attempt.ts:110-111` and
`:150-155`, plus the trace note. Keep `vetPatch`'s path rule keyed to the same predicate so the
target gate and the diff gate cannot drift apart.

### Option D — make the taxonomy able to express "the defect is in the test"

The genuine root cause of the missing-await family. Two sub-options:

- D1 (prompt-level): widen `test-bug`'s signatures and notes in
  `packages/core/src/taxonomy.ts:46-54` so the nano model can distinguish "the test itself is
  wrong" from "the expected value is wrong", e.g. add a Python-shaped signature such as
  `coroutine '...' was never awaited` and a `test_*.py` / `*_test.py` frame signature, and
  rewrite the notes to say *where the defect lives*, not what the symptom looks like. Cheap, one
  file, and it flows into `PUBLIC_TAXONOMY_PROMPT` (`classify.ts:108-130`) automatically. Caveat:
  `bestTaxonomyMatch` (`classify.ts:72-90`) uses strict `>` over `FAILURE_CLASSES` order
  (`taxonomy.ts:10-97`), where `test-assertion` precedes `test-bug`, so one extra matching
  signature will not flip the *mechanical* class; and in any case the final class is the model's
  (`classify.ts:223`). So D1 steers the model but guarantees nothing.
- D2 (structural): stop overloading `Diagnosis.class` for the "where does the defect live"
  question. Add a separate, explicitly-derived signal and key `patch-rules.ts:35` on it.
  Larger change, touches `packages/core/src/domain.ts`, `classify.ts`, `patch-rules.ts`,
  `repair-attempt.ts`, and the replay bundle schema.

### Recommendation

Two independent changes, in this order:

1. **Option A** — Python absolute-import following in `source-context.ts`. Small, deterministic,
   no model call, no safety reduction, and it converts two Python repair cases that currently
   never see their broken file. Do this one first and alone.
2. **Option C' plus D1** for the missing-await family. C' is what actually unblocks the three
   cases; D1 improves the odds that the class is right in the first place and costs one file.
   Do not ship plain Option C.

Which is consistent with the repository's own rules: `.claude/rules/ci-parity.md` requires that
"Product guards (fail-closed checks in `packages/action` and `packages/core`) must be backed by a
fixture captured from a real CI log or real provider response. Every `gave-up` becomes a named
replay test before the next dogfood run." That obliges a named replay/unit test for each of these
three `gave-up` shapes regardless of which option is chosen. `.claude/rules/testing.md` requires
the failing test first. Neither rule nor the README forbids the C' relaxation.

## 6. Tests to update, and fixtures for a deterministic new test

Closure construction:
- `packages/core/src/orchestrate.test.ts` — 1790 lines; the closure block runs roughly
  `:1300-1790`. `FakeRepository` at `:174-240` is the harness: set `repository.sources` (a
  `Map<path, content>`) and assert both `context.sources.map(({path}) => path)` and
  `repository.sourceReads` (which records the exact probe batches). Directly relevant existing
  tests: dependency expansion `:1345-1389`, ambiguity and credential rejection `:1391-1409`,
  already-known variant `:1428-1440`, Python manifest fallbacks `:1587-1606`,
  `'latest'` ordering `:1680-1704`. Option A adds a new probe batch, so any test asserting the
  exact contents of `sourceReads` for a Python case will need updating —
  `:1587-1606` asserts `sourceReads[0].paths` for a Python `dep-upstream-breaking` case.
- `packages/core/src/engine/source-context.test.ts:1-81` — the unit home for Option A. The
  Python relative-import test at `:47-64` shows the expected `candidates` ordering to match.
- `packages/cli/src/heal.test.ts:369-455` — five real-filesystem tests for
  `readLocalSourceContext`, including a Python manifest-fallback test at `:379-395` that builds a
  temp directory with `mkdtemp`/`writeFile`. This is the pattern for an end-to-end Python test.

Admissibility:
- `packages/core/src/engine/patch-rules.test.ts` — `:87-104` is "rejects test edits unless the
  diagnosis is test-bug", the test that Option C/C' changes. Python test-path coverage at `:51`
  (`deletes test file: test_value.py`).
- `packages/core/src/engine/repair-attempt.test.ts:163` and `:493` assert the sibling
  preparation-error messages; there is currently **no** test asserting
  `No policy-admissible bounded repair source was available`. Add one, then invert it.
- `packages/core/src/diagnose/classify.test.ts:15` enumerates the taxonomy classes; D1 touches it.

Fixtures available for a deterministic test of both languages, no model and no network:
- Python, absolute import, production defect:
  `packages/placebo/corpus/python-repair-cache-key/fixture` — `cache.py:1-2`,
  `tests/test_cache.py:1-8` (`from cache import cache_key`), `pyproject.toml`, `uv.lock`.
  `packages/placebo/corpus/python-repair-type-mismatch/fixture` is the identical shape.
- Python, absolute import, test defect: `packages/placebo/corpus/python-repair-missing-await/fixture`
  plus `break.diff` and `hidden/test_app.py`.
- JavaScript, relative import, test defect: `packages/placebo/corpus/repair-missing-await/fixture`
  (`case.test.js`, `load-name.js`) and `repair-missing-await-setup/fixture`
  (`case.test.js`, `session.js`). Neither has a `hidden/` directory, so hidden verification will
  report `not-run` for them even after a fix; worth flagging separately.
- Diagnosis fixtures: `packages/core/src/diagnose/__fixtures__/test-assertion.log` and
  `test-bug.log` already exist for classifier tests.
- A verbatim Python unittest failure log for the extractor test (I reproduced this locally from
  `break.diff`; the container form substitutes `/workspace/` and `/usr/local/lib/python3.13/`):

```
FAIL: test_fetches_name (test_app.AppTest.test_fetches_name)
Traceback (most recent call last):
  File "/usr/local/lib/python3.13/unittest/async_case.py", line 90, in _callTestMethod
    self._callMaybeAsync(method)
  File "/workspace/tests/test_app.py", line 8, in test_fetches_name
    self.assertEqual(fetch_name(), "Ada")
AssertionError: <coroutine object fetch_name at 0x7ffff6f97950> != 'Ada'
```

Two assertions worth pinning in that test, because both are load-bearing and neither is
currently covered: the interpreter-internal `/usr/local/...` path must **not** enter the closure,
and the repository path must be captured **without** a line number (unittest's
`", line 8"` form is not matched by `SOURCE_PATH_PATTERN`).
