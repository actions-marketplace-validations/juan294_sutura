# WS-3 Data Lab and external adoption implementation plan

Date: 2026-09-04

Status: Prepared; terminal work blocked at Gates A-D and the WS-4 public-release prerequisite

Research: `docs/research/2026-09-04-ws-3-data-lab-external-adoption.md`

## Objective

Complete WS-3 in its documented order: establish a tested public-safe Data Lab
boundary, prepare and run one bounded batch prompt comparison after authorization,
then prove public-artifact installation, external adoption, and Marketplace use.

## Scope and order

| Phase | Issues in required order | Gate status |
| --- | --- | --- |
| 1 | #83 | none |
| 2 | #85, #88, #86 | batch dispatch is gated; client and dry run are not |
| 3 | #84, #87, #52 | Data Lab upload and batch spend |
| 4 | #92, #98, #93, #89 | participant contact only |
| 5 | #90, #91, #94, #95, #96, #54 | participant sessions |
| 6 | #97, #55 | Marketplace publication |

Implementation is sequential because phases share the Data Lab contracts, evidence
schemas, install identity, and final records. No phase is batch-eligible.

## Design decisions

1. The Data Lab dataset is an allowlisted projection of the public Placebo result.
   It includes only categorical case attributes, bounded numeric observations,
   hashed case identity, a fixed prompt, and the expected outcome. It never copies
   source, logs, paths, trace summaries, provider URLs, request IDs, or arbitrary
   object keys. This creates a stronger boundary than redacting the raw export.
2. Two fixed prompt variants are emitted for every one of the 55 evaluations into
   one 110-row dataset. One model, one completion window, one output-token limit,
   and one operation make the prompt comparison inherit identical inputs and
   limits while minimizing spend.
3. The official Data Lab REST endpoints are wrapped behind an injected fetch
   client. Network mutation requires literal authorization flags. Dry-run request
   construction, hashing, response validation, single-shot status checks,
   recovery intents, and scoring are automated.
4. Data Lab, adoption, and Marketplace evidence use canonical JSON plus SHA-256.
   Incomplete or gated evidence remains explicit and cannot validate as complete.
5. External participants run public npm/release artifacts. The repository supplies
   a pseudonymous record template and validator; participant contact, consent, and
   sessions remain human actions.
6. Marketplace metadata and repository eligibility are automated preflight checks.
   Publication stays manual because GitHub requires the Marketplace agreement,
   category selection, release UI, and 2FA.

## Authorization gates

### Gate A: Data Lab upload (#84)

Cap: exactly 110 sanitized rows, at most 2 KiB canonical JSON per row and 256 KiB
for the complete upload body. The prepared artifacts are 90,158-byte JSONL and a
91,031-byte upload body. Input hash is
`ca456eb2516a33bcf5e8db16e0ce81859ab67219b5a52751ceb26ed0cb3daeaa`; reviewed
request hash is
`b8f2e4dcbf6aecfb3ba17302eda14fa52c1ebd8bee17e721cb5d22e8089713c2`.
No inference spend occurs in this command.

Command, from a clean checkout of integrated `develop`:

```bash
git pull --rebase origin develop
pnpm --filter @sutura/evaluation build
NEBIUS_API_KEY="$NEBIUS_API_KEY" node scripts/datalab-experiment.mjs upload --request docs/datalab/sutura-placebo-v0.2-live-dataset-request-v1.json --request-hash b8f2e4dcbf6aecfb3ba17302eda14fa52c1ebd8bee17e721cb5d22e8089713c2 --record docs/datalab/sutura-placebo-v0.2-live-experiment-record-v1.json --authorization DATA-LAB-UPLOAD-APPROVED
```

Exact approval text Juan must provide:

> I authorize upload of the reviewed 110-row file identified by
> `docs/datalab/sutura-placebo-v0.2-live-dataset-request-v1.json` to Nebius Data
> Lab. I verified request hash
> `b8f2e4dcbf6aecfb3ba17302eda14fa52c1ebd8bee17e721cb5d22e8089713c2`.
> The upload is capped at 110 rows and 256 KiB. I have confirmed the Data Lab
> retention and EU-North1 processing terms for this public-safe dataset.

### Gate B: batch inference spend (#86)

Model: `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`. Completion window: 12h.
Output limit: 64 tokens per row. Hard estimated-spend cap: USD 0.05. The
conservative enforced estimate is USD 0.017418240. With the repository's
2026-08-28 validated pricing snapshot of USD 0.06/M input and USD 0.24/M output
tokens and the dataset byte bound, the conservative expected maximum is below
USD 0.05. Reconfirm those account/model rates immediately before authorization;
the terminal calculated cost is evidence derived from provider usage, not an invoice.

Command after Gate A has produced the experiment record:

```bash
NEBIUS_API_KEY="$NEBIUS_API_KEY" node scripts/datalab-experiment.mjs run-batch --record docs/datalab/sutura-placebo-v0.2-live-experiment-record-v1.json --request docs/datalab/sutura-placebo-v0.2-live-dataset-request-v1.json --model nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B --completion-window 12h --max-output-tokens 64 --max-cost-usd 0.05 --authorization BATCH-INFERENCE-SPEND-APPROVED
```

Exact approval text Juan must provide:

> I authorize one Nebius Data Lab batch-inference operation over the reviewed
> 110-row WS-3 dataset using `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, a 12-hour
> completion window, at most 64 output tokens per row, and a hard estimated-spend
> cap of USD 0.05. Stop without dispatch if the estimate exceeds the cap.

Terminal collection command (read-only provider calls after dispatch):

```bash
NEBIUS_API_KEY="$NEBIUS_API_KEY" node scripts/datalab-experiment.mjs finalize --record docs/datalab/sutura-placebo-v0.2-live-experiment-record-v1.json --request docs/datalab/sutura-placebo-v0.2-live-dataset-request-v1.json --report docs/datalab/sutura-placebo-v0.2-live-batch-report-v1.json
```

Stop condition: do not dispatch a second operation; stop on failed/cancelled status,
identity drift, output hash mismatch, row-count mismatch, or cap failure.

Both mutation commands write a durable intent before contacting Nebius. If an
upload response is ambiguous or remains pending, inspect Data Lab for the exact
deterministic dataset name, then recover without another upload:

```bash
NEBIUS_API_KEY="$NEBIUS_API_KEY" node scripts/datalab-experiment.mjs recover-upload --request docs/datalab/sutura-placebo-v0.2-live-dataset-request-v1.json --record docs/datalab/sutura-placebo-v0.2-live-experiment-record-v1.json --dataset-id <confirmed-dataset-id>
```

If batch dispatch returns ambiguously, inspect Data Lab for the one operation
matching the recorded source/model/time and recover it without dispatching again:

```bash
NEBIUS_API_KEY="$NEBIUS_API_KEY" node scripts/datalab-experiment.mjs recover-batch --record docs/datalab/sutura-placebo-v0.2-live-experiment-record-v1.json --operation-id <confirmed-operation-id>
```

The terminal report hashes the canonical returned rows, calculates cost from the
provider-reported token usage at the documented pricing snapshot, and ranks both
prompt configurations. Latency is shared because both variants run in one batch.

### Gate C: participant recruiting (#89)

Cap: three participants, one session each, no participant is contacted by an
agent, and no attribution is stored without separate explicit permission.

Preparation command:

```bash
node scripts/adoption-study.mjs print-recruitment --kit docs/adoption/ws-3-recruitment-kit.md
```

Exact text Juan sends individually:

> I am evaluating Sutura, an open-source GitHub Action that diagnoses failed CI,
> filters flaky failures, rejects unsafe shortcuts, and proposes reviewed repairs.
> Would you volunteer for one installation session in a repository you know but
> the Sutura builders do not? We will measure setup time, failures, unclear steps,
> manual interventions, and whether the result is useful. Provider calls may incur
> costs paid by the repository owner. Your session record is pseudonymous by
> default. We will quote or name you only if you separately approve the exact
> attribution. Participation is optional and you may stop at any time.

Participant command after the public release exists is printed by the kit. Juan
records each session in a copy of
`docs/adoption/ws-3-participant-record-template.json` and validates all three with:

```bash
node scripts/adoption-study.mjs finalize --candidate "$(git rev-list -n 1 v0.2.1)" --records docs/adoption/records --output docs/adoption/sutura-external-adoption-evidence-v1.json
```

### Gate D: Marketplace publication (#97)

Cap: USD 0.00; publish exactly the already-approved immutable release, with no new
tag and no change to `main` or `develop`.

Preflight and publication entry command:

```bash
node scripts/marketplace-evidence.mjs preflight --candidate "$(git rev-parse origin/develop)"
gh browse action.yml
```

GitHub has no supported `gh` command for the Marketplace checkbox/category/2FA
flow. Juan must select **Draft a release**, check **Publish this Action to the
GitHub Marketplace**, choose primary category **Utilities**, retain the existing
approved release tag, and publish with 2FA.

Exact approval text Juan must provide:

> I authorize publication of the Sutura Action from its already-approved immutable
> GitHub release to GitHub Marketplace under the existing metadata, primary
> category Utilities, with no tag movement and no additional release publication.

Post-publication evidence command:

```bash
node scripts/marketplace-evidence.mjs record-install --candidate "$(git rev-list -n 1 v0.2.1)" --release v0.2.1 --repository <public-repository-url> --run <public-actions-run-url> --output docs/adoption/sutura-marketplace-install-evidence-v1.json --authorization MARKETPLACE-INSTALL-CONFIRMED
node scripts/marketplace-evidence.mjs verify --candidate "$(git rev-list -n 1 v0.2.1)" --release v0.2.1 --listing https://github.com/marketplace/actions/sutura-verified-self-healing-ci --install-evidence docs/adoption/sutura-external-adoption-evidence-v1.json --marketplace-install-evidence docs/adoption/sutura-marketplace-install-evidence-v1.json --output docs/adoption/sutura-marketplace-evidence-v1.json
```

Prerequisite currently blocked in WS-4: public npm `sutura@0.2.1`, Git tag
`v0.2.1`, and its GitHub release do not yet exist. Gate C sessions and Gate D
publication must use that one release commit after WS-4 publishes it.

## Implementation notes and reviewed deviations

- Provider mutations use durable local intents plus explicit read-only recovery
  commands. This is stricter than the initial single-record design and prevents a
  retry from creating a second dataset or billable operation after an ambiguous response.
- Batch dispatch now reads the provider's source dataset and compares its canonical
  content with the reviewed request before any spend. Terminal timestamps use the
  provider's stable operation times so finalization is crash-idempotent.
- Adoption evidence expanded from one run URL to a target run, Sutura workflow run,
  and Sutura check run. The verifier binds the check title/classification and target
  run ID, parses the actual YAML step, and confirms the public npm version and tag
  resolve to the same candidate.
- Marketplace evidence includes a separate human-confirmed installation record and
  resolves `develop`, the release tag, GitHub release, listing, and workflow run from
  public remote sources rather than trusting local refs.
- The total provider usage field is `calculatedCostUsd` because it applies the dated
  pricing snapshot and is not an invoice.

## Integration and issue closure

Each phase uses red-green-refactor, plan-compliance review, a separate
reuse/quality/efficiency pass, and sequential automated verification. Commits are
rebased onto current `develop`, merged into local `develop`, verified at the
integrated commit, and pushed only when the push freeze is inactive. An issue is
closed only after that integrated commit is on `develop`; its comment names the
commit and direct test/evidence. Gated issues remain open with a comment naming
the gate and prepared command.

## Phase files

- `docs/plans/2026-09-04-ws-3-data-lab-external-adoption-phases/phase-1.md`
- `docs/plans/2026-09-04-ws-3-data-lab-external-adoption-phases/phase-2.md`
- `docs/plans/2026-09-04-ws-3-data-lab-external-adoption-phases/phase-3.md`
- `docs/plans/2026-09-04-ws-3-data-lab-external-adoption-phases/phase-4.md`
- `docs/plans/2026-09-04-ws-3-data-lab-external-adoption-phases/phase-5.md`
- `docs/plans/2026-09-04-ws-3-data-lab-external-adoption-phases/phase-6.md`
