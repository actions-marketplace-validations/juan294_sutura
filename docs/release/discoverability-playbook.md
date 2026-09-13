# Discoverability playbook

Plan: `docs/plans/2026-09-05-sutura-discoverability.md`. All accounts belong to `juan294@gmail.com`. Every identifier below is public: it is served in the HTML of every Case Lab page or is visible in a public listing. Secrets never belong in this file.

## Registered properties

| Service | Entry | Identifier | Created | Status |
| --- | --- | --- | --- | --- |
| Google Analytics 4 | Property "Sutura Case Lab" (552890586) under account "Spoken Letter" (398659195); web stream "Sutura Case Lab", stream 15723700890 | Measurement ID `G-Z65T5Y173D` | 2026-09-05 | Receiving data (Realtime showed the first `page_view` on 2026-09-05); time zone Spain, currency USD, enhanced measurement on, Google Signals off |
| Microsoft Clarity | Project "Sutura Case Lab", industry Technology & Telecommunications | Project ID `ydi0lx4kw6` | 2026-09-05 | Receiving data (2 sessions on 2026-09-05); not linked to GA4 |
| Google Search Console | URL-prefix property `https://sutura-case-lab.vercel.app/` | HTML tag `f7PZNffeQUHV6bvX9Pzff2dL0yT9iyxDqT83uHy3Dfg` | 2026-09-05 | Ownership auto verified (HTML tag and Google Analytics); sitemap submitted, 8 discovered pages |
| Bing Webmaster Tools | Site `https://sutura-case-lab.vercel.app/`, added manually | Meta tag `msvalidate.01` = `9E58012EFDC70E5C8289C62F90BD646F` | 2026-09-05 | Verified via meta tag; sitemap submitted (Processing); all 8 URLs submitted through URL Submission |
| Vercel Web Analytics | Project `sutura-case-lab`, team The Creative Token (Pro), included tier | none (script at `/_vercel/insights/script.js`) | 2026-09-05 | Enabled and receiving data (3 visitors, 5 page views on 2026-09-05) |
| GitHub repository | `juan294/sutura` | homepage `https://sutura-case-lab.vercel.app`, 12 topics, social preview uploaded from `packages/case-lab/assets/social-card.png` | 2026-09-05 | Done |

A separate Google Analytics account named "Sutura" was not created: a new account requires accepting the Google Analytics Terms of Service, which is Juan's click. The property can be moved to a new account later from Admin → Property → Move.

The verification tokens, measurement ID, and Clarity ID are the values in `packages/case-lab/site.json`. Changing that file changes every served page on the next prebuilt deploy.

## Deploy procedure

Only prebuilt deploys, never a Git-triggered build:

```bash
cd packages/case-lab
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
curl -sS https://sutura-case-lab.vercel.app/ | grep -E "google-site-verification|msvalidate.01|G-Z65T5Y173D|clarity"
```

## Live checks

```bash
curl -sS https://sutura-case-lab.vercel.app/robots.txt
curl -sS https://sutura-case-lab.vercel.app/sitemap.xml
curl -sSI https://sutura-case-lab.vercel.app/result/ | grep -i x-robots-tag
node packages/case-lab/bin/case-lab.js acceptance --base-url https://sutura-case-lab.vercel.app
```

## Verification and submission log

| Date | Action | Result |
| --- | --- | --- |
| 2026-09-05 | Phase 3A: properties created, identifiers collected (table above) | Done |
| 2026-09-05 | Prebuilt production deploy `dpl_716Ef2zj1SDM7QTLcT7ZFyd1ENzw` from develop `2bec01b` (21 files: 8 pages, sitemap, robots, favicon, social card) | Live; `X-Robots-Tag: noindex` on `/result/` and `/api/` |
| 2026-09-05 | Google Search Console: verify ownership | Auto verified, methods HTML tag and Google Analytics |
| 2026-09-05 | Google Search Console: submit `sitemap.xml` | Success, 8 discovered pages |
| 2026-09-05 | Google Search Console: URL Inspection of `/` | "Discovered - currently not indexed", sitemap noted as source |
| 2026-09-05 | Google Search Console: Request indexing for the 8 URLs | Refused, "Quota Exceeded" (the account's daily quota was already used). Retry on 2026-09-06 for `/`, `/about/`, and the five replay pages |
| 2026-09-05 | Bing Webmaster Tools: verify ownership | Verified via `msvalidate.01` meta tag |
| 2026-09-05 | Bing Webmaster Tools: submit `sitemap.xml` | Accepted, status Processing |
| 2026-09-05 | Bing Webmaster Tools: URL Submission | All 8 URLs accepted (quota 92 of 100 left) |
| 2026-09-05 | Google Rich Results Test on `/` | 1 valid item, Software Apps (`SoftwareApplication` "Sutura"); one non-critical note: optional `aggregateRating` absent, left out on purpose |
| 2026-09-05 | Data check in a browser after Accept | GA4 Realtime 1 active user with `page_view`; Clarity 2 sessions; Vercel Analytics 3 visitors, 5 page views. No cookie before Accept; `sutura-consent=granted` after |
| 2026-09-05 | Vercel firewall | System DDoS mitigation challenged this machine's IP after a 45 s curl poll loop (13 requests per burst). Temporary and IP-scoped; crawlers unaffected. Poll the live site no more than once a minute |
| 2026-09-06 | Google Search Console: URL Inspection of the 8 URLs | `/` "URL is on Google", page indexed. `/replay/javascript-repair/`, `/replay/python-repair/`, `/replay/flaky-failure/`, `/replay/upstream-incident/` "Discovered - currently not indexed", sitemap noted as source. `/about/`, `/replay/greenwash-trap/`, `/privacy/` "URL is unknown to Google", no referring sitemap reported although the live `sitemap.xml` lists all 8 (Google-side lag) |
| 2026-09-06 | Google Search Console: Request indexing for the 7 non-indexed URLs | Refused again, "Quota Exceeded", on `/about/` and `/replay/javascript-repair/` (10:00 CEST); the refusal is property-wide, so the other five were not attempted. `/` was not re-requested because it is already indexed. Retry on 2026-09-07; if refused a third time, stop re-requesting and rely on sitemap crawling, which already indexed `/` |
| 2026-09-07 | Google Search Console: URL Inspection of `/about/`, then Request indexing | `/about/` now shows "Discovered - currently not indexed" with the sitemap detected (was "URL is unknown to Google" on 2026-09-06). Request indexing refused a third time, "Quota Exceeded" (Test Live URL ran, then the quota error appeared). Per the stop rule, the other six URLs were not attempted and no further indexing requests will be made; relying on sitemap crawling going forward. Next pass 2026-09-12 checks whether any of the 7 moved to indexed on their own |

## Monitoring cadence

Weekly until 2026-10-30, then monthly. Record each pass as one dated entry
under this section: date, the four counts below, and any action taken.

| Tool | What to read | What to record |
| --- | --- | --- |
| Google Search Console (`https://sutura-case-lab.vercel.app/` URL-prefix property) | Pages report: indexed count, which should reach 8 (`/`, five `/replay/<case>/`, `/about/`, `/privacy/`). Performance report: queries, impressions, clicks. Core Web Vitals report: any page marked poor or needs improvement. | Indexed count, top three queries with impressions, any CWV issue and the affected URL. |
| Bing Webmaster Tools | Site Explorer: indexed count. Crawl errors and the URL Inspection state of `/` and `/about/`. | Indexed count, every crawl error with its URL. |
| Google Analytics 4 | Users, top pages, and referrers for the period. Note the Devpost and GitHub referral share. | Users, top three pages, the Devpost and GitHub share of sessions. |
| Microsoft Clarity | Rage clicks and dead clicks on the case cards and the live-run button. | Count of each, with the element, and whether the live-run gate was on. |

Action rule: any page that Search Console lists as "Excluded" or "Crawled,
currently not indexed" gets one URL Inspection re-request in the same pass.
If the page is still not indexed at the next pass, open an issue that names
the URL and the status; do not re-request a second time without a content or
markup change.

### Entries

| Date | Google indexed | Bing indexed | GA4 users | Clarity rage / dead clicks | Action |
| --- | ---: | ---: | ---: | --- | --- |
| 2026-09-05 | 0 (8 discovered from the sitemap, request-indexing quota exhausted) | 0 (sitemap Processing, 8 URLs submitted) | 1 | 0 / 0 (2 sessions) | Request indexing for all 8 URLs on 2026-09-06; next pass 2026-09-12 |
