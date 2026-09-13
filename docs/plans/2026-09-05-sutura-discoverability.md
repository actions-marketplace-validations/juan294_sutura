# Sutura discoverability and search presence plan

Date: 2026-09-05

Status: Complete (all phases implemented, deployed, and registered on 2026-09-05; see `docs/release/discoverability-playbook.md` for the live record and the open request-indexing retry)

Owner: Juan (execution: Claude Fable 5.1)

Base commit: `f8195e8` on `develop`.

## Goal

Every public Sutura surface is indexable, described with correct metadata, registered with the major search engines, and measured. A person searching for "verified self-healing CI", "AI CI repair GitHub Action", or "Sutura Nemotron" finds the Case Lab or the repository on the first results page within weeks of indexing, and Juan can see traffic, crawl coverage, and session recordings in one place.

## Current state (research, 2026-09-05)

Public surfaces:

| Surface | URL | Indexing state |
| --- | --- | --- |
| Case Lab static site | `https://sutura-case-lab.vercel.app/` (Vercel project `sutura-case-lab`, deployed 2026-09-05) | Served 200. `robots.txt` 404, `sitemap.xml` 404. No canonical, Open Graph, Twitter card, structured data, favicon, analytics, or verification tag. |
| GitHub repository | `https://github.com/juan294/sutura` | Public, MIT, six topics, `homepage` empty, no social preview, GitHub Pages off. |
| npm package `sutura` | `https://www.npmjs.com/package/sutura` | v0.2.0 published. Five generic keywords, `homepage` points at the README. `@sutura/core` is not published. |
| GitHub Marketplace | not listed | Publication prepared in `docs/adoption/ws-3-marketplace-checklist.md`; gated on Juan. |
| Devpost | pending submission | `docs/devpost/sutura-submission.md`. |

The page shell is `renderPage` in `packages/case-lab/src/render.ts:373-397`. The site file set is written by `buildSite` in `packages/case-lab/src/site.ts:79-140` and asserted exactly in `packages/case-lab/src/site.test.ts:32-50`. `vercel.json` only sets `Cache-Control: no-store` on `/api/*`. Nothing in the roadmap or the Case Lab plan mentions search, analytics, or indexing.

## Decisions

1. **Public identifiers live in a committed file, not env vars.** Analytics IDs, verification tokens, and the canonical site URL are visible in every served page, so they are not secrets. They go in `packages/case-lab/site.json` (new) and are read by `build-site`. Every field is optional; a missing field renders nothing, so the local build and CI never emit a broken or empty tag. Secrets stay in Vercel env as today.
2. **Consent before cookies.** Google Analytics 4 and Microsoft Clarity set cookies and profile visitors; the site has EU visitors. GA4 loads with Consent Mode v2 defaults set to denied and Clarity starts in cookieless mode; both upgrade only after the visitor accepts a one-line banner. Vercel Web Analytics is cookieless and loads without consent, so basic page-view counts exist even when nobody clicks accept. A `/privacy/` page names each tool.
3. **Live and API pages are excluded from the index.** `/result/?id=...` is a per-request page with no stable content and `/api/*` is JSON. Both get `noindex` (meta tag and `X-Robots-Tag`).
4. **Custom domain is recommended but not blocking.** A `*.vercel.app` host cannot use DNS verification or a Search Console Domain property, and ranks below a branded domain. Phases below work on the current host; Phase 3 records how to switch if Juan buys a domain (see Open question 1).
5. **No hosted builds.** All deploys remain `vercel build --prod` then `vercel deploy --prebuilt --prod` from a local build, per the global rule. Search engine registrations point at the production URL only.
6. **Content comes before tags.** Meta tags make pages eligible; text makes them rank. Phase 5 adds one crawlable explainer page derived from the README so the site has a page that answers "what is Sutura" in plain text, which the index page (five cards) does not.

## Phases

| Phase | Name | Files | Depends on | Batch |
| ---: | --- | --- | --- | --- |
| 1 | Technical SEO in the static build | `packages/case-lab/src/render.ts`, `site.ts`, `site.test.ts`, `acceptance.ts`, `assets/**`, `vercel.json` | None | Sequential |
| 2 | Analytics, consent, and verification tags | `packages/case-lab/site.json` (new), `src/site-config.ts` (new), `render.ts`, `site.ts`, `client.ts`, `assets/case-lab.css`, `README.md` | 1 | Sequential |
| 3 | Register the site with Google, Bing, Clarity, and Vercel Analytics | `packages/case-lab/site.json`, `docs/release/discoverability-playbook.md` (new) | 3A none; 3B on 2 | Agent, via Chrome |
| 4 | Off-site presence: GitHub, npm, Marketplace, Devpost | `README.md`, `packages/cli/package.json`, repository settings, `docs/adoption/ws-3-marketplace-checklist.md` | None | `[batch-eligible]` with 1 and 2 |
| 5 | Crawlable content and monitoring cadence | `packages/case-lab/src/render.ts`, `site.ts`, `content/about.md` (new), `docs/release/discoverability-playbook.md` | 1, 3 | Sequential |

Phase files: `docs/plans/2026-09-05-sutura-discoverability-phases/phase-N.md`.

Phase 4 is `[batch-eligible]`: it touches no file in `packages/case-lab`. Phases 1, 2, and 5 all edit `render.ts` and `site.ts` and run in order.

## What each phase delivers

- **Phase 1**: `robots.txt`, `sitemap.xml`, canonical link, Open Graph and Twitter card tags, `SoftwareApplication` and `WebSite` JSON-LD, favicon and a static social image, `noindex` on `/result/`, `X-Robots-Tag` and `X-Content-Type-Options` headers, and acceptance checks that fail if any of these are missing on the live host.
- **Phase 2**: The `site.json` config, Google and Bing verification meta tags, GA4 with Consent Mode v2, Clarity, Vercel Web Analytics, the consent banner, and the privacy page. All absent-safe.
- **Phase 3**: The agent, through Juan's logged-in Chrome session, creates the GA4 property, Clarity project, Search Console URL-prefix property, and Bing Webmaster Tools site as new entries beside the existing `spokenletter.com` ones (3A, before the Phase 2 deploy, so `site.json` is filled once). After Phase 2 is deployed it verifies ownership, submits the sitemap, requests indexing of the six URLs, and confirms data arrives (3B). The playbook records every ID and date. Authorized by Juan on 2026-09-05.
- **Phase 4**: Repository `homepage` set to the Case Lab, topics expanded, social preview uploaded, README gets a Case Lab link near the top, npm keywords and `homepage` updated on the `sutura` package, Marketplace and Devpost entries link to the site. Marketplace publication itself stays behind its existing gate.
- **Phase 5**: A `/about/` page with the README's "How it works" and "Runtime roles" text, internal links between the index, result pages, and about page, and a weekly checklist for Search Console coverage, Bing, GA4, and Clarity.

## Verification

Automated, every code phase: `pnpm --filter @sutura/case-lab test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, then `pnpm run ci:fast` before any push. No phase touches `packages/core`, so `pnpm run ci:local` is not required.

Live checks after Phase 3 (all read-only, no paid minutes):

```bash
curl -sS https://sutura-case-lab.vercel.app/robots.txt
curl -sS https://sutura-case-lab.vercel.app/sitemap.xml
curl -sSI https://sutura-case-lab.vercel.app/result/ | grep -i x-robots-tag
node packages/case-lab/bin/case-lab.js accept --base-url https://sutura-case-lab.vercel.app
```

Then in a browser: Google Rich Results Test on `/` and one replay page, Search Console URL Inspection on `/`, Bing URL Inspection on `/`.

## Decided by Juan on 2026-09-05

- Phase 3 is executed by the agent in Juan's logged-in browser session; new properties are created beside the existing `spokenletter.com` entries. All accounts are `juan294@gmail.com`.

## Open questions for Juan

1. **Custom domain?** Recommended. Buying one (for example through Vercel, USD 10-20 per year) unlocks DNS verification, a Search Console Domain property, and a stable canonical that survives a Vercel project rename. If yes, Phase 3 uses the domain as `siteUrl` from the start and the `vercel.app` host redirects to it.
2. **Consent banner scope.** Decision 2 assumes a banner for everyone. An alternative is Vercel Web Analytics only, no banner, no GA4 or Clarity. Juan asked for all tools, so the plan includes them with consent.

## Out of scope

- Paid search, backlink outreach, blog content beyond the one about page.
- A separate docs site or GitHub Pages; the Case Lab is the single public web surface.
- Changing the root or Action `description` fields, which `scripts/marketplace-evidence.mjs preflight` checks for parity.
