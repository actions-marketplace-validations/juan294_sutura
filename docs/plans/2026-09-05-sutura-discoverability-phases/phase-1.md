# Phase 1: Technical SEO in the static build

Depends on: none

## Goal

Every page the Case Lab serves carries the tags a crawler needs, the site publishes `robots.txt` and `sitemap.xml`, per-request pages are excluded, and the acceptance script fails when any of this is missing.

## Files

- `packages/case-lab/src/site.ts:21-31` (`BuildSiteOptions`) and `:79-140` (`buildSite`)
- `packages/case-lab/src/render.ts:365-397` (`PageShellOptions`, `renderPage`)
- `packages/case-lab/src/site.test.ts:32-50` (exact file list) and new assertions
- `packages/case-lab/src/acceptance.ts:63` (`acceptance`)
- `packages/case-lab/src/cli.ts:25,128-138` (`build-site` flags)
- `packages/case-lab/assets/` (new: `favicon.svg`, `social-card.png` 1200x630)
- `packages/case-lab/vercel.json`

## Changes

1. Add `siteUrl?: string` to `BuildSiteOptions` (absolute origin without trailing slash, for example `https://sutura-case-lab.vercel.app`). `build-site` gains `--site-url`. When absent, canonical, Open Graph URL, sitemap `<loc>`, and JSON-LD `url` are omitted; nothing else changes, so existing tests keep passing until updated.
2. Extend `PageShellOptions` with `path` (site-relative, for example `/replay/flaky-failure/`), `siteUrl?`, `robots?: 'index' | 'noindex'`, `ogType?`, `jsonLd?: object[]`. `renderPage` emits, in this order after `<title>`:
   - `<link rel="canonical" href="${siteUrl}${path}">` when `siteUrl` is set
   - `<meta name="robots" content="noindex, nofollow">` when `robots === 'noindex'`; otherwise nothing (default is index)
   - `<meta property="og:type|og:title|og:description|og:url|og:image|og:site_name">`, `<meta name="twitter:card" content="summary_large_image">`, `twitter:title`, `twitter:description`, `twitter:image`
   - `<link rel="icon" href="${siteRoot}favicon.svg" type="image/svg+xml">`, `<meta name="theme-color">` matching the CSS
   - one `<script type="application/ld+json">` per entry in `jsonLd`, serialized with `JSON.stringify` and every `<` replaced by `\u003c`
3. `buildSite` passes JSON-LD: the index gets `WebSite` (name, url, description) plus `SoftwareApplication` (name Sutura, `applicationCategory: DeveloperApplication`, `operatingSystem: GitHub Actions`, `license: https://opensource.org/licenses/MIT`, `codeRepository`, `softwareVersion` from `release.version`, `offers` price 0). Each replay page gets a `WebPage` entry with `isPartOf` the WebSite, `name` from `resultPageTitle`, and `dateModified` from `result.createdAt`. The `/result/` page gets `robots: 'noindex'` and no JSON-LD.
4. `buildSite` writes:
   - `robots.txt`: `User-agent: *`, `Allow: /`, `Disallow: /result/`, `Disallow: /api/`, and `Sitemap: ${siteUrl}/sitemap.xml` when `siteUrl` is set
   - `sitemap.xml`: `/` and the five `/replay/<id>/` URLs with `<lastmod>` from `result.createdAt` (index uses the newest). Written only when `siteUrl` is set; the site test builds with a fixed `siteUrl` so the file is always asserted.
   - copies `assets/favicon.svg` and `assets/social-card.png` to the site root
5. `vercel.json` headers: add `X-Robots-Tag: noindex` for `/api/(.*)` and `/result(.*)`, and `X-Content-Type-Options: nosniff` for `/(.*)`. Add `"cleanUrls": false` explicitly (directory index pages already resolve; this documents it).
6. `acceptance.ts`: add checks `robots-txt` (200, contains `Sitemap:`), `sitemap-xml` (200, lists six `<loc>` all under the base URL), `canonical` on `/` and each replay page (matches the requested URL), `result-noindex` (HEAD `/result/` has `X-Robots-Tag: noindex`), `social-card` (200, `image/png`). Each check names the URL and the missing item in its message.
7. `site.test.ts`: update the exact file list (`favicon.svg`, `robots.txt`, `sitemap.xml`, `social-card.png`); assert canonical, one `og:image`, valid JSON-LD (parse every `ld+json` block; `@type` of the index includes `SoftwareApplication`), `noindex` only on `result/index.html`, and that `sitemap.xml` has exactly six `<loc>`.

## Verification

- `pnpm --filter @sutura/case-lab test && pnpm run typecheck && pnpm run lint && pnpm run build`
- `node packages/case-lab/bin/case-lab.js build-site --out /tmp-scratch/site --api-base "" --site-url https://sutura-case-lab.vercel.app` then serve with `case-lab serve` and run `case-lab accept --base-url http://127.0.0.1:<port>`; all new checks pass.
- Paste `index.html` into Google's Rich Results Test (browser, read-only) and confirm no errors.
- `pnpm run ci:fast` before push.

## Success criteria

- [x] Every generated HTML page has a canonical, Open Graph, and Twitter tags; only `/result/` is `noindex`.
- [x] `robots.txt` and `sitemap.xml` exist and reference each other correctly.
- [x] JSON-LD parses and validates in the Rich Results Test (live `/`, 2026-09-05: 1 valid Software Apps item).
- [x] `case-lab accept` fails on a build that omits any of the above.
