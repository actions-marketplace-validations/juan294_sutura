# Sutura documentation

## For evaluators

- [Technical evaluation guide](evaluation/README.md): the product argument,
  criteria, sponsor roles, evidence status, and limitations.
- [Architecture evidence cards](evaluation/architecture.md): six claims tied to
  implementation symbols, tests, and qualified evidence.
- [Submission source](devpost/sutura-submission.md): the submission narrative and
  existing architecture diagram.

## For users and contributors

- [User guide](user-guide.md): prerequisites, repository setup, activation,
  upgrades, disabling, removal, and troubleshooting.
- [CLI](../packages/cli/README.md): installation, audit, and replay commands.
- [Contributor setup](../README.md?plain=1#L256): prerequisites, build, and local checks.
- [Case Lab](../packages/case-lab/README.md): fixed cases, result modes, and dispatch boundaries.
- [Placebo](../packages/placebo/README.md): benchmark corpus, scoring, and execution.
- [Fleet dogfood metrics](adoption/fleet-dogfood-metrics.md): rebuild daily usage,
  outcome, duration, and cost evidence across multiple repositories.

## Evidence and security

- [Latest completed repair-quality benchmark](demo/sutura-v0.2.1-repair-quality-evidence.md):
  the dated candidate identity and retained failed gates; it is historical
  evidence rather than v0.3.0 release acceptance.
- [Historical release evidence](demo/sutura-v0.2.0-phase-0-evidence.md): benchmark,
  external matrices, and dogfood records for the earlier release.
- [Replay provenance](../packages/case-lab/replay/README.md): deterministic bundles
  and recorded live result fallback.
- [Data boundaries](security/data-boundaries.md), [private repository threat model](security/private-repositories.md),
  and [provider processing](security/provider-processing.md): source, credential,
  and retention boundaries.

## Process history

- [Hackathon roadmap](plans/2026-08-31-sutura-hackathon-winning-roadmap.md): dated
  delivery planning and evidence requirements.
- [Case Lab research](research/2026-09-04-sutura-case-lab.md): the earlier demo
  contracts and control-plane investigation.
