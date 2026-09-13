# Sutura data boundaries

Status: v0.2 implementation contract, reviewed against repository behavior on 2026-08-28.

Sutura is a bring-your-own-key tool. It does not proxy repository data through Sutura maintainer infrastructure. Provider terms and account settings still govern data after Sutura sends it.

## Boundary summary

| Destination | Data sent | Network and retention contract |
| --- | --- | --- |
| GitHub | Workflow run metadata, failed-step logs, evidence comments, HTML case files, repair branches, and repair pull requests | The action uses GitHub APIs. Repository and Actions retention settings govern stored comments, branches, pull requests, logs, and artifacts. Sutura never auto-merges. |
| Nebius Token Factory | Bounded, redacted failure logs; diagnosis data; redacted non-editable evidence; and exact editable excerpts only when no known credential pattern is present | Requests go directly from the action with the repository owner's key. Zero Data Retention prevents inference-log collection when the account enables it. Sutura does not change ZDR settings. |
| Nebius Data Lab | An explicit, allowlisted evaluation dataset and batch outputs, only after separate upload and spend authorization | Explicit dataset upload creates a retained Data Lab object even when inference ZDR is enabled. Data Lab processes datasets and batch outputs in EU-North1 (Finland). The repository owner must review the exact input hash and delete the dataset and outputs when they are no longer needed. |
| Tavily | A bounded, redacted error query, public package names and versions, and public release or migration URLs | Tavily is optional. Requests go directly from the action with the repository owner's key. The owner's Tavily plan and provider policy govern retention. |
| Nebius ConTree | A base image reference, dependency-input archive, repository-overlay archive, commands, and bounded command output | Only dependency preparation has outbound networking. Source is absent then. All source-bearing execution is network-disabled. ConTree beta documentation states that untagged, unreferenced images can remain for 180 days. Sutura v0.2 has no image-deletion control. |
| Package registries | Package names, versions, lockfile resolution data, and normal package-manager request metadata | Registry access occurs only from the manifest-only dependency image. Lifecycle scripts are disabled. Sutura refuses `.npmrc`, embedded URL credentials, and Yarn auth fields. Private authenticated registries are unsupported in v0.2. |

## Local CLI and action data

The CLI reads repository configuration and writes the Sutura workflow. Provider secret values are passed to GitHub through standard input during setup. The CLI does not write them into repository files.

The action reads the exact failed GitHub run, checks out its exact head SHA, and keeps provider keys in the action process. It does not copy provider keys, the GitHub token, `.env` files, private keys, credential files, `.npmrc`, Git metadata, installed dependencies, caches, or build output into a repository overlay.

Sutura-owned local outputs are console output, generated configuration, optional sanitized evaluation manifests, one-trajectory ATIF files, and explicit JSONL exports. GitHub-hosted outputs are the evidence comment, HTML case-file artifact, repair branch, and pull request. Sutura has no maintainer-operated telemetry or artifact service.

## Sandbox network sequence

```text
import trusted base image
  -> upload declared dependency manifests only
  -> install with network enabled and lifecycle scripts disabled
  -> overlay the safe repository archive
  -> initialize an exact hook-disabled Git baseline
  -> rebuild required dependencies with network disabled
  -> reproduce, triage, adaptive repair search, and audit with network disabled
```

The dependency archive includes the root package manifest, supported root lockfiles and workspace files, and package manifests selected by declared workspace patterns. It excludes source and installed dependency paths. The overlay rejects symlink destinations, symlink parents, and collisions with preparation-generated paths.

## Redaction limits

Sutura applies one bounded redactor before each Sutura-owned Token Factory or Tavily request, including JSON-repair retries. It covers known authorization headers, environment-style key, token, secret and password assignments, URL credentials, private-key blocks, and known token prefixes. It returns only the sanitized text and match count.

Redaction is not secret scanning. It cannot detect an arbitrary secret stored as ordinary source text. Sutura therefore rejects an editable source excerpt when the redactor would change it, instead of asking a model to edit altered source. Users must still keep secrets out of source control and review every generated patch.

The public `NebiusClient` transport does not promise redaction for arbitrary caller content. The guarantee applies to Sutura-owned orchestration paths.

## Data Lab and ZDR

Sutura prepares a bounded, allowlisted Data Lab request locally. The request uses
opaque case hashes, categorical evaluation attributes, fixed prompt text, bounded
numbers, and expected public outcomes. It does not copy source, logs, trace
summaries, repository names, private paths, provider URLs, request IDs, or
arbitrary input keys. Dataset upload and batch dispatch are separate commands and
each requires a literal authorization token. Tests and dry runs do not contact
Data Lab.

ZDR is an account-side Token Factory inference control. When ZDR is enabled,
Token Factory does not collect chat-completion logs for later Data Lab import.
Sutura does not enable, disable, or verify ZDR automatically. An explicit Data
Lab dataset upload is different: it deliberately creates a dataset object and a
batch operation creates output data. ZDR does not turn those explicit objects
into transient inference requests. Record the exact input and output hashes,
review the account retention terms, and delete the dataset and batch outputs when
they are no longer needed.

Data Lab documentation states that its logs, datasets, batch outputs, and training
data are processed in EU-North1 (Finland), with Nebius acting as data processor
under its Data Processing Agreement. Dataset IDs, versions, operation IDs, model,
limits, hashes, latency, cost, and aggregate quality may be published as evidence;
provider credentials and raw authorization responses must not be published.

Official references: [Token Factory quickstart](https://docs.tokenfactory.nebius.com/quickstart), [ConTree overview](https://docs.tokenfactory.nebius.com/sandboxes/overview), [Data Lab overview](https://docs.tokenfactory.nebius.com/data-lab/overview), and [Tavily API reference](https://docs.tavily.com/documentation/api-reference/endpoint/usage).
