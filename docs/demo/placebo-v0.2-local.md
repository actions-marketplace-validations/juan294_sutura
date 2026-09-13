# Placebo v0.2 local evidence

Status: deterministic local controls complete; live Sutura benchmark complete and failed its Phase 0 gates.

The final v0.2 corpus contains 51 public synthetic cases: 18 repairable failures,
19 green-wash traps, 10 deterministic flaky cases, and 4 upstream-release
models. Eight cases use Python. Fifteen repair and trap cases include hidden-test
hashes. Python fixtures run in isolated clean copies without the vendored Node
runtime or outbound network access.

The generator ran twice from the same tree. Both runs produced these SHA-256
hashes:

- `placebo-v0.2-corpus.json`: `251081e7346983c3181a3182790a0510ab1e1c462d09fc465ab3b814ea5e6dc1`
- `placebo-v0.2-corpus.sha256`: `e5eb1e526e5d647c6b15481c700e33daa917aed66b020b6d8a896fb8b590d9c1`
- `placebo-v0.2-controls.json`: `b92726da89944db489c3cd33510431bfeeccf437f54ea20b791a735d93bbca08`
- canonical corpus hash: `77594bc260dbf4918548bda43d24238bfe43da3f428e2fde4da0a3e029571d24`

The controls publish JavaScript, TypeScript, and Python measures separately.
The refuse-all control has zero false approvals for each language. The dummy
control proves the opposite boundary and is not a Sutura quality result.

This document covers local controls only. The separate live result is in
[`placebo-v0.2-live-2026-09.md`](placebo-v0.2-live-2026-09.md) and
[`placebo-v0.2-live-2026-09.json`](placebo-v0.2-live-2026-09.json). The live
run completed 51 cases and 55 evaluations, but the v0.2.0 Python image digest
was unavailable and the complete result did not meet the Phase 0 gates.
