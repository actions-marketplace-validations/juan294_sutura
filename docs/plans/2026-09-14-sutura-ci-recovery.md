# Reliable CI recovery for agent-driven development

Date: September 14, 2026. Status: planned; implementation has not started.
Source reviewed: `develop` at `31e69ccfaf104741bd89dffe5c09e4af748ab69e`.

## Outcome

Sutura keeps a failed CI incident assigned until the relevant branch is independently observed green, superseded, or blocked with a specific reason. A coding agent forgetting its instructions, disappearing, or claiming success without checking CI must not silently end that responsibility.

The developer keeps using their coding agent and pushing normally. GitHub detects failures independently. An integrated agent can claim responsibility; Sutura waits while that ownership remains valid, then repairs or automatically hands off within the configured limits. The value to measure is completed recovery, unattended failures caught, duplicate work avoided, elapsed time, and total agent/provider usage. Human debugging time is not the assumed baseline.

This is an enhancement to the [verified repair program](2026-09-05-sutura-verified-repair-program.md). It replaces the requirement for human merge review only for the narrow Recover destinations defined below. It adds structured operational state to that program's earlier exclusion of persistent repository memory. Existing verification, benchmark, evidence, release and submission requirements remain in force. Historical status tables in that program are dated evidence, not current release status.

The requested deliverable is a reviewed plan. No workflow, permission, scheduled job, release, remote repository or paid run is changed by preparing it. Implementation uses isolated worktrees, integrates on `develop`, and follows the repository's phase gates. Existing session authorizations remain applicable to their original scope; this document neither revokes them nor silently expands them.

## Verified starting point

Source references below are relative to the repository root and refer to the planning SHA.

| Current implementation | Implication |
| --- | --- |
| `packages/core/src/github/adapter.ts:204` claims with a temporary tag and existing check/comment | Deduplication can strand an abandoned attempt; it is not renewable ownership. |
| `packages/action/src/octokit.ts:27` omits workflow attempt and repository numeric identity | Reruns need distinct observations without resetting incident budgets. |
| `packages/core/src/orchestrate.ts:587` rejects an unknown failing command before its claim | Record the incident before preparation; a parsing failure must remain visible to recovery. |
| `packages/core/src/orchestrate.ts:738` publishes a branch and PR after `fixed` | No existing completion guarantee, branch-green tracking or automatic integration. |
| `packages/core/src/engine/repair-budget.ts:80` keeps reservations in memory | A controller restart or agent handoff needs durable accounting outside an individual search. |
| `packages/cli/src/setup.ts:54` installs only a completed-workflow listener | Add missed-event reconciliation and explicit expected-CI registration. |
| `packages/core/src/verify.ts:55`, `packages/cli/src/verify.ts:68` validate supplied patches against immutable source and selected policy | Reuse this boundary for agent candidates; do not accept agent-supplied green logs. |
| `packages/core/src/verification/runtime.ts:44`, `packages/core/src/policy/schema.ts:48` permit optional challenges and broad defaults | Existing `fixed` cannot authorize Recover. |
| `packages/core/src/challenges/contracts.ts:12` supports a limited set of declared behaviors | Automatic completion starts with narrow qualified targets, not arbitrary repository code. |
| `scripts/fleet-dogfood-metrics.mjs:131`, `:199`, `:242` collect monitor outcomes, infer PR counts and rebuild event files | Persist evidence and correlate actual candidates, branches and CI before claiming recovery or savings. |

## Selected design and trade-offs

| Decision | Selection | Cost or limitation |
| --- | --- | --- |
| Shared memory | A versioned incident journal with authenticated ownership, evidence references and remaining budgets | It coordinates work; it is not conversational memory or a new source of project authority. |
| Durable storage | One dedicated `sutura-state` branch per participating repository | No database/service to operate. Writes consume GitHub API calls and inherit repository visibility. Setup must exclude this branch from CI/deployment triggers. |
| Atomic ownership | GitHub `createCommitOnBranch` with `expectedHeadOid`; incident transition and repository reservation in the same commit | Contention requires bounded retries. A local file or comment is not the lock. |
| Reliable detection | Existing completion events plus a periodic GitHub reconciler and optional agent watch registration | Independent of agent compliance and laptop availability; GitHub schedules are best effort. |
| Agent handoff | One local Claude Code process adapter first; provider-neutral CLI protocol | The Mac must be awake and the adapter authenticated. Other agents can use the protocol, but are not automatically integrated by this release. |
| Completion | Atomic conditional update of the exact candidate work-branch ref and its journal record, both without force | Branches requiring PR-only integration remain in Repair. No merge-queue or production merge feature in this release. |
| Observability | Structured events, existing local fleet collector, aggregate report | No AWS telemetry service, dashboard platform or speculative dollar-savings calculator. |

GitHub documents the prior-head condition for [commit creation](https://docs.github.com/en/graphql/reference/commits#createcommitonbranchinput). Use it for journal transitions. For final branch completion, [atomic reference updates](https://docs.github.com/en/graphql/reference/git#updaterefs) can conditionally advance the work branch and a prebuilt journal commit together. PR creation and provider dispatch remain separate APIs requiring durable intents and reconciliation.

GitHub [scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) can be delayed or dropped. Report observed detection latency and last successful reconciliation; do not promise that every failure is fixed within a guaranteed number of minutes.

### Autonomy and assurance are separate

| Mode | Automatic behavior | Completion boundary |
| --- | --- | --- |
| Verify | Observe CI, coordinate an existing agent, verify its submitted candidate and report evidence | Does not generate patches, dispatch a new repair agent, publish a repair or change a work branch. |
| Repair | Verify plus bounded Sutura generation, one configured fallback and repair PR publication | Does not advance the original branch. Records who still owns completion. Existing installations retain their current behavior until explicitly migrated. |
| Recover | Repair plus eligible work-branch advancement and observation of resulting CI | Only explicit nondeploying destinations and qualified repair targets. Failure to qualify yields a proposal or specific escalation, never relaxed verification. |

No mode is called YOLO. No mode overrides freezes, protected paths, repository rules or budgets. The generic default for a new recovery-enabled installation is Repair; Recover requires explicit policy. A legacy installation receives no added dispatch or integration authority merely by upgrading its Action.

For a failing PR, the recovery destination is its source/work branch. Sutura does not merge the developer's feature PR into its base. For a failing push, the destination is that exact branch if opted in. Names such as `develop` are insufficient evidence of deployment safety. Protected destinations that prohibit direct fast-forward writes remain Repair, with no bypass or automatic rule changes.

## Contracts

### Identity and structured memory

```text
Incident v1:
  id = hash(repositoryNumericId, targetRef, originalFailedSourceSha)
  observations[] = workflowId, runId, runAttempt, jobIds, sourceSha, conclusion
  policy = trustedPolicyCommit, repairPolicyHash, recoveryPolicyHash
  state = observed | owned | candidate-ready | verifying | publication-pending
        | awaiting-ci | handoff-ready | recovered | blocked | superseded
  owner = authenticatedPrincipal, adapterSession, generation, leaseUntil
  limits = incidentDeadline, attemptCounts, durableReservedAndSettledResources
  candidate = origin, sourceSha, diffHash, candidateSha, verificationHash
  publication = operationId, intent, repairPrId, targetSha, observedCiIds
  reasonCode, timestamps, evidenceReferences
```

An incident can contain several failed workflows and reruns for the same source revision. Missing expected CI is a separate observation before a failure exists. A newer branch revision supersedes the old candidate; it does not erase spent resources. Correlation across revisions is explicit, not inferred merely because the same branch later turns green.

The journal contains bounded machine records, not raw logs, source code, hidden contracts, credentials or chat histories. Repository instructions from a trusted commit are packaged as context for the agent. They cannot expand the machine policy. No language-model output can mark its own candidate verified, grant itself permissions or rewrite a contract. Journal writes and session labels distinguish controller-attested adapter provenance from an arbitrary user's claim.

The command transport is authenticated `workflow_dispatch` to the pinned controller workflow. Local CLI commands send a bounded operation envelope; the controller derives principal identity from GitHub's authenticated event actor, validates its allowlist and applies journal transitions with its App installation credential. Only trusted controller jobs write the state branch. A local worker holds no App key and cannot write the journal directly. Status reads are read-only API requests. Heartbeats from local sessions also use this transport; controller-hosted workers renew within their existing job. Dispatches are asynchronous and idempotent by operation ID, not by a claim in the payload. Count command jobs/API calls in the operating budget and report; no hidden assumption of free coordination.

### Policy and budgets

Add a separate, strictly parsed `.sutura-recovery.json` v1. This avoids changing the meaning of legacy `.sutura.json`; both files and their instruction/contract sources are protected from candidate changes. Installation pins a trusted policy commit through controller configuration. The failing checkout never chooses that commit. Policy refresh is a separate configuration operation with a recorded hash.

Required fields: enabled flag, mode, exact repository identity, exact watched/destination refs, expected workflow/check identities, applicable contract-to-repair-target mapping, allowed agent principals, fallback adapter, lease/time/attempt/resource limits, and explicit deployment-safety qualification. An exclusion or freeze wins over every other setting at discovery, dispatch, publication and collection. Personal fleet identities stay in the existing ignored configuration and operational reports, never in public plan examples.

Initial controller defaults, adjustable downward without changing code:

- Five-minute lease, one-minute heartbeat, maximum fifteen-minute continuous ownership. Journal timestamps use fresh GitHub response time; unavailable or inconsistent time stops acquisition/renewal.
- One Sutura search and at most one fallback dispatch per incident. Reserve the fallback verification before starting the fallback. Existing search limits remain upper bounds, not resettable allowances.
- Ninety-minute incident deadline including waits and CI; maximum fifty minutes active work across incumbent, generation, fallback and verification. Expiration produces a reasoned terminal state, with later external resolution recorded separately.
- No provider execution unless a finite manifest supplies per-provider cost or unit ceilings, maximum operation durations, daily repository allowance and lifetime pilot allowance. The shipped configuration starts with zero recovery-specific paid allowance until activation binds an applicable approved manifest.
- Per-repository allocations sum to the fleet pilot ceiling in its private manifest. There is no distributed cross-repository shared-dollar lock in this release. Unknown spend retains the reservation; subscription use is measured as available usage signals, never zero-cost inference or hypothetical cash savings.

### Detection, ownership and fallback

```text
on event or reconcile:
  authenticate event; reload enabled policy and exclusion status
  record source observation before logs, diagnosis or provider execution
  inspect exact watched head and expected checks
  if revision changed: invalidate pending candidate; retain accounting
  if recovered or blocked: reconcile external resolution; do not restart spending
  if valid owner: observe progress; do not launch another worker
  if no owner or expired: atomically acquire next generation + reserve resources
  try bounded Sutura repair, or configured handoff according to mode/attempt history
  verify candidate through existing shared verifier
  publish or complete only through the controller
```

Agent commands are proposed as `sutura incident watch|claim|heartbeat|status|submit|handoff`. `sutura agent run --adapter claude` launches a new managed session; its wrapper watches configured refs, registers observed pushed revisions and maintains heartbeats without model participation. Existing interactive sessions are not silently attached: they can explicitly use the incident protocol, or remain unregistered while GitHub independently watches their CI. The fallback worker does not automatically integrate every running Codex/Claude session. Reruns, not-started workflows, cancellation and infrastructure failure have distinct states and bounded actions.

A candidate producer has no Sutura publication credential. Its expired lease permits takeover even when its machine cannot acknowledge termination; retain worst-case reservations and reject stale submissions. Outstanding non-fenced provider/publication operations still require reconciliation. Only the controller writes repair branches or destinations. An external nonparticipating agent may still push using its own credentials: Sutura cannot lock it out. It observes that advance, cancels obsolete work and records overlap. Mutual exclusion is guaranteed only among cooperating participants and the controller's own operations.

### Recover eligibility

All of these are mandatory, in addition to current verifier gates:

1. Policy explicitly permits this exact repository, work branch and repair target. Deployment qualification covers push, PR, workflow-completion and external integrations. Unknown qualification means ineligible.
2. Source failure is reproduced, changed behavior maps to an applicable trusted contract, required commands exist, every required verification observation passes and exact evidence identities match. An unrelated passing contract, skipped check, unsupported gate or optional-challenge result is insufficient.
3. Initial candidates change at most two explicitly mapped files. Workflow/policy/contracts, instruction files, tests, credentials, authorization, payments, data migrations, dependencies and deployment surfaces are excluded from Recover. Required output guards and contract mapping must cover every changed target; a path match alone is insufficient.
4. The candidate commit has exactly one parent, the still-current failed source commit. Run the configured candidate checks on that exact commit; PR synthetic-merge checks alone cannot substitute. Branch-sensitive workflows that cannot establish equivalent prepublication checks are ineligible.
5. A single controller records publication intent, rechecks policy/ownership/head/checks and atomically updates both refs with `updateRefs`: target `beforeOid=sourceSha`, journal `beforeOid=intentHead`, `force=false` for each. Any intervening journal or target advance rejects both. No rebase, amended candidate, force push or merge API fallback. Preserve repository protection even if it prevents completion.
6. Completion requires the destination to reach the candidate and the configured required CI to pass on the resulting work-branch revision. Missing/red CI is unresolved, even if a repair PR exists or is marked merged.

Recover qualification requires branch rules preventing deletion and force updates on both the watched work branch and journal, while allowing the controller's ordinary fast-forwards. A ref returning to the same SHA after deletion/recreation cannot be detected from its current SHA; do not claim otherwise. The required atomic multi-ref operation must pass live race controls with the actual rules and credentials; there is no weaker REST fallback. Acknowledged disable/policy revocation is a committed journal transition, so an older publication transaction conflicts with it. An operation already committed before disable remains an observed action to reconcile, not something disable reverses.

Use a repository-scoped GitHub App installation token for automated code publication. Prove the exact CI trigger path before enabling Recover: [GitHub token-trigger behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow) can otherwise leave automation waiting for human approval. Never pass publication credentials, privileged caches or hooks into candidate execution.

## Delivery phases

All phases are sequential. They share controller contracts, CLI/Action wiring and the committed Action bundle, so none is batch-eligible. Independent read-only review is appropriate.

| Phase | Deliverable | Depends on | Status |
| --- | --- | --- | --- |
| [1](2026-09-14-sutura-ci-recovery-phases/phase-1.md) | Incident identity, trusted policy, atomic journal and cumulative limits | This plan | Planned |
| [2](2026-09-14-sutura-ci-recovery-phases/phase-2.md) | Independent watchdog, abandoned ownership and preparation recovery | 1 | Planned |
| [3](2026-09-14-sutura-ci-recovery-phases/phase-3.md) | Agent protocol, one automatic fallback and common verification | 2 | Planned |
| [4](2026-09-14-sutura-ci-recovery-phases/phase-4.md) | Durable incident metrics and honest attribution | 3 | Planned |
| [5](2026-09-14-sutura-ci-recovery-phases/phase-5.md) | Exact-candidate completion on eligible work branches | 4 | Planned |
| [6](2026-09-14-sutura-ci-recovery-phases/phase-6.md) | Fault-tested pilot, adoption documentation and release evidence | 5 | Planned |

Planning target: establish observation/coordination in the first implementation week, adapter and metrics in the second, then qualify the narrow Recover pilot. These are sequencing estimates, not commitments to enable unsafe behavior by a date. Metrics start as soon as phase 4 is activated. The submission report states the actual observation window; it cannot claim forty-five days for a feature installed later.

Phase 6 begins with one nondeploying demo repository. At most two already included repositories join in Verify/Repair after setup checks pass; their identities and ceilings belong to the private pilot manifest. No fleetwide Recover rollout is part of this final push. All current exclusions remain enforced. An inaccessible repository is not silently counted installed.

If protection, applicable contracts, adapter confinement or live race controls cannot be demonstrated, ship the completed watchdog/Repair capability and report Recover as unavailable for that destination. Do not add a hosted agent platform or reduce assurance to meet the schedule.

## Evidence of value

Phase 4 records candidate origin, verifier origin, completion actor and final CI outcome separately. Headline counts distinguish `sutura-recovered`, `adapter-recovered`, `verified-external-recovery`, `proposal-only`, `resolved-externally`, `blocked`, `superseded`, `pending`, `ineligible` and `unknown`.

Report all eligible failed incidents in the recovery denominator, with infrastructure stops, missing evidence and unresolved cases visible. Show coverage across observed failures separately. Measure failure-to-green elapsed time, unowned time, stale-owner takeovers, authenticated handoffs, duplicate dispatches, actual agent invocations/tokens where available, inference spend, sandbox units/costs, Actions usage and cost completeness. Do not infer PR creation from monitor success, or saved subscription calls merely from Sutura authorship.

A retrospective pre-rollout comparison is observational and labeled as such. For causal cost/latency evidence, use paired replayable failure fixtures under matched correctness, policy and limits: incumbent agent alone versus Sutura-first with fallback. Keep controlled defects out of daily-use statistics; no deliberate failures in active projects. Negative or inconclusive results are valid findings.

## Completion and review

Implementation follows the repository's red/green testing, independent review, simplify and sequential verification workflow. Every new `gave-up` requires its named replay before another dogfood run. Capture sanitized real log/provider fixtures for product guards. Rebuild and commit Action dist with core/Action changes; run `pnpm run ci:local` before pushing core changes, and monitor the resulting CI. A locally green suite is not a live recovery result.

Planning acceptance: parent plus six phase files, no unresolved design questions, source references, concrete failure controls, automated/manual criteria, dependencies, independent review and clean links/whitespace. [Review record](2026-09-14-sutura-ci-recovery-review.md).

Implementation starts with phase 1 in a subsequent task. Stop after each implementation phase unless the user authorizes continuous execution. Paid/live gates use concrete identities, finite manifests and still-applicable session authority. No additional confirmation is required merely for reversible preparation.
