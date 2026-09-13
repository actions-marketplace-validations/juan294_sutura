# Sutura Case Lab

The Case Lab is the public, signed-out demo of Sutura. A visitor selects one of
five server-defined cases and receives a stable, readable result: the failed
commit and CI evidence, the Nano diagnosis, the ConTree search tree, the Super
candidates, the rejected patches and their reasons, the Ultra audit verdict,
the final outcome, cost and resource use, and links to the GitHub run, pull
request or refusal report, and evidence.

Every case has a deterministic result labeled `Deterministic replay` or
`Recorded live result`. A live run through the public path is labeled
`Live run`. The label is the `mode` field of the result document and is
rendered in the page title and header.

## Architecture

```
visitor ── static site (Vercel) ── POST /api/dispatch ── GitHub workflow_dispatch
                                        │                       │
                                        │                juan294/sutura-demo case-lab.yml
                                        │                  ├─ re-checks CASE_LAB_ENABLED and the daily cap
                                        │                  ├─ materializes the case, opens the broken PR, runs CI
                                        │                  ├─ runs juan294/sutura/packages/action@<release sha>
                                        │                  └─ publishes results/<request-id>.json to case-lab-results
                                        └─ result page reads the public JSON and the public run API
```

The Token Factory and ConTree repair path runs unchanged inside the Action
step. The dispatcher is one stateless function. It holds one token and no
provider secret.

## Cases

| Id | Scenario | Placebo case | Expected outcome |
| --- | --- | --- | --- |
| `javascript-repair` | JavaScript repair | `repair-off-by-one` | `fixed` |
| `python-repair` | Python repair | `python-repair-missing-await` | `fixed` |
| `flaky-failure` | Deterministic flaky failure | `flaky-timer-race` | `flaky-no-patch` |
| `greenwash-trap` | Greenwash trap | `trap-weakened-expect` | `refused` |
| `upstream-incident` | Upstream dependency incident | `upstream-formatter-release` | `fixed` |

The list is `CASE_LAB_CASES` in `src/cases.ts`. The request boundary accepts
exactly `{ "caseId": "<one of the five>" }` and nothing else. Repository
names, refs, commands, patches, and free text are rejected before any I/O.

## Limits

| Limit | Value |
| --- | ---: |
| Concurrent live runs | 1 |
| Live runs per rolling hour | 4 |
| Worst-case cost per run | USD 0.75 |
| Daily spend stop | USD 6.00 |
| Live runs per UTC day | 8 |

The dispatcher counts the `case-lab.yml` runs of the last 24 hours through the
GitHub API before every dispatch. The workflow repeats the count and checks
the `CASE_LAB_ENABLED` repository variable before it materializes anything,
so a caller that bypasses the dispatcher cannot raise spend.

Emergency disable: set the Vercel environment variable `CASE_LAB_ENABLED` to
anything but `true`, or set the `sutura-demo` repository variable
`CASE_LAB_ENABLED` to anything but `true`. Either switch stops every live run
before a provider call.

## Service identity

The dispatcher authenticates with one fine-grained personal access token:

| Field | Value |
| --- | --- |
| Name | `sutura-case-lab-dispatcher` |
| Resource owner | `juan294` |
| Repository access | Only `juan294/sutura-demo` |
| Permissions | Actions: Read and write. Metadata: Read (automatic). Nothing else. |
| Expiry | 90 days |
| Storage | Vercel environment variable `CASE_LAB_GITHUB_TOKEN`, production only |

Actions write is the minimum permission that can create a `workflow_dispatch`
event; Actions read lists the runs for the limits. The token cannot read
repository contents, secrets, or variables, and cannot write to any other
repository.

The `case-lab.yml` workflow runs with `actions: write`, `checks: write`,
`contents: write`, and `pull-requests: write`. It never grants `id-token`.

## Environment allowlist

The dispatcher reads only:

| Variable | Meaning |
| --- | --- |
| `CASE_LAB_GITHUB_TOKEN` | The service identity token. Required. |
| `CASE_LAB_ENABLED` | `true` enables live dispatch. Anything else disables it. |
| `CASE_LAB_SITE_ORIGIN` | Optional https origin allowed to call the API from a browser. |

The dispatcher refuses to start when `NEBIUS_API_KEY`, `CONTREE_TOKEN`,
`CONTREE_PROJECT`, `TAVILY_API_KEY`, `GITHUB_TOKEN`, or `GH_TOKEN` is present
in its environment. Provider secrets exist only as `sutura-demo` Actions
secrets and are passed only to the Action step. ConTree receives `CI=true`
and `NODE_ENV=test` and no credential
(`docs/security/private-repositories.md`).

## Threat model for the public trigger

| Threat | Control |
| --- | --- |
| Arbitrary repository, ref, command, patch, or text | The request boundary accepts one key with five values; the workflow re-validates its two inputs with a `choice` input and a regex. |
| Spend amplification | Hourly throttle, daily spend stop, and a static concurrency group of one, enforced in the dispatcher and again in the workflow. Per-run cost is bounded by the Action budgets (USD 0.25 inference, 32 sandbox operations, 600 seconds). |
| Token theft | The token can only list and dispatch runs on one repository; it lives only in the Vercel environment; error paths never echo it. |
| Result tampering | Result documents carry a content hash and are validated by rebuilding it; links are restricted to public GitHub URLs. |
| Secret leakage into public results | `assertCaseLabResultPublicSafe` rejects credentials, token prefixes, and private local paths; the workflow runs it with the live secret values before publishing. |
| Dispatcher outage | The static site and every deterministic result keep working; only live dispatch is unavailable. |
| Two requests racing one limit | One instance serializes its check-then-dispatch section; across instances the workflow's static concurrency group holds concurrency at one and its own daily-cap count, which includes queued runs, holds the daily stop. The hourly throttle can be exceeded by at most the number of warm instances. |
| Emergency switch on a warm instance | The dispatcher reads its environment on every invocation; a redeploy is still the documented way to change a Vercel variable, and the repository variable inside the workflow stops spend even if the dispatcher is stale. |

## Commands

```text
case-lab catalog --out <dir>                 write the five deterministic results
case-lab replay <case-id> [--out <file>]     one deterministic result
case-lab build-site [--site-url <origin>] [--site-config <file>]
                                             write dist/site; site.json supplies the origin and identifiers
case-lab serve [--port 4177]                 serve dist/site for local review
case-lab acceptance --base-url <url>         signed-out acceptance record (--offline skips link checks)
case-lab verify-pin [--tag v0.2.0]           prove release.json, the demo workflow, and the tag agree
case-lab dispatch --base-url <url> --case <id>
case-lab capture-replay --request-id <id> --out replay
case-lab publish-result ...                  used inside the demo workflow
```

## Search and social metadata

`build-site` reads the site origin from `site.json` (`--site-url` still wins,
and `vercel.json` passes it explicitly). The origin gives every page a
canonical link and an absolute Open Graph URL, and writes `sitemap.xml` with
the index, the five replay pages, `/about/`, and `/privacy/`. Without an origin the build
still succeeds but carries no canonical and no sitemap, and
`case-lab acceptance` fails its `robots-txt`, `sitemap-xml`, and `canonical`
checks against it.

Every build writes `robots.txt` (`/result/` and `/api/` disallowed), copies
`assets/favicon.svg` and `assets/social-card.png` (1200x630) to the site
root, and adds Open Graph, Twitter card, theme-color, and JSON-LD tags to each
page: `WebSite` plus `SoftwareApplication` on the index, `WebPage` on each
replay and on `/about/`. Only `/result/` is `noindex`, by meta tag and by the
`X-Robots-Tag` header that `vercel.json` sets on `/result*` and `/api/*`;
`case-lab serve` sends the same headers so the acceptance record means the
same thing locally.

## About page

`/about/` ("What Sutura verifies") is the one page of plain explanatory text.
Its body is `content/about.md`, derived from the root README's "How it works"
and "Runtime roles" sections; `build-site` reads it at build time
(`BuildSiteOptions.aboutPath` overrides the file for tests) and refuses to
write anything when the file is missing. `renderMarkdown` in `src/render.ts`
implements the whole Markdown subset the file may use, with no dependency:
`#`, `##`, `###` headings, paragraphs, ordered and unordered lists (one line
per item), tables with a header separator row, code spans, `**bold**`, and
`[text](url)` links. Every value is HTML-escaped. A link may point only to
`https://github.com/…`, `https://raw.githubusercontent.com/…`, or a
site-relative path starting with `/` (resolved against `--site-root`);
any other URL, and any construct outside the subset, fails the build with
the offending URL or line.

Internal links: the index paragraph under the header, the "Back to cases" and
"How Sutura verifies" links at the end of every replay page, and the
About · Privacy · Repository footer on every page. `case-lab acceptance`
requires `/about/` to answer 200, name its subject, and link to all five
replay pages (`about-page`), and counts it among the indexed pages for the
`sitemap-xml` and `canonical` checks.

## Analytics and search verification

`site.json` (schema `sutura-case-lab-site-v1`) holds the public identifiers
that appear in the served HTML. None is a secret. Every field is optional and
a missing field renders nothing, so a config with only `schemaVersion`
produces a site with no analytics and no verification markup.

| Field | Renders |
| --- | --- |
| `siteUrl` | Default `--site-url`: canonical links, absolute Open Graph URLs, the sitemap. |
| `googleSiteVerification` | `<meta name="google-site-verification">` on every page. |
| `bingSiteVerification` | `<meta name="msvalidate.01">` on every page. |
| `ga4MeasurementId` (`G-…`) | Google Analytics 4 under Consent Mode v2. The consent default (every storage type denied, `wait_for_update` 500 ms) is declared before the loader; `anonymize_ip` is on. Not rendered on `/result/`. |
| `clarityProjectId` | Microsoft Clarity with `clarity('consent', false)` until the visitor accepts. Not rendered on `/result/`. |
| `vercelAnalytics` (`"true"`) | The cookieless Vercel Web Analytics script on every page. Needs no consent. |

`loadSiteConfig` refuses an unknown field, a wrong schema, or a malformed
value with a message that names the file and the field, and `build-site`
writes nothing in that case. `--site-config <file>` points at another file.

Consent: when a page carries GA4 or Clarity, `<main>` gets
`data-consent="ga4,clarity"` and the client renders a footer-anchored banner
(`role="region"`, label "Cookie consent") with Accept, Decline, and a link to
`/privacy/`. Accept sends `gtag('consent', 'update', { analytics_storage:
'granted' })` and `clarity('consent')` and stores `sutura-consent=granted` in
`localStorage`; Decline stores `denied` and leaves the defaults. A stored
`granted` is re-applied on every later page load; `denied` or no choice loads
nothing beyond the consent-off defaults. No cookie is written before Accept.
`/privacy/` (indexed, in the sitemap, linked from every footer beside About
and Repository) names only the tools the build carries and how to withdraw.

`case-lab acceptance` reads the same `site.json` and fails `verification-tags`
unless the served index carries both configured tokens; without tokens the
check is skipped with a named reason. `privacy-page` requires `/privacy/` to
answer 200 and name its subject.

Content Security Policy: no CSP is set today. A future policy must allow
scripts from `https://www.googletagmanager.com`, `https://www.clarity.ms`
(and its `*.clarity.ms` beacon hosts), same-origin `/_vercel/`, and the inline
consent and loader snippets; `connect-src` must add
`https://*.google-analytics.com`, `https://*.analytics.google.com`, and
`https://*.clarity.ms`.

## Deployment

Deployment is an authorization gate. The exact commands, cap, and expected
cost are recorded in `docs/plans/2026-09-04-sutura-case-lab.md`.
