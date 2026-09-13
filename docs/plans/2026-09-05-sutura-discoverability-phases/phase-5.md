# Phase 5: Crawlable content and monitoring cadence

Depends on: 1, 3

## Goal

The site has one page of plain explanatory text that search engines can rank for "verified self-healing CI" queries, internal links tie every page together, and Juan has a short weekly routine to watch coverage and traffic.

## Files

- `packages/case-lab/content/about.md` (new; source text is the README's "How it works" and "Runtime roles" sections, README.md:21-70, plus the five outcomes paragraph)
- `packages/case-lab/src/render.ts` (`renderAboutBody`, footer links), `site.ts` (writes `/about/`, adds it to the sitemap), `site.test.ts`
- `docs/release/discoverability-playbook.md` (monitoring section)

## Changes

1. `/about/`: title "What Sutura verifies", description "How Sutura reproduces a CI failure, searches repairs in sandboxes, audits the patch, and refuses green-wash fixes." Body rendered from `content/about.md` with a minimal Markdown subset (headings, paragraphs, tables, code spans) implemented in `render.ts`; no new dependency. The Mermaid diagram is replaced by an ordered list of the same steps. Links to the repository, the README, and each replay page by outcome ("see a refusal", "see a flaky classification").
2. Index page: add one paragraph under the header linking `/about/`. Each replay page: add "Back to cases" and "How Sutura verifies" links above the footer. Footer gains `About · Privacy · Repository`.
3. `sitemap.xml` includes `/about/` and `/privacy/`; `robots.txt` unchanged.
4. Playbook monitoring section, weekly until 2026-10-30 and monthly after:
   - Search Console: Pages report (indexed count should reach 8), Performance report (queries, impressions), any Core Web Vitals issue.
   - Bing Webmaster: Site Explorer indexed count, crawl errors.
   - GA4: users, top pages, referrers; note Devpost and GitHub referral share.
   - Clarity: rage clicks and dead clicks on the case cards and the live-run button.
   - Action rule: any "Excluded" or "Crawled, currently not indexed" page gets a URL Inspection re-request once; a second failure becomes an issue.

## Verification

- `pnpm --filter @sutura/case-lab test && pnpm run typecheck && pnpm run lint && pnpm run build`
- `site.test.ts`: file list includes `about/index.html`; the about page contains the runtime roles table and links to all five replay pages; the sitemap has 8 `<loc>` entries.
- `case-lab accept` passes against the served build.
- After the prebuilt deploy, Search Console URL Inspection on `/about/` returns "URL is on Google" within the following week (recorded in the playbook).

## Success criteria

- [x] `/about/` exists and is reachable from every other page (built and acceptance-checked); indexing is tracked in the playbook.
- [x] All eight URLs are in the sitemap and submitted to both engines; indexing status is tracked weekly in the playbook.
- [x] The playbook has a monitoring checklist with a first completed entry (2026-09-05).
