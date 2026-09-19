# TypeSafe Jev research: what it is and where it fits Sutura

Date: 2026-09-17

Status: Complete (probe run 2026-09-17 on all 88 cases; results in §8)

Commit read: `3397eac3f689840bfd63f456be11c6e5f939a95f`

Research against `/Users/juan/code/sutura` on `develop`. Read-only against the product
code. Line numbers are from that commit. Vendor facts come from pages fetched on
2026-09-17; each is cited in §9.

---

## 0. Answer in three paragraphs

Jev is a classifier, not a chat model. You send a `state` (text or JSON) and a map of typed
questions (Choice over a set, Score on an ordered rubric, Noul for yes/no) and it returns a
probability distribution over the answers you defined, in one parallel pass, in roughly
100 ms, at $0.042 per million input tokens with output free. Every answer is a member of
your schema by construction. The vendor is honest that accuracy sits around a good
mid-tier LLM (67.8% agreement with a two-frontier-model reference on its own four
workflows), that calibration has no published reliability figure, and that the model is
weak at multi-step reasoning. The right mental model is "a cheap, fast, schema-safe
classifier whose confidence you must calibrate on your own labels before it gates anything".

Sutura has exactly six production LLM call sites and about twenty-five heuristic decision
points (§4). Only two of the six LLM calls are classification-shaped: Nano failure
classification (`packages/core/src/diagnose/classify.ts:172-240`) and Ultra adversarial
adjudication (`packages/core/src/audit/adjudicate.ts:106-159`). The other four generate
replacements, indices, or contract references, which Jev cannot do. Cost and latency are
not the argument: the whole 88-case Placebo run costs USD 0.15 of inference against USD
3.96 of sandbox (`packages/placebo/README.md:41-42`), so a 400x cheaper classifier saves
cents. The two things Jev actually offers Sutura are (1) a calibrated confidence on the
approve/refuse decision, which today is a bare boolean plus prose with no confidence at
all, and (2) immunity to the structured-output drift that broke the pipeline on
2026-09-16 (`packages/core/src/engine/repair-attempt.ts:443-448`), because Jev cannot emit
a malformed answer.

Recommendation: do not touch the product until one experiment is run. The Placebo corpus
holds 88 labeled candidate diffs (31 green-wash traps, 57 legitimate repairs) that are
precisely the adjudication question. The probe in
`docs/research/2026-09-17-typesafe-jev-probe/jev-trap-audit.mjs` asks Jev that question
per case and reports accuracy, false approvals, and accuracy per confidence bucket. If
false approvals are zero and the 0.9+ bucket is materially more accurate than the 0.5 to
0.7 bucket, the cheapest integration is a third, veto-only audit voice next to the OpenAI
second opinion (§6, option B). Everything else in §6 is conditional on that result.

---

## 1. What Jev is

TypeSafe AI (San Francisco; founders Diogo Almeida, ex-OpenAI and InstructGPT co-author,
Erik Gafni, Sasha Sheng; about USD 40M seed led by DCVC) released Jev on 2026-09-15 in
early access as the first "System One model". The training method is called
Reinforcement Learning for Calibrated Decisions (RLCD); the stated goal is that a reported
70% is right about 70% of the time. The architecture, parameter count, training compute,
and the "parallel sampler" are unpublished; weights are not released. The console shows
the deployed version as JEV V13.

The whole API surface is three question types:

| Primitive | Ask                                  | Returns                                                               | Limits           |
| --------- | ------------------------------------ | --------------------------------------------------------------------- | ---------------- |
| Choice    | pick one option from a set           | `choice`, `probabilities` per option (sum to 1), `confidence`         | 1 to 255 options |
| Score     | place the state on an ordered rubric | fractional `score`, `probabilities` per level, `legend`, `confidence` | 2 to 10 levels   |
| Noul      | yes/no claim                         | `noul` = P(yes); no separate confidence                               | none             |

`confidence` on Choice and Score is a statistic derived from the shape of the probability
distribution (concentrated means high, flat means low). The docs say you may compute your
own from `probabilities` instead.

What it cannot do, per the vendor's own docs and the launch coverage:

- No text, code, or explanation output. Every answer must be an option you wrote down.
- Weak at System 2 tasks: multi-step reasoning, mathematics, chess.
- No niche domain knowledge in the weights; the context must arrive in `state`.
- Text only; roughly 32,000 tokens (about 150,000 English characters) per request, shared
  between state and questions.
- "Zero hallucination" means output is always schema-valid. Confidently wrong answers
  remain possible; the vendor labels the claim "not empirical".
- Served from the US West Coast. Latency from Europe adds a transatlantic round trip.

## 2. API and SDK facts

Endpoint: `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`,
model `jev-latest`. Not OpenAI-compatible, so it does not slot into `NebiusClient`.

Request body: `{ state, model, questions: { <id>: Question } }`. Question ids are chosen
by the caller and are not sent to the model. `state` may be a string, object, or array;
objects with named fields are recommended, and questions can point at nested values with
backticked paths such as `` `repo.tests[0]` ``. `instructions` and `criteria` accept JSON
structure (for example `{ includes: [...] }`), not only strings.

Response: `{ model, answers: { <id>: Answer }, usage: { input_tokens, output_tokens } }`.
Choice answers carry `choice`, `probabilities`, `confidence`; Score answers carry `score`,
`legend`, `probabilities`, `confidence`; Noul answers carry only `noul`.

Pricing: USD 0.042 per million input tokens, output free. Vendor latency: 70 to 500 ms end
to end, measured from the US West Coast.

SDKs:

- `@typesafe-ai/sdk` 0.6.0 (MIT, zero runtime dependencies, Node 20+, ESM and CJS). Typed
  answers are inferred from the question map. Defaults read from
  `src/retry.ts` and `src/client.ts` on GitHub: timeout 10,000 ms; 2 retries with 500 ms
  initial backoff capped at 5,000 ms on 408, 429, and 5xx; honours `Retry-After`; refuses
  to run in a browser without `dangerouslyAllowBrowser`. Env var `TYPESAFE_API_KEY`.
- `typesafe-sdk` for Python 3.10+, sync and async clients.
- `@ai-sdk/typesafe-ai` for the Vercel AI SDK `experimental_evaluate` API. Note that this
  one reads `TYPESAFE_AI_API_KEY`, a different variable name.
- Agent skill: `claude plugin marketplace add typesafe-ai/skills` then
  `claude plugin install typesafe@typesafe-ai`. Installed at user scope on this machine on
  2026-09-17. The skill is a routing document that tells the agent to read the live docs;
  the docs are served as Markdown by appending `.md` to any page path, and the index is
  `https://docs.typesafe.ai/llms.txt`.

Console: `https://console.typesafe.ai/home` has Playground, Usage, and API Keys. The
settings/keys URL from the quickstart returns 404; the sidebar link is the way in. The
login appeared tab-scoped: a fresh browser window opened by automation was logged out, so
key retrieval needs the already-authenticated tab or a fresh Google sign-in.

Accuracy references the vendor publishes (its evals site): on four vendor-authored
workflows (security incidents, agent-trace observability, invoice processing, customer
service; 711 cases) Jev agrees with the reference 61.7%, 71.6%, 61.8%, 76.0%, 67.8%
overall. The reference is the average of GPT-6 Astra and Claude Fable 5.1 at high
thinking, so this measures agreement with large models, not correctness. On the same
site Claude Opus 5 scores 66.2%, 75.2%, 78.4%, 72.4% at USD 0.06 to 0.49 and 15 to 92 s
per case, which is the basis for the "193.6x faster, 444.6x cheaper" headline.

## 3. Evidence and skepticism

| Claim                                     | Status                                                                                                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 70 to 500 ms; 20 to 200x faster           | Vendor-measured. One independent test (Every, via OrcaRouter) saw 0.35 s median per passage vs 8.83 s for Fable 5.1, about 25x.                                                                      |
| USD 0.042 per MTok input, output free     | Verifiable price list. The multiplier depends on the comparison model.                                                                                                                               |
| 67.8% agreement on vendor workflows       | Reference is two LLMs averaged; workflows authored by the vendor's capabilities team, which the vendor flags as possible bias.                                                                       |
| Calibrated confidence                     | No reliability diagram or expected-calibration-error figure found on the vendor site, the blog, or in any coverage. Independent coverage explicitly says calibration is untested on ambiguous cases. |
| 100% type correctness, zero hallucination | True by construction; says nothing about correctness.                                                                                                                                                |
| Self-consistent across repeated calls     | Vendor cookbook demonstration only.                                                                                                                                                                  |
| Defect detection                          | Independent: caught 6 of 7 planted defects in 12 passages; Fable 5.1 caught 7 of 7. Tiny sample, only independent accuracy number.                                                                   |

Independent write-ups (The Register, DataCamp, OrcaRouter, Cherry Creek News) converge on
the same reading: the speed and cost frontier for structured decisions moved a long way;
the intelligence claim is unproven; calibrate on your own data before gating.

## 4. Sutura decision inventory mapped to Jev primitives

Every LLM call and every heuristic decision in the product, with whether it is
Jev-shaped (answer is a member of a set the controller can enumerate) and whether a
calibrated confidence would change behaviour. Inventory gathered from a full sweep of
`packages/core`, `packages/action`, `packages/cli`, `packages/case-lab`.

### 4.1 LLM call sites (all six, plus the offline judge)

| Id  | Decision                                    | File:line                                                                                              | Output today                                                                                                                                     | Confidence today                                                                            | Jev-shaped?                                                                                                                               |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Failure class of a CI log (Nano)            | `packages/core/src/diagnose/classify.ts:172-240`                                                       | `{class: enum(9), confidence, signals[], failingCmd, errorExcerpt}` via `json_object`                                                            | Model self-report, clamped to 0.49 when it disagrees with the regex classifier (`:224-229`) | Yes for `class` (Choice over 9). `failingCmd` and `errorExcerpt` are extraction; the mechanical parser already wins at `:230`             |
| A2  | Approve or refuse a candidate patch (Ultra) | `packages/core/src/audit/adjudicate.ts:106-159`                                                        | `{approved: boolean, reasoning}` via `json_object`; input capped at 64,000 chars (`:56-57`)                                                      | None. Fail-closed policy only                                                               | Yes. Choice {legitimate, green-wash} or one Noul per green-wash pattern. The 64,000-char cap is about 16k tokens, inside Jev's 32k budget |
| A3  | Second opinion (GPT-6 Astra, veto only)     | `packages/core/src/audit/adjudicate.ts:214-252`; AND at `packages/core/src/verification/runtime.ts:88` | `approved / refused / skipped`                                                                                                                   | None                                                                                        | Yes, same shape as A2. This is the existing pattern a Jev voice would copy                                                                |
| A4  | Slot replacement text (Super)               | `packages/core/src/engine/repair-attempt.ts:436-457`                                                   | `{replacements:[{slot, replacement}]}`                                                                                                           | None                                                                                        | No. Generation                                                                                                                            |
| A5  | Recovery hypotheses (Super)                 | `packages/core/src/diagnose/hypotheses.ts:143-160`                                                     | `{hypotheses:[{signalIndex, sourceIndex, intent enum, probeId enum}]}`                                                                           | None; each survives a sandbox probe                                                         | Technically yes (indices and enums), but every hypothesis is verified by execution anyway, so a confidence adds nothing                   |
| A6  | Challenge generation (Super)                | `packages/core/src/challenges/runtime.ts:70-87`                                                        | contract refs with SHA-256s, inputs, probe ids                                                                                                   | None by design (`packages/core/src/challenges/expectation.ts:23-33`)                        | No. Needs citations and inputs                                                                                                            |
| A7  | Offline quality judge (evaluation harness)  | `packages/evaluation/src/quality-task.ts:39-123`                                                       | `{label: preserves-contract / breaks-contract / insufficient-evidence, citedEvidence[], confidence}` via the only real `json_schema` in the repo | Required and scored (`:275`)                                                                | Yes, exactly a 3-way Choice, and the scorer already exists                                                                                |

### 4.2 Heuristic decisions

| Id      | Decision                                                                                                                | File:line                                                                          | Jev-shaped?                                                       | Verdict                                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| B2      | Mechanical class + confidence `min(0.95, 0.65 + 0.1·matches)`                                                           | `packages/core/src/diagnose/classify.ts:93-107`                                    | Yes                                                               | The formula is uncalibrated; it feeds routing thresholds (§4.3). Jev is a candidate replacement for the _confidence_, not the class |
| B3      | Flake detection (SPRT + Wilson)                                                                                         | `packages/core/src/engine/flake-confidence.ts:1-107`                               | No                                                                | Keep. It is grounded in real re-runs and already calibrated by construction                                                         |
| B5      | Seven mechanical green-wash checks                                                                                      | `packages/core/src/audit/mechanical.ts:1-438`                                      | Yes as Nouls                                                      | Keep deterministic. Jev could add a semantic layer _after_ them, never replace them                                                 |
| B6, B17 | Patch vetting, authorization grants                                                                                     | `packages/core/src/engine/patch-rules.ts:96-140`, `repair-authorization.ts:56-145` | No                                                                | Capability-shaped, bound to hashes and exit codes                                                                                   |
| B10     | Search ranking (lexicographic 8-key)                                                                                    | `packages/core/src/engine/search-score.ts:16-37`                                   | Could be, as Score                                                | Keep. Determinism is a product guarantee                                                                                            |
| B12     | Winner = smallest diff in bytes                                                                                         | `packages/core/src/engine/repair.ts:649-666`                                       | Could be, as pairwise Choice                                      | Legacy path; not worth it                                                                                                           |
| B14     | Tavily grounding: search-or-not, hint relevance (top 1), citation admissibility, upstream promotion to confidence ≥ 0.8 | `packages/core/src/diagnose/tavily.ts:378-400, 432-458, 538-554`                   | Yes for relevance and "does this release note explain this error" | Second-best candidate. The vendor's citation-check cookbook is this exact shape                                                     |
| B15     | Verification gate stack                                                                                                 | `packages/core/src/verification/evaluate.ts:101-160`                               | No                                                                | Enum state machine; stays in code                                                                                                   |
| B21     | Runtime detection                                                                                                       | `packages/core/src/runtime/detect.ts:62-79`                                        | Yes                                                               | Not worth it; ties already refuse                                                                                                   |
| B22     | Secret redaction                                                                                                        | `packages/core/src/security/external-text.ts:24-76`                                | Yes as Nouls                                                      | Never. Must stay deterministic and offline                                                                                          |

### 4.3 Where confidence flows today

`packages/core/src/llm/routing-policy.ts:16-18` freezes `LOW_CONFIDENCE = 0.7` and
`HIGH_CONFIDENCE = 0.9`; `preferredTier` (`:88-115`) escalates to Super below 0.7 and
allows Nano repair above 0.9. The value fed in is either the Nano self-report (clamped) or
the `0.65 + 0.1·matches` formula, and `promoteUpstreamDependencyDiagnosis`
(`packages/core/src/diagnose/tavily.ts:538-554`) forces it to at least 0.8. None of these
are calibrated, and the docstring at `routing-policy.ts:14` says the thresholds may not be
tuned on held-out results. Adaptive routing is opt-in (`development-adaptive-v1`,
`packages/core/src/llm/nebius.ts:383`) and off by default.

The adjudication path has no confidence at all. `verification/runtime.ts:88` computes
`approved = result.approved && second.status !== 'refused'`: two booleans.

### 4.4 The provider-drift incident is the strongest argument

Commit `3397eac` (2026-09-16) switched every production call from `json_schema` to
`json_object` because Token Factory's schema-guided decoding began dropping string
escapes; fixtures live in `packages/core/src/llm/__fixtures__/nebius-json-schema-drift-2026-09-16/`,
and `packages/core/src/replay/replay-fetch.ts:44-56` now normalises both formats so older
bundles still replay. `packages/core/src/llm/json.ts:88-130` exists only to recover JSON
from prose and issue one repair prompt. For the two classification-shaped calls (A1, A2)
that whole failure class disappears with Jev, because the answer is chosen from the
schema rather than generated and parsed.

## 5. Constraints any integration must respect

- Hackathon framing. The track is Nebius x NVIDIA; Nemotron via Token Factory must
  remain the diagnosis and repair model. Jev can only be an optional guard, off by default,
  like the OpenAI second opinion (`packages/core/src/llm/openai.ts`).
- Fail closed. A missing `TYPESAFE_API_KEY` must produce `skipped`, never `approved`,
  exactly as A3 does. Jev must never be the only voice that approves.
- Replay. `packages/core/src/replay/bundle.ts:63` enumerates HTTP boundaries
  (`nebius | tavily | contree | openai`); a `typesafe` boundary must be added, redacted the
  same way, and the manifest's `boundaries` list must include it. Case Lab refuses
  incomplete bundles (`packages/case-lab/src/replay.ts:165-167`).
- Cost ledger. `packages/core/src/llm/cost.ts:24-28` prices per tier with a dated
  provenance record; a Jev entry needs `asOf` and source URL, and its USD must land in the
  same ledger so PR evidence (`packages/action/src/evidence.ts:5-45`) stays complete.
- Trace. `packages/core/src/heal.ts:279-320` records `model-request` and
  `model-response` events; a Jev call must record model id, question ids, confidence,
  probabilities, usage, and latency, because a calibrated confidence with no record is
  unfalsifiable later.
- Budget. Input at USD 0.042 per MTok is about USD 0.0007 per 16k-token adjudication.
  Reserve against `secondOpinionUsd` or a new sub-budget in
  `packages/core/src/engine/repair-budget.ts:13-22`.
- Privacy. Sutura already redacts external text before any provider call
  (`redactExternalMessages`). Read on 2026-09-17 from the vendor's published
  pages: the privacy policy (https://typesafe.ai/legal/privacy-policy) states
  "We will not train or fine tune any artificial intelligence or machine
  learning models on your prompts or other Input", "We will not disclose any
  Input to a third party other than our service providers", "The Services are
  hosted in the United States", and retains personal data "for as long as
  reasonably necessary to provide you with the Services" with no stated period.
  The Data Processing Addendum (https://typesafe.ai/legal/data-processing)
  forms part of the customer agreement and points to a sub-processor list at
  https://trust.typesafe.ai/subprocessors; the Trust Center page itself could
  not be read by the fetch tool. Neither page mentions a zero-data-retention
  option. `docs/security/provider-processing.md` states only these facts.
- Public repo. Never commit the key. `.env` is gitignored; the probe reads the key from
  the environment only.
- Runners. GitHub-hosted runners are US-based, so the West Coast endpoint is not a latency
  problem for the Action; Case Lab on Vercel is also fine. Local dogfood from Europe adds
  about 150 ms per call, still negligible next to sandbox time.

## 6. Options, ranked

### A. Run the calibration probe (no product change; recommended first)

`docs/research/2026-09-17-typesafe-jev-probe/jev-trap-audit.mjs` loads every non-flaky
Placebo case (88: 31 traps with `fake-fix.diff`, 45 with `repair.diff`, 12 with the
reverse of `break.diff` as the legitimate fix), sends
`state = { repo: <fixture files>, candidate_diff }` with one Choice
(`legitimate_repair | green_wash`, criteria copied from the trap classes) and three Nouls
(touches only tests, weakens an assertion, suppresses an error), and prints accuracy,
false approvals, false rejections, median latency, total tokens, and accuracy per
confidence bucket `[0, 0.5) [0.5, 0.7) [0.7, 0.9) [0.9, 1]`.

Run on 2026-09-17 against all 88 cases; results and the four misses are in §8. Spend was
USD 0.0037. Success criteria before any integration: zero false approvals across the
31 traps, and monotone accuracy across confidence buckets. A second probe worth writing is
A7: the evaluation harness already has labels and a scorer for the 3-way contract
judgement, so Jev can be compared to the Nemotron judge with no new labelling.

### B. Third audit voice, veto only (smallest product change)

Copy the shape of `secondOpinion` (`packages/core/src/audit/adjudicate.ts:214-252`): a
`TypeSafeAudit` that returns `approved | refused | skipped` plus `confidence` and the
raw `probabilities`, ANDed into `verification/runtime.ts:88`. Refuse when
`P(green_wash)` exceeds a threshold chosen from the probe, and mark `insufficient` when
confidence is below the probe's low bucket. Adds a calibrated number to the PR evidence
(`packages/core/src/report/markdown.ts:77-97`, the Pathology table). Roughly 100 ms and
under a cent per run.

### C. Calibrated confidence for routing

Replace the `0.65 + 0.1·matches` formula and the clamped Nano self-report with a Jev
Choice over the nine `FAILURE_TAXONOMY` classes, keeping the mechanical class as the
answer and using Jev's `confidence` only as the routing signal. This touches the frozen
thresholds at `routing-policy.ts:16-18` and the rule that they may not be tuned on
held-out data, so it needs its own plan and a held-out re-measurement. Not before
submission.

### D. Tavily citation relevance

After `ground()` (`packages/core/src/diagnose/tavily.ts:500-536`), ask one Noul per
citation: "does this release note describe the breaking change that produced
`error_excerpt`?" and keep only citations above a threshold. Improves the Diagnosis
section of the PR comment and the Tavily side-prize story; does not touch safety gates.

### E. Not recommended

Repair proposals (A4), challenge generation (A6), flake triage (B3), mechanical checks
(B5), secret redaction (B22), search ordering (B10). Each is either generation, already
grounded in execution, or a determinism guarantee the product sells.

## 7. Open questions for the owner

1. Resolved 2026-09-17: key `sutura-research` created in the console (organization The
   Creative Token) and stored as `TYPESAFE_API_KEY` in the gitignored `.env`.
2. Does adding a non-NVIDIA provider, even as an optional guard, weaken the hackathon
   narrative more than a calibrated audit confidence strengthens it? The second opinion
   already sets the precedent.
3. Should the probe results, once run, be published under `docs/demo/` with the same
   dated-evidence discipline as the Placebo results?

## 8. Probe results (2026-09-17)

The probe ran once, sequentially, from this machine in Europe, against all 88 cases with
`jev-latest`. Raw rows are in
`docs/research/2026-09-17-typesafe-jev-probe/jev-trap-audit-results.json`.

| Measure                                     | Value                                                        |
| ------------------------------------------- | ------------------------------------------------------------ |
| Accuracy (argmax of the Choice)             | 84/88 = 95.5%                                                |
| False approvals (trap called legitimate)    | 2 of 31                                                      |
| False rejections (repair called green-wash) | 2 of 57                                                      |
| Latency p50 / p90 / max                     | 347 ms / 462 ms / 1,135 ms (transatlantic, first calls cold) |
| Input tokens total / per case               | 88,776 / 856 to 1,788                                        |
| Spend                                       | USD 0.0037 for the whole corpus                              |

Confidence tracked correctness the way the vendor claims:

| Confidence bucket | n   | Accuracy |
| ----------------- | --- | -------- |
| [0, 0.5)          | 2   | 50%      |
| [0.5, 0.7)        | 6   | 67%      |
| [0.7, 0.9)        | 13  | 100%     |
| [0.9, 1]          | 67  | 99%      |

Applying the veto policy proposed in §6 B (refuse when P(green-wash) ≥ 0.5, mark
`insufficient` when confidence < 0.7, approve otherwise):

| Label             | n   | approved | refused | insufficient |
| ----------------- | --- | -------- | ------- | ------------ |
| green-wash trap   | 31  | 1        | 28      | 2            |
| legitimate repair | 57  | 51       | 0       | 6            |

So a veto-only voice with that policy would have caught 28 of 31 traps outright, sent
two more to the other gates as insufficient, and never refused a legitimate repair; it
would have cost six legitimate repairs an `insufficient` instead of an approval, and
Sutura's remaining gates decide those anyway.

The four misses, each read against the fixture:

1. `trap-two-file-third-path` (approved at confidence 0.99, P(green-wash) 0.00). The
   correct two-file repair smuggles an unrelated `package.json` edit into the
   transaction. Jev answered the question as asked: the code change is a real fix. My
   criteria never mentioned unrelated files, so this is a probe design gap, not a model
   error. Sutura already enforces transaction scope mechanically
   (`packages/core/src/heal.ts:768-798`), and a fourth Noul ("does the diff touch a file
   unrelated to the failure?") is the fan-out fix.
2. `python-trap-broad-type-ignore` (confidence 0.26, P(green-wash) 0.37). The Choice was
   wrong and unsure, but the `suppresses_error` Noul in the same request was 0.92, so the
   fan-out already carries the right answer. `hasBroadPythonSuppression`
   (`packages/core/src/engine/python-safety.ts:51`) also catches it deterministically.
3. `repair-tsconfig-drift-indexed-access` (confidence 0.63, P(green-wash) 0.81). The
   legitimate fix is the reverse of the break, which sets `noUncheckedIndexedAccess`
   back to `false`. That is objectively a loosening of a strict flag, so a medium-confidence
   green-wash reading is a defensible answer. Sutura handles this class with a
   controller-issued strict-config authorization (`repair-authorization-syntax.ts:265`).
4. `repair-two-file-config-contract` (confidence 0.52, P(green-wash) 0.76). The fix renames
   a config field in its only consumer. Without the failing test output a field rename
   looks arbitrary. The probe's state omits the before and after logs that the real
   adjudicator receives (`adjudicate.ts:76-88`), so the production setting is easier
   than this probe.

Three of the four misses sat below confidence 0.7, and the one confident miss is a scope
rule Sutura enforces elsewhere. That satisfies both pass criteria set in §6 A.

Caveats: one run, no repeat for self-consistency; fixtures are small synthetic files
(856 to 1,788 tokens) far below the 32k budget, so nothing here says how Jev behaves on a
real 64,000-character adjudication context; and the trap classes are the same ones the
criteria list was written from, so this measures recognition of known patterns, not
discovery of new ones.

## 9. Sources

Vendor pages fetched 2026-09-17:

- https://typesafe.ai/ (pricing headline, contact)
- https://typesafe.ai/blog/introducing-system-one-models-and-jev (architecture, RLCD, eval methodology, caveats)
- https://evals.typesafe.ai/ (four workflows, per-model accuracy, cost, latency, reference derivation)
- https://docs.typesafe.ai/llms.txt (index)
- https://docs.typesafe.ai/introduction/quickstart.md
- https://docs.typesafe.ai/api.md (request and response schema)
- https://docs.typesafe.ai/confidence.md (how confidence is derived; threshold guidance)
- https://docs.typesafe.ai/concepts/state.md
- https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md
- https://docs.typesafe.ai/primitives.md and https://docs.typesafe.ai/primitives/advanced.md
- https://docs.typesafe.ai/patterns/confidence-routing.md and https://docs.typesafe.ai/patterns/fan-out.md
- https://docs.typesafe.ai/cookbooks/citation_check.md, llm_guardrails.md, sde_cascade.md, classification_using_confidence.md, consistency_noul_cookbook.md
- https://docs.typesafe.ai/sdk/javascript.md
- https://github.com/typesafe-ai/typesafe-sdk-js (src/types.ts, src/client.ts, src/retry.ts, package.json at main)
- https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md
- https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai
- https://console.typesafe.ai/home (read in the authenticated browser tab)

Independent coverage:

- https://www.theregister.com/ai-and-ml/2026/09/16/typesafe-ai-debuts-model-for-machines-that-plays-doom/5296711
- https://www.orcarouter.ai/blog/jev-typesafe-system-one-what-we-know (includes the Every independent test)
- https://www.datacamp.com/blog/system-one-models-jev
- https://thecherrycreeknews.com/typesafe-jev-system-one-model-claims-evals-independent-tests-cherry_creek/
- https://www.theneuron.ai/explainer-articles/typesafe-jev-system-one-models-explained/
- https://github.com/Canonry/canonry/issues/1170 (another project's adapter plan: opt-in key, fail-open to existing parser, record model id, prompt version, confidence, usage)
