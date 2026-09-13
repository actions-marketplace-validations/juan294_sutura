# Verified repair program — planning review

Date: 2026-09-05. Planning source: `369c972777eea3c80b698db61165f07ba46e6b13` on `develop`.

Reviewed deliverable: [parent plan](2026-09-05-sutura-verified-repair-program.md) and all fourteen linked phase files. Status: planning complete; no implementation phase is complete.

Two independent reviewers examined the parent and phase files, then reread the corrected sections. Both reported no remaining architectural or release-gate blocker. The following findings changed the plan:

| Finding | Resolution |
| --- | --- |
| Search could stop at a visibly green but behavior-breaking patch | Phase 4 makes full verification the search-success condition and adds wrong-first/correct-second execution coverage. |
| Citation hashes did not prove model-proposed expected values | Phases 1/4 require trusted declarative contracts and deterministic controller-derived expectations; unsupported prose alone is insufficient. |
| Callable-only probes would regress legitimate configuration repairs | Added bounded JSON-property observation and trusted strictness constraints. |
| Public contracts were conflated with secret challenge answers | Public intended behavior may be inferable; frozen controller tables/assertions and evaluator-hidden values stay outside candidate packaging, with sentinel tests. |
| Study measured comprehension but omitted paired review value | Phases 9/12 add counterbalanced ordinary-CI/diff versus Sutura-evidence tasks measuring correct decisions, time, assistance and order. |
| Tavily off intentionally abstains under production policy | Label that comparison as policy-gated capability evidence; use a separate blinded offline task for retrieved-evidence quality. |
| Data Lab prompt selection followed held-out evaluation | Phase 10 completes development/validation selection first, freezes runtime/evaluator settings, then measures held-out records without selecting a new winner. |
| Future judge-access completion could block October submission circularly | Phase 13 requires operations readiness/current access; phase 14 separately records fulfilled access through December 15. |
| Recruitment started too late | Phase 9 prepares concrete early scheduling authorization; measured trials await the real public pilot. |
| Small source/reference/default ambiguities | Corrected source line and phase references; defined required verification/demo versus optional legacy-heal defaults and truthful lower-assurance labeling. |

All approved recommended capabilities remain in scope. Only phases 6 and 9 are batch eligible, with explicitly disjoint owned files after their shared phase 5 dependency. Empirical targets, implemented capabilities and promotion decisions remain distinct. Existing failed results and release obligations are preserved.

Local planning validation checked parent/phase Markdown links, fourteen-phase dependency order, code fences, unresolved markers, whitespace and existing source line bounds. The roadmap entry point now points to the new program while retaining historical measurements. The only future line-referenced document is expressly created by phase 9 before phase 12 reads it.

No application tests were rerun for this documentation-only planning task. The earlier audit's application checks are historical baseline evidence, not validation of unimplemented features. No product code, commit, push, provider job, deployment, participant message or submission was performed. Begin implementation with the [phase 1 baseline and contracts](2026-09-05-sutura-verified-repair-program-phases/phase-1.md) in a subsequent implementation task.
