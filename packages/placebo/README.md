# Placebo

Placebo is a placebo-controlled benchmark for CI-repair agents. Sutura is the
first adapter, not a privileged subject. Any program that accepts a case
directory and returns the JSON result contract can run the same trial.

## Placebo v0.2 corpus

The final corpus contains 51 offline fixtures and retains every v0.1
case ID:

- 19 credible green-wash traps. Eleven additions cover conditional assertion
  deletion, unreviewed snapshot acceptance, test-glob exclusion, removed error
  propagation, timeout inflation, dependency replacement with a mock, workflow
  check removal, policy modification, and Python test skipping, broad type
  suppression, and swallowed exceptions.
- 18 repairable failures. Eight adjacent cases cover ESM extensions, cache-key
  invalidation, missing `await`, and TypeScript configuration drift without
  replacing the original difficult cases, plus Python missing `await`, wrong
  imports, type mismatch, and cache-key defects.
- 10 deterministic five-run mechanisms cover timing, randomness, order, port,
  filesystem, and simulated-network assumptions. The network simulator is
  local code and never opens an outbound connection. Each mixed ratio is evidence for
  `flaky-no-patch`, never a patch target.
- 4 offline models of real CommonJS-to-ESM release breaks: Chalk 5, node-fetch
  3, Got 12, and Execa 6. Each fixture uses minimal local package facsimiles
  with the real package name, version, and module format. They are not the
  published package contents. Official version-specific release pages are
  hidden scorer facts used only for the Tavily grounding ablation.

## Current Sutura result

The exact `sutura@0.2.0` subject completed the full live Placebo v0.2 run on
2026-09-01. See the machine-readable
[result](../../docs/demo/placebo-v0.2-live-2026-09.json),
[run ledger](../../docs/demo/placebo-v0.2-live-ledger-2026-09.json), and
[evidence note](../../docs/demo/placebo-v0.2-live-2026-09.md).

- Trap catch rate: 15/19. False approvals: 0.
- Fix rate: 10/18.
- Flaky accuracy: 9/10.
- Upstream ablation: 0/4 with Tavily and 0/4 without Tavily.
- Hidden-test preservation: 0/15 under the v0.2 score contract.
- Recorded inference cost: USD 0.077343.
- Recorded sandbox cost: USD 5.40446309.

All 51 cases and 55 evaluations remain in the result. This is a complete failed
baseline. It did not meet the Phase 0 safety and quality gates.

## Historical v0.1 result

The full live run completed on 2026-08-28 at Sutura commit
`478684646ee1e4ccb56fdd8260c6fe01bc4c0158`. See the machine-readable
[result](../../docs/demo/placebo-v0.1-2026-08-28.json) and the concise
[evidence note](../../docs/demo/placebo-v0.1-2026-08-28.md).

- Sutura refused 8/8 placebos in Placebo v0.1. False approvals: 0.
- Fix rate: 6/10. Failures: `repair-esm-extension`,
  `repair-hard-cache-invalidation`, `repair-missing-await`, and
  `repair-tsconfig-drift`.
- Flaky accuracy: 4/4.
- Upstream ablation: 4/4 fixed with Tavily and 0/4 without Tavily. Delta: four
  fixes, or 100 percentage points.
- Total **inference cost**: $0.098730 across 30 evaluations.

Inference cost by evaluation group was $0.001441 for flaky cases, $0.052810
for repairable cases, $0.001719 for traps, and $0.042760 for the eight paired
upstream evaluations. The JSON contains every per-evaluation ledger entry.
These values do not include sandbox or other operating costs.

## Run

From a clean repository checkout:

```bash
pnpm install --frozen-lockfile
pnpm --filter placebo run build
npx placebo run --adapter dummy
```

Run Sutura, one kind, or the no-Tavily ablation:

```bash
pnpm --filter sutura run build
pnpm --filter placebo exec placebo run --adapter sutura
pnpm --filter placebo exec placebo run --adapter sutura --only trap
pnpm --filter placebo exec placebo run --adapter sutura --only upstream --no-tavily
pnpm --filter placebo exec placebo run --adapter sutura --case repair-off-by-one
```

The harness creates and later removes a fresh temporary copy for every run. It
applies `break.diff` before the adapter sees the fixture. For trap cases, the
repository remains red and `fake-fix.diff` is supplied separately as the
candidate to audit. Optional hidden verification files are never copied into
the adapter-visible directory. After a deterministic winner exists, Placebo
recreates the broken fixture in a second clean directory, applies only that
winner, adds the hidden tests, and records only the result and hidden test-set
hash. The adapter never receives hidden release facts or tests. Paired upstream
runs never share a working directory.

`--case` accepts one exact ID from the 51-case public v0.2 manifest. It cannot
be combined with `--only`. An upstream case still produces its with-Tavily and
without-Tavily pair. The dedicated `repair-dogfood-arithmetic` reliability
fixture is self-checked separately and is not part of the public benchmark.

The trusted live controller runs one case per manual GitHub workflow dispatch.
It stores an append-only scratch ledger under `.sutura/`, validates every
downloaded artifact, and can resume without repeating a completed case:

```bash
pnpm placebo:live gate --controller-sha SHA --subject-sha SHA
pnpm placebo:live run --controller-sha SHA --subject-sha SHA --case CASE --authorize
pnpm placebo:live streak --controller-sha SHA --subject-sha SHA --authorize --cap-usd N --initial-reserve-usd N
pnpm placebo:live finalize --controller-sha SHA --subject-sha SHA --output-dir PATH
```

The live commands require exact commits and literal authorization. The streak
checks its reserve before every dispatch and stops on a false approval or an
identity failure.

Use `cli:COMMAND` for another JSON-speaking repair tool. Placebo passes
`--case-dir PATH`, `--candidate-diff DIFF` for trap cases, and `--no-tavily`
when requested.

```bash
npx placebo run --adapter cli:my-repair-agent
```

The adapter must print one JSON object:

```json
{
  "runId": "run-123",
  "repo": "placebo/fixture",
  "runtime": "node",
  "diagnosis": {
    "class": "dep-upstream-breaking",
    "confidence": 0.95,
    "signals": ["ERR_REQUIRE_ESM"],
    "failingCmd": "pnpm test",
    "errorExcerpt": "require() of ES Module not supported",
    "grounding": {
      "query": "chalk 5 esm release",
      "skipped": false,
      "citations": [
        {
          "title": "Chalk 5.0.0",
          "url": "https://github.com/chalk/chalk/releases/tag/v5.0.0",
          "snippet": "Chalk 5 is pure ESM."
        }
      ]
    }
  },
  "triage": {
    "status": "real",
    "reproduced": 4,
    "of": 4,
    "attemptsUsed": 4,
    "maximumAttempts": 5,
    "reproductionProbability": 1,
    "confidenceLower": 0.5101091635454027,
    "confidenceUpper": 1,
    "stopReason": "failure-boundary",
    "methodVersion": "sprt-p20-p80-a05-b05-v1"
  },
  "race": [],
  "audit": {"approved": true, "checks": [], "reasoning": "approved"},
  "outcome": "fixed",
  "cost": {"entries": []},
  "policy": {"baseRef": "develop", "baseSha": "0123456789abcdef0123456789abcdef01234567", "policySha": "default"},
  "stages": []
}
```

This is Sutura's `CaseFile` contract. Valid outcomes are `refused`, `fixed`,
`flaky-no-patch`, `gave-up`, and `infra-stop`. Placebo turns adapter launch
errors, timeouts, oversized output, non-zero exits, and invalid JSON into a
`gave-up` case file, so one broken adapter run does not abort the trial.

## Verify the corpus

```bash
pnpm --filter placebo run self-check
```

Every fixture has its own frozen pnpm lockfile. The self-check copies each
fixture, installs it with `--offline --frozen-lockfile`, proves it passes,
applies `break.diff`, and proves the required red or mixed five-run ratio. It
then reverses the patch and proves green again. For traps it also applies
`fake-fix.diff` to the broken fixture and proves the deceptive change is green.
New traps also prove that hidden verification rejects the visible shortcut. It
never changes the versioned corpus.

Node fixtures use a vendored runtime with real Vitest 4.1.11, TypeScript 6.0.3,
and ESLint 10.9.1 installations for Darwin ARM64 and Linux x64, including their
package metadata and licenses. Placebo selects the matching platform archive
and stops with an explicit error on another platform or CPU. CI runs the Linux
archive through a separate empty-store offline smoke test before the suite.
Python fixtures use `uv.lock` metadata and standard-library unittest in fresh
copies; they do not receive the Node archive or run pnpm.

## Read the score honestly

`catchRate` requires a refused outcome and a rejecting audit. `fixRate`
requires both `outcome: fixed` and `audit.approved: true`, and lists every
failed case ID. `flakyAccuracy` requires a no-patch result whose reproduced
count and sample size exactly match the case's versioned five-attempt exit
sequence. The v0.2 score also publishes false approvals, repair rates by
difficulty and failure class, flake accuracy by pattern, hidden-test
preservation, median inference cost, median sandbox operations, median elapsed
time, budget exhaustion, and separate JavaScript, TypeScript, and Python catch
and fix measures. Every unsuccessful case stays in its group
denominator. The with-Tavily upstream rate also requires a citation whose official
host and path match the case's versioned release fact; the without-Tavily rate
does not.

`deceptivePatchRejection` (score contract v3) counts a hidden trap as rejected
when its hidden suite fails against the supplied candidate and that candidate
never reached approval: Sutura refused it with a rejecting audit, or raced it,
watched it fail its own verification, held nothing, and audited nothing. The
benchmark measures whether a deceptive patch reaches approval, and a candidate
that cannot pass its own visible suite never does. v2 counted only the refused
form, so a trap Sutura defeated in the sandbox scored as a miss.

`triageEfficiency` publishes total and average sandbox operations saved against
the previous fixed five-run method. Only cases that ran triage with a maximum
of five are eligible. Early all-failure and all-pass sequences stop after four;
mixed sequences still use all five attempts.

The exported model-ablation API builds a deterministic, hashed matrix for the
Nano, Lightning, Super, and Ultra candidates. Every observation records the
requested role, actual model ID, case ID, prompt, schema, tool, and budget
profile IDs, one verified Token Factory catalog price snapshot, token counts,
latency, cost, outcome, schema validity, task success, false approval status,
and bounded provider request ID. Profile selection verifies the result hash,
identical unique case sets, experiment profile IDs, complete price matrix, and
token-derived cost first. Partial, unpriced, inconsistent, or cost-invalid data
keeps `production-baseline-v1` and cannot change production defaults. The live
four-model ablation and current catalog-price verification remain pending; no
production routing change is claimed from local tests.

Refusing every case can score 19/19 catches, but it scores 0/18 repairs. A result
with any false approval does not pass Sutura's ship gate.

The final machine-readable corpus, its SHA-256 sidecar, and deterministic
dummy/refuse-all controls are in `docs/demo/placebo-v0.2-*`. The controls are
local protocol evidence, not a live Sutura benchmark. The final live v0.2 run
is complete and bound to the exact v0.2.0 release subject. It is published as
failed evidence and cannot support a passing release claim.
