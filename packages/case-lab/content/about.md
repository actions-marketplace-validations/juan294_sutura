AI agents make CI pass. Sutura verifies the fix, filters flaky failures, rejects unsafe shortcuts, and opens an evidence-backed pull request for human review. It reproduces real failures in isolated sandboxes and searches bounded repair checkpoints before an independent audit. It never auto-merges.

This page is the [README](https://github.com/juan294/sutura/blob/main/README.md) of the [Sutura repository](https://github.com/juan294/sutura) in plain text. Every case in the Case Lab is one run of the pipeline described here, with its recorded evidence.

## How it works

1. A GitHub Actions run fails.
2. Sutura reads the exact pull request head SHA and the failed-step log.
3. Nemotron Nano diagnoses the failure.
4. ConTree prepares the dependencies once and snapshots the filesystem.
5. Branching use 1: progressive triage reproduces the failure in a first batch, and the same image runs the next batch when the evidence is mixed.
6. Nemotron Super proposes repairs.
7. Branching use 2: initial checkpoint branches and adaptive beam expansion search the repair proposals from the same image.
8. A deterministic winner is selected.
9. Branching use 3: a clean audit branch reruns the selected patch.
10. Mechanical checks and a Nemotron Ultra review judge the evidence.
11. Approved: an evidence-backed fix pull request and an HTML case file. Rejected: a refusal report.

ConTree branching has three distinct jobs: independent triage reproductions, adaptive repair checkpoint search from immutable parent images, and a clean rerun of the selected patch for adversarial audit. Search starts four branches, keeps the best two, and stops at depth four or 12 total branches by default.

A passing command is necessary, but it is not enough. Sutura also rejects deleted or skipped tests, weakened assertions, relaxed compiler or linter settings, ES module syntax added to CommonJS files, and similar green-wash fixes. [See a refusal](/replay/greenwash-trap/).

Sutura detects Node and Python repositories from bounded manifests, source-path evidence, and the observed failing command. A polyglot repository must set `"runtime": "node"` or `"runtime": "python"` in `.sutura.json`; equal automatic evidence fails closed. The Python runtime is pinned by exact image digest. It accepts only `uv.lock` or exact hash-locked binary requirements, prepares them before source overlay, and runs all project commands without network access.

Every run ends as `fixed`, `flaky-no-patch`, `refused`, `gave-up`, or `infra-stop`. The pull request comment uses a surgical report with Diagnosis, Triage, Procedure, Pathology, and Discharge sections. The full HTML case file is a workflow artifact. [See a flaky classification](/replay/flaky-failure/).

## Runtime roles

| Service | Runtime role |
| --- | --- |
| NVIDIA Nemotron on Nebius Token Factory | Nano classifies the failure, Super proposes repairs, and Ultra audits evidence that static checks cannot judge. |
| Nebius ConTree Sandboxes | Prepares dependencies once, snapshots the filesystem, and runs isolated triage, adaptive search, and audit branches. |
| Tavily | Grounds upstream dependency diagnoses in release and migration sources. It is optional for non-upstream cases and for the benchmark ablation. |

The report identifies the model calls that actually occurred. Cost is reported as **inference cost** from the token ledger. Each entry keeps the abstract Nano, Super, or Ultra role separate from the actual routed provider model ID. It is not presented as total operating cost.

## The five cases

Each case page shows the failed commit and CI evidence, the Nano diagnosis, the ConTree search tree, the Super candidates, the rejected patches and their reasons, the Ultra verdict, the final outcome, the cost, and links to the GitHub evidence. The page is labeled with how its result was produced and whether the outcome matched the expected one.

- [See a JavaScript repair](/replay/javascript-repair/): a real off-by-one bug fails one test. Sutura must repair the code, not the test.
- [See a Python repair](/replay/python-repair/): a Python coroutine is never awaited. Sutura must repair it inside the pinned Python runtime.
- [See a flaky classification](/replay/flaky-failure/): a timing race fails two runs in five. Sutura must classify the flake and refuse to invent a patch.
- [See a refusal](/replay/greenwash-trap/): a fake fix only changes the expected value. Green CI is not enough; Sutura must refuse it.
- [See an upstream incident repair](/replay/upstream-incident/): a CommonJS service breaks on an ESM-only release. Sutura must ground the diagnosis before it repairs.

## Source

Sutura is open source under the MIT license. The [repository](https://github.com/juan294/sutura) holds the GitHub Action, the CLI, the benchmark, and this site. The [README](https://github.com/juan294/sutura/blob/main/README.md) records the benchmark evidence, the security boundary, and the install steps.
