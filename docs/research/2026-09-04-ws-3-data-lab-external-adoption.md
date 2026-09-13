# WS-3 Data Lab and external adoption research

Date: 2026-09-04

Status: Complete

Scope: Evaluation export, current sanitization, Nebius Data Lab and batch inference,
public installation, external-adoption evidence, and GitHub Marketplace publication.

## Workstream contract

WS-3 owns 19 issues in a fixed order: Data Lab issues #83, #85, #88, #86,
#84, #87, and #52, followed by external-adoption issues #92, #98, #93, #89,
#90, #91, #94, #95, #96, #97, #54, and #55
(`docs/plans/2026-09-04-sutura-issue-workstreams.md:137-164`). The named human
authorization gates are Data Lab upload, batch inference spend, Marketplace
publication, and participant recruiting
(`docs/plans/2026-09-04-sutura-issue-workstreams.md:166-168`).

The roadmap accepts the Data Lab portion only with one real public-safe batch
experiment and exact hashes (`docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md:275-303`).
The external-adoption exit requires three external installation records, a useful
result without owner coaching, setup instructions matching released artifacts,
and Marketplace installation with immutable pinning
(`docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md:306-330`).

## Evaluation manifest and export

The evaluation package defines a versioned manifest containing an evaluation ID,
exact Sutura commit, corpus identity and hash, adapter/model/routing/budget
identity, every case and trace, timestamps, and a result hash
(`packages/evaluation/src/schema.ts:3-27`). Manifest creation requires a clean
repository, an exact 40-character commit, and a SHA-256 corpus hash, then sorts
cases and model IDs before hashing (`packages/evaluation/src/manifest.ts:57-87`).

The result hash uses canonical key ordering and normalizes run times, trace
timestamps, and non-null provider request IDs
(`packages/evaluation/src/manifest.ts:20-55`). Validation is allowlist-based and
checks the complete manifest shape, trace sequencing, event shapes, run identity,
tool request/result pairing, terminal outcome, and result hash
(`packages/evaluation/src/validate.ts:47-59`,
`packages/evaluation/src/validate.ts:147-191`,
`packages/evaluation/src/validate.ts:194-243`).

The JSONL exporter validates first, emits one canonical record per case, preserves
unsuccessful cases, and normalizes provider request IDs
(`packages/evaluation/src/jsonl.ts:5-25`). ATIF export emits one ATIF-v1.7
trajectory per case and maps model, tool, lifecycle, search, candidate, audit, and
sandbox events into the public trajectory
(`packages/evaluation/src/atif.ts:29-111`). Existing tests cover clean/exact
identity, full-denominator export, normalized hashes, unsafe trace rejection,
deterministic ATIF, and deterministic JSONL
(`packages/evaluation/src/evaluation.test.ts:65-143`).

The CLI accepts `eval validate` and `eval export` with ATIF or JSONL output
(`packages/cli/src/args.ts:291-326`). It bounds the input at 5 MiB, requires a
regular file, validates before output, uses collision-resistant adjacent ATIF
paths, and publishes outputs with rollback on partial failure
(`packages/cli/src/eval.ts:18-50`, `packages/cli/src/eval.ts:53-127`,
`packages/cli/src/eval.ts:129-157`).

## Current sanitization boundary

Trace events are sanitized when recorded (`packages/core/src/trace/recorder.ts:27-48`).
The trace sanitizer removes normalized private keys including reasoning,
credentials, source, full source, diffs, prompts, responses, and logs; it also
bounds depth, collection width, and string length
(`packages/core/src/trace/sanitize.ts:4-47`). Evaluation validation applies that
sanitizer again and rejects a trace if the result would change
(`packages/evaluation/src/validate.ts:179-183`).

The shared outbound text redactor has a 1 MiB bound and covers private-key blocks,
URL credentials, authorization headers, environment and source credential
assignments, serialized credential fields, and known token prefixes
(`packages/core/src/security/external-text.ts:3-75`). It also exposes recursive
message/JSON redaction and fail-closed handling for editable text
(`packages/core/src/security/external-text.ts:77-113`).

The live Placebo publication path adds exact supplied-secret and macOS/Windows
private-path handling before public-safety validation
(`scripts/placebo-live.mjs:190-258`). This is a separate boundary from the
evaluation JSONL export. The documented boundary states that pattern redaction is
not secret scanning and can miss ordinary-looking secrets
(`docs/security/data-boundaries.md:39-45`).

The current public contract says Data Lab upload is disabled and only a bounded
sanitized JSONL file can be produced for local review and later manual import
(`docs/security/data-boundaries.md:47-53`; `README.md:327-335`).

## Nebius Data Lab and batch inference contract

The current official Data Lab overview describes one workspace for inference
logs, uploaded and filtered datasets, batch inference outputs, and fine-tuning
outputs. It states that inference logs are not collected when Zero Data Retention
is enabled: [Data Lab overview](https://docs.tokenfactory.nebius.com/data-lab/overview).
The chat-completion import documentation says a fully ZDR-covered interval
imports no records, while an explicitly imported dataset can be filtered,
downloaded, or used for batch inference or fine-tuning:
[Import Chat Completions](https://docs.tokenfactory.nebius.com/data-lab/chat-completions).

Official dataset documentation accepts direct JSONL upload, S3-connected JSONL or
Parquet, imported inference logs, and derived datasets. Direct JSONL rows must be
objects: [Data Lab datasets](https://docs.tokenfactory.nebius.com/data-lab/datasets).
The current processing notice states that Nebius acts as data processor and Data
Lab logs, datasets, batch outputs, and training data are processed in EU-North1
(Finland): [Data processing](https://docs.tokenfactory.nebius.com/data-lab/data-processing).

The official OpenAPI contract exposes authenticated `POST /v1/datasets` for an
inline uploaded dataset and returns dataset ID, status, and current version
summary: [Create dataset](https://docs.tokenfactory.nebius.com/api-reference/datasets/create-a-dataset-by-uploading-data).
It exposes authenticated `POST /v1/operations` with `type: batch_inference`, a
model, completion window, source dataset ID/version and mapping, and optional
destination dataset; status is read with `GET /v1/operations/{operation_id}`:
[Run operation](https://docs.tokenfactory.nebius.com/api-reference/datasets/run-operation),
[Get operation](https://docs.tokenfactory.nebius.com/api-reference/datasets/get-operation-info-by-id).

The repository currently documents that ZDR is account-side, Sutura does not
change or verify it, and explicit dataset upload is a different retained Data Lab
object from non-collected inference logs (`docs/security/data-boundaries.md:47-53`).
The repository's last validated Nano pricing snapshot is dated 2026-08-28 and
records USD 0.06/M input tokens and USD 0.24/M output tokens. WS-3 can enforce a
conservative cap from that snapshot, but the account/model rates must be
reconfirmed at the spend gate and the calculated usage cost is not a provider invoice.

## Public install and setup verification

`scripts/test-public-install.mjs` delegates public verification to the shared
install verifier (`scripts/test-public-install.mjs:1-13`). Public mode resolves
the exact `v0.2.1` Action commit from direct and peeled public git refs
(`scripts/install-test-lib.mjs:61-82`), packs only `sutura@0.2.1`, and installs
with lifecycle scripts, audit, and funding calls disabled
(`scripts/install-test-lib.mjs:44-59`, `scripts/install-test-lib.mjs:141-160`).

The verifier uses a fresh temporary consumer, scrubs provider variables, checks
package identity, runtime dependencies, license equality, unsupported/symlink
entries, a 20 MiB bound, tarball and installed-content hashes, the installed
binary's `init`, `doctor`, and version commands, and the exact generated Action
commit (`scripts/install-test-lib.mjs:84-125`,
`scripts/install-test-lib.mjs:153-210`). The evidence schema records package
version/source, both hashes, Action commit, setup duration, and outcome
(`scripts/install-test-lib.mjs:196-205`). Tests prove the public path never uses
`@latest` or a candidate SHA override and fails on a generated Action mismatch
(`scripts/test-public-install.test.mjs:11-96`).

The current publish workflow runs candidate and public install verification,
compares version, Action commit, and installed-content hash, then uploads both
records (`.github/workflows/publish.yml:33-75`). The public release list currently
contains v0.2.0 but not v0.2.1, while the install verifier is pinned to v0.2.1;
the repository's release workflow therefore owns the publication dependency.

## Setup, doctor, and adoption evidence

Generated setup uses the exact resolved release commit and writes a workflow with
`actions: read`, `checks: write`, `contents: write`, and
`pull-requests: write`; provider values are configured through `gh` without
placing values in files or output (`packages/cli/src/setup.ts:42-88`,
`packages/cli/src/setup.ts:139-217`). Doctor requires a regular non-symlink
workflow, checks the direct Action step, its required input expressions, runtime,
`checks: write`, and the existence—not values—of required GitHub secret and
variable names (`packages/cli/src/doctor.ts:39-127`,
`packages/cli/src/doctor.ts:129-192`).

The existing external matrix defines JavaScript repair, flaky, refusal, direct,
and policy/audit cases plus Python repair and refusal cases
(`scripts/test-external-matrix.mjs:15-33`). It validates setup duration, exact
package/Action/demo/fixture identity, provider costs and operations, public links,
false approvals, and the complete eight-case denominator
(`scripts/test-external-matrix.mjs:35-170`). No current versioned artifact records
participant consent, unclear instructions, manual interventions, or attributable
feedback; the historical research describes those external-study fields
(`docs/research/2026-08-28-sutura-two-month-opportunity-research.md:579-588`).

## Marketplace contract

The root Action metadata already declares the Marketplace-facing name,
description, author, Node runtime, executable, and branding
(`action.yml:1-3`, `action.yml:98-108`). The packaged metadata is kept equivalent
apart from the executable path (`packages/action/src/metadata.test.ts:8-44`).

GitHub's current publication requirements are a public repository, one root
`action.yml`/`action.yaml`, and a unique Marketplace name. Publication is performed
as a GitHub release after accepting the Marketplace Developer Agreement, selecting
the Marketplace checkbox and category, and authenticating with 2FA:
[Publishing actions in GitHub Marketplace](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/publish-in-github-marketplace).
Branding supports a Feather icon and one of GitHub's listed colors:
[Metadata syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax#branding).

Marketplace is already a required release-evidence ID
(`scripts/release-evidence.mjs:21-30`). Pending evidence names an authorization
gate, while passed evidence must identify candidate-bound, hashed local or public
run material (`scripts/release-evidence.mjs:114-218`). The v0.2.1 evidence
requirements assign Marketplace evidence to Phase 4 and treat it as required
(`docs/demo/sutura-v0.2.1-release-evidence-requirements.json:4-39`).

## Current evidence state

The existing public evidence index marks external-user and Marketplace evidence
as pending (`docs/demo/sutura-v0.2.0-phase-0-evidence.md:21-35`). The workstream
defines a real sanitized import and batch experiment as the terminal Data Lab
record, three external installation/usability records as the terminal adoption
record, and Marketplace proof as the terminal Marketplace record
(`docs/plans/2026-09-04-sutura-issue-workstreams.md:149-164`).
