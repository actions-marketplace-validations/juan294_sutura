# Provider processing, retention, and external-adoption boundaries

Status: WS-3 implementation contract, reviewed 2026-09-04.

Sutura is bring-your-own-key software. GitHub, Nebius Token Factory, Nebius Data
Lab, Nebius ConTree, Tavily, package registries, and GitHub Marketplace are
external systems selected by the repository owner. Sutura does not proxy their
data through maintainer infrastructure.

## Nebius Token Factory inference and Zero Data Retention

Inference requests contain bounded redacted failure context and, only when no
known credential pattern is present, exact editable excerpts. Zero Data Retention
(ZDR) is an account setting. When enabled, chat-completion logs are not collected
for later Data Lab import. Sutura neither changes nor verifies that setting, so
the owner must confirm it before confidential processing.

## Explicit Data Lab datasets and batch outputs

An explicit dataset upload is not an inference log and is not made transient by
ZDR. It deliberately creates a reusable Data Lab dataset; batch inference creates
an operation and output dataset. Sutura requires separate authorization for the
upload and the spend-bearing batch operation. Its public-safe request excludes
source, logs, private paths, repository names, provider URLs, request IDs,
credentials, and arbitrary input keys.

Nebius documents Data Lab processing in EU-North1 (Finland) and acts as a data
processor under the Token Factory Data Processing Agreement. That agreement also
describes sub-processor transfers. The owner controls the imported content and
must decide how long the explicit dataset is retained. After evidence hashes are
recorded, delete the dataset and output dataset when organizational policy no
longer requires them. Sutura does not claim an automatic deletion period.

Official references:

- [Data Lab overview](https://docs.tokenfactory.nebius.com/data-lab/overview)
- [Data Lab chat-completion import and ZDR](https://docs.tokenfactory.nebius.com/data-lab/chat-completions)
- [Data Lab processing location](https://docs.tokenfactory.nebius.com/data-lab/data-processing)
- [Data Lab datasets](https://docs.tokenfactory.nebius.com/data-lab/datasets)
- [Token Factory Data Processing Agreement](https://docs.tokenfactory.nebius.com/legal/dpa)
- [Token Factory sub-processors](https://docs.tokenfactory.nebius.com/legal/subprocessors)

## GitHub, npm, and GitHub Marketplace

The CLI and Action are public artifacts. `sutura init` resolves a release tag to
an exact Action commit and writes that immutable commit into the consumer
workflow. npm receives normal package lookup and download metadata. GitHub stores
workflow definitions, runs, logs, comments, checks, artifacts, branches, and pull
requests under the installing repository's settings.

GitHub Marketplace publishes Action metadata and the release listing. Marketplace
installation does not change Sutura's required repository permissions or move
provider secrets into Sutura infrastructure. The consumer owns GitHub secret and
variable configuration and should retain the exact commit pin.

## External participant records

Participant recruiting and consent are human authorization gates. The study
instrument uses a pseudonymous participant ID and records measured duration,
categorical failures, unclear instructions, manual interventions, exact public
artifact identity, the public repository, target/Sutura run URLs, and check-run URL needed for verification,
and outcome evidence.
Participant names and quotes are absent unless the participant separately grants
permission for the exact attribution. A participant may stop at any time. Keep
an incomplete record as an honest attempted session, but do not pass it to the
terminal three-valid-session finalizer or recruit a replacement beyond the
three-person cap without fresh authorization.

## Threat summary

- Pattern redaction is not secret scanning; ordinary-looking confidential text
  can evade it.
- Explicit Data Lab upload creates retained provider data even with ZDR enabled.
- Provider, GitHub, registry, and Marketplace terms can change independently.
- Public run URLs can reveal sanitized context to anyone.
- Participant attribution can create personal data and requires exact permission.
- Immutable artifact pinning proves identity, not correctness; branch protection
  and human review remain required.
