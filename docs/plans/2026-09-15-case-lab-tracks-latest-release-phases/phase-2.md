# Phase 2: Run the v0.3.0 benchmark and promote the evidence

Plan: [2026-09-15-case-lab-tracks-latest-release.md](../2026-09-15-case-lab-tracks-latest-release.md)

Status: Done. Authorized by Juan 2026-09-15. Ran 51/51 cases, 55/55
evaluations, USD 4.11234948 total (under the USD 8 cap), zero false
approvals. Interrupted six times by the local machine's memory watchdog and
resumed each time from the ledger/manifest-spend state with no duplicate
case runs. Evidence committed and pushed to `develop`
(`docs/demo/sutura-v0.3.0-release-benchmark-evidence.md`); push freeze off.

## Goal

`docs/demo/placebo-v0.3.0-live-2026-09-<dd>.json`,
`docs/demo/placebo-v0.3.0-live-ledger-2026-09-<dd>.json` and
`docs/demo/sutura-v0.3.0-release-benchmark-evidence.md` committed on `develop`,
with `subjectSha` and `controllerSha` both `c94eee2086b31450d975137a0102dda18522d0b8`,
`subjectVersion 0.3.0`, 51 ledger entries, 55 results.

## Preconditions (check, do not assume)

```bash
git fetch origin develop main --tags
test "$(git rev-parse v0.3.0^{commit})" = c94eee2086b31450d975137a0102dda18522d0b8
git status --porcelain | wc -l            # 0
pnpm run push-freeze status               # "No push freeze active"
ls .sutura/placebo-v0.3.0-live-ledger.json 2>/dev/null   # must NOT exist; a ledger from another identity is refused
ls "$(git rev-parse --path-format=absolute --git-common-dir)/sutura-manifest-spend/release-v0.3.0-benchmark.json" 2>/dev/null  # must NOT exist
gh secret list | grep -E 'NEBIUS_API_KEY|TAVILY_API_KEY|CONTREE_TOKEN'   # presence only
```

## Steps

1. **Canaries at the tag** (the gate requires both under 24 h; none exist for
   `c94eee2`):
   ```bash
   gh workflow run provider-contract-canary.yml --ref v0.3.0
   gh run watch "$(gh run list --workflow provider-contract-canary.yml -L 1 --json databaseId -q '.[0].databaseId')" --exit-status
   gh run list --workflow provider-contract-canary.yml -L 1 --json headSha,conclusion   # headSha c94eee2…, success
   ```
   Both artifacts (`provider-contract-canary`, `runtime-image-canary`) come
   from this one run (`.github/workflows/provider-contract-canary.yml:26-42`).
2. **Read-only gate** — must print seven `PASS` lines now:
   ```bash
   pnpm run placebo:live gate --release-tag v0.3.0 \
     --controller-sha c94eee2086b31450d975137a0102dda18522d0b8 --subject-sha c94eee2086b31450d975137a0102dda18522d0b8
   ```
3. **Authorization.** Present the priced ceiling from Phase 1's
   `manifestMaximumUsd` and this command list; wait for Juan's explicit "go"
   in this conversation.
4. **Freeze, account, run** (the freeze wrapper is the G2 form from
   `docs/plans/2026-09-04-sutura-ws4-evidence-submission.md:249-277`; a
   non-zero exit leaves the freeze on by design):
   ```bash
   export SUTURA_RELEASE_MANIFEST="$(pwd)/docs/demo/run-manifests/release-v0.3.0-benchmark.json"
   pnpm run push-freeze on --reason "v0.3.0 release benchmark (Case Lab evidence), cap USD 8"
   pnpm run push-freeze status
   pnpm run placebo:live init-spend --run-manifest "$SUTURA_RELEASE_MANIFEST" --cap-usd 8 --initial-reserve-usd 1.00
   pnpm run placebo:live streak --release-tag v0.3.0 \
     --controller-sha c94eee2086b31450d975137a0102dda18522d0b8 --subject-sha c94eee2086b31450d975137a0102dda18522d0b8 \
     --run-manifest "$SUTURA_RELEASE_MANIFEST" --cap-usd 8 --initial-reserve-usd 1.00 --authorize
   ```
   Run it with `run_in_background` and monitor `.sutura/placebo-v0.3.0-live-ledger.json`
   entry count (expect 51) and `gh run list --workflow placebo-live-case.yml`.
   Median gap between cases was 177 s on 2026-09-05; a single case has a
   35-minute poll deadline.
5. **On a stop** (`stoppedFor` ≠ `complete`, or exit code 2): do not retry.
   Leave the freeze on, report the ledger state, the pending manifest
   reservation and the stop reason, and wait. `docs/demo/run-manifests/README.md:63`
   governs reconciliation; `SUTURA_ALLOW_INFRA_STOP_LEDGER=1` is an explicit,
   separately authorized opt-in.
6. **Finalize and promote** (the output directory must not exist;
   `placebo-live.mjs:913`):
   ```bash
   pnpm run placebo:live finalize --controller-sha c94eee2086b31450d975137a0102dda18522d0b8 \
     --subject-sha c94eee2086b31450d975137a0102dda18522d0b8 --output-dir .sutura/placebo-v0.3.0-final
   D=$(date -u +%Y-%m-%d)
   cp .sutura/placebo-v0.3.0-final/placebo-v0.3.0-live.json "docs/demo/placebo-v0.3.0-live-$D.json"
   cp .sutura/placebo-v0.3.0-live-ledger.json "docs/demo/placebo-v0.3.0-live-ledger-$D.json"
   node -e "const r=require('./docs/demo/placebo-v0.3.0-live-$D.json'), l=require('./docs/demo/placebo-v0.3.0-live-ledger-$D.json'); if (r.ledgerHash!==l.resultHash||r.subjectSha!=='c94eee2086b31450d975137a0102dda18522d0b8'||r.subjectVersion!=='0.3.0'||r.results.length!==55||l.entries.length!==51) throw new Error('promotion identity mismatch'); console.log('ok', r.totalUsd, r.inferenceUsd)"
   shasum -a 256 docs/demo/placebo-v0.3.0-live-$D.json docs/demo/placebo-v0.3.0-live-ledger-$D.json
   ```
7. **Evidence index** `docs/demo/sutura-v0.3.0-release-benchmark-evidence.md`,
   same sections as `docs/demo/sutura-v0.2.1-repair-quality-evidence.md`:
   exact identities (controller = subject = tag commit, subject version,
   package content hash from the ledger, canary run URL, first/last case run
   URLs), benchmark evidence (both files with SHA-256 and result hash, 51/51,
   55/55, totals with the inference-only billing note), the measured-gates
   table against the 2026-09-05 column, and any interruption/resume note taken
   verbatim from the ledger timing. No placeholders: every value comes from
   the files just written.
8. **Freeze off, commit, push** (the freeze is for the paid run only; the gate
   from Phase 4 is not wired until Phase 5, so this push is permitted):
   ```bash
   pnpm run push-freeze off
   git add docs/demo/placebo-v0.3.0-live-$D.json docs/demo/placebo-v0.3.0-live-ledger-$D.json docs/demo/sutura-v0.3.0-release-benchmark-evidence.md docs/demo/run-manifests/README.md
   git commit -m "docs(evidence): record the v0.3.0 release benchmark"
   git pull --rebase && git push
   ```
   Update the manifests README row for `release-v0.3.0-benchmark` from
   "Prepared" to the recorded totals. Do not edit any historical evidence
   file.

## Success criteria

Automated:

- `node -e` identity check in step 6 prints `ok`.
- `pnpm --filter @sutura/case-lab test` still passes (evidence constants are
  rebound in Phase 3, so this phase must not break the v0.2 binding).
- `pnpm run test:release-contracts` green (the manifest test from Phase 1
  reads the committed manifest, unchanged by this phase).

Manual:

- Juan's authorization was given in this conversation before step 4.
- Recorded `totalUsd` ≤ 8 and `stoppedFor: complete`; if not, the phase is not
  done and Phase 3 must not start.

## Done when

The three evidence files are on `origin/develop` with green CI, the push
freeze is off, and the manifest spend account shows no pending reservation.
STOP.
