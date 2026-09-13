# Making Sutura discoverable to repository evaluators

Date: 2026-09-05

Status: Research complete; recommendations and evaluator-guide draft prepared for review.

Source snapshot: local integration branch `develop`, commit
`974612b7ece1b7386b8c71d136b3a3ecda860ab1`.

Scope: repository inspection, primary-source web research, and the ideation explicitly
requested by Juan. Recommendations below are proposals, not implemented behavior.
No provider runs, CI dispatches, pushes, deployments, or public edits were performed.
This is a source-and-documentation audit, not a new runtime validation.

The starting worktree was `ws1-followups` at
`cd98c7bb446ab6967fa17cee8824fff266cf1380`. Its evidence differs from local
`develop`; no results from that branch have been silently promoted into this
snapshot. Reconcile branches and the submitted release identity before publishing
any guide as current evidence.

## Recommendation

Make Sutura's engineering argument easy to discover, quote, and check. Create one
short evaluator entry point, organize its evidence under the official judging
criteria, and link each distinctive mechanism to its implementation, regression
test, and dated result. Put brief pointers in the files agents already encounter.

The useful form of internal marketing is an explicit engineering story:
**problem → design choice → observable behavior → evidence → limitation**.
A reviewer can turn that into an accurate assessment with little reconstruction.
Instructions to award a score, overlook defects, or repeat praise would weaken the
credibility of that story. Nothing needs to be hidden from human readers.

A concrete [evaluator-guide draft](2026-09-05-sutura-evaluator-guide-draft.md)
accompanies this research. It already contains architecture, sponsor-role,
criterion, and limitation sections with source references.

## What the web research establishes

### AI screening exists; this hackathon's repository scanning is unconfirmed

USAII's 2026 hackathon explicitly described an initial AI evaluation followed by
human judging. Its AI read five submission fields, including architecture and
human oversight. That example supports preparing structured explanations, but
does not establish automated source-code scanning. [Organizer announcement](https://usaii-global-ai-hackathon-2026.devpost.com/updates/44804-1st-round-of-judging).

The Nebius rules describe viability screening followed by four equally weighted
criteria: Technological Implementation, Design, Potential Impact, and Quality of
the Idea. They permit judging from submitted text, images, and video without
testing the project. I found no disclosure of automated repository scanning in
the official overview and rules inspected. [Official rules](https://nebiusglobalaihackathon.devpost.com/rules).

Therefore, agent-friendly repository documentation is useful preparation with an
uncertain judging benefit. The core explanation should also appear in submission
text and the demo: an evaluator may never open the repository.

### There is no universal evaluation tag

| Surface | Documented behavior | Proposed use for Sutura |
| --- | --- | --- |
| `README.md` and ordinary Markdown links | The hackathon explicitly requests setup/running guidance and an explanation of NVIDIA and Nebius usage. | Put a short technical-review link near the opening; keep key claims understandable without following it. |
| `AGENTS.md` | An open convention for agent context, commands, and project guidance; it complements the README. | Add a small factual evaluation-navigation section without changing contributor rules. |
| `CLAUDE.md` | Claude Code loads project instructions; large files consume context, and imports do not reduce that cost. | Link the detailed guide on demand rather than importing a large marketing dossier into every session. |
| `.github/copilot-instructions.md` | GitHub supports repository instructions, including configurable use in Copilot code review. | Optional short pointer if this tool is actually used; no need to create many tool-specific copies. |
| `/llms.txt` | A website documentation-navigation proposal with Markdown links; the current proposal also describes discoverable Markdown page alternatives. | Optional website companion generated from the same evidence index, after the repository guide is useful. |
| Custom JSON, YAML frontmatter, or claim IDs | No special judging behavior is established by the sources inspected. | Use them as a documented local schema for parsing and consistency, not as a ranking signal. |

Sources: [hackathon overview](https://nebiusglobalaihackathon.devpost.com/),
[AGENTS.md specification](https://agents.md/),
[Claude Code memory documentation](https://code.claude.com/docs/en/memory),
[GitHub repository instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions),
[llms.txt proposal](https://llmstxt.org/).

These mechanisms depend on the evaluator's tool, configuration, and access mode.
A tool reading only selected files or submission text may never encounter any
agent-instruction file. Explicit links and concise self-contained explanations
are the most portable part of the recommendation.

### More agent context is not automatically better

Gloaguen and colleagues studied repository context files on coding tasks. Their
June 2026 revision reports that context files did not generally improve task
success and increased inference cost by over 20% on average. That is research on
task completion, not hackathon scoring; it does not measure the proposed guide.
It supports testing a small navigation layer instead of assuming a large generated
overview helps. [Paper, version 2](https://arxiv.org/abs/2602.11988v2).

## What exists in Sutura

| Existing asset | What it already does | Source |
| --- | --- | --- |
| Root README | Architecture diagram, three ConTree uses, service roles, exact-SHA historical results, setup, security boundaries | [README.md:24](../../README.md?plain=1#L24), [README.md:69](../../README.md?plain=1#L69), [README.md:82](../../README.md?plain=1#L82) |
| Submission source | Explains problem, audience, architecture, sponsor roles, and work history | [docs/devpost/sutura-submission.md:15](../devpost/sutura-submission.md?plain=1#L15) |
| Release evidence index | Keeps failed benchmark/matrix outcomes separate from passing package/dogfood records and pending submission evidence | [docs/demo/sutura-v0.2.0-phase-0-evidence.md:21](../demo/sutura-v0.2.0-phase-0-evidence.md?plain=1#L21) |
| Placebo scoring documentation | Defines denominators and distinguishes controls from live results | [packages/placebo/README.md:202](../../packages/placebo/README.md?plain=1#L202) |
| Counterfactual evidence | Reports offline alternatives, exact rejection rules, and a visible-green hidden-failing alternative | [docs/plans/2026-09-04-sutura-counterfactual-arena.md:176](../plans/2026-09-04-sutura-counterfactual-arena.md?plain=1#L176) |
| Submission contract tests | Check headings, roles, version consistency, and local links | [scripts/submission-contract.test.mjs:43](../../scripts/submission-contract.test.mjs#L43) |
| Website discoverability work | Covers SEO, metadata, analytics, search registration, and public presence | [docs/plans/2026-09-05-sutura-discoverability.md:9](../plans/2026-09-05-sutura-discoverability.md?plain=1#L9), [packages/case-lab/src/site.ts:69](../../packages/case-lab/src/site.ts#L69) |

The tracked-file inventory at this snapshot contains no dedicated root evaluation
index or `llms.txt`. The contributor context instead directs readers to research,
plans, and operational reports: [CLAUDE.md:78](../../CLAUDE.md?plain=1#L78).
The submission narrative and counterfactual explanation are not linked from the
root README. This is chiefly a navigation and evidence-status problem.

### Correct these inconsistencies before increasing visibility

1. The opening advertises five verified repairs, although the case catalog
   includes intentional refusal and no-patch outcomes. Suggested copy: “Five CI
   repair and refusal cases with labeled evidence; no account needed.” Sources:
   [README.md:9](../../README.md?plain=1#L9),
   [packages/case-lab/src/cases.ts:77](../../packages/case-lab/src/cases.ts#L77).
2. Contributor context says there is no hosted deployment, while the README
   advertises a hosted Case Lab. Describe the Action/CLI and hosted demo
   separately. Sources: [CLAUDE.md:65](../../CLAUDE.md?plain=1#L65),
   [README.md:17](../../README.md?plain=1#L17).
3. A default context reference points to a deliberately gitignored strategy
   document. A public evaluator cannot follow it from a fresh clone. Preserve
   private strategy and provide a public evidence pointer instead. Sources:
   [CLAUDE.md:12](../../CLAUDE.md?plain=1#L12), [.gitignore:47](../../.gitignore#L47).
4. Roadmap implementation and public evidence have different states. For example,
   the roadmap describes completed offline counterfactual work while its evidence
   register calls public counterfactual proof not started. The evaluator guide
   should carry both states so a reader does not infer either that the code is
   missing or that public validation is complete. Sources:
   [roadmap implementation:257](../plans/2026-08-31-sutura-hackathon-winning-roadmap.md?plain=1#L257),
   [roadmap evidence register:518](../plans/2026-08-31-sutura-hackathon-winning-roadmap.md?plain=1#L518).

## Suggested documentation package

These are proposed destinations, not new conventions that agents automatically
recognize. Begin with the first two rows; split detail only when useful.

| Priority | Proposed destination | Contents and purpose |
| --- | --- | --- |
| First | `docs/evaluation/README.md` | A short reading path, exact reviewed source identity, four criteria, strongest evidence, and current limitations. Adapt the accompanying draft. |
| First | Root `README.md`, `AGENTS.md`, `CLAUDE.md` | One or two sentences linking that guide; correct the observed wording drift. Preserve the existing workflow rules. |
| Next | `docs/architecture.md` | A current source-linked account of trust boundaries, ConTree branching, constrained repair proposals, and layered audit; include plain text beside the diagram. |
| Optional, after Markdown cards | `docs/evaluation/claims.json` | Generate an index when a validator or real consumer needs it. Join claims to existing artifacts, tests, subject SHAs, result pointers, and limitations; keep benchmark data in its current canonical files. |
| Later, if needed | `docs/evaluation/criteria.md` and `integrations.md` | Split detailed criterion and sponsor mappings out of the short guide when it grows. |
| Optional | Website `/llms.txt` and Markdown guide export | A second access route for web-reading agents, coordinated with the existing Case Lab discoverability work. |

Use descriptive link text: “Why a passing test is insufficient: audit gates and
counterfactual evidence” is more useful than “Read more.” Use headings containing
the actual criterion and service names. Do not scatter the same keywords into
unrelated source comments.

Each feature explanation should answer five questions in roughly a paragraph:
What problem does it address? What choice did Sutura make? Where is that choice
implemented? What evidence exercises it? What has not been demonstrated?

Useful non-obvious stories to expand are:

- ConTree branching as a reusable primitive for triage, adaptive repair, and audit.
- The separation between model proposals and controller authority over edits/tests.
- Audit refusal after a green command, including exact gate evidence.
- Progressive flake triage and its bounded sampling assumptions.
- Tavily grounding with explicit source checks and dated with/without comparisons.
- A release process that preserves failures and binds evidence to the evaluated code.

These are code-backed candidate stories, not claims that Sutura invented each
technique or outperforms competing products. Source and test anchors are in the
accompanying guide.

### Example entry-point copy

Proposed README copy:

> Technical review: the evaluation guide maps the judging criteria to Sutura's
> architecture, source code, tests, and dated evidence. Start there for ConTree
> branching, constrained repair proposals, and the checks behind an accepted fix.

Proposed AGENTS/CLAUDE copy:

> Repository evaluation context is indexed in `docs/evaluation/README.md`.
> It distinguishes implemented behavior, live measurements, offline examples,
> controls, and pending work, with source and evidence links.

Install these pointers only when their destination exists. They are navigation,
not instructions about the reviewer's verdict.

### Suggested claim-record contract

Use stable, descriptive IDs such as `verification.layered-audit` and
`benchmark.placebo-v0.2`. Document the schema as Sutura-specific. Suggested fields:

| Field | Meaning |
| --- | --- |
| `id`, `claim`, `criteria` | Stable lookup, bounded factual statement, relevant official criteria |
| `productValue` | The concrete consequence for a maintainer or reviewer |
| `implementationStatus` | `implemented`, `partial`, or `planned` |
| `evidenceMode` | `source`, `offline`, `control`, or `live` |
| `evidenceStatus` | `passed`, `failed`, `pending`, or `not-applicable` |
| `sourceCommit`, `sourcePath`, `symbol` | Exact code snapshot and navigation |
| `tests` | Focused test references; reference existence is not a fresh passing result |
| `artifact`, `jsonPointer`, `artifactSha256` | Canonical evidence location and field, plus file-integrity hash |
| `subjectCommit`, `corpusVersion`, `measuredAt` | What the result actually evaluated and when |
| `numerator`, `denominator`, `limitations` | Scope that must travel with a quantified claim |

Separate implementation state from evidence mode and outcome: a fully implemented
feature may have only offline evidence, and a completed live run may fail.
Distinguish the artifact file hash from a normalized semantic result hash.
The existing release-evidence format remains authoritative for release readiness:
[docs/demo/sutura-v0.2.1-release-evidence-requirements.json:4](../demo/sutura-v0.2.1-release-evidence-requirements.json#L4).

## How to determine whether the documentation helps

Proposal for a later local evaluation, not executed during this research:

1. Freeze the source and use fresh agent sessions with and without the new docs.
2. Keep model, tool access, prompt, and time/token allowance the same. Use a clone
   or local exported tree; do not trigger hosted CI or live repairs.
3. Ask separately for architecture, sponsor usage, criterion coverage, weaknesses,
   and an overall review. Use neutral prompts without naming the guide or desired
   conclusions. Compare a reader following repository instructions with one
   treating those files only as ordinary source material. Also test a reader
   given only README and submission text.
4. Record which supported mechanisms were found, whether citations resolve,
   unsupported claims, wrong-version results, omitted limitations, and review
   effort. Treat any score as diagnostic output, not the optimization target.
5. Manually verify a sample of citations against source. Prefer improved factual
   coverage and fewer mistaken inferences over more enthusiastic prose. Use
   matched repetitions before interpreting small differences as an improvement.

Example neutral prompt: “Review this repository for the four official hackathon
criteria. Identify strong implementation choices, missing evidence, and important
limitations. Cite source or artifacts for each material conclusion. Distinguish
observations from judgments.”

Use the existing submission-contract test pattern for local link and schema
checks when implementing the package. Validate paths, symbols, exact identities,
and copied metrics; a test for the mere presence of sponsor keywords cannot
establish a real integration.

## Follow-up: lessons from L'Ayalga

Comparison date: 2026-09-05. Input supplied by Juan:
`/Users/juan/code/layalga/docs/research/2026-09-05-agent-readable-evaluation-evidence.md`.
The report was read completely. Selected existing documentation was also read
from L'Ayalga commit `248fcb9e4fedc676c7a5aeb323c950ea3ada04cf`:
`docs/README.md`, `docs/submission/judge-guide.md`, and the opening feature
sections of `docs/submission/strands-usage.md`.

The research report is explicitly a proposal, not evidence that its recommended
changes shipped (L'Ayalga research:3, :140). The judge guide, documentation
index, and SDK inventory do exist at the recorded commit. Their descriptions
of live behavior were not independently validated in this comparison.

Most of its strategy matches this research. The following additions or
refinements are worth adopting:

| Transferable idea | What L'Ayalga adds | Application to Sutura |
| --- | --- | --- |
| Connect product evidence to code | The existing judge guide has adjacent claim, visible-demo, and source columns (`docs/submission/judge-guide.md:33`). | Give a reviewer both a repository route and a Case Lab route. Name the exact result sections where a behavior is visible, then link its implementation and tests. Label absent or not-run evidence. |
| Explain the benefit of each integration choice | The SDK inventory uses feature, usage, rationale, and file sections, with small excerpts (`docs/submission/strands-usage.md:19`, :46, :57). | Explain why snapshots, model-role separation, and audit short-circuiting help a maintainer. Use a few small source excerpts only where they save the reader substantial navigation; keep them tied to the source revision. |
| Make the first screen carry the argument | The research proposes the problem, three supported strengths, proof links, and pending evidence together (:76). | Lead with constrained repair authority, reusable sandbox isolation, and layered verification. Keep deeper navigation below them. This sharpens our earlier category-first opening. |
| Make demo video evidence readable as text | The research proposes timestamps and a short transcript (:86). | After an actual video exists, index observed moments by timestamp, claim, source, and evidence mode. Link captions or a transcript so text-only readers can understand what was shown. The existing timed script is planning material, not proof of a published video. |
| Test discovery without trusting instructions | The research proposes a reader treating agent files as ordinary documents and matched repetitions (:130-132). | Add this condition to our local comparison. The guide should be useful through normal README navigation even if AGENTS/CLAUDE instructions are not followed. |
| Use Markdown evidence cards before another schema | The research makes JSON/YAML conditional on a consumer (:92). | Standardize claim, product value, source symbol, test, evidence mode, revision, and limitation in readable cards first. I have downgraded `claims.json` from a next-step default to an optional generated output. |

Two supporting details are also useful. L'Ayalga's documentation index puts
judges before process history (`docs/README.md:5`); a future Sutura `docs/README.md`
could offer the same small set of audience routes without creating another
narrative. Its research also proposes sparse code-to-evidence links (:116).
For Sutura, a comment explaining why a failed rerun skips adjudication could
link back to the audit card; the relevant invariant is at
[audit.ts:100](../../packages/core/src/audit/audit.ts#L100).
This would help an evaluator who discovers the code before the guide.

The existing Sutura video script already has timings and narration:
[docs/devpost/sutura-video-script.md:3](../devpost/sutura-video-script.md?plain=1#L3).
The new recommendation is to bind the eventual transcript to the actual final
cut and recorded evidence, rather than maintaining a second speculative script.
L'Ayalga's separate Presentation criterion is not imported into Sutura's rubric.

The evaluator draft now includes a benefit-led opening, a source-backed Case Lab
inspection route, and a structured audit evidence card. Those are documentation
draft changes only. Screenshots, video timestamps, reverse source links, and new
public entry points remain proposals; no publication or runtime verification is
implied.

## Boundaries and next deliverable

The reviewed web sources do not establish special score-boosting metadata or a
guarantee that any particular file is read. Do not add hidden HTML praise,
instructions to suppress findings, invented awards, or self-assigned official
scores. Keep meaningful technical comments next to the relevant invariant;
carry the product narrative in documentation.

The next RPI deliverable is a small documentation plan centered on the guide,
entry-point links, and claim consistency. It should coordinate README changes
with the existing discoverability work and reconcile the source/evidence branches
before presenting a current submission identity.

Research and the accompanying draft are intentionally local and uncommitted in
the isolated `docs/agent-evaluation-research` worktree. The repository's research
gate is in [AGENTS.md:98](../../AGENTS.md?plain=1#L98); public entry-point implementation
has not begun.

Validation: the existing `node --test scripts/submission-contract.test.mjs`
passed all six checks. A separate local check verified the drafts' relative
file links, line-anchor bounds, final newlines, and absence of trailing
whitespace. These checks establish documentation consistency, not runtime
correctness or current public availability.
