# Phase 2: Analytics, consent, and verification tags

Depends on: 1

## Goal

The build reads public identifiers from one committed file and renders Google Search Console and Bing verification tags, Google Analytics 4 under Consent Mode v2, Microsoft Clarity, Vercel Web Analytics, a consent banner, and a privacy page. Every identifier is optional and absent-safe.

## Files

- `packages/case-lab/site.json` (new) and `packages/case-lab/src/site-config.ts` (new, with `site-config.test.ts`)
- `packages/case-lab/src/site.ts:79-140`, `render.ts:373-397`
- `packages/case-lab/src/client.ts` (consent handling) and `assets/case-lab.css` (banner)
- `packages/case-lab/src/cli.ts:128-138` (`build-site` reads `site.json` by default; `--site-config <path>` overrides)
- `packages/case-lab/README.md` (new "Analytics and search verification" section)
- `packages/case-lab/vercel.json` (`includeFiles` unchanged; nothing secret is added)

## Changes

1. `site.json` schema (`sutura-case-lab-site-v1`), all fields optional strings: `siteUrl`, `googleSiteVerification`, `bingSiteVerification`, `ga4MeasurementId` (`G-` prefix), `clarityProjectId`, `vercelAnalytics` (`"true"` enables the script tag). `loadSiteConfig(path)` validates shape and prefixes with `RangeError` messages that name the file and field. Initial committed content has `siteUrl` only, set to `https://sutura-case-lab.vercel.app`; the other fields are added in Phase 3 once the accounts exist.
2. `renderPage` head additions, each only when its value is present:
   - `<meta name="google-site-verification" content="...">`
   - `<meta name="msvalidate.01" content="...">`
   - GA4: `gtag('consent','default',{ad_storage:'denied',analytics_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'})` before the `gtag/js` loader, `anonymize_ip` on, and `send_page_view` after config. Not rendered on `/result/`.
   - Clarity: the standard loader with `clarity('consent', false)` until accepted.
   - Vercel Web Analytics: `<script defer src="/_vercel/insights/script.js">` plus the `window.va` shim. Cookieless; loads without consent.
3. Consent: `client.ts` renders a footer-anchored banner ("This site uses Google Analytics and Microsoft Clarity to count visits and see how the Case Lab is used. Accept / Decline · Privacy") only when GA4 or Clarity is configured. Accept calls `gtag('consent','update',{analytics_storage:'granted'})` and `clarity('consent')`, stores `sutura-consent=granted` in `localStorage`, and hides the banner. Decline stores `denied` and leaves the defaults. The banner never blocks the page and is keyboard reachable. No cookie is written before Accept.
4. `/privacy/index.html`: static page rendered by `buildSite` (robots index), naming each tool that is configured, what it stores, and how to withdraw consent (clear site data). Linked from the footer in `renderPage`. Added to the sitemap.
5. All scripts are inline or from `www.googletagmanager.com`, `www.clarity.ms`, and same-origin `/_vercel/`. No CSP is set today, so nothing else changes; note in README that a future CSP must allow these hosts.
6. Tests: `site-config.test.ts` (valid, empty, malformed prefix); `site.test.ts` builds twice, once with an empty config (asserts none of the tags or scripts exist) and once with a full config (asserts each tag, that GA4 is absent on `result/index.html`, that the consent default precedes the loader, and that `privacy/index.html` exists).

## Verification

- `pnpm --filter @sutura/case-lab test && pnpm run typecheck && pnpm run lint && pnpm run build`
- Local browser check on the served build with a full test config: no `_ga` cookie before Accept, `_ga` present after Accept, banner gone on reload, Decline leaves no cookie.
- `pnpm run ci:fast` before push.

## Success criteria

- [x] An empty `site.json` produces a site byte-identical to Phase 1 output apart from the privacy page and footer link.
- [x] A full config renders every tag; the tests prove Consent Mode defaults load first.
- [x] No cookie is set before consent.
