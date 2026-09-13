# Evaluation recovery

## Durable job recovery

Use the same `placebo:live run` or `placebo:live streak` command and exact manifest
when restarting a controller. The common Git directory holds the cumulative
account, pending controller ID, reserve, original source identity and discovered
GitHub job ID. Initialization is exclusive: do not initialize or replace that
account on restart.

A pending reservation is reconciled before preflight for new work. Recovery
reads the already-dispatched job and its artifact; a stale canary or moved remote
branch does not require another paid canary merely to collect existing evidence.
New dispatch still requires the full exact-source, CI, canary and freeze gates.

The dispatch request is sent once. If its response is lost, the runner searches
for its unique controller/case title. Once discovered, the job ID is saved before
further polling. Recovery never sends another dispatch to resolve uncertainty.
No matching job, multiple matching jobs, wrong identity, failed workflow or
exhausted read deadline stops with the reservation intact.

A saved job ID can be observed before its title matches the dispatch. While the
ID and source SHA match and the job is still pending or running, the controller
allows at most one minute for its title to settle. It never accepts a result
without the exact title. A completed mismatch, or a title change after identity
was confirmed, stops immediately. Diagnostics retain the job ID, whether the
title was missing, empty or different, and its SHA-256 hash instead of raw text.
This handles a possible metadata delay; the original September 9 mismatched
response was not retained, so that incident's exact cause remains unproven.

Transient GitHub observations recover with exponential waits from one to thirty
seconds, within the existing 35-minute polling deadline. Artifact downloads have
a separate five-minute read-recovery deadline and start from an empty temporary
directory after interruption. Authentication, invalid JSON and identity errors
are immediate failures. These retries do not call model or sandbox providers.

Validated artifact bytes are written before the case ledger. Repeating the same
completion is idempotent; conflicting bytes or job identity are refused. Only
then can the cumulative account settle the cost. Infrastructure-stop telemetry
is incomplete, even when nonzero: its reservation remains pending until provider
billing is reconciled. A recovered false approval is a durable terminal stop.

Locks identify their local owning process. A replacement process reclaims only
an owner proven dead on the same host. Live, foreign, malformed and legacy empty
locks fail closed; inspect their ownership before manual intervention. If the
host dies during the very short lock-recovery guard itself, that guard likewise
requires inspection. Concurrent controllers cannot share a reservation.

## Offline verification

`pnpm run test:release-contracts` includes fault injection for EOF and TLS outages,
ambiguous dispatch responses, partial downloads, artifact/ledger write
interruptions, real process termination and restart, unknown billing, and false
approval retention. The tests use local fakes and subprocesses; no paid provider
requests are made.

## Notification commands

`pnpm run placebo:live alert-test` deliberately fails locally and writes/sends a
terminal alert. It exits nonzero by design and makes no paid request. Inspect the
outbox in the common Git directory at `sutura-evaluation-alerts/`.

Use `alert-status --event-id ID`, `alert-retry --event-id ID`, or
`alert-ack --event-id ID` with the same command. Acknowledge only after a person
confirms seeing that event. Retry sends the same notification event and cannot
dispatch evaluation work.

A local `sutura-evaluation-notifier.json` in the common Git directory can store
`{"command":"/absolute/path/to/notifier"}`. The environment override below takes
precedence. The configuration stays outside the candidate and is never committed.
New notification code still requires a successful channel test before unattended
operation is described as verified.

## Stop notifications

Terminal evaluation events are written to a local outbox before notification is
attempted. The default is file-only: no external recipient is contacted. A
configured `SUTURA_EVALUATION_NOTIFY_COMMAND` must be an absolute executable path.
The command receives one JSON event on standard input, without a shell. It must
implement the approved notification channel. Raw provider errors, credentials,
and webhook URLs are excluded from the event and delivery records.

Each event has an immutable ID. A failed send stays `pending` and can be retried
using that same ID, including from a new controller process. Successful command
exit records `transport-accepted`; it does **not** establish that the operating
system displayed a notification or that a person read it. Only explicit human
acknowledgment may record `acknowledged`. File-only operation remains visibly
pending and must not be reported as a delivered notification.

The offline receiver test deliberately creates a stopped-run event, fails its
first delivery, then sends it to a real subprocess that writes the received JSON
to disk. It verifies persistence across callers and prevents another send after
acceptance. This proves local delivery, not delivery to the user's notification
channel. The selected channel still needs a self-test and the user's confirmation
that the notification was visible before promising unattended alerts.

Delivery uses an exclusive per-event process lock. A retry automatically reclaims
an owner proven dead on this host. Unknown or foreign owners fail closed. If a
sender dies between sending and recording acceptance, the next attempt can repeat
the notification with the same event ID. Receivers should deduplicate those IDs:
at-least-once delivery favors an occasional duplicate over a missed stop alert.
Notification retries never dispatch benchmark jobs or change spend accounting.

The included optional macOS transport is `scripts/evaluation-notify-macos.mjs`.
Set `SUTURA_EVALUATION_NOTIFY_COMMAND` to its absolute executable path only after
selecting this local channel. It reads the sanitized event from standard input
and invokes a static AppleScript with title and body as separate arguments. It
does not interpolate event text into shell commands or AppleScript source. The
notification contains the manifest ID, terminal status and progress. Native
notification permissions or Focus settings can suppress display even when the
transport exits successfully, so actual display still needs confirmation.

If progress cannot be read while a run terminates, the alert records
`progress-unavailable`, unknown spend (`null`) and a conservative zero completed
count. These fields are a fallback notification, not a measurement of zero work
or cost; the macOS message explicitly says progress is unavailable. The original
runner error remains the error returned to its caller.
