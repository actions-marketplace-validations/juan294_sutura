# Phase 13 — Final feature freeze, submission release and judge experience

Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on phase 12 and revalidated mandatory gates. Sequential, not batch eligible. Intended freeze October 21; intended submission October 29, ahead of October 30, 2026 at 10:00 Pacific.

## Outcome and owned artifacts

Deliver one coherent public submission whose product claims, package, immutable Action, Case Lab, benchmark and video all identify the actual final product. Read the existing release workflow/playbook, `scripts/release-evidence.mjs:21`, `scripts/submission-contract.test.mjs:1`, current `docs/devpost/`, `docs/feedback/`, `docs/evaluation/README.md:1` and `architecture.md:1`, and final evidence requirements completely. Own release preparation and evidence assembly, canonical docs, video/transcript assets, sponsor feedback and final Case Lab pin. Reuse existing contracts instead of building another claims portal.

## Freeze and final acceptance

Freeze executable product source, bundle, package dependencies, runtime images, policy, prompts, routing profile and challenge schema/set-generation version. Any later behavior change creates a new candidate and invalidates affected evidence. Run `/pre-launch` → remediation → `/update-docs` → `/release` using existing command gates. Version selection and publication authorization remain explicit, just as in phase 11.

The final release-readiness record includes every existing required evidence ID plus new challenged verification, external verification, routing evaluation, Data Lab experiment, NeMo evaluation, Arena split/comparison, adoption and a judging **operations-ready manifest**. The latter contains the owner, finite authorized reserve or pending authorization clearly blocking readiness, durable archive, current signed-out availability check, actual credential expiry/rotation schedule and monitoring arrangement. It does not assert that December access checks have already occurred; only phase 14 can close the completed-window obligation. Extend validators with mutation tests for each new required item. Distinguish prepublication release checks from postpublication npm/public-matrix/demo obligations; no `ready` summary is true until all required final obligations pass. This preserves tag/publish safety without falsely requiring public installation before an artifact exists. Never waive a failed required runtime check at report time.

Re-run only evidence invalidated by changes, as determined by exact declared executable fingerprints and existing release rules. A documentation-only source index can cite an earlier measured executable subject explicitly; no self-referential current-document SHA requirement. Final public install, demo pin/access and critical behavior checks use actual final artifacts. Retain earlier maintainer trials as pilot evidence, with final regression checks and any necessary new human follow-up clearly identified.

## Submission story and assets

Use the actual implemented one-liner from the parent, adjusted only to measured behavior. First 30 seconds: developer failure, two green patches, bad partial-page behavior, Sutura's rejecting evidence. Then show the correct patch and an external-agent verification through the same checks. Explain sponsor roles by their function, not a logo count.

Planned 2:55 video structure (timings are a script until recorded): 0:00–0:20 problem; 0:20–1:15 two-patch demonstration; 1:15–1:45 external verification and review action; 1:45–2:15 ConTree/Nemotron/Tavily runtime evidence; 2:15–2:40 measured evaluation and maintainer value; 2:40–2:55 limits, public try-it/repository. Include only measured numbers that remain legible and meaningful. Recorded/live segments are labeled. Juan records/narrates or explicitly authorizes another production route; no cloned voice or invented participant quote.

Publish a public English YouTube video under three minutes with captions and a transcript derived from the final cut. Timestamps link to demonstrated behavior, canonical claim card and exact source/evidence. Do not treat the planned timing sheet as an actual transcript. Verify playable signed-out video, audio, captions, duration and final product identity.

Prepare Devpost description, screenshots of real product states, architecture figure, public source/license/test instructions, significant in-period change history and concise sponsor feedback. Feedback must reference actual Token Factory/Nemotron/ConTree/Data Lab/NeMo/Tavily use and limitations, not claim every optional technology was used. Give the four judging criteria concrete evidence: implemented verification, understandable design, measured developer use and differentiated preservation workflow.

Recheck official [rules](https://nebiusglobalaihackathon.devpost.com/rules), [resources](https://nebiusglobalaihackathon.devpost.com/resources) and [overview](https://nebiusglobalaihackathon.devpost.com/) for final eligibility, team/member entries, prize selection, deadline and access requirements. Runtime Token Factory/NVIDIA use must have actual proof. Public licensed repo, English description, demo/test build, feedback and public video are required. City attendance eligibility is not assumed. User's actual account/member declarations must be truthful; do not infer missing eligibility information.

```text
finalCandidate = freezeAcceptedProduct()
requirements = existingEvidenceIds + newCapabilityAndAccessIds
report = validateActualArtifacts(finalCandidate, requirements)
assert no failed/skipped/missing required check
assets = assembleClaimsFrom(report, actualVideo, consentedAdoption)
verifyAllPublicLinksSignedOut(assets)
require explicit approval of concrete Devpost payload
submitByOctober29(assets)
readBackSubmittedStateAndArchiveConfirmation()
```

## Automated success criteria

- [ ] Full local gates, package/Action/public matrices, release contracts, source/policy/model/image consistency and public pin checks pass for declared final identities.
- [x] New release-contract mutations prove that missing sponsor experiments, challenge/external evidence, adoption or judging operations-readiness records block final readiness. Completed December access checks are not a prerequisite for October submission.
- [ ] Public-link/anchor validation, archive reproducibility and secret scanning pass; numeric claims derive from machine-readable outcomes and correct denominators.
- [ ] Media metadata confirms duration below 180 seconds; captions/transcript timestamps fit the actual file. Replay performs no provider calls; live path has finite quotas and real terminal behavior.

## Manual success criteria and stop

Review actual signed-out desktop/mobile demo, playable video and concise criteria story. Confirm team/eligibility and sponsor-feedback accuracy from real records. Prepare complete reviewable Devpost payload before requesting submission authorization; sending feedback is also an external-message action requiring authorization. After authorized submission, read back project fields/status and archive public URL/confirmation; a draft is not a submitted entry. Stop after documenting final readiness and the phase 14 operations handoff.

## Progress record — September 6

Not started. Depends on phase 12 trial evidence and on a recorded video and Devpost submission, none of which exist. The intended freeze and submission dates are in the future.

## Progress record — September 6

Final submission needs published artifacts, a recorded video and the completed
evidence from phases 10 to 12. **Nothing was submitted, published or recorded.**

The release contract is extended, additively. The eleven existing required
checks stay exactly as they were, and five are added: `sponsor-experiments`,
`challenge-evidence`, `external-patch-evidence`, `adoption-study` and
`judging-readiness`. A test asserts each of the original eleven is still
required, that a complete set is ready, and that turning any one of the five
back to pending makes readiness false and names that check as the only miss.
Dropping one of them from the set entirely is refused rather than accepted as a
shorter list.

`judging-readiness` is deliberately about being ready to check in December
rather than about having checked. There is no `judging-access-completed`
requirement, and a complete October set is ready without one, because a
submission cannot be blocked on a window that has not opened. The December
checks themselves are phase 14's own criteria.

11 tests in `release-evidence.test.mjs`; the full `test:release-contracts`
suite passes 209.

Still blocked, and not claimed: every criterion that needs a final artifact,
the recorded media, or the completed phase 10 to 12 evidence.
