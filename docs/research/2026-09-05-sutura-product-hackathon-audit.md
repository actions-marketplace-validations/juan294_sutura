# Sutura product and hackathon audit — 2026-09-05

Assessment of `develop` at `369c972777eea3c80b698db61165f07ba46e6b13`, today's commits, committed measurements, current official event pages, and the public Case Lab. Recommendations are included because the user explicitly requested them. This is an audit and strategy proposal, not an implementation plan, release approval, or prediction of placement. “Neovim” in the request is interpreted as Nebius from the event context.

**Verdict: a credible, focused competition idea with substantial implementation, but the present evidence does not support a winning-product claim.** Sutura's opportunity is independent repair assurance: help a maintainer understand whether a proposed CI fix preserves the intended behavior. The immediate priorities are behavioral correctness, useful repair coverage, and visible proof. Additional sponsor services should improve one of those outcomes.

**The most consequential finding: the flagship recorded repair introduces a regression.**

The public [JavaScript recorded result](https://sutura-case-lab.vercel.app/replay/javascript-repair/), inspected in the browser on September 5, shows an approved change from `Math.floor(items / size) + 1` to `Math.floor(items / size)`. Its explanation cites the passing exact-boundary test. The original fixture uses `Math.ceil(items / size)` ([fixture:1](../../packages/placebo/corpus/repair-off-by-one/fixture/page-count.js#L1)); the break patch introduced the floor-plus-one behavior ([break.diff:5](../../packages/placebo/corpus/repair-off-by-one/break.diff#L5)). The only visible test covers 20 items at 10 per page ([case.test.js:4](../../packages/placebo/corpus/repair-off-by-one/fixture/case.test.js#L4)).

| Input | Original behavior | Approved demo repair |
| --- | ---: | ---: |
| 20 items, 10 per page | 2 | 2 |
| 21 items, 10 per page | 3 | 2 |
| 1 item, 10 per page | 1 | 0 |

These expressions were evaluated locally during this audit. This is a demonstrated semantic regression relative to the original fixture, beyond the displayed check's coverage. It does not change the historical report's stored `falseApprovalCount`; it shows that the report's oracle is incomplete. “Zero observed false approvals under this benchmark” cannot become “Sutura proves the fix is correct.” Preserve the original evidence, add a versioned regression case, and repair the verification gap before promoting this example as success. Simply replacing the recorded diff with the known answer would not establish improved product behavior.

**Hackathon fit and submission requirements.**

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules), read in the browser, specify equal weighting for implementation, design, impact, and idea; technical implementation is the first tie-breaker. Runtime Token Factory inference qualifies. Coding and Agentic Engineering fits Sutura. Submission closes October 30 at 10:00 Pacific; free judging access must last through December 15. Overall and track awards are alternatives; a bonus award can accompany either. Tavily eligibility requires a functional runtime call. City attendance language conflicts with Resources; the rules take precedence. Eligibility and conflicts remain entrant checks, not established by this code audit.

The [overview](https://nebiusglobalaihackathon.devpost.com/) requests a working demo or test build, public licensed source with setup instructions, project description, public YouTube demonstration, and provider feedback. Keep the video below three minutes, explain runtime sponsor use aloud, and document significant in-period changes where applicable.

| Requirement or submission concern | Current assessment | Work to close |
| --- | --- | --- |
| Nebius runtime + NVIDIA model | Implemented and backed by historical live evidence | Bind final evidence to actual returned model IDs and submission release |
| Coding track sandbox use | ConTree execution and branching implemented | Show writing, running, and checking a meaningful repair |
| Source, license, installation | Local MIT license, public repository links, CLI and Action setup exist | Recheck public license detection and clean installation of final artifacts |
| Working demonstration | Public Case Lab opens and offers recorded results; live buttons enable after health loading | Successful fresh dispatch was not tested in this audit; complete final public acceptance |
| Description and video | Qualitative copy and timed script exist | Final evidence, recording, captions, public links and submission assembly remain |
| Sponsor feedback | Draft exists; real contract problems have been observed | Produce reproducible, actionable feedback with measured consequences |
| Availability after October | Current roadmap largely ends at submission | Own uptime, credentials, artifact retention, and bounded judging capacity through December 15 |

Source for existing submission state: [evaluation guide:85](../evaluation/README.md#L85), [submission copy:17](../devpost/sutura-submission.md#L17), and [video script:8](../devpost/sutura-video-script.md#L8). No account registration, participant eligibility, video publication, or final entry status is certified here.

**What today's work accomplished.**

Today's history includes runtime-aware Python commands, Python absolute-import traversal, concurrent executor replay, revised deceptive-candidate scoring, Case Lab public-path fixes, discoverability/about/privacy work, and source-backed reviewer documentation. These improve different things and should be described separately.

| Work | Developer or judging value | Measurement boundary |
| --- | --- | --- |
| Python command handling (`e07bcbb`) | Actual Python reproduction replaces the wrong runtime command | Reflected in the latest benchmark |
| Absolute-import closure (`4268d51`) | Repair context can reach related Python production modules | Landed after benchmark subject; its expected repair gain is unmeasured |
| Rejection score contract (`a8c2af7`) | Counts a supplied deceptive candidate stopped by its own verification | Measurement-definition change, not itself a stronger repair algorithm |
| Concurrent replay (`2c842c0`, `fa56e54`) | Better reproducibility of parallel branch evidence | Remaining cancellation/capacity scheduling limitation is documented |
| Case Lab and discoverability | Public access, clearer explanation, easier discovery | Search presence does not establish developer adoption |
| Evaluation guide and reader trials | Makes implementation and limitations assessable | Reader evaluation is separate from installation and maintainer-benefit evidence |

See [repair-quality evidence:45](../demo/sutura-v0.2.1-repair-quality-evidence.md#L45) and [technical evaluation guide:1](../evaluation/README.md#L1). The roadmap's older headline, early feature freeze, and some completed checkboxes conflict with later evidence. Use dated reports as the assessment baseline; revise the roadmap in the next planning phase rather than treating its internal 9/10 estimates as current scores.

**Measured readiness.**

The latest live benchmark evaluates subject `f5c3056acc96597f1ae11f411a3b9cfe03ba990f`, not the entire current source snapshot. The later candidate matrix uses Action `ce3502d86a32883eac8c7a2adcc9df2c07e12e85`. The public recorded demo still names v0.2.0 Action `a943ded4c734aed75c5c63f2b2dd63a2f44556c2`.

| Measure | Latest recorded result | Interpretation |
| --- | ---: | --- |
| Benchmark denominator | 51 cases / 55 evaluations | Completed; small curated corpus |
| Repair success | 10/18 | Below the 11/18 internal gate; gate passage alone is a modest product target |
| Flake classification | 10/10 | Useful seeded-corpus result; broader reliability unproven |
| Deceptive-patch rejection | 11/11 | Under score contract v3; not a universal safety claim |
| Grounded upstream repair | 2/4 | Weak consistency for the Tavily story |
| Hidden preservation | 1/4, three not run | Incomplete behavioral evidence, not three proven bad patches |
| Trap catches | 18/19 | Different denominator from deceptive-patch rejection |
| Recorded false approvals | 0 | Limited by exercised oracles; pagination finding exposes an additional gap |
| Candidate external matrix | 6/8 | Python repair and policy-refusal outcome fail |

Sources: [latest benchmark index:39](../demo/sutura-v0.2.1-repair-quality-evidence.md#L39), [candidate matrix:1](../demo/sutura-v0.2.1-candidate-matrix.json#L1). Report unsuccessful repairs, refusals and infrastructure failures alongside safety statistics. A refuse-everything baseline is necessary because conservatism alone can score well on false approvals.

**Assessment against the four criteria.**

These are audit judgments, not official scores or estimates of winning probability.

| Criterion | Strength | Main competitive weakness | Strongest next proof |
| --- | --- | --- | --- |
| Technological Implementation | Real controller authority, ConTree branching, Nemotron roles, layered audit | Useful repairs still fail; behavioral checks missed the public regression | Recover current failures and demonstrate challenge checks catching unseen wrong repairs |
| Design | Coherent scope, readable cards, labeled evidence, public result pages | Internal details precede the reviewer decision; historical infrastructure stops dominate two cards | Five outsiders can explain outcome, uncertainty, and next action without coaching |
| Potential Impact | Specific maintainer problem; Action, CLI and reviewable output | No completed independent adoption study or measured review-time benefit | Real installations plus paired maintainer review decisions and times |
| Quality of the Idea | Explicit preservation checks and inspectable refusal evidence | The strongest “green but wrong” claim is not yet convincingly proved by the live product | One failure, two plausible green patches, a discriminating behavioral check |

**Product value and competitive positioning.**

Recommended one-liner: **“Sutura investigates failed CI and proposes a tested repair, with the evidence a developer needs to review it.”**

Thirty-second explanation: “When a GitHub Action fails, Sutura reproduces it, checks for flakiness, and tries bounded repairs in isolated sandboxes. It reruns checks and audits the proposed patch for unsafe shortcuts. The maintainer receives the diff, verification results, and remaining uncertainty—or an explanation of why Sutura could not safely repair it. The maintainer decides whether to merge.”

Primary audience: maintainers of JavaScript, TypeScript and Python repositories on GitHub Actions, especially teams reviewing AI-generated changes. Desired benefit: fewer investigation interruptions and faster, better-informed repair review. Time savings and improved decisions remain hypotheses until measured.

[GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent) already documents ephemeral execution, tests/linters and pull requests. [Devin Autofix](https://docs.devin.ai/product-guides/bot-comment-settings) already handles CI-bot failures. Thus “AI fixes CI in a sandbox” is an established capability. Sutura should compete on explicit, reproducible preservation and refusal evidence. These documentation comparisons do not establish that competitors lack equivalent protections or that Sutura outperforms them.

Keep “verified” tied to named checks. Avoid general correctness claims, measured time savings without a study, competitive superiority without comparison, and presenting log-only audit approval as independently executed repair verification. The latter explicitly reports reduced assurance ([audit-only.ts:131](../../packages/core/src/audit-only.ts#L131), [audit-only.ts:171](../../packages/core/src/audit-only.ts#L171)).

**Current sponsor use: substantive, but several integrations are preparation rather than demonstrated benefit.**

| Component | Actual state | Next useful depth |
| --- | --- | --- |
| Nemotron via Token Factory | Nano/Super/Ultra roles configured and runtime client implemented | Measure role contribution, actual returned models, and failure recovery |
| ConTree | Prepared checkpoints and isolated search/audit branches | Behavioral challenge branch and controlled multi-file repair |
| Tavily | Runtime Search/Extract and grounding validation | Version-specific repair evidence plus successful paired ablations |
| Data Lab | Sanitized data and batch machinery prepared; experiment pending | Blinded quality experiment with a held-out set |
| NVIDIA ATIF / NeMo | Trajectory export and schema validation | Run actual evaluation/profiling and use the findings to improve the product |

Sources: [config.ts:10](../../packages/core/src/config.ts#L10), [search.ts:92](../../packages/core/src/engine/search.ts#L92), [evaluation guide:45](../evaluation/README.md#L45), [ATIF validation:22](../../packages/evaluation/scripts/validate-atif.py#L22).

Two subtle opportunities matter. First, the router selects an explicitly requested profile, then its configured model by role; confidence, context and budget are validated but do not drive adaptive selection ([router.ts:71](../../packages/core/src/llm/router.ts#L71)). Second, the prepared Data Lab task reveals case-kind metadata that deterministically determines its target, and one prompt states that mapping ([datalab.ts:306](../../packages/evaluation/src/datalab.ts#L306)). That can validate integration and instruction following. It cannot prove better repair reasoning. Keep it as a smoke experiment and design a separate blinded experiment for quality claims.

**Recommended ambitious scope, in priority order.**

The following estimates are working-day judgments for a focused implementation and initial evaluation, not commitments. They are options to phase into the remaining calendar, not six simultaneous feature promises.

| Priority | Capability | Why it belongs in Sutura | Stack and proposed acceptance |
| --- | --- | --- | --- |
| P0 first | Close the pagination verification gap | The flagship approved patch demonstrably changes valid behavior | Add versioned boundary/preservation checks, expose the historical limitation, and require the same wrong patch to fail verification before refreshing the demo. Roughly 1–2 days; independent of the broader challenge generator. |
| P0 | Recover correct diagnosis and repair targets | Current class-based admissibility blocks legitimate missing-await/config fixes | Nemotron proposes bounded competing diagnoses; ConTree probes them. Recover existing failures plus held-out analogues without weakening test/config guards. Roughly 4–7 days. |
| P0 | Small coherent multi-file repairs | Single-excerpt proposals cannot complete some dependency migrations | Controller-owned two-file transaction, deterministic lockfile tooling, preserved policy. Pass named cross-file cases and traps. Roughly 4–7 days. |
| P1 flagship | Independent regression challenges | Directly addresses the pagination failure and makes assurance visible | Separate Nemotron challenge role, ConTree execution, full audit; evaluate extra defects caught, valid-test rate, false refusals and added latency. Roughly 7–12 days. |
| P1 supporting | Real Data Lab + NeMo evaluation loop | Makes sponsor tools responsible for demonstrated improvement | Blinded public evidence, repository/family split, ATIF evaluation, paired configurations. Publish failures and retain baseline if no benefit. Roughly 4–7 days. |
| P2 expansion | Independently verify another agent's patch | Gives value to developers who already use a preferred coding agent | Extend current reduced-assurance path with ConTree reproduction and challenge execution. Test real patches from two agent sources with known-good and known-bad controls. Roughly 5–8 days. |
| P2 optimization | Evidence-calibrated Nemotron escalation | Spend strong reasoning where it resolves uncertainty | Compare fixed versus adaptive routing; proposed target is 20% lower inference cost per independently verified repair without material quality loss. Roughly 3–5 days after baseline. |

The diagnosis and two-file constraints are in [patch-rules.ts:33](../../packages/core/src/engine/patch-rules.ts#L33), [classify.ts:220](../../packages/core/src/diagnose/classify.ts#L220), and [repair-attempt.ts:141](../../packages/core/src/engine/repair-attempt.ts#L141). Recovering legitimate edits requires narrow policy and provenance checks; it must not become general permission to weaken tests.

For the flagship challenge, generate tests from the failure, relevant contract and original source with the proposed patch initially withheld. Freeze the challenges, then compare the broken baseline, repair and plausible shortcut in separate branches. Include trusted invariants, reviewed controls and held-out tests: a model-generated test is not an oracle. Some preservation tests should pass both before and after; bug-specific tests should fail on the broken behavior and pass on a legitimate fix. Reject meaningless, flaky or overfitted generated tests. Report cases where assurance remains insufficient.

The existing counterfactual path provides a foundation, but its committed offline experiment omits model adjudication, fresh-image suite rerun and absent policy commands; a missing-await alternative survives while failing hidden checks ([counterfactual.ts:48](../../packages/placebo/src/counterfactual.ts#L48), [architecture:118](../evaluation/architecture.md#L118)). Automatic challenge generation and complete live proof would be real new work. Separate roles still share model-family failure modes; role separation alone does not establish independent correctness.

[Nebius SWE-agent sandboxes](https://docs.tokenfactory.nebius.com/sandboxes/swe-agents) document checkpoint branching and prepared SWE environments. [Data Lab](https://docs.tokenfactory.nebius.com/data-lab/overview) supports dataset and batch workflows. [NVIDIA NeMo evaluation](https://docs.nvidia.com/nemo/agent-toolkit/latest/workflows/evaluate.html) documents ATIF-based custom evaluation. These support the proposed direction; account access, pinned-version compatibility and exact image/model contracts still require implementation preflight.

**Stack additions to defer unless a measured bottleneck justifies them.**

Repository-owned verified failure memory with embeddings/reranking fits the product later, but requires enough verified examples, privacy controls and an ablation. Nebius Serverless Jobs could own long-running verification or evaluation when queueing/recovery is a real need; migrating a working control plane solely for branding is low value. Dedicated inference, NIM, Dynamo, GPU self-hosting, a new orchestrator, generic chat, editor plugins and hardware features add substantial scope without resolving the current evidence gaps. Neovim integration earns no identified benefit under this rubric.

Do not promise hosted Nemotron fine-tuning merely because Data Lab exists: the reviewed [Token Factory fine-tuning catalog](https://docs.tokenfactory.nebius.com/post-training/models) does not list Nemotron. Model-specific structured-output contracts also need verification ([structured output documentation](https://docs.tokenfactory.nebius.com/ai-models-inference/json)).

**Low-effort product improvements with high judging value.**

- Put the maintainer's answer first: failure, proposed change, checks actually executed, remaining uncertainty, and review link. Move full hashes and the search table below that answer ([render.ts:347](../../packages/case-lab/src/render.ts#L347)).
- Present the real patch and rejected alternative together. The existing greenwash case refuses a supplied patch in recorded mode but generates a repair in live mode; those demonstrate different behaviors ([cases.ts:113](../../packages/case-lab/src/cases.ts#L113)).
- Replace outdated featured recordings only after valid new evidence exists; retain historical failures in the benchmark archive. The current Python and upstream cards show infrastructure stops. Live enablement is visible after loading, but no fresh run was dispatched here ([public Case Lab](https://sutura-case-lab.vercel.app/)).
- Label actual recorded results, executable replay, model role versus returned model, and log-only versus execution-backed assurance consistently.
- Correct cost labels. The benchmark's USD 6.38066451 total includes ConTree `cost` values with unconfirmed billing units; the recorded inference component is USD 0.141985. Do not advertise the total as a verified bill or extrapolate it into customer savings ([evidence:41](../demo/sutura-v0.2.1-repair-quality-evidence.md#L41)).
- Finish three independent installation studies and add paired review exercises measuring correct decisions, time and help needed. Start recruitment early once separately authorized; do not wait until October to discover access friction ([participant template:17](../adoption/ws-3-participant-record-template.json#L17)).
- Turn provider issues into strong feedback: exact request/version, expected versus actual behavior, reproducible public-safe example, and developer impact. Sandbox cost units, image availability and proposal variability are grounded topics.

The [hackathon Resources page](https://nebiusglobalaihackathon.devpost.com/resources) offers Token Factory credits, Builders Program support and office hours. Use those to resolve exact model, sandbox, billing and evaluation contracts. Credits are not a reason to run experiments before their design and local gates are ready.

**Proposed use of the remaining calendar.**

There are 55 calendar days from this audit date to October 30. Rebaseline the existing September feature freeze as a candidate checkpoint in the next plan; the user's request explicitly invites ambitious reassessment. Keep the October 21 product freeze and October 29 submission target. This audit does not change existing release gates.

| Window | Outcome | Stop or scope decision |
| --- | --- | --- |
| September 6–14 | Close known behavioral and repair-coverage gaps; prepare maintainer study | No broad paid rerun until each known failure has local regression coverage |
| September 15–27 | Independent challenge verification and coherent judge-facing verdict | Require an unseen wrong-patch catch beyond existing gates; cut optional optimization if this slips |
| September 28–October 8 | Held-out Arena comparison, real Data Lab/NeMo experiment, external-agent verifier if flagship is stable | Start with a fixed diagnostic subset; expand to the roadmap's 100-case target only after compatibility and budget are understood |
| October 9–20 | External maintainer results, product polish, video rehearsal, final claims | Complete final evidence; defer memory, hosting migration and routing if they threaten quality |
| October 21–29 | Freeze, final release/public acceptance, submission | One release evidence chain; complete backup and judging operations handoff |
| October 30–December 15 | Maintain judge access and durable evidence | Reserve capacity and monitor service availability; preserve submitted behavior |

For comparisons, hold case selection, models, budgets and scoring constant. Include single-branch repair, first-green acceptance and full verification; use repository/bug-family holdouts and paired uncertainty estimates. Separate Placebo, unfamiliar repository results, developer studies and infrastructure failures. Publish cost per independently verified repair, repair rate, false approvals, false refusals, abstentions, and latency. Never select a “winner” from noisy tiny-sample differences or tune against the held-out oracle.

Suggested video: 20 seconds for the real developer problem; 65 seconds for a failing case and repair; 40 seconds showing the plausible wrong patch failing an independent check; 25 seconds explaining Nemotron and ConTree plus measured evaluation use; 20 seconds for honest results and maintainer benefit; 5 seconds for human review and product link. Total 2:55. Capture actual product behavior and keep provider-delay cuts visible.

**Scope and reproducibility.**

Official overview, Resources, full Rules and current vendor/competitor documentation were reviewed. The Rules required browser retrieval after the web tool received a JavaScript challenge. Public Case Lab homepage and its recorded JavaScript result were inspected visually and through accessibility text; this was not an incognito acceptance matrix or a fresh end-to-end provider run. Three independent research passes reviewed core/evidence, sponsor opportunities and positioning/adoption, and all completed before synthesis.

Fresh local verification completed sequentially: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, and `pnpm run build` all passed. The six packages report 1,744 passing tests and nine skipped tests; the Placebo suite took approximately 13.8 minutes. These checks validate the existing implementation contracts, not comprehensive repair correctness or fresh provider quality. The pagination expression comparison is an additional direct check performed for this audit. An independent factual review checked the report's core/evidence claims before completion.

No deployments, live repair dispatches, provider spending, outreach, pushes, releases, registrations or Devpost edits were performed. This audit should feed the next reviewed implementation plan; no product code was changed here.
