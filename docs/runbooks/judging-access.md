# Judging access and evidence retention

Owner: Juan González Ponce. Operational window: December 1–15, 2026.
Implementation prepared September 8. This runbook does not record completed
future checks, a published final release, credential expiry dates, or an
approved live operation reserve.

## Before submission

After the final release, retain a public judging manifest beside the release
evidence index. It must name actual public artifact URLs: installation and
Action documentation, pinned source/evidence JSON, the recorded fallback,
video and transcript, and the live availability page. Keep immutable public
archives independently of expiring GitHub Actions artifacts. Do not include
participant records, secrets, tokens, or authenticated download URLs.

Each artifact has `name` and `url`. Use HTTPS without embedded credentials.
Use `method: GET` for archives. Bind archive bytes with
`expectedResultHash` (SHA-256). Pinned JSON evidence additionally declares
`expectedPin` (the exact 40-character source commit) and `pinField` (the actual
top-level JSON property containing that commit). `HEAD` is only suitable for
reachability; it cannot establish a byte hash or served source identity.
`expiresAt`, when used, is an actual UTC expiry copied from authorized
metadata, not an estimated lifetime. The manifest names `liveArtifactName`
and `fallbackArtifactName` when it includes both paths.

Final URLs, pins, source hashes, credential expiry metadata and a finite
operation reserve are not yet available. A manifest containing invented
values would give no useful readiness evidence, so none is created here.
Publication owns those values and runs the first signed-out check.

## Check procedure

From the repository root, run the collector with the final manifest path and
a new dated output directory:

```sh
node scripts/judging-access-collect.mjs docs/demo/judging-access-manifest.json docs/agents/judging-access-2026-12-01
```

This command becomes executable once publication supplies the named manifest.
The collector permits only anonymous GET/HEAD, rejects redirects, imposes
15-second transport and 16-MiB per-artifact limits, and checks at most 32 artifacts. It
stores exact downloaded bytes under their SHA-256 and writes `report.json`.
It never dispatches a canary, repairs a deployment, supplies credentials, or
raises a quota. Exit zero means all named checks passed. A nonzero result
requires reading the report; a usable recorded fallback remains explicitly
identified when live access is unavailable. If both paths are down, the collector
still writes every observation with `reasonCode: no-usable-path` and
`servedPath: unavailable`. Responses arriving after the transport deadline are
not archived.

Retain each report and verified archive in the durable public evidence area
after checking for private material. Publishing those records remains a
separately authorized operation. A local successful download alone does not
prove the durable public archive has been published.

## Calendar and response

- After submission: Juan invokes one signed-out check each week and retains
  the result. This runbook does not install a background schedule.
- November 16–20: inventory actual expiry dates and scopes through authorized
  provider metadata. Resolve missing metadata before claiming readiness.
  Review the expected judging traffic and request a finite live reserve using
  measured release costs. Existing Case Lab limits are ceilings, not a new
  spending authorization.
- By November 27: prepare any necessary credential rotation with minimal
  scopes, a readback check and rollback procedure. Execute rotation only with
  Juan's authorization. A nominal 90-day token lifetime is not expiry evidence.
- December 1–15: Juan invokes the check daily and after an incident repair.
  Review the report the same day. Record the affected artifact, first observed
  time, fallback availability and repair outcome in the evidence index.
- December 15: retain the final check and incident ledger. Close this phase
  only after the observed access obligation is fulfilled. Keep the public
  evidence available; decommissioning requires a separate decision.

An unavailable live service must display the labeled recording and install
instructions. If both paths fail, report the incident and restore a usable
path under the existing deployment authorization procedure. Do not relabel a
recorded result as live, expand token scopes automatically, or rerun paid
measurements as an availability test. Juan owns operational decisions through
the existing project communication channel; no private contact information is
published here.

The existing [Case Lab operations documentation](../../packages/case-lab/README.md)
contains the runtime limits and emergency disable procedure. Live canaries
need an explicit capped schedule and cumulative accounting separate from this
read-only collector.
