# Phase 3: Shared agent protocol and one automatic fallback

Parent: [CI recovery plan](../2026-09-14-sutura-ci-recovery.md). Depends on: phase 2. Status: planned.

## Changes

Add `packages/core/src/recovery/{handoff,agent-envelope}.ts` and `packages/cli/src/{incident,agent-worker,claude-adapter}.ts` with focused tests. Wire CLI args/help/exports and reuse `packages/cli/src/verify.ts`, `packages/core/src/verification/external.ts` and the Action verification route. Add a proposed `scripts/install-recovery-worker.mjs` and `docs/adoption/agent-recovery.md`.

Implement `sutura incident watch|claim|heartbeat|status|submit|handoff`, with JSON output and stable reason codes. Use phase 1's authenticated workflow dispatch transport, bounded operation IDs and asynchronous result polling; session/generation fields alone grant no authority. No new HTTP controller service is implied. Status is a read-only journal/API request. Cap transport retries and count dispatch/heartbeat Actions overhead.

Use one structured dispatch input read from the GitHub event JSON file, never interpolated into shell. Limit the full envelope to 60 KiB. For this adapter's first release, `submit` carries at most 24 KiB of base64-encoded diff input bytes plus identity/metadata; decode once and validate/hash the exact bytes in the controller. Reject sensitive content before dispatch rather than altering a candidate during redaction. The trusted job creates the bounded verification artifact in the same repository; the journal retains only hashes/IDs. Do not fetch arbitrary worker-supplied URLs or assume the local CLI can upload an Actions artifact directly. Candidate diffs exceeding this transport cap yield a named limit result even if the underlying verifier supports larger patches.

Add the explicit entrypoint `sutura agent run --adapter claude` for a new managed incumbent session. Its trusted wrapper observes configured remote refs after launch, registers exact revisions pushed while the session is alive, submits heartbeat commands and stops renewal when the child exits. It does not inspect chat content to infer ownership or attach to already-running interactive sessions. Existing Codex/Claude sessions can call the incident protocol explicitly; otherwise they remain unregistered and GitHub's watchdog still notices failed CI. Installing the fallback worker alone is not advertised as automatic participation by all existing agents. Both managed-session and fallback process modes must keep transport credentials outside the model process; any broader ordinary agent credentials remain outside Sutura's authority guarantee.

Registration is limited to the exact work ref assigned to that managed session. Observing its advance is an observation/possible ownership claim, not proof that the child authored the push. Preserve unknown author attribution unless independently linked to a submitted candidate.

```text
handoff envelope v1:
  incidentId, generation, sourceSha, trustedPolicyCommit/hash
  observed failed workflow/job/command IDs; bounded failure summary
  attempted candidate hashes + verified rejection reasons
  immutable evidence references; remaining resources; deadline
  controller-attested adapter identity

worker tick:
  authenticate and poll allowlisted repositories (one job at a time)
  atomically claim handoff; reserve invocation + independent verification
  export bounded source snapshot; attach trusted instruction context
  launch fixed adapter argv without a shell
  maintain heartbeat/deadline outside the model
  collect exact candidate bytes; validate scope before submission
  submit -> existing execution-backed verifier -> controller publication path
```

Select the local Claude Code adapter for this release. Planning verified CLI `2.1.270` is installed and exposes print mode, structured output, restricted tools and permission controls. Its [CLI reference](https://code.claude.com/docs/en/cli-reference) is the upstream interface reference; activation must capture the exact installed version/help and execute a bounded real contract probe. Version/help availability does not prove successful authenticated execution.

Use a fresh temporary snapshot, never the developer's dirty worktree. No `.git`, inherited hooks, arbitrary plugins/MCP servers, remembered sessions or publication credentials reach the candidate producer. Supply explicit trusted project context. Limit the first adapter to confined source-reading/editing tools; Sutura executes commands and verifies independently. Do not enable arbitrary shell or bypass permissions to satisfy an unattended prompt. Enforce output/file/diff limits, process-group termination and a fifteen-minute wall deadline. Test the exact restricted invocation against installed CLI semantics before enabling it; unsupported confinement produces `adapter-unavailable`.

The worker launches at login via launchd, polls once per minute, and resumes after wake. It never wakes or modifies power settings on the machine. On shutdown/disconnect the lease expires and GitHub remains responsible for the incident. Mac asleep, missing credential, quota exhaustion, provider error and permission denial have separate reasons. There is no cloud fallback pretending to replace an unavailable local subscription.

At most one fresh fallback dispatch per incident; no invisible model/provider retry chain or reset of budgets. Metered API mode requires a proved maximum reservation. Subscription mode records invocation, wall time and available usage/quota signals without inventing a dollar amount or claiming a guaranteed token ceiling. A separate configured subscription invocation allowance is required. Failure/refusal cannot return the incident silently to the developer: record terminal cause and next required action; notification is deduplicated once per reason/generation through the repository's opted-in status channel.

## Automated acceptance

- [ ] Two cooperating agents claim the same incident; one proceeds, one receives owner/status without duplicate dispatch.
- [ ] Wrapper heartbeats without model participation, stops at deadline and kills child process group before relinquishing ownership.
- [ ] Already-running/unwrapped sessions receive no fabricated owner label; managed-session exit stops renewals and delayed heartbeat acknowledgments cannot resurrect expired ownership.
- [ ] Forged principal, lease, policy or completion claim cannot submit accepted evidence.
- [ ] Candidate attempts to read outside snapshot, invoke shell/network tools, load project hooks or access credentials fail under the actual adapter harness.
- [ ] API timeout, authentication/quota/permission failure and sleeping/unavailable worker produce accurate states and retained reservations.
- [ ] Supplied candidate uses the common verifier; changed source/policy/hash, missing/unrelated contracts and forged green logs fail.
- [ ] Incumbent succeeds while Sutura waits: no fallback invocation. Nonparticipating external push supersedes old work without crediting Sutura.

Use fake-process fixtures for deterministic failure paths and actual captured output for parser contracts. Run CLI/core/Action tests and required repository checks sequentially.

## Operator/live acceptance

- [ ] On a bounded demo incident, kill the incumbent, observe automatic fallback, verify a correct supplied patch and refuse a deceptive counterpart.
- [ ] Verify launchd configuration, loaded state, exit code, log and output freshness; then test worker disable/re-enable without losing an incident.
- [ ] Confirm no interactive consent prompt or user's manual push-monitor command is necessary on the qualified path.

Only these checks support the claim of automatic fallback. No Codex adapter, multi-provider router or hosted coding-agent service is included. Stop at the phase gate unless continuous execution is authorized.
