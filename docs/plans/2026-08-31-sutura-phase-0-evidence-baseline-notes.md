# Sutura Phase 0 evidence baseline deviations

## Phase 4: Live v0.2.0 benchmark result

Plan said: Hidden-test preservation would be 15/15, repair rate would exceed 6/10, flaky accuracy would be 10/10, and all four Tavily-enabled upstream cases would be fixed.

Found: The complete exact-release run retained 51 cases and 55 evaluations with zero false approvals and zero budget exhaustions. It measured 10/18 verified repairs, 9/10 correct flaky classifications, 15/19 explicit trap refusals, 0/4 Tavily-enabled upstream fixes, and hidden verification of 0/15. Four Python repairs, three Python traps, and the Python flaky case stopped as infrastructure outcomes because the immutable v0.2.0 Python image digest returned HTTP 404 during ConTree import. Fourteen hidden checks were not run because the released outcome had no selected candidate; one trap candidate ran and failed its hidden check as expected.

Why it matters: The result is an honest complete baseline and missed quality targets stay in the denominator, but it does not satisfy the plan's strict 15/15 hidden-test safety wording. The current score also counts only a passing hidden check as preserved, while a deceptive trap candidate is expected to fail its hidden check and be rejected. Phase 0 must not be marked `Accepted` until that contract conflict and the v0.2.0 safety result are resolved. No result was edited or rerun to improve the score.

## Phase 4: Candidate and public matrix results

Plan said: Both matrices would complete 8/8 with zero false approvals, and each terminal workflow would upload its normal result artifact.

Found: Candidate mode retained 8/8 cases, passed 6/8, and had zero false approvals. Public mode retained 8/8, passed 5/8, and had zero false approvals. `repository-policy-refusal` ended as safe `gave-up` in both modes. Python repair reproduced the unavailable image in both modes. One public audit-only run received an invalid diagnosis response. The early-failure paths did not upload normal case artifacts, so exact evidence was recovered from run logs, replay artifacts, checks, PRs, fixture identities, and ConTree operation IDs without rerunning or changing a result.

Why it matters: The matrices are complete failed baselines, not passing release gates. The workflow also needs a normal terminal artifact for early infrastructure and provider failures. The v0.2.1 remediation plan addresses both product behavior and evidence recovery before any new paid run.

## Phase 2: Canonical benchmark case set

Plan said: `discoverCases()` represented the 51-case public Placebo v0.2 corpus.

Found: `discoverCases()` returns 52 directories because it also includes `repair-dogfood-arithmetic`, a dedicated reliability fixture. The published v0.2 manifest correctly excludes this fixture and contains 51 cases, but the default harness still ran it and produced 56 evaluations.

Chose: Add `discoverBenchmarkCases()` and make benchmark execution and manifest generation exclude only `repair-dogfood-arithmetic`. Keep `discoverCases()` and corpus self-checks unchanged so the reliability fixture remains tested.

Why: Live evidence must use the already published 51-case manifest and its 55 evaluations. Including the dogfood fixture would change the denominator and contradict the release evidence contract.

## Phase 2: Workflow dispatch ref

Plan said: Dispatch the manual workflow at an exact controller SHA and accept only `subject-sha`, `case-id`, and `controller-id` as workflow inputs.

Found: GitHub workflow dispatch accepts a branch or tag ref, not a raw commit SHA as the durable dispatch contract.

Chose: Dispatch the protected `develop` ref, add `controller-sha` as an exact input, require `GITHUB_SHA` to equal that input, and check out the controller again at the same exact SHA.

Why: This keeps the controller identity exact while using GitHub's supported dispatch interface. The local gate already requires `origin/develop` to equal the controller SHA before dispatch.

## Phase 3: Exact demo identity

Plan said: The demo workflow accepts package mode, case ID, Action SHA, and controller ID.

Found: Those inputs do not bind a run to the trusted demo commit that contains the materializer and evidence collector. A mutable default branch could therefore change after the local gate.

Chose: Add `demo-sha`, dispatch the protected `main` ref, require `GITHUB_SHA` to equal the input, and make the local controller reject any remote `main` mismatch.

Why: Every external result must bind to the exact reviewed demo controller as well as the exact Sutura Action.

## Phase 3: Check-run permission

Plan said: Repair cases may use only `actions: write`, `contents: write`, and `pull-requests: write`.

Found: The released Sutura Action creates and completes a SHA-bound check run. Its canonical workflow requires `checks: write`; without it, the external run cannot produce the required check evidence.

Chose: Add `checks: write` only to the repair-case job. Audit cases remain `contents: read`, and neither job receives identity-token or issue permissions.

Why: This is the minimum permission set that can execute the released Action contract and preserve direct check-run evidence.
