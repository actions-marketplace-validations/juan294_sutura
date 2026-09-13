# Phase 11 — Validated public pilot for maintainer trials

Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on phase 10 passing mandatory candidate gates. Sequential, not batch eligible.

## Outcome and release distinction

Make a tested public package, immutable Action and matching Case Lab available for real users. This is a **pilot**, not a claim that final submission/adoption/video requirements already passed. Existing final evidence contract retains all required evidence; a pilot-readiness record states the narrower prepublication obligations and explicitly leaves final readiness false. Do not delete requirements to enable pilot publication.

Read `.claude/commands/pre-launch.md:1`, `remediate.md:1`, `update-docs.md:1`, `release.md:1`, `docs/release/e2e-pro-playbook.md:1`, `docs/release/discoverability-playbook.md:1`, `scripts/release-evidence.mjs:21`, all installation/Marketplace validators, `.github/workflows/publish.yml:1`, and Case Lab release pin/deployment procedure before acting. Own release preparation, changelog, version-bearing files, public-safe evidence index, exact demo pin and necessary release/docs tests. Reuse the canonical evaluator guide.

## Preparation and publication order

1. Run `/pre-launch`, resolve findings through the documented remediation/reuse review, and refresh docs from measured phase 10 evidence. Preserve historical version references in dated artifacts; do not globally replace old subject identities. Confirm README's first install, CLI verify flags, Action permissions, costs and assurance modes match actual package behavior.
2. Follow `/release` orientation and prepare a concrete version recommendation/diff. Its command requires Juan to choose the actual version; do not invent a future number in this plan. Inventory all version-bearing files, keep the `develop` → `main` topology and permanent branches. Candidate identity after release preparation is distinct from phase 10's subject; use supported executable-equivalence checks or rerun invalidated gates. A changed bundle/model/config cannot borrow old acceptance.
3. Run sequential full local release gates, packed CLI/Action install tests, README setup, bundle parity, release contracts and signed-out-equivalent local Case Lab acceptance. Prepare exact release request, immutable subject, finite hosted effects and rollback steps. Inspect current CI/publish/Vercel Git triggers; eliminate preview trigger through documented non-destructive settings before any push.
4. Publish only under explicit action-specific authorization, following the existing release command's review/version/tag/PR gates. Registry publishing is advisory in the command unless Juan explicitly authorizes the actual npm operation. Do not auto-publish merely because the plan includes adoption. Never mutate a published npm version or immutable Action SHA.
5. Perform the separately authorized public npm/immutable-Action install matrix and real workflow checks; record artifact/version/source equality or explicit supported equivalence. Existing release evidence `ready` remains false until every required final record exists. A pilot is visibly labeled as such.
6. Build Case Lab locally and use the documented prebuilt production deployment path only after explicit authorization. No preview deployment. Pin the exact accepted release/Action and truthful current result artifacts. Read back production config, public URL, live readiness, quota behavior and source pin; no secret value printing.
7. Run separately capped public eight-case matrix and signed-out acceptance with terminal live jobs plus labeled replay/recorded states. Repair-only generated outcomes and supplied deceptive controls remain distinct. Persist publicly durable sanitized artifacts rather than relying only on expiring workflow retention.
8. Finalize the pilot manifest with links, true/false readiness distinctions, costs, service owner and limits. Pass these concrete artifacts to phase 12's prepared study.

```text
pilot = prepareReleaseFromAcceptedSource()
require localGates(pilot) and reviewablePublicationRequest
require exact authorized publication action
publishThroughExistingReleaseWorkflow(pilot)
verifyPublicPackageAndImmutableAction(pilot)
require authorized prebuiltProductionDeployment
verifySignedOutDemoAndPublicMatrix(pilot)
writePilotEvidence(finalSubmissionReady=false, actualPublicArtifacts)
```

## Automated success criteria

- [x] Release/installation validators reject mismatched package version, wrong Action SHA, unpublished or redirected package identity and stale demo pin.
- [ ] Public matrix passes all eight actual cases with preserved behavior; failed/incomplete cases block pilot acceptance for trials.
- [x] Existing required evidence list still includes benchmark, candidate/public matrices, demo, dogfood, feedback, Devpost, local gate, Marketplace, npm and GitHub release. New feature/experiment/adoption requirements are additive and final readiness remains false when missing.
- [ ] Fresh-clone install, verify CLI, read-only Action dispatch, Case Lab replay/live availability and evidence links pass through actual public artifacts after publication.

## Manual success criteria and stop

Inspect actual signed-out public result on desktop/mobile and the immutable evidence/diff links; confirm quota and infrastructure errors are understandable. Record public identities, deployment ID, publication approvals and terminal job costs. No preview or hidden hosted builds occurred outside reviewed triggers. Stop; no outreach until exact messages/cohort are approved for phase 12.

## Progress record — September 6

Publication is blocked on authorization rather than on effort. A public package, an immutable Action and a Case Lab deployment need explicit release authorization, and they depend on phase 10 candidate gates that have not run. **Nothing was published, tagged or deployed, and no registry was contacted.**

The validators are built and can be written before anything is published because they take what a caller already observed rather than fetching it. `scripts/pilot-artifacts.mjs` refuses a version the registry does not serve, a package with no published version at all, a name the registry resolves differently, a tarball from a path the release never named, and an integrity value that is not an exact sha512. It refuses an Action pinned by tag rather than by commit, a pin that differs from the published Action, and a release tag that resolves to a different commit, because a tag can move and an identity cannot. It refuses a demo pin that does not match the demo's actual commit rather than refreshing it, since a stale pin makes published evidence describe a state that no longer exists.

The eight-case public matrix blocks pilot acceptance on any failed, incomplete or behaviour-breaking case rather than averaging it away, and a complete pilot still reports `submissionReady: false`: publication and outreach stay separate decisions. 7 tests, wired into `test:release-contracts`.

The required evidence list is extended additively in the same pass that phase
13 records: the eleven existing checks are unchanged and five are added, each
of which makes final readiness false on its own while it is pending.

Still blocked, and not claimed: every criterion that needs a published
artifact.
